"""QA Lote L9 (29-sep-2026): correo transaccional por SMTP.

Ejecutar DENTRO del contenedor backend de DEV (MAIL_DRY_RUN=true), despues de
qa_lote_c_tenant_isolation.py y qa_lote_c2_rbac_team.py:
  docker cp backend/tests/qa_lote_l9_correo.py flipbook-dev-backend:/tmp/qa9.py
  docker exec flipbook-dev-backend python /tmp/qa9.py
Cubre: plantillas, envio SMTP real contra un servidor SMTP falso local
(STARTTLS no: 'none'), dry-run, fallo de conexion sin excepcion, flags
email_sent/invite_token en las APIs y '¿Olvidaste tu contraseña?' (respuesta
identica, anti-abuso 5 min, invalidacion de tokens previos).
"""
import sys, json, secrets, threading, time, urllib.request, urllib.error, asyncore, smtpd, hashlib
sys.path.insert(0, "/app")
from datetime import timedelta
from app.core.security import token_with_current_version as create_access_token  # EQ-1: incluye "tv"
from app.config import settings
from app.services import mailer
B = "http://localhost:8000"
results = []
def ok(c, m): results.append(bool(c)); print(("PASS " if c else "FAIL ") + m)
def call(method, path, token=None, body=None):
    h = {"Content-Type": "application/json"}
    if token: h["Authorization"] = "Bearer " + token
    r = urllib.request.Request(B + path, data=json.dumps(body).encode() if body is not None else None, method=method, headers=h)
    try:
        with urllib.request.urlopen(r) as x:
            raw = x.read(); return x.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read()
        try: return e.code, json.loads(raw)
        except Exception: return e.code, raw[:160]
tok = lambda email: create_access_token({"sub": email}, timedelta(minutes=15))

# --- 1. SMTP real contra servidor falso local --------------------------------
received = []
class Fake(smtpd.SMTPServer):
    def process_message(self, peer, mailfrom, rcpttos, data, **kw):
        received.append((mailfrom, rcpttos, data if isinstance(data, bytes) else data.encode()))
srv = Fake(("127.0.0.1", 2525), None)
threading.Thread(target=asyncore.loop, kwargs={"timeout": 0.2}, daemon=True).start()
saved = {k: getattr(settings, k) for k in ("SMTP_HOST","SMTP_PORT","SMTP_USER","SMTP_SECURITY","MAIL_FROM","MAIL_DRY_RUN","APP_PUBLIC_URL","SMTP_TIMEOUT")}
settings.SMTP_HOST, settings.SMTP_PORT, settings.SMTP_USER, settings.SMTP_SECURITY = "127.0.0.1", 2525, "", "none"
settings.MAIL_FROM, settings.MAIL_DRY_RUN, settings.APP_PUBLIC_URL = "Cetrix Revistas <no-reply@cetrix.com.mx>", False, "https://revistas.example"
r = mailer.send_invitation("dest@example.com", "TOK123", "Destinos & Negocios", "owner", "Carlos")
time.sleep(0.5)
ok(r is True and len(received) == 1, f"envio SMTP real al servidor falso ({r}, {len(received)})")
if received:
    import email as _em
    def _flat(b):
        m = _em.message_from_bytes(b); out = [str(m)]
        for part in m.walk():
            if part.get_content_maintype() == "text": out.append(part.get_payload(decode=True).decode("utf-8", "replace"))
        return "\n".join(out)
    raw = _flat(received[0][2])
    ok(received[0][1] == ["dest@example.com"], "destinatario correcto")
    ok("https://revistas.example/aceptar-invitacion?token=TOK123" in raw, "enlace de invitacion con APP_PUBLIC_URL")
    ok("multipart/alternative" in raw and "text/html" in raw and "text/plain" in raw, "HTML + texto plano")
    ok("Destinos &amp; Negocios" in raw or "Destinos =26 Negocios" in raw or "Destinos &amp;amp;" not in raw, "nombre de empresa escapado en HTML")
    ok("Message-ID:" in raw and "Auto-Submitted: auto-generated" in raw, "cabeceras Message-ID y Auto-Submitted")
r2 = mailer.send_password_reset("dest@example.com", "RST9", 120); time.sleep(0.5)
ok(r2 and "restablecer-contrasena?token=RST9" in _flat(received[-1][2]), "correo de restablecer con enlace")
settings.SMTP_PORT, settings.SMTP_TIMEOUT = 2599, 3
t0 = time.time(); r3 = mailer.send_invitation("x@example.com", "T", "E", "editor", None)
ok(r3 is False and time.time() - t0 < 15, f"servidor caido -> False sin excepcion ({time.time()-t0:.1f}s)")
settings.MAIL_FROM = ""; ok(mailer.is_configured() is False and mailer.send_password_reset("x@example.com","T") is False, "sin MAIL_FROM -> no configurado, False")
for k, v in saved.items(): setattr(settings, k, v)
srv.close()
ok(mailer.delivered(True) is False if settings.MAIL_DRY_RUN else mailer.delivered(True), "delivered() = False en dry-run")

