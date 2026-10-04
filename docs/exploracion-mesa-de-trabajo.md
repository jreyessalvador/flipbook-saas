# Exploración — Mesa de trabajo (pasteboard) en el editor

**Estado:** solo exploración, NO se implementa por ahora (decisión de Carlos, 04-oct-2026).
**Motivo:** el personal que llegue desde InDesign/Joomag está acostumbrado a trabajar con mesa de
trabajo y lo pedirá al cambiarse a Cetrix Revistas. Queda documentado para cuando se priorice.
**Referencia:** vídeo y capturas de Carlos (04-oct-2026): doble hoja con texto, imágenes, logos y
figuras dejados a los lados de la hoja, visibles y a la mano, y arrastrados a cualquiera de las dos
páginas.

## 1. Qué se pide
1. Dejar material (texto, imagen, vídeo, galería, figura, hotspot, embed) **fuera de la hoja**, a la
   vista, sin que se publique.
2. **Pasar elementos de una hoja a otra** arrastrando (izquierda ↔ derecha de la doble hoja).
3. Idealmente, que ese material siga a mano al cambiar de doble hoja (de la pág. 3 a la 15).

## 2. Por qué hoy no se puede (estado del código, commit `20a2574`)
- Cada página es un `Stage` de Konva independiente, del tamaño exacto de la hoja
  (`PageCanvas` en `frontend/src/components/editor/CanvasEditorV2.jsx`): lo que sale del borde no se ve.
- Las flechas del teclado limitan `x/y` a `[0, pageWidth - el.width]` (atajos en `CanvasEditorV2`).
- Cada lado del spread tiene su propia instancia de store (`pageEditorStore.js`): un elemento no
  puede cruzar de un store a otro.
- BD: `page_elements.page_id` es `NOT NULL` → no existe material "sin página".
- No hay deshacer/rehacer en el editor (ni en el store).
- El lector público (`PageViewer`/`FlipBook`) y el render a PDF (`RenderBook.jsx`, `overflow:hidden`)
  pintan un Stage por página, así que recortan visualmente lo que esté fuera; pero los datos fuera
  de hoja SÍ viajarían en el snapshot publicado (p. ej. la lista accesible de hotspots del lector).

## 3. Propuesta por fases (cada una validable en DEV por separado)
| Fase | Alcance | Esfuerzo | Riesgo |
|---|---|---|---|
| **M1 — Mesa visible** | Un solo Stage por vista: doble hoja + margen gris alrededor. Se puede dejar un elemento fuera o medio fuera. Lo que queda fuera no se publica: lector, PDF, miniaturas y OG solo muestran lo que intersecta la hoja (recortado); hotspots/embeds/vídeos totalmente fuera se excluyen del snapshot publicado. Quitar el límite de flechas. **Incluir deshacer/rehacer (Ctrl+Z / Ctrl+Y)**. | 2 días + 1 de deshacer | Medio |
| **M2 — Cruzar entre páginas** | Arrastrar de la página izquierda a la derecha y viceversa; al soltar se decide la página por el centro del elemento y se traslada entre stores convirtiendo coordenadas (`x - pageWidth - gap`). Un solo paso de deshacer. | 1–2 días | Medio |
| **M3 — Mesa compartida de la edición** | Mesa persistente por publicación que acompaña al cambiar de doble hoja (dejo en pág. 3, suelto en pág. 15). Migración nueva: tabla `pasteboard_items` (`publication_id`, `kind`, geometría, `props`, `z_index`, `created_by`) o permitir `page_elements.page_id NULL` + `publication_id`. API CRUD bajo el lock de edición existente (ya cubre la publicación). | 2–3 días | Medio-alto |

**Total estimado:** 5–7 días de trabajo (sin contar validación de Carlos).
**Orden recomendado:** M1 + deshacer → M2 → M3 tras usarlo en DEV.

## 4. Riesgos y mitigaciones
- **Núcleo del editor (~3.400 líneas):** selección, Transformer, marquee, alinear, zoom-ajuste,
  edición de texto inline (posición relativa al Stage), atajos. → Por fases, batería QA nueva por fase.
- **Render PDF en Contabo 2 usa el mismo componente** (`RenderModeContext`). → Mantener intacto el
  modo "solo página"; prueba que verifique que nada de la mesa aparece en PDF ni en el lector.
- **Hotspots fuera de la hoja:** no deben publicarse ni salir en la lista accesible del lector →
  filtrar al publicar (snapshot) y al renderizar.
- **Sin deshacer:** con mesa de trabajo pesa más → incluirlo en M1.
- **Datos:** el lock de edición ya es por publicación; las migraciones solo añaden (rollback simple).

## 5. Copiar y pegar texto (revisado en la misma exploración)
Ya funciona: doble clic en el texto → editor inline (`openInlineTextEditor`) → Ctrl+V nativo
(los atajos del editor se ignoran dentro de un TEXTAREA); la altura crece sola al confirmar.
Límites conocidos (Carlos decide dejarlo así, 04-oct-2026): se pega como texto plano; el texto de PDF
trae saltos por renglón; Ctrl+V sobre la hoja sin caja abierta no crea un texto nuevo.
Mejoras posibles si algún día se piden: Ctrl+V de texto del sistema → caja nueva; imagen del
portapapeles → subir e insertar; opción «Unir líneas» y limpieza de caracteres de Word.
