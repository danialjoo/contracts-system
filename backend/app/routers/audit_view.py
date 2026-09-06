from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..audit import ACTION_FA, FIELD_FA
from ..db import get_db
from ..deps import require_role
from ..models import AuditLog, Role, User
from ..schemas import AuditOut, AuditPage

router = APIRouter(prefix="/api/audit", tags=["audit"])
admin_only = require_role(Role.admin)


@router.get("", response_model=AuditPage)
def list_audit(
    db: Session = Depends(get_db),
    _: User = Depends(admin_only),
    username: str = "",
    action: str = "",
    entity_id: str = "",
    since: datetime | None = None,
    until: datetime | None = None,
    page: int = Query(1, ge=1),
    per_page: int = Query(100, ge=1, le=500),
) -> AuditPage:
    stmt = select(AuditLog)
    if username:
        stmt = stmt.where(AuditLog.username == username.strip().lower())
    if action:
        stmt = stmt.where(AuditLog.action == action)
    if entity_id:
        stmt = stmt.where(AuditLog.entity_id == entity_id)
    if since:
        stmt = stmt.where(AuditLog.at >= since)
    if until:
        stmt = stmt.where(AuditLog.at <= until)

    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(
        stmt.order_by(AuditLog.at.desc(), AuditLog.id.desc())
        .offset((page - 1) * per_page).limit(per_page)
    ).all()

    items = [
        AuditOut(
            id=r.id, at=r.at, username=r.username or "—", action=r.action,
            action_fa=ACTION_FA.get(r.action, r.action), entity=r.entity,
            entity_id=r.entity_id, summary=r.summary, field=r.field,
            field_fa=FIELD_FA.get(r.field or "", r.field), old_value=r.old_value,
            new_value=r.new_value, ip=r.ip,
        )
        for r in rows
    ]
    return AuditPage(items=items, total=total, page=page, per_page=per_page)


@router.get("/actions")
def actions(_: User = Depends(admin_only)) -> list[dict]:
    return [{"value": k, "label": v} for k, v in ACTION_FA.items()]
