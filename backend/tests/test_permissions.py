"""Admin role enforcement.

Before this, `admin_users.role` was stored, displayed in the UI and API, and
**never checked** — an `editor` could delete books, change prices, read every
customer's address and create another admin. This suite exists so that cannot
regress quietly: a role that is shown but not enforced looks like access control
during a handover while providing none.

    python -m tests.test_permissions
"""

from __future__ import annotations

import logging
import os
import pathlib
import sys
import tempfile

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

_TMP = pathlib.Path(tempfile.mkdtemp(prefix="cc_perms_")) / "test.db"
os.environ["DB_PATH"] = str(_TMP)

from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
from app.db.migrate import migrate  # noqa: E402
from app.db.repo import admin as admin_repo  # noqa: E402
from app.services import permissions  # noqa: E402

failures: list[str] = []


def check(label: str, ok: bool, detail: str = "") -> None:
    print(("  PASS  " if ok else "  FAIL  ") + label + ("" if ok else f"  -- {detail}"))
    if not ok:
        failures.append(label)


def sign_in(client: TestClient, email: str, password: str) -> str:
    """Returns the CSRF token; the session cookie stays in the client jar."""
    r = client.post("/admin-api/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return r.json()["csrfToken"]


def main_() -> int:
    logging.disable(logging.WARNING)
    migrate()

    # The first account becomes super_admin via migration 003.
    admin_repo.create_user("owner@x.com", "ownerpassword1", "Owner", role="super_admin")
    admin_repo.create_user("ed@x.com", "editorpassword1", "Ed", role="editor")
    admin_repo.create_user("sup@x.com", "supportpassword1", "Sup", role="support")

    print("=== the matrix is deny-by-default ===")
    check("unknown role gets nothing", permissions.permissions_for("nonsense") == frozenset())
    check("missing role gets nothing", permissions.permissions_for(None) == frozenset())
    check(
        "only super_admin can manage staff",
        permissions.has_permission({"role": "super_admin"}, permissions.ADMINS_MANAGE)
        and not permissions.has_permission({"role": "admin"}, permissions.ADMINS_MANAGE),
    )
    check(
        "editor cannot read orders (customer PII)",
        not permissions.has_permission({"role": "editor"}, permissions.ORDERS_READ),
    )
    check(
        "support cannot write books",
        not permissions.has_permission({"role": "support"}, permissions.BOOKS_WRITE),
    )

    print("\n=== editor is confined to content ===")
    editor = TestClient(main.app)
    csrf = sign_in(editor, "ed@x.com", "editorpassword1")
    r = editor.get("/admin-api/books")
    check("editor CAN list books", r.status_code == 200, r.text[:120])
    r = editor.get("/admin-api/orders")
    check("editor CANNOT read orders", r.status_code == 403, f"{r.status_code} {r.text[:120]}")
    check("the 403 explains what is missing", "orders:read" in r.text, r.text[:160])
    r = editor.get("/admin-api/staff")
    check("editor CANNOT list staff", r.status_code == 403, str(r.status_code))
    r = editor.post(
        "/admin-api/staff",
        json={"email": "sneak@x.com", "name": "S", "password": "sneakpassword1", "role": "super_admin"},
        headers={"X-CSRF-Token": csrf},
    )
    check("editor CANNOT create a super admin", r.status_code == 403, str(r.status_code))

    print("\n=== support reads, never writes ===")
    support = TestClient(main.app)
    scsrf = sign_in(support, "sup@x.com", "supportpassword1")
    check("support CAN read orders", support.get("/admin-api/orders").status_code == 200)
    r = support.post(
        "/admin-api/books/anything/status",
        json={"status": "archived"},
        headers={"X-CSRF-Token": scsrf},
    )
    check("support CANNOT change a book", r.status_code == 403, str(r.status_code))

    print("\n=== super_admin manages staff, but cannot strand the system ===")
    owner = TestClient(main.app)
    ocsrf = sign_in(owner, "owner@x.com", "ownerpassword1")
    r = owner.get("/admin-api/staff")
    check("super_admin CAN list staff", r.status_code == 200, r.text[:120])
    body = r.json()
    check("role catalogue is exposed for the UI", len(body.get("roles", [])) == len(permissions.ROLES))

    ed_id = next(s["id"] for s in body["staff"] if s["email"] == "ed@x.com")
    own_id = next(s["id"] for s in body["staff"] if s["email"] == "owner@x.com")

    r = owner.post(
        f"/admin-api/staff/{ed_id}/role",
        json={"role": "store_manager"},
        headers={"X-CSRF-Token": ocsrf},
    )
    check("super_admin CAN change another role", r.status_code == 200, r.text[:120])

    # The two lockout guards. Both of these end with a deployment that cannot
    # manage its own accounts, recoverable only by hand-editing SQL on the box.
    r = owner.post(
        f"/admin-api/staff/{own_id}/role",
        json={"role": "editor"},
        headers={"X-CSRF-Token": ocsrf},
    )
    check("super_admin CANNOT demote themselves", r.status_code == 400, f"{r.status_code} {r.text[:120]}")

    r = owner.post(
        f"/admin-api/staff/{own_id}/active",
        json={"active": False},
        headers={"X-CSRF-Token": ocsrf},
    )
    check("super_admin CANNOT disable themselves", r.status_code == 400, str(r.status_code))

    r = owner.post(
        f"/admin-api/staff/{ed_id}/role",
        json={"role": "root"},
        headers={"X-CSRF-Token": ocsrf},
    )
    check("an invented role is rejected", r.status_code == 422, str(r.status_code))

    print("\n=== disabling staff ends access immediately ===")
    r = owner.post(
        f"/admin-api/staff/{ed_id}/active",
        json={"active": False},
        headers={"X-CSRF-Token": ocsrf},
    )
    check("super_admin CAN disable an account", r.status_code == 200, r.text[:120])
    check(
        "the disabled account's live session stops working at once",
        editor.get("/admin-api/books").status_code == 401,
        "a revoked account kept working until its cookie expired",
    )

    print("\n=== CSRF is still enforced alongside permissions ===")
    r = owner.post(
        f"/admin-api/staff/{ed_id}/role", json={"role": "editor"}
    )  # no CSRF header
    check("a write without CSRF is refused", r.status_code == 403, str(r.status_code))

    print()
    if failures:
        print(f"FAILED: {len(failures)} check(s)")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("Admin roles are enforced, not decorative.")
    return 0


if __name__ == "__main__":
    sys.exit(main_())
