from datetime import datetime, timedelta
from typing import Optional
from passlib.context import CryptContext
from jose import jwt
from app.config import settings

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)
    return encoded_jwt


def issue_token(user) -> str:
    """Lote EQ-1: token de sesion con la version de sesion del usuario ("tv")."""
    return create_access_token(data={"sub": user.email, "tv": int(getattr(user, "token_version", 0) or 0)})


def revoke_sessions(user) -> None:
    """Lote EQ-1: invalida al instante todos los tokens emitidos al usuario."""
    user.token_version = int(user.token_version or 0) + 1


def token_with_current_version(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """Lote EQ-1: igual que create_access_token pero anadiendo la version de
    sesion ACTUAL del usuario (lee la BD). Lo usan los scripts de QA, que firman
    tokens localmente en el contenedor; sin "tv" valido serian rechazados."""
    from app.db.session import SessionLocal
    from app.models.user import User
    db = SessionLocal()
    try:
        u = db.query(User).filter(User.email == data.get("sub")).first()
        tv = int(u.token_version or 0) if u is not None else 0
    finally:
        db.close()
    return create_access_token({**data, "tv": tv}, expires_delta)
