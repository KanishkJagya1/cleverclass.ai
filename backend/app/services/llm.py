"""LLM providers behind a two-method interface: complete() and stream().

The `echo` provider is not a toy — it lets the entire RAG stack, the SSE
transport and the frontend chat UI be developed and tested before anyone has
provisioned an API key, and it keeps CI free of network calls.
"""

from __future__ import annotations

import asyncio
import logging
import re
from typing import AsyncIterator, Protocol

from app.config import settings

log = logging.getLogger(__name__)


class LLM(Protocol):
    async def complete(self, system: str, prompt: str) -> str: ...
    def stream(self, system: str, prompt: str) -> AsyncIterator[str]: ...


class EchoLLM:
    """Extractive fallback: returns the most relevant sentences from context.

    Grounded by construction — it cannot hallucinate because it only ever
    repeats retrieved text.
    """

    @staticmethod
    def _summarise(prompt: str) -> str:
        context = ""
        if "CONTEXT:" in prompt and "CONVERSATION SO FAR:" in prompt:
            context = prompt.split("CONTEXT:", 1)[1].split("CONVERSATION SO FAR:", 1)[0]

        question = prompt.split("QUESTION:", 1)[-1].split("\n", 1)[0].strip().lower()
        keywords = {w for w in re.findall(r"\w+", question) if len(w) > 3}

        sentences = [
            s.strip()
            for s in re.split(r"(?<=[.!?])\s+", re.sub(r"\[[^\]]*\]|-{3,}", " ", context))
            if len(s.strip()) > 30
        ]
        if not sentences:
            return "I don't have that information to hand."

        ranked = sorted(
            sentences,
            key=lambda s: len(keywords & set(re.findall(r"\w+", s.lower()))),
            reverse=True,
        )
        return " ".join(ranked[:3])

    async def complete(self, system: str, prompt: str) -> str:
        return self._summarise(prompt)

    async def stream(self, system: str, prompt: str) -> AsyncIterator[str]:
        text = self._summarise(prompt)
        for word in text.split(" "):
            yield word + " "
            # Paced so the frontend's streaming UI is genuinely exercised.
            await asyncio.sleep(0.012)


class OpenAILLM:
    def __init__(self, api_key: str, model: str) -> None:
        from openai import AsyncOpenAI

        self._client = AsyncOpenAI(api_key=api_key)
        self._model = model

    async def complete(self, system: str, prompt: str) -> str:
        resp = await self._client.chat.completions.create(
            model=self._model,
            temperature=settings.temperature,
            max_tokens=settings.max_tokens,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": prompt},
            ],
        )
        return (resp.choices[0].message.content or "").strip()

    async def stream(self, system: str, prompt: str) -> AsyncIterator[str]:
        stream = await self._client.chat.completions.create(
            model=self._model,
            temperature=settings.temperature,
            max_tokens=settings.max_tokens,
            stream=True,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": prompt},
            ],
        )
        async for chunk in stream:
            delta = chunk.choices[0].delta.content
            if delta:
                yield delta


class GeminiLLM:
    """Gemini over plain HTTPS.

    Deliberately not the `google-generativeai` SDK: it is deprecated, it pulls
    grpc, and it adds ~40 MB to an image sharing a disk with another stack — to
    make one HTTP POST. The LMS service on this same box has called Gemini this
    way for months, against this same key.

    TWO GOTCHAS carried over from that project, both of which cost real time:

    1. `thinkingBudget: 0` is REJECTED with HTTP 400 by current flash models.
       `thinkingConfig` is therefore absent. Do not "optimise latency" by
       setting it to zero — that is how every call starts 400-ing.

    2. In the LMS, `TUTOR_GEMINI_MODEL` was declared in config, set in compose,
       and never passed to a call site, so the hardcoded default silently won
       for weeks. Here the model is passed explicitly at construction, logged
       at boot, and reported by /health.
    """

    ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"

    def __init__(self, api_key: str, model: str) -> None:
        self._key = api_key
        self._model_name = model
        log.info("Gemini provider ready (model=%s)", model)

    @property
    def model(self) -> str:
        return self._model_name

    def _call(self, system: str, prompt: str) -> str:
        import json
        import urllib.error
        import urllib.request

        generation_config: dict = {
            "temperature": settings.temperature,
            "maxOutputTokens": settings.max_tokens,
        }
        # Only ever sent when > 0. `thinkingBudget: 0` is rejected outright by
        # current flash models with HTTP 400 — verified against the live key, so
        # do not "optimise latency" by zeroing it. A positive value is a hint
        # that reduces thinking without disabling it.
        if settings.thinking_budget > 0:
            generation_config["thinkingConfig"] = {
                "thinkingBudget": settings.thinking_budget
            }

        body = json.dumps(
            {
                "systemInstruction": {"parts": [{"text": system}]},
                "contents": [{"role": "user", "parts": [{"text": prompt}]}],
                "generationConfig": generation_config,
            }
        ).encode("utf-8")

        request = urllib.request.Request(
            self.ENDPOINT.format(model=self._model_name),
            data=body,
            headers={"Content-Type": "application/json", "X-goog-api-key": self._key},
            method="POST",
        )

        try:
            with urllib.request.urlopen(request, timeout=45) as response:
                payload = json.loads(response.read())
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", "replace")[:400]
            log.error("Gemini HTTP %s: %s", exc.code, detail)
            raise RuntimeError(f"Gemini returned {exc.code}") from exc

        candidates = payload.get("candidates") or []
        if not candidates:
            # A safety block returns no candidate at all. Reading `.text`
            # unguarded here is what turns that into a 500 rather than a
            # graceful fallback.
            reason = (payload.get("promptFeedback") or {}).get("blockReason", "no candidates")
            log.warning("Gemini returned nothing (%s)", reason)
            return ""

        # Truncation must never be silent again. Hitting the ceiling returns a
        # perfectly well-formed 200 with an answer that simply stops mid-word,
        # and without this line the only way to notice is to read the replies.
        if candidates[0].get("finishReason") == "MAX_TOKENS":
            usage = payload.get("usageMetadata") or {}
            log.error(
                "Gemini hit maxOutputTokens (%s): %s thinking + %s answer tokens. "
                "The reply is cut mid-sentence — raise max_tokens.",
                settings.max_tokens,
                usage.get("thoughtsTokenCount"),
                usage.get("candidatesTokenCount"),
            )

        parts = (candidates[0].get("content") or {}).get("parts") or []
        return "".join(p.get("text", "") for p in parts).strip()

    async def complete(self, system: str, prompt: str) -> str:
        # urllib blocks; keep it off the event loop or one slow generation
        # stalls every other request on this single worker.
        return await asyncio.to_thread(self._call, system, prompt)

    async def stream(self, system: str, prompt: str) -> AsyncIterator[str]:
        """Yields the complete answer as one chunk.

        A choice, not a limitation. The sales pipeline runs its price guard on
        the FULL answer before any of it is shown — streaming a wrong price and
        correcting it two seconds later is worse than waiting two seconds.
        """
        yield await self.complete(system, prompt)


def build_llm() -> LLM:
    provider = settings.llm_provider

    if provider == "openai" and settings.openai_api_key:
        log.info("LLM: OpenAI %s", settings.openai_model)
        return OpenAILLM(settings.openai_api_key, settings.openai_model)

    if provider == "gemini" and settings.gemini_api_key:
        log.info("LLM: Gemini %s", settings.gemini_model)
        return GeminiLLM(settings.gemini_api_key, settings.gemini_model)

    if provider != "echo":
        log.warning("LLM provider %r selected but no API key set — using echo.", provider)

    return EchoLLM()
