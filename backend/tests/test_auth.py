from app.config import settings
from tests.conftest import ADMIN_PW, VIEW_PW, login


def test_login_sets_session_and_csrf_cookies(client):
    body = login(client, "admin", ADMIN_PW)
    assert body["username"] == "admin"
    assert body["role"] == "admin"
    assert set(body["sections"]) == {"technical", "financial", "hr"}
    assert client.cookies.get(settings.session_cookie)
    assert client.cookies.get(settings.csrf_cookie)


def test_wrong_password_is_rejected_and_counts_down(client):
    resp = client.post("/api/auth/login", json={"username": "admin", "password": "nope"})
    assert resp.status_code == 401
    assert "تلاش تا قفل" in resp.json()["detail"]


def test_unknown_user_gives_same_generic_message(client):
    resp = client.post("/api/auth/login", json={"username": "ghost", "password": "nope"})
    assert resp.status_code == 401
    assert "نادرست" in resp.json()["detail"]


def test_account_locks_after_repeated_failures(client):
    for _ in range(settings.max_failed_logins):
        client.post("/api/auth/login", json={"username": "admin", "password": "nope"})
    resp = client.post("/api/auth/login", json={"username": "admin", "password": ADMIN_PW})
    assert resp.status_code == 401
    assert "قفل" in resp.json()["detail"]


def test_anonymous_cannot_reach_contracts(client):
    assert client.get("/api/contracts").status_code == 401


def test_mutation_without_csrf_header_is_blocked(admin):
    del admin.headers["X-CSRF-Token"]
    resp = admin.post("/api/contracts", json={"section": "technical", "contract_number": "x"})
    assert resp.status_code == 403
    assert "توکن امنیتی" in resp.json()["detail"]


def test_logout_revokes_the_session(admin):
    assert admin.post("/api/auth/logout").status_code == 204
    assert admin.get("/api/auth/me").status_code == 401


def test_viewer_cannot_write(client):
    login(client, "viewer", VIEW_PW)
    resp = client.post("/api/contracts", json={"section": "technical",
                                               "contract_number": "۱۴۰۵/ق-۱"})
    assert resp.status_code == 403
    assert "فقط مشاهده" in resp.json()["detail"]


def test_password_change_rejects_weak_and_accepts_strong(admin):
    weak = admin.post("/api/auth/password",
                      json={"current_password": ADMIN_PW, "new_password": "123"})
    assert weak.status_code == 400

    ok = admin.post("/api/auth/password",
                    json={"current_password": ADMIN_PW, "new_password": "Str0ng-New-Pass"})
    assert ok.status_code == 200
    assert ok.json()["must_change_password"] is False
