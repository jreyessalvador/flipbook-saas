from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from app.api import auth, publications, pages, assets, locks

app = FastAPI(
    title="Flipbook SaaS API",
    description="API para plataforma de revistas digitales",
    version="1.0.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc"
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://flipbook.local",
        "http://192.168.2.12",
        "http://localhost:5173",
        "http://localhost:3000",
    ],  # R08: wildcard + credentials es inválido por el estándar CORS
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Gzip compression
app.add_middleware(GZipMiddleware, minimum_size=1000)

# Include routers
app.include_router(auth.router, prefix="/api/auth", tags=["Authentication"])
app.include_router(publications.router, prefix="/api/publications", tags=["Publications"])
app.include_router(pages.router, prefix="/api/pages", tags=["Pages"])
app.include_router(locks.router, prefix="/api/publications", tags=["Locks"])
app.include_router(assets.router, prefix="/api", tags=["Assets"])


@app.on_event("startup")
async def on_startup():
    """
    Antes: assets.py verificaba/creaba el bucket de MinIO a nivel de import,
    sin reintentos. Si CoreDNS aun no resolvia 'minio.flipbook-dev.svc.cluster.local'
    en el instante del arranque (comun tras un reinicio de nodo), el import
    fallaba con MaxRetryError y el proceso moria con exit code 1 -> crash loop.
    Ahora el intento ocurre aqui, con reintentos y sin tumbar la app si falla
    (se reintenta de forma perezosa en el primer upload, ver assets.ensure_bucket).
    """
    from starlette.concurrency import run_in_threadpool
    await run_in_threadpool(assets.ensure_bucket)


@app.get("/health")
async def health():
    return {"status": "ok"}

@app.get("/ready")
async def ready():
    return {"status": "ready"}

@app.get("/")
async def root():
    return {"message": "Flipbook SaaS API v1.0.0", "docs": "/api/docs"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
