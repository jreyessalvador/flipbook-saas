"""Cliente de cetrix-docproc, el servicio compartido de documentos de Cetrix.

Arquitectura (RECETA §31):
  backend/pdf-worker (Contabo 1) --red docker docproc-c-flipbook-<entorno>-->
  broker docproc (Contabo 1) <--tunel wg-docproc, el worker reclama-- worker (Contabo 2)

El PDF que sube el usuario NUNCA se abre en Contabo 1: el worker aislado de
Contabo 2 lo optimiza (Ghostscript + qpdf) y rasteriza las paginas a WebP.
Solo se usa urllib3 (ya viene con minio): sin dependencias nuevas.
"""
import json
import time

import urllib3

from app.config import settings


class DocprocError(Exception):
    """El servicio rechazo o no pudo procesar el documento (no reintentar)."""


class DocprocUnavailable(DocprocError):
    """Servicio caido, saturado o sin worker: reintentar mas tarde."""


_http = urllib3.PoolManager(num_pools=2, maxsize=4, retries=False)


def enabled() -> bool:
    return bool(settings.DOCPROC_URL and settings.DOCPROC_TOKEN)


def _request(method, path, timeout=60, **kw):
    headers = {"X-Docproc-Client": settings.DOCPROC_CLIENT, "X-Docproc-Token": settings.DOCPROC_TOKEN}
    headers.update(kw.pop("headers", {}))
    try:
        return _http.request(method, settings.DOCPROC_URL.rstrip("/") + path, headers=headers,
                             timeout=urllib3.Timeout(connect=5, read=timeout), **kw)
    except urllib3.exceptions.HTTPError as exc:
        raise DocprocUnavailable(f"docproc no accesible: {type(exc).__name__}") from exc


def _detail(resp):
    try:
        return json.loads(resp.data).get("detail") or f"HTTP {resp.status}"
    except ValueError:
        return f"HTTP {resp.status}"


def health() -> dict:
    r = _request("GET", "/v1/health", timeout=10)
    if r.status != 200:
        raise DocprocUnavailable(_detail(r))
    return json.loads(r.data)


def submit(op: str, files, params: dict) -> str:
    """files: lista de (nombre, bytes, content_type). Devuelve job_id."""
    fields = [("op", op), ("params", json.dumps(params))]
    fields += [("files", (name, data, ctype)) for name, data, ctype in files]
    body, content_type = urllib3.encode_multipart_formdata(fields)
    r = _request("POST", "/v1/jobs", timeout=300, body=body, headers={"Content-Type": content_type})
    if r.status == 200:
        return json.loads(r.data)["job_id"]
    if r.status in (429,) or r.status >= 500:
        raise DocprocUnavailable(_detail(r))
    raise DocprocError(_detail(r))


def wait(job_id: str, timeout: int = 20 * 60, poll: float = 3.0) -> dict:
    deadline = time.time() + timeout
    while True:
        r = _request("GET", f"/v1/jobs/{job_id}", timeout=20)
        if r.status != 200:
            raise DocprocUnavailable(_detail(r))
        job = json.loads(r.data)
        if job["status"] == "done":
            return job
        if job["status"] in ("failed", "cancelled"):
            raise DocprocError(job.get("error") or "No se pudo procesar el documento")
        if time.time() > deadline:
            raise DocprocUnavailable("docproc: tiempo de espera agotado")
        time.sleep(poll)


def fetch(job_id: str, name: str) -> bytes:
    r = _request("GET", f"/v1/jobs/{job_id}/files/{name}", timeout=300)
    if r.status != 200:
        raise DocprocUnavailable(f"docproc: no se pudo descargar {name} ({r.status})")
    return r.data


def delete(job_id: str) -> None:
    try:
        _request("DELETE", f"/v1/jobs/{job_id}", timeout=10)
    except DocprocError:
        pass  # el broker caduca los resultados solo (RESULT_TTL)


def optimize_pdf(pdf_bytes: bytes, render_pages: bool = True, timeout: int = 20 * 60):
    """Optimiza un PDF y (opcional) rasteriza sus paginas a WebP.

    Devuelve (job_id, job). El llamador descarga con fetch() y luego delete().
    """
    params = {"profile": settings.DOCPROC_PDF_PROFILE}
    if render_pages:
        params["render_pages"] = {"dpi": settings.DOCPROC_PAGE_DPI, "format": "webp",
                                  "quality": settings.DOCPROC_PAGE_QUALITY,
                                  "max_pages": settings.MAX_PDF_PAGES}
    job_id = submit("optimize", [("documento.pdf", pdf_bytes, "application/pdf")], params)
    try:
        return job_id, wait(job_id, timeout=timeout)
    except Exception:
        delete(job_id)
        raise


def pdf_to_images(pdf_bytes: bytes, pages: str = "all", fmt: str = "webp", dpi: int = 150,
                  quality: int = 85, max_side: int = None, timeout: int = 20 * 60):
    """PDF (una hoja '3', rangos '1-4,7' o 'all') -> imagenes webp | jpeg | png.

    Devuelve lista de (numero_pagina, bytes, content_type, ancho, alto). Disponible
    para cualquier proyecto (p. ej. portadas, miniaturas, exportar hojas sueltas).
    """
    params = {"pages": pages, "format": fmt, "dpi": dpi, "quality": quality}
    if max_side:
        params["max_side"] = max_side
    job_id = submit("pdf_to_images", [("documento.pdf", pdf_bytes, "application/pdf")], params)
    try:
        job = wait(job_id, timeout=timeout)
        ctype = {"webp": "image/webp", "png": "image/png"}.get(fmt, "image/jpeg")
        return [(pg["n"], fetch(job_id, pg["file"]), ctype, pg["width_px"], pg["height_px"])
                for pg in job["result"]["page_images"]]
    finally:
        delete(job_id)
