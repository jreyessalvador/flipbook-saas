"""Worker de render de flipbook-saas (Lote F, 2026-10-04) -- Contabo 2.

Corre en un contenedor SIN internet ni acceso al host (ver RECETA §24): solo
habla con el gateway de Contabo 1 por el tunel wg-flipbook.
Bucle: reclama un trabajo -> abre /render/{job} en Chromium -> captura cada
hoja (JPEG) -> monta el PDF con pikepdf (imagenes sin recomprimir + enlaces
clicables de hotspots/videos/embeds) -> lo sube. Un trabajo a la vez.
"""
import io
import os
import sys
import time
import traceback

import pikepdf
import requests
from pikepdf import Array, Dictionary, Name
from PIL import Image
from playwright.sync_api import sync_playwright

GW = os.environ["GATEWAY"].rstrip("/")                 # http://10.253.43.1:8462
PUBLIC = os.environ["PUBLIC_ORIGIN"].rstrip("/")       # https://dev-revistas.cetrix.com.mx
TOKEN = os.environ["RENDER_WORKER_TOKEN"]
DSF = float(os.environ.get("RENDER_SCALE", "3"))       # 3 => ~229 ppp con PX_PER_MM=3
JPEG_Q = int(os.environ.get("RENDER_JPEG_QUALITY", "88"))
POLL = float(os.environ.get("POLL_SECONDS", "4"))
PX_PER_MM = 3
PT_PER_MM = 72 / 25.4
H = {"X-Render-Token": TOKEN}
HEARTBEAT = "/tmp/heartbeat"


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


def beat():
    with open(HEARTBEAT, "w") as f:
        f.write(str(time.time()))


def api(method, path, **kw):
    kw.setdefault("timeout", 60)
    headers = dict(H); headers.update(kw.pop("headers", {}))
    return requests.request(method, GW + path, headers=headers, **kw)


def link_target(el, page_ids):
    """(tipo, valor) del enlace del elemento en el PDF, o None."""
    p = el.get("props") or {}
    kind = el.get("kind")
    if kind == "hotspot":
        a = p.get("action") or "page"
        v = (p.get("value") or "").strip()
        if a == "url" and v.lower().startswith(("https://", "http://")):
            return ("uri", v)
        if a == "email" and v:
            return ("uri", "mailto:" + v)
        if a == "phone" and v:
            return ("uri", "tel:" + "".join(c for c in v if c in "+0123456789"))
        if a == "page" and p.get("target_page_id") in page_ids:
            return ("page", page_ids[p["target_page_id"]])
        if a in ("next", "previous", "cover", "back_cover"):
            return ("rel", a)
        return None
    if kind == "video" and p.get("src"):
        src = p["src"]
        return ("uri", src if src.startswith("http") else PUBLIC + src)
    if kind == "embed" and p.get("video_id"):
        prov = p.get("provider") or "youtube"
        vid = p["video_id"]
        return ("uri", {"youtube": f"https://www.youtube.com/watch?v={vid}",
                        "vimeo": f"https://vimeo.com/{vid}",
                        "soundcloud": f"https://soundcloud.com/{vid}"}.get(prov, f"https://www.youtube.com/watch?v={vid}"))
    return None


