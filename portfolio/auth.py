"""Accounts, passwords and invites.

Two roles: "admin" (the fund team, sees everything) and "founder" (tied to one company and
sees only that company). Founders get a single-use invite link and choose their own password;
the fund never sees or sets founders' passwords.

Pure functions over the database, with no Streamlit, so they can be unit tested.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
from dataclasses import dataclass
from functools import cache
from datetime import datetime, timedelta
from pathlib import Path

import pandas as pd

from portfolio import db

ROLES = ("admin", "founder")
MIN_PASSWORD_LENGTH = 10
MAX_FAILED_LOGINS = 5
LOCKOUT = timedelta(minutes=15)
INVITE_LIFETIME = timedelta(days=14)

# scrypt cost parameters (RFC 7914 interactive-login recommendation).
_SCRYPT = dict(n=2**14, r=8, p=1, dklen=32)


class AuthError(ValueError):
    """A login, invite or account problem with a message safe to show to the person."""


@dataclass(frozen=True)
class User:
    id: int
    email: str
    name: str
    role: str
    company_id: int | None

    @property
    def is_admin(self) -> bool:
        return self.role == "admin"


# --- Passwords ------------------------------------------------------------------


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, **_SCRYPT)
    return f"scrypt${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str | None) -> bool:
    if not stored:
        return False
    try:
        scheme, salt, digest = stored.split("$")
    except ValueError:
        return False
    if scheme != "scrypt":
        return False
    candidate = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), **_SCRYPT)
    return hmac.compare_digest(candidate.hex(), digest)


@cache
def _dummy_hash() -> str:
    """A real hash to check against when the email is unknown, so both cases take the same time."""
    return hash_password(secrets.token_hex(16))


def check_password_strength(password: str) -> None:
    if len(password) < MIN_PASSWORD_LENGTH:
        raise AuthError(f"Use at least {MIN_PASSWORD_LENGTH} characters")
    if password.strip() != password:
        raise AuthError("Passwords can't start or end with a space")


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _now() -> datetime:
    return datetime.now().replace(microsecond=0)


def _normalise_email(email: str) -> str:
    email = email.strip().lower()
    if "@" not in email or email.startswith("@") or email.endswith("@") or " " in email:
        raise AuthError("Enter a valid email address")
    return email


# --- Users ----------------------------------------------------------------------


def _user_from_row(row) -> User:
    return User(id=row[0], email=row[1], name=row[2], role=row[3], company_id=row[4])


_USER_COLUMNS = "id, email, name, role, company_id"


def create_user(
    email: str,
    name: str,
    role: str,
    company_id: int | None = None,
    password: str | None = None,
    db_path: Path | str = db.DEFAULT_DB_PATH,
) -> User:
    """Add an account. Without a password, the person sets one through an invite link."""
    email = _normalise_email(email)
    name = " ".join(name.split())
    if not name:
        raise AuthError("Enter the person's name")
    if role not in ROLES:
        raise AuthError(f"Unknown role: {role}")
    if role == "founder" and company_id is None:
        raise AuthError("Choose the founder's company")
    if role == "admin":
        company_id = None
    if password is not None:
        check_password_strength(password)
    with db.connect(db_path) as conn:
        if conn.execute("SELECT 1 FROM users WHERE email = ?", (email,)).fetchone():
            raise AuthError(f"There is already an account for {email}")
        cur = conn.execute(
            "INSERT INTO users (email, name, role, company_id, password_hash, active, created_on)"
            " VALUES (?, ?, ?, ?, ?, 1, ?)",
            (email, name, role, company_id, hash_password(password) if password else None, _now().isoformat()),
        )
        return User(cur.lastrowid, email, name, role, company_id)


def get_user(user_id: int, db_path: Path | str = db.DEFAULT_DB_PATH) -> User | None:
    """An active account by id, or None if it doesn't exist or was deactivated."""
    with db.connect(db_path) as conn:
        row = conn.execute(f"SELECT {_USER_COLUMNS} FROM users WHERE id = ? AND active = 1", (user_id,)).fetchone()
    return _user_from_row(row) if row else None


def load_users(db_path: Path | str = db.DEFAULT_DB_PATH) -> pd.DataFrame:
    with db.connect(db_path) as conn:
        df = pd.read_sql_query(
            """
            SELECT u.id, u.name, u.email, u.role, u.company_id, c.name AS company, u.active,
                   u.password_hash IS NOT NULL AS has_password, u.created_on, u.last_login
            FROM users u LEFT JOIN companies c ON c.id = u.company_id
            ORDER BY u.role, c.name, u.name
            """,
            conn,
        )
    return df.astype({"active": bool, "has_password": bool})


def count_admins(db_path: Path | str = db.DEFAULT_DB_PATH) -> int:
    with db.connect(db_path) as conn:
        return conn.execute("SELECT COUNT(*) FROM users WHERE role = 'admin' AND active = 1").fetchone()[0]


def set_active(user_id: int, active: bool, db_path: Path | str = db.DEFAULT_DB_PATH) -> None:
    """Deactivate (or restore) an account. Deactivated people are signed out on their next click."""
    with db.connect(db_path) as conn:
        row = conn.execute("SELECT role, active FROM users WHERE id = ?", (user_id,)).fetchone()
        if row is None:
            raise AuthError("No such account")
        if not active and row[0] == "admin" and row[1]:
            remaining = conn.execute(
                "SELECT COUNT(*) FROM users WHERE role = 'admin' AND active = 1 AND id != ?", (user_id,)
            ).fetchone()[0]
            if remaining == 0:
                raise AuthError("You can't deactivate the last admin")
        conn.execute("UPDATE users SET active = ? WHERE id = ?", (int(active), user_id))
        if not active:
            conn.execute("UPDATE invites SET used_on = ? WHERE user_id = ? AND used_on IS NULL",
                         (_now().isoformat(), user_id))


