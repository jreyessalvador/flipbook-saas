# Dominios propios por cliente (Lote D) — diseño y guía

Estado: **diseño aprobado para implementar; nada construido aún** (27-sep-2026).
La tabla `tenant_domains` ya existe desde la migración 0004 (hostname, kind `platform_subdomain|custom`,
is_primary, status `pending|verifying|verified|failed|disabled`, verification_token_hash, tls_status).

## 1. Opciones que ofrecemos al cliente (de más a menos recomendada)

| Opción | Ejemplo | Qué hace el cliente | Esfuerzo nuestro | Recomendación |
|---|---|---|---|---|
| **A. Subdominio propio** | `revistas.cliente1.com` | 1 registro **CNAME** + 1 **TXT** en su DNS | Bajo, automatizable | **Opción por defecto** (planes Business/Enterprise) |
| B. Insertar en su web | `cliente1.com/revistas` con nuestro lector dentro | Pegar un `<iframe>` que le damos en esa página | Muy bajo (requiere `/embed/:id` del Lote A) | Para quien quiere la ruta en su dominio sin tocar servidores |
| C. Ruta real en su dominio | `cliente1.com/revistas` servido por nosotros | Su servidor/CDN hace **reverse proxy** de `/revistas/*` hacia nosotros | Medio: SPA con base path, cabeceras, caché | Solo Enterprise y con su equipo técnico |
| D. Dominio completo | `cliente1revistas.com` | Registro **A** a nuestra IP (o ALIAS/ANAME) | Bajo | Válido; se rompe si cambiamos de IP (preferir A) |

### Instrucciones para el cliente — Opción A (texto listo para enviar)
1. En el DNS de `cliente1.com` crea:
   - `CNAME  revistas  →  custom.revistas.cetrix.com.mx`
   - `TXT    _cetrix-verify.revistas  →  <token que ves en tu panel>`
2. Espera la propagación (normalmente minutos; máximo 24 h) y pulsa **Verificar** en el panel.
3. Nosotros emitimos el certificado HTTPS automáticamente. En cuanto aparezca **Activo**, `https://revistas.cliente1.com` muestra tu kiosco.
4. Si usas Cloudflare: registro en modo **DNS only** (nube gris) hasta que el certificado esté activo.

### Instrucciones — Opción C (reverse proxy en su servidor)
nginx del cliente:
```nginx
location /revistas/ {
    proxy_pass https://custom.revistas.cetrix.com.mx/;
    proxy_set_header Host revistas.cliente1.com;      # host registrado en su panel
    proxy_set_header X-Forwarded-Host cliente1.com;
    proxy_set_header X-Forwarded-Prefix /revistas;
    proxy_set_header X-Forwarded-Proto https;
    proxy_ssl_server_name on;
}
```
Apache: `ProxyPass /revistas/ https://custom.revistas.cetrix.com.mx/` + `ProxyPreserveHost Off` + mismas cabeceras.
Cloudflare: Worker que reescriba `/revistas/*`. Requiere que nuestra SPA soporte base path (ver 3.4).

## 2. Qué ve y hace cada panel

### Panel de la empresa (owner/admin) → "Dominio propio"
- Añadir hostname (validación: FQDN, no `*.cetrix.com.mx`, no IP, no dominios de otra empresa).
- Muestra los 2 registros DNS a crear (CNAME + TXT con token) con botón copiar.
- Botón **Verificar** → estado: Pendiente → Verificando → Verificado → Certificado activo / Error (con motivo legible: "El CNAME apunta a X", "No encontramos el TXT").
- Elegir **qué muestra el dominio**: kiosco completo de la empresa o **una colección concreta** (`tenant_domains.target_collection_id`).
- Marcar principal (los enlaces de Compartir/QR/OG usarán el dominio principal verificado).
- Eliminar dominio.
- Disponible según plan (`plans.features.custom_domains = n`).

### Panel Super Admin
- Listado global de dominios por empresa con estado DNS/TLS, fecha de verificación y último chequeo.
- Acciones: reverificar, forzar reemisión de certificado, deshabilitar (abuso/impago), ver log.
- Alertas: certificado a < 15 días de caducar sin renovar, DNS que dejó de apuntar.

## 3. Implementación técnica

### 3.1 Datos (migración nueva)
`tenant_domains`: añadir `target_collection_id UUID NULL` (FK compuesta con tenant como en publications),
`last_error TEXT`, `cert_expires_at TIMESTAMPTZ`, `verified_by UUID`; índice único en `lower(hostname)`.

### 3.2 Resolución de empresa por Host
Middleware en el backend público: `Host` → `tenant_domains(status='verified')` → tenant (+ colección). El catálogo
`/api/public/*` filtra por ese tenant; el host de plataforma (`revistas.cetrix.com.mx`) sigue siendo el kiosco global.
El panel de administración **no** se sirve en dominios de clientes (solo el lector/kiosco) → cookies y sesiones nunca en dominio ajeno.

### 3.3 TLS automático con nginx (sin cambiar de proxy)
- `server` catch-all 80: sirve `/.well-known/acme-challenge/` desde `/var/www/letsencrypt` para cualquier host y redirige el resto a https.
- `server` catch-all 443 `default_server`: `ssl_certificate /etc/ssl/tenants/$ssl_server_name/fullchain.pem;` (nginx ≥ 1.15.9 admite variables) con un certificado por defecto para hosts sin cert.
- Worker de dominios (Celery beat cada 5 min): verifica CNAME+TXT (dnspython) → si OK, `certbot certonly --webroot -d <host>` mediante un script sudo acotado (`/usr/local/bin/flipbook-issue-cert <host>`, valida el host contra la BD antes de ejecutar) → enlaza en `/etc/ssl/tenants/<host>/` → `nginx -s reload`. Renovación: timer de certbot + chequeo de `cert_expires_at`.
- Seguridad: solo se emite certificado a hosts **verificados** (evita que cualquiera apunte un dominio y nos haga pedir certificados → límites de Let's Encrypt); rate limit por empresa; registro de auditoría.
- Alternativa evaluada: Caddy con `on_demand_tls` + endpoint `ask`. Más simple para TLS, pero implica un segundo proxy delante de nginx en Contabo 1 → se descarta de momento.

### 3.4 Base path (solo opción C)
Vite `base` + `BrowserRouter basename` leídos en runtime desde `X-Forwarded-Prefix` (inyectado en `index.html` por el backend) y URLs de API relativas.

### 3.5 Compartir, QR, Open Graph, embed
Todos deben construir URLs con el **dominio principal verificado** de la empresa si existe (hoy usan `window.location.origin`).

## 4. Orden sugerido
1. Migración + API CRUD de dominios + verificación DNS (sin TLS) + UI empresa/Super Admin.
2. nginx catch-all + script de emisión + worker (probar primero con un subdominio de Cetrix, p.ej. `demo-cliente.cetrix.com.mx`).
3. Resolución por Host en el kiosco/lector + URLs de compartir/QR con dominio principal.
4. `/embed/:id` (Lote A) → habilita la opción B.
5. Base path (opción C) solo cuando un cliente Enterprise lo pida.
