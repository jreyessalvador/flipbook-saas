"""QA Lote L7a (2026-10-16): portada completa renderizada + imagen OG.

Ejecutar DENTRO del contenedor backend de DEV, con el worker de Contabo 2 en marcha:
  docker cp backend/tests/qa_l7a_covers.py flipbook-dev-backend:/tmp/qa_l7a.py
  docker exec flipbook-dev-backend python /tmp/qa_l7a.py
Usa la Empresa Demo. Re-ejecutable: purga lo que crea (atexit).
"""
import sys, io, json, time, uuid, atexit, urllib.request, urllib.error
sys.path.insert(0, "/app")
from datetime import timedelta
from PIL import Image
from app.config import settings
from app.core.security import token_with_current_version as create_access_token
from app.db.session import SessionLocal
from app.models.publication import Publication
from app.models.render_job import RenderJob
from app.services.render_jobs import request_cover, cover_object_keys
from app.services.trash import purge_publication, utcnow
from app.api.assets import minio_client, BUCKET_NAME

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
            return x.status, (c if raw else (json.loads(c) if c else None)), {k.lower(): v for k, v in x.headers.items()}
    except urllib.error.HTTPError as e:
        c = e.read()
        try: return e.code, json.loads(c), {k.lower(): v for k, v in e.headers.items()}
        except Exception: return e.code, c[:120], {k.lower(): v for k, v in e.headers.items()}


def ok(c, m):
    print(("PASS " if c else "FAIL ") + m)
    if not c: FAILS.append(m)


def tok(e): return create_access_token({"sub": e}, timedelta(minutes=20))
OW, ED, RD = tok("owner.demo@example.com"), tok("editor.demo@example.com"), tok("lector.demo@example.com")
created = []
versions = set()


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


def multipart(files):
    b = "----qa" + uuid.uuid4().hex
    body = b"".join(
        f'--{b}\r\nContent-Disposition: form-data; name="{k}"; filename="{fn}"\r\nContent-Type: {ct}\r\n\r\n'.encode() + data + b"\r\n"
        for k, (fn, data, ct) in files.items()
    ) + f"--{b}--\r\n".encode()
    return body, {"Content-Type": f"multipart/form-data; boundary={b}"}


def png_of(w=40, h=56):
    buf = io.BytesIO(); Image.new("RGB", (w, h), (200, 30, 30)).save(buf, "PNG"); return buf.getvalue()


FAKE_WEBP = b"RIFF\x00\x00\x00\x00WEBP" + b"x" * 200
FAKE_JPG = b"\xff\xd8\xff\xe0" + b"x" * 200
OKFILES = {"cover_400": ("cover-400.webp", FAKE_WEBP, "image/webp"),
           "cover_800": ("cover-800.webp", FAKE_WEBP, "image/webp"),
           "og": ("og-1200x630.jpg", FAKE_JPG, "image/jpeg")}


def pub_row(pid):
    db = SessionLocal()
    try:
        p = db.query(Publication).filter(Publication.id == pid).first()
        return None if p is None else dict(cover_key=p.cover_key, og_key=p.og_key,
                                           cover_version_id=str(p.cover_version_id) if p.cover_version_id else None,
                                           published_version_id=str(p.published_version_id) if p.published_version_id else None,
                                           tenant_id=p.tenant_id)
    finally:
        db.close()


def wait_cover(pid, version, limit=120):
    t0 = time.time()
    while time.time() - t0 < limit:
        r = pub_row(pid)
        if r and r["cover_key"] and r["cover_version_id"] == str(version): return r
        time.sleep(2)
    return pub_row(pid)


def exists(key):
    try: minio_client.stat_object(BUCKET_NAME, key); return True
    except Exception: return False


def catalog_item(pid):
    st, items, _ = call("GET", "/api/public/publications")
    return next((i for i in items if str(i["id"]) == str(pid)), None) if st == 200 else None


