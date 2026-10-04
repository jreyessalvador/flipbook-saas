# Lote F1 (2026-10-04): imagen del worker de render de flipbook-saas.
# Base oficial de Playwright (Chromium + dependencias) + el paquete Python.
# Se construye en el host (con internet); el contenedor corre SIN internet.
FROM mcr.microsoft.com/playwright/python:v1.48.0-noble
RUN pip install --no-cache-dir --break-system-packages playwright==1.48.0 pikepdf==9.4.2 Pillow==11.0.0 requests==2.32.3 \
 && python -c "import playwright, pikepdf, PIL, requests; print('ok')"
WORKDIR /app
