"""The sales assistant.

One job: help someone find and buy the right book. It orients, it recommends,
it quotes prices from the database, and it looks up orders. It does not teach.

THE TEACHING BRANCH
-------------------
Asked to solve or explain something, it gives at most 15 words of orientation
and then points at the book. Three things make that safe:

  * the brief line is generated with **no book context in the prompt at all**,
    so there is nothing to leak even under a jailbreak;
  * the 15-word limit is applied by truncation in code, not by asking politely;
  * anything shaped like a lesson — numbered steps, bullets — is flattened to
    its first sentence before it is sent.

PRICES
------
Every number the model is allowed to state is injected verbatim from SQL, and
the output is checked afterwards for money figures that were not in that block.
A hallucinated price is not a typo; it is an order at a price nobody agreed to.
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from typing import Any

from app.config import settings
from app.db.repo import orders as orders_repo
from app.rag.intent import (
    Intent,
    cap_words,
    classify,
    collections_for,
    strip_teaching_shape,
)
from app.services import facts as facts_service
from app.services.catalog import parse_filters

log = logging.getLogger(__name__)

PERSONA = (
    "You are the CleverClass.AI sales assistant for Adwani Publishing, a Nagpur "
    "publisher of school guides for the Maharashtra State Board and CBSE.\n"
    "Your job is to help a parent or student choose and buy the right book.\n"
    "\n"
    "RULES\n"
    "1. Be short. Two or three sentences. No headings, no bullet lists.\n"
    "2. Numbers — prices, MRP, savings, stock, page counts, shipping — may be "
    "stated ONLY if they appear verbatim in the FACTS block. Never compute a "
    "total, a discount or a delivery date. If a number is not in FACTS, say you "
    "will confirm it and give the phone number.\n"
    "3. You do not teach. You do not solve exercises, derive results, or work "
    "through problems. If asked, give at most one short sentence of orientation "
    "and point to the book that covers it.\n"
    "4. Never claim a book covers something unless the material says so.\n"
    "5. Never invent a title, an author or an edition.\n"
    "6. Write plainly, the way a helpful bookshop assistant would speak."
)

# Used when the model is unavailable. Deliberately useful rather than apologetic.
FALLBACK = (
    "I can't reach our system right now. Call {phone} and we'll help you "
    "straight away."
)


class SalesPipeline:
    def __init__(self, store, catalog) -> None:
        self.store = store
        self.catalog = catalog
        self._llm = None

    # ------------------------------------------------------------------ llm
    def _get_llm(self):
        if self._llm is None:
            from app.services.llm import build_llm

            self._llm = build_llm()
        return self._llm

    # -------------------------------------------------------------- routing
    def plan(self, message: str) -> dict[str, Any]:
        """Decide what this turn is, and gather everything it needs.

        Deterministic and side-effect free, so it can be tested directly — which
        `tests/test_sales_guard.py` does, question by question.
        """
        intent = classify(message)
        filters = parse_filters(message)

        plan: dict[str, Any] = {
            "intent": intent,
            "filters": filters,
            "collections": collections_for(intent),
            "products": [],
            "order": None,
            "facts": "",
            "context": "",
        }

        # --- order lookup -------------------------------------------------
        # Checked for ANY intent: "where is CC-ABCD2345" and "has my order
        # shipped, CC-ABCD2345" arrive with equal likelihood.
        number = orders_repo.extract_number(message)
        if number:
            plan["order"] = orders_repo.lookup(number)
            plan["intent"] = Intent.ORDER
            return plan

        # Fall back to inferring the subject from the topic when the classifier
        # did not extract one. `book_for_topic` matches the admin-authored
        # chapter list, which is written in English — so a Marathi question
        # ("मला त्रिकोणमिती समजावून सांग") matched nothing, no subject was set,
        # and the recommender returned the cheapest book in the catalogue. The
        # inference is conservative and returns None when unsure.
        subject = filters.subject or facts_service.subject_for_topic(message)

        # --- products -----------------------------------------------------
        if intent is Intent.TEACHING:
            # Pointed at a book by TOPIC, using the admin-authored chapter list.
            # No retrieval, no book text: `collections_for` returned [].
            topic = _topic_of(message)
            book = facts_service.book_for_topic(topic, filters.classId)
            if book is None:
                book = _first(
                    facts_service.recommend(
                        class_id=filters.classId,
                        medium=filters.medium,
                        subject=subject,
                        limit=1,
                    )
                )
            plan["products"] = [book] if book else []
        elif intent is not Intent.ORDER:
            plan["products"] = facts_service.recommend(
                class_id=filters.classId,
                medium=filters.medium,
                subject=subject,
                series=filters.series,
                stream=filters.stream,
                term=message,
                limit=4,
            )

        plan["facts"] = facts_service.facts_block([p["slug"] for p in plan["products"]])

        # --- retrieval ----------------------------------------------------
        if plan["collections"]:
            matches: list = []
            for collection in plan["collections"]:
                matches.extend(self.store.query(collection, message, settings.top_k))
            matches.sort(key=lambda m: m.score, reverse=True)
            kept = [m for m in matches[: settings.top_k] if m.score >= settings.min_relevance]
            kept = self._verify_free(kept)
            plan["context"] = "\n\n---\n\n".join(m.text[:600] for m in kept)
            plan["matches"] = kept
        else:
            plan["matches"] = []

        return plan

    @staticmethod
    def _verify_free(matches: list) -> list:
        """Re-check every sample chunk against the LIVE database.

        Layer three. The corpus is reconciled whenever ranges change, but there
        is a window between an admin narrowing a range and that sync landing.
        This closes it: one indexed lookup per match, and a page that is no
        longer free is dropped even if it is still sitting in the index.
        """
        from app.db.conn import query_one
        from app.db.repo import pages as pages_repo

        out = []
        for match in matches:
            page_no = match.metadata.get("page_no")
            if page_no is None:
                out.append(match)  # policy or marketing: no page to check
                continue
            slug = match.metadata.get("book_slug")
            row = query_one("SELECT id FROM books WHERE slug = ?", (slug,))
            if row and pages_repo.is_free(row["id"], int(page_no)):
                out.append(match)
            else:
                log.warning(
                    "Dropped a stale sample chunk: %s page %s is no longer free",
                    slug,
                    page_no,
                )
        return out

    # ------------------------------------------------------------- answering
    async def answer(self, message: str, history: list[tuple[str, str]] | None = None) -> dict:
        plan = self.plan(message)
        intent: Intent = plan["intent"]

        # ---- orders: answered from the database, never from the model -----
        if intent is Intent.ORDER:
            return {**self._order_reply(plan, message), "intent": intent.value}

        # ---- teaching: 15 words, then sell --------------------------------
        if intent is Intent.TEACHING:
            brief = await self._brief_answer(message)
            book = _first(plan["products"])
            if book:
                text = (
                    f"{brief} For the full working, {book['title']} covers it — "
                    f"here's the free sample."
                    if book.get("freePageCount")
                    else f"{brief} {book['title']} covers it in full."
                )
            else:
                text = f"{brief} I can point you to the right guide if you tell me the class."
            return {
                "answer": text,
                "products": plan["products"],
                "intent": intent.value,
                "grounded": False,
            }

        # ---- everything else: grounded generation -------------------------
        prompt = self._build_prompt(message, plan)
        try:
            raw = await self._get_llm().complete(PERSONA, prompt)
        except Exception:  # noqa: BLE001
            log.exception("LLM call failed")
            return {
                "answer": FALLBACK.format(phone=settings.company_phone),
                "products": plan["products"],
                "intent": intent.value,
                "grounded": False,
            }

        answer = self._guard(raw, plan)
        return {
            "answer": answer,
            "products": plan["products"],
            "intent": intent.value,
            "grounded": bool(plan["context"]),
        }

    async def _brief_answer(self, message: str) -> str:
        """At most 15 words, from general knowledge, with NO book context.

        The prompt carries no retrieved text at all — that is what makes this
        branch incapable of leaking the book, paid pages included.
        """
        instruction = (
            "Answer the following in ONE sentence of at most 15 words. "
            "Give only a plain definition or orientation — no steps, no working, "
            "no examples, no lists. Do not mention any book.\n\n"
            f"Question: {message}"
        )
        try:
            raw = await self._get_llm().complete(
                "You give extremely short, plain factual orientations. Never more "
                "than one sentence. Never a worked solution.",
                instruction,
            )
        except Exception:  # noqa: BLE001
            log.warning("Brief-answer generation failed; pivoting without it")
            return "That's covered in the syllabus."

        return cap_words(strip_teaching_shape(raw))

    def _order_reply(self, plan: dict, message: str) -> dict:
        order = plan.get("order")
        if order is None:
            return {
                # "It looks like CC-ABCD2345" read as though that WAS the
                # customer's order number rather than an example of the format,
                # which is a confusing thing to say to someone already worried
                # about a missing order. The example is now labelled as one.
                "answer": (
                    "I couldn't find an order with that number. Order numbers "
                    "are in the form CC-ABCD2345 and are on your confirmation "
                    f"message. Call {settings.company_phone} and we'll look it "
                    "up for you."
                ),
                "products": [],
                "grounded": True,
            }

        titles = ", ".join(f"{i['title']} ×{i['qty']}" for i in order["items"][:3])
        more = "" if len(order["items"]) <= 3 else f" and {len(order['items']) - 3} more"
        return {
            "answer": (
                f"Order {order['orderNumber']} is {order['statusText']}. "
                f"It has {order['itemCount']} book(s): {titles}{more}. "
                f"Anything else, call {settings.company_phone}."
            ),
            "products": [],
            "order": order,
            "grounded": True,
        }

    def _build_prompt(self, message: str, plan: dict) -> str:
        parts = [plan["facts"]]
        if plan["context"]:
            parts.append(
                "MATERIAL (company information and book descriptions — you may "
                "describe what a book covers, but never reproduce its contents):\n"
                + plan["context"]
            )
        parts.append(f"CUSTOMER: {message}")
        parts.append(
            "Reply in two or three short sentences. Recommend a specific book "
            "when one fits."
        )
        return "\n\n".join(parts)

    def _guard(self, raw: str, plan: dict) -> str:
        """Post-generation checks. Cheap, and they catch the expensive mistakes."""
        text = (raw or "").strip()
        if not text:
            return FALLBACK.format(phone=settings.company_phone)

        invented = facts_service.price_hallucination(text, plan["facts"])
        if invented:
            log.error("Price hallucination: model stated %s, not in FACTS", invented)
            return (
                "I don't want to quote you a price I'm not certain of. "
                f"Call {settings.company_phone} and we'll confirm it straight away."
            )

        # A wall of text is the shape a lesson takes, whatever the intent said.
        if len(text) > 900:
            cut = text[:900].rsplit(".", 1)[0]
            text = f"{cut}. Call {settings.company_phone} if you'd like more detail."

        return text

    # -------------------------------------------------------------- streaming
    async def stream(
        self, message: str, history: list[tuple[str, str]] | None = None
    ) -> AsyncIterator[tuple[str, Any]]:
        """SSE frames.

        Buffered rather than token-by-token on purpose. The price guard can only
        run on a complete answer, and streaming a wrong price that is corrected
        two seconds later is worse than waiting two seconds. A `meta` frame goes
        out immediately so the UI has something to render.
        """
        plan_intent = classify(message)
        yield "meta", {"intent": plan_intent.value}

        result = await self.answer(message, history)

        yield "token", result["answer"]
        if result.get("products"):
            yield "products", result["products"]

        preview = _first([p for p in result.get("products", []) if p.get("previewHref")])
        if preview:
            yield "preview", {
                "slug": preview["slug"],
                "title": preview["title"],
                "href": preview["href"],
                "previewHref": preview["previewHref"],
                "freePageCount": preview.get("freePageCount"),
                "cover": preview.get("image"),
            }

        yield "done", None


def _first(items: list | None):
    return items[0] if items else None


def _topic_of(message: str) -> str:
    """Strip the instruction verbs so what remains is the subject matter."""
    import re

    cleaned = re.sub(
        r"\b(?:solve|explain|derive|prove|define|answer|question|exercise|"
        r"what\s+is|how\s+do\s+i|teach\s+me|help\s+me\s+with|the|a|an|of|for|in)\b",
        " ",
        message or "",
        flags=re.IGNORECASE,
    )
    return re.sub(r"[^\w\s]", " ", cleaned).strip()
