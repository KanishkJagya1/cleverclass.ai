"""Role-based permissions for the admin panel.

Until now `admin_users.role` was **stored and never checked**. It appeared in
API responses and in the UI, which made it look like an access-control system,
but an `editor` could delete a book, change a price, read every customer's
address and create another admin. A role that is displayed but not enforced is
worse than no role at all — it produces false confidence during a handover.

DESIGN

  * **Permissions are the unit of authorisation, not roles.** Routes ask for
    `orders:write`, never `role == "admin"`. Adding a role then means adding one
    row to `ROLE_PERMISSIONS`; scattered role comparisons would mean auditing
    every route again.
  * **Deny by default.** An unknown role gets the empty set. A typo in the
    database locks that account out rather than silently granting everything.
  * **`super_admin` is the only role that can manage other admins.** That is the
    privilege-escalation boundary: without it, any admin could promote
    themselves, and the role system would be decorative.
"""

from __future__ import annotations

from fastapi import HTTPException

# ---------------------------------------------------------------- vocabulary --
#
# `<domain>:<action>`. Read is never implied by write — a support agent needs to
# read orders and write notes without touching prices.
BOOKS_READ = "books:read"
BOOKS_WRITE = "books:write"
ORDERS_READ = "orders:read"
ORDERS_WRITE = "orders:write"
# Separate from ORDERS_READ on purpose. Reading one order shows one customer's
# address; exporting shows EVERY customer's name, phone and home address in a
# single downloadable file. Support staff need the first and have no business
# with the second.
ORDERS_EXPORT = "orders:export"
PAYMENTS_VERIFY = "payments:verify"
CUSTOMERS_READ = "customers:read"
CUSTOMERS_WRITE = "customers:write"
LEADS_READ = "leads:read"
AUDIT_READ = "audit:read"
SETTINGS_WRITE = "settings:write"
ADMINS_MANAGE = "admins:manage"
CORPUS_WRITE = "corpus:write"

ALL_PERMISSIONS = frozenset(
    {
        BOOKS_READ, BOOKS_WRITE, ORDERS_READ, ORDERS_WRITE, ORDERS_EXPORT,
        PAYMENTS_VERIFY,
        CUSTOMERS_READ, CUSTOMERS_WRITE, LEADS_READ, AUDIT_READ, SETTINGS_WRITE,
        ADMINS_MANAGE, CORPUS_WRITE,
    }
)

ROLES = ("super_admin", "admin", "store_manager", "support", "editor")

ROLE_PERMISSIONS: dict[str, frozenset[str]] = {
    # The owner. The only role that can create or demote other admins.
    "super_admin": ALL_PERMISSIONS,
    # Runs the shop day to day. Everything except changing who has access.
    "admin": ALL_PERMISSIONS - {ADMINS_MANAGE},
    # Catalogue, stock, orders and dispatch. No customer data exports, no
    # settings, no admin management.
    "store_manager": frozenset(
        {BOOKS_READ, BOOKS_WRITE, ORDERS_READ, ORDERS_WRITE, ORDERS_EXPORT,
         PAYMENTS_VERIFY, CUSTOMERS_READ, LEADS_READ, CORPUS_WRITE}
    ),
    # Answers customers. Reads orders and customers, annotates orders, never
    # changes a price or a payment.
    "support": frozenset({ORDERS_READ, CUSTOMERS_READ, LEADS_READ, BOOKS_READ}),
    # Content only: descriptions, key notes, free page ranges. Deliberately no
    # ORDERS_READ — order history is customer PII, and a copywriter has no
    # business in it.
    "editor": frozenset({BOOKS_READ, BOOKS_WRITE, CORPUS_WRITE}),
}


def permissions_for(role: str | None) -> frozenset[str]:
    """Deny by default: an unrecognised role gets nothing."""
    return ROLE_PERMISSIONS.get(role or "", frozenset())


def has_permission(admin: dict, permission: str) -> bool:
    return permission in permissions_for(admin.get("role"))


def check(admin: dict, permission: str) -> None:
    """Raise 403 unless `admin` holds `permission`.

    The FastAPI dependency that wraps this lives in `admin_routes`, next to the
    session and CSRF dependencies it composes with. Keeping the rule itself here
    — operating on a plain dict — means it is unit-testable without spinning up
    an app, and this module never imports the API layer.
    """
    if permission not in ALL_PERMISSIONS:
        # A typo'd permission string would otherwise silently deny everyone, or
        # worse, be a check nobody notices is missing.
        raise ValueError(f"unknown permission: {permission!r}")

    if not has_permission(admin, permission):
        raise HTTPException(
            status_code=403,
            # Names the missing permission deliberately: the caller is an
            # authenticated member of staff, and "you need orders:write" is
            # actionable where a bare "forbidden" starts a support ticket.
            detail=f"Your role ({admin.get('role')}) does not allow {permission}.",
        )
