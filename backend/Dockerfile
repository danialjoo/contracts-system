FROM python:3.11-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /srv

# gcc برای ساخت argon2-cffi لازم است و بعد از نصب حذف می‌شود.
COPY backend/requirements.txt .
RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential libpq5 \
 && pip install --no-cache-dir -r requirements.txt \
 && apt-get purge -y build-essential \
 && apt-get autoremove -y \
 && rm -rf /var/lib/apt/lists/*

COPY backend/alembic.ini .
COPY backend/migrations ./migrations
COPY backend/app ./app
COPY backend/entrypoint.sh /usr/local/bin/entrypoint.sh
# فرانت‌اند داخل خود ایمیج است تا استقرار به mount بیرونی وابسته نباشد.
COPY frontend ./frontend
RUN chmod +x /usr/local/bin/entrypoint.sh

# اجرا با کاربر غیر روت
RUN useradd --system --uid 10001 --create-home appuser \
 && mkdir -p /data/uploads \
 && chown -R appuser:appuser /data /srv
USER appuser

EXPOSE 8000
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
