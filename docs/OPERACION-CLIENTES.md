# Operación: alta y puesta en marcha de un cliente (empresa)

Guía práctica para el Super Admin de Cetrix Revistas (producción: https://revistas.cetrix.com.mx).
Escrita el 29/30-sep-2026 con el alta del primer cliente real, **Destinos y Negocios**
(subdominio `destinosynegocios`, plan Business). Detalle técnico: RECETA-DESARROLLO.md §19.

## 1. Crear la empresa
Super Admin → *Nueva empresa*: nombre, **subdominio** (slug) y plan.
- Hoy el "subdominio" es solo un **identificador en la URL**: `revistas.cetrix.com.mx/r/<subdominio>/<colección>/<edición>`.
  `<subdominio>.revistas.cetrix.com.mx` **no existe** en DNS (no hay comodín). Para dominio propio del
  cliente ver `docs/dominios-propios.md` (Lote D, diseñado, sin construir).

## 2. Invitar al propietario (owner)
Super Admin → fila de la empresa → correo → **Invitar owner** (pide confirmación con correo + empresa).
- Se envía un correo desde `no-reply@cetrix.com.mx` (SMTP IONOS) con el botón *Aceptar invitación*
  (válido 7 días, un solo uso). El panel muestra además el enlace como **respaldo** e indica si el correo salió.
- Cada casilla de correo es independiente por empresa (antes compartían valor; corregido 29-sep).
- Si el correo **ya tiene cuenta activa en esa empresa**, no se crea invitación: se le asigna el rol owner
  directamente. Un correo no puede pertenecer a dos empresas (409).
- Reinvitar al mismo correo genera un enlace nuevo e invalida el anterior.
- El owner gestiona después su equipo en **Equipo** (invitaciones también por correo; el enlace solo se
  muestra si el correo no salió).

## 3. Colecciones y categorías
- Cada empresa arranca con la colección **"General"**. Recomendado **renombrarla** con un nombre descriptivo:
  el kiosco público agrupa por colección y varias "General" de empresas distintas confunden.
- Asignar **categoría** (lista común de la plataforma, la gestiona el Super Admin) a cada colección.
  La categoría NO es requisito para salir en el kiosco, pero sin ella la edición no aparece al **filtrar**
  por categoría ni muestra la categoría junto al nombre de la empresa.

## 4. Que una edición aparezca en el kiosco / landing
Requisitos (todos): edición **publicada** (tiene versión publicada) **+ "Mostrar en catálogo"**
(`is_public = true`) **+ empresa activa**. Publicar y mostrar en catálogo son **pasos separados**:
una edición publicada pero privada (etiqueta *"Solo privado"*) solo es accesible por enlace directo
o insertada, y no sale en el kiosco.
- Botón en la tarjeta de la edición: **Mostrar en catálogo / Ocultar del catálogo**.
- El kiosco está en la landing, sección **"Kiosco de publicaciones"** (menú *Kiosco*), no en la cabecera.
- Tras editar páginas hay que **"Actualizar publicación"** (el contenido público es el snapshot publicado);
  los ajustes SEO/visor se leen en vivo.
- Comprobación rápida: `curl -s https://revistas.cetrix.com.mx/api/public/publications` lista lo que el kiosco ve.

## 5. Acceso y contraseñas
- El acceso de clientes es el **modal "Acceso a Plataforma"** de la landing (botón *Acceso Clientes*;
  `/?acceso=1` lo abre directamente). `/login` sigue existiendo como página simple.
- **¿Olvidaste tu contraseña?** (en el modal y en `/login`) → `/recuperar-contrasena`: envía un enlace
  válido 2 h, un solo uso, máx. 1 correo cada 5 min por cuenta; respuesta idéntica exista o no la cuenta.
- El Super Admin también puede generar un restablecimiento desde *Miembros → Restablecer contraseña*
  (se envía por correo y conserva el enlace como respaldo).

## 6. Correo saliente — diagnóstico
- Configuración en `/srv/apps/flipbook/.env` (Contabo 1): `SMTP_HOST=smtp.ionos.mx`, `SMTP_PORT=587`,
  `SMTP_SECURITY=starttls`, `SMTP_USER=no-reply@cetrix.com.mx`, `SMTP_PASSWORD='…'` (comillas simples:
  compose interpola `$`), `MAIL_FROM`, `APP_PUBLIC_URL=https://revistas.cetrix.com.mx`.
  Tras cambiar el `.env`: `docker compose -f docker-compose.prod.yml up -d backend`.
- Logs: `docker logs flipbook-prod-backend 2>&1 | grep app.mailer` → `mail.sent` / `mail.retry` /
  `mail.failed(_permanent)` (destinatario enmascarado, sin tokens).
- Probar login SMTP sin enviar nada:
  `docker exec flipbook-prod-backend python -c "from app.config import settings as s;import smtplib,ssl;x=smtplib.SMTP(s.SMTP_HOST,s.SMTP_PORT,timeout=15);x.starttls(context=ssl.create_default_context());print(x.login(s.SMTP_USER,s.SMTP_PASSWORD)[0]);x.quit()"` → `235` = OK.
- DNS de `cetrix.com.mx` ya tiene SPF/DKIM/DMARC de IONOS; si un correo cae en spam, revisar primero DMARC (`p=none`).
- Al pegar comandos multilínea en MobaXterm se añade sangría y los *heredoc* (`<<'EOF'`) no terminan
  (se queda en `>`): dar siempre comandos de **una sola línea** o pulsar Ctrl+C y reintentar.

## 7. Checklist de alta de cliente
1. Crear empresa (nombre, subdominio, plan).
2. Invitar owner → confirmar en el panel "Correo enviado".
3. Renombrar la colección "General" y asignar categoría.
4. Crear/importar la primera edición → Publicar → **Mostrar en catálogo**.
5. Verificar en la landing (sección Kiosco) y en `/r/<subdominio>/<colección>/<edición>`.
6. (Opcional) Dominio propio: `docs/dominios-propios.md`.
