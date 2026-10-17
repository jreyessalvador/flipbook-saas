# Cetrix Revistas — Plan de desarrollo de la web comercial

> Redactado el 17-oct-2026 (Claude/Cowork), retomando el pendiente #8 de `PLAN-SIGUIENTES-LOTES.md`
> ("Web profesional / landing comercial") tras cerrar L7a y la Estantería pública en producción.
> Sustituye como documento de trabajo a la propuesta externa (Claude Doc «Propuesta web Cetrix
> Revistas», 13-sep-2026) — se conserva como referencia de intención, pero el plan vivo es este
> archivo, versionado en el repo.
>
> **Alcance:** la landing/marketing de **revistas.cetrix.com.mx** (el producto Cetrix Revistas),
> no la web corporativa `cetrix.com.mx` (otro proyecto, ver `agents-memory/projects/cetrixdemexico`).

---

## 0. Punto de partida (verificado, no repetir trabajo)

Ya están **en producción** y no se tocan en este plan salvo mención explícita:
- `LandingPage.jsx`: hero B2B, galería/estantería pública, capacidades, formulario de propuesta,
  modal de acceso. Branding CETRIX Software / CETRIX Flipbooks, paleta navy (`#14213d`) + dorado
  (`#c9a24b`). Sin tabla de precios (decisión B2B del 13-sep, ver §1).
- Estantería pública (balda navy/dorado) en landing y en `/r/{empresa}/{coleccion}`, con
  buscador/orden/paginación, cinta "NUEVO", `/embed/r/{empresa}/{coleccion}` — PROD 17-oct.
- Portadas completas renderizadas (WebP 400/800) + imagen OG 1200×630 (L7a) — PROD 17-oct.
- `/leer/:id` y URLs canónicas `/r/{empresa}/{coleccion}/{edicion}`, flip 3D, descarga de PDF
  condicionada a `allow_download`.
- **Lighthouse móvil PROD medido el 17-oct-2026** (`~/dev/lh/run.sh`, imagen Playwright v1.55 en C1):

  | Ruta | Rendimiento | Accesibilidad | Buenas prácticas | SEO | Nota |
  |---|---|---|---|---|---|
  | `/` (landing) | **86** (objetivo ≥ 90) | 96 | 96 | 100 | TBT 500 ms — bundle principal 298 KB (111 KB transferidos) + 48 KiB JS sin usar |
  | `/r/default/general` (colección) | 99 | 95 | — | 100 | TBT 40 ms |

- Pendiente heredado sin resolver: **L6** (estadísticas sin cookies, `views_count`) — sigue sin
  construirse. Afecta a la Fase 3 de este plan (no hay cifras reales que mostrar todavía).

## 1. Decisión de modelo comercial — contradicción detectada, hay que resolverla primero

Dos decisiones de Carlos registradas en fechas distintas **se contradicen**:

- **13-sep-2026** (Sección 11, confirmado): *"Sin tabla de precios: la contratación es por
  cotización y propuesta personalizada B2B"* — modelo de venta directa asistida, sin autologin.
- **28-sep-2026** (backlog de la web profesional, pendiente): *"precios Básico/Profesional en
  MXN y EUR"* — sugiere un modelo de planes públicos con precio visible.

Ambos no pueden ser ciertos a la vez. Antes de diseñar la sección comercial de la landing,
Carlos tiene que elegir una de estas tres opciones (o una variante):

- **A. Mantener B2B por cotización** (como hoy): la landing no muestra precios, solo capacidades
  + formulario de propuesta. Menor esfuerzo, es lo que ya existe.
- **B. Planes públicos con precio** (Básico/Profesional, MXN+EUR): nueva sección de precios,
  requiere definir qué incluye cada plan — la tabla `plans.features` ya existe en BD (se usa hoy
  para `custom_domains`), así que el soporte de datos está parcialmente listo; falta UI pública.
- **C. Híbrido**: precio de referencia visible ("desde $X/mes") pero cierre siempre asistido
  (demo/cotización) — común en SaaS B2B.

Esta decisión condiciona el diseño de toda la Fase 2 (§4) y no se puede empezar a construir esa
fase sin ella.

