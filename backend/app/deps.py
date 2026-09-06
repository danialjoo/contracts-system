from __future__ import annotations

from datetime import datetime, timezone

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from . import audit
from .config import settings
from .db import get_db
from .models import Role, Section, User, UserSession
from .security import constant_time_equals, token_digest

SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


def client_ip(request: Request) -> str:
    """پشت nginx داخلی، X-Forwarded-For را می‌پذیریم چون فقط از پروکسی خودمان می‌آید."""
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else ""


def current_session(request: Request, db: Session = Depends(get_db)) -> UserSession:
    raw = request.cookies.get(settings.session_cookie)
    if not raw:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "برای ادامه وارد سامانه شوید.")

    sess = db.scalar(select(UserSession).where(UserSession.token_hash == token_digest(raw)))
    now = datetime.now(timezone.utc)
    if sess is None or sess.revoked_at is not None or sess.expires_at <= now:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "نشست شما منقضی شده است. دوباره وارد شوید.")
    if not sess.user.is_active:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "حساب کاربری شما غیرفعال شده است.")

    # محافظت CSRF: هر درخواست تغییردهنده باید هدر توکن را همراه داشته باشد.
    if request.method not in SAFE_METHODS:
        header = request.headers.get("x-csrf-token", "")
        if not constant_time_equals(header, sess.csrf_token):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "توکن امنیتی نامعتبر است. صفحه را تازه کنید.")
    return sess


def current_user(sess: UserSession = Depends(current_session)) -> User:
    return sess.user


def require_role(*roles: Role):
    def guard(request: Request, user: User = Depends(current_user),
              db: Session = Depends(get_db)) -> User:
        if user.role not in roles:
            audit.record(
                db, actor=user, action="access_denied",
                summary=f"مسیر {request.url.path} نیازمند نقش بالاتر است.",
                ip=client_ip(request), user_agent=request.headers.get("user-agent", ""),
            )
            db.commit()
            raise HTTPException(status.HTTP_403_FORBIDDEN, "برای این عملیات دسترسی ندارید.")
        return user
    return guard


def assert_section_access(user: User, section: Section) -> None:
    """مرز محرمانگی سه بخش. نبود دسترسی = ۴۰۴، نه ۴۰۳.

    عمداً «یافت نشد» برمی‌گردانیم تا وجود یا نبود یک قرارداد در بخشی که
    کاربر به آن دسترسی ندارد لو نرود.
    """
    if section not in user.allowed_sections:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "قرارداد یافت نشد.")


def writable(user: User) -> bool:
    return user.role in (Role.admin, Role.editor)


def require_write(user: User = Depends(current_user)) -> User:
    if not writable(user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "دسترسی شما فقط مشاهده است.")
    return user
