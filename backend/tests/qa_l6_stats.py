"""QA Lote L6 — estadisticas de lectura sin cookies (17-oct-2026).

  docker cp backend/tests/qa_l6_stats.py flipbook-dev-backend:/tmp/qa_l6.py
  docker exec flipbook-dev-backend python /tmp/qa_l6.py
Re-ejecutable (purga lo que crea). Todo debe salir PASS.
"""
import sys, json, uuid, atexit, urllib.request, urllib.error
sys.path.insert(0, "/app")
from datetime import timedelta, date
from sqlalchemy import text
from app.core.security import token_with_current_version as create_access_token
from app.db.session import SessionLocal
from app.models.publication import Publication
from app.models.collection import Collection
from app.services import reader_stats as rs
from app.services.trash import purge_publication

B = "http://localhost:8000"
FAILS, RUN = [], uuid.uuid4().hex[:6]
UA_DESK = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
UA_IPH = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"
UA_AND = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36"
IP_US, IP_ES, IP_MX = "8.8.8.8", "80.58.61.250", "187.141.100.20"


def call(method, path, token=None, body=None, headers=None, raw_body=None):
    h = {"Content-Type": "text/plain;charset=UTF-8" if raw_body is not None or headers else "application/json"}
    if token: h["Authorization"] = "Bearer " + token
    h.update(headers or {})
    data = raw_body if raw_body is not None else (json.dumps(body).encode() if body is not None else None)
    if isinstance(data, str): data = data.encode()
    r = urllib.request.Request(B + path, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(r) as x:
            c = x.read(); return x.status, (json.loads(c) if c else None)
    except urllib.error.HTTPError as e:
        c = e.read()
        try: return e.code, json.loads(c)
        except Exception: return e.code, c[:120]


def ok(c, m):
    print(("PASS " if c else "FAIL ") + m)
    if not c: FAILS.append(m)


def tok(email): return create_access_token({"sub": email}, timedelta(minutes=20))
SA, OW, ED = tok("jose.reyes@cetrix.com.mx"), tok("owner.demo@example.com"), tok("editor.demo@example.com")
pubs, cols = [], []


@atexit.register
def _cleanup():
    db = SessionLocal()
    try:
        for pid in pubs:
            p = db.query(Publication).filter(Publication.id == pid).first()
            if p: purge_publication(db, p)
        for cid in cols:
            c = db.query(Collection).filter(Collection.id == cid).first()
            if c: db.delete(c)
        db.commit()
    finally:
        db.close()


def ev(pid, e, ip=IP_US, ua=UA_DESK, extra=None, hdr=None):
    body = {"p": pid, "e": e, **(extra or {})}
    return call("POST", "/api/public/events", raw_body=json.dumps(body), headers={"X-Real-IP": ip, "User-Agent": ua, **(hdr or {})})[0]


def q(sql, **p):
    db = SessionLocal()
    try: return db.execute(text(sql), p).all()
    finally: db.close()


def count(pid, event=None):
    return q("SELECT count(*) FROM reader_events WHERE publication_id=:p" + (" AND event=:e" if event else ""), p=pid, **({"e": event} if event else {}))[0][0]


def views(pid): return q("SELECT views_count FROM publications WHERE id=:p", p=pid)[0][0]


st, c1 = call("POST", "/api/collections", OW, {"name": f"QA L6 {RUN}"}); cols.append(c1["id"])
st, P = call("POST", "/api/publications/", OW, {"title": f"QA stats {RUN}", "collection_id": c1["id"], "total_pages": 3}); pubs.append(P["id"])
st, Q = call("POST", "/api/publications/", OW, {"title": f"QA stats priv {RUN}", "collection_id": c1["id"], "total_pages": 3}); pubs.append(Q["id"])
call("POST", f"/api/publications/{P['id']}/publish", OW); call("PUT", f"/api/publications/{P['id']}/visibility", OW, {"is_public": True})
pid = P["id"]

# --- base de paises
ok(rs.country_of(IP_US) == "US" and rs.country_of(IP_ES) == "ES" and rs.country_of(IP_MX) == "MX", f"pais por IP (base local): {rs.country_of(IP_US)},{rs.country_of(IP_ES)},{rs.country_of(IP_MX)}")
ok(rs.country_of("192.168.1.5") is None and rs.country_of("127.0.0.1") is None, "IP privada/local -> sin pais")

# --- apertura, dedupe y views_count
ok(views(pid) == 0, "views_count parte en 0")
ok(ev(pid, "open", IP_US, UA_DESK, {"s": "qr"}) == 204 and count(pid, "open") == 1 and views(pid) == 1, "la primera apertura cuenta 1 lectura (views_count=1)")
for _ in range(9): ev(pid, "open", IP_US, UA_DESK)
ok(count(pid, "open") == 1 and views(pid) == 1, "recargar 10 veces cuenta 1 lectura ese dia")
ev(pid, "open", IP_ES, UA_IPH, {"r": "https://www.google.com/search?q=revista"})
ev(pid, "open", IP_MX, UA_AND, {"m": 1, "r": "https://www.miempresa.com/blog/nota"})
ok(count(pid, "open") == 3 and views(pid) == 3, "otros visitantes suman lecturas distintas")

# --- descartes silenciosos
n0 = count(pid)
ok(ev(pid, "open", "9.9.9.9", "Googlebot/2.1 (+http://www.google.com/bot.html)") == 204, "bot -> 204")
ev(pid, "open", "9.9.9.8", UA_DESK, hdr={"DNT": "1"}); ev(pid, "open", "9.9.9.7", UA_DESK, hdr={"Sec-GPC": "1"})
ev(Q["id"], "open", "9.9.9.6"); ev(str(uuid.uuid4()), "open", "9.9.9.5"); ev("no-es-uuid", "open", "9.9.9.4")
ev(pid, "zzz", "9.9.9.3"); call("POST", "/api/public/events", raw_body="x" * 5000, headers={"X-Real-IP": "9.9.9.2", "User-Agent": UA_DESK}); call("POST", "/api/public/events", raw_body="{no json", headers={"X-Real-IP": "9.9.9.1", "User-Agent": UA_DESK})
ok(count(pid) == n0, "bots, DNT, Sec-GPC, edicion privada/inexistente, evento y cuerpo invalidos: no se registra nada")

# --- paginas, tiempo, clics
ev(pid, "view", IP_US, UA_DESK, {"g": [1, 2]}); ev(pid, "view", IP_US, UA_DESK, {"g": [2, 3]}); ev(pid, "view", IP_ES, UA_IPH, {"g": [1]})
ev(pid, "view", IP_US, UA_DESK, {"g": [99, 0, -1]})
ok(count(pid, "view") == 5, f"paginas vistas: una fila por pagina valida, fuera de rango ignoradas ({count(pid, 'view')})")
ev(pid, "time", IP_US, UA_DESK, {"g": [1, 2], "t": 20000}); ev(pid, "time", IP_US, UA_DESK, {"g": [3], "t": 10_000_000}); ev(pid, "time", IP_US, UA_DESK, {"g": [1], "t": 100})
tm = q("SELECT page, ms FROM reader_events WHERE publication_id=:p AND event='time' ORDER BY id", p=pid)
ok([tuple(r) for r in tm] == [(1, 10000), (2, 10000), (3, 300000)], f"tiempo: se reparte entre las hojas, tope 5 min, <300 ms ignorado ({[tuple(r) for r in tm]})")
ev(pid, "click", IP_US, UA_DESK, {"a": "url", "x": "https://www.ejemplo.com/ruta/privada?token=abc"}); ev(pid, "click", IP_US, UA_DESK, {"a": "email", "x": "persona@correo.com"}); ev(pid, "click", IP_US, UA_DESK, {"a": "hack"})
ck = q("SELECT act, target FROM reader_events WHERE publication_id=:p AND event='click' ORDER BY id", p=pid)
ok([tuple(r) for r in ck] == [("url", "ejemplo.com"), ("email", None)], f"clics: de una URL solo el dominio; del email nada ({[tuple(r) for r in ck]})")

# --- datos guardados
r = q("SELECT src, ref_host, embed, country, device, browser, os FROM reader_events WHERE publication_id=:p AND event='open' ORDER BY id", p=pid)
ok([tuple(x) for x in r] == [("qr", None, False, "US", "desktop", "chrome", "windows"), (None, "google.com", False, "ES", "mobile", "safari", "ios"),
                            (None, "miempresa.com", True, "MX", "mobile", "chrome", "android")], f"origen, referencia, pais y dispositivo clasificados ({[tuple(x) for x in r]})")
ev(pid, "open", "9.9.9.20", UA_DESK, {"s": "<script>alert(1)</script>"})
ok(q("SELECT src FROM reader_events WHERE publication_id=:p AND event='open' ORDER BY id DESC LIMIT 1", p=pid)[0][0] is None, "src con caracteres raros se descarta")
cols_db = {x[0] for x in q("SELECT column_name FROM information_schema.columns WHERE table_name='reader_events'")}
ok(not ({"ip", "ip_address", "user_agent", "ua", "email"} & cols_db), "la tabla no tiene columnas de IP ni user-agent")
ok(all(len(v[0].strip()) == 16 for v in q("SELECT visitor FROM reader_events WHERE publication_id=:p", p=pid)), "visitante = hash de 16 caracteres")
ok(rs.visitor_hash(IP_US, UA_DESK, pid, date(2026, 10, 17)) != rs.visitor_hash(IP_US, UA_DESK, pid, date(2026, 10, 18)), "la sal rota cada dia: el mismo visitante da otro hash")
ok(rs.visitor_hash(IP_US, UA_DESK, pid, date(2026, 10, 17)) != rs.visitor_hash(IP_US, UA_DESK, str(Q["id"]), date(2026, 10, 17)), "el hash tampoco enlaza ediciones distintas")

# --- limite por IP
before = count(pid, "view")
for i in range(330): ev(pid, "view", "7.7.7.7", UA_DESK, {"g": [1]})
added = count(pid, "view") - before
ok(0 < added <= rs.RATE_PER_MIN, f"limite por IP: {added} de 330 eventos aceptados (max {rs.RATE_PER_MIN}/min)")

# --- panel
st, s = call("GET", f"/api/publications/{pid}/stats?days=30", OW)
ok(st == 200 and s["totals"]["opens"] == 4 and s["totals"]["clicks"] == 2 and len(s["series"]) == 30, f"stats por edicion: lecturas={s['totals']['opens']} clics={s['totals']['clicks']} dias={len(s['series'])}")
ok({c["key"] for c in s["countries"]} == {"US", "ES", "MX"} and {d["key"] for d in s["devices"]} == {"desktop", "mobile"}, "paises y dispositivos agregados")
ok(s["series"][-1]["opens"] == 4, "la serie diaria acumula las lecturas de hoy")
ok(any(e["key"] == "miempresa.com" for e in s["embeds"]) and any(e["key"] == "google.com" for e in s["referrers"]) and any(e["key"] == "qr" for e in s["sources"]), "webs que insertan, referencias y origen QR")
ok(s["pages"] and s["pages"][0]["page"] == 1 and s["totals"]["avg_time_ms"] > 0, "paginas con alcance y tiempo medio")
st, ov = call("GET", "/api/stats/overview?days=7", OW)
ok(st == 200 and any(e["id"] == pid and e["opens"] == 4 for e in ov["editions"]) and len(ov["series"]) == 7, "resumen general por edicion")
st, _ = call("GET", f"/api/publications/{pid}/stats", ED); ok(st == 200, f"un editor ve las estadisticas ({st})")
st, _ = call("GET", f"/api/publications/{pid}/stats", None); ok(st in (401, 403), f"sin sesion -> {st}")
st, _ = call("GET", f"/api/publications/{pid}/stats", SA); ok(st == 404, f"otra empresa -> {st}")
st, ovs = call("GET", "/api/stats/overview", SA); ok(st == 200 and all(e["id"] != pid for e in ovs.get("editions", [])), "el resumen de otra empresa no incluye estas ediciones")
st, _ = call("GET", f"/api/publications/{pid}/stats?days=9999", OW); ok(st == 422, f"days fuera de rango -> {st}")

# --- borrar la edicion arrastra sus eventos
db = SessionLocal(); purge_publication(db, db.query(Publication).filter(Publication.id == pid).first()); db.close(); pubs.remove(pid)
ok(q("SELECT count(*) FROM reader_events WHERE publication_id=:p", p=pid)[0][0] == 0, "purgar la edicion borra sus eventos (cascade)")

print("\nRESULTADO:", "TODO OK" if not FAILS else f"{len(FAILS)} FALLOS: {FAILS}")
sys.exit(1 if FAILS else 0)