## 2. Decisiones pendientes de Carlos (gate bloqueante para la Fase 2)

Heredadas de la propuesta del 13-sep y sin resolver a 17-oct-2026:

1. **Modelo comercial** — ver §1 (A/B/C).
2. Si B o C: **precios** concretos por plan, en MXN y EUR, y qué límites/funciones distingue
   cada plan (ediciones, almacenamiento, dominio propio, estadísticas, soporte).
3. **Logos y testimonios autorizados** para publicar. Hoy el único cliente real en producción es
   **Destinos y Negocios**; no se inventan clientes ni cifras de otros.
4. **Revista real** que se usa como pieza destacada en el hero de la portada (debe ser una
   edición pública con snapshot publicado).
5. **Idioma**: variante México / España o redacción neutra para todo el copy.
6. **Revisor legal**: quién redacta/aprueba Aviso de Privacidad (RGPD + LFPDPPP) y Términos de
   Uso antes de publicarlos en `/legal/...`.

**Regla de todo el plan: no se inventan cifras, logos, testimonios ni textos legales.** Donde
falte una decisión, la sección se deja en su versión actual (o se omite) hasta que Carlos
responda.

## 3. Fase 1 — Rendimiento y accesibilidad de lo ya construido

**No depende de ninguna decisión de Carlos. Se puede empezar de inmediato.**

Objetivo: cerrar la brecha de Lighthouse de la landing actual (86 → ≥ 90) antes de añadir más
contenido encima, para no construir sobre una base ya penalizada.

- Code-splitting del bundle principal: el modal "Acceso a Plataforma" y sus dependencias se
  cargan siempre en `/`, aunque la mayoría de visitas no lo abren. Convertir a `React.lazy` /
  dynamic import.
- Eliminar los ~48 KiB de JS sin usar que reporta Lighthouse en el bundle de landing (dependencias
  cargadas pero no ejecutadas en esa ruta).
- Accesibilidad: corregir `color-contrast` y `label-content-name-mismatch` en la landing, y
  `link-in-text-block` en la vista de colección.
- Volver a medir con `~/dev/lh/run.sh` (Contabo 1) tras cada cambio; no declarar cerrado sin la
  medición.

**Criterios de aceptación**
- [ ] Lighthouse móvil `/`: Rendimiento ≥ 90, Accesibilidad ≥ 98, se mantienen SEO 100 / Buenas
      prácticas ≥ 96.
- [ ] `/r/{empresa}/{coleccion}` no retrocede de su 99 actual.
- [ ] QA de aislamiento (26) y RBAC (37) en verde — por si el code-splitting tocara rutas
      compartidas con el panel.

**Tamaño:** S (una sesión). **Responsable:** cualquier agente, sin decisiones pendientes de
Carlos.

## 4. Fase 2 — Contenido y estructura comercial completos

**Bloqueada hasta cerrar el gate del §2.** Una vez resuelto:

### 4.1 Mapa del sitio propuesto

```
/                              Landing comercial
  Header: logo · Producto · Estantería · (Precios, si aplica B/C) · Acceso Clientes
  Hero (producto + revista destacada del gate §2.4)
  Cómo funciona (3-4 pasos reales: crear/importar → publicar → compartir/insertar → estadísticas*)
  Estantería / showcase público (YA EXISTE — reutilizar, no reconstruir)
  Planes y precios  — SOLO si Carlos elige B o C en §1; si elige A, se mantiene el formulario
                       de propuesta actual sin tabla de precios
  Clientes / caso de uso (solo con logos/testimonios autorizados del gate §2.3)
  Preguntas frecuentes
  CTA final + formulario de propuesta (ya existe, revisar copy)
  Footer: enlaces a /legal/privacidad y /legal/terminos (gate §2.6), contacto, redes
/r/{empresa}/{coleccion}       Estantería de colección — YA EXISTE
/leer/:id                      Lector público — YA EXISTE
/embed/r/{empresa}/{coleccion} Estantería incrustable — YA EXISTE
/legal/privacidad               NUEVA — bloqueada por gate §2.6
/legal/terminos                 NUEVA — bloqueada por gate §2.6
```
\* "estadísticas" en el paso 4 es aspiracional mientras L6 no esté construido (§6); si L6 sigue
pendiente al llegar aquí, ese paso se describe sin cifra ("mide quién lee tu revista") en vez de
mostrar un número inventado.

