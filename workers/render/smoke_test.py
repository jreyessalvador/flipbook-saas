"""F1 smoke test: Chromium headless aislado pinta una edicion publica via el gateway."""
import sys, time, socket, urllib.request
from playwright.sync_api import sync_playwright

GW = "http://10.253.43.1:8462"
URL = GW + (sys.argv[1] if len(sys.argv) > 1 else "/r/default/general/destinos-y-negocios-34")

def can(host, port, t=3):
    try:
        socket.create_connection((host, port), t).close(); return "ABIERTO"
    except OSError:
        return "bloqueado"

print("aislamiento:",
      "internet 1.1.1.1:443", can("1.1.1.1", 443), "|",
      "host C2 172.31.250.1:22", can("172.31.250.1", 22), "|",
      "C2 publica 169.58.102.22:443", can("169.58.102.22", 443), "|",
      "C1 4400 por tunel", can("10.253.43.1", 4400), "|",
      "gateway 8462", can("10.253.43.1", 8462))
try:
    urllib.request.urlopen("https://www.google.com", timeout=4); print("internet HTTP: ABIERTO(!)")
except Exception as e:
    print("internet HTTP: bloqueado")

t0 = time.time()
with sync_playwright() as p:
    b = p.chromium.launch(args=["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"])
    pg = b.new_page(viewport={"width": 1400, "height": 1000}, device_scale_factor=2)
    # El frontend llama a la API por su origen publico (VITE_API_URL); el
    # contenedor no tiene internet: se reescribe ese origen hacia el gateway.
    PUBLIC = "https://dev-revistas.cetrix.com.mx"
    def via_gateway(route):
        u = route.request.url.replace(PUBLIC, GW, 1)
        try:
            route.fulfill(response=route.fetch(url=u))
        except Exception as e:
            route.abort()
    pg.route(PUBLIC + "/**", via_gateway)
    pg.on("console", lambda m: m.type == "error" and print("console:", m.text[:160]))
    pg.on("requestfailed", lambda r: print("fallo:", r.url[:120]))
    pg.goto(URL, wait_until="load", timeout=60000)
    pg.wait_for_selector("canvas", timeout=45000); pg.wait_for_timeout(2500)
    pg.screenshot(path="/out/smoke.png")
    print("titulo:", pg.title())
    b.close()
print(f"render OK en {time.time()-t0:.1f}s")
