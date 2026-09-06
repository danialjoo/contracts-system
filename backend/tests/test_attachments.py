from tests.conftest import HR_PW, contract_payload, login

PDF = b"%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF\n"
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 40
SVG = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
HTML = b"<html><script>alert(1)</script></html>"


def upload(client, contract_id, name, data):
    return client.post(f"/api/attachments/contract/{contract_id}",
                       files={"file": (name, data, "application/octet-stream")})


def test_pdf_upload_and_inline_preview(tech):
    made = tech.post("/api/contracts", json=contract_payload()).json()
    created = upload(tech, made["id"], "قرارداد.pdf", PDF)
    assert created.status_code == 201
    attachment_id = created.json()["id"]

    preview = tech.get(f"/api/attachments/{attachment_id}/inline")
    assert preview.status_code == 200
    assert preview.headers["content-type"] == "application/pdf"
    assert preview.headers["content-disposition"] == "inline"
    assert preview.headers["x-content-type-options"] == "nosniff"
    assert "sandbox" in preview.headers["content-security-policy"]


def test_png_is_allowed(tech):
    made = tech.post("/api/contracts", json=contract_payload()).json()
    assert upload(tech, made["id"], "scan.png", PNG).status_code == 201


def test_svg_and_html_are_refused_even_with_pdf_extension(tech):
    made = tech.post("/api/contracts", json=contract_payload()).json()
    assert upload(tech, made["id"], "x.pdf", SVG).status_code == 415
    assert upload(tech, made["id"], "x.pdf", HTML).status_code == 415


def test_extension_lie_does_not_beat_signature_check(tech):
    made = tech.post("/api/contracts", json=contract_payload()).json()
    ok = upload(tech, made["id"], "totally-a-doc.txt", PDF)
    assert ok.status_code == 201
    assert ok.json()["content_type"] == "application/pdf"


def test_attachment_respects_section_boundary(client, tech):
    made = tech.post("/api/contracts", json=contract_payload()).json()
    attachment_id = upload(tech, made["id"], "s.pdf", PDF).json()["id"]

    login(client, "hr", HR_PW)
    assert client.get(f"/api/attachments/{attachment_id}/inline").status_code == 404


def test_delete_removes_file_and_is_audited(admin):
    made = admin.post("/api/contracts", json=contract_payload()).json()
    attachment_id = upload(admin, made["id"], "s.pdf", PDF).json()["id"]
    assert admin.delete(f"/api/attachments/{attachment_id}").status_code == 204
    assert admin.get(f"/api/attachments/{attachment_id}/inline").status_code == 404

    actions = [r["action"] for r in admin.get("/api/audit").json()["items"]]
    assert "attachment_added" in actions and "attachment_deleted" in actions
