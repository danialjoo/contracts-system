"""درون‌ریزی و خروجی اکسل با همان ۲۴ سرستون فایل موجود شرکت."""
from __future__ import annotations

import io
from datetime import date
from typing import Any, Iterable

from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

from .jalali import normalize_date
from .models import KIND_FA, SECTION_FA, Contract
from .schemas import parse_amount
from .service import STATUS_FA, derive

# ترتیب دقیق ستون‌های فایل اصلی، به‌اضافه «بخش» که الزام جدید سامانه است.
COLUMNS: list[tuple[str, str]] = [
    ("row", "ردیف"),
    ("section", "بخش"),
    ("storage_location", "محل نگهداری"),
    ("kind", "تفاهم نامه/قرارداد"),
    ("party", "طرف قرارداد"),
    ("scan_link", "لینک اسکن اصل قرارداد/ تفاهم نامه"),
    ("addendum", "الحاقیه"),
    ("unit_name", "واحد مربوطه"),
    ("contract_number", "شماره قرارداد/شماره تفاهم نامه"),
    ("numbered_on", "تاریخ شماره گذاری قرارداد"),
    ("start", "تاریخ شروع قرارداد/ تاریخ شروع تفاهم نامه"),
    ("duration_text", "مدت قرارداد/مدت تفاهم نامه"),
    ("end", "تاریخ پایان قرارداد/ تاریخ پایان تفاهم نامه"),
    ("status", "وضعیت"),
    ("days_remaining", "روزهای باقیمانده"),
    ("days_elapsed", "مدت زمان سپری شده"),
    ("subject", "موضوع قرارداد"),
    ("amount_rial", "مبلغ قرارداد/مبلغ تامین مالی/ ریال"),
    ("guarantees", "تضامین قرارداد"),
    ("counterparty_people", "عوامل طرف قرارداد"),
    ("site", "ساختگاه/ مکان/ محل اجرا"),
    ("capacity", "ظرفیت"),
    ("notes", "سایر موارد"),
    ("attachments", "پیوست‌های ثبت‌شده"),
]

# ستون‌هایی که در فایل ورودی وجود دارند اما محاسباتی‌اند و خوانده نمی‌شوند.
IGNORED_HEADERS = ("فرمول پایان", "روزهای باقیمانده", "روزهای باقی مانده",
                   "مدت زمان سپری شده", "وضعیت", "column1", "پیوست")

# نگاشت سرستون ورودی به فیلد.
# ترتیب مهم است و عمداً از «خاص» به «عام» چیده شده: «عوامل طرف قرارداد»
# زیررشته «طرف قرارداد» را در خود دارد، پس باید زودتر بررسی شود.
HEADER_MAP: list[tuple[str, tuple[str, ...]]] = [
    ("counterparty_people", ("عوامل",)),
    ("storage_location", ("محل نگهداری",)),
    ("scan_link", ("لینک اسکن",)),
    ("numbered_on", ("تاریخ شماره گذاری",)),
    ("start", ("تاریخ شروع",)),
    ("end", ("تاریخ پایان",)),
    ("kind", ("تفاهم نامه/قرارداد", "نوع سند", "نوع")),
    ("contract_number", ("شماره قرارداد", "شماره تفاهم")),
    ("party", ("طرف قرارداد",)),
    ("site", ("ساختگاه", "محل اجرا", "مکان")),
    ("unit_name", ("واحد مربوطه", "واحد")),
    ("duration_text", ("مدت قرارداد", "مدت تفاهم", "مدت")),
    ("amount_rial", ("مبلغ",)),
    ("subject", ("موضوع",)),
    ("guarantees", ("تضامین", "تضمین")),
    ("capacity", ("ظرفیت",)),
    ("addendum", ("الحاقیه",)),
    ("notes", ("سایر موارد", "توضیحات")),
    ("section", ("بخش",)),
]

SECTION_BY_FA = {v: k for k, v in SECTION_FA.items()}


def _norm(text: Any) -> str:
    """همه فاصله‌ها و نیم‌فاصله‌ها حذف می‌شوند.

    سرستون‌های فایل واقعی شرکت شکستِ خط وسطشان دارند («تفاهم نامه/\nقرارداد»)
    و جای فاصله‌ها یکدست نیست؛ با حذف کامل فضای سفید، تطبیق پایدار می‌شود.
    """
    return "".join(str(text or "").split()).replace("‌", "").lower()


def field_for(header: Any) -> str | None:
    h = _norm(header)
    if not h:
        return None
    for token in IGNORED_HEADERS:
        if _norm(token) in h:
            return None
    for field, keys in HEADER_MAP:  # ترتیب فهرست، اولویت تطبیق است
        for key in keys:
            if _norm(key) in h:
                return field
    return None


