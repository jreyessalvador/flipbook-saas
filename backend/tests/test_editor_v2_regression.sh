#!/usr/bin/env bash
# Smoke test de regresion para Fase A del editor v2 (ver docs/arquitectura-editor-2026-09-12.md, seccion 10).
# Requiere el stack de docker-compose.dev.yml levantado y accesible en $BASE.
# Reproduce EXACTAMENTE el bug reportado por Carlos: editar portada, verificar
# que la contraportada NO recibe ese contenido, que la portada no se vacia al
# volver a cargarla, y que la orientacion de la publicacion no cambia sola.
#
# Uso: BASE=http://127.0.0.1:8010/api ./test_editor_v2_regression.sh
set -euo pipefail
BASE="${BASE:-http://127.0.0.1:8010/api}"
EMAIL="${EMAIL:-admin@flipbook.app}"
PASSWORD="${PASSWORD:-admin123}"

fail() { echo "FALLO: $1" >&2; exit 1; }

TOKEN=$(curl -sf -X POST "$BASE/auth/login" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=$EMAIL&password=$PASSWORD" | python3 -c "import json,sys; print(json.load(sys.stdin)['access_token'])")
[ -n "$TOKEN" ] || fail "no se pudo autenticar"

PUB=$(curl -sf -X POST "$BASE/publications/" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"title":"Test regresion editor v2","orientation":"portrait","total_pages":4}')
PUB_ID=$(echo "$PUB" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")
ORIG_ORIENTATION=$(echo "$PUB" | python3 -c "import json,sys; print(json.load(sys.stdin)['orientation'])")

PAGES=$(curl -sf "$BASE/pages/publications/$PUB_ID/pages" -H "Authorization: Bearer $TOKEN")
COVER_ID=$(echo "$PAGES" | python3 -c "import json,sys; d=json.load(sys.stdin); print([p['id'] for p in d if p['page_type']=='cover'][0])")
BACKCOVER_ID=$(echo "$PAGES" | python3 -c "import json,sys; d=json.load(sys.stdin); print([p['id'] for p in d if p['page_type']=='back_cover'][0])")

curl -sf -X POST "$BASE/publications/$PUB_ID/lock" -H "Authorization: Bearer $TOKEN" > /dev/null

SAVE=$(curl -sf -X PUT "$BASE/pages/$COVER_ID/elements" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"version":1,"elements":[{"kind":"image","x":0,"y":0,"width":210,"height":150,"props":{"alt_text":"portada"}},{"kind":"text","x":10,"y":160,"width":190,"height":30,"props":{"content_html":"<h1>Titulo</h1>"}}]}')
NEW_VERSION=$(echo "$SAVE" | python3 -c "import json,sys; print(json.load(sys.stdin)['version'])")
[ "$NEW_VERSION" = "2" ] || fail "version esperada 2, obtenida $NEW_VERSION"

BACKCOVER_ELEMENTS=$(curl -sf "$BASE/pages/$BACKCOVER_ID/elements" -H "Authorization: Bearer $TOKEN" | python3 -c "import json,sys; print(len(json.load(sys.stdin)['elements']))")
[ "$BACKCOVER_ELEMENTS" = "0" ] || fail "BUG REPRODUCIDO: la contraportada tiene $BACKCOVER_ELEMENTS elementos (deberia tener 0) -- fuga de contenido portada->contraportada"

COVER_ELEMENTS=$(curl -sf "$BASE/pages/$COVER_ID/elements" -H "Authorization: Bearer $TOKEN" | python3 -c "import json,sys; print(len(json.load(sys.stdin)['elements']))")
[ "$COVER_ELEMENTS" = "2" ] || fail "BUG REPRODUCIDO: la portada quedo con $COVER_ELEMENTS elementos (deberia tener 2) -- se vacio al recargar"

CONFLICT_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X PUT "$BASE/pages/$COVER_ID/elements" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"version":1,"elements":[]}')
[ "$CONFLICT_STATUS" = "409" ] || fail "guardar con version vieja deberia dar 409, dio $CONFLICT_STATUS"

FINAL_ORIENTATION=$(curl -sf "$BASE/publications/$PUB_ID" -H "Authorization: Bearer $TOKEN" | python3 -c "import json,sys; print(json.load(sys.stdin)['orientation'])")
[ "$FINAL_ORIENTATION" = "$ORIG_ORIENTATION" ] || fail "BUG REPRODUCIDO: orientation cambio de $ORIG_ORIENTATION a $FINAL_ORIENTATION"

curl -sf -X DELETE "$BASE/publications/$PUB_ID/lock" -H "Authorization: Bearer $TOKEN" > /dev/null

echo "OK -- todos los checks de regresion pasaron (publication_id de prueba: $PUB_ID)"
