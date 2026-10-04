#!/bin/bash
# flipbook-worker-housekeeping (Contabo 2) -- limpieza periodica del worker de render
# de Cetrix Revistas. Aprobado por Carlos 04-oct-2026. Uso: ... [--dry-run]
# Temporizador: flipbook-worker-housekeeping.timer (semanal). Log: /var/log/flipbook-worker-housekeeping.log
set -u
DRY=0; [ "${1:-}" = "--dry-run" ] && DRY=1
LOG=/var/log/flipbook-worker-housekeeping.log
log(){ echo "$(date '+%F %T') $*" | tee -a "$LOG"; }
run(){ if [ $DRY = 1 ]; then log "[dry-run] $*"; else log "$*"; "$@" >>"$LOG" 2>&1 || log "  (fallo, se continua)"; fi; }
log "=== inicio (dry-run=$DRY) ==="
df -h / | tail -1 | awk '{print "disco antes: usado " $3 " de " $2 " (" $5 ")"}' | tee -a "$LOG"
# Capturas de pruebas del worker (> 7 dias)
find /srv/flipbook-worker/out -maxdepth 1 -type f -mtime +7 -print 2>/dev/null | while read -r f; do run rm -f -- "$f"; done
# Imagenes huerfanas y cache de compilacion sin usar en 7 dias (la imagen activa no se toca)
run docker image prune -f
run docker builder prune -f --filter until=168h
# Logs de los contenedores: ya rotados por Docker (3 x 10 MB); aqui solo se informa
docker ps --filter name=flipbook-render --format '{{.Names}} {{.Status}}' | tee -a "$LOG"
df -h / | tail -1 | awk '{print "disco despues: usado " $3 " de " $2 " (" $5 ")"}' | tee -a "$LOG"
log "=== fin ==="