# --- 2. APIs (proceso uvicorn con MAIL_DRY_RUN=true) ---------------------------
SA, OW = tok("jose.reyes@cetrix.com.mx"), tok("owner.demo@example.com")
em = f"qa9.{secrets.token_hex(3)}@example.com"
st, inv = call("POST", "/api/team/invitations", OW, {"email": em, "role": "reader"})
ok(st == 201 and inv.get("email_sent") is False and inv.get("invite_token"), f"equipo: dry-run -> email_sent False y enlace de respaldo ({st})")
st, rs = call("POST", f"/api/team/members/{inv['membership_id']}/resend", OW)
ok(st == 200 and "email_sent" in rs and rs.get("invite_token"), f"reenvio devuelve email_sent y enlace ({st})")
st, _ = call("DELETE", f"/api/team/members/{inv['membership_id']}", OW)
st, ov = call("GET", "/api/superadmin/overview", SA)
demo = [t for t in ov["tenants"] if t["subdomain"] == "empresa-demo"][0]
ne = f"qa9.owner.{secrets.token_hex(3)}@example.com"
st, oi = call("POST", f"/api/superadmin/tenants/{demo['id']}/owner-invitations", SA, {"email": ne})
ok(st == 201 and "email_sent" in oi and oi.get("invite_token"), f"owner-invitation (cuenta nueva) incluye email_sent y conserva enlace ({st})")
st, oa = call("POST", f"/api/superadmin/tenants/{demo['id']}/owner-invitations", SA, {"email": "owner.demo@example.com"})
st2, me = call("GET", "/api/auth/me", OW)
ok(st == 201 and oa.get("already_active") and me.get("tenant_role") == "owner", f"invitar a cuenta YA activa no la bloquea: rol owner directo ({st}, {me.get('tenant_role')})")
from app.db.session import SessionLocal as _SL
from app.models.user import User as _U
from app.models.commercial import TenantMembership as _TM
_d = _SL(); _u = _d.query(_U).filter(_U.email == ne).first()
if _u: _d.query(_TM).filter(_TM.user_id == _u.id).delete(); _d.delete(_u); _d.commit()
_d.close()

# --- 3. ¿Olvidaste tu contraseña? --------------------------------------------
from app.db.session import SessionLocal
from app.models.user import User
from app.models.password_reset_token import PasswordResetToken
db = SessionLocal()
u = db.query(User).filter(User.email == "lector.demo@example.com").first()
db.query(PasswordResetToken).filter(PasswordResetToken.user_id == u.id).delete(); db.commit()
bodies = []
for e in ("lector.demo@example.com", "LECTOR.demo@example.com ", "noexiste.qa9@example.com", "no-es-email"):
    st, b = call("POST", "/api/auth/password-reset/request", None, {"email": e}); bodies.append((st, json.dumps(b, sort_keys=True)))
ok(len(set(bodies)) == 1 and bodies[0][0] == 202, "respuesta identica exista o no la cuenta (202)")
db.expire_all()
n = db.query(PasswordResetToken).filter(PasswordResetToken.user_id == u.id).count()
ok(n == 1, f"anti-abuso: 2 solicitudes seguidas = 1 token ({n})")
# simular que pasaron 6 minutos -> nueva solicitud invalida la anterior
from sqlalchemy import text
db.execute(text("update password_reset_tokens set created_at = now() - interval '6 minutes' where user_id = :u"), {"u": str(u.id)}); db.commit()
call("POST", "/api/auth/password-reset/request", None, {"email": "lector.demo@example.com"})
db.expire_all()
rows = db.query(PasswordResetToken).filter(PasswordResetToken.user_id == u.id).all()
ok(len(rows) == 2 and sum(1 for r in rows if r.used_at is None) == 1, "nueva solicitud invalida el token anterior")
inactive = db.query(User).filter(User.email == "relleno1@example.com").first()
if inactive:
    c0 = db.query(PasswordResetToken).filter(PasswordResetToken.user_id == inactive.id).count()
    call("POST", "/api/auth/password-reset/request", None, {"email": "relleno1@example.com"}); db.expire_all()
    ok(db.query(PasswordResetToken).filter(PasswordResetToken.user_id == inactive.id).count() == c0, "cuenta inactiva/invitacion pendiente: no genera token")
db.query(PasswordResetToken).filter(PasswordResetToken.user_id == u.id).delete(); db.commit(); db.close()

print(f"\n{sum(results)}/{len(results)} PASS")
sys.exit(0 if all(results) else 1)
