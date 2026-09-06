"""پیوست اسکن قراردادها، با پیش‌نمایش درون‌مرورگری.

نکته امنیتی: نمایش inline فایلی که کاربر آپلود کرده می‌تواند به اجرای
اسکریپت در دامنه سامانه منجر شود. بنابراین فقط PDF/JPG/PNG پذیرفته
می‌شود، نوع فایل از روی امضای بایتی بررسی می‌شود نه پسوند، و پاسخ با
CSP سخت‌گیرانه و nosniff ارسال می‌گردد. SVG و HTML هرگز پذیرفته نیستند.
"""
from __future__ import annotations

import hashlib
import secrets

from fastapi import (
    APIRouter, Depends, File, HTTPException, Request, Response, UploadFile, status,
)
from sqlalchemy.orm import Session

from .. import audit
from ..config import settings
from ..db import get_db
from ..deps import assert_section_access, client_ip, current_user, require_write
from ..models import Attachment, Contract, User
from ..schemas import AttachmentOut

router = APIRouter(prefix="/api/attachments", tags=["attachments"])

# امضای بایتی → نوع محتوا. فقط همین سه نوع.
SIGNATURES: tuple[tuple[bytes, str, str], ...] = (
    (b"%PDF-", "application/pdf", ".pdf"),
    (b"\x89PNG\r\n\x1a\n", "image/png", ".png"),
    (b"\xff\xd8\xff", "image/jpeg", ".jpg"),
)

# هر فایلی که inline نمایش داده می‌شود با این سرایندها می‌رود.
SAFE_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "sandbox; default-src 'none'; object-src 'none'; base-uri 'none'",
    "Cache-Control": "private, no-store",
    "Referrer-Policy": "no-referrer",
}


def sniff(head: bytes) -> tuple[str, str] | None:
    for magic, content_type, suffix in SIGNATURES:
        if head.startswith(magic):
            return content_type, suffix
    return None


def _load(attachment_id: int, db: Session, user: User) -> Attachment:
    attachment = db.get(Attachment, attachment_id)
    if attachment is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "پیوست یافت نشد.")
    contract = attachment.contract
    if contract is None or contract.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "پیوست یافت نشد.")
    assert_section_access(user, contract.section)
    return attachment


def _read(attachment: Attachment) -> bytes:
    path = settings.upload_dir / attachment.stored_name
    if not path.is_file():
        raise HTTPException(status.HTTP_410_GONE, "فایل روی سرور یافت نشد. با مدیر سامانه تماس بگیرید.")
    return path.read_bytes()


@router.post("/contract/{contract_id}", response_model=AttachmentOut,
             status_code=status.HTTP_201_CREATED)
async def upload(contract_id: int, request: Request, file: UploadFile = File(...),
                 db: Session = Depends(get_db),
                 user: User = Depends(require_write)) -> AttachmentOut:
    contract = db.get(Contract, contract_id)
    if contract is None or contract.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "قرارداد یافت نشد.")
    assert_section_access(user, contract.section)

    payload = await file.read(settings.max_upload_bytes + 1)
    if len(payload) > settings.max_upload_bytes:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                            f"حجم فایل نباید از {settings.max_upload_mb} مگابایت بیشتر باشد.")
    if not payload:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "فایل خالی است.")

    detected = sniff(payload[:16])
    if detected is None:
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
                            "فقط فایل PDF، JPG و PNG پذیرفته می‌شود.")
    content_type, suffix = detected

    digest = hashlib.sha256(payload).hexdigest()
    stored_name = f"{digest[:32]}-{secrets.token_hex(6)}{suffix}"
    settings.upload_dir.mkdir(parents=True, exist_ok=True)
    (settings.upload_dir / stored_name).write_bytes(payload)

    attachment = Attachment(
        contract_id=contract.id,
        filename=(file.filename or "scan")[:300],
        content_type=content_type,
        size_bytes=len(payload),
        sha256=digest,
        stored_name=stored_name,
        uploaded_by_id=user.id,
    )
    db.add(attachment)
    db.flush()

    audit.record(db, actor=user, action="attachment_added", entity="contract",
                 entity_id=contract.id,
                 summary=f"{contract.contract_number} — پیوست «{attachment.filename}» ({len(payload)} بایت)",
                 ip=client_ip(request), user_agent=request.headers.get("user-agent", ""))
    db.commit()
    return AttachmentOut.model_validate(attachment)


@router.get("/{attachment_id}/inline")
def preview(attachment_id: int, request: Request, db: Session = Depends(get_db),
            user: User = Depends(current_user)) -> Response:
    """پیش‌نمایش داخل سامانه. مرورگر PDF و تصویر را خودش نمایش می‌دهد."""
    attachment = _load(attachment_id, db, user)
    body = _read(attachment)
    audit.record(db, actor=user, action="attachment_viewed", entity="contract",
                 entity_id=attachment.contract_id,
                 summary=f"مشاهده پیوست «{attachment.filename}»",
                 ip=client_ip(request), user_agent=request.headers.get("user-agent", ""))
    db.commit()
    return Response(content=body, media_type=attachment.content_type,
                    headers={**SAFE_HEADERS, "Content-Disposition": "inline"})


@router.get("/{attachment_id}/download")
def download(attachment_id: int, db: Session = Depends(get_db),
             user: User = Depends(current_user)) -> Response:
    attachment = _load(attachment_id, db, user)
    # نام فایل اصلی ممکن است فارسی باشد؛ طبق RFC 5987 کدگذاری می‌شود.
    quoted = attachment.filename.encode("utf-8").hex()
    ascii_name = f"attachment-{attachment.id}"
    disposition = (f"attachment; filename=\"{ascii_name}\"; "
                   f"filename*=UTF-8''{''.join('%' + quoted[i:i+2] for i in range(0, len(quoted), 2))}")
    return Response(content=_read(attachment), media_type=attachment.content_type,
                    headers={**SAFE_HEADERS, "Content-Disposition": disposition})


@router.delete("/{attachment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete(attachment_id: int, request: Request, db: Session = Depends(get_db),
           user: User = Depends(require_write)) -> Response:
    attachment = _load(attachment_id, db, user)
    contract_id, filename = attachment.contract_id, attachment.filename
    path = settings.upload_dir / attachment.stored_name

    db.delete(attachment)
    audit.record(db, actor=user, action="attachment_deleted", entity="contract",
                 entity_id=contract_id, summary=f"حذف پیوست «{filename}»",
                 ip=client_ip(request), user_agent=request.headers.get("user-agent", ""))
    db.commit()
    path.unlink(missing_ok=True)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