def manual_job(pid, kind, version_id, status="running"):
    """Trabajo ya 'running' creado a mano (el worker real no lo reclama)."""
    db = SessionLocal()
    try:
        p = db.query(Publication).filter(Publication.id == pid).first()
        j = RenderJob(tenant_id=p.tenant_id, publication_id=p.id, version_id=version_id, source="published", kind=kind,
                      status=status, snapshot={"pages": []}, snapshot_hash=uuid.uuid4().hex + uuid.uuid4().hex[:32],
                      title="qa", page_width=210, page_height=297, page_count=1, claimed_at=utcnow(), attempts=1)
        db.add(j); db.commit(); return str(j.id)
    finally:
        db.close()


# --- Preparar una edicion con contenido propio -----------------------------
st, cols, _ = call("GET", "/api/collections", OW)
general = next(c for c in cols if c["is_default"])
st, p, _ = call("POST", "/api/publications/", OW, {"title": f"QA L7a {RUN}", "collection_id": general["id"], "total_pages": 2})
PID = p["id"]; created.append(PID)
st, pages, _ = call("GET", f"/api/pages/publications/{PID}/pages", ED)
st, cur, _ = call("GET", f"/api/pages/{pages[0]['id']}/elements", ED)
st, _, _ = call("PUT", f"/api/pages/{pages[0]['id']}/elements", ED, {"version": cur["version"], "elements": [
    {"kind": "text", "x": 40, "y": 60, "width": 500, "height": 90, "rotation_deg": 0, "z_index": 0,
     "props": {"text": f"Portada QA {RUN}", "fontSize": 48}}]})
ok(st == 200, f"edicion de prueba con portada propia ({st})")

# --- Barreras de la API interna (cover-result) ------------------------------
jc = manual_job(PID, "cover", uuid.uuid4())
body, hdr = multipart(OKFILES)
st, _, _ = call("POST", f"/api/internal/render/jobs/{jc}/cover-result", headers=hdr, data=body); ok(st == 404, f"cover-result sin token -> {st}")
st, _, _ = call("POST", f"/api/internal/render/jobs/{jc}/cover-result", headers={**hdr, "X-Render-Token": settings.RENDER_WORKER_TOKEN}, data=body); ok(st == 404, f"cover-result con token pero sin IP del tunel -> {st}")
st, _, _ = call("POST", f"/api/internal/render/jobs/{uuid.uuid4()}/cover-result", headers={**GOOD, **hdr}, data=body); ok(st == 404, f"cover-result de trabajo inexistente -> {st}")
jp = manual_job(PID, "pdf", None)
st, _, _ = call("POST", f"/api/internal/render/jobs/{jp}/cover-result", headers={**GOOD, **hdr}, data=body); ok(st == 404, f"cover-result sobre un trabajo de PDF -> {st}")
st, _, _ = call("POST", f"/api/internal/render/jobs/{jc}/result", headers={**GOOD, "Content-Type": "application/pdf"}, data=b"%PDF-1.4 x"); ok(st == 404, f"resultado PDF sobre un trabajo de portada -> {st}")

# --- Validaciones de la subida ----------------------------------------------
def up(files, job=jc):
    b, h = multipart(files)
    return call("POST", f"/api/internal/render/jobs/{job}/cover-result", headers={**GOOD, **h}, data=b)[0]

ok(up({k: v for k, v in OKFILES.items() if k != "og"}) == 422, "falta la imagen OG -> 422")
ok(up({**OKFILES, "cover_400": ("cover-400.webp", png_of(), "image/webp")}) == 422, "un PNG disfrazado de WebP -> 422")
ok(up({**OKFILES, "og": ("og-1200x630.jpg", png_of(), "image/jpeg")}) == 422, "un PNG disfrazado de JPEG -> 422")
ok(up({**OKFILES, "cover_400": ("cover-400.webp", b"RIFF\x00\x00\x00\x00WEBP" + b"x" * 200_000, "image/webp")}) == 422, "cover-400 de mas de 120 KB -> 422")
ok(up({**OKFILES, "og": ("og-1200x630.jpg", b"\xff\xd8\xff" + b"x" * 700_000, "image/jpeg")}) in (413, 422), "OG de mas de 600 KB rechazada")

