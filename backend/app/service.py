"""محاسبات مشتق و تبدیل مدل به خروجی.

روزهای باقیمانده، مدت سپری‌شده و وضعیت هرگز ذخیره نمی‌شوند؛ همیشه در
لحظه خواندن نسبت به «امروز» حساب می‌شوند تا هیچ‌وقت بیات نشوند.
"""
from __future__ import annotations

from datetime import date

from .config import settings
from .models import KIND_FA, SECTION_FA, Contract
from .schemas import AttachmentOut, ContractOut

STATUS_FA = {"live": "جاری", "soon": "رو به انقضا", "over": "منقضی", "unknown": "نامشخص"}

CONTRACT_FIELDS = (
    "section", "kind", "contract_number", "party", "subject", "unit_name",
    "numbered_on_jalali", "start_jalali", "end_jalali", "duration_text",
    "amount_rial", "guarantees", "counterparty_people", "site", "capacity",
    "storage_location", "addendum", "scan_link", "notes",
)


def derive(contract: Contract, today: date | None = None) -> dict:
    today = today or date.today()
    start, end = contract.start_date, contract.end_date

    if end is None:
        return {"status": "unknown", "days_remaining": None, "days_total": None,
                "days_elapsed": None, "percent_elapsed": None}

    remaining = (end - today).days
    if remaining < 0:
        status = "over"
    elif remaining <= settings.expiring_days:
        status = "soon"
    else:
        status = "live"

    total = elapsed = percent = None
    if start is not None and end > start:
        total = (end - start).days
        elapsed = min(max((today - start).days, 0), total)
        percent = round(elapsed / total * 100)

    return {"status": status, "days_remaining": remaining, "days_total": total,
            "days_elapsed": elapsed, "percent_elapsed": percent}


def to_out(contract: Contract, today: date | None = None) -> ContractOut:
    d = derive(contract, today)
    return ContractOut(
        id=contract.id,
        section=contract.section,
        section_fa=SECTION_FA[contract.section],
        kind=contract.kind,
        kind_fa=KIND_FA[contract.kind],
        contract_number=contract.contract_number,
        party=contract.party,
        subject=contract.subject,
        unit_name=contract.unit.name if contract.unit else "",
        numbered_on_jalali=contract.numbered_on_jalali,
        start_jalali=contract.start_jalali,
        end_jalali=contract.end_jalali,
        duration_text=contract.duration_text,
        amount_rial=int(contract.amount_rial or 0),
        guarantees=contract.guarantees,
        counterparty_people=contract.counterparty_people,
        site=contract.site,
        capacity=contract.capacity,
        storage_location=contract.storage_location,
        addendum=contract.addendum,
        scan_link=contract.scan_link,
        notes=contract.notes,
        version=contract.version,
        attachments=[AttachmentOut.model_validate(a) for a in contract.attachments],
        updated_at=contract.updated_at,
        updated_by=None,
        status_fa=STATUS_FA[d["status"]],
        **d,
    )


def snapshot(contract: Contract) -> dict:
    """عکس لحظه‌ای فیلدهای قابل ممیزی، برای مقایسه قبل و بعد از ویرایش.

    واحد مربوطه با «نام» ثبت می‌شود نه شناسه عددی؛ ممیزی برای خوانده شدن
    توسط آدم است، و «۳» به کسی چیزی نمی‌گوید.
    """
    data = {name: getattr(contract, name)
            for name in CONTRACT_FIELDS if name != "unit_name"}
    data["unit_name"] = contract.unit.name if contract.unit else None
    return data
