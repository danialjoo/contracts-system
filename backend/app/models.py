from __future__ import annotations

import enum
from datetime import date, datetime, timezone

from sqlalchemy import (
    BigInteger, Boolean, Date, DateTime, Enum, ForeignKey, Index, Integer,
    Numeric, String, Text, UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Section(str, enum.Enum):
    """سه بخش سامانه. مرز دسترسی است، نه صرفاً برچسب."""
    technical = "technical"   # فنی
    financial = "financial"   # امور مالی
    hr = "hr"                 # منابع انسانی


SECTION_FA = {
    Section.technical: "فنی",
    Section.financial: "امور مالی",
    Section.hr: "منابع انسانی",
}

# ترتیب نمایش بخش‌ها در سامانه، به همان ترتیبی که کارفرما تعریف کرد.
SECTION_ORDER = [Section.technical, Section.financial, Section.hr]


def ordered_sections(sections) -> list[Section]:
    return sorted(sections, key=SECTION_ORDER.index)


class Role(str, enum.Enum):
    admin = "admin"     # مدیر سامانه
    editor = "editor"   # کارشناس: ثبت و ویرایش در بخش‌های مجاز
    viewer = "viewer"   # فقط مشاهده


class Kind(str, enum.Enum):
    contract = "contract"   # قرارداد
    mou = "mou"             # تفاهم‌نامه


KIND_FA = {Kind.contract: "قرارداد", Kind.mou: "تفاهم‌نامه"}


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    full_name: Mapped[str] = mapped_column(String(160), default="")
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[Role] = mapped_column(Enum(Role, native_enum=False), default=Role.viewer)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    must_change_password: Mapped[bool] = mapped_column(Boolean, default=True)
    failed_attempts: Mapped[int] = mapped_column(Integer, default=0)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    sections: Mapped[list["UserSection"]] = relationship(
        back_populates="user", cascade="all, delete-orphan", lazy="selectin"
    )

    @property
    def allowed_sections(self) -> set[Section]:
        """مدیر سامانه به همه بخش‌ها دسترسی دارد."""
        if self.role == Role.admin:
            return set(Section)
        return {s.section for s in self.sections}


class UserSection(Base):
    __tablename__ = "user_sections"
    __table_args__ = (UniqueConstraint("user_id", "section", name="uq_user_section"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    section: Mapped[Section] = mapped_column(Enum(Section, native_enum=False))

    user: Mapped[User] = relationship(back_populates="sections")


class UserSession(Base):
    __tablename__ = "sessions"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    csrf_token: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ip: Mapped[str] = mapped_column(String(64), default="")
    user_agent: Mapped[str] = mapped_column(String(300), default="")

    user: Mapped[User] = relationship(lazy="joined")


class Unit(Base):
    """واحد مربوطه — فهرست کمکی."""
    __tablename__ = "units"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120), unique=True)


class Contract(Base):
    """قرارداد یا تفاهم‌نامه — پوشش کامل ۲۴ ستون فایل اکسل موجود."""
    __tablename__ = "contracts"
    __table_args__ = (
        UniqueConstraint("contract_number", name="uq_contract_number"),
        Index("ix_contracts_section_deleted", "section", "deleted_at"),
        Index("ix_contracts_end_date", "end_date"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    section: Mapped[Section] = mapped_column(Enum(Section, native_enum=False), index=True)
    kind: Mapped[Kind] = mapped_column(Enum(Kind, native_enum=False), default=Kind.contract)

    contract_number: Mapped[str] = mapped_column(String(80))          # شماره قرارداد/تفاهم‌نامه
    party: Mapped[str] = mapped_column(String(300), default="")        # طرف قرارداد
    subject: Mapped[str] = mapped_column(Text, default="")             # موضوع
    unit_id: Mapped[int | None] = mapped_column(ForeignKey("units.id"), nullable=True)  # واحد مربوطه

    # تاریخ‌ها: متن شمسی برای نمایش + معادل میلادی برای پرس‌وجوی بازه‌ای
    numbered_on_jalali: Mapped[str | None] = mapped_column(String(12), nullable=True)
    numbered_on_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    start_jalali: Mapped[str | None] = mapped_column(String(12), nullable=True)
    start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    end_jalali: Mapped[str | None] = mapped_column(String(12), nullable=True)
    end_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    duration_text: Mapped[str] = mapped_column(String(80), default="")  # مدت

    amount_rial: Mapped[int] = mapped_column(Numeric(20, 0), default=0)  # مبلغ/تأمین مالی
    guarantees: Mapped[str] = mapped_column(Text, default="")            # تضامین
    counterparty_people: Mapped[str] = mapped_column(Text, default="")   # عوامل طرف قرارداد
    site: Mapped[str] = mapped_column(String(300), default="")           # ساختگاه/محل اجرا
    capacity: Mapped[str] = mapped_column(String(120), default="")       # ظرفیت
    storage_location: Mapped[str] = mapped_column(String(200), default="")  # محل نگهداری اصل
    addendum: Mapped[str] = mapped_column(Text, default="")              # الحاقیه
    scan_link: Mapped[str] = mapped_column(String(500), default="")      # لینک اسکن (ارجاع خارجی)
    notes: Mapped[str] = mapped_column(Text, default="")                 # سایر موارد

    version: Mapped[int] = mapped_column(Integer, default=1)  # قفل خوش‌بینانه
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    updated_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    deleted_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)

    unit: Mapped[Unit | None] = relationship(lazy="joined")
    attachments: Mapped[list["Attachment"]] = relationship(
        back_populates="contract", cascade="all, delete-orphan", lazy="selectin"
    )


class Attachment(Base):
    """اسکن قرارداد. فقط PDF/JPG/PNG — با بررسی امضای فایل."""
    __tablename__ = "attachments"

    id: Mapped[int] = mapped_column(primary_key=True)
    contract_id: Mapped[int] = mapped_column(ForeignKey("contracts.id", ondelete="CASCADE"), index=True)
    filename: Mapped[str] = mapped_column(String(300))
    content_type: Mapped[str] = mapped_column(String(80))
    size_bytes: Mapped[int] = mapped_column(BigInteger)
    sha256: Mapped[str] = mapped_column(String(64), index=True)
    stored_name: Mapped[str] = mapped_column(String(80))
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    uploaded_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)

    contract: Mapped[Contract] = relationship(back_populates="attachments")


class AuditLog(Base):
    """فقط افزودنی. هیچ مسیری در برنامه آن را UPDATE یا DELETE نمی‌کند."""
    __tablename__ = "audit_log"
    __table_args__ = (
        Index("ix_audit_entity", "entity", "entity_id"),
        Index("ix_audit_at", "at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    username: Mapped[str] = mapped_column(String(64), default="")   # عکس لحظه‌ای نام کاربر
    action: Mapped[str] = mapped_column(String(40), index=True)
    entity: Mapped[str] = mapped_column(String(40), default="")
    entity_id: Mapped[str | None] = mapped_column(String(40), nullable=True)
    summary: Mapped[str] = mapped_column(Text, default="")
    field: Mapped[str | None] = mapped_column(String(60), nullable=True)
    old_value: Mapped[str | None] = mapped_column(Text, nullable=True)
    new_value: Mapped[str | None] = mapped_column(Text, nullable=True)
    ip: Mapped[str] = mapped_column(String(64), default="")
    user_agent: Mapped[str] = mapped_column(String(300), default="")
