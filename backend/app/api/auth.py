from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from pydantic import BaseModel
from sqlalchemy.orm import Session
from jose import JWTError, jwt
from datetime import datetime, timedelta, timezone
import logging
import secrets
import hashlib
import uuid

from app.db.session import get_db
from app.models.user import User
from app.schemas.user import UserLogin, UserResponse, Token, UserCreate
from app.core.security import verify_password, get_password_hash, create_access_token, issue_token, revoke_sessions
from app.config import settings
from app.services import mailer
from app.models.password_reset_token import PasswordResetToken

router = APIRouter()

class PasswordResetRequest(BaseModel):
    email: str


class PasswordResetConfirm(BaseModel):
    token: str
    password: str


class PasswordChange(BaseModel):
    current_password: str
    new_password: str

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")

def _is_platform_superadmin(db: Session, user_id) -> bool:
    from app.models.commercial import Role, UserPlatformRole
    return db.query(UserPlatformRole).join(Role).filter(
        UserPlatformRole.user_id == user_id,
        Role.scope == "platform",
        Role.code == "superadmin",
    ).first() is not None


def get_current_user(
    request: Request,
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db)
) -> User:
    """Usuario autenticado + CONTEXTO DE TENANT (Lote C, 2026-09-27).

    Toda consulta de negocio debe filtrar por ``current_user.effective_tenant_id``
    (atributo de instancia, NO columna: nunca se persiste):
    - usuario normal: su tenant, exigiendo usuario activo, membresia activa
      y empresa no suspendida/cancelada;
    - Super Admin CETRIX: su tenant, o el indicado en la cabecera
      ``X-Tenant-Id`` (selector "Empresa" del panel) para dar soporte y
      gestionar cualquier empresa. La cabecera se IGNORA para no-superadmin.
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
        email: str = payload.get("sub")
        if email is None:
            raise credentials_exception
        token_version = int(payload.get("tv", 0) or 0)
    except (JWTError, TypeError, ValueError):
        raise credentials_exception

    user = db.query(User).filter(User.email == email).first()
    if user is None or not user.is_active:
        raise credentials_exception
    # Lote EQ-1: un token emitido antes del ultimo cambio de contrasena (o de
    # un cierre de sesiones) ya no vale, aunque no haya caducado.
    if token_version != int(user.token_version or 0):
        raise credentials_exception

    from app.models.tenant import Tenant
    from app.models.commercial import TenantMembership
    is_superadmin = _is_platform_superadmin(db, user.id)
    effective_tenant_id = user.tenant_id
    acting_as = False

    requested = request.headers.get("X-Tenant-Id")
    if requested and is_superadmin:
        try:
            requested_uuid = uuid.UUID(requested)
        except ValueError:
            raise HTTPException(status_code=400, detail="X-Tenant-Id inválido")
        if not db.query(Tenant.id).filter(Tenant.id == requested_uuid).first():
            raise HTTPException(status_code=404, detail="Empresa no encontrada")
        effective_tenant_id = requested_uuid
        acting_as = requested_uuid != user.tenant_id

    if not is_superadmin:
        tenant = db.query(Tenant).filter(Tenant.id == user.tenant_id).first()
        if tenant is None or tenant.status in ("suspended", "cancelled"):
            raise HTTPException(status_code=403, detail="La cuenta de tu empresa está suspendida. Contacta con soporte.")
        membership = db.query(TenantMembership).filter(
            TenantMembership.tenant_id == user.tenant_id,
            TenantMembership.user_id == user.id,
            TenantMembership.status == "active",
        ).first()
        if membership is None:
            raise HTTPException(status_code=403, detail="No tienes acceso activo a esta empresa")

    # Rol dentro de la empresa efectiva (RBAC, ver app/core/rbac.py)
    if is_superadmin:
        tenant_role = "owner"
    else:
        from app.models.commercial import Role as _Role
        tenant_role = db.query(_Role.code).join(
            TenantMembership, TenantMembership.role_id == _Role.id
        ).filter(
            TenantMembership.tenant_id == effective_tenant_id,
            TenantMembership.user_id == user.id,
            TenantMembership.status == "active",
        ).scalar()

    user.effective_tenant_id = effective_tenant_id
    user.is_platform_superadmin = is_superadmin
    user.acting_as_tenant = acting_as
    user.tenant_role = tenant_role
    return user

@router.post("/login", response_model=Token)
def login(
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db)
):
    user = db.query(User).filter(User.email == form_data.username).first()
    
    if not user or not verify_password(form_data.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Inactive user"
        )
    
    # Actualizar last_login
    user.last_login = datetime.utcnow()
    db.commit()
    
    access_token = issue_token(user)  # Lote EQ-1: incluye la version de sesion

    return {"access_token": access_token, "token_type": "bearer"}

@router.get("/me", response_model=UserResponse)
def get_me(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    # El rol legacy `users.role` pertenece al tenant; el acceso de plataforma
    # se concede exclusivamente mediante la relación global creada para CETRIX.
    from app.models.tenant import Tenant
    tenant = db.query(Tenant).filter(Tenant.id == current_user.effective_tenant_id).first()
    return {
        "id": current_user.id, "email": current_user.email,
        "full_name": current_user.full_name, "role": current_user.role,
        "is_active": current_user.is_active, "created_at": current_user.created_at,
        "is_superadmin": current_user.is_platform_superadmin,
        "tenant_id": current_user.effective_tenant_id,
        "tenant_name": tenant.name if tenant else None,
        "acting_as_tenant": current_user.acting_as_tenant,
        "tenant_role": current_user.tenant_role,
    }

@router.post("/password-reset/request", status_code=status.HTTP_202_ACCEPTED)
def request_password_reset(data: PasswordResetRequest, db: Session = Depends(get_db)):
    """'¿Olvidaste tu contraseña?' (L9). Respuesta SIEMPRE identica, exista o
    no la cuenta (no permite averiguar que emails estan registrados). Solo
    cuentas activas con contraseña propia; como mucho un correo cada 5 min
    por cuenta (anti-abuso). Enlace valido 2 h, un solo uso; al crear uno
    nuevo se invalidan los anteriores."""
    generic = {"status": "accepted", "detail": "Si el correo corresponde a una cuenta activa, recibirás un enlace para restablecer la contraseña."}
    email = (data.email or "").strip().lower()
    if not email or "@" not in email or len(email) > 255 or not mailer.is_configured():
        return generic
    user = db.query(User).filter(User.email == email).first()
    if not user or not user.is_active or not user.password_hash or user.password_hash.startswith("!"):
        return generic
    now = datetime.now(timezone.utc)
    recent = db.query(PasswordResetToken).filter(
        PasswordResetToken.user_id == user.id,
        PasswordResetToken.used_at.is_(None),
        PasswordResetToken.created_at > now - timedelta(minutes=5),
    ).first()
    if recent:
        return generic
    raw = secrets.token_urlsafe(32)
    db.query(PasswordResetToken).filter(PasswordResetToken.user_id == user.id, PasswordResetToken.used_at.is_(None)).update({"used_at": now})
    db.add(PasswordResetToken(user_id=user.id, token_hash=hashlib.sha256(raw.encode()).hexdigest(),
                              expires_at=now + timedelta(hours=2), requested_by=user.id))
    db.commit()
    mailer.send_password_reset(user.email, raw, minutes_valid=120)
    return generic


@router.post("/password-reset/confirm")
def confirm_password_reset(data: PasswordResetConfirm, db: Session = Depends(get_db)):
    if len(data.password) < 12:
        raise HTTPException(status_code=400, detail="La contraseña debe tener al menos 12 caracteres")
    token = db.query(PasswordResetToken).filter(PasswordResetToken.token_hash == hashlib.sha256(data.token.encode()).hexdigest(), PasswordResetToken.used_at.is_(None)).first()
    if not token or token.expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="Enlace inválido o caducado")
    user = db.query(User).filter(User.id == token.user_id).first()
    user.password_hash, user.is_active = get_password_hash(data.password), True
    user.password_changed_at = datetime.now(timezone.utc)
    revoke_sessions(user)  # Lote EQ-1: quien estuviera dentro con la anterior queda fuera
    token.used_at = datetime.now(timezone.utc)
    db.commit()
    return {"status": "password_updated"}

@router.post("/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED, include_in_schema=False)
def register(
    user_data: UserCreate,
    db: Session = Depends(get_db)
):
    # Registro abierto DESACTIVADO (Lote C, 2026-09-27): creaba usuarios
    # editores dentro del tenant "default" (datos de CETRIX). Las altas son
    # solo por invitacion (Super Admin -> owner -> equipo).
    if not getattr(settings, "ALLOW_PUBLIC_REGISTER", False):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not Found")

    # Verificar si el usuario ya existe
    existing_user = db.query(User).filter(User.email == user_data.email).first()
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered"
        )
    
    # Obtener el tenant por defecto
    from app.models.tenant import Tenant
    default_tenant = db.query(Tenant).filter(Tenant.subdomain == "default").first()
    
    if not default_tenant:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Default tenant not found"
        )
    
    # Crear nuevo usuario
    new_user = User(
        email=user_data.email,
        password_hash=get_password_hash(user_data.password),
        full_name=user_data.full_name,
        role="editor",
        is_active=True,
        tenant_id=default_tenant.id
    )
    
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    
    return new_user


# ---------------------------------------------------------------------------
# Lote EQ-1 (2026-10-04): «Mi cuenta» -- cambiar la propia contrasena.
# ---------------------------------------------------------------------------
PW_MIN_LEN = 12            # mismo minimo que el restablecimiento por correo
PW_MAX_FAILURES = 5        # intentos fallidos con la contrasena actual...
PW_LOCK_MINUTES = 15       # ...bloquean el cambio durante 15 minutos


@router.post("/change-password")
def change_password(data: PasswordChange, request: Request, db: Session = Depends(get_db),
                    current_user: User = Depends(get_current_user)):
    """Cambia la contrasena del usuario autenticado. Cierra TODAS sus otras
    sesiones (sube token_version) y devuelve un token nuevo para esta."""
    from app.api.superadmin import audit
    now = datetime.now(timezone.utc)
    user = db.query(User).filter(User.id == current_user.id).first()
    locked = user.pw_change_locked_until
    if locked is not None and locked.tzinfo is None:
        locked = locked.replace(tzinfo=timezone.utc)
    if locked and locked > now:
        mins = max(1, int((locked - now).total_seconds() // 60) + 1)
        raise HTTPException(status_code=429, detail=f"Demasiados intentos. Vuelve a probar en {mins} min.")
    if not verify_password(data.current_password or "", user.password_hash):
        user.pw_change_failures = int(user.pw_change_failures or 0) + 1
        if user.pw_change_failures >= PW_MAX_FAILURES:
            user.pw_change_failures = 0
            user.pw_change_locked_until = now + timedelta(minutes=PW_LOCK_MINUTES)
        audit(db, user, "password.change_failed", tenant_id=user.tenant_id, entity_type="user", entity_id=user.id,
              details={"ip": request.headers.get("x-real-ip") or (request.client.host if request.client else None)})
        db.commit()
        raise HTTPException(status_code=400, detail="La contraseña actual no es correcta")
    new = data.new_password or ""
    if len(new) < PW_MIN_LEN:
        raise HTTPException(status_code=422, detail=f"La nueva contraseña debe tener al menos {PW_MIN_LEN} caracteres")
    if len(new) > 128:
        raise HTTPException(status_code=422, detail="La nueva contraseña es demasiado larga (máximo 128)")
    if verify_password(new, user.password_hash):
        raise HTTPException(status_code=422, detail="La nueva contraseña debe ser distinta de la actual")
    user.password_hash = get_password_hash(new)
    user.password_changed_at = now
    user.pw_change_failures, user.pw_change_locked_until = 0, None
    revoke_sessions(user)
    audit(db, user, "password.changed", tenant_id=user.tenant_id, entity_type="user", entity_id=user.id,
          details={"ip": request.headers.get("x-real-ip") or (request.client.host if request.client else None)})
    db.commit()
    db.refresh(user)
    email_sent = mailer.delivered(mailer.send_password_changed(user.email))
    return {"status": "password_changed", "access_token": issue_token(user), "token_type": "bearer",
            "other_sessions_closed": True, "email_sent": email_sent}
