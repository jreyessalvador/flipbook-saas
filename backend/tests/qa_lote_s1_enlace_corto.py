"""QA Lote S1 (2026-10-04): enlace corto propio /s/{code}.

Ejecutar DENTRO del contenedor backend de DEV:
  docker cp backend/tests/qa_lote_s1_enlace_corto.py flipbook-dev-backend:/tmp/qa_s1.py
  docker exec flipbook-dev-backend python /tmp/qa_s1.py
Usa owner.demo (Empresa Demo). Re-ejecutable: purga lo que crea (atexit).
"""
import sys, json, re, uuid, atexit, urllib.request, urllib.error
sys.path.insert(0, "/app")
from datetime import timedelta
from sqlalchemy import text
from app.core.security import create_access_token
from app.db.session import SessionLocal
from app.models.publication import Publication
from app.models.collection import Collection
from app.services.trash import purge_publication
from app.services.short_links import ALPHABET, is_bot

B = "http://localhost:8000"
FAILS = []
RUN = uuid.uuid4().hex[:6]
BROWSER = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36"
WHATSAPP = "WhatsApp/2.23.20.0 A"


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k): return None
OPENER = urllib.request.build_opener(NoRedirect)


def call(method, path, token=None, body=None):
    h = {"Content-Type": "application/json"}
    if token: h["Authorization"] = "Bearer " + token
    r = urllib.request.Request(B + path, data=json.dumps(body).encode() if body is not None else None, method=method, headers=h)
    try:
        with urllib.request.urlopen(r) as x:
            c = x.read(); return x.status, (json.loads(c) if c else None)
    except urllib.error.HTTPError as e:
        c = e.read()
        try: return e.code, json.loads(c)
        except Exception: return e.code, c[:120]


def short(path, ua=BROWSER):
    r = urllib.request.Request(B + "/api/public" + path, headers={"User-Agent": ua})
    try:
        with OPENER.open(r) as x: return x.status, x.headers.get("Location")
    except urllib.error.HTTPError as e: return e.code, e.headers.get("Location")


def ok(c, m):
    print(("PASS " if c else "FAIL ") + m)
    if not c: FAILS.append(m)


OW = create_access_token({"sub": "owner.demo@example.com"}, timedelta(minutes=20))
created_pubs, created_cols = [], []


@atexit.register
def _cleanup():
    db = SessionLocal()
    try:
        for pid in created_pubs:
            p = db.query(Publication).execution_options(include_deleted=True).filter(Publication.id == pid).first()
            if p is not None:
                try: purge_publication(db, p)
                except Exception: db.rollback()
        for cid in created_cols:
            c = db.query(Collection).filter(Collection.id == cid).first()
            if c is not None: db.delete(c); db.commit()
    finally:
        db.close()


def clicks(code):
    db = SessionLocal()
    try: return db.execute(text("select clicks from short_links where code=:c"), {"c": code}).scalar()
    finally: db.close()


db = SessionLocal()
missing = db.execute(text("select count(*) from publications p where not exists (select 1 from short_links s where s.publication_id=p.id)")).scalar()
ok(missing == 0, f"migracion 0012: todas las ediciones tienen enlace corto (faltan {missing})")
db.close()

st, cols = call("GET", "/api/collections", OW)
general = next(c for c in cols if c["is_default"])
st, p = call("POST", "/api/publications/", OW, {"title": f"QA S1 {RUN}", "collection_id": general["id"], "total_pages": 2})
created_pubs.append(p["id"])
sp = p.get("short_path") or ""
code = sp.rsplit("/", 1)[-1]
ok(st == 201 and re.fullmatch(r"/s/[%s]{6}" % ALPHABET, sp), f"crear edicion -> short_path {sp}")
ok(p.get("short_clicks") == 0, "short_clicks empieza en 0")

