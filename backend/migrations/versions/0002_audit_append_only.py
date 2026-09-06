"""جدول ممیزی را در سطح دیتابیس فقط-افزودنی می‌کند

Revision ID: 0002_audit_append_only
Revises: f5b9fc75f4da
"""
from __future__ import annotations

from alembic import op

revision = "0002_audit_append_only"
down_revision = "f5b9fc75f4da"
branch_labels = None
depends_on = None

# حتی اگر روزی خطایی در کد نوشته شود یا کسی مستقیم به دیتابیس وصل شود،
# تغییر یا حذف رکورد ممیزی رد می‌شود. این تضمین ساختاری است، نه قراردادی.
GUARD = """
CREATE OR REPLACE FUNCTION audit_log_is_append_only() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'رکوردهای ممیزی قابل تغییر یا حذف نیستند (عملیات: %)', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_no_update
    BEFORE UPDATE ON audit_log
    FOR EACH ROW EXECUTE FUNCTION audit_log_is_append_only();

CREATE TRIGGER audit_log_no_delete
    BEFORE DELETE ON audit_log
    FOR EACH ROW EXECUTE FUNCTION audit_log_is_append_only();
"""


def upgrade() -> None:
    op.execute(GUARD)


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS audit_log_no_update ON audit_log")
    op.execute("DROP TRIGGER IF EXISTS audit_log_no_delete ON audit_log")
    op.execute("DROP FUNCTION IF EXISTS audit_log_is_append_only()")
