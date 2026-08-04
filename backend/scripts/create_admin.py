"""Create or update an admin user.

    python -m scripts.create_admin --email you@example.com
    python -m scripts.create_admin --email you@example.com --password '...'  # non-interactive
    python -m scripts.create_admin --list

The password is prompted for (hidden) unless passed explicitly. Passing it on
the command line puts it in your shell history — fine for a one-shot container
bootstrap, not for a laptop.
"""

from __future__ import annotations

import argparse
import getpass
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.db.conn import db_path  # noqa: E402
from app.db.migrate import migrate  # noqa: E402
from app.db.repo import admin as admin_repo  # noqa: E402

MIN_LENGTH = 8


def prompt_password() -> str:
    while True:
        first = getpass.getpass("Password: ")
        if len(first) < MIN_LENGTH:
            print(f"  Too short — at least {MIN_LENGTH} characters.")
            continue
        second = getpass.getpass("Confirm:  ")
        if first != second:
            print("  Those don't match.")
            continue
        return first


def main() -> int:
    parser = argparse.ArgumentParser(description="Create or update an admin user")
    parser.add_argument("--email")
    parser.add_argument("--password", help="Skip the prompt (ends up in shell history)")
    parser.add_argument("--name", default="")
    parser.add_argument("--role", default="admin", choices=["admin", "editor"])
    parser.add_argument("--list", action="store_true", help="List existing admins and exit")
    args = parser.parse_args()

    print(f"database: {db_path()}")
    migrate()

    if args.list:
        users = admin_repo.list_users()
        if not users:
            print("\nNo admin users yet. Create one with --email.")
            return 0
        print(f"\n{len(users)} admin user(s):")
        for u in users:
            state = "active" if u["is_active"] else "DISABLED"
            seen = u["last_login_at"] or "never"
            print(f"  {u['email']:<34} {u['role']:<8} {state:<9} last login: {seen}")
        return 0

    if not args.email:
        parser.error("--email is required (or use --list)")

    password = args.password or prompt_password()
    if len(password) < MIN_LENGTH:
        print(f"Password must be at least {MIN_LENGTH} characters.")
        return 1

    existing = admin_repo.get_user_by_email(args.email)
    if existing:
        admin_repo.set_password(args.email, password)
        print(f"\nUpdated the password for {args.email}.")
    else:
        admin_repo.create_user(args.email, password, args.name, args.role)
        print(f"\nCreated admin {args.email} ({args.role}).")

    print("\nSign in at /admin/login")
    print("NOTE: over plain HTTP this password crosses the network in cleartext.")
    print("      Set COOKIE_SECURE=true once TLS is in front of the service.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