st, loc = short(f"/s/{code}"); ok(st == 302 and loc == "/?aviso=no-disponible", f"borrador privado -> inicio sin revelar datos ({st} {loc})")
st, pubres = call("POST", f"/api/publications/{p['id']}/publish", OW)
ok(st == 201 and pubres.get("short_path") == sp, "publicar devuelve el mismo short_path")
st, loc = short(f"/s/{code}"); ok(st == 302 and loc == "/?aviso=no-disponible", f"publicada pero oculta del catalogo -> inicio ({loc})")
call("PUT", f"/api/publications/{p['id']}/visibility", OW, {"is_public": True})
st, meta = call("GET", f"/api/public/publications/{p['id']}")
ok(meta.get("short_path") == sp, "API publica expone short_path")
c0 = clicks(code)
st, loc = short(f"/s/{code}"); ok(st == 302 and loc == meta["url_path"], f"visible -> 302 a la URL canonica ({loc})")
ok(clicks(code) == c0 + 1, "clic de navegador cuenta (+1)")
st, loc = short(f"/s/{code}", WHATSAPP); ok(st == 302 and loc == meta["url_path"], "WhatsApp tambien es redirigido (vista previa)")
ok(clicks(code) == c0 + 1, "el previsualizador de WhatsApp NO cuenta como clic")
ok(is_bot("") and is_bot("facebookexternalhit/1.1") and not is_bot(BROWSER), "deteccion de bots")
st, loc = short(f"/s/{code}?utm_source=qr"); ok(loc == meta["url_path"] + "?utm_source=qr", f"conserva la query (utm) ({loc})")
st, panel = call("GET", f"/api/publications/{p['id']}", OW); ok(panel.get("short_clicks") == c0 + 2, f"panel muestra visitas (2 de navegador, 0 de WhatsApp) ({panel.get('short_clicks')})")

# Renombrar y mover: el codigo no cambia y redirige a la nueva URL
st, col2 = call("POST", "/api/collections", OW, {"name": f"QA S1 col {RUN}"}); created_cols.append(col2["id"])
call("PUT", f"/api/publications/{p['id']}", OW, {"title": f"QA S1 renombrada {RUN}"})
st, mv = call("POST", f"/api/publications/{p['id']}/move", OW, {"collection_id": col2["id"]})
ok(mv.get("short_path") == sp, "tras renombrar y mover, el codigo es el mismo")
st, meta2 = call("GET", f"/api/public/publications/{p['id']}")
st, loc = short(f"/s/{code}"); ok(loc == meta2["url_path"] and loc != meta["url_path"], f"redirige a la NUEVA URL canonica ({loc})")

# Clon: codigo propio
st, cl = call("POST", f"/api/publications/{p['id']}/clone", OW, {}); created_pubs.append(cl["id"])
ok(cl.get("short_path") and cl["short_path"] != sp, f"clon con codigo propio ({cl.get('short_path')})")

# Papelera
call("DELETE", f"/api/publications/{p['id']}", OW)
st, loc = short(f"/s/{code}"); ok(loc == "/?aviso=no-disponible", "en la papelera -> inicio")
call("POST", f"/api/publications/{p['id']}/restore", OW); call("PUT", f"/api/publications/{p['id']}/visibility", OW, {"is_public": True})
st, loc = short(f"/s/{code}"); ok(loc == meta2["url_path"], "restaurada y visible -> vuelve a funcionar con el mismo codigo")

# Codigos invalidos / inexistentes
st, loc = short("/s/zzzzzzzzzzzzzzzzzzzz"); ok(st == 302 and loc == "/?aviso=no-disponible", f"codigo demasiado largo -> inicio ({st})")
st, loc = short("/s/ab_c"); ok(st == 302 and loc == "/?aviso=no-disponible", "codigo con caracteres no validos -> inicio")
st, loc = short("/s/QQQQQQ"); ok(st == 302 and loc == "/?aviso=no-disponible", "codigo inexistente -> inicio")

# Purga: el enlace desaparece con la edicion (ON DELETE CASCADE)
call("DELETE", f"/api/publications/{cl['id']}", OW); call("DELETE", f"/api/publications/{cl['id']}/purge", OW)
db = SessionLocal()
ok(db.execute(text("select count(*) from short_links where publication_id=:i"), {"i": cl["id"]}).scalar() == 0, "purgar borra su enlace corto")
db.close()

print(f"\n{'OK' if not FAILS else 'FALLOS: ' + str(len(FAILS))}")
sys.exit(1 if FAILS else 0)