def change_password(user_id: int, current: str, new: str, db_path: Path | str = db.DEFAULT_DB_PATH) -> None:
    with db.connect(db_path) as conn:
        row = conn.execute("SELECT password_hash FROM users WHERE id = ? AND active = 1", (user_id,)).fetchone()
    if row is None or not verify_password(current, row[0]):
        raise AuthError("Your current password is incorrect")
    check_password_strength(new)
    with db.connect(db_path) as conn:
        conn.execute("UPDATE users SET password_hash = ? WHERE id = ?", (hash_password(new), user_id))


# --- Login ----------------------------------------------------------------------


def authenticate(email: str, password: str, db_path: Path | str = db.DEFAULT_DB_PATH) -> User:
    """Check an email and password. Repeated failures lock the account for a while."""
    generic = AuthError("Incorrect email or password")
    try:
        email = _normalise_email(email)
    except AuthError:
        raise generic from None
    now = _now()
    # Decide inside the transaction but raise after it: db.connect only commits on a clean exit,
    # and the failed-attempt counter must be saved even though the login fails.
    error = None
    with db.connect(db_path) as conn:
        row = conn.execute(
            f"SELECT {_USER_COLUMNS}, password_hash, active, failed_logins, locked_until FROM users WHERE email = ?",
            (email,),
        ).fetchone()
        if row is None:
            verify_password(password, _dummy_hash())  # same work as a real check: don't reveal which emails exist
            error = generic
        else:
            password_hash, active, failed, locked_until = row[5:]
            if locked_until and datetime.fromisoformat(locked_until) > now:
                error = AuthError("Too many failed attempts. Try again in a few minutes.")
            elif not active or not verify_password(password, password_hash):
                failed = (failed or 0) + 1
                lock = (now + LOCKOUT).isoformat() if failed >= MAX_FAILED_LOGINS else None
                conn.execute(
                    "UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?",
                    (0 if lock else failed, lock, row[0]),
                )
                error = generic
            else:
                conn.execute(
                    "UPDATE users SET failed_logins = 0, locked_until = NULL, last_login = ? WHERE id = ?",
                    (now.isoformat(), row[0]),
                )
    if error:
        raise error
    return _user_from_row(row)


# --- Invites --------------------------------------------------------------------


def create_invite(user_id: int, db_path: Path | str = db.DEFAULT_DB_PATH) -> str:
    """A new single-use token for the person to set their password. Earlier unused invites stop working.

    Only a hash of the token is stored, so the link can't be recovered later; make a new one instead.
    """
    token = secrets.token_urlsafe(24)
    now = _now()
    with db.connect(db_path) as conn:
        if not conn.execute("SELECT 1 FROM users WHERE id = ? AND active = 1", (user_id,)).fetchone():
            raise AuthError("No active account to invite")
        conn.execute("UPDATE invites SET used_on = ? WHERE user_id = ? AND used_on IS NULL", (now.isoformat(), user_id))
        conn.execute(
            "INSERT INTO invites (token_hash, user_id, expires_on) VALUES (?, ?, ?)",
            (_hash_token(token), user_id, (now + INVITE_LIFETIME).isoformat()),
        )
    return token


def invite_user(token: str, db_path: Path | str = db.DEFAULT_DB_PATH) -> User:
    """The account an invite token is for, if the token is still valid."""
    with db.connect(db_path) as conn:
        row = conn.execute(
            """
            SELECT u.id, u.email, u.name, u.role, u.company_id, i.expires_on, i.used_on, u.active
            FROM invites i JOIN users u ON u.id = i.user_id WHERE i.token_hash = ?
            """,
            (_hash_token(token),),
        ).fetchone()
    if row is None or row[6] is not None or not row[7]:
        raise AuthError("This invite link isn't valid any more. Ask the fund for a new one.")
    if datetime.fromisoformat(row[5]) < _now():
        raise AuthError("This invite link has expired. Ask the fund for a new one.")
    return _user_from_row(row)


def accept_invite(token: str, password: str, db_path: Path | str = db.DEFAULT_DB_PATH) -> User:
    """Set the account's password from an invite and use the invite up."""
    user = invite_user(token, db_path)
    check_password_strength(password)
    with db.connect(db_path) as conn:
        conn.execute(
            "UPDATE users SET password_hash = ?, failed_logins = 0, locked_until = NULL, last_login = ? WHERE id = ?",
            (hash_password(password), _now().isoformat(), user.id),
        )
        conn.execute("UPDATE invites SET used_on = ? WHERE token_hash = ?", (_now().isoformat(), _hash_token(token)))
    return user


def _cli() -> None:
    """python -m portfolio.auth add-admin  — create a fund admin account from a terminal."""
    import argparse
    import getpass

    parser = argparse.ArgumentParser(prog="python -m portfolio.auth")
    sub = parser.add_subparsers(dest="command", required=True)
    add = sub.add_parser("add-admin", help="Create a fund admin account")
    add.add_argument("--name")
    add.add_argument("--email")
    args = parser.parse_args()

    db.init_db()
    name = args.name or input("Name: ")
    email = args.email or input("Email: ")
    password = getpass.getpass(f"Password (at least {MIN_PASSWORD_LENGTH} characters): ")
    if getpass.getpass("Confirm password: ") != password:
        raise SystemExit("The passwords don't match.")
    try:
        user = create_user(email, name, "admin", password=password)
    except AuthError as e:
        raise SystemExit(str(e))
    print(f"Created admin account for {user.email} in {db.DEFAULT_DB_PATH}")


if __name__ == "__main__":
    _cli()
