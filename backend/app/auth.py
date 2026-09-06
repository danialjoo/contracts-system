"""لایه احراز هویت.

فعلاً فقط حساب‌های محلی پیاده شده است، اما پشت یک واسط، تا افزودن
LDAP/Active Directory بعداً فقط یک کلاس تازه باشد نه بازنویسی مسیرها.
"""
from __future__ import annotations

import secrets

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Protocol

from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import settings
from .models import User
from .security import hash_password, needs_rehash, verify_password


_DUMMY_HASH: str | None = None


def _dummy_hash() -> str:
    """یک بار ساخته و نگه داشته می‌شود؛ هرگز با رمز واقعی مطابقت ندارد."""
    global _DUMMY_HASH
    if _DUMMY_HASH is None:
        _DUMMY_HASH = hash_password(secrets.token_urlsafe(32))
    return _DUMMY_HASH


@dataclass(frozen=True)
class AuthResult:
    ok: bool
    user: User | None = None
    error: str | None = None


class AuthBackend(Protocol):
    def authenticate(self, db: Session, username: str, password: str) -> AuthResult: ...


class LocalAuthBackend:
    """نام کاربری و رمز عبورِ ذخیره‌شده در خود سامانه (Argon2id)."""

    def authenticate(self, db: Session, username: str, password: str) -> AuthResult:
        now = datetime.now(timezone.utc)
        user = db.scalar(select(User).where(User.username == username.strip().lower()))

        if user is None:
            # روی هش واقعی و دورانداختنی کار می‌کنیم تا زمان پاسخ، وجود یا
            # نبود کاربر را لو ندهد (حمله زمان‌سنجی روی شمارش نام کاربری).
            verify_password(password, _dummy_hash())
            return AuthResult(False, error="نام کاربری یا رمز عبور نادرست است.")

        if not user.is_active:
            return AuthResult(False, error="حساب کاربری شما غیرفعال شده است.")

        if user.locked_until and user.locked_until > now:
            minutes = max(1, int((user.locked_until - now).total_seconds() // 60) + 1)
            return AuthResult(False, error=f"حساب به دلیل تلاش‌های ناموفق قفل است. {minutes} دقیقه دیگر تلاش کنید.")

        if not verify_password(password, user.password_hash):
            user.failed_attempts += 1
            if user.failed_attempts >= settings.max_failed_logins:
                user.locked_until = now + timedelta(minutes=settings.lockout_minutes)
                user.failed_attempts = 0
                return AuthResult(False, error=(
                    f"حساب به مدت {settings.lockout_minutes} دقیقه قفل شد."
                ))
            remaining = settings.max_failed_logins - user.failed_attempts
            return AuthResult(False, error=(
                f"نام کاربری یا رمز عبور نادرست است. {remaining} تلاش تا قفل شدن حساب."
            ))

        # ورود موفق
        user.failed_attempts = 0
        user.locked_until = None
        if needs_rehash(user.password_hash):
            user.password_hash = hash_password(password)
        return AuthResult(True, user=user)


def get_auth_backend() -> AuthBackend:
    return LocalAuthBackend()
