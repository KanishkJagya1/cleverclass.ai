"""Intent routing for the sales assistant.

The rule this file enforces: **orient, then sell — never teach.**

A "teaching" question (solve this, explain that, what is the answer to Q4) gets
a ONE-LINE orientation of at most 15 words, then a pivot to the book that
covers it. It never gets a lesson, and it never gets book content.

Where the brief answer comes from, and why it matters
----------------------------------------------------
From the model's own general knowledge, with NO book context in the prompt at
all. Not from the free pages, and certainly not from the paid ones — the corpus
physically does not contain locked text (see `app/rag/corpus.py`).

That is the point. Because the model is never handed book content for this
branch, there is nothing for it to leak, even if the prompt were jailbroken. A
one-line definition of photosynthesis is not this publisher's intellectual
property; the worked solutions in Chapter 4 are, and those stay in the book.

The 15-word cap is applied IN CODE. A model asked to be brief is brief most of
the time, and "most of the time" is not a limit.
"""

from __future__ import annotations

import logging
import re
from enum import Enum

log = logging.getLogger(__name__)

# Hard ceiling on the orientation line. Enforced by truncation, not by asking.
MAX_BRIEF_WORDS = 15


class Intent(str, Enum):
    RECOMMEND = "recommend"        # "which book for 10th science marathi"
    PRICE = "price"                # "how much is X"
    AVAILABILITY = "availability"  # "is X in stock"
    COVERAGE = "coverage"          # "does X cover trigonometry"
    COMPARE = "compare"            # "kohinoor vs vidyamitra"
    SHIPPING = "shipping"
    POLICY = "policy"
    ORDER = "order"                # existing order, handed to a human
    TEACHING = "teaching"          # brief orientation + pivot to the book
    OTHER = "other"


# Deterministic detector, run BEFORE any retrieval and impossible to bypass with
# a cleverly-worded prompt, because it never reaches the model.
#
# Devanagari included: this audience asks in Marathi and Hindi at least as often
# as in English, and an English-only regex would let every one of those through.
TEACHING_PATTERNS = re.compile(
    r"\b(?:"
    r"solve|solution\s+(?:to|of|for)|answer\s+(?:to|of|for)|"
    r"explain|derive|prove|define|definition\s+of|summari[sz]e|"
    r"what\s+is\s+(?:the\s+)?(?:meaning|answer|value|formula)|"
    r"write\s+(?:a\s+)?(?:note|essay|paragraph)\s+on|translate|"
    r"question\s+(?:no\.?|number)?\s*\d|exercise\s*\d|q\.?\s*\d\b|"
    r"theorem|formula\s+for|step[-\s]?by[-\s]?step|"
    r"how\s+do\s+i\s+(?:solve|calculate|find|prove)|"
    r"teach\s+me|help\s+me\s+(?:solve|understand|with)"
    r")\b"
    r"|(?:सोडवा|स्पष्ट\s*करा|उत्तर\s*द्या|व्याख्या|सिद्ध\s*करा|समजाव|"
    r"शिकवा|कसे\s*सोडव|हल\s*करो|समझाओ|उत्तर\s*दो|बताओ)",
    re.IGNORECASE | re.UNICODE,
)

# Existing behaviour, kept: a question about an order someone already placed is
# a human's job, not a bot's.
ORDER_PATTERNS = re.compile(
    r"\b(?:my\s+order|order\s+(?:id|number|status|#)|where\s+is\s+my|"
    r"track(?:ing)?\s+(?:my\s+)?(?:order|parcel|shipment)|"
    r"refund|cancel\s+(?:my\s+)?order|return\s+(?:my|this)\s+)",
    re.IGNORECASE,
)

