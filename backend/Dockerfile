FROM python:3.11-slim AS base
WORKDIR /app
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 PIP_NO_CACHE_DIR=1
RUN apt-get update && apt-get install -y --no-install-recommends gcc libpq-dev poppler-utils libpango-1.0-0 libpangoft2-1.0-0 curl && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

FROM base AS development
RUN pip install --no-cache-dir watchfiles
CMD ["uvicorn","app.main:app","--host","0.0.0.0","--port","8000","--reload","--reload-dir","/app/app"]

FROM base AS builder
COPY . .

FROM python:3.11-slim AS production
WORKDIR /app
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
RUN apt-get update && apt-get install -y --no-install-recommends libpq5 poppler-utils libpango-1.0-0 libpangoft2-1.0-0 curl && rm -rf /var/lib/apt/lists/* && addgroup --system appgroup && adduser --system --ingroup appgroup appuser
COPY --from=builder /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin
COPY --from=builder /app /app
RUN chown -R appuser:appgroup /app
USER appuser
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 CMD curl -f http://localhost:8000/health || exit 1
CMD ["uvicorn","app.main:app","--host","0.0.0.0","--port","8000","--workers","2","--loop","uvloop","--access-log"]
