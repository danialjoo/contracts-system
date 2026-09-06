from __future__ import annotations

import os
import tempfile
from pathlib import Path

import pytest

TMP = Path(tempfile.mkdtemp(prefix="contracts-test-"))
os.environ["APP_DATABASE_URL"] = os.environ.get(
    "TEST_DATABASE_URL",
    "postgresql+psycopg://test@/contracts_test?host=/tmp&port=55432",
)
os.environ["APP_UPLOAD_DIR"] = str(TMP / "uploads")
os.environ["APP_SECRET_KEY"] = "test-secret"

from fastapi.testclient import TestClient  # noqa: E402

from app.db import Base, SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Role, Section, User, UserSection  # noqa: E402
from app.security import hash_password  # noqa: E402

ADMIN_PW = "Admin-Passw0rd!"
TECH_PW = "Tech-Passw0rd!"
HR_PW = "HrOnly-Passw0rd!"
VIEW_PW = "Viewer-Passw0rd!"


@pytest.fixture(autouse=True)
def fresh_db():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        def make(username, role, sections, password):
            u = User(username=username, full_name=username,
                     password_hash=hash_password(password), role=role,
                     must_change_password=False)
            u.sections = [UserSection(section=s) for s in sections]
            db.add(u)

        make("admin", Role.admin, list(Section), ADMIN_PW)
        make("tech", Role.editor, [Section.technical], TECH_PW)
        make("hr", Role.editor, [Section.hr], HR_PW)
        make("viewer", Role.viewer, list(Section), VIEW_PW)
        db.commit()
    yield


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


def login(client, username: str, password: str):
    resp = client.post("/api/auth/login", json={"username": username, "password": password})
    assert resp.status_code == 200, resp.text
    client.headers["X-CSRF-Token"] = client.cookies.get("cs_csrf")
    return resp.json()


@pytest.fixture
def admin(client):
    login(client, "admin", ADMIN_PW)
    return client


@pytest.fixture
def tech(client):
    login(client, "tech", TECH_PW)
    return client


def contract_payload(**over):
    base = {
        "section": "technical", "kind": "contract",
        "contract_number": "۱۴۰۳/ق-۲۱۷", "party": "ساتبا",
        "subject": "احداث نیروگاه خورشیدی ابرکوه",
        "unit_name": "فنی و مهندسی",
        "start": "۱۴۰۳/۰۴/۱۵", "end": "۱۴۰۶/۰۴/۱۵",
        "duration_text": "۳۶ ماه", "amount_rial": "۲۴٬۵۰۰٬۰۰۰٬۰۰۰٬۰۰۰",
        "site": "ابرکوه، یزد", "capacity": "۱۰۰ مگاوات",
    }
    base.update(over)
    return base