def build_pdf(data, shots):
    wmm, hmm = data["page_width"], data["page_height"]
    wpt, hpt = wmm * PT_PER_MM, hmm * PT_PER_MM
    pdf = pikepdf.new()
    pdf.docinfo["/Title"] = data.get("title") or "Revista"
    pdf.docinfo["/Producer"] = "Cetrix Revistas"
    for jpg in shots:
        with Image.open(io.BytesIO(jpg)) as im:
            wpx, hpx = im.size
        img = pikepdf.Stream(pdf, jpg)
        img.Type, img.Subtype = Name.XObject, Name.Image
        img.Width, img.Height = wpx, hpx
        img.ColorSpace, img.BitsPerComponent, img.Filter = Name.DeviceRGB, 8, Name.DCTDecode
        content = pikepdf.Stream(pdf, f"q {wpt:.3f} 0 0 {hpt:.3f} 0 0 cm /Im0 Do Q".encode())
        page = Dictionary(Type=Name.Page, MediaBox=Array([0, 0, wpt, hpt]),
                          Resources=Dictionary(XObject=Dictionary(Im0=img)), Contents=content)
        pdf.pages.append(pikepdf.Page(page))

    pages = sorted(data["pages"], key=lambda p: p.get("page_number", 0))
    page_ids = {pg.get("id"): i for i, pg in enumerate(pages)}
    n_links = 0
    for i, pg in enumerate(pages):
        annots = []
        for el in pg.get("elements") or []:
            t = link_target(el, page_ids)
            if not t:
                continue
            x, y = float(el.get("x", 0)), float(el.get("y", 0))
            w, h = float(el.get("width", 0)), float(el.get("height", 0))
            if w <= 0 or h <= 0:
                continue
            k = PT_PER_MM / PX_PER_MM
            rect = Array([max(0, x * k), max(0, hpt - (y + h) * k), min(wpt, (x + w) * k), min(hpt, hpt - y * k)])
            annot = Dictionary(Type=Name.Annot, Subtype=Name.Link, Rect=rect, Border=Array([0, 0, 0]))
            kind, val = t
            if kind == "rel":
                val = {"next": i + 1, "previous": i - 1, "cover": 0, "back_cover": len(pages) - 1}[val]
                kind = "page"
            if kind == "page":
                if not (0 <= val < len(pdf.pages)):
                    continue
                annot.Dest = Array([pdf.pages[val].obj, Name.Fit])
            else:
                annot.A = Dictionary(S=Name.URI, URI=pikepdf.String(val))
            annots.append(pdf.make_indirect(annot))
            n_links += 1
        if annots and i < len(pdf.pages):
            pdf.pages[i].obj.Annots = Array(annots)
    out = io.BytesIO()
    pdf.save(out, compress_streams=True)
    return out.getvalue(), n_links


def render(job, browser):
    data = api("GET", f"/api/internal/render/jobs/{job['job_id']}/data").json()
    w, h = data["page_width"] * PX_PER_MM, data["page_height"] * PX_PER_MM
    ctx = browser.new_context(viewport={"width": int(w) + 20, "height": int(h) + 20}, device_scale_factor=DSF,
                              java_script_enabled=True, service_workers="block")
    try:
        page = ctx.new_page()

        def handle(route):
            url = route.request.url
            if url.startswith(PUBLIC):
                url = GW + url[len(PUBLIC):]
            if not url.startswith(GW):
                return route.abort()          # nada fuera del gateway (sin internet de todos modos)
            headers = dict(route.request.headers)
            if "/api/internal/" in url:
                headers["x-render-token"] = TOKEN
            try:
                resp = route.fetch(url=url, headers=headers, timeout=60000)
                route.fulfill(response=resp)
            except Exception:
                route.abort()

        page.route("**/*", handle)
        page.goto(GW + job["render_path"], wait_until="load", timeout=120000)
        page.wait_for_function("window.__RENDER_READY__ === true || !!window.__RENDER_ERROR__", timeout=300000, polling=500)
        if page.evaluate("window.__RENDER_ERROR__ || null"):
            raise RuntimeError("La página de render no obtuvo los datos")
        n = page.locator("[data-render-page]").count()
        shots = []
        for i in range(1, n + 1):
            beat()
            shots.append(page.locator(f'[data-render-page="{i}"]').screenshot(type="jpeg", quality=JPEG_Q, animations="disabled", timeout=60000))
        return data, shots
    finally:
        ctx.close()


def main():
    log("worker de render iniciado; gateway", GW)
    with sync_playwright() as p:
        while True:
            beat()
            try:
                r = api("POST", "/api/internal/render/claim", timeout=30)
            except Exception as e:
                log("gateway no disponible:", type(e).__name__); time.sleep(10); continue
            if r.status_code == 204:
                time.sleep(POLL); continue
            if r.status_code != 200:
                log("claim ->", r.status_code); time.sleep(15); continue
            job = r.json()
            t0 = time.time()
            log("trabajo", job["job_id"], "paginas", job.get("page_count"))
            browser = p.chromium.launch(args=["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--disable-background-networking"])
            try:
                data, shots = render(job, browser)
                pdf_bytes, n_links = build_pdf(data, shots)
                up = api("POST", f"/api/internal/render/jobs/{job['job_id']}/result", data=pdf_bytes,
                         headers={"Content-Type": "application/pdf", "X-Page-Count": str(len(shots))}, timeout=300)
                up.raise_for_status()
                log(f"OK {len(shots)} pag, {n_links} enlaces, {len(pdf_bytes)/1048576:.1f} MB en {time.time()-t0:.1f}s")
            except Exception as e:
                log("ERROR", job["job_id"], repr(e)[:300]); traceback.print_exc()
                try:
                    api("POST", f"/api/internal/render/jobs/{job['job_id']}/fail", json={"error": f"Error al generar el PDF ({type(e).__name__})"}, timeout=30)
                except Exception:
                    pass
            finally:
                browser.close()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(0)
