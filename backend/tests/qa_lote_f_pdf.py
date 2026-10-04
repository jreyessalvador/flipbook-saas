"""QA Lote F (2026-10-04): exportar PDF desde el panel + API interna del worker.

Ejecutar DENTRO del contenedor backend de DEV (con el worker de Contabo 2 en
marcha para las pruebas de extremo a extremo):
  docker cp backend/tests/qa_lote_f_pdf.py flipbook-dev-backend:/tmp/qa_f.py
  docker exec flipbook-dev-backend python /tmp/qa_f.py
Usa la Empresa Demo (owner/editor/lector demo). Re-ejecutable (atexit).
"""
import sys, json, time, uuid, atexit, urllib.request, urllib.error
sys.path.insert(0, "/app")
from datetime import timedelta
from app.config import settings
from app.core.security import token_with_current_version as create_access_token  # EQ-1: incluye "tv"
from app.db.session import SessionLocal
from app.models.publication import Publication
from app.models.render_job import RenderJob
from app.services.trash import purge_publication

B = "http://localhost:8000"
FAILS = []
RUN = uuid.uuid4().hex[:6]
GOOD = {"X-Render-Token": settings.RENDER_WORKER_TOKEN, "X-Real-IP": settings.RENDER_GATEWAY_CLIENT_IP}


def call(method, path, token=None, body=None, headers=None, raw=False, data=None):
    h = {"Content-Type": "application/json"}
    if token: h["Authorization"] = "Bearer " + token
    h.update(headers or {})
    payload = data if data is not None else (json.dumps(body).encode() if body is not None else None)
    r = urllib.request.Request(B + path, data=payload, method=method, headers=h)
    try:
        with urllib.request.urlopen(r) as x:
            c = x.read()
            return x.status, (c if raw else (json.loads(c) if c else None)), dict(x.headers)
    except urllib.error.HTTPError as e:
        c = e.read()
        try: return e.code, json.loads(c), dict(e.headers)
        except Exception: return e.code, c[:120], dict(e.headers)


def ok(c, m):
    print(("PASS " if c else "FAIL ") + m)
    if not c: FAILS.append(m)


def tok(e): return create_access_token({"sub": e}, timedelta(minutes=20))
OW, ED, RD, SA = tok("owner.demo@example.com"), tok("editor.demo@example.com"), tok("lector.demo@example.com"), tok("jose.reyes@cetrix.com.mx")
created = []


@atexit.register
def _cleanup():
    db = SessionLocal()
    try:
        for pid in created:
            p = db.query(Publication).execution_options(include_deleted=True).filter(Publication.id == pid).first()
            if p is not None:
                try: purge_publication(db, p)
                except Exception: db.rollback()
    finally:
        db.close()


def wait_job(pid, jid, token=OW, limit=120):
    t0 = time.time()
    while time.time() - t0 < limit:
        st, info, _ = call("GET", f"/api/publications/{pid}/pdf", token)
        j = next((x for x in info["jobs"] if x["id"] == jid), None)
        if j and j["status"] in ("done", "failed"): return j
        time.sleep(2)
    return j


ok(bool(settings.RENDER_WORKER_TOKEN) and len(settings.RENDER_WORKER_TOKEN) >= 32, "token del worker configurado (>=32 caracteres)")

# --- API interna: barreras ------------------------------------------------
st, _, _ = call("POST", "/api/internal/render/claim"); ok(st == 404, f"interna sin token -> {st}")
st, _, _ = call("POST", "/api/internal/render/claim", headers={"X-Render-Token": settings.RENDER_WORKER_TOKEN}); ok(st == 404, f"interna con token pero sin IP del tunel -> {st}")
st, _, _ = call("POST", "/api/internal/render/claim", headers={"X-Render-Token": "x" * 64, "X-Real-IP": settings.RENDER_GATEWAY_CLIENT_IP}); ok(st == 404, f"interna con token falso -> {st}")
st, _, _ = call("POST", "/api/internal/render/claim", headers={"X-Render-Token": settings.RENDER_WORKER_TOKEN, "X-Real-IP": "85.86.1.1"}); ok(st == 404, f"interna con IP distinta -> {st}")
st, _, _ = call("GET", f"/api/internal/render/jobs/{uuid.uuid4()}/data", headers=GOOD); ok(st == 404, f"datos de un trabajo inexistente -> {st}")
st, _, _ = call("GET", "/api/internal/render/yt/../../etc", headers=GOOD); ok(st == 404, f"miniatura YouTube con id invalido -> {st}")
st, _, _ = call("GET", "/api/internal/render/yt/abc", headers=GOOD); ok(st == 404, f"miniatura YouTube id corto -> {st}")

# --- Panel: permisos y aislamiento ---------------------------------------
st, cols, _ = call("GET", "/api/collections", OW)
general = next(c for c in cols if c["is_default"])
st, p, _ = call("POST", "/api/publications/", OW, {"title": f"QA F {RUN}", "collection_id": general["id"], "total_pages": 2})
created.append(p["id"])
st, _, _ = call("POST", f"/api/publications/{p['id']}/pdf", RD, {"source": "draft"}); ok(st == 403, f"lector NO puede exportar -> {st}")
st, _, _ = call("POST", f"/api/publications/{p['id']}/pdf", SA, {"source": "draft"}); ok(st == 404, f"otra empresa NO puede exportar -> {st}")
st, d, _ = call("POST", f"/api/publications/{p['id']}/pdf", ED, {"source": "published"}); ok(st == 409, f"versión publicada sin publicar -> {st}")
st, info, _ = call("GET", f"/api/publications/{p['id']}/pdf", ED); ok(st == 200 and info["has_published"] is False, "GET lista: has_published=false")

