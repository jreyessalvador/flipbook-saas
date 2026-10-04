"""QA Lote C (2026-09-27): aislamiento multi-tenant de Colecciones/Ediciones.

Ejecutar DENTRO del contenedor backend de DEV (usa JWT firmados localmente):
  docker cp backend/tests/qa_lote_c_tenant_isolation.py flipbook-dev-backend:/tmp/qa.py
  docker exec flipbook-dev-backend python /tmp/qa.py
Crea (si no existe) la empresa "Empresa Demo" (subdominio empresa-demo) con
owner owner.demo@example.com. Todas las lineas deben salir PASS.
"""
import sys, json, secrets, urllib.request, urllib.error
sys.path.insert(0, "/app")
from datetime import timedelta
from app.core.security import token_with_current_version as create_access_token  # EQ-1: incluye "tv"
B = "http://localhost:8000"
def call(method, path, token=None, body=None, headers=None, form=None):
    h = {"Content-Type": "application/json"}
    if token: h["Authorization"] = "Bearer " + token
    h.update(headers or {})
    data = json.dumps(body).encode() if body is not None else None
    if form is not None:
        data = form.encode(); h["Content-Type"] = "application/x-www-form-urlencoded"
    r = urllib.request.Request(B + path, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(r) as x:
            raw = x.read(); return x.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read(); 
        try: return e.code, json.loads(raw)
        except Exception: return e.code, raw[:120]
ok = lambda c, m: print(("PASS " if c else "FAIL ") + m)
SA = create_access_token({"sub": "jose.reyes@cetrix.com.mx"}, timedelta(minutes=15))
st, ov = call("GET", "/api/superadmin/overview", SA)
cetrix = next(t for t in ov["tenants"] if t["subdomain"] == "default")["id"]
demo = next((t for t in ov["tenants"] if t["subdomain"] == "empresa-demo"), None)
if not demo:
    st, demo = call("POST", "/api/superadmin/tenants", SA, {"name": "Empresa Demo", "subdomain": "empresa-demo", "plan_code": "professional"})
    ok(st == 201, f"alta tenant Empresa Demo ({st})")
    st, inv = call("POST", f"/api/superadmin/tenants/{demo['id']}/owner-invitations", SA, {"email": "owner.demo@example.com", "full_name": "Owner Demo"})
    pw = secrets.token_urlsafe(15)
    st2, _ = call("POST", "/api/superadmin/invitations/accept", None, {"token": inv["invite_token"], "password": pw})
    ok(st == 201 and st2 == 200, f"invitacion owner y aceptacion ({st},{st2})")
    open("/tmp/demo_owner_pw", "w").write(pw)
demo_id = demo["id"]
OW = create_access_token({"sub": "owner.demo@example.com"}, timedelta(minutes=15))

st, me = call("GET", "/api/auth/me", OW); ok(st == 200 and me["tenant_name"] == "Empresa Demo" and not me["is_superadmin"], f"/me owner -> {me.get('tenant_name')}")
st, cols = call("GET", "/api/collections", OW); ok(st == 200 and all(c["tenant_id"] == demo_id for c in cols) and any(c["is_default"] for c in cols), f"owner ve solo colecciones de su empresa ({[c['name'] for c in cols]})")
st, pubs = call("GET", "/api/publications/?limit=200", OW); ok(st == 200 and all(p["tenant_id"] == demo_id for p in pubs), f"owner no ve ediciones de CETRIX ({len(pubs)} propias)")
st, sa_pubs = call("GET", "/api/publications/?limit=200", SA)
cetrix_pub = next(p for p in sa_pubs if p["title"] == "Revista de prueba")
st, _ = call("GET", f"/api/publications/{cetrix_pub['id']}", OW); ok(st == 404, f"owner GET edicion CETRIX -> {st}")
st, _ = call("GET", f"/api/pages/publication/{cetrix_pub['id']}", OW); ok(st in (404, 405), f"owner paginas edicion CETRIX -> {st}")
st, _ = call("GET", "/api/collections", OW, headers={"X-Tenant-Id": cetrix}); 
st, cols2 = call("GET", "/api/collections", OW, headers={"X-Tenant-Id": cetrix}); ok(all(c["tenant_id"] == demo_id for c in cols2), "owner con X-Tenant-Id de CETRIX: cabecera ignorada")
st, sa_cols = call("GET", "/api/collections", SA); cetrix_general = next(c for c in sa_cols if c["is_default"])
st, _ = call("POST", "/api/publications/", OW, {"title": "Intrusa", "collection_id": cetrix_general["id"], "total_pages": 2}); ok(st == 404, f"owner crea edicion en coleccion CETRIX -> {st}")
newcol = next((c for c in cols if c["name"] == "Revista Demo"), None)
if newcol is None:
    st, newcol = call("POST", "/api/collections", OW, {"name": "Revista Demo", "description": "Colección de pruebas"}); ok(st == 201, f"owner crea coleccion ({st})")
st, ed = call("POST", "/api/publications/", OW, {"title": "QA edición temporal", "collection_id": newcol["id"], "total_pages": 2, "edition_label": "QA"}); ok(st == 201 and ed["collection_id"] == newcol["id"], f"owner crea edicion en su coleccion ({st})")
st, _ = call("POST", f"/api/publications/{ed['id']}/move", OW, {"collection_id": cetrix_general["id"]}); ok(st == 404, f"owner mueve a coleccion CETRIX -> {st}")
st, _ = call("POST", f"/api/publications/{cetrix_pub['id']}/move", OW, {"collection_id": newcol["id"]}); ok(st == 404, f"owner mueve edicion CETRIX -> {st}")
st, _ = call("DELETE", f"/api/collections/{newcol['id']}", OW); ok(st == 409, f"borrar coleccion con ediciones -> {st}")
st, own_cols = call("GET", "/api/collections", OW); dflt = next(c for c in own_cols if c["is_default"])
st, _ = call("DELETE", f"/api/collections/{dflt['id']}", OW); ok(st == 409, f"borrar coleccion por defecto -> {st}")
st, _ = call("DELETE", f"/api/collections/{cetrix_general['id']}", OW); ok(st == 404, f"owner borra coleccion CETRIX -> {st}")
st, sa_demo = call("GET", "/api/collections", SA, headers={"X-Tenant-Id": demo_id}); ok(st == 200 and all(c["tenant_id"] == demo_id for c in sa_demo) and "Revista Demo" in {c["name"] for c in sa_demo}, f"superadmin con selector ve Empresa Demo ({[c['name'] for c in sa_demo]})")
st, me_sa = call("GET", "/api/auth/me", SA, headers={"X-Tenant-Id": demo_id}); ok(me_sa["acting_as_tenant"] and me_sa["tenant_name"] == "Empresa Demo", "/me superadmin actuando como Empresa Demo")
st, sa_own = call("GET", "/api/collections", SA); ok(all(c["tenant_id"] == cetrix for c in sa_own), "superadmin sin selector ve CETRIX")
st, pr = call("POST", "/api/collections", SA, {"name": "Pruebas QA"}); 
st, mv = call("POST", f"/api/publications/{cetrix_pub['id']}/move", SA, {"collection_id": pr["id"]}); ok(st == 200 and mv["collection_id"] == pr["id"], f"mover edicion entre colecciones CETRIX ({st})")
st, mv = call("POST", f"/api/publications/{cetrix_pub['id']}/move", SA, {"collection_id": cetrix_general["id"]}); ok(st == 200, "devolver edicion a General")
st, _ = call("DELETE", f"/api/collections/{pr['id']}", SA); ok(st == 204, f"borrar coleccion vacia ({st})")
st, _ = call("PATCH", f"/api/superadmin/tenants/{demo_id}/status", SA, {"status": "suspended"})
st, _ = call("GET", "/api/collections", OW); ok(st == 403, f"empresa suspendida -> {st}")
call("PATCH", f"/api/superadmin/tenants/{demo_id}/status", SA, {"status": "active"})
st, _ = call("GET", "/api/collections", OW); ok(st == 200, f"empresa reactivada -> {st}")
st, _ = call("POST", "/api/auth/register", None, {"email": "x@example.com", "password": "abcdefghijkl"}); ok(st == 404, f"/register cerrado -> {st}")
st, cats = call("GET", "/api/categories", OW); ok(st == 200 and len(cats) == 17, f"categorias comunes visibles ({len(cats)})")
st, _ = call("GET", "/api/superadmin/categories", OW); ok(st == 403, f"owner no gestiona categorias -> {st}")
st, _ = call("PUT", f"/api/collections/{newcol['id']}", OW, {"category_id": cats[0]["id"]}); ok(st == 200, "asignar categoria a coleccion")

# limpieza: el script es re-ejecutable (borra su edicion temporal)
st, _ = call("DELETE", f"/api/publications/{ed['id']}", OW); ok(st == 204, f"limpieza edicion temporal ({st})"); call("DELETE", f"/api/publications/{ed['id']}/purge", OW)  # L5
