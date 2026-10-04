#!/bin/bash
# flipbook-housekeeping (Contabo 1) -- limpieza periodica de restos de despliegues
# de Cetrix Revistas (flipbook-saas). Aprobado por Carlos 04-oct-2026.
# Solo toca cosas de flipbook (por nombre). Uso: flipbook-housekeeping.sh [--dry-run]
# Temporizador: flipbook-housekeeping.timer (semanal). Log: /var/log/flipbook-housekeeping.log
set -u
DRY=0; [ "${1:-}" = "--dry-run" ] && DRY=1
KEEP_ROLLBACKS=2      # tags rollback-* por imagen de produccion
KEEP_DUMPS=3          # copias manuales de BD (prod y dev)
KEEP_ENV=1            # copias de .env por entorno (contienen secretos)
KEEP_NGINX=2          # copias de cada site de nginx en /root
BK=/home/administracion/backups
LOG=/var/log/flipbook-housekeeping.log
log(){ echo "$(date '+%F %T') $*" | tee -a "$LOG"; }
run(){ if [ $DRY = 1 ]; then log "[dry-run] $*"; else log "$*"; "$@" >>"$LOG" 2>&1 || log "  (fallo, se continua)"; fi; }
# Borra todos menos los N mas recientes (por fecha de modificacion) de una lista de ficheros
keep_newest(){ local n=$1; shift; ls -1t "$@" 2>/dev/null | tail -n +$((n+1)) | while read -r f; do run rm -f -- "$f"; done; }

log "=== inicio (dry-run=$DRY) ==="
df -h / | tail -1 | awk '{print "disco antes: usado " $3 " de " $2 " (" $5 ")"}' | tee -a "$LOG"

# 1) Imagenes de rollback antiguas (nunca :latest ni las que use un contenedor)
for repo in flipbook-prod-backend flipbook-prod-frontend; do
  docker images "$repo" --format '{{.CreatedAt}}|{{.Tag}}' | grep '|rollback-' | sort -r | tail -n +$((KEEP_ROLLBACKS+1)) | cut -d'|' -f2 |
  while read -r tag; do run docker rmi "$repo:$tag"; done
done
run docker image prune -f --filter "label!=keep"   # capas huerfanas (dangling) que dejan los rmi

# 2) Cache de compilacion sin usar en 7 dias (rehacerla solo cuesta tiempo de build)
run docker builder prune -f --filter until=168h

# 3) Copias manuales de base de datos y .env
keep_newest $KEEP_DUMPS "$BK"/flipbook-prod-pre-*.dump
keep_newest $KEEP_DUMPS "$BK"/flipbook-dev/*.dump
keep_newest $KEEP_ENV "$BK"/flipbook-prod-env-pre-*
keep_newest $KEEP_ENV "$BK"/flipbook-dev-env-pre-*

# 4) Copias de nginx de los sites de flipbook en /root
for site in revistas.cetrix.com.mx dev-revistas.cetrix.com.mx flipbook-render-gateway; do
  keep_newest $KEEP_NGINX /root/"$site".bak-*
done

# Copias de nginx de DEV anteriores a la migracion (formato antiguo): ya no sirven
keep_newest 0 /root/dev-revistas.nginx.bak-*

# 5) Logs y scripts temporales de despliegues/QA de flipbook (> 7 dias)
find /tmp -maxdepth 1 -type f \( -name 'flipbook-*.log' -o -name '*-prod-build.log' -o -name 'qa_lote_*.out' \
     -o -name 'qa_*.log' -o -name 'qa_*.py' -o -name 'fpdf.py' \) -mtime +7 -print 2>/dev/null | while read -r f; do run rm -f -- "$f"; done

df -h / | tail -1 | awk '{print "disco despues: usado " $3 " de " $2 " (" $5 ")"}' | tee -a "$LOG"
log "=== fin ==="
