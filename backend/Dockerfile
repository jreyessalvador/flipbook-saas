FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    postgresql-client \
    poppler-utils \
    libpango-1.0-0 \
    libpangoft2-1.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy application
COPY . .

# Expose port
EXPOSE 8000

# Health check: timeout interno (KILL) para no dejar python huerfanos si el
# endpoint se cuelga; urllib con timeout y exit 1 si la respuesta no es 2xx.
# Debe coincidir con el healthcheck de docker-compose.{prod,dev}.yml (backend).
HEALTHCHECK --interval=30s --timeout=10s --retries=3 --start-period=40s \
    CMD timeout -s KILL 8 python -c "import sys, urllib.request; sys.exit(0 if 200 <= urllib.request.urlopen('http://localhost:8000/health', timeout=5).status < 300 else 1)" || exit 1

# Run
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
