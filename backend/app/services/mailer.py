"""Correo saliente transaccional (Lote L9, 29-sep-2026).

SMTP generico (smtplib, sin dependencias nuevas). Hoy: buzon
``no-reply@cetrix.com.mx`` de IONOS; el dominio ya tiene SPF/DKIM/DMARC de
IONOS, por eso no hace falta tocar DNS. Pasar a Resend (u otro) es cambiar
``SMTP_*``/``MAIL_FROM`` en el .env -- el codigo no cambia.

Reglas:
- ``send_mail`` NUNCA lanza excepcion: devuelve True/False y registra en el
  log (sin la contraseña ni el enlace con token). Un fallo de correo no debe
  romper la invitacion: el llamador decide mostrar el enlace como respaldo.
- ``MAIL_DRY_RUN=true`` (DEV) no conecta a ningun servidor: escribe asunto,
  destinatario y texto en el log y devuelve True.
- Envio sincrono con timeout y un reintento ante errores transitorios: el
  volumen (invitaciones y restablecer contraseña) es minimo y asi la API
  puede decir con certeza si el correo salio.
"""
import html
import logging
import smtplib
import ssl
import time
from email.message import EmailMessage
from email.utils import formataddr, formatdate, make_msgid, parseaddr

from app.config import settings

logger = logging.getLogger("app.mailer")

NAVY = "#1e3a5f"
GOLD = "#c9a14a"


def is_configured() -> bool:
    if not settings.MAIL_FROM or not parseaddr(settings.MAIL_FROM)[1]:
        return False
    if settings.MAIL_DRY_RUN:
        return True
    return bool(settings.SMTP_HOST)


def public_url(path: str) -> str:
    base = (settings.APP_PUBLIC_URL or "").rstrip("/")
    return f"{base}{path}"


def _mask(email: str) -> str:
    name, _, domain = (email or "").partition("@")
    return f"{name[:2]}***@{domain}" if domain else "***"


def _render(title: str, intro_html: str, button_text: str, button_url: str, outro_html: str) -> str:
    safe_url = html.escape(button_url, quote=True)
    return f"""<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{html.escape(title)}</title></head>
<body style="margin:0;padding:0;background:#f4f5f8;font-family:Arial,Helvetica,sans-serif;color:#1f2937;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f8;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #e5e7eb;">
<tr><td style="background:{NAVY};padding:18px 28px;border-bottom:4px solid {GOLD};">
<span style="color:#ffffff;font-size:20px;font-weight:bold;letter-spacing:.3px;">Cetrix <span style="color:{GOLD};">Revistas</span></span>
</td></tr>
<tr><td style="padding:28px;">
<h1 style="margin:0 0 16px;font-size:20px;color:{NAVY};">{html.escape(title)}</h1>
<div style="font-size:15px;line-height:1.55;">{intro_html}</div>
<p style="margin:26px 0;text-align:center;">
<a href="{safe_url}" style="display:inline-block;background:{GOLD};color:{NAVY};text-decoration:none;font-weight:bold;padding:13px 26px;border-radius:6px;font-size:15px;">{html.escape(button_text)}</a>
</p>
<p style="font-size:13px;color:#6b7280;line-height:1.5;">Si el botón no funciona, copia y pega este enlace en tu navegador:<br>
<a href="{safe_url}" style="color:{NAVY};word-break:break-all;">{html.escape(button_url)}</a></p>
<div style="font-size:13px;color:#6b7280;line-height:1.5;margin-top:18px;">{outro_html}</div>
</td></tr>
<tr><td style="background:#f9fafb;padding:14px 28px;font-size:12px;color:#9ca3af;border-top:1px solid #e5e7eb;">
Mensaje automático de Cetrix Revistas · Cetrix de México. Por favor, no respondas a este correo.
</td></tr>
</table></td></tr></table></body></html>"""


