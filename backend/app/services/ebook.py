"""E-book delivery: personalised, watermarked, traceable.

WHAT THIS DOES AND DOES NOT DO — worth being plain about, because "copy
protected" invites an assumption this cannot meet.

It CANNOT stop a determined person copying the book. Any PDF a customer can
read can be screenshotted, re-printed to PDF, or run through a stripper; real
DRM needs a proprietary reader and a licence server, which is a different
product and a worse experience for every honest buyer.

What it does instead is make sharing **attributable**, which is what actually
deters it:

  * every delivered copy is stamped, on every page, with the buyer's name,
    email, order number and the date — a leaked file names the leaker;
  * the file is built per order, never served from a shared path, so there is
    no URL that can be passed around;
  * downloads are counted and capped, so a link cannot become a mirror;
  * PDF permission flags are set against casual copy-paste and editing.

The permission flags are the weakest layer and are treated as such: they stop
the accidental, not the motivated. The watermark is the part that works,
because it changes the incentive rather than the capability.
"""

from __future__ import annotations

import datetime as dt
import logging
import secrets
from pathlib import Path

from app.db.conn import query, query_one, transaction
from app.services import storage

log = logging.getLogger(__name__)

# Generous enough for re-downloads across devices and a lost file, low enough
# that the link is not a distribution channel.
MAX_DOWNLOADS = 12

# Only these mean "paid for and not reversed". A digital line on a cancelled or
# refunded order must stop downloading.
_ENTITLING_STATUSES = (
    "confirmed", "processing", "packed", "shipped", "out_for_delivery",
    "delivered",
)


class EbookError(RuntimeError):
    pass


def _now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


# --------------------------------------------------------------------------
# Entitlement
# --------------------------------------------------------------------------

def entitlements(customer_id: str) -> list[dict]:
    """Every e-book this customer may download, derived from their orders.

    Matched on `customer_id` or the account's VERIFIED email, mirroring order
    history — someone who bought as a guest and later registered with the same
    (verified) address keeps their downloads.
    """
    customer = query_one("SELECT * FROM customers WHERE id = ?", (customer_id,))
    if customer is None:
        return []

    marks = ",".join("?" * len(_ENTITLING_STATUSES))
    if customer["email_verified_at"]:
        where = "(o.customer_id = ? OR LOWER(o.email) = ?)"
        params: list = [customer_id, customer["email_norm"]]
    else:
        where = "o.customer_id = ?"
        params = [customer_id]

    rows = query(
        f"SELECT o.order_number, o.id AS order_id, o.created_at, oi.slug,"
        f"       oi.title, b.id AS book_id,"
        f"       (SELECT COUNT(*) FROM ebook_downloads d"
        f"         WHERE d.order_number = o.order_number AND d.slug = oi.slug)"
        f"         AS downloads,"
        f"       (SELECT COUNT(*) FROM book_assets a"
        f"         WHERE a.book_id = b.id AND a.is_current = 1) AS has_file"
        f"  FROM order_items oi"
        f"  JOIN orders o ON o.id = oi.order_id"
        f"  LEFT JOIN books b ON b.slug = oi.slug"
        f" WHERE {where} AND oi.delivery = 'digital'"
        f"   AND o.status IN ({marks})"
        f" ORDER BY o.created_at DESC",
        [*params, *_ENTITLING_STATUSES],
    )

    return [
        {
            "orderNumber": r["order_number"],
            "slug": r["slug"],
            "title": r["title"],
            "purchasedAt": r["created_at"],
            "downloads": r["downloads"],
            "maxDownloads": MAX_DOWNLOADS,
            # Surfaced rather than hidden: a customer who paid for a download
            # that is not ready yet needs to be told that, not shown a button
            # that fails.
            "ready": bool(r["has_file"]),
            "downloadsLeft": max(0, MAX_DOWNLOADS - r["downloads"]),
        }
        for r in rows
    ]


def _entitlement_row(order_number: str, slug: str) -> dict | None:
    marks = ",".join("?" * len(_ENTITLING_STATUSES))
    return query_one(
        f"SELECT o.id AS order_id, o.order_number, o.customer_id, o.email,"
        f"       o.customer_name, o.status, oi.slug, oi.title, b.id AS book_id"
        f"  FROM order_items oi"
        f"  JOIN orders o ON o.id = oi.order_id"
        f"  LEFT JOIN books b ON b.slug = oi.slug"
        f" WHERE o.order_number = ? AND oi.slug = ? AND oi.delivery = 'digital'"
        f"   AND o.status IN ({marks})",
        (order_number, slug, *_ENTITLING_STATUSES),
    )


# --------------------------------------------------------------------------
# Delivery
# --------------------------------------------------------------------------

