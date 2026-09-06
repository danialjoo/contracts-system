"""فرانت‌اند باید در هر دو چیدمان پیدا شود.

این تست به‌خاطر باگی نوشته شد که فقط داخل داکر ظاهر می‌شد: مسیر نسبت به
main.py در ایمیج (/srv/app) با توسعه محلی (backend/app) فرق دارد و برنامه
دنبال /frontend می‌گشت که وجود نداشت.
"""
from pathlib import Path

from app.main import find_frontend


def test_frontend_is_found_in_the_local_layout():
    found = find_frontend()
    assert found is not None
    assert (found / "index.html").is_file()
    assert (found / "app.js").is_file()
    assert (found / "login.html").is_file()


def test_docker_layout_would_resolve(tmp_path, monkeypatch):
    """شبیه‌سازی چیدمان ایمیج: /srv/app/main.py و /srv/frontend"""
    srv = tmp_path / "srv"
    (srv / "app").mkdir(parents=True)
    (srv / "frontend").mkdir()
    (srv / "frontend" / "index.html").write_text("<h1>ok</h1>", encoding="utf-8")

    import app.main as main
    monkeypatch.setattr(main, "__file__", str(srv / "app" / "main.py"))
    assert find_frontend() == srv / "frontend"


def test_explicit_setting_wins(tmp_path, monkeypatch):
    custom = tmp_path / "custom"
    custom.mkdir()
    (custom / "index.html").write_text("<h1>ok</h1>", encoding="utf-8")

    from app.config import settings
    monkeypatch.setattr(settings, "frontend_dir", custom)
    assert find_frontend() == custom


def test_missing_frontend_returns_none(tmp_path, monkeypatch):
    import app.main as main
    monkeypatch.setattr(main, "__file__", str(tmp_path / "nowhere" / "app" / "main.py"))
    from app.config import settings
    monkeypatch.setattr(settings, "frontend_dir", None)
    assert find_frontend() is None


def test_upload_dir_default_is_platform_aware():
    """روی ویندوز مسیر پیش‌فرض نباید به ریشه درایو بیفتد."""
    import os
    from app.config import _default_upload_dir

    resolved = _default_upload_dir()
    if os.name == "nt":
        assert resolved.parent.name == "data" or resolved.name == "uploads"
        assert resolved.drive or not str(resolved).startswith("\\")
    else:
        assert resolved == Path("/data/uploads")


def test_scan_link_accepts_a_windows_network_path():
    """مسیر شبکه ویندوزی \\\\server\\share باید معتبر باشد."""
    from app.schemas import ContractIn

    payload = ContractIn(section="technical", contract_number="X-1",
                         scan_link=r"\\fileserver\contracts\1405\scan.pdf")
    assert payload.scan_link.startswith("\\\\")
