"""درون‌ریزی اکسل.

قاعده: هیچ درون‌ریزی نیمه‌کاره‌ای رخ نمی‌دهد. اول اجرای آزمایشی با گزارش
خطای سطر‌به‌سطر، و ثبت واقعی در یک تراکنش واحد است — یا همه یا هیچ.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import audit, excel
from ..config import settings
from ..db import get_db
from ..deps import client_ip, require_write
from ..models import Contract, Kind, Section, Unit, User
from ..schemas import ImportReport

router = APIRouter(prefix="/api/imports", tags=["imports"])

TEXT_FIELDS = ("party", "subject", "duration_text", "guarantees",
               "counterparty_people", "site", "capacity", "storage_location",
               "addendum", "scan_link", "notes")


@router.post("/xlsx", response_model=ImportReport)
async def import_xlsx(
    request: Request,
    file: UploadFile = File(...),
    default_section: Section = Form(...),
    dry_run: bool = Form(True),
    db: Session = Depends(get_db),
    user: User = Depends(require_write),
) -> ImportReport:
    if default_section not in user.allowed_sections:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "به این بخش دسترسی ندارید.")

    payload = await file.read(settings.max_upload_bytes + 1)
    if len(payload) > settings.max_upload_bytes:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "فایل بیش از حد بزرگ است.")
    if not payload[:2] == b"PK":
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "فقط فایل xlsx پذیرفته می‌شود.")

    try:
        records, errors = excel.read_rows(payload)
    except Exception as exc:  # noqa: BLE001 - پیام کتابخانه به کاربر نشان داده نمی‌شود
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "فایل اکسل خوانده نشد. از سالم بودن فایل مطمئن شوید.") from exc

    existing = {n for (n,) in db.execute(
        select(Contract.contract_number).where(Contract.deleted_at.is_(None))).all()}
    units = {u.name: u.id for u in db.scalars(select(Unit)).all()}

    ready: list[dict] = []
    seen: set[str] = set()
    for rec in records:
        number = rec["contract_number"]
        row = rec["_row"]
        if number in existing:
            errors.append(f"سطر {row}: شماره «{number}» از قبل در سامانه هست — رد شد.")
            continue
        if number in seen:
            errors.append(f"سطر {row}: شماره «{number}» در خود فایل تکراری است — رد شد.")
            continue
        section = rec.get("section") or default_section
        if section not in user.allowed_sections:
            errors.append(f"سطر {row}: به بخش این قرارداد دسترسی ندارید — رد شد.")
            continue
        rec["section"] = section
        seen.add(number)
        ready.append(rec)

    report = ImportReport(
        dry_run=dry_run, total_rows=len(records), ready=len(ready),
        skipped=len(records) - len(ready), errors=errors[:200],
    )
    if dry_run or not ready:
        return report

    for rec in ready:
        unit_name = str(rec.get("unit_name") or "").strip()
        unit_id = None
        if unit_name:
            if unit_name not in units:
                unit = Unit(name=unit_name)
                db.add(unit)
                db.flush()
                units[unit_name] = unit.id
            unit_id = units[unit_name]

        contract = Contract(
            section=rec["section"],
            kind=Kind.mou if rec.get("kind") == "mou" else Kind.contract,
            contract_number=rec["contract_number"],
            unit_id=unit_id,
            amount_rial=rec.get("amount_rial", 0),
            numbered_on_jalali=rec.get("numbered_on_jalali"),
            numbered_on_date=rec.get("numbered_on_date"),
            start_jalali=rec.get("start_jalali"),
            start_date=rec.get("start_date"),
            end_jalali=rec.get("end_jalali"),
            end_date=rec.get("end_date"),
            created_by_id=user.id,
            updated_by_id=user.id,
            **{f: str(rec.get(f) or "").strip() for f in TEXT_FIELDS},
        )
        db.add(contract)

    audit.record(db, actor=user, action="excel_imported", entity="contract",
                 summary=(f"درون‌ریزی «{file.filename}» — {len(ready)} قرارداد ثبت شد، "
                          f"{report.skipped} سطر رد شد."),
                 ip=client_ip(request), user_agent=request.headers.get("user-agent", ""))
    db.commit()

    report.imported = len(ready)
    report.dry_run = False
    return report
