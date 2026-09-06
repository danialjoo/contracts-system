from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import audit, excel
from ..db import get_db
from ..deps import assert_section_access, client_ip, current_user, require_write
from ..jalali import normalize_date
from ..models import Contract, Section, Unit, User
from ..schemas import ContractIn, ContractOut, ContractPage, ContractUpdate
from ..service import CONTRACT_FIELDS, derive, snapshot, to_out

router = APIRouter(prefix="/api/contracts", tags=["contracts"])


def _unit(db: Session, name: str) -> Unit | None:
    """واحد را پیدا یا ایجاد می‌کند و خودِ شیء را برمی‌گرداند."""
    name = (name or "").strip()
    if not name:
        return None
    unit = db.scalar(select(Unit).where(Unit.name == name))
    if unit is None:
        unit = Unit(name=name)
        db.add(unit)
        db.flush()
    return unit


def _apply(contract: Contract, payload: ContractIn, db: Session) -> list[str]:
    """مقادیر را روی مدل می‌نشاند و هشدارهای تاریخ را برمی‌گرداند."""
    warnings: list[str] = []
    contract.section = payload.section
    contract.kind = payload.kind
    contract.contract_number = payload.contract_number.strip()
    contract.party = payload.party.strip()
    contract.subject = payload.subject.strip()
    contract.unit = _unit(db, payload.unit_name)
    contract.duration_text = payload.duration_text.strip()
    contract.amount_rial = payload.amount_rial
    contract.guarantees = payload.guarantees.strip()
    contract.counterparty_people = payload.counterparty_people.strip()
    contract.site = payload.site.strip()
    contract.capacity = payload.capacity.strip()
    contract.storage_location = payload.storage_location.strip()
    contract.addendum = payload.addendum.strip()
    contract.scan_link = payload.scan_link.strip()
    contract.notes = payload.notes.strip()

    for name, raw in (("numbered_on", payload.numbered_on),
                      ("start", payload.start), ("end", payload.end)):
        jalali, gregorian = normalize_date(raw)
        if raw and jalali is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                                f"تاریخ «{raw}» قابل خواندن نیست. نمونه درست: ۱۴۰۵/۰۶/۱۵")
        # الزام کارفرما: ورودی میلادی خودکار شمسی می‌شود.
        if raw and jalali and str(raw).strip() != jalali:
            warnings.append(f"تاریخ «{raw}» به «{jalali}» تبدیل شد.")
        setattr(contract, f"{name}_jalali", jalali)
        setattr(contract, f"{name}_date", gregorian)

    if contract.start_date and contract.end_date and contract.end_date < contract.start_date:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "تاریخ پایان نمی‌تواند پیش از تاریخ شروع باشد.")
    return warnings


@router.get("", response_model=ContractPage)
def list_contracts(
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
    q: str = "",
    section: Section | None = None,
    kind: str = "",
    unit: str = "",
    contract_status: str = Query("", alias="status"),
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=500),
    sort: str = "end",
) -> ContractPage:
    allowed = user.allowed_sections
    if not allowed:
        return ContractPage(items=[], total=0, page=page, per_page=per_page)

    stmt = select(Contract).where(
        Contract.deleted_at.is_(None),
        Contract.section.in_(allowed),
    )
    if section is not None:
        assert_section_access(user, section)
        stmt = stmt.where(Contract.section == section)
    if kind:
        stmt = stmt.where(Contract.kind == kind)
    if unit:
        stmt = stmt.join(Unit, isouter=True).where(Unit.name == unit)
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(
            Contract.party.ilike(like), Contract.subject.ilike(like),
            Contract.contract_number.ilike(like), Contract.site.ilike(like),
            Contract.notes.ilike(like), Contract.capacity.ilike(like),
        ))

    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    order = {"end": Contract.end_date, "party": Contract.party,
             "amount": Contract.amount_rial, "number": Contract.contract_number}
    stmt = stmt.order_by(order.get(sort, Contract.end_date).asc().nulls_last())
    rows = db.scalars(stmt.offset((page - 1) * per_page).limit(per_page)).all()

    items = [to_out(c) for c in rows]
    # فیلتر وضعیت روی مقدار محاسباتی اعمال می‌شود، چون در دیتابیس ذخیره نشده.
    if contract_status:
        items = [i for i in items if i.status == contract_status]
    return ContractPage(items=items, total=total, page=page, per_page=per_page)


