from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.config import settings

engine = create_engine(
    settings.DATABASE_URL,
    pool_pre_ping=True,
    pool_size=settings.DB_POOL_SIZE,
    max_overflow=settings.DB_MAX_OVERFLOW
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Lote L5: oculta las ediciones de la papelera en toda consulta ORM
import app.db.soft_delete  # noqa: E402,F401

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
