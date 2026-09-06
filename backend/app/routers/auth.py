from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

from .. import audit
from ..auth import get_auth_backend
from ..config import settings
from ..db import get_db
from ..deps import client_ip, current_session, current_user
from ..models import User, UserSession, ordered_sections
from ..schemas import LoginIn, MeOut, PasswordChangeIn
from ..security import (
    hash_password, new_token, password_problem, session_lifetime,
    token_digest, verify_password,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _set_cookies(response: Response, raw_token: str, csrf: str) -> None:
    common = {"httponly": True, "samesite": "lax", "secure": settings.cookie_secure, "path": "/"}
    response.set_cookie(settings.session_cookie, raw_token, **common)
    # توکن CSRF باید برای جاوااسکریپت خوانا باشد تا در هدر بازگردانده شود.
    response.set_cookie(settings.csrf_cookie, csrf, httponly=False,
                        samesite="lax", secure=settings.cookie_secure, path="/")


def _me(user: User) -> MeOut:
    return MeOut(
        id=user.id, username=user.username, full_name=user.full_name,
        role=user.role, must_change_password=user.must_change_password,
        sections=ordered_sections(user.allowed_sections),
    )


@router.post("/login", response_model=MeOut)
def login(payload: LoginIn, request: Request, response: Response,
          db: Session = Depends(get_db)) -> MeOut:
    ip = client_ip(request)
    agent = request.headers.get("user-agent", "")
    result = get_auth_backend().authenticate(db, payload.username, payload.password)

    if not result.ok or result.user is None:
        audit.record(db, actor=None, action="login_failed", entity="user",
                     summary=f"نام کاربری «{payload.username[:64]}» — {result.error}",
                     ip=ip, user_agent=agent)
        db.commit()
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, result.error or "ورود ناموفق بود.")

    user = result.user
    raw, csrf = new_token(), new_token()
    db.add(UserSession(
        user_id=user.id, token_hash=token_digest(raw), csrf_token=csrf,
        expires_at=datetime.now(timezone.utc) + session_lifetime(settings.session_hours),
        ip=ip, user_agent=agent[:300],
    ))
    audit.record(db, actor=user, action="login", entity="user", entity_id=user.id,
                 summary="ورود موفق به سامانه", ip=ip, user_agent=agent)
    db.commit()

    _set_cookies(response, raw, csrf)
    return _me(user)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(request: Request, response: Response,
           sess: UserSession = Depends(current_session),
           db: Session = Depends(get_db)) -> Response:
    sess.revoked_at = datetime.now(timezone.utc)
    audit.record(db, actor=sess.user, action="logout", entity="user", entity_id=sess.user_id,
                 summary="خروج از سامانه", ip=client_ip(request),
                 user_agent=request.headers.get("user-agent", ""))
    db.commit()
    response.delete_cookie(settings.session_cookie, path="/")
    response.delete_cookie(settings.csrf_cookie, path="/")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/me", response_model=MeOut)
def me(user: User = Depends(current_user)) -> MeOut:
    return _me(user)


@router.post("/password", response_model=MeOut)
def change_password(payload: PasswordChangeIn, request: Request,
                    sess: UserSession = Depends(current_session),
                    db: Session = Depends(get_db)) -> MeOut:
    user = sess.user
    if not verify_password(payload.current_password, user.password_hash):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "رمز عبور فعلی نادرست است.")
    problem = password_problem(payload.new_password)
    if problem:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, problem)
    if payload.new_password == payload.current_password:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "رمز جدید باید با رمز فعلی متفاوت باشد.")

    user.password_hash = hash_password(payload.new_password)
    user.must_change_password = False
    audit.record(db, actor=user, action="password_changed", entity="user", entity_id=user.id,
                 summary="کاربر رمز عبور خود را تغییر داد", ip=client_ip(request),
                 user_agent=request.headers.get("user-agent", ""))
    db.commit()
    return _me(user)