PRICE_PATTERNS = re.compile(
    r"\b(?:price|cost|how\s+much|rate|mrp|discount|कितन|किंमत|भाव)\b", re.IGNORECASE
)
STOCK_PATTERNS = re.compile(
    r"\b(?:in\s+stock|available|availability|out\s+of\s+stock|उपलब्ध)\b", re.IGNORECASE
)
SHIPPING_PATTERNS = re.compile(
    r"\b(?:deliver|delivery|shipping|courier|dispatch|how\s+long.*(?:arrive|reach))\b",
    re.IGNORECASE,
)
POLICY_PATTERNS = re.compile(
    r"\b(?:return\s+policy|refund\s+policy|exchange|warranty|guarantee|"
    r"about\s+(?:you|your\s+company)|who\s+are\s+you)\b",
    re.IGNORECASE,
)
COVERAGE_PATTERNS = re.compile(
    r"\b(?:cover|covers|include|includes|contain|contains|"
    r"chapter|syllabus|topics?|is\s+there\s+a\s+chapter)\b",
    re.IGNORECASE,
)
COMPARE_PATTERNS = re.compile(
    r"\b(?:vs\.?|versus|compare|difference\s+between|better|which\s+one)\b",
    re.IGNORECASE,
)


def classify(message: str) -> Intent:
    """Deterministic classification. No model call, so it cannot be talked out of.

    Order matters. Teaching is checked FIRST: "solve question 4 from the science
    book" also matches the coverage patterns, and the teaching branch is the one
    with the guardrails.
    """
    text = (message or "").strip()
    if not text:
        return Intent.OTHER

    if TEACHING_PATTERNS.search(text):
        return Intent.TEACHING
    if ORDER_PATTERNS.search(text):
        return Intent.ORDER
    if PRICE_PATTERNS.search(text):
        return Intent.PRICE
    if STOCK_PATTERNS.search(text):
        return Intent.AVAILABILITY
    if SHIPPING_PATTERNS.search(text):
        return Intent.SHIPPING
    if POLICY_PATTERNS.search(text):
        return Intent.POLICY
    if COMPARE_PATTERNS.search(text):
        return Intent.COMPARE
    if COVERAGE_PATTERNS.search(text):
        return Intent.COVERAGE
    return Intent.RECOMMEND if len(text.split()) > 2 else Intent.OTHER


def collections_for(intent: Intent) -> list[str]:
    """Which corpora this intent may read.

    `cc_samples` — free page text — is reachable from exactly one intent, and
    even then only as supporting evidence for "does it cover X". TEACHING gets
    an EMPTY list: that branch is answered from general knowledge with no book
    context whatsoever, which is what makes it impossible for it to leak.
    """
    from app.vector_db.store import MARKETING, POLICY, SAMPLES

    if intent is Intent.TEACHING:
        return []
    if intent is Intent.COVERAGE:
        return [MARKETING, SAMPLES]
    if intent in (Intent.SHIPPING, Intent.POLICY, Intent.ORDER):
        return [POLICY]
    return [POLICY, MARKETING]


def cap_words(text: str, limit: int = MAX_BRIEF_WORDS) -> str:
    """Truncate to `limit` words at a word boundary.

    The prompt also asks for brevity; this is what makes it true. A model under
    pressure to be helpful will happily write a paragraph, and a paragraph is
    exactly the shape of the thing we promised not to produce.
    """
    words = (text or "").strip().split()
    if len(words) <= limit:
        return " ".join(words)
    clipped = " ".join(words[:limit]).rstrip(",;:—-")
    return f"{clipped}…"


def strip_teaching_shape(text: str) -> str:
    """Flatten anything that has become a lesson rather than a sentence.

    Numbered steps, bullet lists and worked examples are the shapes a solution
    takes. If one appears in the brief answer, keep only the first sentence —
    the model has drifted past what this branch is for.
    """
    cleaned = re.sub(r"\s+", " ", (text or "").strip())
    if re.search(r"(?:^|\s)(?:\d+[.)]\s|[-•*]\s|step\s*\d)", cleaned, re.IGNORECASE):
        cleaned = re.split(r"(?<=[.!?])\s", cleaned)[0]
    return cleaned
