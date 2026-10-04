"""QA Lote EQ-1 (2026-10-04): «Mi cuenta» (cambiar contrasena) + version de sesion.

Ejecutar DENTRO del contenedor backend de DEV:
  docker cp backend/tests/qa_lote_eq1_cuenta.py flipbook-dev-backend:/tmp/qa_eq1.py
  docker exec flipbook-dev-backend python /tmp/qa_eq1.py
Crea un usuario temporal en Empresa Demo y lo borra al final (atexit).
"""
import sys, json, uuid, atexit, hashlib, secrets, urllib.request, urllib.error, urllib.parse
sys.path.insert(0, "/app")
from datetime import datetime, timedelta, timezone
from app.core.security import get_password_hash, create_access_token, token_with_current_version
from app.db.session import SessionLocal
from app.models.user import User
from app.models.tenant import Tenant
from app.models.commercial import TenantMembership, Role
from app.models.audit_log import AuditLog
from app.models.password_reset_token import PasswordResetToken

B = "http://localhost:8000"
FAILS = []
RUN = uuid.uuid4().hex[:8]
EMAIL = f"qa-eq1-{RUN}@example.com"
PW1, PW2, PW3 = "Clave-Inicial-" + RUN, "Clave-Nueva-" + RUN, "Clave-Reset-" + RUN


def call(method, path, token=None, body=None, form=None):
    h = {}
    data = None
    if form is not None:
        data = urllib.parse.urlencode(form).encode(); h["Content-Type"] = "application/x-www-form-urlencoded"
    elif body is not None:
        data = json.dumps(body).encode(); h["Content-Type"] = "application/json"
    if token: h["Authorization"] = "Bearer " + token
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


def login(pw):
    st, d = call("POST", "/api/auth/login", form={"username": EMAIL, "password": pw})
    return st, (d or {}).get("access_token") if isinstance(d, dict) else None


db = SessionLocal()
demo = db.query(Tenant).filter(Tenant.subdomain == "empresa-demo").first()
role = db.query(Role).filter(Role.scope == "tenant", Role.code == "editor").first()
u = User(email=EMAIL, password_hash=get_password_hash(PW1), full_name="QA EQ1", role="editor", is_active=True, tenant_id=demo.id)
db.add(u); db.flush()
db.add(TenantMembership(tenant_id=demo.id, user_id=u.id, role_id=role.id, status="active")); db.commit()
UID = u.id


@atexit.register
def _cleanup():
    d = SessionLocal()
    try:
        d.query(AuditLog).filter(AuditLog.actor_user_id == UID).delete(synchronize_session=False)
        d.query(PasswordResetToken).filter(PasswordResetToken.user_id == UID).delete(synchronize_session=False)
        d.query(TenantMembership).filter(TenantMembership.user_id == UID).delete(synchronize_session=False)
        d.query(User).filter(User.id == UID).delete(synchronize_session=False)
        d.commit()
    except Exception as e:
        d.rollback(); print("aviso limpieza:", e)
    finally:
        d.close()


def fresh():
    d = SessionLocal(); x = d.query(User).filter(User.id == UID).first(); d.close(); return x


st, T1 = login(PW1); ok(st == 200 and T1, f"login inicial ({st})")
st, T2 = login(PW1); ok(st == 200 and T2, "segunda sesion (otro dispositivo)")
st, me = call("GET", "/api/auth/me", T1); ok(st == 200 and me["email"] == EMAIL, "/me con la sesion 1")
legacy = create_access_token({"sub": EMAIL}, timedelta(minutes=10))
st, _ = call("GET", "/api/auth/me", legacy); ok(st == 200, f"token sin 'tv' vale mientras la version es 0 (compatibilidad) -> {st}")

# Validaciones
st, d = call("POST", "/api/auth/change-password", T1, {"current_password": "mal", "new_password": PW2}); ok(st == 400, f"contraseña actual incorrecta -> {st}")
st, d = call("POST", "/api/auth/change-password", T1, {"current_password": PW1, "new_password": "corta"}); ok(st == 422, f"nueva demasiado corta -> {st}")
st, d = call("POST", "/api/auth/change-password", T1, {"current_password": PW1, "new_password": PW1}); ok(st == 422, f"nueva igual a la actual -> {st}")
st, d = call("POST", "/api/auth/change-password", None, {"current_password": PW1, "new_password": PW2}); ok(st == 401, f"sin sesion -> {st}")

