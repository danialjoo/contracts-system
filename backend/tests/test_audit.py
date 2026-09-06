from tests.conftest import ADMIN_PW, contract_payload


def actions(admin, **params):
    return [r["action"] for r in admin.get("/api/audit", params=params).json()["items"]]


def test_login_and_failure_are_recorded(admin):
    assert "login" in actions(admin)
    admin.post("/api/auth/login", json={"username": "admin", "password": "wrong"})
    assert "login_failed" in actions(admin)


def test_create_records_every_field(admin):
    made = admin.post("/api/contracts", json=contract_payload()).json()
    rows = admin.get("/api/audit", params={"action": "contract_created",
                                           "entity_id": made["id"]}).json()["items"]
    fields = {r["field"] for r in rows}
    assert {"contract_number", "party", "subject", "amount_rial", "section"} <= fields
    number_row = next(r for r in rows if r["field"] == "contract_number")
    assert number_row["old_value"] is None
    assert number_row["new_value"] == "۱۴۰۳/ق-۲۱۷"


def test_update_records_only_changed_fields_with_before_and_after(admin):
    made = admin.post("/api/contracts", json=contract_payload()).json()
    admin.put(f"/api/contracts/{made['id']}", json=contract_payload(
        subject="موضوع تازه", amount_rial=999, version=made["version"]))

    rows = admin.get("/api/audit", params={"action": "contract_updated"}).json()["items"]
    changed = {r["field"]: (r["old_value"], r["new_value"]) for r in rows}
    assert changed["subject"] == ("احداث نیروگاه خورشیدی ابرکوه", "موضوع تازه")
    assert changed["amount_rial"] == ("24500000000000", "999")
    assert "party" not in changed  # فیلد بدون تغییر ثبت نمی‌شود


def test_no_change_means_no_audit_row(admin):
    made = admin.post("/api/contracts", json=contract_payload()).json()
    before = len(admin.get("/api/audit", params={"action": "contract_updated"}).json()["items"])
    admin.put(f"/api/contracts/{made['id']}", json=contract_payload(version=made["version"]))
    after = len(admin.get("/api/audit", params={"action": "contract_updated"}).json()["items"])
    assert before == after == 0


def test_delete_and_export_are_recorded(admin):
    made = admin.post("/api/contracts", json=contract_payload()).json()
    admin.delete(f"/api/contracts/{made['id']}")
    admin.get("/api/contracts/export")
    recorded = actions(admin)
    assert "contract_deleted" in recorded and "excel_exported" in recorded


def test_denied_access_is_recorded(tech):
    assert tech.get("/api/users").status_code == 403
    # کارشناس به صفحه ممیزی دسترسی ندارد، پس با حساب مدیر بررسی می‌کنیم.
    tech.post("/api/auth/logout")
    tech.post("/api/auth/login", json={"username": "admin", "password": ADMIN_PW})
    tech.headers["X-CSRF-Token"] = tech.cookies.get("cs_csrf")
    assert "access_denied" in actions(tech)


def test_audit_is_admin_only(tech):
    assert tech.get("/api/audit").status_code == 403


def test_audit_records_unit_by_name_not_numeric_id(admin):
    """ممیزی را آدم می‌خواند: «فنی و مهندسی» باید ثبت شود، نه «۳»."""
    admin.post("/api/contracts", json=contract_payload())
    rows = admin.get("/api/audit", params={"action": "contract_created"}).json()["items"]
    unit_row = next(r for r in rows if r["field"] == "unit_name")
    assert unit_row["new_value"] == "فنی و مهندسی"
    assert unit_row["field_fa"] == "واحد مربوطه"
    assert not any(r["field"] == "unit_id" for r in rows)


def test_changing_the_unit_shows_both_names(admin):
    made = admin.post("/api/contracts", json=contract_payload()).json()
    admin.put(f"/api/contracts/{made['id']}",
              json=contract_payload(unit_name="حقوقی", version=made["version"]))
    rows = admin.get("/api/audit", params={"action": "contract_updated"}).json()["items"]
    row = next(r for r in rows if r["field"] == "unit_name")
    assert (row["old_value"], row["new_value"]) == ("فنی و مهندسی", "حقوقی")