# Version que ya no es la vigente: las imagenes se descartan (applied=false) y no quedan en MinIO
stale_v = uuid.uuid4()
js = manual_job(PID, "cover", stale_v)
b, h = multipart(OKFILES)
st, r, _ = call("POST", f"/api/internal/render/jobs/{js}/cover-result", headers={**GOOD, **h}, data=b)
ok(st == 200 and r.get("applied") is False, f"version no vigente -> applied=false ({st} {r})")
ok(not any(exists(k) for k in cover_object_keys(pub_row(PID)["tenant_id"], stale_v)), "version no vigente: sin objetos huerfanos en MinIO")
st, _, _ = call("POST", f"/api/internal/render/jobs/{js}/cover-result", headers={**GOOD, **h}, data=b); ok(st == 404, f"un trabajo terminado no admite otra subida -> {st}")

# --- Extremo a extremo con el worker real -----------------------------------
st, pub1, _ = call("POST", f"/api/publications/{PID}/publish", OW)
V1 = pub1["version_id"]; versions.add(V1)
ok(st == 201, f"publicar responde al instante ({st})")
st, _, _ = call("PUT", f"/api/publications/{PID}/visibility", OW, {"is_public": True})
ok(st == 200, f"edicion visible en el catalogo publico ({st})")
r = pub_row(PID)
ok(r["cover_key"] is None, "primera publicacion: aun sin portada renderizada")
it = catalog_item(PID)
ok(it is not None and "/covers/" not in (it["cover_url"] or "") and it["cover_url_2x"] is None, "catalogo en fallback mientras se renderiza")
r = wait_cover(PID, V1)
ok(bool(r["cover_key"]) and r["cover_version_id"] == V1, "el worker renderiza la portada y se asignan los punteros")
if r["cover_key"]:
    t = r["tenant_id"]; k400, k800, kog = cover_object_keys(t, V1)
    ok(r["cover_key"] == k400 and r["og_key"] == kog, "claves de MinIO con id de version")
    def img(k):
        o = minio_client.get_object(BUCKET_NAME, k); d = o.read(); o.close(); o.release_conn()
        return d, Image.open(io.BytesIO(d))
    d4, i4 = img(k400); d8, i8 = img(k800); do, io_ = img(kog)
    ok(i4.format == "WEBP" and i4.width == 400 and len(d4) <= 40 * 1024, f"cover-400: WEBP {i4.size} {len(d4)/1024:.1f} KB (<= 40 KB)")
    ok(i8.format == "WEBP" and i8.width == 800 and len(d8) <= 120 * 1024, f"cover-800: WEBP {i8.size} {len(d8)/1024:.1f} KB (<= 120 KB)")
    ok(io_.format == "JPEG" and io_.size == (1200, 630) and len(do) <= 300 * 1024, f"OG: JPEG {io_.size} {len(do)/1024:.1f} KB (<= 300 KB)")
    it = catalog_item(PID)
    ok(it and it["cover_url"] == f"/api/assets/serve/{k400}" and it["cover_url_2x"] == f"/api/assets/serve/{k800}", "catalogo publico usa la portada completa + version 2x")
    st, body, h = call("GET", f"/api/assets/serve/{k400}", raw=True)
    ok(st == 200 and "immutable" in h.get("cache-control", ""), f"portada servida con cache inmutable ({h.get('cache-control')})")
    st, html_, _ = call("GET", f"/api/public/og/{PID}", raw=True)
    html_ = html_.decode() if isinstance(html_, bytes) else str(html_)
    ok("og-1200x630.jpg" in html_ and 'og:image:width" content="1200"' in html_ and 'og:image:height" content="630"' in html_ and "summary_large_image" in html_, "meta Open Graph: og:image 1200x630 + summary_large_image")
    n_jobs = SessionLocal().query(RenderJob).filter(RenderJob.publication_id == PID, RenderJob.kind == "cover", RenderJob.version_id == V1).count()
    ok(n_jobs == 1, f"un solo trabajo de portada por version ({n_jobs})")
    db = SessionLocal(); pubo = db.query(Publication).filter(Publication.id == PID).first(); verobj = db.execute(__import__("sqlalchemy").text("select * from publication_versions where id=:i"), {"i": V1}).first()
    again = request_cover(db, pubo, db.get(__import__("app.models.publication_version", fromlist=["x"]).PublicationVersion, V1)); db.close()
    ok(str(again.version_id) == V1 and SessionLocal().query(RenderJob).filter(RenderJob.version_id == V1, RenderJob.kind == "cover").count() == 1, "request_cover es idempotente (reutiliza el trabajo)")

    # --- Republicar: se limpian punteros y, al terminar, se borra la portada anterior
    st, pub2, _ = call("POST", f"/api/publications/{PID}/publish", OW)
    V2 = pub2["version_id"]; versions.add(V2)
    r2 = pub_row(PID)
    it2 = catalog_item(PID)
    ok(it2 is not None and "/covers/" not in (it2["cover_url"] or ""), "tras republicar el catalogo NO sirve la portada de la version anterior (fallback)")
    r2 = wait_cover(PID, V2)
    ok(r2["cover_version_id"] == V2 and r2["cover_key"] != k400, "la nueva version tiene su propia portada")
    time.sleep(1)
    ok(not any(exists(k) for k in cover_object_keys(t, V1)), "la portada de la version anterior se elimina de MinIO")

