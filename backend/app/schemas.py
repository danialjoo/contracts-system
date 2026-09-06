from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

from .models import Kind, Role, Section

_FA_DIGITS = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")


def parse_amount(value: Any) -> int:
    """«۲۴٬۵۰۰٬۰۰۰٬۰۰۰» یا «24,500,000,000» یا 2.45e10 → عدد صحیح ریال."""
    if value in (None, ""):
        return 0
    if isinstance(value, (int, float)):
        return int(value)
    text = str(value).translate(_FA_DIGITS)
    cleaned = "".join(ch for ch in text if ch.isdigit() or ch == ".")
    if not cleaned:
        return 0
    try:
        return int(float(cleaned))
    except ValueError:
        return 0


class LoginIn(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=256)


class PasswordChangeIn(BaseModel):
    current_password: str
    new_password: str


class MeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    username: str
    full_name: str
    role: Role
    must_change_password: bool
    sections: list[Section]


class ContractIn(BaseModel):
    section: Section
    kind: Kind = Kind.contract
    contract_number: str = Field(min_length=1, max_length=80)
    party: str = ""
    subject: str = ""
    unit_name: str = ""
    numbered_on: str = ""
    start: str = ""
    end: str = ""
    duration_text: str = ""
    amount_rial: int = 0
    guarantees: str = ""
    counterparty_people: str = ""
    site: str = ""
    capacity: str = ""
    storage_location: str = ""
    addendum: str = ""
    scan_link: str = ""
    notes: str = ""

    @field_validator("amount_rial", mode="before")
    @classmethod
    def _amount(cls, v: Any) -> int:
        return parse_amount(v)

    @field_validator("scan_link")
    @classmethod
    def _link(cls, v: str) -> str:
        v = (v or "").strip()
        if v and not v.startswith(("http://", "https://", "\\\\", "/")):
            raise ValueError("لینک اسکن باید با http://، https:// یا مسیر شبکه شروع شود.")
        return v


class ContractUpdate(ContractIn):
    version: int = Field(ge=1, description="نسخه‌ای که ویرایش بر پایه آن انجام شده")


class AttachmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    filename: str
    content_type: str
    size_bytes: int
    uploaded_at: datetime


class ContractOut(BaseModel):
    id: int
    section: Section
    section_fa: str
    kind: Kind
    kind_fa: str
    contract_number: str
    party: str
    subject: str
    unit_name: str
    numbered_on_jalali: str | None
    start_jalali: str | None
    end_jalali: str | None
    duration_text: str
    amount_rial: int
    guarantees: str
    counterparty_people: str
    site: str
    capacity: str
    storage_location: str
    addendum: str
    scan_link: str
    notes: str
    version: int
    # محاسباتی — هرگز ذخیره نمی‌شوند
    status: str
    status_fa: str
    days_remaining: int | None
    days_total: int | None
    days_elapsed: int | None
    percent_elapsed: int | None
    attachments: list[AttachmentOut]
    updated_at: datetime
    updated_by: str | None


class ContractPage(BaseModel):
    items: list[ContractOut]
    total: int
    page: int
    per_page: int


class UserIn(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    full_name: str = ""
    password: str
    role: Role = Role.viewer
    sections: list[Section] = []


class UserPatch(BaseModel):
    full_name: str | None = None
    role: Role | None = None
    is_active: bool | None = None
    sections: list[Section] | None = None
    new_password: str | None = None


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    username: str
    full_name: str
    role: Role
    is_active: bool
    must_change_password: bool
    sections: list[Section]
    created_at: datetime


class AuditOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    at: datetime
    username: str
    action: str
    action_fa: str
    entity: str
    entity_id: str | None
    summary: str
    field: str | None
    field_fa: str | None
    old_value: str | None
    new_value: str | None
    ip: str


class AuditPage(BaseModel):
    items: list[AuditOut]
    total: int
    page: int
    per_page: int


class ImportReport(BaseModel):
    dry_run: bool
    total_rows: int
    ready: int
    skipped: int
    errors: list[str]
    imported: int = 0