def read_rows(data: bytes) -> tuple[list[dict], list[str]]:
    """فایل اکسل را به فهرست دیکشنری تبدیل می‌کند و خطاهای هر سطر را برمی‌گرداند."""
    errors: list[str] = []
    wb = load_workbook(io.BytesIO(data), data_only=True, read_only=True)
    ws = wb[wb.sheetnames[0]]

    rows = list(ws.iter_rows(values_only=True))
    if not rows:
        return [], ["فایل خالی است."]

    headers = rows[0]
    fields = [field_for(h) for h in headers]
    if not any(fields):
        return [], ["سرستون‌های فایل شناسایی نشد. از قالب استاندارد سامانه استفاده کنید."]

    out: list[dict] = []
    for index, raw in enumerate(rows[1:], start=2):
        if all(cell is None or str(cell).strip() == "" for cell in raw):
            continue
        rec: dict[str, Any] = {}
        for pos, field in enumerate(fields):
            if not field or pos >= len(raw):
                continue
            rec[field] = raw[pos]

        number = str(rec.get("contract_number") or "").strip()
        if not number:
            errors.append(f"سطر {index}: شماره قرارداد خالی است.")
            continue

        kind_text = str(rec.get("kind") or "")
        rec["kind"] = "mou" if "تفاهم" in kind_text else "contract"

        section_text = str(rec.get("section") or "").strip()
        rec["section"] = SECTION_BY_FA.get(section_text)
        if rec["section"] is None and section_text:
            errors.append(f"سطر {index}: بخش «{section_text}» شناخته نشد.")

        for date_field in ("numbered_on", "start", "end"):
            jalali, gregorian = normalize_date(rec.get(date_field))
            rec[f"{date_field}_jalali"], rec[f"{date_field}_date"] = jalali, gregorian
            if rec.get(date_field) not in (None, "") and jalali is None:
                errors.append(f"سطر {index}: تاریخ «{rec.get(date_field)}» قابل خواندن نبود.")

        rec["amount_rial"] = parse_amount(rec.get("amount_rial"))
        rec["contract_number"] = number
        rec["_row"] = index
        out.append(rec)

    return out, errors


_HEAD_FILL = PatternFill("solid", fgColor="0B7F89")
_HEAD_FONT = Font(color="FFFFFF", bold=True, size=10)
_BORDER = Border(*(Side(style="thin", color="CFD9DD"),) * 4)


def write_workbook(contracts: Iterable[Contract], today: date | None = None) -> bytes:
    """خروجی اکسل با همان ستون‌های آشنای کاربران."""
    wb = Workbook()
    ws = wb.active
    ws.title = "قراردادها"
    ws.sheet_view.rightToLeft = True

    ws.append([label for _, label in COLUMNS])
    for cell in ws[1]:
        cell.fill, cell.font, cell.border = _HEAD_FILL, _HEAD_FONT, _BORDER
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    ws.row_dimensions[1].height = 46
    ws.freeze_panes = "A2"

    for index, contract in enumerate(contracts, start=1):
        d = derive(contract, today)
        values = {
            "row": index,
            "section": SECTION_FA[contract.section],
            "storage_location": contract.storage_location,
            "kind": KIND_FA[contract.kind],
            "party": contract.party,
            "scan_link": contract.scan_link,
            "addendum": contract.addendum,
            "unit_name": contract.unit.name if contract.unit else "",
            "contract_number": contract.contract_number,
            "numbered_on": contract.numbered_on_jalali or "",
            "start": contract.start_jalali or "",
            "duration_text": contract.duration_text,
            "end": contract.end_jalali or "",
            "status": STATUS_FA[d["status"]],
            "days_remaining": d["days_remaining"],
            "days_elapsed": d["days_elapsed"],
            "subject": contract.subject,
            "amount_rial": int(contract.amount_rial or 0),
            "guarantees": contract.guarantees,
            "counterparty_people": contract.counterparty_people,
            "site": contract.site,
            "capacity": contract.capacity,
            "notes": contract.notes,
            "attachments": len(contract.attachments),
        }
        ws.append([values[key] for key, _ in COLUMNS])

    widths = {"subject": 40, "party": 32, "guarantees": 34, "site": 22,
              "counterparty_people": 28, "notes": 26, "amount_rial": 20}
    for position, (key, _) in enumerate(COLUMNS, start=1):
        ws.column_dimensions[get_column_letter(position)].width = widths.get(key, 15)
    amount_col = get_column_letter([k for k, _ in COLUMNS].index("amount_rial") + 1)
    for row in range(2, ws.max_row + 1):
        ws[f"{amount_col}{row}"].number_format = "#,##0"

    buffer = io.BytesIO()
    wb.save(buffer)
    return buffer.getvalue()


def template_workbook() -> bytes:
    """قالب خالی برای کاربرانی که می‌خواهند دسته‌ای وارد کنند."""
    return write_workbook([])