# Cambio correcto
st, d = call("POST", "/api/auth/change-password", T1, {"current_password": PW1, "new_password": PW2})
ok(st == 200 and d.get("access_token") and d.get("other_sessions_closed") is True, f"cambio correcto ({st})")
T3 = d.get("access_token") if isinstance(d, dict) else None
ok(fresh().token_version == 1 and fresh().password_changed_at is not None, "version de sesion sube a 1 y se guarda la fecha")
st, _ = call("GET", "/api/auth/me", T1); ok(st == 401, f"sesion 1 (antigua) queda fuera AL MOMENTO -> {st}")
st, _ = call("GET", "/api/auth/me", T2); ok(st == 401, f"sesion 2 (otro dispositivo) queda fuera -> {st}")
st, _ = call("GET", "/api/auth/me", legacy); ok(st == 401, f"token sin 'tv' tambien queda fuera -> {st}")
st, _ = call("GET", "/api/auth/me", T3); ok(st == 200, "el token nuevo devuelto sigue dentro")
st, _ = login(PW1); ok(st == 401, f"login con la contraseña antigua -> {st}")
st, T4 = login(PW2); ok(st == 200 and T4, "login con la nueva")

# Freno de intentos: 5 fallos -> bloqueo 15 min
codes = [call("POST", "/api/auth/change-password", T4, {"current_password": "x" * 14, "new_password": PW3})[0] for _ in range(5)]
st, d = call("POST", "/api/auth/change-password", T4, {"current_password": PW2, "new_password": PW3})
ok(codes == [400] * 5 and st == 429, f"5 fallos bloquean el cambio aunque luego sea correcta ({codes}, {st})")
d2 = SessionLocal(); x = d2.query(User).filter(User.id == UID).first(); x.pw_change_locked_until = None; d2.commit(); d2.close()

# Restablecer por correo tambien cierra sesiones
raw = secrets.token_urlsafe(32)
d2 = SessionLocal(); d2.add(PasswordResetToken(user_id=UID, token_hash=hashlib.sha256(raw.encode()).hexdigest(), expires_at=datetime.now(timezone.utc) + timedelta(hours=2))); d2.commit(); d2.close()
st, _ = call("POST", "/api/auth/password-reset/confirm", None, {"token": raw, "password": PW3}); ok(st == 200, f"restablecer por enlace ({st})")
st, _ = call("GET", "/api/auth/me", T4); ok(st == 401, f"tras restablecer, la sesion anterior queda fuera -> {st}")
st, T5 = login(PW3); ok(st == 200, "login con la contraseña restablecida")

# Auditoria
d2 = SessionLocal()
acts = [a.action for a in d2.query(AuditLog).filter(AuditLog.actor_user_id == UID).all()]
d2.close()
ok("password.changed" in acts and acts.count("password.change_failed") >= 6, f"auditoria registra cambios y fallos ({acts.count('password.changed')} cambio, {acts.count('password.change_failed')} fallos)")

# Quitar del equipo cierra sesiones al instante
OW = token_with_current_version({"sub": "owner.demo@example.com"}, timedelta(minutes=10))
st, members = call("GET", "/api/team/members", OW)
mine = next((m for m in (members or {}).get("members", members or []) if isinstance(m, dict) and m.get("email") == EMAIL), None)
if mine:
    tv0 = fresh().token_version
    st, _ = call("DELETE", f"/api/team/members/{mine['membership_id'] if 'membership_id' in mine else mine['id']}", OW)
    ok(st == 204 and fresh().token_version == tv0 + 1, f"«Quitar» sube la version de sesion ({st})")
    st, _ = call("GET", "/api/auth/me", T5); ok(st == 401, f"usuario quitado queda fuera -> {st}")
else:
    ok(False, f"no se encontro al usuario temporal en /api/team/members ({str(members)[:120]})")

print(f"\n{'OK' if not FAILS else 'FALLOS: ' + str(len(FAILS))}")
sys.exit(1 if FAILS else 0)
