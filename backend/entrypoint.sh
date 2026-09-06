#!/bin/sh
set -e

echo "در انتظار آماده شدن پایگاه داده..."
for i in $(seq 1 60); do
    if python -c "
import sys
from sqlalchemy import create_engine, text
from app.config import settings
try:
    create_engine(settings.database_url).connect().execute(text('SELECT 1'))
except Exception:
    sys.exit(1)
" 2>/dev/null; then
        echo "پایگاه داده آماده است."
        break
    fi
    [ "$i" = "60" ] && { echo "پایگاه داده در دسترس نیست. متوقف شد."; exit 1; }
    sleep 1
done

echo "اعمال مهاجرت‌های پایگاه داده..."
alembic upgrade head

echo "ایجاد داده اولیه..."
python -m app.seed

exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --proxy-headers --forwarded-allow-ips='*'
