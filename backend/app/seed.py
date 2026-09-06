"""ایجاد داده اولیه. چند بار اجرا شدنش مشکلی ایجاد نمی‌کند."""
from __future__ import annotations

import os
import secrets
import sys

from sqlalchemy import select

from .db import Base, SessionLocal, engine
from .models import Role, Section, Unit, User, UserSection
from .security import hash_password

DEFAULT_UNITS = [
    "امور قراردادها", "مالی", "فنی و مهندسی", "حقوقی",
    "سرمایه‌گذاری", "بهره‌برداری", "منابع انسانی", "تحقیق و توسعه",
]


def run() -> None:
    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        for name in DEFAULT_UNITS:
            if db.scalar(select(Unit).where(Unit.name == name)) is None:
                db.add(Unit(name=name))

        admin = db.scalar(select(User).where(User.role == Role.admin))
        if admin is None:
            username = os.environ.get("APP_ADMIN_USERNAME", "admin").strip().lower()
            password = os.environ.get("APP_ADMIN_PASSWORD") or secrets.token_urlsafe(12)
            admin = User(
                username=username,
                full_name="مدیر سامانه",
                password_hash=hash_password(password),
                role=Role.admin,
                must_change_password=True,
            )
            admin.sections = [UserSection(section=s) for s in Section]
            db.add(admin)
            db.commit()
            print("=" * 62, file=sys.stderr)
            print(f"  کاربر مدیر ساخته شد → نام کاربری: {username}", file=sys.stderr)
            print(f"  رمز عبور اولیه: {password}", file=sys.stderr)
            print("  در اولین ورود حتماً تغییرش دهید.", file=sys.stderr)
            print("=" * 62, file=sys.stderr)
        else:
            db.commit()


if __name__ == "__main__":
    run()
