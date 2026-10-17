"""QA orden manual de las ediciones (migracion 0016) — 17-oct-2026.

Ejecutar DENTRO del contenedor backend de DEV:
  docker cp backend/tests/qa_edition_order.py flipbook-dev-backend:/tmp/qa_order.py
  docker exec flipbook-dev-backend python /tmp/qa_order.py
Re-ejecutable: purga lo que crea (atexit). Todo debe salir PASS.
"""
import sys, json, uuid, atexit, urllib.request, urllib.error
sys.path.insert(0, "/app")
from datetime import timedelta
from app.core.security import token_with_current_version as create_access_token
from app.db.session import SessionLocal
from app.models.publication import Publication
from app.models.collection import Collection
from app.services.trash import purge_publication

B = "http://localhost:8000"
FAILS, RUN = [], uuid.uuid4().hex[:6]


def call(method, path, token=None, body=None):
    h = {"Content-Type": "application/json"}
    if token: h["Authorization"] = "Bearer " + token
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(B + path, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(r) as x:
            c = x.read(); return x.status, (json.loads(c) if c else None)
    except urllib.error.HTTPError as e:
        c = e.read()
        try: return e.code, json.loads(c)
        except Exception: return e.code, c[:120]


def ok(c, m):
    print(("PASS " if c else "FAIL ") + m)
    if not c: FAILS.append(m)


def tok(email): return create_access_token({"sub": email}, timedelta(minutes=20))
SA, OW, ED = tok("jose.reyes@cetrix.com.mx"), tok("owner.demo@example.com"), tok("editor.demo@example.com")
pubs, cols = [], []


@atexit.register
def _cleanup():
    db = SessionLocal()
    try:
        for pid in pubs:
            p = db.query(Publication).filter(Publication.id == pid).first()
            if p: purge_publication(db, p)
        for cid in cols:
            c = db.query(Collection).filter(Collection.id == cid).first()
            if c: db.delete(c)
        db.commit()
    finally:
        db.close()


def new_pub(token, col, title):
    st, p = call("POST", "/api/publications/", token, {"title": title, "collection_id": col, "total_pages": 2})
    assert st == 201, (st, p); pubs.append(p["id"]); return p


def db_idx(pid):
    db = SessionLocal()
    try:
        p = db.query(Publication).filter(Publication.id == pid).first(); return p.sort_index, p.updated_at
    finally:
        db.close()


st, c1 = call("POST", "/api/collections", OW, {"name": f"QA Orden {RUN}"}); cols.append(c1["id"])
st, c2 = call("POST", "/api/collections", OW, {"name": f"QA Orden B {RUN}"}); cols.append(c2["id"])
A, Bp, C = (new_pub(OW, c1["id"], f"QA orden {n} {RUN}") for n in "ABC")

ok([db_idx(p["id"])[0] for p in (A, Bp, C)] == [1, 2, 3], "las ediciones nuevas entran al final (1,2,3)")
st, lst = call("GET", f"/api/publications/?collection_id={c1['id']}", OW)
ok(st == 200 and [p["id"] for p in lst] == [A["id"], Bp["id"], C["id"]], "el listado del admin sigue el orden (izquierda -> derecha)")

_, upd_before = db_idx(A["id"])
st, r = call("PUT", f"/api/collections/{c1['id']}/order", OW, {"ids": [C["id"], A["id"], Bp["id"]]})
ok(st == 200 and r["order"] == [C["id"], A["id"], Bp["id"]], f"reordenar -> 200 ({st})")
st, lst = call("GET", f"/api/publications/?collection_id={c1['id']}", OW)
ok([p["id"] for p in lst] == [C["id"], A["id"], Bp["id"]], "el nuevo orden se persiste y se lista")
ok(db_idx(A["id"])[1] == upd_before, "reordenar no toca updated_at")

D = new_pub(OW, c1["id"], f"QA orden D {RUN}")
ok(db_idx(D["id"])[0] == 4, "una edicion nueva va detras de todas, tras reordenar")

# lista parcial: las no incluidas conservan orden relativo y quedan al final
st, r = call("PUT", f"/api/collections/{c1['id']}/order", OW, {"ids": [D["id"]]})
ok(st == 200 and r["order"] == [D["id"], C["id"], A["id"], Bp["id"]], "lista parcial: el resto conserva su orden al final")

# validaciones
st, _ = call("PUT", f"/api/collections/{c1['id']}/order", OW, {"ids": [A["id"], A["id"]]}); ok(st == 422, f"ids duplicados -> {st}")
st, _ = call("PUT", f"/api/collections/{c1['id']}/order", OW, {"ids": [str(uuid.uuid4())]}); ok(st == 422, f"id inexistente -> {st}")
X = new_pub(OW, c2["id"], f"QA orden X {RUN}")
st, _ = call("PUT", f"/api/collections/{c1['id']}/order", OW, {"ids": [X["id"]]}); ok(st == 422, f"edicion de OTRA coleccion -> {st}")
st, _ = call("PUT", f"/api/collections/{c1['id']}/order", None, {"ids": []}); ok(st in (401, 403), f"sin sesion -> {st}")
st, _ = call("PUT", f"/api/collections/{c1['id']}/order", SA, {"ids": [A["id"]]}); ok(st == 404, f"otra empresa (superadmin sin selector) -> {st}")
st, _ = call("PUT", f"/api/collections/{c1['id']}/order", ED, {"ids": [D["id"], C["id"], A["id"], Bp["id"]]}); ok(st == 200, f"un editor puede ordenar -> {st}")

# mover a otra coleccion: entra al final de la destino
st, _ = call("POST", f"/api/publications/{A['id']}/move", OW, {"collection_id": c2["id"]})
ok(st == 200 and db_idx(A["id"])[0] == 2, f"mover a otra coleccion -> al final de la destino (idx {db_idx(A['id'])[0]})")

# catalogo publico: respeta el orden y expone sort_index
for p in (D, C, Bp):
    call("POST", f"/api/publications/{p['id']}/publish", OW)
    call("PUT", f"/api/publications/{p['id']}/visibility", OW, {"is_public": True})
st, cols_all = call("GET", "/api/collections", OW)
slug = next(c["slug"] for c in cols_all if c["id"] == c1["id"])
from app.models.tenant import Tenant
_db = SessionLocal(); sub = _db.query(Tenant).filter(Tenant.id == _db.query(Publication.tenant_id).filter(Publication.id == D["id"]).scalar()).first().subdomain; _db.close()
st, pub = call("GET", f"/api/public/r/{sub}/{slug}")
ok(st == 200 and [e["id"] for e in pub["editions"]] == [D["id"], C["id"], Bp["id"]] and all("sort_index" in e for e in pub["editions"]),
   f"el kiosco publico sigue el orden fijado ({st})")
call("PUT", f"/api/collections/{c1['id']}/order", OW, {"ids": [Bp["id"], C["id"], D["id"]]})
st, pub = call("GET", f"/api/public/r/{sub}/{slug}")
ok([e["id"] for e in pub["editions"]] == [Bp["id"], C["id"], D["id"]], "al reordenar, el kiosco publico cambia al instante")
st, allp = call("GET", "/api/public/publications")
mine = [e["id"] for e in allp if e["id"] in {Bp["id"], C["id"], D["id"]}]
ok(mine == [Bp["id"], C["id"], D["id"]], "el catalogo global tambien respeta el orden")

print("\nRESULTADO:", "TODO OK" if not FAILS else f"{len(FAILS)} FALLOS: {FAILS}")
sys.exit(1 if FAILS else 0)
