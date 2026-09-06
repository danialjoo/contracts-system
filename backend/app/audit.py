"""ثبت تغییرات کاربران.

قاعده‌ای که در کل برنامه رعایت می‌شود: رکورد ممیزی در *همان تراکنشِ*
تغییر نوشته می‌شود. اگر تغییر برگردد، ممیزی هم برمی‌گردد؛ پس هرگز
داده و ممیزی از هم جدا نمی‌افتند.
"""
from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Any, Iterable

from sqlalchemy.orm import Session

from .models import AuditLog, User

# نام فارسی فیلدها برای نمایش در صفحه ممیزی
FIELD_FA: dict[str, str] = {
    "section": "بخش",
    "kind": "نوع سند",
    "contract_number": "شماره قرارداد",
    "party": "طرف قرارداد",
    "subject": "موضوع",
    "unit_name": "واحد مربوطه",
    "numbered_on_jalali": "تاریخ شماره‌گذاری",
    "start_jalali": "تاریخ شروع",
    "end_jalali": "تاریخ پایان",
    "duration_text": "مدت",
    "amount_rial": "مبلغ",
    "guarantees": "تضامین",
    "counterparty_people": "عوامل طرف قرارداد",
    "site": "ساختگاه/محل اجرا",
    "capacity": "ظرفیت",
    "storage_location": "محل نگهداری اصل",
    "addendum": "الحاقیه",
    "scan_link": "لینک اسکن",
    "notes": "سایر موارد",
    "role": "نقش",
    "is_active": "فعال",
    "sections": "بخش‌های مجاز",
    "full_name": "نام و نام خانوادگی",
}

ACTION_FA: dict[str, str] = {
    "login": "ورود",
    "login_failed": "ورود ناموفق",
    "logout": "خروج",
    "password_changed": "تغییر رمز عبور",
    "contract_created": "ثبت قرارداد",
    "contract_updated": "ویرایش قرارداد",
    "contract_deleted": "حذف قرارداد",
    "contract_restored": "بازیابی قرارداد",
    "attachment_added": "افزودن پیوست",
    "attachment_deleted": "حذف پیوست",
    "attachment_viewed": "مشاهده پیوست",
    "excel_imported": "درون‌ریزی اکسل",
    "excel_exported": "خروجی اکسل",
    "user_created": "ایجاد کاربر",
    "user_updated": "ویرایش کاربر",
    "access_denied": "تلاش برای دسترسی غیرمجاز",
}


@dataclass(frozen=True)
class FieldChange:
    field: str
    old: str | None
    new: str | None


def _norm(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return "بله" if value else "خیر"
    if isinstance(value, Decimal):
        return format(value, "f")
    if hasattr(value, "value"):  # Enum
        return str(value.value)
    text = str(value).strip()
    return text or None


def diff(before: dict[str, Any], after: dict[str, Any],
         fields: Iterable[str]) -> list[FieldChange]:
    """فقط فیلدهایی که واقعاً عوض شده‌اند برگردانده می‌شوند."""
    changes: list[FieldChange] = []
    for name in fields:
        if name not in after:
            continue
        old, new = _norm(before.get(name)), _norm(after.get(name))
        if old != new:
            changes.append(FieldChange(name, old, new))
    return changes


def record(
    db: Session,
    *,
    actor: User | None,
    action: str,
    entity: str = "",
    entity_id: str | int | None = None,
    summary: str = "",
    changes: list[FieldChange] | None = None,
    ip: str = "",
    user_agent: str = "",
) -> None:
    """یک یا چند سطر ممیزی به تراکنش جاری اضافه می‌کند (commit نمی‌کند)."""
    base = {
        "user_id": actor.id if actor else None,
        "username": actor.username if actor else "",
        "action": action,
        "entity": entity,
        "entity_id": str(entity_id) if entity_id is not None else None,
        "ip": ip[:64],
        "user_agent": user_agent[:300],
    }
    if not changes:
        db.add(AuditLog(**base, summary=summary))
        return
    for change in changes:
        db.add(AuditLog(
            **base,
            summary=summary,
            field=change.field,
            old_value=change.old,
            new_value=change.new,
        ))
