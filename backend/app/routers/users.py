from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import audit
from ..db import get_db
from ..deps import client_ip, require_role
from ..models import Role, User, UserSection, UserSession, ordered_sections
from ..schemas import UserIn, UserOut, UserPatch
from ..security import hash_password, password_problem

router = APIRouter(prefix="/api/users", tags=["users"])
admin_only = require_role(Role.admin)


def _out(user: User) -> UserOut:
    return UserOut(
        id=user.id, username=user.username, full_name=user.full_name,
        role=user.role, is_active=user.is_active,
        must_change_password=user.must_change_password,
        sections=ordered_sections(user.allowed_sections),
        created_at=user.created_at,
    )


@router.get("", response_model=list[UserOut])
def list_users(db: Session = Depends(get_db), _: User = Depends(admin_only)) -> list[UserOut]:
    return [_out(u) for u in db.scalars(select(User).order_by(User.username)).all()]


@router.post("", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def create_user(payload: UserIn, request: Request, db: Session = Depends(get_db),
                actor: User = Depends(admin_only)) -> UserOut:
    problem = password_problem(payload.password)
    if problem:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, problem)

    user = User(
        username=payload.username.strip().lower(),
        full_name=payload.full_name.strip(),
        password_hash=hash_password(payload.password),
        role=payload.role,
        must_change_password=True,
    )
    user.sections = [UserSection(section=s) for s in set(payload.sections)]
    db.add(user)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "این نام کاربری قبلاً ثبت شده است.")

    sections = "، ".join(s.value for s in ordered_sections(user.allowed_sections))
    audit.record(db, actor=actor, action="user_created", entity="user", entity_id=user.id,
                 summary=f"کاربر «{user.username}» با نقش {user.role.value} — بخش‌ها: {sections or 'هیچ'}",
                 ip=client_ip(request), user_agent=request.headers.get("user-agent", ""))
    db.commit()
    return _out(user)


@router.patch("/{user_id}", response_model=UserOut)
def update_user(user_id: int, payload: UserPatch, request: Request,
                db: Session = Depends(get_db),
                actor: User = Depends(admin_only)) -> UserOut:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "کاربر یافت نشد.")

    before = {
        "full_name": user.full_name, "role": user.role, "is_active": user.is_active,
        "sections": "، ".join(sorted(s.value for s in user.allowed_sections)),
    }

    if payload.full_name is not None:
        user.full_name = payload.full_name.strip()
    if payload.role is not None:
        if user.id == actor.id and payload.role != Role.admin:
            raise HTTPException(status.HTTP_400_BAD_REQUEST,
                                "نمی‌توانید نقش مدیریت خود را از خودتان بگیرید.")
        user.role = payload.role
    if payload.is_active is not None:
        if user.id == actor.id and not payload.is_active:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "نمی‌توانید حساب خود را غیرفعال کنید.")
        user.is_active = payload.is_active
        if not payload.is_active:
            # غیرفعال‌سازی باید فوری باشد: همه نشست‌های باز کاربر ابطال می‌شوند.
            for sess in db.scalars(select(UserSession).where(
                    UserSession.user_id == user.id, UserSession.revoked_at.is_(None))).all():
                sess.revoked_at = datetime.now(timezone.utc)
    if payload.sections is not None:
        user.sections = [UserSection(section=s) for s in set(payload.sections)]
    if payload.new_password:
        problem = password_problem(payload.new_password)
        if problem:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, problem)
        user.password_hash = hash_password(payload.new_password)
        user.must_change_password = True
        user.failed_attempts, user.locked_until = 0, None

    db.flush()
    after = {
        "full_name": user.full_name, "role": user.role, "is_active": user.is_active,
        "sections": "، ".join(sorted(s.value for s in user.allowed_sections)),
    }
    changes = audit.diff(before, after, ("full_name", "role", "is_active", "sections"))
    if payload.new_password:
        changes.append(audit.FieldChange("password", "***", "***"))

    audit.record(db, actor=actor, action="user_updated", entity="user", entity_id=user.id,
                 summary=f"ویرایش کاربر «{user.username}»", changes=changes or None,
                 ip=client_ip(request), user_agent=request.headers.get("user-agent", ""))
    db.commit()
    return _out(user)