# --- Extremo a extremo con el worker -------------------------------------
st, j, _ = call("POST", f"/api/publications/{p['id']}/pdf", ED, {"source": "draft"})
ok(st == 202 and j["status"] in ("queued", "running", "done") and j["source"] == "draft", f"editor pide PDF del borrador ({st} {j.get('status')})")
st, j2, _ = call("POST", f"/api/publications/{p['id']}/pdf", ED, {"source": "draft"})
ok(j2["id"] == j["id"] and j2["reused"] is True, "mismo contenido -> mismo trabajo (cache, sin duplicar)")
job = wait_job(p["id"], j["id"])
ok(job and job["status"] == "done" and job["page_count"] == 2 and job["size_bytes"] > 1000, f"worker genera el PDF ({job and job['status']}, {job and job.get('size_bytes')} B)")
if job and job["status"] == "done":
    st, body, h = call("GET", job["download_path"], ED, raw=True)
    ok(st == 200 and body[:5] == b"%PDF-" and "-borrador.pdf" in h.get("content-disposition", ""), f"descarga PDF ({h.get('content-disposition')})")
    st, _, _ = call("GET", job["download_path"], SA, raw=True); ok(st == 404, f"otra empresa NO descarga -> {st}")
    st, _, _ = call("GET", job["download_path"], RD, raw=True); ok(st == 403, f"lector NO descarga -> {st}")
    st, _, _ = call("GET", f"/api/internal/render/jobs/{job['id']}/data", headers=GOOD); ok(st == 404, f"datos internos de un trabajo terminado -> {st}")
    st, _, _ = call("POST", f"/api/internal/render/jobs/{job['id']}/result", headers={**GOOD, "Content-Type": "application/pdf"}, data=b"%PDF-1.4 x"); ok(st == 404, f"no se puede sobrescribir un PDF terminado -> {st}")

# Cambiar el contenido -> trabajo nuevo
call("PUT", f"/api/publications/{p['id']}", ED, {"title": f"QA F cambiada {RUN}"})
st, pages, _ = call("GET", f"/api/pages/publications/{p['id']}/pages", ED)
st, cur, _ = call("GET", f"/api/pages/{pages[0]['id']}/elements", ED)
call("PUT", f"/api/pages/{pages[0]['id']}/elements", ED, {"version": cur["version"], "elements": [
    {"kind": "text", "x": 40, "y": 40, "width": 300, "height": 50, "rotation_deg": 0, "z_index": 0, "props": {"text": "QA F", "fontSize": 24}},
    {"kind": "hotspot", "x": 40, "y": 120, "width": 200, "height": 60, "rotation_deg": 0, "z_index": 1, "props": {"action": "url", "value": "https://cetrix.com.mx"}},
]})
st, j3, _ = call("POST", f"/api/publications/{p['id']}/pdf", ED, {"source": "draft"})
ok(j3["id"] != j["id"] and j3["reused"] is False, "contenido distinto -> PDF nuevo")
job3 = wait_job(p["id"], j3["id"])
ok(job3 and job3["status"] == "done", f"segundo PDF generado ({job3 and job3['status']})")
if job3 and job3["status"] == "done":
    st, body, h = call("GET", job3["download_path"], OW, raw=True)
    ok(b"/URI (https://cetrix.com.mx)" in body or b"cetrix.com.mx" in body, "el hotspot URL es un enlace clicable dentro del PDF")

# Publicar y exportar la version publicada
call("POST", f"/api/publications/{p['id']}/publish", OW)
st, jp, _ = call("POST", f"/api/publications/{p['id']}/pdf", ED, {"source": "published"})
ok(st == 202 and jp["source"] == "published", "exportar versión publicada tras publicar")
jobp = wait_job(p["id"], jp["id"])
ok(jobp and jobp["status"] == "done", f"PDF de la versión publicada ({jobp and jobp['status']})")

# Purga: borra filas y objetos de los PDFs
db = SessionLocal()
keys = [r.result_key for r in db.query(RenderJob).filter(RenderJob.publication_id == p["id"]).all() if r.result_key]
call("DELETE", f"/api/publications/{p['id']}", OW); call("DELETE", f"/api/publications/{p['id']}/purge", OW)
from app.api.assets import minio_client, BUCKET_NAME
def exists(k):
    try: minio_client.stat_object(BUCKET_NAME, k); return True
    except Exception: return False
db.expire_all()
ok(db.query(RenderJob).filter(RenderJob.publication_id == p["id"]).count() == 0 and keys and not any(exists(k) for k in keys), f"purgar la edición borra sus PDFs ({len(keys)} objetos)")
db.close()

print(f"\n{'OK' if not FAILS else 'FALLOS: ' + str(len(FAILS))}")
sys.exit(1 if FAILS else 0)
