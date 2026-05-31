from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.staticfiles import StaticFiles

from app.api import auth
from app.api import publications
from app.api import media
from app.config import settings

app = FastAPI(
    title="Flipbook SaaS API",
    description="Plataforma B2B para revistas digitales interactivas",
    version="2.0.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(GZipMiddleware, minimum_size=1000)

app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(publications.router, prefix="/api/publications", tags=["publications"])
app.include_router(media.router, prefix="/api", tags=["media"])

@app.on_event("startup")
async def startup():
    from app.db.session import engine
    from app.db.base import Base
    import app.models
    Base.metadata.create_all(bind=engine)

@app.get("/health")
async def health():
    return {"status": "ok", "version": "2.0.0"}

@app.get("/")
async def root():
    return {"message": "Flipbook SaaS API v2.0.0", "docs": "/api/docs"}
