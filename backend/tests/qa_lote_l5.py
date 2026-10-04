"""QA Lote L5 (2026-10-03): papelera 30 dias + descarga del PDF original.

Ejecutar DENTRO del contenedor backend de DEV:
  docker cp backend/tests/qa_lote_l5.py flipbook-dev-backend:/tmp/qa_l5.py
  docker exec flipbook-dev-backend python /tmp/qa_l5.py
Requiere los usuarios demo (qa_lote_c_tenant_isolation.py y
qa_lote_c2_rbac_team.py). Re-ejecutable: todo lo que crea ("QA L5 ...") se
purga al final, tambien si falla a mitad (atexit). Todo debe salir PASS.
"""
import sys, json, uuid, atexit, urllib.request, urllib.error
from io import BytesIO
sys.path.insert(0, "/app")
from datetime import timedelta
from app.core.security import token_with_current_version as create_access_token  # EQ-1: incluye "tv"
from app.db.session import SessionLocal
from app.models.publication import Publication
from app.models.collection import Collection
from app.models.page import Page
from app.models.page_element import PageElement
from app.api.assets import minio_client, BUCKET_NAME, ensure_bucket
from app.services.trash import purge_expired, purge_publication, utcnow

B = "http://localhost:8000"
FAILS = []
RUN = uuid.uuid4().hex[:6]


