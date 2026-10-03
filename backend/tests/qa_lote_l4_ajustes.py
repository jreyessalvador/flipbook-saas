"""QA Lote L4 (2026-09-28): ajustes de edicion (SEO, sonido), clonar y OG.

Ejecutar DENTRO del contenedor backend de DEV (usa JWT firmados localmente):
  docker cp backend/tests/qa_lote_l4_ajustes.py flipbook-dev-backend:/tmp/qa_l4.py
  docker exec flipbook-dev-backend python /tmp/qa_l4.py
Requiere haber corrido antes qa_lote_c_tenant_isolation.py (Empresa Demo).
Crea ediciones temporales "QA L4 ..." y las borra al final. Todo debe salir PASS.
"""
import sys, json, urllib.request, urllib.error
sys.path.insert(0, "/app")
from datetime import timedelta
from app.core.security import create_access_token
from app.db.session import SessionLocal
from app.models.asset import Asset
from app.models.user import User

B = "http://localhost:8000"
FAILS = []


def call(method, path, token=None, body=None, headers=None, raw=False):
    h = {"Content-Type": "application/json"}
    if token: h["Authorization"] = "Bearer " + token
    h.update(headers or {})
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(B + path, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(r) as x:
            content = x.read()
            if raw: return x.status, content.decode(), {k.lower(): v for k, v in x.headers.items()}
            return x.status, (json.loads(content) if content else None)
    except urllib.error.HTTPError as e:
        content = e.read()
        if raw: return e.code, content.decode(errors="replace"), {k.lower(): v for k, v in e.headers.items()}
        try: return e.code, json.loads(content)
        except Exception: return e.code, content[:120]


def ok(c, m):
    print(("PASS " if c else "FAIL ") + m)
    if not c: FAILS.append(m)


SA = create_access_token({"sub": "jose.reyes@cetrix.com.mx"}, timedelta(minutes=15))
OW = create_access_token({"sub": "owner.demo@example.com"}, timedelta(minutes=15))
created = []

# --- Edicion de prueba con contenido ---------------------------------------
st, cols = call("GET", "/api/collections", SA)
general = next(c for c in cols if c["is_default"])
st, ed = call("POST", "/api/publications/", SA, {"title": "QA L4 origen", "collection_id": general["id"], "total_pages": 4, "edition_label": "QA-L4"})
ok(st == 201, f"crear edicion origen ({st})"); created.append(ed["id"])
st, pages = call("GET", f"/api/pages/publications/{ed['id']}/pages", SA)
ok(st == 200 and len(pages) == 4, f"4 paginas creadas ({len(pages) if isinstance(pages, list) else pages})")
n_el = 0
for i, pg in enumerate(pages[:2]):
    st, cur = call("GET", f"/api/pages/{pg['id']}/elements", SA)
    els = [{"kind": "text", "x": 40, "y": 40 + k * 60, "width": 300, "height": 50, "rotation_deg": 0, "z_index": k,
            "props": {"text": f"Pagina {pg['page_number']} bloque {k}", "fontSize": 24}} for k in range(i + 2)]
    st, _ = call("PUT", f"/api/pages/{pg['id']}/elements", SA, {"version": cur["version"], "elements": els})
    ok(st == 200, f"guardar {len(els)} elementos en pagina {pg['page_number']} ({st})"); n_el += len(els)

# --- Ajustes: validaciones -----------------------------------------------
st, _ = call("PUT", f"/api/publications/{ed['id']}", SA, {"seo_title": "x" * 71}); ok(st == 422, f"seo_title > 70 -> {st}")
st, _ = call("PUT", f"/api/publications/{ed['id']}", SA, {"seo_description": "x" * 161}); ok(st == 422, f"seo_description > 160 -> {st}")
st, p = call("PUT", f"/api/publications/{ed['id']}", SA, {"seo_title": "  Titulo SEO QA  ", "seo_description": "Descripcion SEO QA", "seo_indexable": False, "sound_enabled": False})
ok(st == 200 and p["seo_title"] == "Titulo SEO QA" and p["seo_indexable"] is False and p["sound_enabled"] is False, f"guardar SEO + sonido off ({st})")
st, p = call("PUT", f"/api/publications/{ed['id']}", SA, {"seo_title": "   "}); ok(st == 200 and p["seo_title"] is None, "seo_title vacio -> null (usa titulo)")
st, p = call("PUT", f"/api/publications/{ed['id']}", SA, {"sound_enabled": None}); ok(st == 200 and p["sound_enabled"] is False, "sound_enabled null se ignora")
call("PUT", f"/api/publications/{ed['id']}", SA, {"seo_title": "Titulo SEO QA"})

# Sonido: solo audio de la propia empresa
db = SessionLocal()
sa_user = db.query(User).filter(User.email == "jose.reyes@cetrix.com.mx").first()
ow_user = db.query(User).filter(User.email == "owner.demo@example.com").first()
a_audio = Asset(tenant_id=sa_user.tenant_id, kind="audio", storage_key="qa/l4-audio.mp3", mime_type="audio/mpeg", size_bytes=1000, created_by=sa_user.id)
a_img = Asset(tenant_id=sa_user.tenant_id, kind="image", storage_key="qa/l4-img.png", mime_type="image/png", size_bytes=1000, created_by=sa_user.id)
a_other = Asset(tenant_id=ow_user.tenant_id, kind="audio", storage_key="qa/l4-otro.mp3", mime_type="audio/mpeg", size_bytes=1000, created_by=ow_user.id)
db.add_all([a_audio, a_img, a_other]); db.commit()
st, _ = call("PUT", f"/api/publications/{ed['id']}", SA, {"page_turn_sound_asset_id": str(a_img.id)}); ok(st == 422, f"sonido = imagen -> {st}")
st, _ = call("PUT", f"/api/publications/{ed['id']}", SA, {"page_turn_sound_asset_id": str(a_other.id)}); ok(st == 422, f"sonido de otra empresa -> {st}")
st, p = call("PUT", f"/api/publications/{ed['id']}", SA, {"page_turn_sound_asset_id": str(a_audio.id)})
ok(st == 200 and p["page_turn_sound_url"] == "/api/assets/serve/qa/l4-audio.mp3", f"sonido propio valido ({st}, {p.get('page_turn_sound_url') if isinstance(p, dict) else p})")

# --- Publico: ajustes en vivo --------------------------------------------
st, _ = call("POST", f"/api/publications/{ed['id']}/publish", SA); ok(st == 201, f"publicar ({st})")
st, _ = call("PUT", f"/api/publications/{ed['id']}/visibility", SA, {"is_public": True}); ok(st == 200, "mostrar en catalogo")
st, pub = call("GET", f"/api/public/publications/{ed['id']}")
ok(st == 200 and pub["viewer"] == {"sound_enabled": False, "sound_url": "/api/assets/serve/qa/l4-audio.mp3", "download_url": None}, f"publico viewer ({pub.get('viewer') if isinstance(pub, dict) else pub})")
ok(pub.get("seo", {}).get("title") == "Titulo SEO QA" and pub["seo"]["indexable"] is False, "publico seo")
call("PUT", f"/api/publications/{ed['id']}", SA, {"sound_enabled": True})
st, pub = call("GET", f"/api/public/publications/{ed['id']}"); ok(pub["viewer"]["sound_enabled"] is True, "cambio de ajuste se ve sin republicar")
st, html, hdr = call("GET", f"/api/public/og/{ed['id']}", raw=True)
ok(st == 200 and "<title>Titulo SEO QA · Cetrix Revistas</title>" in html and 'content="Descripcion SEO QA"' in html, "OG usa titulo/descripcion SEO")
ok('name="robots" content="noindex, nofollow"' in html and hdr.get("x-robots-tag") == "noindex, nofollow", "OG noindex + X-Robots-Tag")
call("PUT", f"/api/publications/{ed['id']}", SA, {"seo_indexable": True})
st, html, hdr = call("GET", f"/api/public/og/{ed['id']}", raw=True); ok("noindex" not in html and "x-robots-tag" not in hdr, "OG indexable sin noindex")

# --- Clonar ----------------------------------------------------------------
st, cl = call("POST", f"/api/publications/{ed['id']}/clone", SA, {"title": "QA L4 copia", "edition_label": "QA-L4-2"})
ok(st == 201, f"clonar ({st})"); created.append(cl["id"])
ok(cl["status"] == "draft" and cl["is_public"] is False, "copia = borrador privado")
ok(cl["total_pages"] == 4 and cl["page_turn_sound_asset_id"] == str(a_audio.id) and cl["sound_enabled"] is True, "copia conserva paginas y ajustes del visor")
ok(cl["seo_title"] is None and cl["slug"] != ed["slug"] and cl["collection_id"] == general["id"], f"copia sin SEO, slug propio ({cl['slug']})")
st, cpages = call("GET", f"/api/pages/publications/{cl['id']}/pages", SA)
c_el = sum(len(call("GET", f"/api/pages/{pg['id']}/elements", SA)[1]["elements"]) for pg in cpages)
ok(len(cpages) == 4 and c_el == n_el, f"copia con {len(cpages)} paginas y {c_el}/{n_el} elementos")
ok({pg["id"] for pg in cpages}.isdisjoint({pg["id"] for pg in pages}), "paginas de la copia son nuevas (ids distintos)")
st, orig_el = call("GET", f"/api/pages/{pages[0]['id']}/elements", SA)
st, _ = call("PUT", f"/api/pages/{cpages[0]['id']}/elements", SA, {"version": call("GET", f"/api/pages/{cpages[0]['id']}/elements", SA)[1]["version"], "elements": []})
st, orig_el2 = call("GET", f"/api/pages/{pages[0]['id']}/elements", SA)
ok(len(orig_el2["elements"]) == len(orig_el["elements"]) > 0, "editar la copia no toca el original")
st, cl2 = call("POST", f"/api/publications/{ed['id']}/clone", SA, {}); created.append(cl2.get("id")) if st == 201 else None
ok(st == 201 and cl2["title"] == "QA L4 origen (copia)" and cl2["edition_label"] == "QA-L4", "clonar sin datos -> '(copia)' y misma etiqueta")

st, demo_cols = call("GET", "/api/collections", OW)
st, _ = call("POST", f"/api/publications/{ed['id']}/clone", SA, {"collection_id": demo_cols[0]["id"]}); ok(st == 404, f"clonar a coleccion de otra empresa -> {st}")
st, _ = call("POST", f"/api/publications/{ed['id']}/clone", OW, {}); ok(st == 404, f"owner Demo clona edicion CETRIX -> {st}")
st, _ = call("PUT", f"/api/publications/{ed['id']}", OW, {"seo_title": "hack"}); ok(st == 404, f"owner Demo edita ajustes CETRIX -> {st}")

# --- Limpieza ----------------------------------------------------------------
for pid in created:
    if pid: call("DELETE", f"/api/publications/{pid}", SA); call("DELETE", f"/api/publications/{pid}/purge", SA)  # L5: papelera
st, _ = call("GET", f"/api/publications/{ed['id']}", SA); ok(st == 404, "limpieza de ediciones QA")
db.query(Asset).filter(Asset.id.in_([a_audio.id, a_img.id, a_other.id])).delete(synchronize_session=False); db.commit(); db.close()

print(f"\n{'TODO OK' if not FAILS else str(len(FAILS)) + ' FALLOS'}")
sys.exit(1 if FAILS else 0)
