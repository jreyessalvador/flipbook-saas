import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useParams, useNavigate } from 'react-router-dom';
import Konva from 'konva';
import { Stage, Layer, Rect, Ellipse, Line, Star, Path, Group, Text as KonvaText, Image as KonvaImage, Transformer } from 'react-konva';
import { Html } from 'react-konva-utils';
import { createPageEditorStore } from '../../store/pageEditorStore';
import { publicationAPI } from '../../services/publicationAPI';
import { pageAPI } from '../../services/pageAPI';
import { assetAPI } from '../../services/assetAPI';
import { lockAPI } from '../../services/lockAPI';
import { API_URL } from '../../services/api';
import '../../styles/CanvasEditorV2.css';

// Fase B -- editor canvas (image/text/shape) + shell de UI de dos paneles
// inspirado en Photoshop/Joomag (sin copiarlos), ver
// docs/arquitectura-editor-2026-09-12.md secciones 4-6 y RECETA-DESARROLLO.md
// sección 8. Herramientas marcadas "próximamente" son placeholders visuales:
// Hotspot y Blocks -- quedan para lotes siguientes (Blocks se evaluo para
// este mismo lote y se decidio dejarlo fuera, ver RECETA-DESARROLLO.md),
// no bloquean lo ya verificado.
// Línea/Círculo/Estrella y Alinear/Distribuir (con selección múltiple,
// Lote 1), Plugins/shortcodes de texto (Lote 2), Audio (Lote 3),
// Galería/Collage/GIF (Lote 4), YouTube/Vimeo (Lote 5), SoundCloud +
// Quick Actions (Lote 6) y Video real + Library (Lote 7) SÍ son
// funcionales.
// Video (Lote 7): subida real de archivo (mp4/webm/mov) via el mismo
// patron que Audio -- kind='video', props={src, autoplay, loop, muted},
// placeholder en canvas (ver VideoElement), <video controls> nativo en el
// panel de propiedades. Library (Lote 7): biblioteca de assets del TENANT
// (tabla `assets`, poblada por primera vez en este lote desde
// POST /api/assets/upload) -- permite reutilizar imagenes/audio/video ya
// subidos sin volver a subir el archivo; ver GET /api/assets y el popover
// abierto por el boton "Library" del rail mas abajo.
// GIF reutiliza kind='image' (Konva no anima GIFs -- limitación conocida,
// ver RECETA-DESARROLLO.md); Galería y Collage comparten kind='gallery' y
// solo difieren en props.layout ('grid'/'mosaic'), intercambiable después
// desde el panel de propiedades. YouTube/Vimeo/SoundCloud usan kind='embed'
// -- ver parseVideoUrl()/EmbedElement más abajo: en el canvas se muestra un
// placeholder (Konva no puede reproducir un iframe/audio embebido), la
// reproducción real queda diferida al Reader (Fase E). SoundCloud se
// modeló como un tercer 'provider' de este mismo kind, en vez de un
// PageElementKind nuevo -- conceptualmente es lo mismo (URL externa, sin
// archivo que subir, mismo placeholder+enlace) y evita otra migración de
// CHECK CONSTRAINT en Postgres; ver comentario extenso junto a
// parseVideoUrl() sobre cómo se extrae el id de una URL de SoundCloud
// (sin id numérico, a diferencia de YouTube/Vimeo).
//
// VISTA DE HOJA DOBLE (spread) -- añadido en esta ronda por pedido explícito
// de Carlos: se retiró la barra lateral con la lista larga de páginas (para
// ganar espacio de canvas) y se sustituyó por un encabezado compacto arriba
// y una barra de navegación inferior (Anterior/Siguiente + salto manual por
// número de página). Las páginas interiores se muestran de a DOS (spread),
// portada y contraportada siempre solas. AMBAS páginas de un spread son
// independiente y SIMULTÁNEAMENTE editables (decisión explícita de Carlos:
// "Ambas editables simultáneamente", como InDesign) -- esto exigió que
// pageEditorStore.js deje de ser un singleton y pase a ser una fábrica
// (createPageEditorStore()): este componente crea dos instancias estables
// (storeLeftHook/storeRightHook) y el bloque de render de una página se
// extrajo a <PageCanvas> para no duplicar código entre ambos lados.

const PX_PER_MM = 3; // escala fija de visualización, no afecta a los datos guardados (siempre en "unidades de página")
const HEARTBEAT_MS = 20000; // el lock expira a los 60s sin heartbeat (backend/app/api/locks.py)

// --- Iconos ------------------------------------------------------------
// SVGs propios, trazo simple, deliberadamente distintos de los glifos de
// Photoshop/Joomag -- solo se busca el mismo lenguaje de "panel de iconos".
const ICON_PATHS = {
  select: 'M4 3l7 16 2-6.5L19 10 4 3z',
  hotspot: 'M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z',
  text: 'M4 4h16v3h-6.5v13h-3V7H4V4z',
  line: 'M4 20L20 4',
  rectangle: 'M3 5h18v14H3z',
  circle: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z',
  star: 'M12 2l2.9 6.6 7.1.6-5.4 4.7 1.7 7-6.3-3.9-6.3 3.9 1.7-7-5.4-4.7 7.1-.6L12 2z',
  image: 'M4 4h16v16H4V4zm2 12l3.5-4.5 2.5 3 3.5-4.5L18 16H6z',
  gallery: 'M3 4h12v10H3V4zm4 4h12v10H7V8z',
  gif: 'M3 6h18v12H3V6zm3 3v6M9 9v6h2v-2h1a2 2 0 0 0 0-4H9zm7 0h3M16 12h2M16 9v6',
  collage: 'M3 3h8v8H3V3zm10 0h8v5h-8V3zm0 7h8v11h-8V10zM3 13h8v8H3v-8z',
  youtube: 'M22 12s0-3.2-.4-4.7a2.9 2.9 0 0 0-2-2C17.9 5 12 5 12 5s-5.9 0-7.6.3a2.9 2.9 0 0 0-2 2C2 8.8 2 12 2 12s0 3.2.4 4.7a2.9 2.9 0 0 0 2 2C6.1 19 12 19 12 19s5.9 0 7.6-.3a2.9 2.9 0 0 0 2-2C22 15.2 22 12 22 12zM10 15.5v-7l6 3.5-6 3.5z',
  vimeo: 'M22 7.4c-.1 2-1.5 4.6-4.1 8-2.7 3.5-5 5.2-6.9 5.2-1.2 0-2.1-1.1-2.9-3.2C7.4 15 6.6 11 5.6 11c-.2 0-.9.4-2.1 1.3L2.6 11c1.4-1.2 2.7-2.5 4-3.7 1.8-1.6 3.1-2.4 4-2.5 2.1-.2 3.4 1.2 3.8 4.3.5 3.3.9 5.3 1.3 6 .3.7.7 1.1 1.2 1.1.4 0 1-.5 1.8-1.5.8-1 1.2-1.8 1.3-2.4.1-1-.3-1.5-1.3-1.5-.5 0-1 .1-1.5.3C18 8 20.2 6.6 22 7.4z',
  audio: 'M11 4L6 8H3v8h3l5 4V4zm5.5 3.5a7 7 0 0 1 0 9m-2.5-7a4 4 0 0 1 0 5',
  video: 'M3 6h13v12H3V6zm13 4l5-3v10l-5-3v-4z',
  soundcloud: 'M3 15v-3M6 16v-6M9 16.5v-8M12 16.5v-9M15 16.5A3.5 3.5 0 0 0 15 9.5v7z',
  plugins: 'M8 4l-4 4 4 4M16 4l4 4-4 4M14 3l-4 18',
  library: 'M4 4h4v16H4V4zm6 1l4-1 3.5 15.5-4 1L10 5zM16 4h4v16h-4V4z',
  blocks: 'M4 4h6v6H4V4zm10 0h6v6h-6V4zM4 14h6v6H4v-6zm10 0h6v6h-6v-6z',
  alignLeft: 'M4 3v18M8 6h12M8 12h8M8 18h12',
  alignCenterH: 'M12 3v18M6 7h12M8 12h8M6 17h12',
  alignRight: 'M20 3v18M4 6h12M8 12h8M4 18h12',
  alignTop: 'M3 4h18M6 8v12M12 8v8M18 8v12',
  alignMiddleV: 'M3 12h18M7 6h4M13 6h4M7 18h4M13 18h4',
  alignBottom: 'M3 20h18M6 4v12M12 8v8M18 4v12',
  distributeH: 'M4 4v16M12 4v16M20 4v16M8 12h1M15 12h1',
  distributeV: 'M4 4h16M4 12h16M4 20h16M12 8v1M12 15v1',
  chevronLeft: 'M15 4l-8 8 8 8',
  chevronRight: 'M9 4l8 8-8 8',
  // Orden de capas (Lote UX-5) -- iconos de rectangulos apilados, estilo
  // convencional de "traer al frente/enviar al fondo" de cualquier editor
  // de diseño.
  bringFront: 'M7 3h10v10H7V3zM4 8v10h10',
  sendBack: 'M4 8h10v10H4V8zM7 3h10v10',
  layerUp: 'M12 3l5 5h-3v5h-4V8H7l5-5zM6 17h12',
  layerDown: 'M12 3v9h3l-5 5-5-5h3V3zM6 21h12',
};

