# ── Base ──────────────────────────────────────────────────────────────────────
FROM python:3.12-slim AS base

WORKDIR /app

# Install uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

# Copy API deps first for layer caching
COPY api/pyproject.toml api/uv.lock ./api/
RUN uv sync --directory api --no-dev --frozen

# Copy full project
COPY . .

# ── Dev stage ─────────────────────────────────────────────────────────────────
FROM base AS dev

# Install dev deps (pytest etc.)
RUN uv sync --directory api --frozen

EXPOSE 5000 8080

# Start both servers via a small shell script
CMD ["sh", "-c", "\
  python3 -m http.server 8080 --directory /app & \
  uv run --directory /app/api python app.py --host 0.0.0.0 \
"]

# ── Prod stage ────────────────────────────────────────────────────────────────
FROM base AS prod

# Install nginx and gunicorn
RUN apt-get update && apt-get install -y --no-install-recommends nginx && rm -rf /var/lib/apt/lists/*
RUN uv pip install --system gunicorn

# nginx config
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
RUN rm /etc/nginx/sites-enabled/default 2>/dev/null || true

EXPOSE 80

CMD ["sh", "-c", "\
  gunicorn --workers 2 --bind 127.0.0.1:5000 --chdir /app/api app:app & \
  nginx -g 'daemon off;' \
"]
