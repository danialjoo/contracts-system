#!/usr/bin/env bash
# بسته‌بندی سامانه برای سروری که به اینترنت دسترسی ندارد.
# روی یک ماشین متصل اجرا کنید، سپس پوشه offline-bundle را به سرور شرکت ببرید.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/offline-bundle"
mkdir -p "$OUT"

echo "۱/۳ — ساخت ایمیج برنامه…"
docker compose -f "$ROOT/docker-compose.yml" build app

echo "۲/۳ — دریافت ایمیج‌های پایه…"
docker pull postgres:16-alpine
docker pull nginx:1.27-alpine

echo "۳/۳ — ذخیره ایمیج‌ها در یک فایل…"
APP_IMAGE="$(docker compose -f "$ROOT/docker-compose.yml" config --images | grep -v -E 'postgres|nginx' | head -1)"
docker save -o "$OUT/images.tar" "$APP_IMAGE" postgres:16-alpine nginx:1.27-alpine

tar -czf "$OUT/source.tar.gz" -C "$ROOT/.." \
    --exclude='*/offline-bundle' --exclude='*/.venv' --exclude='*/__pycache__' \
    --exclude='*/.pytest_cache' --exclude='*/.git' contracts-system

cat > "$OUT/INSTALL.txt" <<'TXT'
نصب روی سرور بدون اینترنت
=========================
۱) فایل‌های images.tar و source.tar.gz را روی سرور کپی کنید.
۲) ایمیج‌ها را بارگذاری کنید:
       docker load -i images.tar
۳) کد را باز کنید:
       tar -xzf source.tar.gz
       cd contracts-system
۴) فایل تنظیمات را بسازید و مقادیرش را پر کنید:
       cp .env.example .env
       nano .env
   حتماً POSTGRES_PASSWORD و APP_SECRET_KEY را با مقادیر تصادفی پر کنید:
       openssl rand -base64 24     # برای رمز پایگاه داده
       openssl rand -base64 48     # برای کلید رمزنگاری
   و BIND_ADDR را روی آدرس شبکه داخلی سرور بگذارید.
۵) اجرا کنید (بدون build، چون ایمیج‌ها از قبل بارگذاری شده‌اند):
       docker compose up -d --no-build
۶) رمز کاربر مدیر را از لاگ بردارید:
       docker compose logs app | head -40
TXT

echo "آماده شد: $OUT"
ls -la "$OUT"
