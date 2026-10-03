"""QA Lote C2 (2026-09-27): RBAC dentro de la empresa + gestion de equipo.

Ejecutar DENTRO del contenedor backend de DEV, DESPUES de qa_lote_c_tenant_isolation.py
(necesita "Empresa Demo" y su owner owner.demo@example.com):
  docker cp backend/tests/qa_lote_c2_rbac_team.py flipbook-dev-backend:/tmp/qa2.py
  docker exec flipbook-dev-backend python /tmp/qa2.py
Crea (si no existen) admin/editor/lector demo y deja sus contrasenas en
/tmp/demo_users.txt dentro del contenedor. Todas las lineas deben salir PASS.
"""
import sys, json, secrets, urllib.request, urllib.error
sys.path.insert(0, "/app")
from datetime import timedelta
from app.core.security import create_access_token
B = "http://localhost:8000"

def call(method, path, token=None, body=None, headers=None):
    h = {"Content-Type": "application/json"}
    if token: h["Authorization"] = "Bearer " + token
    h.update(headers or {})
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(B + path, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(r) as x:
            raw = x.read(); return x.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read()
        try: return e.code, json.loads(raw)
        except Exception: return e.code, raw[:160]

results = []
def ok(c, m):
    results.append(bool(c)); print(("PASS " if c else "FAIL ") + m)
tok = lambda email: create_access_token({"sub": email}, timedelta(minutes=15))

SA = tok("jose.reyes@cetrix.com.mx"); OW = tok("owner.demo@example.com")
creds = {}
st, team = call("GET", "/api/team/members", OW)
ok(st == 200, f"owner lista equipo ({st}) asientos {team.get('seats_used') if isinstance(team, dict) else '-'} / {team.get('seats_limit') if isinstance(team, dict) else '-'}")
existing = {m["email"]: m for m in team["members"]}

def ensure(email, role, inviter=OW):
    if email in existing and existing[email]["status"] == "active":
        return
    st, inv = call("POST", "/api/team/invitations", inviter, {"email": email, "full_name": role.title() + " Demo", "role": role})
    if st == 409 and email in existing:
        st, inv = call("POST", f"/api/team/members/{existing[email]['id']}/resend", inviter)
    pw = secrets.token_urlsafe(15)
    st2, _ = call("POST", "/api/superadmin/invitations/accept", None, {"token": inv["invite_token"], "password": pw})
    creds[email] = pw
    ok(st in (200, 201) and st2 == 200, f"invitar+aceptar {role} {email} ({st},{st2})")

ensure("admin.demo@example.com", "admin")
ensure("editor.demo@example.com", "editor")
ensure("lector.demo@example.com", "reader")
AD, ED, RD = tok("admin.demo@example.com"), tok("editor.demo@example.com"), tok("lector.demo@example.com")

for t, exp in ((OW, "owner"), (AD, "admin"), (ED, "editor"), (RD, "reader"), (SA, "owner")):
    st, me = call("GET", "/api/auth/me", t); ok(me.get("tenant_role") == exp, f"/me tenant_role={me.get('tenant_role')} (esperado {exp})")

st, cols = call("GET", "/api/collections", RD); ok(st == 200, f"lector ve colecciones ({st})")
demo_col = next(c for c in cols if c["name"] == "Revista Demo")
st, _ = call("POST", "/api/publications/", RD, {"title": "X", "collection_id": demo_col["id"], "total_pages": 2}); ok(st == 403, f"lector NO crea edicion -> {st}")
st, _ = call("POST", "/api/collections", RD, {"name": "X"}); ok(st == 403, f"lector NO crea coleccion -> {st}")
st, _ = call("GET", "/api/team/members", RD); ok(st == 403, f"lector NO ve equipo -> {st}")

st, ed = call("POST", "/api/publications/", ED, {"title": "Edición del editor", "collection_id": demo_col["id"], "total_pages": 2}); ok(st == 201, f"editor crea edicion ({st})")
import atexit
_cleanup = {"ed": ed.get("id") if isinstance(ed, dict) else None, "c2": None}
def _limpieza():
    # Garantiza que no queden ediciones/colecciones de prueba aunque el script falle a mitad (idempotente).
    if _cleanup["ed"]:
        call("POST", f"/api/publications/{_cleanup['ed']}/unpublish", OW); call("DELETE", f"/api/publications/{_cleanup['ed']}", OW); call("DELETE", f"/api/publications/{_cleanup['ed']}/purge", OW)  # L5: papelera
    if _cleanup["c2"]:
        call("DELETE", f"/api/collections/{_cleanup['c2']}", OW)
atexit.register(_limpieza)
st, _ = call("PUT", f"/api/publications/{ed['id']}", ED, {"title": "Edición del editor (editada)"}); ok(st == 200, f"editor edita edicion ({st})")
st, pages = call("GET", f"/api/pages/publications/{ed['id']}/pages", ED); ok(st == 200, f"editor ve paginas ({st})")
st, _ = call("PUT", f"/api/pages/{pages[0]['id']}/elements", RD, {"elements": [], "version": 0}); ok(st == 403, f"lector NO guarda elementos -> {st}")
st, _ = call("POST", f"/api/publications/{ed['id']}/publish", ED); ok(st == 403, f"editor NO publica -> {st}")
st, _ = call("DELETE", f"/api/publications/{ed['id']}", ED); ok(st == 403, f"editor NO borra -> {st}")
st, _ = call("POST", "/api/collections", ED, {"name": "X"}); ok(st == 403, f"editor NO crea coleccion -> {st}")
st, _ = call("GET", "/api/team/members", ED); ok(st == 403, f"editor NO ve equipo -> {st}")

st, _ = call("POST", f"/api/publications/{ed['id']}/publish", AD); ok(st == 201, f"admin publica ({st})")
st, c2 = call("POST", "/api/collections", AD, {"name": "Colección del admin"}); ok(st == 201, f"admin crea coleccion ({st})")
_cleanup["c2"] = c2.get("id") if isinstance(c2, dict) else None
st, _ = call("POST", f"/api/publications/{ed['id']}/move", ED, {"collection_id": c2["id"]}); ok(st == 200, f"editor mueve edicion ({st})")
st, _ = call("POST", "/api/team/invitations", AD, {"email": "otro.admin@example.com", "role": "admin"}); ok(st == 403, f"admin NO invita administradores -> {st}")
st, team = call("GET", "/api/team/members", AD)
owner_m = next(m for m in team["members"] if m["role"] == "owner")
admin_m = next(m for m in team["members"] if m["email"] == "admin.demo@example.com")
editor_m = next(m for m in team["members"] if m["email"] == "editor.demo@example.com")
ok(not owner_m["can_manage"], "admin no puede gestionar al propietario (can_manage=false)")
st, _ = call("PATCH", f"/api/team/members/{owner_m['id']}", AD, {"role": "reader"}); ok(st == 403, f"admin NO cambia rol del owner -> {st}")
st, _ = call("DELETE", f"/api/team/members/{owner_m['id']}", AD); ok(st == 403, f"admin NO revoca al owner -> {st}")
st, _ = call("PATCH", f"/api/team/members/{admin_m['id']}", AD, {"role": "editor"}); ok(st == 403, f"nadie cambia su propio rol -> {st}")
st, _ = call("PATCH", f"/api/team/members/{editor_m['id']}", AD, {"role": "reviewer"}); ok(st == 200, f"admin cambia editor->revisor ({st})")
st, _ = call("PATCH", f"/api/team/members/{editor_m['id']}", AD, {"role": "editor"}); ok(st == 200, "admin lo devuelve a editor")
st, _ = call("PATCH", f"/api/team/members/{admin_m['id']}", OW, {"role": "admin"}); ok(st == 200, f"owner gestiona administradores ({st})")

st, _ = call("POST", "/api/team/invitations", OW, {"email": "jose.reyes@cetrix.com.mx", "role": "editor"}); ok(st == 409, f"invitar email de OTRA empresa -> {st}")
st, team = call("GET", "/api/team/members", OW)
limit, used = team["seats_limit"], team["seats_used"]
extra = []
if limit is not None:
    i = 0
    while used < limit:
        i += 1
        s2, inv = call("POST", "/api/team/invitations", OW, {"email": f"relleno{i}@example.com", "role": "reader"}); extra.append(inv); used += 1
    s3, _ = call("POST", "/api/team/invitations", OW, {"email": "sobra@example.com", "role": "reader"}); ok(s3 == 403, f"limite de asientos del plan ({limit}) -> {s3}")
    st, team = call("GET", "/api/team/members", OW)
    for m in team["members"]:
        if m["email"].startswith("relleno"):
            call("DELETE", f"/api/team/members/{m['id']}", OW)
    ok(True, "limpieza de invitaciones de relleno")
# cuenta activa: una invitacion no puede cambiar su contrasena
st, inv = call("POST", f"/api/team/members/{editor_m['id']}/resend", OW); ok(st == 409, f"no se reenvia invitacion a miembro activo -> {st}")
# revocado pierde acceso
TEMP_EMAIL = f"temporal.{secrets.token_hex(3)}.demo@example.com"  # unico por ejecucion: el script es re-ejecutable
s, rv = call("POST", "/api/team/invitations", OW, {"email": TEMP_EMAIL, "role": "editor"})
pw = secrets.token_urlsafe(15); call("POST", "/api/superadmin/invitations/accept", None, {"token": rv["invite_token"], "password": pw})
TT = tok(TEMP_EMAIL); st, _ = call("GET", "/api/collections", TT); ok(st == 200, "miembro temporal entra")
call("DELETE", f"/api/team/members/{rv['membership_id']}", OW)
st, _ = call("GET", "/api/collections", TT); ok(st == 403, f"miembro revocado pierde acceso -> {st}")
st, _ = call("POST", "/api/superadmin/invitations/accept", None, {"token": rv["invite_token"], "password": "otraclave12345"}); ok(st == 400, f"token de invitacion usado/revocado no sirve -> {st}")
# limpieza de la edicion de prueba
call("POST", f"/api/publications/{ed['id']}/unpublish", AD); st, _ = call("DELETE", f"/api/publications/{ed['id']}", AD); ok(st == 204, f"admin borra edicion de prueba ({st})"); call("DELETE", f"/api/publications/{ed['id']}/purge", OW)  # L5: vaciar de la papelera
call("DELETE", f"/api/collections/{c2['id']}", AD)
if creds:
    open("/tmp/demo_users.txt", "a").write("".join(f"{e} {p}\n" for e, p in creds.items()))
print(f"RESUMEN: {sum(results)}/{len(results)} PASS")