@router.get("/export")
def export_excel(request: Request, db: Session = Depends(get_db),
                 user: User = Depends(current_user),
                 section: Section | None = None) -> Response:
    allowed = user.allowed_sections
    stmt = select(Contract).where(Contract.deleted_at.is_(None), Contract.section.in_(allowed))
    if section is not None:
        assert_section_access(user, section)
        stmt = stmt.where(Contract.section == section)
    rows = db.scalars(stmt.order_by(Contract.section, Contract.end_date.asc().nulls_last())).all()

    payload = excel.write_workbook(rows)
    audit.record(db, actor=user, action="excel_exported", entity="contract",
                 summary=f"خروجی اکسل از {len(rows)} قرارداد",
                 ip=client_ip(request), user_agent=request.headers.get("user-agent", ""))
    db.commit()

    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M")
    return Response(
        content=payload,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="contracts-{stamp}.xlsx"'},
    )


@router.get("/template")
def export_template(user: User = Depends(current_user)) -> Response:
    return Response(
        content=excel.template_workbook(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="contracts-template.xlsx"'},
    )


@router.get("/{contract_id}", response_model=ContractOut)
def get_contract(contract_id: int, db: Session = Depends(get_db),
                 user: User = Depends(current_user)) -> ContractOut:
    contract = db.get(Contract, contract_id)
    if contract is None or contract.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "قرارداد یافت نشد.")
    assert_section_access(user, contract.section)
    return to_out(contract)


@router.post("", response_model=ContractOut, status_code=status.HTTP_201_CREATED)
def create_contract(payload: ContractIn, request: Request,
                    db: Session = Depends(get_db),
                    user: User = Depends(require_write)) -> ContractOut:
    assert_section_access(user, payload.section)
    contract = Contract(created_by_id=user.id, updated_by_id=user.id)
    _apply(contract, payload, db)
    db.add(contract)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT,
                            f"شماره «{payload.contract_number}» قبلاً ثبت شده است.")

    audit.record(
        db, actor=user, action="contract_created", entity="contract", entity_id=contract.id,
        summary=f"{contract.contract_number} — {contract.subject[:120]}",
        changes=audit.diff({}, snapshot(contract), CONTRACT_FIELDS),
        ip=client_ip(request), user_agent=request.headers.get("user-agent", ""),
    )
    db.commit()
    return to_out(contract)


@router.put("/{contract_id}", response_model=ContractOut)
def update_contract(contract_id: int, payload: ContractUpdate, request: Request,
                    db: Session = Depends(get_db),
                    user: User = Depends(require_write)) -> ContractOut:
    contract = db.get(Contract, contract_id)
    if contract is None or contract.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "قرارداد یافت نشد.")
    assert_section_access(user, contract.section)
    assert_section_access(user, payload.section)

    # قفل خوش‌بینانه: جلوی بازنویسی بی‌صدای تغییر کاربر دیگر را می‌گیرد.
    if payload.version != contract.version:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            "این قرارداد در این فاصله توسط کاربر دیگری تغییر کرده است. "
                            "صفحه را تازه کنید و دوباره ویرایش کنید.")

    before = snapshot(contract)
    _apply(contract, payload, db)
    changes = audit.diff(before, snapshot(contract), CONTRACT_FIELDS)
    if not changes:
        return to_out(contract)

    contract.version += 1
    contract.updated_by_id = user.id
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT,
                            f"شماره «{payload.contract_number}» قبلاً ثبت شده است.")

    audit.record(
        db, actor=user, action="contract_updated", entity="contract", entity_id=contract.id,
        summary=f"{contract.contract_number} — {len(changes)} فیلد تغییر کرد",
        changes=changes, ip=client_ip(request),
        user_agent=request.headers.get("user-agent", ""),
    )
    db.commit()
    return to_out(contract)


@router.delete("/{contract_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_contract(contract_id: int, request: Request,
                    db: Session = Depends(get_db),
                    user: User = Depends(require_write)) -> Response:
    contract = db.get(Contract, contract_id)
    if contract is None or contract.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "قرارداد یافت نشد.")
    assert_section_access(user, contract.section)

    # حذف نرم: رکورد قرارداد هرگز از دیتابیس پاک نمی‌شود.
    contract.deleted_at = datetime.now(timezone.utc)
    contract.deleted_by_id = user.id
    audit.record(db, actor=user, action="contract_deleted", entity="contract",
                 entity_id=contract.id,
                 summary=f"{contract.contract_number} — {contract.subject[:120]}",
                 ip=client_ip(request), user_agent=request.headers.get("user-agent", ""))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{contract_id}/derived")
def derived(contract_id: int, db: Session = Depends(get_db),
            user: User = Depends(current_user)) -> dict:
    contract = db.get(Contract, contract_id)
    if contract is None or contract.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "قرارداد یافت نشد.")
    assert_section_access(user, contract.section)
    return derive(contract)
