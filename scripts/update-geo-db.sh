#!/usr/bin/env bash
# Descarga/actualiza la base de paises DB-IP Lite (CC BY 4.0, https://db-ip.com) usada por las
# estadisticas de lectura (L6). Se publica cada mes. Uso (en el servidor de PROD o DEV):
#   scripts/update-geo-db.sh [directorio_destino]     (por defecto ./data/geo)
# Cron mensual sugerido (dia 3, 04:10):  10 4 3 * * /srv/apps/flipbook/scripts/update-geo-db.sh /srv/apps/flipbook/data/geo
set -euo pipefail
DEST="${1:-./data/geo}"
mkdir -p "$DEST"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
for off in 0 1; do
  YM="$(date -u -d "$(date -u +%Y-%m-15) -${off} month" +%Y-%m)"
  URL="https://download.db-ip.com/free/dbip-country-lite-${YM}.mmdb.gz"
  if curl -fsSL --max-time 120 -o "$TMP/db.gz" "$URL"; then
    gunzip -f "$TMP/db.gz"
    [ "$(stat -c %s "$TMP/db")" -gt 1000000 ] || { echo "descarga sospechosa (${URL})" >&2; exit 1; }
    install -m 0644 "$TMP/db" "$DEST/dbip-country-lite.mmdb.new"
    mv -f "$DEST/dbip-country-lite.mmdb.new" "$DEST/dbip-country-lite.mmdb"
    echo "OK ${YM} -> $DEST/dbip-country-lite.mmdb"
    exit 0
  fi
done
echo "no se pudo descargar la base DB-IP" >&2; exit 1
