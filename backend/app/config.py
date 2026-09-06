from __future__ import annotations

import os
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


def _default_upload_dir() -> Path:
    """محل پیش‌فرض نگهداری پیوست‌ها.

    در کانتینر لینوکسی /data/uploads است. روی ویندوز آن مسیر به ریشه درایو
    می‌افتد که هم جای مناسبی نیست و هم معمولاً نوشتن در آن مجوز ادمین
    می‌خواهد، پس کنار خود پروژه ساخته می‌شود.
    """
    if os.name == "nt":
        return Path(__file__).resolve().parents[2] / "data" / "uploads"
    return Path("/data/uploads")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="APP_", extra="ignore")

    database_url: str = "postgresql+psycopg://contracts:contracts@db:5432/contracts"
    secret_key: str = "change-me-in-env"

    # نشست
    session_hours: int = 10
    session_cookie: str = "cs_session"
    csrf_cookie: str = "cs_csrf"
    cookie_secure: bool = False  # روی HTTP داخلی False؛ پشت TLS True شود

    # قفل شدن حساب پس از تلاش ناموفق
    max_failed_logins: int = 5
    lockout_minutes: int = 15

    # پیوست‌ها
    upload_dir: Path = _default_upload_dir()
    max_upload_mb: int = 20

    # مسیر فرانت‌اند؛ خالی بماند خودش پیدا می‌کند.
    frontend_dir: Path | None = None

    # هشدار انقضا
    expiring_days: int = 90

    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_mb * 1024 * 1024


settings = Settings()
