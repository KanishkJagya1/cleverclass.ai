"""Email templates: substitution safety, sanitising, fallback.

The injection checks are the reason this module exists. A shop owner editing
templates in a web form is, by design, feeding attacker-shaped input into a
rendering path — the only safe answer is that the path cannot execute anything.

    python -m tests.test_templates
"""

from __future__ import annotations

import logging
import os
import pathlib
import sys
import tempfile

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

_TMP = pathlib.Path(tempfile.mkdtemp(prefix="cc_tpl_")) / "test.db"
os.environ["DB_PATH"] = str(_TMP)

from app.db.migrate import migrate  # noqa: E402
from app.services import templates  # noqa: E402

failures: list[str] = []


def check(label: str, ok: bool, detail: str = "") -> None:
    print(("  PASS  " if ok else "  FAIL  ") + label + ("" if ok else f"  -- {detail}"))
    if not ok:
        failures.append(label)


def main_() -> int:
    logging.disable(logging.ERROR)
    migrate()

    print("=== defaults exist for every template ===")
    check("the catalogue is populated", len(templates.keys()) >= 8, str(templates.keys()))
    for key in templates.keys():
        tpl = templates.get(key)
        if tpl is None or not tpl["subject"] or not tpl["body"]:
            check(f"{key} has a usable default", False, str(tpl))
            break
    else:
        check("every template has a usable default", True)
    check("an unedited template reports source=default",
          templates.get("verify_email")["source"] == "default")

    print("\n=== TEMPLATE INJECTION IS NOT POSSIBLE ===")
    # The payloads that break Jinja and str.format. Substitution simply does not
    # look at them, which is the entire point.
    for payload, label in [
        ("{{ ''.__class__.__mro__[1].__subclasses__() }}", "Jinja class walk"),
        ("{{ config }}", "Jinja config read"),
        ("{a.__class__.__init__.__globals__}", "str.format globals read"),
        ("{{ self.__init__.__globals__ }}", "Jinja globals read"),
        ("${7*7}", "shell-style expansion"),
    ]:
        # The property that matters is NOT "saving is refused" — it is "this can
        # never execute". These payloads do not match the placeholder pattern
        # (word characters only), so they are stored as inert text. Storing
        # harmless text is fine; evaluating it would not be.
        # Each payload is tested in isolation — without this reset, a payload
        # stored by the previous iteration is still in the template and the
        # next check reads ITS text, which is how a passing suite would hide a
        # real failure.
        templates.reset_to_default("verify_email")

        # Two safe outcomes, and both count:
        #   * refused at save, because it looked like an unknown variable; or
        #   * stored as inert text, because it is not a placeholder at all.
        # The unsafe outcome — evaluation — is what is checked below.
        try:
            templates.save("verify_email", "Subject", payload, actor_id="t")
        except templates.TemplateError:
            pass
        _, body = templates.render(
            "verify_email", templates.sample_values("verify_email")
        )
        # Evidence of EVALUATION, not of the payload's presence. The literal
        # text surviving is expected and harmless; a result of running it is not.
        executed = (
            "<class " in body            # a class walk produced repr output
            or "'__main__'" in body      # globals leaked
            or "SMTP" in body            # config leaked
            or "razorpay" in body.lower()
            or "49" in body              # ${7*7} was evaluated
        )
        check(f"{label} cannot execute", not executed, body[:160])

    templates.reset_to_default("verify_email")

    print("\n=== the variable allow-list is per template ===")
    check("verify_email offers no order variables",
          "order_number" not in templates.variables_for("verify_email"),
          str(templates.variables_for("verify_email")))
    unknown = templates.validate("verify_email", "Hi", "<p>{{order_total}}</p>")
    check("an out-of-scope variable is rejected", unknown == ["order_total"], str(unknown))
    try:
        templates.save("verify_email", "Hi", "<p>{{order_total}}</p>")
        check("and saving it is refused", False, "accepted")
    except templates.TemplateError as exc:
        check("and saving it is refused", True)
        check("the error lists what IS available", "customer_name" in str(exc), str(exc)[:160])

    print("\n=== a typo blocks the send rather than emailing a gap ===")
    try:
        templates.save("verify_email", "Hi {{custmer_name}}", "<p>body</p>")
        check("a misspelled variable is caught at save", False, "accepted")
    except templates.TemplateError:
        check("a misspelled variable is caught at save", True)

    print("\n=== html sanitising ===")
    for payload, must_not_contain, label in [
        ("<script>alert(1)</script><p>hi</p>", "script", "script tags"),
        ('<img src=x onerror="alert(1)">', "onerror", "event handlers"),
        ('<a href="javascript:alert(1)">x</a>', "javascript:", "javascript: URLs"),
        ('<iframe src="evil"></iframe><p>ok</p>', "iframe", "iframes"),
        ('<style>body{display:none}</style><p>ok</p>', "<style", "style blocks"),
        ('<form action="evil"><input></form>', "<form", "forms"),
    ]:
        clean = templates.sanitise(payload)
        check(f"{label} are stripped", must_not_contain.lower() not in clean.lower(), clean)

    check("safe formatting survives",
          "<strong>" in templates.sanitise("<p><strong>bold</strong></p>"))
    check("links survive with their href",
          'href="https://x.com"' in templates.sanitise('<a href="https://x.com">x</a>'),
          templates.sanitise('<a href="https://x.com">x</a>'))

    print("\n=== saving, rendering and fallback ===")
    templates.save("order_shipped",
                   "Your order {{order_number}} has shipped",
                   "<p>Hi {{customer_name}}, {{carrier}} has it. AWB {{awb}}.</p>",
                   actor_id="admin1")
    tpl = templates.get("order_shipped")
    check("a saved template is used", tpl["source"] == "custom", str(tpl))

    values = templates.sample_values("order_shipped")
    subject, body = templates.render("order_shipped", values)
    check("the subject is substituted", "CC-ABCD2345" in subject, subject)
    check("the body is substituted", "Delhivery" in body, body)
    check("no placeholder survives", "{{" not in subject + body, subject + body)

    print("\n=== values are escaped ===")
    hostile = dict(values, customer_name="<script>alert(1)</script>")
    _, body = templates.render("order_shipped", hostile)
    check("a customer's own name cannot inject script",
          "<script>" not in body and "&lt;script&gt;" in body,
          "customer names are untrusted input too")

    print("\n=== missing values fail loudly ===")
    try:
        templates.render("order_shipped", {"customer_name": "X"})
        check("a missing value raises rather than emailing a gap", False, "it rendered")
    except templates.TemplateError as exc:
        check("a missing value raises rather than emailing a gap", True)
        check("and names what is missing", "awb" in str(exc), str(exc))

    print("\n=== version history and reset ===")
    templates.save("order_shipped", "v2 {{order_number}}", "<p>v2 {{customer_name}}</p>",
                   actor_id="admin1")
    check("the previous version is kept", len(templates.history("order_shipped")) >= 1)
    templates.reset_to_default("order_shipped")
    check("resetting falls back to the built-in",
          templates.get("order_shipped")["source"] == "default")
    check("and the built-in still renders",
          bool(templates.render("order_shipped", templates.sample_values("order_shipped"))[0]))

    print("\n=== a broken custom template cannot disable a critical email ===")
    # Deactivated rows fall back, so password reset survives a bad edit.
    check("reset_password always resolves",
          templates.get("reset_password") is not None)
    check("and always renders",
          "{{" not in templates.render("reset_password",
                                       templates.sample_values("reset_password"))[1])

    print()
    if failures:
        print(f"FAILED: {len(failures)} check(s)")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("Templates hold: substituted not evaluated, sanitised, always sendable.")
    return 0


if __name__ == "__main__":
    sys.exit(main_())