def call(method, path, token=None, body=None, headers=None, raw=False):
    h = {"Content-Type": "application/json"}
    if token: h["Authorization"] = "Bearer " + token
    h.update(headers or {})
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(B + path, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(r) as x:
            content = x.read()
            if raw: return x.status, content, {k.lower(): v for k, v in x.headers.items()}
            return x.status, (json.loads(content) if content else None)
    except urllib.error.HTTPError as e:
        content = e.read()
        if raw: return e.code, content, {k.lower(): v for k, v in e.headers.items()}
        try: return e.code, json.loads(content)
        except Exception: return e.code, content[:120]


def ok(c, m):
    print(("PASS " if c else "FAIL ") + m)
    if not c: FAILS.append(m)


def tok(email): return create_access_token({"sub": email}, timedelta(minutes=20))
SA, OW, AD, ED = tok("jose.reyes@cetrix.com.mx"), tok("owner.demo@example.com"), tok("admin.demo@example.com"), tok("editor.demo@example.com")
created_pubs, created_cols, created_objs = [], [], []


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
    for key in created_objs:
        try: minio_client.remove_object(BUCKET_NAME, key)
        except Exception: pass


def obj_exists(key):
    try: minio_client.stat_object(BUCKET_NAME, key); return True
    except Exception: return False


def new_pub(token, col_id, title, pages=2):
    st, p = call("POST", "/api/publications/", token, {"title": title, "collection_id": col_id, "total_pages": pages})
    assert st == 201, (st, p)
    created_pubs.append(p["id"]); return p


def publish_public(token, pid):
    call("POST", f"/api/publications/{pid}/publish", token)
    st, _ = call("PUT", f"/api/publications/{pid}/visibility", token, {"is_public": True}); return st


def kiosk_ids():
    st, items = call("GET", "/api/public/publications"); return {i["id"] for i in items}


st, cols = call("GET", "/api/collections", OW)
general = next(c for c in cols if c["is_default"])
ensure_bucket()

# --- 1. Mover a la papelera ---------------------------------------------------
p = new_pub(OW, general["id"], f"QA L5 papelera {RUN}")
ok(publish_public(OW, p["id"]) == 200, "publicar y mostrar en catalogo")
st, meta = call("GET", f"/api/public/publications/{p['id']}")
ok(st == 200 and p["id"] in kiosk_ids(), "visible en el kiosco antes de borrar")
friendly = meta["url_path"]
st, s0 = call("GET", "/api/publications/stats/summary", OW)

st, _ = call("DELETE", f"/api/publications/{p['id']}", ED); ok(st == 403, f"editor NO mueve a la papelera -> {st}")
st, _ = call("DELETE", f"/api/publications/{p['id']}", AD); ok(st == 204, f"admin mueve a la papelera -> {st}")
st, _ = call("GET", f"/api/publications/{p['id']}", OW); ok(st == 404, f"panel: GET edicion borrada -> {st}")
st, lst = call("GET", f"/api/publications?limit=200&collection_id={general['id']}", OW); ok(p["id"] not in {x["id"] for x in lst}, "panel: no aparece en el listado")
st, _ = call("GET", f"/api/pages/publications/{p['id']}/pages", OW); ok(st == 404, f"editor: paginas de borrada -> {st}")
ok(p["id"] not in kiosk_ids(), "kiosco: ya no aparece")
st, _ = call("GET", f"/api/public/publications/{p['id']}"); ok(st == 404, f"/leer metadatos -> {st}")
st, _ = call("GET", f"/api/public/publications/{p['id']}/pages"); ok(st == 404, f"/leer paginas -> {st}")
st, _ = call("GET", f"/api/public{friendly}") if friendly.startswith("/r/") else (404, None); ok(st == 404, f"URL amigable {friendly} -> {st}")
st, s1 = call("GET", "/api/publications/stats/summary", OW)
ok(s1["total_publications"] == s0["total_publications"] - 1 and s1["trashed_publications"] == s0["trashed_publications"] + 1,
   f"stats: total {s0['total_publications']}->{s1['total_publications']}, papelera {s0['trashed_publications']}->{s1['trashed_publications']}")
st, _ = call("GET", "/api/publications/trash", ED); ok(st == 403, f"editor NO ve la papelera -> {st}")
st, tr = call("GET", "/api/publications/trash", AD)
item = next((i for i in tr["items"] if i["id"] == p["id"]), None)
ok(st == 200 and item and item["days_left"] == 30 and item["collection_name"] == general["name"] and item["deleted_by_name"], f"papelera: aparece con 30 dias y quien la borro ({item and item['days_left']}, {item and item['deleted_by_name']})")
st, tr2 = call("GET", f"/api/publications/trash?collection_id={general['id']}", AD); ok(any(i["id"] == p["id"] for i in tr2["items"]), "papelera filtrada por coleccion")
st, _ = call("PUT", f"/api/publications/{p['id']}", OW, {"title": "x"}); ok(st == 404, f"no se puede editar en la papelera -> {st}")
st, _ = call("DELETE", f"/api/publications/{p['id']}", OW); ok(st == 404, f"borrar dos veces -> {st}")

# Aislamiento entre empresas (SA sin selector actua en CETRIX)
st, _ = call("POST", f"/api/publications/{p['id']}/restore", SA); ok(st == 404, f"otra empresa NO restaura -> {st}")
st, _ = call("DELETE", f"/api/publications/{p['id']}/purge", SA); ok(st == 404, f"otra empresa NO purga -> {st}")
st, trsa = call("GET", "/api/publications/trash", SA); ok(all(i["id"] != p["id"] for i in trsa["items"]), "otra empresa no la ve en su papelera")

# Slug reservado mientras esta en la papelera
p2 = new_pub(OW, general["id"], f"QA L5 papelera {RUN}")
ok(p2["slug"] != p["slug"], f"edicion nueva con el mismo titulo no roba el slug ({p['slug']} vs {p2['slug']})")

# --- 2. Restaurar ---------------------------------------------------------
st, r = call("POST", f"/api/publications/{p['id']}/restore", ED); ok(st == 403, f"editor NO restaura -> {st}")
st, r = call("POST", f"/api/publications/{p['id']}/restore", AD)
ok(st == 200 and r["is_public"] is False and r["slug"] == p["slug"] and r["collection_id"] == general["id"] and r["status"] == "published",
   f"admin restaura: privada, mismo slug y coleccion, sigue publicada ({st})")
st, _ = call("GET", f"/api/publications/{p['id']}", OW); ok(st == 200, "vuelve a verse en el panel")
ok(p["id"] not in kiosk_ids(), "restaurada NO vuelve sola al kiosco")
st, _ = call("POST", f"/api/publications/{p['id']}/restore", AD); ok(st == 404, f"restaurar una que no esta en la papelera -> {st}")

# --- 3. Purga manual (solo owner) ------------------------------------------
call("DELETE", f"/api/publications/{p['id']}", AD)
st, _ = call("DELETE", f"/api/publications/{p['id']}/purge", AD); ok(st == 403, f"admin NO purga -> {st}")
st, res = call("DELETE", f"/api/publications/{p['id']}/purge", OW); ok(st == 200, f"owner purga definitivamente -> {st}")
db = SessionLocal()
ok(db.query(Publication).execution_options(include_deleted=True).filter(Publication.id == p["id"]).first() is None, "purgada: ya no existe en BD")
st, _ = call("DELETE", f"/api/publications/{p2['id']}/purge", OW); ok(st == 404, f"purgar una que no esta en la papelera -> {st}")

# --- 4. Purga automatica a los 30 dias --------------------------------------
old = new_pub(OW, general["id"], f"QA L5 vieja {RUN}")
young = new_pub(OW, general["id"], f"QA L5 joven {RUN}")
for x in (old, young): call("DELETE", f"/api/publications/{x['id']}", OW)
for x, days in ((old, 31), (young, 29)):
    row = db.query(Publication).execution_options(include_deleted=True).filter(Publication.id == x["id"]).first()
    row.deleted_at = utcnow() - timedelta(days=days)
db.commit()
st, tr = call("GET", "/api/publications/trash", OW)
dl = {i["id"]: i["days_left"] for i in tr["items"]}
ok(dl.get(young["id"]) == 1 and dl.get(old["id"]) == 0, f"dias restantes 29 dias -> 1, 31 dias -> 0 ({dl.get(young['id'])}, {dl.get(old['id'])})")
purged = {r["publication_id"] for r in purge_expired(db)}
db.expire_all()
ok(old["id"] in purged and db.query(Publication).execution_options(include_deleted=True).filter(Publication.id == old["id"]).first() is None, "purga automatica: >30 dias se elimina")
ok(young["id"] not in purged and db.query(Publication).execution_options(include_deleted=True).filter(Publication.id == young["id"]).first() is not None, "purga automatica: <30 dias se conserva")
from app.workers.maintenance import purge_trash_task
from app.workers.celery_app import celery_app
ok("purge-trash-daily" in celery_app.conf.beat_schedule and purge_trash_task.name == "flipbook.purge_trash", "tarea beat diaria registrada")

# --- 5. Archivos compartidos con un clon ----------------------------------
orig = new_pub(OW, general["id"], f"QA L5 original {RUN}")
tenant_id = db.query(Publication.tenant_id).filter(Publication.id == orig["id"]).scalar()
shared_key = f"tenant-{tenant_id}/publications/{orig['id']}/pages/qa-l5-{RUN}.jpg"
own_key = f"tenant-{tenant_id}/publications/{orig['id']}/pages/qa-l5-solo-{RUN}.jpg"
for k in (shared_key, own_key):
    minio_client.put_object(BUCKET_NAME, k, BytesIO(b"\xff\xd8qa"), 4, content_type="image/jpeg"); created_objs.append(k)
pg1 = db.query(Page).filter(Page.publication_id == orig["id"], Page.page_number == 1).first()
db.add(PageElement(page_id=pg1.id, kind="image", x=0, y=0, width=10, height=10, z_index=0, props={"src": f"/api/assets/serve/{shared_key}"}))
db.commit()
st, cl = call("POST", f"/api/publications/{orig['id']}/clone", OW, {}); created_pubs.append(cl["id"])
ok(st == 201, f"clonar original ({st})")
# el elemento "solo" se anade DESPUES de clonar: solo lo usa el original
pg1 = db.query(Page).filter(Page.publication_id == orig["id"], Page.page_number == 1).first()
db.add(PageElement(page_id=pg1.id, kind="image", x=0, y=0, width=5, height=5, z_index=1, props={"src": f"/api/assets/serve/{own_key}"}))
db.commit()
call("DELETE", f"/api/publications/{orig['id']}", OW)
st, res = call("DELETE", f"/api/publications/{orig['id']}/purge", OW)
ok(st == 200 and obj_exists(shared_key), f"purgar original NO borra la imagen que usa el clon ({res})")
ok(not obj_exists(own_key), "purgar original SI borra la imagen que solo usaba el")
call("DELETE", f"/api/publications/{cl['id']}", OW)
st, res = call("DELETE", f"/api/publications/{cl['id']}/purge", OW)
ok(st == 200 and not obj_exists(shared_key), f"purgar el clon (ultimo que la usaba) SI borra la imagen compartida ({res})")

# --- 6. Descarga del PDF -----------------------------------------------------
blank = new_pub(OW, general["id"], f"QA L5 sin pdf {RUN}")
st, _ = call("PUT", f"/api/publications/{blank['id']}", OW, {"allow_download": True}); ok(st == 422, f"permitir descarga sin PDF -> {st}")
pdfp = new_pub(OW, general["id"], f"QA L5 con pdf {RUN}")
pdf_key = f"tenant-{tenant_id}/imports/qa-l5-{RUN}.pdf"
pdf_bytes = b"%PDF-1.4\n% QA L5\n%%EOF\n"
minio_client.put_object(BUCKET_NAME, pdf_key, BytesIO(pdf_bytes), len(pdf_bytes), content_type="application/pdf"); created_objs.append(pdf_key)
row = db.query(Publication).filter(Publication.id == pdfp["id"]).first()
row.pdf_url = f"/api/assets/serve/{pdf_key}"; row.creation_type = "pdf"; db.commit()
publish_public(OW, pdfp["id"])
st, m = call("GET", f"/api/public/publications/{pdfp['id']}")
ok(st == 200 and m["viewer"]["download_url"] is None, "por defecto la descarga esta desactivada")
st, body, h = call("GET", f"/api/public/publications/{pdfp['id']}/download", raw=True); ok(st == 404, f"descargar con allow_download=false -> {st}")
st, u = call("PUT", f"/api/publications/{pdfp['id']}", ED, {"allow_download": True}); ok(st == 200 and u["allow_download"] is True, f"editor activa la descarga ({st})")
st, m = call("GET", f"/api/public/publications/{pdfp['id']}")
ok(m["viewer"]["download_url"] == f"/api/public/publications/{pdfp['id']}/download", f"viewer.download_url ({m['viewer']['download_url']})")
st, body, h = call("GET", f"/api/public/publications/{pdfp['id']}/download", raw=True)
ok(st == 200 and body == pdf_bytes and h.get("content-type") == "application/pdf" and "attachment" in h.get("content-disposition", "") and h.get("content-disposition", "").endswith('.pdf"'),
   f"descarga 200 PDF adjunto ({st}, {h.get('content-disposition')})")
call("PUT", f"/api/publications/{pdfp['id']}/visibility", OW, {"is_public": False})
st, body, h = call("GET", f"/api/public/publications/{pdfp['id']}/download", raw=True); ok(st == 404, f"descargar edicion privada -> {st}")
publish_public(OW, pdfp["id"])
call("DELETE", f"/api/publications/{pdfp['id']}", OW)
st, body, h = call("GET", f"/api/public/publications/{pdfp['id']}/download", raw=True); ok(st == 404, f"descargar edicion en la papelera -> {st}")
st, body, h = call("GET", f"/api/public/publications/{uuid.uuid4()}/download", raw=True); ok(st == 404, f"descargar id inexistente -> {st}")
st, res = call("DELETE", f"/api/publications/{pdfp['id']}/purge", OW)
ok(st == 200 and not obj_exists(pdf_key), "purgar borra el PDF original")

# --- 7. Coleccion con ediciones en la papelera ------------------------------
st, col = call("POST", "/api/collections", OW, {"name": f"QA L5 coleccion {RUN}"}); created_cols.append(col["id"])
inner = new_pub(OW, col["id"], f"QA L5 dentro {RUN}")
call("DELETE", f"/api/publications/{inner['id']}", OW)
st, d = call("DELETE", f"/api/collections/{col['id']}", OW); ok(st == 409 and "papelera" in str(d), f"borrar coleccion con ediciones en la papelera -> {st}")
call("DELETE", f"/api/publications/{inner['id']}/purge", OW)
st, _ = call("DELETE", f"/api/collections/{col['id']}", OW); ok(st == 204, f"tras purgar, la coleccion se borra ({st})")
created_cols.remove(col["id"])

db.close()
print(f"\n{'OK' if not FAILS else 'FALLOS: ' + str(len(FAILS))}")
sys.exit(1 if FAILS else 0)
