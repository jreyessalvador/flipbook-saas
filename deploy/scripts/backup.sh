#!/usr/bin/env bash
# backup.sh - cron: 0 2 * * *
set -euo pipefail
BACKUP_DIR="/opt/backups/flipbook"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
RETENTION_DAYS=7
mkdir -p "${BACKUP_DIR}"
echo "[$(date)] Iniciando backup..."
docker compose -f /opt/flipbook-saas/docker-compose.prod.yml exec -T postgres pg_dump -U "${POSTGRES_USER:-flipbook}" "${POSTGRES_DB:-flipbook}" --no-owner --no-acl | gzip > "${BACKUP_DIR}/postgres_${TIMESTAMP}.sql.gz"
echo "[$(date)] PostgreSQL OK"
find "${BACKUP_DIR}" -name "*.sql.gz" -mtime +${RETENTION_DAYS} -delete
echo "[$(date)] Backup completado. Retencion: ${RETENTION_DAYS} dias"
