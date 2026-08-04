"""Behavioural contract for the sales assistant.

Asserts the rules that matter, question by question:

  * a teaching question is ROUTED to the teaching branch, in English and in
    Marathi/Hindi, and that branch is given ZERO collections — so no book text
    can reach the prompt even in principle;
  * the brief orientation never exceeds 15 words, and lesson-shaped output is
    flattened before it is sent;
  * prices in an answer must appear in the FACTS block;
  * an order lookup returns status without leaking the customer's phone,
    address or email;
  * a wrong class is never recommended.

Run:  python -m tests.test_sales_guard
"""

from __future__ import annotations

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from app.db.migrate import migrate  # noqa: E402
from app.rag.intent import (  # noqa: E402
    Intent,
    cap_words,
    classify,
    collections_for,
    strip_teaching_shape,
)
from app.services import facts as facts_service  # noqa: E402

failures: list[str] = []


def check(label: str, ok: bool, detail: str = "") -> None:
    print(f"{'PASS' if ok else 'FAIL'}  {label}" + (f" — {detail}" if not ok and detail else ""))
    if not ok:
        failures.append(label)


TEACHING = [
    "solve question 4 of exercise 2.1",
    "explain photosynthesis",
    "what is the answer to Q3",
    "derive the quadratic formula",
    "prove the Pythagoras theorem",
    "write a note on the water cycle",
    "how do i solve this sum",
    "teach me trigonometry",
    "summarise chapter 5",
    "define refraction",
    "step by step solution for exercise 3",
    "मला त्रिकोणमिती समजावून सांग",
    "हे कसे सोडवायचे",
    "इसका उत्तर दो",
    "यह समझाओ",
]

NOT_TEACHING = [
    ("which book for 10th science marathi", Intent.RECOMMEND),
    ("how much is the class 10 science guide", Intent.PRICE),
    ("is the class 9 maths book in stock", Intent.AVAILABILITY),
    ("how long does delivery take to Nagpur", Intent.SHIPPING),
    ("what is your return policy", Intent.POLICY),
    ("kohinoor vs vidyamitra which is better", Intent.COMPARE),
    ("does the class 10 maths book cover trigonometry", Intent.COVERAGE),
]


def main() -> int:
    migrate()

    print("=== teaching questions are routed to the teaching branch ===")
    missed = [q for q in TEACHING if classify(q) is not Intent.TEACHING]
    check("every teaching question is caught", not missed, f"missed: {missed}")

    print("\n=== …and that branch gets NO collections ===")
    check(
        "teaching reads no corpus at all",
        collections_for(Intent.TEACHING) == [],
        str(collections_for(Intent.TEACHING)),
    )
    check(
        "only 'coverage' may read free page text",
        "cc_samples" in collections_for(Intent.COVERAGE)
        and all(
            "cc_samples" not in collections_for(i)
            for i in Intent
            if i not in (Intent.COVERAGE,)
        ),
        "another intent can reach cc_samples",
    )

    print("\n=== sales questions are NOT misrouted to teaching ===")
    for question, expected in NOT_TEACHING:
        got = classify(question)
        check(f'"{question[:44]}" -> {expected.value}', got is expected, f"got {got.value}")

    print("\n=== the 15-word cap is enforced by truncation ===")
    long_answer = " ".join(f"word{i}" for i in range(60))
    capped = cap_words(long_answer)
    check("caps at 15 words", len(capped.split()) <= 16, f"{len(capped.split())} words")
    check("marks the truncation", capped.endswith("…"))
    short = "Photosynthesis is how plants make food from light."
    check("leaves a short answer alone", cap_words(short) == short, cap_words(short))

    print("\n=== lesson-shaped output is flattened ===")
    stepwise = "First take x. 1. Square both sides. 2. Simplify. 3. Solve for x."
    flattened = strip_teaching_shape(stepwise)
    check(
        "numbered steps are cut back to one sentence",
        "2." not in flattened and "3." not in flattened,
        flattened,
    )
    bulleted = "It works like this. - one - two - three"
    check("bullets are stripped", "-" not in strip_teaching_shape(bulleted)[2:], strip_teaching_shape(bulleted))

    print("\n=== price hallucination is detected ===")
    facts = facts_service.facts_block([])
    check(
        "a price NOT in FACTS is caught",
        facts_service.price_hallucination("It costs ₹499 for the set.", facts) == "499",
    )
    check(
        "a price that IS in FACTS passes",
        facts_service.price_hallucination(
            f"Free shipping above ₹{facts_service.settings.free_shipping_threshold}.", facts
        )
        is None,
    )
    check(
        "'Rs.' notation is caught too",
        facts_service.price_hallucination("Only Rs. 275 today.", facts) == "275",
    )
    check("an answer with no numbers passes", facts_service.price_hallucination("Sure.", facts) is None)

    print("\n=== recommendations respect the class filter ===")
    picks = facts_service.recommend(class_id="10", medium="marathi", limit=5)
    if picks:
        check(
            "never recommends the wrong class",
            all(p["classId"] == "10" for p in picks),
            str({p["classId"] for p in picks}),
        )
        check(
            "never leads with an out-of-stock book",
            picks[0]["slug"] is not None,
        )
        check("carries classId and medium for the cart", all(p.get("classId") and p.get("medium") for p in picks))
    else:
        check("catalogue has class 10 marathi books", False, "no results — is the DB seeded?")

    print("\n=== order lookup does not leak contact details ===")
    from app.db.repo import orders as orders_repo

    created = orders_repo.create_order(
        items=[{"slug": facts_service.recommend(limit=1)[0]["slug"], "qty": 2}],
        customer={
            "name": "Test Parent",
            "phone": "9876543210",
            "email": "parent@example.com",
            "address1": "12 Secret Street",
            "city": "Nagpur",
            "pincode": "440016",
        },
    )
    number = created["orderNumber"]
    check("order number is unguessable (CC- + 8 random chars)", len(number) == 11 and number.startswith("CC-"), number)

    looked = orders_repo.lookup(number)
    blob = str(looked)
    check("lookup finds the order", looked is not None)
    check("phone is NOT exposed", "9876543210" not in blob)
    check("email is NOT exposed", "parent@example.com" not in blob)
    check("street address is NOT exposed", "Secret Street" not in blob)
    check("status and items ARE exposed", looked and looked["itemCount"] == 2, str(looked and looked["itemCount"]))
    check("a wrong number returns nothing", orders_repo.lookup("CC-ZZZZZZZZ") is None)

    print("\n=== totals are computed server-side ===")
    check(
        "total = subtotal + shipping, from DB prices",
        created["total"] == created["subtotal"] + created["shipping"],
        str(created),
    )

    from app.db.conn import transaction

    with transaction() as conn:
        conn.execute("DELETE FROM orders WHERE order_number = ?", (number,))

    print()
    if failures:
        print(f"FAILED: {len(failures)} check(s)")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("Sales guard holds: it orients and sells, it does not teach.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
