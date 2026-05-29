FROM python:3.11-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 C_FORCE_ROOT=0
RUN apt-get update && apt-get install -y --no-install-recommends gcc libpq-dev poppler-utils libpango-1.0-0 curl && rm -rf /var/lib/apt/lists/*
COPY ../backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
RUN addgroup --system workers && adduser --system --ingroup workers celeryuser
USER celeryuser
CMD ["celery","-A","celery_app","worker","--loglevel=info","--concurrency=2"]