def prepare_download(
    order_number: str,
    slug: str,
    *,
    customer_id: str | None,
    ip: str | None = None,
    user_agent: str | None = None,
) -> tuple[Path, str]:
    """Build this buyer's watermarked copy and record the download.

    Returns `(path, filename)`. Raises EbookError with a message meant for the
    customer.
    """
    row = _entitlement_row(order_number, slug)
    if row is None:
        # Same message whether the order does not exist, is not theirs, or was
        # cancelled — probing order numbers should not reveal which.
        raise EbookError("We could not find that download on your account.")

    # Ownership: the signed-in account must own the order. Guests reach their
    # downloads through the order-number flow, which is checked by the caller.
    if customer_id and row["customer_id"] and row["customer_id"] != customer_id:
        raise EbookError("We could not find that download on your account.")

    taken = query_one(
        "SELECT COUNT(*) n FROM ebook_downloads"
        " WHERE order_number = ? AND slug = ?",
        (order_number, slug),
    )["n"]
    if taken >= MAX_DOWNLOADS:
        raise EbookError(
            f"This download has been used {taken} times, which is the limit. "
            "Contact us and we will help."
        )

    asset = query_one(
        "SELECT storage_path FROM book_assets"
        " WHERE book_id = ? AND is_current = 1",
        (row["book_id"],),
    )
    if asset is None:
        raise EbookError(
            "That book's file is not ready yet. We will email you as soon as it is."
        )

    source = storage.absolute(asset["storage_path"])
    if not source.exists():
        log.error("E-book file missing for %s (%s)", slug, asset["storage_path"])
        raise EbookError("That file is temporarily unavailable. Please contact us.")

    buyer = row["customer_name"] or "Licensed copy"
    email = row["email"] or ""
    stamp = f"{buyer} · {email} · {order_number} · {dt.date.today().isoformat()}"

    out = _watermarked_copy(source, stamp, order_number, slug)

    with transaction() as conn:
        conn.execute(
            "INSERT INTO ebook_downloads (id, order_id, order_number, slug,"
            " customer_id, ip, user_agent, created_at) VALUES (?,?,?,?,?,?,?,?)",
            (f"dl_{secrets.token_hex(8)}", row["order_id"], order_number, slug,
             customer_id, ip, (user_agent or "")[:300], _now()),
        )

    safe = "".join(c for c in slug if c.isalnum() or c in "-_") or "ebook"
    return out, f"{safe}.pdf"


def _watermarked_copy(source: Path, stamp: str, order_number: str, slug: str) -> Path:
    """Stamp every page with the buyer's identity and save a per-order copy.

    Cached per (order, book): the stamp is identical for every download of the
    same purchase, and re-rendering a 300-page PDF on each click is a cheap way
    to exhaust two vCPUs.
    """
    import fitz

    target = storage.ebook_path(order_number, slug)
    if target.exists():
        return target

    doc = fitz.open(str(source))
    try:
        for page in doc:
            rect = page.rect
            # Diagonal repeat: hard to crop out, easy to read in a screenshot.
            for row in range(0, int(rect.height), 200):
                pivot = fitz.Point(30, row + 100)
                # `rotate=` only accepts 0/90/180/270; an arbitrary angle has
                # to go through `morph`. Passing 45 raises "bad rotate value",
                # which is exactly how the preview watermark came to be
                # silently disabled for months.
                page.insert_text(
                    pivot,
                    stamp,
                    fontsize=11,
                    morph=(pivot, fitz.Matrix(45)),
                    color=(0.55, 0.55, 0.62),
                    fill_opacity=0.14,
                    overlay=True,
                )
            page.insert_textbox(
                fitz.Rect(0, rect.height - 24, rect.width, rect.height - 6),
                f"Licensed to {stamp} — not for redistribution",
                fontsize=7.5,
                align=1,
                color=(0.42, 0.42, 0.5),
                overlay=True,
            )

        # The weak layer, and treated as such. An owner password with copy and
        # modify disabled stops casual copy-paste in a normal reader; it does
        # not stop anyone who wants to strip it, and nothing available here
        # would. The watermark above is the part that actually deters sharing.
        doc.save(
            str(target),
            encryption=fitz.PDF_ENCRYPT_AES_256,
            owner_pw=secrets.token_urlsafe(24),
            # No user password: the buyer must be able to open their book
            # without a second credential to lose.
            user_pw="",
            permissions=int(
                fitz.PDF_PERM_ACCESSIBILITY | fitz.PDF_PERM_PRINT
            ),
            garbage=3,
            deflate=True,
        )
    finally:
        doc.close()

    storage.harden(target)
    return target


def download_history(order_number: str, slug: str) -> list[dict]:
    """Who took this file and when — the evidence trail for a leak."""
    return [
        {
            "at": r["created_at"],
            "ip": r["ip"],
            "customerId": r["customer_id"],
        }
        for r in query(
            "SELECT created_at, ip, customer_id FROM ebook_downloads"
            " WHERE order_number = ? AND slug = ? ORDER BY created_at DESC",
            (order_number, slug),
        )
    ]