# --- Regresion del panel de PDF: los trabajos de portada no aparecen --------
st, info, _ = call("GET", f"/api/publications/{PID}/pdf", ED)
_db = SessionLocal(); cover_ids = {str(r.id) for r in _db.query(RenderJob).filter(RenderJob.publication_id == PID, RenderJob.kind == "cover").all()}; _db.close()
ok(st == 200 and len(cover_ids) >= 2 and not any(j_["id"] in cover_ids for j_ in info["jobs"]), f"el listado de PDF NO incluye trabajos de portada ({len(cover_ids)} de portada existen)")
st, j, _ = call("POST", f"/api/publications/{PID}/pdf", ED, {"source": "draft"})
ok(st == 202 and j["status"] in ("queued", "running", "done"), f"exportar PDF sigue funcionando junto a las portadas ({st})")
t0 = time.time()
while time.time() - t0 < 120:
    st, info, _ = call("GET", f"/api/publications/{PID}/pdf", ED)
    jj = next((x for x in info["jobs"] if x["id"] == j["id"]), None)
    if jj and jj["status"] in ("done", "failed"): break
    time.sleep(2)
ok(jj and jj["status"] == "done", f"el PDF se genera correctamente ({jj and jj['status']})")

# --- Purga: borra tambien las portadas de MinIO ------------------------------
final = pub_row(PID); tenant = final["tenant_id"]
keys = [k for v in versions for k in cover_object_keys(tenant, v)]
live_before = [k for k in keys if exists(k)]
db = SessionLocal(); pb = db.query(Publication).filter(Publication.id == PID).first(); purge_publication(db, pb); db.close(); created.remove(PID)
ok(len(live_before) >= 3 and not any(exists(k) for k in keys), f"purgar la edicion borra sus portadas de MinIO ({len(live_before)} objetos antes, 0 despues)")

print("\nRESULTADO:", "TODO OK" if not FAILS else f"{len(FAILS)} FALLOS: {FAILS}")
sys.exit(1 if FAILS else 0)