def send_mail(to: str, subject: str, html_body: str, text_body: str) -> bool:
    if not is_configured():
        logger.warning("mail.not_configured to=%s subject=%r", _mask(to), subject)
        return False

    msg = EmailMessage()
    from_name, from_addr = parseaddr(settings.MAIL_FROM)
    msg["From"] = formataddr((from_name, from_addr)) if from_name else from_addr
    msg["To"] = to
    msg["Subject"] = subject
    msg["Date"] = formatdate(localtime=False)
    msg["Message-ID"] = make_msgid(domain=from_addr.split("@")[-1])
    msg["Auto-Submitted"] = "auto-generated"
    if settings.MAIL_REPLY_TO:
        msg["Reply-To"] = settings.MAIL_REPLY_TO
    msg.set_content(text_body)
    msg.add_alternative(html_body, subtype="html")

    if settings.MAIL_DRY_RUN:
        logger.info("mail.dry_run to=%s subject=%r\n%s", to, subject, text_body)
        return True

    security = (settings.SMTP_SECURITY or "starttls").lower()
    ctx = ssl.create_default_context()
    last_err = None
    for attempt in (1, 2):
        try:
            if security == "ssl":
                server = smtplib.SMTP_SSL(settings.SMTP_HOST, settings.SMTP_PORT, timeout=settings.SMTP_TIMEOUT, context=ctx)
            else:
                server = smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=settings.SMTP_TIMEOUT)
            with server:
                server.ehlo()
                if security == "starttls":
                    server.starttls(context=ctx)
                    server.ehlo()
                if settings.SMTP_USER:
                    server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
                server.send_message(msg)
            logger.info("mail.sent to=%s subject=%r attempt=%s", _mask(to), subject, attempt)
            return True
        except (smtplib.SMTPAuthenticationError, smtplib.SMTPRecipientsRefused, smtplib.SMTPSenderRefused) as exc:
            # Errores permanentes: reintentar no sirve.
            logger.error("mail.failed_permanent to=%s subject=%r error=%s", _mask(to), subject, exc.__class__.__name__)
            return False
        except Exception as exc:  # red, timeout, 4xx temporal...
            last_err = exc
            logger.warning("mail.retry to=%s attempt=%s error=%s", _mask(to), attempt, exc.__class__.__name__)
            time.sleep(2)
    logger.error("mail.failed to=%s subject=%r error=%s", _mask(to), subject, last_err.__class__.__name__ if last_err else "?")
    return False


# --------------------------------------------------------------------------
# Plantillas
# --------------------------------------------------------------------------
_ROLE_ES = {"owner": "propietario", "admin": "administrador", "editor": "editor", "reviewer": "revisor", "reader": "lector"}


def send_invitation(to: str, token: str, tenant_name: str, role: str, invited_by: str | None, days_valid: int = 7) -> bool:
    url = public_url(f"/aceptar-invitacion?token={token}")
    role_es = _ROLE_ES.get(role, role)
    who = f"{invited_by} te ha invitado" if invited_by else "Te han invitado"
    subject = f"Invitación a {tenant_name} en Cetrix Revistas"
    intro = (f"<p>Hola,</p><p>{html.escape(who)} a unirte a <strong>{html.escape(tenant_name)}</strong> "
             f"en Cetrix Revistas con el rol de <strong>{html.escape(role_es)}</strong>.</p>"
             "<p>Pulsa el botón para aceptar la invitación y crear tu contraseña.</p>")
    outro = (f"<p>El enlace es personal, sirve una sola vez y caduca en {days_valid} días.</p>"
             "<p>Si no esperabas esta invitación, puedes ignorar este correo.</p>")
    text = (f"Hola,\n\n{who} a unirte a {tenant_name} en Cetrix Revistas con el rol de {role_es}.\n\n"
            f"Acepta la invitación y crea tu contraseña aquí:\n{url}\n\n"
            f"El enlace es personal, sirve una sola vez y caduca en {days_valid} días.\n"
            "Si no esperabas esta invitación, ignora este correo.\n\n-- Cetrix Revistas")
    return send_mail(to, subject, _render("Te han invitado a Cetrix Revistas", intro, "Aceptar invitación", url, outro), text)


def send_password_reset(to: str, token: str, minutes_valid: int = 120) -> bool:
    url = public_url(f"/restablecer-contrasena?token={token}")
    hours = minutes_valid // 60
    subject = "Restablece tu contraseña de Cetrix Revistas"
    intro = ("<p>Hola,</p><p>Hemos recibido una solicitud para restablecer la contraseña de tu cuenta de "
             f"Cetrix Revistas (<strong>{html.escape(to)}</strong>).</p><p>Pulsa el botón para elegir una nueva.</p>")
    outro = (f"<p>El enlace sirve una sola vez y caduca en {hours} horas.</p>"
             "<p>Si no has sido tú, ignora este correo: tu contraseña actual sigue siendo válida.</p>")
    text = (f"Hola,\n\nHemos recibido una solicitud para restablecer la contraseña de tu cuenta de Cetrix Revistas ({to}).\n\n"
            f"Elige una nueva aquí:\n{url}\n\nEl enlace sirve una sola vez y caduca en {hours} horas.\n"
            "Si no has sido tú, ignora este correo.\n\n-- Cetrix Revistas")
    return send_mail(to, subject, _render("Restablecer contraseña", intro, "Elegir nueva contraseña", url, outro), text)
