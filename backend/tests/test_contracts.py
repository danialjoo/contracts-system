from tests.conftest import HR_PW, contract_payload, login


def test_create_normalizes_persian_digits_and_amount(tech):
    resp = tech.post("/api/contracts", json=contract_payload())
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["amount_rial"] == 24_500_000_000_000
    assert body["start_jalali"] == "1403/04/15"
    assert body["unit_name"] == "فنی و مهندسی"
    assert body["version"] == 1


def test_gregorian_dates_are_stored_as_jalali(tech):
    resp = tech.post("/api/contracts", json=contract_payload(
        contract_number="G-1", start="2024/07/05", end="2027/07/05"))
    assert resp.status_code == 201
    assert resp.json()["start_jalali"] == "1403/04/15"


def test_end_before_start_is_rejected(tech):
    resp = tech.post("/api/contracts", json=contract_payload(
        contract_number="BAD-1", start="۱۴۰۵/۰۶/۱۵", end="۱۴۰۴/۰۶/۱۵"))
    assert resp.status_code == 422
    assert "پیش از تاریخ شروع" in resp.json()["detail"]


def test_unreadable_date_is_rejected(tech):
    resp = tech.post("/api/contracts", json=contract_payload(
        contract_number="BAD-2", start="سلام"))
    assert resp.status_code == 422


def test_duplicate_contract_number_conflicts(tech):
    assert tech.post("/api/contracts", json=contract_payload()).status_code == 201
    again = tech.post("/api/contracts", json=contract_payload(subject="دیگر"))
    assert again.status_code == 409


def test_status_is_derived_not_stored(tech):
    live = tech.post("/api/contracts", json=contract_payload(
        contract_number="L-1", start="۱۴۰۵/۰۱/۰۱", end="۱۴۰۸/۰۱/۰۱")).json()
    over = tech.post("/api/contracts", json=contract_payload(
        contract_number="O-1", start="۱۴۰۱/۰۱/۰۱", end="۱۴۰۲/۰۱/۰۱")).json()
    assert live["status"] == "live" and live["status_fa"] == "جاری"
    assert over["status"] == "over" and over["days_remaining"] < 0
    assert over["percent_elapsed"] == 100


def test_optimistic_lock_blocks_stale_write(tech):
    created = tech.post("/api/contracts", json=contract_payload()).json()
    first = tech.put(f"/api/contracts/{created['id']}",
                     json=contract_payload(subject="ویرایش اول", version=created["version"]))
    assert first.status_code == 200
    assert first.json()["version"] == 2

    stale = tech.put(f"/api/contracts/{created['id']}",
                     json=contract_payload(subject="ویرایش دوم", version=created["version"]))
    assert stale.status_code == 409
    assert "کاربر دیگری" in stale.json()["detail"]


def test_delete_is_soft_and_hides_the_row(tech):
    created = tech.post("/api/contracts", json=contract_payload()).json()
    assert tech.delete(f"/api/contracts/{created['id']}").status_code == 204
    assert tech.get(f"/api/contracts/{created['id']}").status_code == 404
    assert tech.get("/api/contracts").json()["total"] == 0

    from app.db import SessionLocal
    from app.models import Contract
    with SessionLocal() as db:
        row = db.get(Contract, created["id"])
        assert row is not None and row.deleted_at is not None


def test_section_is_a_hard_confidentiality_boundary(client, tech):
    made = tech.post("/api/contracts", json=contract_payload()).json()

    login(client, "hr", HR_PW)
    # کاربر منابع انسانی نباید قرارداد فنی را ببیند و نباید بفهمد وجود دارد.
    assert client.get(f"/api/contracts/{made['id']}").status_code == 404
    assert client.get("/api/contracts").json()["total"] == 0
    denied = client.post("/api/contracts", json=contract_payload(contract_number="HR-X"))
    assert denied.status_code == 404


def test_search_and_status_filters(tech):
    tech.post("/api/contracts", json=contract_payload())
    tech.post("/api/contracts", json=contract_payload(
        contract_number="۱۴۰۲/ق-۱۵۴", party="بانک صنعت و معدن",
        subject="تأمین مالی بادی خواف", start="۱۴۰۱/۰۱/۰۱", end="۱۴۰۲/۰۱/۰۱"))

    assert tech.get("/api/contracts", params={"q": "خواف"}).json()["total"] == 1
    assert tech.get("/api/contracts", params={"q": "ساتبا"}).json()["total"] == 1
    over = tech.get("/api/contracts", params={"status": "over"}).json()["items"]
    assert len(over) == 1 and over[0]["party"] == "بانک صنعت و معدن"


def test_sections_come_back_in_business_order(admin):
    """فنی، مالی، منابع انسانی — نه ترتیب الفبایی انگلیسی."""
    me = admin.get("/api/auth/me").json()
    assert me["sections"] == ["technical", "financial", "hr"]


def test_placeholder_dash_is_not_accepted_as_a_date(tech):
    resp = tech.post("/api/contracts", json=contract_payload(
        contract_number="DASH-1", start="—", end="—"))
    assert resp.status_code == 422


def test_blank_dates_are_allowed(tech):
    resp = tech.post("/api/contracts", json=contract_payload(
        contract_number="BLANK-1", numbered_on="", start="", end=""))
    assert resp.status_code == 201
    body = resp.json()
    assert body["start_jalali"] is None
    assert body["status"] == "unknown" and body["days_remaining"] is None