function Icon({ name, size = 18 }) {
  const d = ICON_PATHS[name];
  if (!d) return null;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

function ToolButton({ icon, label, active, disabled, onClick, comingSoon }) {
  const title = comingSoon ? `${label} (próximamente)` : label;
  return (
    <button
      type="button"
      className={`editor-v2-tool${active ? ' active' : ''}${comingSoon ? ' coming-soon' : ''}`}
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon name={icon} />
    </button>
  );
}

function ToolGroup({ children }) {
  return <div className="editor-v2-tool-group">{children}</div>;
}

// Popover "anclado" que se saca del flujo del rail via un Portal a
// document.body y se posiciona con coordenadas de VIEWPORT (position:fixed),
// nunca con position:absolute dentro del propio rail. Bug real reportado por
// Carlos con captura: el rail de herramientas (.editor-v2-tools-rail) tiene
// `overflow-y: auto` -- y por una regla de la spec de CSS, cuando un eje de
// overflow es distinto de "visible" el OTRO eje deja de comportarse como
// "visible" tambien (aunque no se haya declarado overflow-x explicitamente),
// asi que cualquier popover más ancho que el rail (240px de ancho contra un
// rail de solo 56px) quedaba RECORTADO por el propio rail en vez de flotar
// por encima -- por eso a Carlos se le veia "la ventana oculta fuera del
// alcance visual" al abrir el popover de YouTube (un boton que, ademas,
// queda bastante abajo en un rail alto con muchos grupos de herramientas,
// asi que el recorte era aun mas notorio). Los tests Playwright existentes
// nunca lo detectaron porque interactuan con el DOM directamente sin
// verificar si el elemento es visualmente clipeado por overflow.
// Se posiciona en 2 pasadas: 1) al abrir, coloca el popover pegado al borde
// derecho del boton que lo activo (misma altura); 2) tras el primer render
// (useLayoutEffect corre después de que el DOM ya está pintado), mide su
// propio tamaño real y lo reacomoda si se sale del viewport -- lo voltea a
// la izquierda del boton si no cabe a la derecha, y lo pega al borde inferior
// (o superior) del viewport si no cabe verticalmente. También se reubica en
// resize/scroll mientras está abierto (con capture:true, porque el scroll
// que más le afecta es el del propio rail, un contenedor interno, no el de
// window).
function RailPopover({ anchorRef, className, children }) {
  const popRef = useRef(null);
  const [style, setStyle] = useState({ position: 'fixed', top: -9999, left: -9999, visibility: 'hidden' });

  useLayoutEffect(() => {
    const place = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const anchorRect = anchor.getBoundingClientRect();
      const margin = 8;
      let top = anchorRect.top;
      let left = anchorRect.right + margin;
      const pop = popRef.current;
      if (pop) {
        const popRect = pop.getBoundingClientRect();
        if (left + popRect.width > window.innerWidth - margin) {
          // No cabe a la derecha del boton -- se voltea a la izquierda.
          left = Math.max(margin, anchorRect.left - popRect.width - margin);
        }
        if (top + popRect.height > window.innerHeight - margin) {
          top = Math.max(margin, window.innerHeight - popRect.height - margin);
        }
        if (top < margin) top = margin;
      }
      setStyle({ position: 'fixed', top, left, visibility: 'visible' });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchorRef, children]);

  return createPortal(
    <div ref={popRef} className={className} style={style}>
      {children}
    </div>,
    document.body,
  );
}


// Lote UX-10 (13-sep-2026): modal "Propiedades de la galería", inspirado
// en el modal de referencia que usa Carlos habitualmente (Upload/
// "Seleccionar de biblioteca", lista de imágenes con Título/Descripción,
// modo de imagen, efecto de transición, activar leyendas/controles/
// autoplay, duración de transición). Cambios en STAGING local (useState)
// -- solo se aplican al elemento real via onSave() al presionar
// "Actualizar"; "Cancelar" descarta todo. Reutiliza el mismo <RailPopover>
// -- no, este es un modal centrado (no un popover de rail) -- via
// createPortal directo a document.body con backdrop propio.
function GalleryModal({ el, onClose, onSave, libraryImages, libraryLoading, onUploadFiles }) {
  const [images, setImages] = useState(() =>
    (el.props?.images || []).map((img) => ({ src: img.src, title: img.title || '', description: img.description || '' })),
  );
  const [imageMode, setImageMode] = useState(el.props?.image_mode || 'crop');
  const [transitionEffect, setTransitionEffect] = useState(el.props?.transition_effect || 'fade');
  const [captionsEnabled, setCaptionsEnabled] = useState(!!el.props?.captions_enabled);
  const [controlsEnabled, setControlsEnabled] = useState(el.props?.controls_enabled !== false);
  const [autoplay, setAutoplay] = useState(el.props?.autoplay !== false);
  const [transitionDuration, setTransitionDuration] = useState(el.props?.transition_duration ?? 3);
  const [showLibrary, setShowLibrary] = useState(false);
  const [uploading, setUploading] = useState(false);
  const uploadInputRef = useRef(null);

  const updateImageField = (i, field, value) =>
    setImages((prev) => prev.map((img, idx) => (idx === i ? { ...img, [field]: value } : img)));
  const removeImage = (i) => setImages((prev) => prev.filter((_, idx) => idx !== i));
  const addImagesFromUrls = (urls) => setImages((prev) => [...prev, ...urls.map((src) => ({ src, title: '', description: '' }))]);

  const handleUploadChange = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length === 0) return;
    setUploading(true);
    try {
      const urls = await onUploadFiles(files);
      if (urls.length > 0) addImagesFromUrls(urls);
    } finally {
      setUploading(false);
    }
  };

  const handleUpdate = () => {
    onSave({
      images,
      image_mode: imageMode,
      transition_effect: transitionEffect,
      captions_enabled: captionsEnabled,
      controls_enabled: controlsEnabled,
      autoplay,
      transition_duration: Math.max(0.5, Number(transitionDuration) || 3),
    });
  };

  return createPortal(
    <div className="editor-v2-modal-backdrop" onMouseDown={onClose}>
      <div className="editor-v2-modal-gallery" onMouseDown={(e) => e.stopPropagation()}>
        <div className="editor-v2-modal-header">
          <h3>Propiedades de la galería</h3>
          <button type="button" className="editor-v2-modal-close" onClick={onClose} aria-label="Cerrar">×</button>
        </div>
        <div className="editor-v2-modal-body">
          <div className="editor-v2-modal-actions-row">
            <button type="button" className="editor-v2-quickaction" disabled={uploading} onClick={() => uploadInputRef.current?.click()}>
              {uploading ? 'Subiendo…' : 'Subir imágenes'}
            </button>
            <input type="file" accept="image/*" multiple ref={uploadInputRef} style={{ display: 'none' }} onChange={handleUploadChange} />
            <button type="button" className="editor-v2-quickaction" onClick={() => setShowLibrary((v) => !v)}>
              {showLibrary ? 'Ocultar biblioteca' : 'Seleccionar de biblioteca'}
            </button>
          </div>
          {showLibrary && (
            <div className="editor-v2-modal-library">
              {libraryLoading && <p className="editor-v2-props-hint">Cargando biblioteca…</p>}
              {!libraryLoading && libraryImages.length === 0 && (
                <p className="editor-v2-props-hint">No hay imágenes en la biblioteca de este tenant todavía.</p>
              )}
              {!libraryLoading && libraryImages.length > 0 && (
                <ul className="editor-v2-library-grid">
                  {libraryImages.map((asset) => (
                    <li key={asset.id}>
                      <button
                        type="button"
                        className="editor-v2-library-item"
                        title="Agregar a la galería"
                        onClick={() => addImagesFromUrls([asset.url])}
                      >
                        <img src={asset.url?.startsWith('http') ? asset.url : `${API_URL}${asset.url}`} alt="" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <ul className="editor-v2-modal-image-list">
            {images.map((img, i) => (
              <li key={`${img.src}-${i}`} className="editor-v2-modal-image-row">
                <img src={img.src?.startsWith('http') ? img.src : `${API_URL}${img.src}`} alt="" />
                <div className="editor-v2-modal-image-fields">
                  <input type="text" placeholder="Título" value={img.title} onChange={(e) => updateImageField(i, 'title', e.target.value)} />
                  <input type="text" placeholder="Descripción" value={img.description} onChange={(e) => updateImageField(i, 'description', e.target.value)} />
                </div>
                <button type="button" className="editor-v2-gallery-thumb-remove" title="Quitar" onClick={() => removeImage(i)}>×</button>
              </li>
            ))}
            {images.length === 0 && <p className="editor-v2-props-hint">Sin imágenes -- sube o selecciona de la biblioteca.</p>}
          </ul>

          <div className="editor-v2-field-grid">
            <label className="editor-v2-field">
              <span>Modo de imagen</span>
              <select value={imageMode} onChange={(e) => setImageMode(e.target.value)}>
                <option value="crop">Recortar</option>
                <option value="fit">Ajustar</option>
              </select>
            </label>
            <label className="editor-v2-field">
              <span>Efecto de transición</span>
              <select value={transitionEffect} onChange={(e) => setTransitionEffect(e.target.value)}>
                <option value="fade">Fundido</option>
                <option value="slide">Deslizar</option>
                <option value="none">Ninguno</option>
              </select>
            </label>
            <label className="editor-v2-field">
              <span>Duración de transición (s)</span>
              <input type="number" min="0.5" step="0.5" value={transitionDuration} onChange={(e) => setTransitionDuration(e.target.value)} />
            </label>
          </div>
          <div className="editor-v2-modal-checkboxes">
            <label><input type="checkbox" checked={captionsEnabled} onChange={(e) => setCaptionsEnabled(e.target.checked)} /> Activar leyendas</label>
            <label><input type="checkbox" checked={controlsEnabled} onChange={(e) => setControlsEnabled(e.target.checked)} /> Activar controles</label>
            <label><input type="checkbox" checked={autoplay} onChange={(e) => setAutoplay(e.target.checked)} /> Reproducción automática</label>
          </div>
        </div>
        <div className="editor-v2-modal-footer">
          <button type="button" className="editor-v2-tool" onClick={onClose}>Cancelar</button>
          <button type="button" className="editor-v2-save" onClick={handleUpdate}>Actualizar</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function useHtmlImage(src) {
  const [image, setImage] = useState(null);
  useEffect(() => {
    if (!src) {
      setImage(null);
      return;
    }
    let cancelled = false;
    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    img.src = src.startsWith('http') ? src : `${API_URL}${src}`;
    img.onload = () => {
      if (!cancelled) setImage(img);
    };
    return () => {
      cancelled = true;
    };
  }, [src]);
  return image;
}

// Para formas cuyo x/y en nuestro modelo de datos es la esquina superior
// izquierda (igual que Rect/Image/Text): tras escalar, resetea el scale a 1
// y traduce el resultado a width/height reales.
function handleTransformEnd(node, onChange) {
  const scaleX = node.scaleX();
  const scaleY = node.scaleY();
  node.scaleX(1);
  node.scaleY(1);
  onChange({
    x: node.x(),
    y: node.y(),
    width: Math.max(10, node.width() * scaleX),
    height: Math.max(10, node.height() * scaleY),
    rotation_deg: node.rotation(),
  });
}

// Para formas cuyo nodo Konva usa x/y como CENTRO (Ellipse, Star) -- hay que
// convertir de vuelta a esquina superior izquierda antes de guardar, o el
// elemento "saltaría" de posición en el siguiente render (bug real evitado
// aquí, no solo cosmético: sin esto, redimensionar/rotar un círculo movía su
// esquina al punto donde antes estaba su centro).
function handleTransformEndCentered(node, onChange) {
  const scaleX = node.scaleX();
  const scaleY = node.scaleY();
  node.scaleX(1);
  node.scaleY(1);
  const newWidth = Math.max(10, node.width() * scaleX);
  const newHeight = Math.max(10, node.height() * scaleY);
  onChange({
    x: node.x() - newWidth / 2,
    y: node.y() - newHeight / 2,
    width: newWidth,
    height: newHeight,
    rotation_deg: node.rotation(),
  });
}

// Lote UX-4 (13-sep-2026): brillo/contraste + esquinas redondeadas en
// imagenes. `cornerRadius` lo soporta Konva.Image de forma nativa desde
// hace varias versiones (igual que Rect), asi que NO hace falta un
// clipFunc a mano. Brillo/contraste SI requieren `node.cache()` -- los
// filtros de Konva solo se aplican sobre un cache de pixeles de la propia
// imagen, nunca en tiempo real sin cachear -- por eso el useEffect: hay
// que re-cachear cada vez que cambia la imagen fuente, el tamaño (afecta
// el area cacheada) o los propios valores de brillo/contraste; sin este
// efecto los sliders del panel de propiedades no tendrian ningun efecto
// visible tras la primera carga.
function ImageElement({ el, canEdit, onSelect, onChange, shapeRef }) {
  const image = useHtmlImage(el.props?.src);
  const nodeRef = useRef(null);
  const brightness = el.props?.brightness || 0; // Konva.Filters.Brighten: rango util aprox -1..1
  const contrast = el.props?.contrast || 0; // Konva.Filters.Contrast: rango util aprox -100..100
  const hasAdjustments = brightness !== 0 || contrast !== 0;

  useEffect(() => {
    const node = nodeRef.current;
    if (!node || !image) return;
    if (hasAdjustments) {
      node.cache();
    } else {
      node.clearCache();
    }
    node.getLayer()?.batchDraw();
  }, [image, brightness, contrast, el.width, el.height, hasAdjustments]);

  return (
    <KonvaImage
      ref={(node) => {
        nodeRef.current = node;
        if (typeof shapeRef === 'function') shapeRef(node);
        else if (shapeRef) shapeRef.current = node;
      }}
      image={image}
      x={el.x}
      y={el.y}
      width={el.width}
      height={el.height}
      rotation={el.rotation_deg}
      cornerRadius={el.props?.cornerRadius || 0}
      filters={hasAdjustments ? [Konva.Filters.Brighten, Konva.Filters.Contrast] : []}
      brightness={brightness}
      contrast={contrast}
      draggable={canEdit && !el.props?.locked}
      onClick={onSelect}
      onTap={onSelect}
      onDragEnd={(e) => onChange({ x: e.target.x(), y: e.target.y() })}
      onTransformEnd={(e) => handleTransformEnd(e.target, onChange)}
    />
  );
}

// Elemento de audio (Lote 3): en el canvas se representa con un icono fijo
// (Group con fondo + icono de altavoz) -- Konva no puede reproducir audio,
// asi que la reproduccion real de PRUEBA se ofrece en el panel de
// propiedades (ver PropertiesPanel) via un <audio controls> nativo del
// navegador. El overlay <audio> sincronizado sobre el propio canvas
// (como en el Reader final, Fase E) queda fuera de alcance de este lote --
// ver docs/arquitectura-editor-2026-09-12.md seccion 6.
function AudioElement({ el, canEdit, onSelect, onChange, shapeRef }) {
  const accent = '#14213d';
  const src = el.props?.src?.startsWith('http') ? el.props.src : `${API_URL}${el.props?.src || ''}`;
  // Lote UX-7 (13-sep-2026, pedido explicito de Carlos): en modo LECTURA
  // (visor publico -- todavia no existe un Reader separado de Fase E, asi
  // que este es hoy el "frontend" real que ve un lector) se reemplaza el
  // placeholder de Konva por un <audio> NATIVO real, vía react-konva-utils
  // Html -- sincroniza automaticamente posicion/tamaño/rotacion con el
  // scale del Stage (fit-to-screen del Lote UX-3) sin tener que calcularlo
  // a mano, a diferencia del textarea de edicion inline del Lote UX-6 (ahi
  // sí hacia falta porque no existia esta libreria todavia). Honra
  // autoplay/loop guardados desde el panel de propiedades. AVISO
  // (documentado tambien en RECETA-DESARROLLO.md): los navegadores
  // bloquean el autoplay CON SONIDO salvo interaccion previa del usuario
  // -- esto es una politica del navegador, no un bug del editor; si
  // Carlos quiere autoplay garantizado hay que silenciar el audio (no se
  // fuerza aqui para no contradecir en silencio el checkbox "Reproducir
  // automáticamente").
  if (!canEdit) {
    return (
      <Html groupProps={{ x: el.x, y: el.y, width: el.width, height: el.height, rotation: el.rotation_deg }}>
        <audio
          controls
          autoPlay={!!el.props?.autoplay}
          loop={!!el.props?.loop}
          style={{ width: el.width, height: el.height }}
          src={src}
        />
      </Html>
    );
  }
  return (
    <Group
      ref={shapeRef}
      x={el.x}
      y={el.y}
      width={el.width}
      height={el.height}
      rotation={el.rotation_deg}
      draggable={canEdit && !el.props?.locked}
      onClick={onSelect}
      onTap={onSelect}
      onDragEnd={(e) => onChange({ x: e.target.x(), y: e.target.y() })}
      onTransformEnd={(e) => handleTransformEnd(e.target, onChange)}
    >
      <Rect width={el.width} height={el.height} fill="#eef2ff" stroke={accent} strokeWidth={1.5} cornerRadius={8} />
      <Path data={ICON_PATHS.audio} x={14} y={el.height / 2 - 10} scaleX={1.1} scaleY={1.1} stroke={accent} strokeWidth={1.8} />
      <KonvaText text="Audio" x={44} y={el.height / 2 - 8} fontSize={14} fill={accent} />
    </Group>
  );
}

// Elemento de video (Lote 7 -- subida de video real, pedido explicito de
// Carlos: "Tambien permitir subir video real"). Mismo criterio que
// AudioElement: Konva no puede reproducir un archivo de video dentro del
// canvas de forma sencilla y confiable entre navegadores (habria que armar
// un <video> oculto + Konva.Image + requestAnimationFrame sincronizado,
// demasiado alcance para este lote y nunca implementado antes) -- se
// dibuja un placeholder (Group con fondo + icono + etiqueta), igual que
// Audio/Embed. La reproduccion real de PRUEBA vive en el panel de
// propiedades via un <video controls> nativo (ver PropertiesPanel).
function VideoElement({ el, canEdit, onSelect, onChange, shapeRef }) {
  const accent = '#7c3aed';
  const src = el.props?.src?.startsWith('http') ? el.props.src : `${API_URL}${el.props?.src || ''}`;
  // Lote UX-7: mismo criterio que AudioElement de arriba -- en modo
  // LECTURA se reemplaza el placeholder por un <video> nativo real (Html
  // de react-konva-utils), honrando autoplay/loop/muted ya guardados. Con
  // "muted" activo el autoplay SI funciona de forma confiable (asi lo
  // permiten los navegadores); sin silenciar, el navegador puede bloquear
  // el autoplay hasta que el usuario interactue con la pagina -- misma
  // politica que en AudioElement, documentada en RECETA-DESARROLLO.md.
  if (!canEdit) {
    return (
      <Html groupProps={{ x: el.x, y: el.y, width: el.width, height: el.height, rotation: el.rotation_deg }}>
        <video
          controls
          autoPlay={!!el.props?.autoplay}
          loop={!!el.props?.loop}
          muted={!!el.props?.muted}
          playsInline
          style={{ width: el.width, height: el.height, background: '#000' }}
          src={src}
        />
      </Html>
    );
  }
  return (
    <Group
      ref={shapeRef}
      x={el.x}
      y={el.y}
      width={el.width}
      height={el.height}
      rotation={el.rotation_deg}
      draggable={canEdit && !el.props?.locked}
      onClick={onSelect}
      onTap={onSelect}
      onDragEnd={(e) => onChange({ x: e.target.x(), y: e.target.y() })}
      onTransformEnd={(e) => handleTransformEnd(e.target, onChange)}
    >
      <Rect width={el.width} height={el.height} fill="#f5f3ff" stroke={accent} strokeWidth={1.5} cornerRadius={8} />
      <Path data={ICON_PATHS.video} x={el.width / 2 - 20} y={el.height / 2 - 20} scaleX={1.4} scaleY={1.4} stroke={accent} strokeWidth={1.6} />
      <KonvaText text="Video" x={0} y={el.height / 2 + 16} width={el.width} align="center" fontSize={14} fill={accent} />
    </Group>
  );
}

// Galería / Collage (Lote 4): comparten el mismo kind='gallery' y el mismo
// componente -- solo cambia props.layout ('grid': cuadricula uniforme,
// 'mosaic': una imagen grande a la izquierda + el resto apiladas a la
// derecha). Sin reordenar por arrastre en este MVP (agregar/quitar y
// cambiar de layout sí son funcionales).
// Calcula el rectangulo de recorte (en pixeles de la imagen ORIGINAL) que
// reproduce el equivalente de `object-fit: cover` de CSS dentro de Konva.Image
// (que no tiene un modo "cover" nativo -- crop/width/height son literales).
// Usado por el slideshow en vivo del editor (ver GallerySlideLayer) para
// respetar "Image mode: Recortar" igual que ya hace el visor publico via CSS.
function computeCoverCrop(image, boxW, boxH) {
  if (!image || !image.naturalWidth || !image.naturalHeight) return null;
  const imgRatio = image.naturalWidth / image.naturalHeight;
  const boxRatio = boxW / boxH;
  let cropW = image.naturalWidth;
  let cropH = image.naturalHeight;
  if (imgRatio > boxRatio) {
    cropW = image.naturalHeight * boxRatio;
  } else {
    cropH = image.naturalWidth / boxRatio;
  }
  return {
    x: (image.naturalWidth - cropW) / 2,
    y: (image.naturalHeight - cropH) / 2,
    width: cropW,
    height: cropH,
  };
}

function computeGalleryTiles(layout, n, w, h) {
  if (n === 0) return [];
  const gap = 4;
  if (layout === 'mosaic' && n > 1) {
    const leftW = w * 0.6 - gap / 2;
    const rightW = w - leftW - gap;
    const tiles = [{ x: 0, y: 0, width: leftW, height: h }];
    const rest = n - 1;
    const rightH = (h - gap * (rest - 1)) / rest;
    for (let i = 0; i < rest; i++) {
      tiles.push({ x: leftW + gap, y: i * (rightH + gap), width: rightW, height: rightH });
    }
    return tiles;
  }
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const tileW = (w - gap * (cols - 1)) / cols;
  const tileH = (h - gap * (rows - 1)) / rows;
  const tiles = [];
  for (let i = 0; i < n; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    tiles.push({ x: col * (tileW + gap), y: row * (tileH + gap), width: tileW, height: tileH });
  }
  return tiles;
}

// Subcomponente propio por imagen: cada uno con su propio useHtmlImage()
// (hook), para no romper las reglas de hooks cuando cambia la cantidad de
// imágenes de la galería entre renders (mapear el hook directamente dentro
// de GalleryElement violaría esa regla).
function GalleryTile({ src, x, y, width, height }) {
  const image = useHtmlImage(src);
  return <KonvaImage image={image} x={x} y={y} width={width} height={height} listening={false} />;
}

function GallerySlideLayer({ src, width, height, opacity, offsetX, imageMode }) {
  const image = useHtmlImage(src);
  if (!image) return null;
  if (imageMode === 'fit') {
    const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight);
    const w = image.naturalWidth * scale;
    const h = image.naturalHeight * scale;
    return (
      <KonvaImage
        image={image}
        x={offsetX + (width - w) / 2}
        y={(height - h) / 2}
        width={w}
        height={h}
        opacity={opacity}
        listening={false}
      />
    );
  }
  const crop = computeCoverCrop(image, width, height);
  return (
    <KonvaImage
      image={image}
      x={offsetX}
      y={0}
      width={width}
      height={height}
      crop={crop || undefined}
      opacity={opacity}
      listening={false}
    />
  );
}

function GalleryElement({ el, canEdit, onSelect, onChange, shapeRef }) {
  const images = el.props?.images || [];

  // Lote UX-10 (13-sep-2026, pedido explicito de Carlos: la galeria debe
  // comportarse como un slideshow real -- imagenes rotando una a la vez
  // con efecto de transicion, controles y autoplay, como en la plataforma
  // de referencia que usa habitualmente -- ver "Propiedades de la
  // galería" en el panel derecho). Mismo criterio que Audio/Video/Embed
  // (Lote UX-7/UX-9): Konva no puede animar una transicion CSS entre
  // imagenes ni un setInterval de forma practica dentro del canvas -- en
  // modo LECTURA (visor publico) se reemplaza el grid/mosaico ESTATICO
  // (que sigue siendo la vista de EDICION, sin cambios) por un slideshow
  // real en HTML puro via <Html> de react-konva-utils.
  const [slideIndex, setSlideIndex] = useState(0);
  const autoplay = el.props?.autoplay !== false;
  const duration = Math.max(0.5, Number(el.props?.transition_duration) || 3);
  const transitionEffect = el.props?.transition_effect || 'fade';
  const controlsEnabled = el.props?.controls_enabled !== false;
  const captionsEnabled = !!el.props?.captions_enabled;
  const imageMode = el.props?.image_mode || 'crop';

  // Lote UX-11 (13-sep-2026, pedido explicito de Carlos tras observar en
  // vivo la plataforma de referencia -- el elemento de galeria/slideshow
  // ahi ya rota solo DENTRO del propio lienzo de edicion, sin necesidad de
  // publicar ni entrar a un visor aparte): el autoplay corre en AMBOS
  // modos ahora (antes `canEdit ||` lo desactivaba por completo en el
  // editor). El modo LECTURA (mas abajo) sigue usando <Html>/CSS para el
  // crossfade -- aqui, para el modo EDICION, el crossfade se hace con
  // Konva puro (dos <GallerySlideLayer> con opacity animada via
  // requestAnimationFrame) para poder seguir siendo un nodo Konva real
  // -- arrastrable/seleccionable/transformable -- cosa que un <Html> de
  // react-konva-utils no ofrece con la misma fiabilidad que ya usan
  // Audio/Video/Embed en modo edicion (placeholder 100% Konva, nunca DOM).
  const [prevIndex, setPrevIndex] = useState(null);
  const [transitionAlpha, setTransitionAlpha] = useState(1); // 0=recien entrando, 1=transicion terminada

  // Debug hook SOLO dev, mismo patron que window.__pageEditorStore -- deja
  // inspeccionar desde Playwright que el slideshow rota solo dentro del
  // editor sin depender de que las imagenes de prueba tengan colores
  // distintos (ver verify_lote_ux11_gallery_live_editor.js).
  if (import.meta.env.DEV) {
    window.__gallerySlideDebug = window.__gallerySlideDebug || {};
    window.__gallerySlideDebug[el.id] = { slideIndex, autoplay, canEdit };
  }

  useEffect(() => {
    if (!autoplay || images.length <= 1) return undefined;
    const timer = setInterval(() => {
      setSlideIndex((i) => {
        setPrevIndex(i);
        setTransitionAlpha(0);
        return (i + 1) % images.length;
      });
    }, duration * 1000);
    return () => clearInterval(timer);
  }, [autoplay, duration, images.length]);

  useEffect(() => {
    if (slideIndex >= images.length) setSlideIndex(0);
  }, [images.length, slideIndex]);

  // Anima transitionAlpha de 0 -> 1 en ~500ms cada vez que cambia el slide
  // -- SOLO relevante para el render Konva-nativo del modo edicion (el
  // modo lectura sigue animando con `transition` de CSS, no con esto).
  useEffect(() => {
    if (transitionAlpha >= 1) return undefined;
    let raf;
    const start = performance.now();
    const DURATION_MS = 500;
    const tick = (now) => {
      const t = Math.min(1, (now - start) / DURATION_MS);
      setTransitionAlpha(t);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [prevIndex, transitionAlpha < 1]);

  if (!canEdit) {
    if (images.length === 0) return null;
    const safeIndex = slideIndex < images.length ? slideIndex : 0;
    const current = images[safeIndex];
    return (
      <Html groupProps={{ x: el.x, y: el.y, width: el.width, height: el.height, rotation: el.rotation_deg }}>
        <div style={{ position: 'relative', width: el.width, height: el.height, overflow: 'hidden', background: '#000', borderRadius: 4 }}>
          {images.map((img, i) => {
            const src = img.src?.startsWith('http') ? img.src : `${API_URL}${img.src}`;
            const isActive = i === safeIndex;
            const style = {
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              objectFit: imageMode === 'fit' ? 'contain' : 'cover',
              opacity: isActive ? 1 : 0,
              zIndex: isActive ? 2 : 1,
              transition:
                transitionEffect === 'none'
                  ? 'none'
                  : transitionEffect === 'slide'
                  ? 'transform 0.6s ease, opacity 0.6s ease'
                  : 'opacity 0.6s ease',
              transform: transitionEffect === 'slide' ? `translateX(${(i - safeIndex) * 100}%)` : 'none',
            };
            return <img key={`${img.src}-${i}`} src={src} alt={img.title || ''} style={style} />;
          })}
          {captionsEnabled && (current.title || current.description) && (
            <div
              className="editor-v2-gallery-caption"
              style={{ position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 3, background: 'rgba(0,0,0,0.55)', color: '#fff', padding: '6px 10px', fontSize: 12 }}
            >
              {current.title && <strong style={{ display: 'block' }}>{current.title}</strong>}
              {current.description && <span>{current.description}</span>}
            </div>
          )}
          {controlsEnabled && images.length > 1 && (
            <>
              <button
                type="button"
                className="editor-v2-gallery-nav editor-v2-gallery-nav-prev"
                aria-label="Imagen anterior"
                onClick={() => setSlideIndex((i) => (i - 1 + images.length) % images.length)}
              >
                ‹
              </button>
              <button
                type="button"
                className="editor-v2-gallery-nav editor-v2-gallery-nav-next"
                aria-label="Imagen siguiente"
                onClick={() => setSlideIndex((i) => (i + 1) % images.length)}
              >
                ›
              </button>
              <div className="editor-v2-gallery-dots">
                {images.map((_, i) => (
                  <span
                    key={i}
                    className={`editor-v2-gallery-dot ${i === safeIndex ? 'active' : ''}`}
                    onClick={() => setSlideIndex(i)}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      </Html>
    );
  }

  // Modo EDICION -- Lote UX-11: slideshow en vivo con Konva puro (nunca
  // el grid/mosaico estatico de antes), para que se vea rotar dentro del
  // propio lienzo tal como pidio Carlos. `tiles`/`layout`/`computeGalleryTiles`
  // ya no se usan aqui para el render (quedan arriba solo por si algun dia
  // se reintroduce una vista de cuadricula explicita) -- el modo LECTURA
  // (mas arriba) tampoco los usa desde el Lote UX-10, mismo criterio.
  if (images.length === 0) {
    return (
      <Group
        ref={shapeRef}
        x={el.x}
        y={el.y}
        width={el.width}
        height={el.height}
        rotation={el.rotation_deg}
        draggable={canEdit && !el.props?.locked}
        onClick={onSelect}
        onTap={onSelect}
        onDragEnd={(e) => onChange({ x: e.target.x(), y: e.target.y() })}
        onTransformEnd={(e) => handleTransformEnd(e.target, onChange)}
      >
        <Rect width={el.width} height={el.height} fill="#f3f4f6" stroke="#9ca3af" strokeWidth={1} />
        <KonvaText text="Galería vacía -- agrega imágenes desde el panel" x={10} y={el.height / 2 - 8} width={el.width - 20} fontSize={13} fill="#6b7280" />
      </Group>
    );
  }

  const safeIndex = slideIndex < images.length ? slideIndex : 0;
  const safePrevIndex = prevIndex !== null && prevIndex < images.length ? prevIndex : null;
  const inTransition = safePrevIndex !== null && transitionAlpha < 1;
  const current = images[safeIndex];
  const slideOffset = transitionEffect === 'slide' ? el.width : 0;

  return (
    <Group
      ref={shapeRef}
      x={el.x}
      y={el.y}
      width={el.width}
      height={el.height}
      rotation={el.rotation_deg}
      draggable={canEdit && !el.props?.locked}
      onClick={onSelect}
      onTap={onSelect}
      onDragEnd={(e) => onChange({ x: e.target.x(), y: e.target.y() })}
      onTransformEnd={(e) => handleTransformEnd(e.target, onChange)}
    >
      <Rect width={el.width} height={el.height} fill="#000000" cornerRadius={4} />
      {inTransition && (
        <GallerySlideLayer
          src={images[safePrevIndex].src}
          width={el.width}
          height={el.height}
          imageMode={imageMode}
          opacity={transitionEffect === 'none' ? 0 : 1 - transitionAlpha}
          offsetX={transitionEffect === 'slide' ? -slideOffset * transitionAlpha : 0}
        />
      )}
      <GallerySlideLayer
        src={current.src}
        width={el.width}
        height={el.height}
        imageMode={imageMode}
        opacity={!inTransition ? 1 : transitionEffect === 'none' ? 1 : transitionAlpha}
        offsetX={inTransition && transitionEffect === 'slide' ? slideOffset * (1 - transitionAlpha) : 0}
      />
      {captionsEnabled && (current.title || current.description) && (
        <>
          <Rect y={el.height - 28} width={el.width} height={28} fill="rgba(0,0,0,0.55)" listening={false} />
          <KonvaText
            text={[current.title, current.description].filter(Boolean).join(' -- ')}
            x={10}
            y={el.height - 22}
            width={el.width - 20}
            fontSize={12}
            fill="#ffffff"
            listening={false}
          />
        </>
      )}
      {controlsEnabled && images.length > 1 && (
        <>
          <KonvaText
            text="‹"
            x={8}
            y={el.height / 2 - 12}
            fontSize={24}
            fill="#ffffff"
            onClick={(e) => {
              e.cancelBubble = true;
              setPrevIndex(safeIndex);
              setTransitionAlpha(0);
              setSlideIndex((i) => (i - 1 + images.length) % images.length);
            }}
          />
          <KonvaText
            text="›"
            x={el.width - 24}
            y={el.height / 2 - 12}
            fontSize={24}
            fill="#ffffff"
            onClick={(e) => {
              e.cancelBubble = true;
              setPrevIndex(safeIndex);
              setTransitionAlpha(0);
              setSlideIndex((i) => (i + 1) % images.length);
            }}
          />
          {images.map((_, i) => (
            <Ellipse
              key={i}
              x={el.width / 2 - ((images.length - 1) * 12) / 2 + i * 12}
              y={el.height - 10}
              radiusX={3}
              radiusY={3}
              fill={i === safeIndex ? '#ffffff' : 'rgba(255,255,255,0.5)'}
              onClick={(e) => {
                e.cancelBubble = true;
                setPrevIndex(safeIndex);
                setTransitionAlpha(0);
                setSlideIndex(i);
              }}
            />
          ))}
        </>
      )}
    </Group>
  );
}

// --- Embeds de video/audio (Lote 5: YouTube/Vimeo; Lote 6: SoundCloud) --
// parseVideoUrl() es una funcion PURA (sin dependencias de React) que
// reconoce los formatos mas comunes de URL pegados por un usuario y
// devuelve {provider, video_id}, o null si no se reconoce el formato.
// Se guardan TANTO el video_id extraido como la url original pegada por el
// usuario (ver props de kind='embed' en backend/app/schemas/page_element.py)
// para que un futuro embed real en el Reader (Fase E) no tenga que volver a
// parsear nada.
//
// SoundCloud (Lote 6) no tiene un "video_id" numerico simple como
// YouTube/Vimeo -- su iframe de embed real (w.soundcloud.com/player/?url=...)
// solo necesita la URL completa, no un id. Decision de diseno: en vez de
// dejar video_id vacio, se guarda ahi la ruta "usuario/track-slug" (o
// "usuario/sets/playlist-slug") extraida de la URL -- sigue siendo un dato
// util (identifica el track sin volver a parsear la URL completa) aunque no
// sea un id numerico, y reutiliza el mismo campo del panel de propiedades
// sin tener que agregar uno nuevo solo para este proveedor. Se exige al
// menos 2 segmentos de ruta (usuario + algo mas) como validacion minima de
// formato -- no hay nada tan verificable como el id numerico de Vimeo o el
// patron alfanumerico de YouTube, pero rechaza al menos un enlace de
// perfil suelto ("soundcloud.com/usuario") o una URL de otro dominio.
export function parseVideoUrl(input) {
  if (!input || typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  let url;
  try {
    url = new URL(trimmed);
  } catch {
    // El usuario a veces pega sin protocolo ("youtu.be/xxxx") -- se intenta
    // una vez asumiendo https:// antes de rendirse.
    try {
      url = new URL(`https://${trimmed}`);
    } catch {
      return null;
    }
  }

  const host = url.hostname.toLowerCase().replace(/^www\.|^m\./, '');

  if (host === 'youtube.com' || host === 'youtu.be') {
    let videoId = null;
    if (host === 'youtu.be') {
      videoId = url.pathname.split('/').filter(Boolean)[0] || null;
    } else if (url.pathname === '/watch') {
      videoId = url.searchParams.get('v');
    } else if (url.pathname.startsWith('/embed/')) {
      videoId = url.pathname.split('/embed/')[1]?.split('/')[0] || null;
    } else if (url.pathname.startsWith('/shorts/')) {
      videoId = url.pathname.split('/shorts/')[1]?.split('/')[0] || null;
    }
    if (videoId && /^[A-Za-z0-9_-]{6,}$/.test(videoId)) {
      return { provider: 'youtube', video_id: videoId };
    }
    return null;
  }

  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const parts = url.pathname.split('/').filter(Boolean);
    let videoId = null;
    if (host === 'player.vimeo.com' && parts[0] === 'video') {
      videoId = parts[1] || null;
    } else if (host === 'vimeo.com') {
      videoId = parts[0] || null;
    }
    if (videoId && /^\d+$/.test(videoId)) {
      return { provider: 'vimeo', video_id: videoId };
    }
    return null;
  }

  if (host === 'soundcloud.com' || host === 'm.soundcloud.com') {
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length >= 2) {
      return { provider: 'soundcloud', video_id: parts.join('/') };
    }
    return null;
  }

  return null;
}

// En el canvas se representa igual que AudioElement: Konva no puede
// reproducir un iframe real, asi que se dibuja un placeholder (Group con
// fondo + icono del proveedor + etiqueta). La verificacion visual real de
// que la URL apunta al video/track correcto se hace desde el panel de
// propiedades (enlace clicable -- ver PropertiesPanel), no aqui.
const EMBED_PROVIDER_META = {
  youtube: { accent: '#ff0000', label: 'YouTube' },
  vimeo: { accent: '#1ab7ea', label: 'Vimeo' },
  soundcloud: { accent: '#ff5500', label: 'SoundCloud' },
};

// Lote UX-9 (13-sep-2026, reportado por Carlos con captura: "no se
// muestra la miniatura" del embed de YouTube en el visor publico).
// Mismo criterio que Audio/Video (Lote UX-7): en modo LECTURA se
// reemplaza el placeholder de Konva por un <iframe> real embebido del
// proveedor -- el iframe trae su PROPIA miniatura/thumbnail nativa (la
// del video real) sin que nosotros tengamos que descargar/cachear
// ninguna imagen aparte.
const EMBED_IFRAME_SRC = {
  youtube: (videoId) => `https://www.youtube-nocookie.com/embed/${videoId}`,
  vimeo: (videoId) => `https://player.vimeo.com/video/${videoId}`,
  soundcloud: (path) =>
    `https://w.soundcloud.com/player/?url=${encodeURIComponent(`https://soundcloud.com/${path}`)}&color=%23ff5500&auto_play=false&show_comments=false&visual=false`,
};

function EmbedElement({ el, canEdit, onSelect, onChange, shapeRef }) {
  const provider = EMBED_PROVIDER_META[el.props?.provider] ? el.props.provider : 'youtube';
  const { accent, label } = EMBED_PROVIDER_META[provider];

  if (!canEdit && el.props?.video_id) {
    const iframeSrc = EMBED_IFRAME_SRC[provider]?.(el.props.video_id);
    if (iframeSrc) {
      return (
        <Html groupProps={{ x: el.x, y: el.y, width: el.width, height: el.height, rotation: el.rotation_deg }}>
          <iframe
            src={iframeSrc}
            title={label}
            style={{ width: el.width, height: el.height, border: 0, borderRadius: 8, background: '#000' }}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </Html>
      );
    }
  }

  return (
    <Group
      ref={shapeRef}
      x={el.x}
      y={el.y}
      width={el.width}
      height={el.height}
      rotation={el.rotation_deg}
      draggable={canEdit && !el.props?.locked}
      onClick={onSelect}
      onTap={onSelect}
      onDragEnd={(e) => onChange({ x: e.target.x(), y: e.target.y() })}
      onTransformEnd={(e) => handleTransformEnd(e.target, onChange)}
    >
      <Rect width={el.width} height={el.height} fill="#111827" stroke={accent} strokeWidth={1.5} cornerRadius={8} />
      <Path
        data={ICON_PATHS[provider]}
        x={el.width / 2 - 16}
        y={el.height / 2 - 26}
        scaleX={1.4}
        scaleY={1.4}
        stroke={accent}
        strokeWidth={1.6}
      />
      <KonvaText text={label} x={0} y={el.height / 2 + 10} width={el.width} align="center" fontSize={14} fill="#f3f4f6" />
    </Group>
  );
}

// Un solo componente para las 4 variantes de 'shape' (rect/línea/círculo/
// estrella) -- todas comparten el mismo modelo de datos (x, y, width, height
// como caja contenedora) para no duplicar el manejo de arrastre/transformar/
// guardado; solo cambia qué nodo Konva se dibuja dentro de esa caja.
function ShapeElement({ el, canEdit, onSelect, onChange, shapeRef }) {
  const shapeType = el.props?.shape_type || 'rect';
  const fill = el.props?.fill || '#14213d';
  const common = {
    ref: shapeRef,
    rotation: el.rotation_deg,
    draggable: canEdit && !el.props?.locked,
    onClick: onSelect,
    onTap: onSelect,
  };

  if (shapeType === 'line') {
    return (
      <Line
        {...common}
        x={el.x}
        y={el.y}
        width={el.width}
        height={el.height}
        points={[0, el.height / 2, el.width, el.height / 2]}
        stroke={fill}
        strokeWidth={el.props?.strokeWidth || 4}
        hitStrokeWidth={16}
        onDragEnd={(e) => onChange({ x: e.target.x(), y: e.target.y() })}
        onTransformEnd={(e) => handleTransformEnd(e.target, onChange)}
      />
    );
  }

  if (shapeType === 'circle') {
    const rx = el.width / 2;
    const ry = el.height / 2;
    return (
      <Ellipse
        {...common}
        x={el.x + rx}
        y={el.y + ry}
        radiusX={rx}
        radiusY={ry}
        fill={fill}
        onDragEnd={(e) => onChange({ x: e.target.x() - rx, y: e.target.y() - ry })}
        onTransformEnd={(e) => handleTransformEndCentered(e.target, onChange)}
      />
    );
  }

  if (shapeType === 'star') {
    const cx = el.x + el.width / 2;
    const cy = el.y + el.height / 2;
    const outerRadius = Math.min(el.width, el.height) / 2;
    return (
      <Star
        {...common}
        x={cx}
        y={cy}
        width={el.width}
        height={el.height}
        numPoints={5}
        innerRadius={outerRadius / 2}
        outerRadius={outerRadius}
        fill={fill}
        onDragEnd={(e) => onChange({ x: e.target.x() - el.width / 2, y: e.target.y() - el.height / 2 })}
        onTransformEnd={(e) => handleTransformEndCentered(e.target, onChange)}
      />
    );
  }

  // rect (default -- también el valor histórico de Fase B antes de esta ronda)
  return (
    <Rect
      {...common}
      x={el.x}
      y={el.y}
      width={el.width}
      height={el.height}
      cornerRadius={el.props?.cornerRadius || 0}
      fill={fill}
      onDragEnd={(e) => onChange({ x: e.target.x(), y: e.target.y() })}
      onTransformEnd={(e) => handleTransformEnd(e.target, onChange)}
    />
  );
}

// --- Shortcodes de texto (Plugins) --------------------------------------
// Alcance deliberadamente acotado por decision explicita de Carlos: SOLO
// variables de texto plano predefinidas, resueltas en el momento de
// renderizar -- nunca HTML/JS/iframes arbitrarios (superficie de riesgo
// real si algun dia hay multi-tenant self-service). El texto guardado en
// props.text conserva el shortcode SIN resolver (p.ej. "Pagina {{numero_pagina}}")
// -- solo la vista previa en el canvas lo muestra resuelto, para que
// re-editar el texto siga mostrando la plantilla, no el valor de hoy.
const SHORTCODES = [
  { key: 'fecha', label: 'Fecha de hoy', resolve: (ctx) => new Date().toLocaleDateString('es-ES') },
  { key: 'numero_pagina', label: 'Número de página', resolve: (ctx) => String(ctx.pageNumber ?? '') },
  { key: 'total_paginas', label: 'Total de páginas', resolve: (ctx) => String(ctx.totalPages ?? '') },
  { key: 'titulo_publicacion', label: 'Título de la publicación', resolve: (ctx) => ctx.publicationTitle ?? '' },
];

function resolveShortcodes(text, ctx) {
  if (!text) return text;
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key) => {
    const sc = SHORTCODES.find((s) => s.key === key);
    return sc ? sc.resolve(ctx) : match; // shortcode desconocido: se deja tal cual, no se rompe el texto
  });
}

// Edicion INLINE de texto (Lote UX-6, 13-sep-2026): reemplaza el
// window.prompt() original (deuda documentada desde Fase B) por un
// <textarea> real superpuesto directamente sobre el elemento, al estilo
// del propio Konva ("editable text" -- patron oficial de la libreria, ver
// https://konvajs.org/docs/sandbox/Editable_Text.html), no una libreria de
// terceros. El nodo de texto de Konva se oculta mientras se edita para no
// duplicar el texto visualmente; el textarea se posiciona con
// node.getAbsolutePosition() (ya incluye el propio scale del Stage --
// fit-to-screen, ver CanvasEditorV2.css/PX_PER_MM -- asi que NO hay que
// multiplicarlo de nuevo) + el bounding rect del contenedor del Stage
// (funciona igual para el Stage izquierdo o derecho de un spread, cada uno
// con su propio contenedor). Ancho/alto/tamaño de fuente SI se multiplican
// por node.getStage().scaleX() porque esos son valores propios del nodo en
// coordenadas de pagina sin escalar. Sigue editando la PLANTILLA con
// shortcodes sin resolver (p.ej. "{{fecha}}"), no el valor ya resuelto que
// se ve en el canvas -- mismo criterio que antes.
function openInlineTextEditor(node, initialValue, { onCommit, onCancel }) {
  const stage = node.getStage();
  if (!stage) return;
  const stageBox = stage.container().getBoundingClientRect();
  const absPos = node.getAbsolutePosition(); // ya incluye el scale del Stage (fit-to-screen)
  const scale = stage.scaleX() || 1;

  node.hide();
  stage.getLayer && stage.batchDraw && stage.batchDraw();

  const textarea = document.createElement('textarea');
  document.body.appendChild(textarea);
  textarea.value = initialValue;
  textarea.className = 'editor-v2-inline-text-editor';
  textarea.style.position = 'fixed';
  textarea.style.top = `${stageBox.top + absPos.y}px`;
  textarea.style.left = `${stageBox.left + absPos.x}px`;
  textarea.style.width = `${Math.max(node.width() * scale, 40)}px`;
  textarea.style.height = `${Math.max(node.height() * scale, 24)}px`;
  textarea.style.fontSize = `${(node.fontSize() || 24) * scale}px`;
  textarea.style.color = node.fill() || '#111111';
  textarea.style.transform = `rotate(${node.rotation() || 0}deg)`;
  textarea.style.transformOrigin = 'left top';

  let finished = false;
  const finish = (commit) => {
    if (finished) return;
    finished = true;
    document.removeEventListener('mousedown', handleOutsideClick, true);
    if (textarea.parentNode) textarea.parentNode.removeChild(textarea);
    node.show();
    stage.batchDraw();
    if (commit) onCommit(textarea.value);
    else onCancel();
  };

  const handleOutsideClick = (e) => {
    if (e.target !== textarea) finish(true);
  };
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      finish(false);
    } else if (e.key === 'Enter' && !e.shiftKey) {
      // Enter confirma (Shift+Enter inserta salto de linea) -- consistente
      // con el patron de una sola linea que ya tenia el prompt() original;
      // el shortcode puede seguir teniendo texto multilinea si se pega.
      e.preventDefault();
      finish(true);
    }
  });
  // Se registra en la siguiente vuelta del event loop -- si no, el mismo
  // dblclick que abre el editor dispara este listener de inmediato y lo
  // cierra en el acto.
  setTimeout(() => document.addEventListener('mousedown', handleOutsideClick, true), 0);

  textarea.focus();
  textarea.select();
}

function TextElement({ el, canEdit, onSelect, onChange, onEditStart, shapeRef, shortcodeCtx }) {
  const nodeRef = useRef(null);
  const handleEdit = () => {
    if (!canEdit || !nodeRef.current) return;
    onEditStart?.(); // deselecciona el elemento -- oculta el Transformer mientras se edita
    openInlineTextEditor(nodeRef.current, el.props?.text || '', {
      onCommit: (next) => onChange({ props: { ...el.props, text: next } }),
      onCancel: () => {},
    });
  };
  const displayText = resolveShortcodes(el.props?.text || 'Texto', shortcodeCtx || {});
  return (
    <KonvaText
      ref={(node) => {
        nodeRef.current = node;
        if (typeof shapeRef === 'function') shapeRef(node);
        else if (shapeRef) shapeRef.current = node;
      }}
      x={el.x}
      y={el.y}
      width={el.width}
      height={el.height}
      rotation={el.rotation_deg}
      text={displayText}
      fontSize={el.props?.fontSize || 24}
      fill={el.props?.fill || '#111111'}
      draggable={canEdit && !el.props?.locked}
      onClick={onSelect}
      onTap={onSelect}
      onDblClick={handleEdit}
      onDblTap={handleEdit}
      onDragEnd={(e) => onChange({ x: e.target.x(), y: e.target.y() })}
      onTransformEnd={(e) => handleTransformEnd(e.target, onChange)}
    />
  );
}

// --- Panel derecho: propiedades del elemento seleccionado ---------------
function NumberField({ label, value, disabled, onCommit, step = 1 }) {
  const [draft, setDraft] = useState(value ?? '');
  useEffect(() => setDraft(value ?? ''), [value]);
  return (
    <label className="editor-v2-field">
      <span>{label}</span>
      <input
        type="number"
        step={step}
        value={draft}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const n = parseFloat(draft);
          if (!Number.isNaN(n)) onCommit(n);
        }}
      />
    </label>
  );
}

// Igual que NumberField pero para texto libre (Lote 6 -- nombre del
// elemento en Quick Actions > Configuración del elemento): confirma con
// onBlur, no en cada tecla, para no disparar un updateElement por letra.
function TextField({ label, value, disabled, onCommit, placeholder }) {
  const [draft, setDraft] = useState(value ?? '');
  useEffect(() => setDraft(value ?? ''), [value]);
  return (
    <label className="editor-v2-field">
      <span>{label}</span>
      <input
        type="text"
        value={draft}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => onCommit(draft)}
      />
    </label>
  );
}

// Iconos del renglón "Alinear y distribuir" -- alinear necesita 2+
// elementos seleccionados, distribuir necesita 3+ (con solo 2 no hay nada
// intermedio que espaciar).
const ALIGN_ROW_ICONS = ['alignLeft', 'alignCenterH', 'alignRight', 'distributeH', 'alignTop', 'alignMiddleV', 'alignBottom', 'distributeV'];
const DISTRIBUTE_ICONS = new Set(['distributeH', 'distributeV']);

// Lote 6 -- Quick Actions > Animar: solo guarda la preferencia en
// props.animation, NO implementa la animación real (eso es Fase E, cuando
// exista el Reader que pueda reproducirla) -- mismo criterio que el resto
// de "limitaciones conocidas" documentadas en este archivo (GIF/Konva,
// iframe de embeds, etc.).
const ANIMATION_OPTIONS = [
  { value: 'none', label: 'Ninguna' },
  { value: 'fade', label: 'Aparecer (fade)' },
  { value: 'slide-up', label: 'Deslizar desde abajo' },
  { value: 'slide-left', label: 'Deslizar desde la izquierda' },
  { value: 'zoom', label: 'Zoom' },
];

function PropertiesPanel({ selectedElements, canEdit, onUpdate, onAlign, onAppendImagesClick, onOpenGalleryModal, onReorder }) {
  const count = selectedElements.length;
  const selectedElement = count === 1 ? selectedElements[0] : null;
  const disabled = !canEdit || !selectedElement;
  const kind = selectedElement?.kind;
  const shapeType = selectedElement?.props?.shape_type || 'rect';

  // Popover propio de "Configuración del elemento" (Lote 6) -- se cierra
  // solo al cambiar de elemento seleccionado, para no dejarlo abierto
  // mostrando los datos de un elemento que ya no está seleccionado.
  const [settingsOpen, setSettingsOpen] = useState(false);
  useEffect(() => setSettingsOpen(false), [selectedElement?.id]);

  return (
    <aside className="editor-v2-properties">
      <div className="editor-v2-props-header">
        {count === 0 && 'Ningún elemento seleccionado'}
        {count === 1 && `Elemento: ${kind === 'image' ? 'Imagen' : kind === 'text' ? 'Texto' : kind === 'audio' ? 'Audio' : kind === 'video' ? 'Video' : kind === 'gallery' ? (selectedElement?.props?.layout === 'mosaic' ? 'Collage' : 'Galería') : kind === 'embed' ? (EMBED_PROVIDER_META[selectedElement?.props?.provider]?.label || 'YouTube') : 'Figura'}${selectedElement?.props?.element_name ? ` (${selectedElement.props.element_name})` : ''}`}
        {count > 1 && `${count} elementos seleccionados`}
      </div>

      <section className="editor-v2-props-section">
        <h4>Alinear y distribuir</h4>
        <div className="editor-v2-align-row">
          {ALIGN_ROW_ICONS.map((icon) => {
            const needs = DISTRIBUTE_ICONS.has(icon) ? 3 : 2;
            const enabled = canEdit && count >= needs;
            return (
              <button
                key={icon}
                type="button"
                className="editor-v2-tool"
                disabled={!enabled}
                title={enabled ? undefined : `Requiere ${needs}+ elementos seleccionados`}
                onClick={() => onAlign(icon)}
              >
                <Icon name={icon} size={16} />
              </button>
            );
          })}
        </div>
      </section>

      {count > 1 ? (
        <section className="editor-v2-props-section">
          <p className="editor-v2-props-hint">
            Selecciona un único elemento para ver Transformar/Apariencia -- usa Alinear y distribuir arriba para mover varios a la vez.
          </p>
        </section>
      ) : (
        <>
          <section className="editor-v2-props-section">
            <h4>Transformar</h4>
            <div className="editor-v2-field-grid">
              <NumberField label="X" value={selectedElement?.x} disabled={disabled} onCommit={(n) => onUpdate({ x: n })} />
              <NumberField label="Y" value={selectedElement?.y} disabled={disabled} onCommit={(n) => onUpdate({ y: n })} />
              <NumberField label="Ancho" value={selectedElement?.width} disabled={disabled} onCommit={(n) => onUpdate({ width: Math.max(1, n) })} />
              <NumberField label="Alto" value={selectedElement?.height} disabled={disabled} onCommit={(n) => onUpdate({ height: Math.max(1, n) })} />
              <NumberField label="Rotación°" value={selectedElement?.rotation_deg} disabled={disabled} onCommit={(n) => onUpdate({ rotation_deg: n })} />
            </div>
          </section>

          <section className="editor-v2-props-section">
            <h4>Apariencia</h4>
            {(kind === 'shape' || kind === 'text') && (
              <label className="editor-v2-field">
                <span>Color</span>
                <input
                  type="color"
                  disabled={disabled}
                  value={selectedElement?.props?.fill || '#14213d'}
                  onChange={(e) => onUpdate({ props: { ...selectedElement.props, fill: e.target.value } })}
                />
              </label>
            )}
            {(kind === 'image' || (kind === 'shape' && shapeType === 'rect')) && (
              <NumberField
                label="Radio de esquina"
                value={selectedElement?.props?.cornerRadius || 0}
                disabled={disabled}
                onCommit={(n) => onUpdate({ props: { ...selectedElement.props, cornerRadius: Math.max(0, n) } })}
              />
            )}
            {kind === 'text' && (
              <NumberField
                label="Tamaño de fuente"
                value={selectedElement?.props?.fontSize || 24}
                disabled={disabled}
                onCommit={(n) => onUpdate({ props: { ...selectedElement.props, fontSize: Math.max(1, n) } })}
              />
            )}
            {/* Lote UX-4: brillo/contraste via Konva.Filters -- SOLO estos dos
                ajustes, no un retoque completo de imagen (alcance confirmado
                por Carlos). Rangos elegidos por lo que produce un resultado
                util visualmente: Brighten de Konva satura casi por completo
                fuera de -1..1; Contrast tiene mas margen util, -100..100. */}
            {kind === 'image' && (
              <>
                <label className="editor-v2-field editor-v2-field-range">
                  <span>Brillo ({(selectedElement?.props?.brightness || 0).toFixed(2)})</span>
                  <input
                    type="range"
                    min={-1}
                    max={1}
                    step={0.05}
                    disabled={disabled}
                    value={selectedElement?.props?.brightness || 0}
                    onChange={(e) => onUpdate({ props: { ...selectedElement.props, brightness: parseFloat(e.target.value) } })}
                  />
                </label>
                <label className="editor-v2-field editor-v2-field-range">
                  <span>Contraste ({selectedElement?.props?.contrast || 0})</span>
                  <input
                    type="range"
                    min={-100}
                    max={100}
                    step={1}
                    disabled={disabled}
                    value={selectedElement?.props?.contrast || 0}
                    onChange={(e) => onUpdate({ props: { ...selectedElement.props, contrast: parseInt(e.target.value, 10) } })}
                  />
                </label>
              </>
            )}
            {!kind && <p className="editor-v2-props-hint">Selecciona un elemento para ver sus opciones.</p>}
          </section>

          {kind === 'audio' && (
            <section className="editor-v2-props-section">
              <h4>Audio</h4>
              <audio
                key={selectedElement.props?.src}
                controls
                style={{ width: '100%', marginBottom: 8 }}
                src={selectedElement.props?.src?.startsWith('http') ? selectedElement.props.src : `${API_URL}${selectedElement.props?.src || ''}`}
              />
              <label className="editor-v2-field editor-v2-field-checkbox">
                <input
                  type="checkbox"
                  disabled={disabled}
                  checked={!!selectedElement.props?.autoplay}
                  onChange={(e) => onUpdate({ props: { ...selectedElement.props, autoplay: e.target.checked } })}
                />
                <span>Reproducir automáticamente (Reader)</span>
              </label>
              <label className="editor-v2-field editor-v2-field-checkbox">
                <input
                  type="checkbox"
                  disabled={disabled}
                  checked={!!selectedElement.props?.loop}
                  onChange={(e) => onUpdate({ props: { ...selectedElement.props, loop: e.target.checked } })}
                />
                <span>Repetir en bucle</span>
              </label>
              <p className="editor-v2-props-hint">
                Vista previa de escucha para validar el archivo -- la reproducción real dentro de la publicación llega con el Reader (Fase E).
              </p>
            </section>
          )}

          {kind === 'video' && (
            <section className="editor-v2-props-section">
              <h4>Video</h4>
              <video
                key={selectedElement.props?.src}
                controls
                style={{ width: '100%', marginBottom: 8, background: '#000' }}
                src={selectedElement.props?.src?.startsWith('http') ? selectedElement.props.src : `${API_URL}${selectedElement.props?.src || ''}`}
              />
              <label className="editor-v2-field editor-v2-field-checkbox">
                <input
                  type="checkbox"
                  disabled={disabled}
                  checked={!!selectedElement.props?.autoplay}
                  onChange={(e) => onUpdate({ props: { ...selectedElement.props, autoplay: e.target.checked } })}
                />
                <span>Reproducir automáticamente (Reader)</span>
              </label>
              <label className="editor-v2-field editor-v2-field-checkbox">
                <input
                  type="checkbox"
                  disabled={disabled}
                  checked={!!selectedElement.props?.loop}
                  onChange={(e) => onUpdate({ props: { ...selectedElement.props, loop: e.target.checked } })}
                />
                <span>Repetir en bucle</span>
              </label>
              <label className="editor-v2-field editor-v2-field-checkbox">
                <input
                  type="checkbox"
                  disabled={disabled}
                  checked={!!selectedElement.props?.muted}
                  onChange={(e) => onUpdate({ props: { ...selectedElement.props, muted: e.target.checked } })}
                />
                <span>Silenciado</span>
              </label>
              <p className="editor-v2-props-hint">
                Vista previa para validar el archivo -- la reproducción real dentro de la publicación llega con el Reader (Fase E).
              </p>
            </section>
          )}

          {kind === 'gallery' && (
            <section className="editor-v2-props-section">
              <h4>{selectedElement.props?.layout === 'mosaic' ? 'Collage' : 'Galería'}</h4>
              <div className="editor-v2-gallery-layout-row">
                <button
                  type="button"
                  className={`editor-v2-tool ${(selectedElement.props?.layout || 'grid') === 'grid' ? 'active' : ''}`}
                  disabled={disabled}
                  onClick={() => onUpdate({ props: { ...selectedElement.props, layout: 'grid' } })}
                >
                  Cuadrícula
                </button>
                <button
                  type="button"
                  className={`editor-v2-tool ${selectedElement.props?.layout === 'mosaic' ? 'active' : ''}`}
                  disabled={disabled}
                  onClick={() => onUpdate({ props: { ...selectedElement.props, layout: 'mosaic' } })}
                >
                  Mosaico
                </button>
              </div>
              <ul className="editor-v2-gallery-thumbs">
                {(selectedElement.props?.images || []).map((img, i) => (
                  <li key={`${img.src}-${i}`} className="editor-v2-gallery-thumb">
                    <img src={img.src?.startsWith('http') ? img.src : `${API_URL}${img.src}`} alt="" />
                    <button
                      type="button"
                      className="editor-v2-gallery-thumb-remove"
                      disabled={disabled}
                      title="Quitar imagen"
                      onClick={() => {
                        const next = (selectedElement.props?.images || []).filter((_, idx) => idx !== i);
                        onUpdate({ props: { ...selectedElement.props, images: next } });
                      }}
                    >
                      ×
                    </button>
                  </li>
                ))}
                {(selectedElement.props?.images || []).length === 0 && (
                  <p className="editor-v2-props-hint">Sin imágenes -- agrega al menos una.</p>
                )}
              </ul>
              <button
                type="button"
                className="editor-v2-quickaction"
                disabled={disabled}
                onClick={onAppendImagesClick}
              >
                Agregar imágenes
              </button>
              <button
                type="button"
                className="editor-v2-quickaction editor-v2-gallery-configure"
                disabled={disabled}
                onClick={onOpenGalleryModal}
                title="Título/descripción por imagen, biblioteca, modo de imagen, transición, autoplay y controles"
              >
                ⚙ Configurar galería
              </button>
            </section>
          )}

          {kind === 'embed' && (
            <section className="editor-v2-props-section">
              <h4>{EMBED_PROVIDER_META[selectedElement.props?.provider]?.label || 'YouTube'}</h4>
              <p className="editor-v2-props-hint">
                Konva no puede reproducir el {selectedElement.props?.provider === 'soundcloud' ? 'audio' : 'video'} embebido
                dentro del editor -- usa este enlace para confirmar que apunta al {selectedElement.props?.provider === 'soundcloud' ? 'track' : 'video'} correcto.
                La reproducción real llega con el Reader (Fase E).
              </p>
              <a
                className="editor-v2-embed-link"
                href={selectedElement.props?.url || '#'}
                target="_blank"
                rel="noopener noreferrer"
              >
                {selectedElement.props?.url || '(sin URL)'}
              </a>
              <label className="editor-v2-field">
                <span>{selectedElement.props?.provider === 'soundcloud' ? 'usuario/track' : 'video_id'}</span>
                <input type="text" value={selectedElement.props?.video_id || ''} readOnly disabled />
              </label>
            </section>
          )}
        </>
      )}

      <section className="editor-v2-props-section">
        <h4>Quick Actions</h4>
        {/* Orden de capas (Lote UX-5, pedido explicito de Carlos): version
            simple aceptada en vez de un panel de capas completo estilo
            Photoshop -- reutiliza z_index, ya existente desde la Fase A. */}
        <div className="editor-v2-order-row">
          <button type="button" className="editor-v2-tool" disabled={disabled} title="Traer al frente" aria-label="Traer al frente" onClick={() => onReorder('front')}>
            <Icon name="bringFront" size={16} />
          </button>
          <button type="button" className="editor-v2-tool" disabled={disabled} title="Subir un nivel" aria-label="Subir un nivel" onClick={() => onReorder('up')}>
            <Icon name="layerUp" size={16} />
          </button>
          <button type="button" className="editor-v2-tool" disabled={disabled} title="Bajar un nivel" aria-label="Bajar un nivel" onClick={() => onReorder('down')}>
            <Icon name="layerDown" size={16} />
          </button>
          <button type="button" className="editor-v2-tool" disabled={disabled} title="Enviar al fondo" aria-label="Enviar al fondo" onClick={() => onReorder('back')}>
            <Icon name="sendBack" size={16} />
          </button>
        </div>
        <button
          type="button"
          className="editor-v2-quickaction"
          disabled={disabled}
          aria-expanded={settingsOpen}
          onClick={() => setSettingsOpen((v) => !v)}
        >
          Configuración del elemento
        </button>
        {settingsOpen && selectedElement && (
          <div className="editor-v2-element-settings">
            <TextField
              label="Nombre del elemento"
              placeholder="Sin nombre"
              value={selectedElement.props?.element_name || ''}
              disabled={disabled}
              onCommit={(name) => onUpdate({ props: { ...selectedElement.props, element_name: name } })}
            />
            <label className="editor-v2-field editor-v2-field-checkbox">
              <input
                type="checkbox"
                disabled={disabled}
                checked={!!selectedElement.props?.locked}
                onChange={(e) => onUpdate({ props: { ...selectedElement.props, locked: e.target.checked } })}
              />
              <span>Bloquear elemento</span>
            </label>
            <label className="editor-v2-field editor-v2-field-checkbox">
              <input
                type="checkbox"
                disabled={disabled}
                checked={!!selectedElement.props?.hidden_in_reader}
                onChange={(e) => onUpdate({ props: { ...selectedElement.props, hidden_in_reader: e.target.checked } })}
              />
              <span>Ocultar en el Reader</span>
            </label>
            <p className="editor-v2-props-hint">
              Bloquear impide mover/redimensionar el elemento en este editor (sigue pudiéndose seleccionar, para
              desbloquearlo). Ocultar en el Reader solo guarda la preferencia -- todavía no hay Reader real que la respete.
            </p>
          </div>
        )}
        <button type="button" className="editor-v2-quickaction coming-soon" disabled title="Próximamente (Blocks -- lote aparte, fuera de alcance del Lote 7)">
          Guardar como bloque de plantilla
        </button>
        <label className="editor-v2-field">
          <span>Animar</span>
          <select
            disabled={disabled}
            value={selectedElement?.props?.animation || 'none'}
            onChange={(e) => onUpdate({ props: { ...selectedElement.props, animation: e.target.value } })}
          >
            {ANIMATION_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </label>
      </section>
    </aside>
  );
}

// --- Cálculo de Alinear/Distribuir ---------------------------------------
// Todo en las mismas "unidades de página" que x/y/width/height (ver
// PX_PER_MM) -- nunca en píxeles de pantalla, para que el resultado sea
// idéntico sin importar el zoom del navegador.
function computeAlignPatches(type, selected) {
  const patches = {};
  if (type === 'alignLeft') {
    const minX = Math.min(...selected.map((e) => e.x));
    selected.forEach((e) => { patches[e.id] = { x: minX }; });
  } else if (type === 'alignRight') {
    const maxRight = Math.max(...selected.map((e) => e.x + e.width));
    selected.forEach((e) => { patches[e.id] = { x: maxRight - e.width }; });
  } else if (type === 'alignCenterH') {
    const minX = Math.min(...selected.map((e) => e.x));
    const maxX = Math.max(...selected.map((e) => e.x + e.width));
    const centerX = (minX + maxX) / 2;
    selected.forEach((e) => { patches[e.id] = { x: centerX - e.width / 2 }; });
  } else if (type === 'alignTop') {
    const minY = Math.min(...selected.map((e) => e.y));
    selected.forEach((e) => { patches[e.id] = { y: minY }; });
  } else if (type === 'alignBottom') {
    const maxBottom = Math.max(...selected.map((e) => e.y + e.height));
    selected.forEach((e) => { patches[e.id] = { y: maxBottom - e.height }; });
  } else if (type === 'alignMiddleV') {
    const minY = Math.min(...selected.map((e) => e.y));
    const maxY = Math.max(...selected.map((e) => e.y + e.height));
    const centerY = (minY + maxY) / 2;
    selected.forEach((e) => { patches[e.id] = { y: centerY - e.height / 2 }; });
  } else if (type === 'distributeH' && selected.length >= 3) {
    const sorted = [...selected].sort((a, b) => a.x + a.width / 2 - (b.x + b.width / 2));
    const firstCenter = sorted[0].x + sorted[0].width / 2;
    const lastCenter = sorted[sorted.length - 1].x + sorted[sorted.length - 1].width / 2;
    const step = (lastCenter - firstCenter) / (sorted.length - 1);
    sorted.forEach((e, i) => { patches[e.id] = { x: firstCenter + step * i - e.width / 2 }; });
  } else if (type === 'distributeV' && selected.length >= 3) {
    const sorted = [...selected].sort((a, b) => a.y + a.height / 2 - (b.y + b.height / 2));
    const firstCenter = sorted[0].y + sorted[0].height / 2;
    const lastCenter = sorted[sorted.length - 1].y + sorted[sorted.length - 1].height / 2;
    const step = (lastCenter - firstCenter) / (sorted.length - 1);
    sorted.forEach((e, i) => { patches[e.id] = { y: firstCenter + step * i - e.height / 2 }; });
  }
  return patches;
}

// Intersección de dos rectángulos axis-aligned (no considera rotación --
// aproximación aceptable para un marquee-select de MVP).
function rectsIntersect(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

// --- Cálculo de la agrupación en "vistas" (hoja simple / hoja doble) -----
// Helper puro, sin dependencias de React -- fácil de razonar/testear:
//   - page_number === 1 (portada) siempre sola.
//   - page_number === total (contraportada) siempre sola.
//   - El resto se agrupa de a 2 EN ORDEN (2,3), (4,5), (6,7)... Si el total
//     de páginas interiores es impar, el último spread interior queda con
//     una sola página (lado derecho vacío -- no se renderiza un segundo
//     Stage ahí, simplemente `right` queda null).
// `total` se recibe aparte (no se infiere de pages.length) porque en teoría
// la lista de páginas podría llegar incompleta -- en la práctica hoy siempre
// coincide, pero así el cálculo es correcto también si no coincidiera.
export function computeSpreadViews(pages, total) {
  const sorted = [...pages].sort((a, b) => a.page_number - b.page_number);
  const lastPageNumber = total ?? (sorted.length > 0 ? sorted[sorted.length - 1].page_number : 0);
  const views = [];
  let i = 0;
  while (i < sorted.length) {
    const p = sorted[i];
    const isCover = p.page_number === 1;
    const isBackCover = p.page_number === lastPageNumber;
    if (isCover || isBackCover) {
      views.push({ left: p, right: null });
      i += 1;
      continue;
    }
    const next = sorted[i + 1];
    const nextIsInteriorPartner = next && next.page_number !== 1 && next.page_number !== lastPageNumber;
    if (nextIsInteriorPartner) {
      views.push({ left: p, right: next });
      i += 2;
    } else {
      views.push({ left: p, right: null });
      i += 1;
    }
  }
  return views;
}

function findViewIndexForPageId(views, pageId) {
  if (!pageId) return -1;
  return views.findIndex((v) => v.left?.id === pageId || v.right?.id === pageId);
}

function findViewIndexForPageNumber(views, pageNumber) {
  return views.findIndex((v) => v.left?.page_number === pageNumber || v.right?.page_number === pageNumber);
}

// --- Bloque de render de UNA página (Stage/Layer/Transformer/marquee) ----
// Extraído a su propio componente para poder montarlo una vez (hoja simple)
// o dos veces lado a lado (spread) sin duplicar código. Cada instancia tiene
// SUS PROPIOS refs (stageRef/trRef/shapeRefs) -- nunca compartidos entre
// lados, o el Transformer de un lado terminaría adjuntándose a nodos del
// otro. `useStoreHook` es la instancia de store (creada por
// createPageEditorStore()) que gobierna esta página -- ella misma es un
// hook de Zustand, así que se llama directamente en el cuerpo del
// componente como cualquier otro hook.
export function PageCanvas({ useStoreHook, canEdit, publication, pageNumber, totalPages, onFocus, scale = 1 }) {
  const { elements, isLoading, loadError, selectedElementIds } = useStoreHook();

  const stageRef = useRef(null);
  const trRef = useRef(null);
  const shapeRefs = useRef({});
  const marqueeStartRef = useRef(null);
  const [marquee, setMarquee] = useState(null);

  useEffect(() => {
    // Un elemento bloqueado (props.locked, Lote 6 -- Quick Actions >
    // Configuración del elemento) sigue siendo SELECCIONABLE (para poder
    // desbloquearlo desde el panel), pero se excluye deliberadamente de los
    // nodos que recibe el Transformer -- sin esto, aunque draggable={false}
    // ya impide arrastrarlo, las asas del Transformer igual permitirían
    // redimensionarlo/rotarlo.
    const unlockedIds = selectedElementIds.filter((id) => !elements.find((e) => e.id === id)?.props?.locked);
    const nodes = unlockedIds.map((id) => shapeRefs.current[id]).filter(Boolean);
    if (trRef.current) {
      trRef.current.nodes(nodes);
      trRef.current.getLayer()?.batchDraw();
    }
  }, [selectedElementIds, elements]);

  const stageWidthPx = publication.page_width * PX_PER_MM;
  const stageHeightPx = publication.page_height * PX_PER_MM;
  const sortedElements = [...elements].sort((a, b) => (a.z_index ?? 0) - (b.z_index ?? 0));
  const shortcodeCtx = { pageNumber, totalPages, publicationTitle: publication.title };

  const handleStageMouseDown = (e) => {
    onFocus();
    if (e.target !== e.target.getStage()) return; // click sobre un elemento, no el fondo
    const pos = e.target.getStage().getPointerPosition();
    if (!e.evt.shiftKey) useStoreHook.getState().selectElement(null);
    marqueeStartRef.current = pos;
    setMarquee({ x: pos.x, y: pos.y, width: 0, height: 0 });
  };

  const handleStageMouseMove = (e) => {
    if (!marqueeStartRef.current) return;
    const pos = e.target.getStage().getPointerPosition();
    const start = marqueeStartRef.current;
    setMarquee({
      x: Math.min(start.x, pos.x),
      y: Math.min(start.y, pos.y),
      width: Math.abs(pos.x - start.x),
      height: Math.abs(pos.y - start.y),
    });
  };

  const handleStageMouseUp = () => {
    if (!marqueeStartRef.current) return;
    const rect = marquee;
    marqueeStartRef.current = null;
    setMarquee(null);
    if (!rect || (rect.width < 4 && rect.height < 4)) return; // click simple, no arrastre real
    const hitIds = elements.filter((el) => rectsIntersect(rect, el)).map((el) => el.id);
    if (hitIds.length > 0) useStoreHook.getState().selectElements(hitIds);
  };

  if (isLoading) {
    return <div className="editor-v2-loading editor-v2-page-slot" style={{ width: stageWidthPx * scale, height: stageHeightPx * scale }}>Cargando página…</div>;
  }
  if (loadError) {
    return <div className="editor-v2-error editor-v2-page-slot" style={{ width: stageWidthPx * scale, height: stageHeightPx * scale }}>{loadError}</div>;
  }

  return (
    <Stage
      ref={stageRef}
      width={stageWidthPx * scale}
      height={stageHeightPx * scale}
      scaleX={scale}
      scaleY={scale}
      className="editor-v2-stage"
      onMouseDown={handleStageMouseDown}
      onMouseMove={handleStageMouseMove}
      onMouseUp={handleStageMouseUp}
    >
      <Layer>
        <Rect x={0} y={0} width={stageWidthPx} height={stageHeightPx} fill="#ffffff" listening={false} />
        {sortedElements.map((el) => {
          // 'key' se pasa aparte (no dentro del spread) -- React exige que sea
          // una prop directa de JSX, nunca parte de un objeto esparcido, o avisa
          // en consola (advertencia inofensiva pero evitable) en modo desarrollo.
          const shared = {
            el,
            canEdit,
            onSelect: (e) => {
              onFocus();
              if (canEdit) useStoreHook.getState().selectElement(el.id, { additive: e?.evt?.shiftKey });
            },
            onChange: (patch) => canEdit && useStoreHook.getState().updateElement(el.id, patch),
            // Solo TextElement lo usa (Lote UX-6): deselecciona al entrar en
            // edicion inline para que el Transformer no quede dibujado
            // encima del <textarea> superpuesto.
            onEditStart: () => useStoreHook.getState().selectElement(null),
            shapeRef: (node) => {
              shapeRefs.current[el.id] = node;
            },
          };
          if (el.kind === 'image') return <ImageElement key={el.id} {...shared} />;
          if (el.kind === 'text') return <TextElement key={el.id} {...shared} shortcodeCtx={shortcodeCtx} />;
          if (el.kind === 'audio') return <AudioElement key={el.id} {...shared} />;
          if (el.kind === 'video') return <VideoElement key={el.id} {...shared} />;
          if (el.kind === 'gallery') return <GalleryElement key={el.id} {...shared} />;
          if (el.kind === 'embed') return <EmbedElement key={el.id} {...shared} />;
          return <ShapeElement key={el.id} {...shared} />;
        })}
        {canEdit && <Transformer ref={trRef} rotateEnabled resizeEnabled />}
        {marquee && (
          <Rect
            x={marquee.x}
            y={marquee.y}
            width={marquee.width}
            height={marquee.height}
            fill="rgba(79,70,229,0.15)"
            stroke="#14213d"
            strokeWidth={1}
            listening={false}
          />
        )}
      </Layer>
    </Stage>
  );
}

export default function CanvasEditorV2() {
  const { id: publicationId, pageId: pageIdParam } = useParams();
  const navigate = useNavigate();

  const [publication, setPublication] = useState(null);
  const [pages, setPages] = useState([]);
  const [loadErr, setLoadErr] = useState(null);

  // acquiring | held | denied
  const [lockState, setLockState] = useState('acquiring');
  const [lockMessage, setLockMessage] = useState('');

  const [pluginsMenuOpen, setPluginsMenuOpen] = useState(false);

  // Lote 5 (YouTube/Vimeo): popover propio para pegar la URL -- este
  // proyecto ya no usa window.prompt/dialogs nativos para nada (la edicion
  // de texto de TextElement paso a un <textarea> inline en el Lote UX-6,
  // ver openInlineTextEditor() mas arriba). embedMenuOpen indica cual de
  // los dos botones de rail abrio el popover ('youtube' | 'vimeo' | null);
  // el proveedor real que se guarda es siempre el que parseVideoUrl()
  // detecta en la URL pegada, sin importar cual boton se uso para abrir el
  // popover (ver parseVideoUrl y handleInsertEmbed mas abajo -- decision
  // documentada en RECETA-DESARROLLO.md).
  const [embedMenuOpen, setEmbedMenuOpen] = useState(null);
  // Anclas para los popovers del rail (ver RailPopover mas arriba) -- uno
  // por boton disparador, ya que solo un popover de embed esta abierto a la
  // vez pero puede ser cualquiera de los 3.
  const youtubeWrapRef = useRef(null);
  const vimeoWrapRef = useRef(null);
  const soundcloudWrapRef = useRef(null);
  const pluginsWrapRef = useRef(null);
  const libraryWrapRef = useRef(null);
  const [embedUrlDraft, setEmbedUrlDraft] = useState('');
  const [embedError, setEmbedError] = useState('');

  // Página "enfocada" dentro del spread (o la única en hoja simple) -- el
  // rail de herramientas y el panel de propiedades actúan siempre sobre
  // ella. Se actualiza al hacer click en el fondo o al seleccionar un
  // elemento de cualquiera de los dos Stages.
  const [focusedSide, setFocusedSide] = useState('left');

  // Dos instancias INDEPENDIENTES del store (fábrica, ver
  // store/pageEditorStore.js) -- estables a través de renders gracias a
  // useState(() => ...). En hoja simple solo useLeftStore está en uso;
  // useRightStore queda sin cargar/inactiva.
  const [useLeftStore] = useState(() => createPageEditorStore());
  const [useRightStore] = useState(() => createPageEditorStore());

  // Hook de depuracion SOLO en dev (Vite lo elimina del build de produccion):
  // permite inspeccionar el estado real de cada store desde fuera de React
  // (p.ej. scripts de verificacion con Playwright) sin exponer nada en
  // produccion. Se exponen ambos lados por separado -- ya no hay un único
  // "window.__pageEditorStore" porque ya no hay un único store.
  const leftState = useLeftStore();
  const rightState = useRightStore();

  // window.__pageEditorStore (sin sufijo) se conserva por compatibilidad con
  // los scripts de verificacion Playwright ya existentes (previos a la
  // vista de spread) -- todos ellos navegan siempre a portada/contraportada
  // o a una pagina interior solitaria, nunca a un spread real, asi que
  // "el store enfocado por defecto" (izquierdo) es equivalente al store
  // singleton que exponian antes. Los scripts nuevos que sí necesitan
  // distinguir ambos lados de un spread deben usar las variantes con
  // sufijo Left/Right.
  if (import.meta.env.DEV) {
    window.__pageEditorStore = leftState;
    window.__pageEditorStoreLeft = leftState;
    window.__pageEditorStoreRight = rightState;
  }
  const focusedState = focusedSide === 'right' ? rightState : leftState;
  const focusedStoreHook = focusedSide === 'right' ? useRightStore : useLeftStore;

  const fileInputRef = useRef(null);
  const audioInputRef = useRef(null);
  const videoInputRef = useRef(null);
  const galleryInputRef = useRef(null);
  const collageInputRef = useRef(null);
  const gifInputRef = useRef(null);
  const galleryAppendInputRef = useRef(null);

  // Lote 7 -- Library: popover propio (mismo lenguaje visual que
  // Plugins/Embed) con la biblioteca de assets del tenant (GET /api/assets).
  // Se recarga cada vez que se abre (no se cachea entre aperturas -- el
  // tenant puede haber subido algo nuevo desde la ultima vez) y respeta el
  // filtro por tipo elegido en el propio popover.
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [libraryAssets, setLibraryAssets] = useState([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryError, setLibraryError] = useState('');
  const [libraryFilter, setLibraryFilter] = useState('all');

  const canEdit = lockState === 'held';
  const selectedElements = focusedState.elements.filter((e) => focusedState.selectedElementIds.includes(e.id));

  // Publicación + lista de páginas: se cargan una vez, no dependen de qué
  // página está activa (evita refetchs innecesarios al navegar entre páginas).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [pub, pgs] = await Promise.all([
          publicationAPI.get(publicationId),
          pageAPI.getPublicationPages(publicationId),
        ]);
        if (cancelled) return;
        setPublication(pub);
        setPages([...pgs].sort((a, b) => a.page_number - b.page_number));
      } catch (err) {
        if (!cancelled) setLoadErr(err?.response?.data?.detail || 'No se pudo cargar la publicación');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [publicationId]);

  const spreadViews = useMemo(
    () => computeSpreadViews(pages, publication?.total_pages ?? pages.length),
    [pages, publication?.total_pages]
  );

  const currentViewIndex = pageIdParam ? findViewIndexForPageId(spreadViews, pageIdParam) : 0;
  const currentView = currentViewIndex >= 0 ? spreadViews[currentViewIndex] : spreadViews[0];

  // Si no se especificó página en la URL (o no corresponde a ninguna vista
  // conocida), redirigir a la primera en cuanto se conoce.
  useEffect(() => {
    if (spreadViews.length === 0) return;
    const idx = pageIdParam ? findViewIndexForPageId(spreadViews, pageIdParam) : -1;
    if (idx === -1) {
      navigate(`/publications/${publicationId}/edit/${spreadViews[0].left.id}`, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageIdParam, spreadViews, publicationId]);

  // Al cambiar de vista (spread u hoja simple), el foco vuelve al lado
  // izquierdo por defecto -- es el único lado garantizado de existir.
  useEffect(() => {
    setFocusedSide('left');
  }, [currentViewIndex]);

  // Lock de edición de la publicación completa: se adquiere UNA vez al entrar
  // al editor (no por página, y no por lado del spread) y se libera al
  // salir. Heartbeat mientras dure. No requiere cambios por la vista de
  // spread: el lock ya cubre la publicación completa, ambas páginas
  // incluidas.
  useEffect(() => {
    let heartbeatTimer = null;
    let cancelled = false;

    (async () => {
      try {
        await lockAPI.acquire(publicationId);
        if (cancelled) return;
        setLockState('held');
        heartbeatTimer = setInterval(() => {
          lockAPI.heartbeat(publicationId).catch(() => {
            if (cancelled) return;
            setLockState('denied');
            setLockMessage('Se perdió el bloqueo de edición (posible inactividad prolongada). Recarga la página para reintentar.');
          });
        }, HEARTBEAT_MS);
      } catch (err) {
        if (cancelled) return;
        setLockState('denied');
        setLockMessage(err?.response?.data?.detail || 'Esta publicación está siendo editada por otra persona.');
      }
    })();

    return () => {
      cancelled = true;
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      lockAPI.release(publicationId).catch(() => {
        // Liberación best-effort: si falla (red caída, sesión expirada), el
        // lock igual expira solo por heartbeat vencido -- no bloquea salir.
      });
    };
  }, [publicationId]);

  // Cargar cada lado del spread en SU PROPIA instancia de store cada vez que
  // cambia. loadPage() reemplaza TODO el estado de esa instancia -- nunca
  // reutiliza el de la página anterior en ese mismo lado (ver comentario
  // extenso en store/pageEditorStore.js sobre la causa raíz del bug
  // original). Si el lado no tiene página (hoja simple), se resetea para no
  // dejar residuo de un spread anterior.
  const leftPageId = currentView?.left?.id || null;
  const rightPageId = currentView?.right?.id || null;

  useEffect(() => {
    if (leftPageId) useLeftStore.getState().loadPage(leftPageId);
    else useLeftStore.getState().reset();
    return () => useLeftStore.getState().reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leftPageId]);

  useEffect(() => {
    if (rightPageId) useRightStore.getState().loadPage(rightPageId);
    else useRightStore.getState().reset();
    return () => useRightStore.getState().reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rightPageId]);

  // Borrar con teclado (Delete/Backspace) cuando hay elementos seleccionados
  // en el lado ENFOCADO y el foco no está en un input de texto.
  useEffect(() => {
    const onKeyDown = (e) => {
      const tag = document.activeElement?.tagName;
      if ((e.key === 'Delete' || e.key === 'Backspace') && focusedState.selectedElementIds.length > 0 && tag !== 'INPUT' && tag !== 'TEXTAREA') {
        focusedStoreHook.getState().removeSelectedElements();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedSide, focusedState.selectedElementIds]);

  const anyDirty = leftState.isDirty || rightState.isDirty;
  const anySaving = leftState.isSaving || rightState.isSaving;
  const combinedSaveError = leftState.saveError || rightState.saveError;

  const handleSaveAll = async () => {
    // Ambas páginas del spread son editables simultáneamente -- "Guardar"
    // persiste cualquiera de las dos que tenga cambios pendientes, no solo
    // la enfocada.
    if (leftState.isDirty) await useLeftStore.getState().save();
    if (rightState.isDirty) await useRightStore.getState().save();
  };

  const handleReloadOnConflict = () => {
    if (leftState.saveError?.status === 409 && leftPageId) useLeftStore.getState().loadPage(leftPageId);
    if (rightState.saveError?.status === 409 && rightPageId) useRightStore.getState().loadPage(rightPageId);
  };

  // --- Navegación inferior (Anterior/Siguiente + salto manual) ------------
  const goToViewIndex = (idx) => {
    if (idx < 0 || idx >= spreadViews.length) return;
    const view = spreadViews[idx];
    if (anyDirty && !window.confirm('Tienes cambios sin guardar en esta vista. ¿Descartarlos y cambiar de página?')) {
      return;
    }
    navigate(`/publications/${publicationId}/edit/${view.left.id}`);
  };

  const handlePrev = () => goToViewIndex(currentViewIndex - 1);
  const handleNext = () => goToViewIndex(currentViewIndex + 1);

  const [pageJumpDraft, setPageJumpDraft] = useState('');
  const activeLeftPageNumber = currentView?.left?.page_number;
  const activeRightPageNumber = currentView?.right?.page_number;
  useEffect(() => {
    setPageJumpDraft(activeLeftPageNumber ? String(activeLeftPageNumber) : '');
  }, [activeLeftPageNumber]);

  const commitPageJump = () => {
    const n = parseInt(pageJumpDraft, 10);
    const totalPages = publication?.total_pages ?? pages.length;
    if (Number.isNaN(n) || n < 1 || n > totalPages) {
      setPageJumpDraft(activeLeftPageNumber ? String(activeLeftPageNumber) : '');
      return;
    }
    const idx = findViewIndexForPageNumber(spreadViews, n);
    if (idx === -1 || idx === currentViewIndex) return;
    goToViewIndex(idx);
  };

  const handleUploadImageClick = () => fileInputRef.current?.click();
  const handleUploadAudioClick = () => audioInputRef.current?.click();
  const handleUploadVideoClick = () => videoInputRef.current?.click();
  const handleUploadGalleryClick = () => galleryInputRef.current?.click();
  const handleUploadCollageClick = () => collageInputRef.current?.click();
  const handleUploadGifClick = () => gifInputRef.current?.click();
  const handleUploadGalleryAppendClick = () => galleryAppendInputRef.current?.click();

  // Lote UX-10: estado del modal "Propiedades de la galería" -- solo tiene
  // sentido con exactamente un elemento kind='gallery' seleccionado (mismo
  // criterio que handleAppendGalleryImages más abajo).
  const [galleryModalOpen, setGalleryModalOpen] = useState(false);
  const handleOpenGalleryModal = () => {
    const onlyGallerySelected = selectedElements.length === 1 && selectedElements[0].kind === 'gallery';
    if (!onlyGallerySelected) return;
    fetchLibraryAssets('image');
    setGalleryModalOpen(true);
  };
  const handleSaveGalleryModal = (patch) => {
    const onlyGallerySelected = selectedElements.length === 1 && selectedElements[0].kind === 'gallery';
    if (!onlyGallerySelected) {
      setGalleryModalOpen(false);
      return;
    }
    const el = selectedElements[0];
    focusedStoreHook.getState().updateElement(el.id, { props: { ...el.props, ...patch } });
    setGalleryModalOpen(false);
  };

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const uploaded = await assetAPI.upload(file);
      focusedStoreHook.getState().addElement('image', { width: 200, height: 200, props: { src: uploaded.url } });
    } catch (err) {
      window.alert(err?.response?.data?.detail || 'No se pudo subir la imagen');
    }
  };

  const handleAudioFileChange = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      // La validacion real de MIME/tamano ocurre en el backend
      // (POST /api/assets/upload -- ver allowed_audio_types y
      // MAX_AUDIO_SIZE en app/api/assets.py); esto es solo para no ni
      // siquiera intentar la subida con un tipo obviamente incorrecto.
      if (file.type && !file.type.startsWith('audio/')) {
        window.alert('Selecciona un archivo de audio (mp3, wav, ogg...).');
        return;
      }
      const uploaded = await assetAPI.upload(file);
      focusedStoreHook.getState().addElement('audio', { width: 220, height: 56, props: { src: uploaded.url, autoplay: false, loop: false } });
    } catch (err) {
      window.alert(err?.response?.data?.detail || 'No se pudo subir el audio');
    }
  };

  const handleVideoFileChange = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    // Igual criterio que Audio/GIF: validacion de tipo del lado cliente antes
    // de intentar la subida (la validacion real de MIME/tamano ocurre en el
    // backend -- ver allowed_video_types y MAX_VIDEO_SIZE en
    // app/api/assets.py). Un .txt (o cualquier tipo no reconocido) nunca
    // llega a llamar assetAPI.upload().
    if (file.type && !file.type.startsWith('video/')) {
      window.alert('Selecciona un archivo de video (mp4, webm, mov...).');
      return;
    }
    try {
      const uploaded = await assetAPI.upload(file);
      focusedStoreHook.getState().addElement('video', { width: 280, height: 160, props: { src: uploaded.url, autoplay: false, loop: false, muted: false } });
    } catch (err) {
      window.alert(err?.response?.data?.detail || 'No se pudo subir el video');
    }
  };

  // Sube varios archivos en secuencia (el backend solo acepta uno por
  // llamada) y devuelve las urls -- reutilizado por Galería, Collage y
  // "agregar más imágenes" desde el panel de propiedades. Si alguno falla
  // a mitad de camino, se avisa pero se conservan los que sí subieron.
  const uploadFilesSequentially = async (fileList) => {
    const urls = [];
    for (const file of fileList) {
      try {
        const uploaded = await assetAPI.upload(file);
        urls.push(uploaded.url);
      } catch (err) {
        window.alert(`No se pudo subir "${file.name}": ${err?.response?.data?.detail || 'error desconocido'}`);
      }
    }
    return urls;
  };

  const handleGalleryFileChange = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length === 0) return;
    const urls = await uploadFilesSequentially(files);
    if (urls.length === 0) return;
    focusedStoreHook.getState().addElement('gallery', { width: 320, height: 220, props: { images: urls.map((src) => ({ src })), layout: 'grid' } });
  };

  const handleCollageFileChange = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length === 0) return;
    const urls = await uploadFilesSequentially(files);
    if (urls.length === 0) return;
    focusedStoreHook.getState().addElement('gallery', { width: 320, height: 220, props: { images: urls.map((src) => ({ src })), layout: 'mosaic' } });
  };

  const handleGifFileChange = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.type && file.type !== 'image/gif') {
      window.alert('Selecciona un archivo GIF.');
      return;
    }
    try {
      const uploaded = await assetAPI.upload(file);
      // GIF reutiliza kind='image' -- Konva pinta el primer frame (no anima
      // GIFs animados), limitacion conocida documentada en
      // RECETA-DESARROLLO.md; el archivo original SI se sirve tal cual.
      focusedStoreHook.getState().addElement('image', { width: 200, height: 200, props: { src: uploaded.url } });
    } catch (err) {
      window.alert(err?.response?.data?.detail || 'No se pudo subir el GIF');
    }
  };

  // "Agregar más imágenes" desde el panel de propiedades: solo tiene
  // sentido con exactamente un elemento kind='gallery' seleccionado.
  const handleAppendGalleryImages = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length === 0) return;
    const onlyGallerySelected = selectedElements.length === 1 && selectedElements[0].kind === 'gallery';
    if (!onlyGallerySelected) return;
    const urls = await uploadFilesSequentially(files);
    if (urls.length === 0) return;
    const el = selectedElements[0];
    const current = el.props?.images || [];
    focusedStoreHook.getState().updateElement(el.id, { props: { ...el.props, images: [...current, ...urls.map((src) => ({ src }))] } });
  };

  const handleInsertShortcode = (key) => {
    if (!canEdit) return;
    const onlyTextSelected = selectedElements.length === 1 && selectedElements[0].kind === 'text';
    if (onlyTextSelected) {
      const el = selectedElements[0];
      const current = el.props?.text || '';
      const sep = current && !current.endsWith(' ') ? ' ' : '';
      focusedStoreHook.getState().updateElement(el.id, { props: { ...el.props, text: `${current}${sep}{{${key}}}` } });
    } else {
      focusedStoreHook.getState().addElement('text', { props: { text: `{{${key}}}`, fontSize: 24, fill: '#111111' } });
    }
    setPluginsMenuOpen(false);
  };

  const handleOpenEmbedMenu = (provider) => {
    setEmbedMenuOpen((v) => (v === provider ? null : provider));
    setEmbedUrlDraft('');
    setEmbedError('');
  };

  // El proveedor guardado es el que parseVideoUrl() detecta a partir de la
  // URL pegada -- no el boton que abrio el popover (mismo criterio del
  // Lote 5, ahora extendido a SoundCloud). Si Carlos pega por error una URL
  // de Vimeo tras abrir el popover de "YouTube", se inserta como Vimeo
  // igual (una URL valida no deberia rechazarse solo porque no coincide con
  // el boton clicado); si el formato no se reconoce en absoluto (incluido un
  // campo vacio), se muestra el error inline y no se crea ningun elemento.
  const handleInsertEmbed = () => {
    const parsed = parseVideoUrl(embedUrlDraft);
    if (!parsed) {
      setEmbedError('No se reconoce esa URL de YouTube, Vimeo o SoundCloud. Revisa el formato.');
      return;
    }
    // SoundCloud es conceptualmente un embed de audio (como AudioElement, no
    // sube archivo) -- una caja más baja tipo "reproductor" encaja mejor que
    // el marco 280x160 pensado para video de YouTube/Vimeo.
    const isAudioEmbed = parsed.provider === 'soundcloud';
    focusedStoreHook.getState().addElement('embed', {
      width: 280,
      height: isAudioEmbed ? 90 : 160,
      props: { provider: parsed.provider, video_id: parsed.video_id, url: embedUrlDraft.trim() },
    });
    setEmbedMenuOpen(null);
    setEmbedUrlDraft('');
    setEmbedError('');
  };

  // Popover compartido por los 3 botones de embed (YouTube/Vimeo/SoundCloud,
  // Lote 5+6) -- el contenido es idéntico para los tres (un único input de
  // URL + botón Insertar), solo cambia qué booleano de embedMenuOpen lo abre.
  // Extraído a una función en vez de triplicar el JSX (como estaba antes de
  // este lote, cuando solo había 2 proveedores).
  const renderEmbedPopover = () => (
    <>
      <div className="editor-v2-plugins-menu-title">Insertar video o audio (YouTube, Vimeo o SoundCloud)</div>
      <input
        type="text"
        className="editor-v2-embed-input"
        placeholder="Pega la URL…"
        value={embedUrlDraft}
        onChange={(e) => { setEmbedUrlDraft(e.target.value); setEmbedError(''); }}
        onKeyDown={(e) => { if (e.key === 'Enter') handleInsertEmbed(); }}
        autoFocus
      />
      {embedError && <p className="editor-v2-embed-error">{embedError}</p>}
      <button type="button" className="editor-v2-quickaction" onClick={handleInsertEmbed}>
        Insertar
      </button>
    </>
  );

  const handleAlign = (type) => {
    const needs = DISTRIBUTE_ICONS.has(type) ? 3 : 2;
    if (selectedElements.length < needs) return;
    focusedStoreHook.getState().updateElements(computeAlignPatches(type, selectedElements));
  };

  // --- Library (Lote 7) ---------------------------------------------------
  const fetchLibraryAssets = async (kindFilter) => {
    setLibraryLoading(true);
    setLibraryError('');
    try {
      const params = kindFilter && kindFilter !== 'all' ? `?kind=${kindFilter}` : '';
      const res = await fetch(`${API_URL}/api/assets${params}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setLibraryAssets(data.assets || []);
    } catch (err) {
      setLibraryError('No se pudo cargar la biblioteca.');
    } finally {
      setLibraryLoading(false);
    }
  };

  const handleToggleLibrary = () => {
    setLibraryOpen((v) => {
      const next = !v;
      if (next) fetchLibraryAssets(libraryFilter);
      return next;
    });
  };

  const handleLibraryFilterChange = (kindFilter) => {
    setLibraryFilter(kindFilter);
    fetchLibraryAssets(kindFilter);
  };

  // Inserta el asset elegido reutilizando su URL -- NUNCA vuelve a subir el
  // archivo. Mismo `props` que cada tipo usa cuando SÍ se sube (Imagen/
  // Audio/Video de este mismo rail), para que el elemento resultante sea
  // indistinguible de uno recien subido salvo por compartir el mismo src.
  const handleInsertFromLibrary = (asset) => {
    if (!canEdit) return;
    if (asset.kind === 'image') {
      focusedStoreHook.getState().addElement('image', { width: 200, height: 200, props: { src: asset.url } });
    } else if (asset.kind === 'audio') {
      focusedStoreHook.getState().addElement('audio', { width: 220, height: 56, props: { src: asset.url, autoplay: false, loop: false } });
    } else if (asset.kind === 'video') {
      focusedStoreHook.getState().addElement('video', { width: 280, height: 160, props: { src: asset.url, autoplay: false, loop: false, muted: false } });
    }
    setLibraryOpen(false);
  };

  // Lote UX-3 (parte 2): ajustar el zoom para que la pagina (o el spread
  // completo) quepa en el area visible SIN scroll al entrar -- antes el
  // Stage se dibujaba siempre a PX_PER_MM fijo (3px/mm), mas alto que el
  // espacio disponible para casi cualquier tamano de pagina real (A4 a
  // 3px/mm = 891px de alto), forzando scroll vertical constante apenas se
  // abria una pagina (reportado por Carlos con capturas). El escalado se
  // aplica de forma NATIVA de Konva (Stage scaleX/scaleY dentro de
  // PageCanvas), nunca con un transform CSS por fuera -- asi Konva sigue
  // calculando correctamente la posicion del puntero al hacer click o
  // arrastrar un elemento, sin desalinearse respecto a lo que se ve.
  const canvasWrapRef = useRef(null);
  const [fitScale, setFitScale] = useState(1);

  useLayoutEffect(() => {
    const wrap = canvasWrapRef.current;
    if (!wrap || !publication || !currentView) return;

    const recomputeScale = () => {
      const stageWidthPx = publication.page_width * PX_PER_MM;
      const stageHeightPx = publication.page_height * PX_PER_MM;
      const isSpread = !!currentView.right;
      const CANVAS_WRAP_GAP = 3; // debe coincidir con el lomo de .editor-v2-canvas-wrap en CanvasEditorV2.css
      const contentWidthPx = isSpread ? stageWidthPx * 2 + CANVAS_WRAP_GAP : stageWidthPx;
      const availableWidth = wrap.clientWidth - 48; // padding horizontal del wrap (24px a cada lado)
      const availableHeight = wrap.clientHeight - 48; // padding vertical del wrap
      if (availableWidth <= 0 || availableHeight <= 0) return;
      const scale = Math.min(availableWidth / contentWidthPx, availableHeight / stageHeightPx, 1);
      setFitScale(scale > 0 ? scale : 1);
    };

    recomputeScale();
    const observer = new ResizeObserver(recomputeScale);
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [publication, currentView?.right, currentView?.left?.id]);

  if (loadErr) {
    return <div className="editor-v2-error">Error: {loadErr}</div>;
  }
  if (!publication || pages.length === 0 || !currentView) {
    return <div className="editor-v2-loading">Cargando publicación…</div>;
  }

  const totalPages = publication.total_pages ?? pages.length;
  const positionLabel = currentView.right
    ? `${activeLeftPageNumber}-${activeRightPageNumber} / ${totalPages}`
    : `${activeLeftPageNumber} / ${totalPages}`;

  return (
    <div className="editor-v2-layout">
      <header className="editor-v2-header">
        <button type="button" className="editor-v2-back" onClick={() => navigate('/publications')}>
          ← Volver a publicaciones
        </button>
        <h3 className="editor-v2-header-title">{publication.title}</h3>
        <span className="editor-v2-orientation">
          {publication.orientation === 'landscape' ? 'Horizontal' : 'Vertical'} · {publication.page_width}×{publication.page_height}mm
        </span>
      </header>

      <div className="editor-v2-body">
        <nav className="editor-v2-tools-rail">
          <ToolGroup>
            <ToolButton icon="select" label="Seleccionar" active />
            <ToolButton icon="hotspot" label="Hotspot" comingSoon disabled />
          </ToolGroup>

          <ToolGroup>
            <ToolButton
              icon="text"
              label="Texto"
              disabled={!canEdit}
              onClick={() => focusedStoreHook.getState().addElement('text', { props: { text: 'Texto', fontSize: 24, fill: '#111111' } })}
            />
          </ToolGroup>

          <ToolGroup>
            <ToolButton
              icon="line"
              label="Línea"
              disabled={!canEdit}
              onClick={() => focusedStoreHook.getState().addElement('shape', { width: 160, height: 4, props: { fill: '#14213d', shape_type: 'line', strokeWidth: 4 } })}
            />
            <ToolButton
              icon="rectangle"
              label="Rectángulo"
              disabled={!canEdit}
              onClick={() => focusedStoreHook.getState().addElement('shape', { props: { fill: '#14213d', shape_type: 'rect' } })}
            />
            <ToolButton
              icon="circle"
              label="Círculo"
              disabled={!canEdit}
              onClick={() => focusedStoreHook.getState().addElement('shape', { width: 120, height: 120, props: { fill: '#14213d', shape_type: 'circle' } })}
            />
            <ToolButton
              icon="star"
              label="Estrella"
              disabled={!canEdit}
              onClick={() => focusedStoreHook.getState().addElement('shape', { width: 120, height: 120, props: { fill: '#14213d', shape_type: 'star' } })}
            />
          </ToolGroup>

          <ToolGroup>
            <ToolButton icon="image" label="Imagen" disabled={!canEdit} onClick={handleUploadImageClick} />
            <ToolButton icon="gallery" label="Galería" disabled={!canEdit} onClick={handleUploadGalleryClick} />
            <ToolButton icon="gif" label="GIF" disabled={!canEdit} onClick={handleUploadGifClick} />
            <ToolButton icon="collage" label="Collage" disabled={!canEdit} onClick={handleUploadCollageClick} />
            <div className="editor-v2-plugins-wrap" ref={youtubeWrapRef}>
              <ToolButton
                icon="youtube"
                label="YouTube"
                disabled={!canEdit}
                active={embedMenuOpen === 'youtube'}
                onClick={() => handleOpenEmbedMenu('youtube')}
              />
              {embedMenuOpen === 'youtube' && (
                <RailPopover anchorRef={youtubeWrapRef} className="editor-v2-plugins-menu editor-v2-embed-menu">
                  {renderEmbedPopover()}
                </RailPopover>
              )}
            </div>
            <div className="editor-v2-plugins-wrap" ref={vimeoWrapRef}>
              <ToolButton
                icon="vimeo"
                label="Vimeo"
                disabled={!canEdit}
                active={embedMenuOpen === 'vimeo'}
                onClick={() => handleOpenEmbedMenu('vimeo')}
              />
              {embedMenuOpen === 'vimeo' && (
                <RailPopover anchorRef={vimeoWrapRef} className="editor-v2-plugins-menu editor-v2-embed-menu">
                  {renderEmbedPopover()}
                </RailPopover>
              )}
            </div>
            <ToolButton icon="audio" label="Audio" disabled={!canEdit} onClick={handleUploadAudioClick} />
            <ToolButton icon="video" label="Video" disabled={!canEdit} onClick={handleUploadVideoClick} />
            <div className="editor-v2-plugins-wrap" ref={soundcloudWrapRef}>
              <ToolButton
                icon="soundcloud"
                label="SoundCloud"
                disabled={!canEdit}
                active={embedMenuOpen === 'soundcloud'}
                onClick={() => handleOpenEmbedMenu('soundcloud')}
              />
              {embedMenuOpen === 'soundcloud' && (
                <RailPopover anchorRef={soundcloudWrapRef} className="editor-v2-plugins-menu editor-v2-embed-menu">
                  {renderEmbedPopover()}
                </RailPopover>
              )}
            </div>
          </ToolGroup>

          <ToolGroup>
            <div className="editor-v2-plugins-wrap" ref={pluginsWrapRef}>
              <ToolButton
                icon="plugins"
                label="Plugins (shortcodes)"
                disabled={!canEdit}
                active={pluginsMenuOpen}
                onClick={() => setPluginsMenuOpen((v) => !v)}
              />
              {pluginsMenuOpen && (
                <RailPopover anchorRef={pluginsWrapRef} className="editor-v2-plugins-menu">
                  <div className="editor-v2-plugins-menu-title">Insertar shortcode</div>
                  {SHORTCODES.map((sc) => (
                    <button key={sc.key} type="button" onClick={() => handleInsertShortcode(sc.key)}>
                      {'{{' + sc.key + '}}'} <span>{sc.label}</span>
                    </button>
                  ))}
                </RailPopover>
              )}
            </div>
          </ToolGroup>

          <ToolGroup>
            <div className="editor-v2-plugins-wrap" ref={libraryWrapRef}>
              <ToolButton
                icon="library"
                label="Library"
                active={libraryOpen}
                onClick={handleToggleLibrary}
              />
              {libraryOpen && (
                <RailPopover anchorRef={libraryWrapRef} className="editor-v2-plugins-menu editor-v2-library-menu">
                  <div className="editor-v2-plugins-menu-title">Biblioteca del tenant</div>
                  <div className="editor-v2-library-tabs">
                    {[
                      { key: 'all', label: 'Todos' },
                      { key: 'image', label: 'Imágenes' },
                      { key: 'audio', label: 'Audio' },
                      { key: 'video', label: 'Video' },
                    ].map((tab) => (
                      <button
                        key={tab.key}
                        type="button"
                        className={`editor-v2-tool ${libraryFilter === tab.key ? 'active' : ''}`}
                        onClick={() => handleLibraryFilterChange(tab.key)}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>
                  {libraryLoading && <p className="editor-v2-props-hint">Cargando biblioteca…</p>}
                  {!libraryLoading && libraryError && <p className="editor-v2-embed-error">{libraryError}</p>}
                  {!libraryLoading && !libraryError && libraryAssets.length === 0 && (
                    <p className="editor-v2-props-hint">
                      Todavía no hay assets en la biblioteca de este tenant -- sube una imagen, audio o video desde el rail y aparecerá aquí para reutilizarse.
                    </p>
                  )}
                  {!libraryLoading && !libraryError && libraryAssets.length > 0 && (
                    <ul className="editor-v2-library-grid">
                      {libraryAssets.map((asset) => (
                        <li key={asset.id}>
                          <button
                            type="button"
                            className="editor-v2-library-item"
                            disabled={!canEdit}
                            title={`Insertar ${asset.kind}`}
                            onClick={() => handleInsertFromLibrary(asset)}
                          >
                            {asset.kind === 'image' ? (
                              <img src={asset.url?.startsWith('http') ? asset.url : `${API_URL}${asset.url}`} alt="" />
                            ) : (
                              <span className="editor-v2-library-item-icon">
                                <Icon name={asset.kind === 'video' ? 'video' : 'audio'} size={22} />
                                <span>{asset.kind === 'video' ? 'Video' : 'Audio'}</span>
                              </span>
                            )}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </RailPopover>
              )}
            </div>
            <ToolButton icon="blocks" label="Blocks" comingSoon disabled />
          </ToolGroup>

          <input type="file" accept="image/*" ref={fileInputRef} style={{ display: 'none' }} onChange={handleFileChange} />
          <input type="file" accept="audio/*" ref={audioInputRef} style={{ display: 'none' }} onChange={handleAudioFileChange} />
          <input type="file" accept="video/*" ref={videoInputRef} style={{ display: 'none' }} onChange={handleVideoFileChange} />
          <input type="file" accept="image/*" multiple ref={galleryInputRef} style={{ display: 'none' }} onChange={handleGalleryFileChange} />
          <input type="file" accept="image/*" multiple ref={collageInputRef} style={{ display: 'none' }} onChange={handleCollageFileChange} />
          <input type="file" accept="image/gif" ref={gifInputRef} style={{ display: 'none' }} onChange={handleGifFileChange} />
          <input type="file" accept="image/*" multiple ref={galleryAppendInputRef} style={{ display: 'none' }} onChange={handleAppendGalleryImages} />
        </nav>

        <main className="editor-v2-main">
          {lockState === 'acquiring' && <div className="editor-v2-banner">Adquiriendo bloqueo de edición…</div>}
          {lockState === 'denied' && (
            <div className="editor-v2-banner editor-v2-banner-warn">{lockMessage} (modo solo lectura)</div>
          )}
          {combinedSaveError && (
            <div className="editor-v2-banner editor-v2-banner-error">
              {combinedSaveError.detail}
              {combinedSaveError.status === 409 && (
                <button type="button" onClick={handleReloadOnConflict}>
                  Recargar página
                </button>
              )}
            </div>
          )}

          <div className="editor-v2-toolbar">
            <button
              type="button"
              disabled={!canEdit || focusedState.selectedElementIds.length === 0}
              onClick={() => focusedStoreHook.getState().removeSelectedElements()}
            >
              Eliminar seleccionado{focusedState.selectedElementIds.length > 1 ? 's' : ''}
            </button>
            <span className="editor-v2-spacer" />
            {anyDirty && <span className="editor-v2-dirty">Cambios sin guardar</span>}
            <button type="button" className="editor-v2-save" disabled={!canEdit || anySaving || !anyDirty} onClick={handleSaveAll}>
              {anySaving ? 'Guardando…' : 'Guardar'}
            </button>
          </div>

          <div ref={canvasWrapRef} className={`editor-v2-canvas-wrap${currentView.right ? ' editor-v2-canvas-wrap-spread' : ''}`}>
            <div className={`editor-v2-page-slot${focusedSide === 'left' ? ' focused' : ''}`}>
              <PageCanvas
                useStoreHook={useLeftStore}
                canEdit={canEdit}
                publication={publication}
                pageNumber={activeLeftPageNumber}
                totalPages={totalPages}
                onFocus={() => setFocusedSide('left')}
                scale={fitScale}
              />
            </div>
            {currentView.right && (
              <div className={`editor-v2-page-slot${focusedSide === 'right' ? ' focused' : ''}`}>
                <PageCanvas
                  useStoreHook={useRightStore}
                  canEdit={canEdit}
                  publication={publication}
                  pageNumber={activeRightPageNumber}
                  totalPages={totalPages}
                  onFocus={() => setFocusedSide('right')}
                  scale={fitScale}
                />
              </div>
            )}
          </div>

          <div className="editor-v2-pagenav">
            <button type="button" onClick={handlePrev} disabled={currentViewIndex <= 0} aria-label="Hoja anterior">
              <Icon name="chevronLeft" size={16} /> Anterior
            </button>
            <span className="editor-v2-pagenav-position">
              <input
                type="number"
                min={1}
                max={totalPages}
                value={pageJumpDraft}
                onChange={(e) => setPageJumpDraft(e.target.value)}
                onBlur={commitPageJump}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.currentTarget.blur();
                  }
                }}
                aria-label="Ir a la página"
              />
              <span className="editor-v2-pagenav-label"> {currentView.right ? `(hoja ${positionLabel})` : `/ ${totalPages}`}</span>
            </span>
            <button type="button" onClick={handleNext} disabled={currentViewIndex >= spreadViews.length - 1} aria-label="Hoja siguiente">
              Siguiente <Icon name="chevronRight" size={16} />
            </button>
          </div>
        </main>

        <PropertiesPanel
          selectedElements={selectedElements}
          canEdit={canEdit}
          onUpdate={(patch) => selectedElements.length === 1 && focusedStoreHook.getState().updateElement(selectedElements[0].id, patch)}
          onAlign={handleAlign}
          onAppendImagesClick={handleUploadGalleryAppendClick}
          onOpenGalleryModal={handleOpenGalleryModal}
          onReorder={(direction) => selectedElements.length === 1 && focusedStoreHook.getState().reorderElement(selectedElements[0].id, direction)}
        />
      </div>
      {galleryModalOpen && selectedElements.length === 1 && selectedElements[0].kind === 'gallery' && (
        <GalleryModal
          el={selectedElements[0]}
          onClose={() => setGalleryModalOpen(false)}
          onSave={handleSaveGalleryModal}
          libraryImages={libraryAssets.filter((a) => a.kind === 'image')}
          libraryLoading={libraryLoading}
          onUploadFiles={uploadFilesSequentially}
        />
      )}
    </div>
  );
}
