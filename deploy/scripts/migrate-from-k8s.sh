#!/usr/bin/env bash
# migrate-from-k8s.sh
set -euo pipefail
NAMESPACE="flipbook-prod"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="/tmp/flipbook_k8s_${TIMESTAMP}.sql"
echo "Migracion K3s -> Docker Compose - ${TIMESTAMP}"
echo "[1/4] Dump PostgreSQL desde K3s..."
PG_POD=$(kubectl get pod -n ${NAMESPACE} -l app=postgresql -o jsonpath="{.items[0].metadata.name}")
kubectl exec -n ${NAMESPACE} ${PG_POD} -- pg_dump -U flipbook -d flipbook --no-owner --no-acl > "${BACKUP_FILE}"
echo "   Dump OK: ${BACKUP_FILE}"
echo "[2/4] Verificando contenedor Docker..."
docker compose -f docker-compose.prod.yml ps postgres | grep -q healthy || { echo "ERROR: postgres no healthy"; exit 1; }
echo "[3/4] Restaurando en Docker..."
docker compose -f docker-compose.prod.yml exec -T postgres psql -U "${POSTGRES_USER:-flipbook}" -d "${POSTGRES_DB:-flipbook}" < "${BACKUP_FILE}"
echo "[4/4] Verificando..."
docker compose -f docker-compose.prod.yml exec postgres psql -U flipbook -d flipbook -c "\dt" -c "SELECT COUNT(*) FROM tenants;"
echo "Migracion completada. Backup: ${BACKUP_FILE}"