### 4.2 Entregables
- Sección "Cómo funciona" con los pasos reales del producto (nada que el producto no haga hoy).
- Sección de precios/planes o mejora del formulario de propuesta, según la opción elegida en §1.
- Sección de cliente(s) real(es) autorizados — sin placeholders de logos inventados: si no hay
  autorización, la sección se omite, no se rellena con marcas falsas.
- Páginas `/legal/privacidad` y `/legal/terminos`, enlazadas desde el footer de **toda la
  plataforma** (landing + panel interno), con el texto que apruebe el revisor del gate §2.6.
- Ajuste de todo el copy a la variante de idioma decidida (gate §2.5).

### 4.3 Criterios de aceptación
- [ ] Cero contenido inventado: todo logo, cifra o testimonio visible corresponde a un dato real
      aprobado por Carlos.
- [ ] El formulario de propuesta B2B sigue entregando el correo (verificar con SMTP IONOS tras el
      cambio de copy).
- [ ] Páginas legales accesibles desde cualquier punto de la plataforma, no solo la landing.
- [ ] Si se implementa precios (B/C): los montos coinciden exactamente con lo decidido por Carlos
      en MXN **y** EUR, y los límites publicados coinciden con `plans.features` en BD (no
      prometer algo que el backend no aplica).

**Tamaño:** L (varias sesiones). **Bloqueo:** gate del §2 completo.

## 5. Fase 3 — Conversión, SEO y pulido

**Depende de la Fase 2 y, para las métricas sociales, de L6.**

- Métricas reales de uso en la landing (nº de ediciones publicadas, lecturas) **solo si L6**
  (estadísticas sin cookies, `views_count`) ya está construido — ver `PLAN-SIGUIENTES-LOTES.md`
  §6. Mientras no exista, no se muestra ningún número.
- SEO on-page: ya hay SEO 100 en Lighthouse y OG 1200×630 (L7a); verificar/crear `sitemap.xml` y
  `robots.txt` si no existen; structured data `Organization`/`Product` en el `<head>` de la
  landing. Coordinar con el proyecto `posicionamiento-ia` (SEO/GEO de Cetrix) para no duplicar
  criterios ni contradecir la estrategia de marca ya definida ahí.
- Revisar el CTA principal (login vs. propuesta vs. precios) según la opción elegida en §1.
- Si se decide ofrecer "dominio propio" como gancho comercial en la propia landing: el diseño ya
  existe en `docs/dominios-propios.md` (Lote D, nada construido aún) — evaluar si se menciona en
  la landing antes o después de construirlo (no anunciar una función que no existe).

### Criterios de aceptación
- [ ] Lighthouse SEO se mantiene en 100 y Rendimiento ≥ 90 en todas las rutas públicas (landing,
      colección, lector).
- [ ] `sitemap.xml` y `robots.txt` verificados y correctos.
- [ ] Ninguna cifra mostrada es inventada; si no hay dato real, no se muestra la sección.

**Tamaño:** M.

## 6. Resumen de secuencia y dependencias

| Fase | Depende de | Bloqueada por decisión de Carlos | Tamaño |
|---|---|---|---|
| 1. Rendimiento/accesibilidad | Nada (ya en PROD) | No — se puede empezar ya | S |
| 2. Contenido comercial completo | Fase 1 (recomendado, no estricto) | **Sí** — gate del §2 (6 puntos) | L |
| 3. Conversión/SEO/pulido | Fase 2; métricas reales dependen de L6 | Parcialmente (CTA depende de §1) | M |

**Siguiente paso inmediato:** arrancar la Fase 1 (no requiere nada de Carlos) y, en paralelo,
presentarle el gate de 6 decisiones del §2 — empezando por la contradicción del modelo comercial
(§1), que es la que más condiciona el diseño de la Fase 2.
