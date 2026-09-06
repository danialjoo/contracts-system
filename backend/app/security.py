from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import timedelta

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError

_hasher = PasswordHasher()

MIN_PASSWORD_LENGTH = 10


def hash_password(raw: str) -> str:
    return _hasher.hash(raw)


def verify_password(raw: str, hashed: str) -> bool:
    try:
        return _hasher.verify(hashed, raw)
    except (VerifyMismatchError, InvalidHashError, ValueError):
        return False


def needs_rehash(hashed: str) -> bool:
    try:
        return _hasher.check_needs_rehash(hashed)
    except (InvalidHashError, ValueError):
        return True


def new_token() -> str:
    return secrets.token_urlsafe(32)


def token_digest(token: str) -> str:
    """توکن نشست خام هرگز ذخیره نمی‌شود؛ فقط چکیده‌اش."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def constant_time_equals(a: str, b: str) -> bool:
    return hmac.compare_digest(a or "", b or "")


def password_problem(raw: str) -> str | None:
    """پیام خطای فارسی اگر رمز ضعیف باشد، وگرنه None."""
    if len(raw) < MIN_PASSWORD_LENGTH:
        return f"رمز عبور باید حداقل {MIN_PASSWORD_LENGTH} نویسه باشد."
    if raw.isdigit():
        return "رمز عبور نباید فقط عدد باشد."
    if raw.lower() in {"password", "12345678910", "administrator"}:
        return "رمز عبور بیش از حد ساده است."
    return None


def session_lifetime(hours: int) -> timedelta:
    return timedelta(hours=hours)
