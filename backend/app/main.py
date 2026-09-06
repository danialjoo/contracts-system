from __future__ import annotations

import logging
from pathlib import Path

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text

from .config import settings
from .db import engine
from .routers import attachments, audit_view, auth, contracts, imports, users

log = logging.getLogger("contracts")

app = FastAPI(
    title="سامانه مدیریت قراردادها",
    docs_url=None, redoc_url=None, openapi_url=None,  # سطح حمله کمتر در محیط داخلی
)

app.include_router(auth.router)
app.include_router(contracts.router)
app.include_router(attachments.router)
app.include_router(imports.router)
app.include_router(users.router)
app.include_router(audit_view.router)


@app.exception_handler(RequestValidationError)
async def validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
    """پیام خطای فارسی به‌جای ساختار پیش‌فرض انگلیسی FastAPI."""
    first = exc.errors()[0] if exc.errors() else {}
    field = ".".join(str(p) for p in first.get("loc", [])[1:]) or "ورودی"
    message = first.get("msg", "مقدار نامعتبر است.")
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={"detail": f"«{field}»: {message}"},
    )


@app.get("/api/health")
def health() -> dict:
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
    except Exception:  # noqa: BLE001
        log.exception("health check failed")
        return JSONResponse(status_code=503, content={"status": "db_unavailable"})
    return {"status": "ok"}


@app.get("/api/meta")
def meta() -> dict:
    return {"expiring_days": settings.expiring_days,
            "max_upload_mb": settings.max_upload_mb}


# فرانت‌اند به‌صورت فایل ایستا از همین سرویس سرو می‌شود تا استقرار یک‌تکه بماند.
FRONTEND = Path(__file__).resolve().parents[2] / "frontend"
if FRONTEND.is_dir():
    app.mount("/static", StaticFiles(directory=FRONTEND), name="static")

    @app.get("/")
    def index() -> FileResponse:
        return FileResponse(FRONTEND / "index.html")

    @app.get("/login")
    def login_page() -> FileResponse:
        return FileResponse(FRONTEND / "login.html")
