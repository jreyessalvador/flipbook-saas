"""QA VID-2 (2026-10-16): HTTP Range / HEAD / ETag en /api/assets/serve.

Ejecutar DENTRO del contenedor backend de DEV (solo lectura, re-ejecutable):
  docker cp backend/tests/qa_vid2_range.py flipbook-dev-backend:/tmp/qa_vid2.py
  docker exec flipbook-dev-backend python /tmp/qa_vid2.py
Compara los bytes servidos contra una lectura directa de MinIO.
"""
import sys, time, hashlib, http.client
sys.path.insert(0, "/app")
from app.api.assets import minio_client, BUCKET_NAME

HOST, PORT = "localhost", 8000
FAILS = []


def check(name, cond, extra=""):
    print(("PASS " if cond else "FAIL ") + name + (f"  [{extra}]" if (extra and not cond) else ""))
    if not cond:
        FAILS.append(name)


def req(method, key, headers=None, read=True):
    c = http.client.HTTPConnection(HOST, PORT, timeout=30)
    c.request(method, "/api/assets/serve/" + key, headers=headers or {})
    r = c.getresponse()
    body = r.read() if read else b""
    hd = {k.lower(): v for k, v in r.getheaders()}
    c.close()
    return r.status, hd, body


def direct(key, offset=0, length=0):
    r = minio_client.get_object(BUCKET_NAME, key, offset=offset, length=length)
    try:
        return r.read()
    finally:
        r.close(); r.release_conn()


def pick(ext):
    best = None
    for o in minio_client.list_objects(BUCKET_NAME, recursive=True):
        if o.object_name.lower().endswith(ext) and (best is None or o.size > best.size):
            best = o
    return best


def established_to_minio():
    n = 0
    for line in open("/proc/net/tcp").read().splitlines()[1:]:
        f = line.split()
        if f[3] == "01" and f[2].endswith(":2328"):  # 9000 hex
            n += 1
    return n


mp4 = pick(".mp4"); jpg = pick(".jpg")
assert mp4 and jpg, "faltan objetos de prueba en DEV"
K, N = mp4.object_name, mp4.size
full = direct(K)
check("setup: tamano directo == stat", len(full) == N)

# 1. GET completo (sin Range) = comportamiento anterior, ahora con validadores
s, h, b = req("GET", K)
check("GET 200", s == 200, s)
check("GET Accept-Ranges bytes", h.get("accept-ranges") == "bytes")
check("GET Content-Length", h.get("content-length") == str(N), h.get("content-length"))
check("GET bytes identicos a MinIO", hashlib.sha256(b).digest() == hashlib.sha256(full).digest())
check("GET Content-Type video", h.get("content-type", "").startswith("video/"), h.get("content-type"))
etag = h.get("etag"); lm = h.get("last-modified")
check("GET ETag y Last-Modified", bool(etag) and bool(lm))
check("GET Cache-Control no-cache", h.get("cache-control") == "no-cache")

# 2. HEAD
s, h, b = req("HEAD", K)
check("HEAD 200 sin cuerpo", s == 200 and b == b"", (s, len(b)))
check("HEAD Content-Length", h.get("content-length") == str(N))

# 3. Rangos validos
cases = [
    ("bytes=0-99", 0, 99),
    ("bytes=0-0", 0, 0),
    ("bytes=1000-", 1000, N - 1),
    ("bytes=-500", N - 500, N - 1),
    (f"bytes={N-10}-{N+9999}", N - 10, N - 1),   # fin mas alla del tamano: se recorta
    ("bytes=4000000-4000999", 4000000, 4000999),   # tramo intermedio (salto en la barra)
]
for rh, a, z in cases:
    s, h, b = req("GET", K, {"Range": rh})
    ok = (s == 206 and h.get("content-range") == f"bytes {a}-{z}/{N}"
          and h.get("content-length") == str(z - a + 1) and b == full[a:z + 1])
    check(f"Range {rh} -> 206 exacto", ok, (s, h.get("content-range"), len(b)))

# 4. No satisfacibles -> 416
for rh in (f"bytes={N}-", f"bytes={N+5}-{N+10}", "bytes=-0"):
    s, h, b = req("GET", K, {"Range": rh})
    check(f"Range {rh} -> 416", s == 416 and h.get("content-range") == f"bytes */{N}", (s, h.get("content-range")))

# 5. Sintaxis invalida / multi-rango / unidad desconocida -> se ignora, 200 completo
for rh in ("bytes=abc", "items=0-1", "bytes=5-2", "bytes=0-1,5-6", "bytes=-", "basura"):
    s, h, _ = req("GET", K, {"Range": rh}, read=False)
    check(f"Range invalido {rh!r} -> 200 completo", s == 200 and h.get("content-length") == str(N), (s, h.get("content-length")))

# 6. If-Range
s, h, b = req("GET", K, {"Range": "bytes=0-9", "If-Range": etag})
check("If-Range ETag igual -> 206", s == 206 and len(b) == 10, s)
s, h, _ = req("GET", K, {"Range": "bytes=0-9", "If-Range": '"otro"'}, read=False)
check("If-Range ETag distinto -> 200 completo", s == 200 and h.get("content-length") == str(N), s)
s, h, b = req("GET", K, {"Range": "bytes=0-9", "If-Range": lm})
check("If-Range fecha igual -> 206", s == 206 and len(b) == 10, s)

# 7. If-None-Match
s, h, b = req("GET", K, {"If-None-Match": etag})
check("If-None-Match igual -> 304 sin cuerpo", s == 304 and b == b"", s)
s, h, _ = req("GET", K, {"If-None-Match": '"otro"'}, read=False)
check("If-None-Match distinto -> 200", s == 200, s)

# 8. No existe
s, h, b = req("GET", "no/existe/nada.mp4")
check("inexistente GET -> 404", s == 404, s)
s, h, b = req("HEAD", "no/existe/nada.mp4")
check("inexistente HEAD -> 404", s == 404, s)

# 9. Regresion imagen (sin Range, como el editor/lector)
j = direct(jpg.object_name)
s, h, b = req("GET", jpg.object_name)
check("JPG regresion 200 identico", s == 200 and b == j and h.get("content-type", "").startswith("image/"), (s, h.get("content-type")))

# 10. Abortos a mitad de stream: el pool keep-alive de MinIO (max 10) se estabiliza,
#     no crece con el numero de abortos (una fuga crecería linealmente).
def abortos(n):
    for _ in range(n):
        c = http.client.HTTPConnection(HOST, PORT, timeout=15)
        c.request("GET", "/api/assets/serve/" + K)
        r = c.getresponse(); r.read(2048); c.close()
    time.sleep(3)
    return established_to_minio()

a40 = abortos(40)
a200 = abortos(160)
check("sin fuga de conexiones MinIO (40 vs 200 abortos)", a200 <= 12 and a200 - a40 <= 3, f"tras40={a40} tras200={a200}")

print("\nRESULTADO:", "TODO OK" if not FAILS else f"{len(FAILS)} FALLOS: {FAILS}")
sys.exit(1 if FAILS else 0)
