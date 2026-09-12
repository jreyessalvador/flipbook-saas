import React, { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Stage, Layer, Rect, Ellipse, Line, Star, Text as KonvaText, Image as KonvaImage, Transformer } from 'react-konva';
import { usePageEditorStore } from '../../store/pageEditorStore';
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
// Hotspot, Galería, GIF, Collage, YouTube, Vimeo, Audio, SoundCloud,
// Library, Blocks y Quick Actions -- quedan para lotes siguientes, no
// bloquean lo ya verificado. Línea/Círculo/Estrella y Alinear/Distribuir
// (con selección múltiple, Lote 1) y Plugins/shortcodes de texto (Lote 2)
// SÍ son funcionales.

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

function ImageElement({ el, canEdit, onSelect, onChange, shapeRef }) {
  const image = useHtmlImage(el.props?.src);
  return (
    <KonvaImage
      ref={shapeRef}
      image={image}
      x={el.x}
      y={el.y}
      width={el.width}
      height={el.height}
      rotation={el.rotation_deg}
      draggable={canEdit}
      onClick={onSelect}
      onTap={onSelect}
      onDragEnd={(e) => onChange({ x: e.target.x(), y: e.target.y() })}
      onTransformEnd={(e) => handleTransformEnd(e.target, onChange)}
    />
  );
}

// Un solo componente para las 4 variantes de 'shape' (rect/línea/círculo/
// estrella) -- todas comparten el mismo modelo de datos (x, y, width, height
// como caja contenedora) para no duplicar el manejo de arrastre/transformar/
// guardado; solo cambia qué nodo Konva se dibuja dentro de esa caja.
function ShapeElement({ el, canEdit, onSelect, onChange, shapeRef }) {
  const shapeType = el.props?.shape_type || 'rect';
  const fill = el.props?.fill || '#4f46e5';
  const common = {
    ref: shapeRef,
    rotation: el.rotation_deg,
    draggable: canEdit,
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

function TextElement({ el, canEdit, onSelect, onChange, shapeRef, shortcodeCtx }) {
  const handleEdit = () => {
    if (!canEdit) return;
    // Edición de texto simplificada para el MVP de Fase B -- ver
    // RECETA-DESARROLLO.md: un editor inline (contentEditable superpuesto al
    // canvas) queda como refinamiento posterior, no bloqueante. Se edita la
    // PLANTILLA con shortcodes sin resolver (p.ej. "{{fecha}}"), no el valor
    // ya resuelto que se ve en el canvas.
    const next = window.prompt('Editar texto (admite shortcodes {{fecha}}, {{numero_pagina}}, {{total_paginas}}, {{titulo_publicacion}}):', el.props?.text || '');
    if (next !== null) onChange({ props: { ...el.props, text: next } });
  };
  const displayText = resolveShortcodes(el.props?.text || 'Texto', shortcodeCtx || {});
  return (
    <KonvaText
      ref={shapeRef}
      x={el.x}
      y={el.y}
      width={el.width}
      height={el.height}
      rotation={el.rotation_deg}
      text={displayText}
      fontSize={el.props?.fontSize || 24}
      fill={el.props?.fill || '#111111'}
      draggable={canEdit}
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

// Iconos del renglón "Alinear y distribuir" -- alinear necesita 2+
// elementos seleccionados, distribuir necesita 3+ (con solo 2 no hay nada
// intermedio que espaciar).
const ALIGN_ROW_ICONS = ['alignLeft', 'alignCenterH', 'alignRight', 'distributeH', 'alignTop', 'alignMiddleV', 'alignBottom', 'distributeV'];
const DISTRIBUTE_ICONS = new Set(['distributeH', 'distributeV']);

function PropertiesPanel({ selectedElements, canEdit, onUpdate, onAlign }) {
  const count = selectedElements.length;
  const selectedElement = count === 1 ? selectedElements[0] : null;
  const disabled = !canEdit || !selectedElement;
  const kind = selectedElement?.kind;
  const shapeType = selectedElement?.props?.shape_type || 'rect';

  return (
    <aside className="editor-v2-properties">
      <div className="editor-v2-props-header">
        {count === 0 && 'Ningún elemento seleccionado'}
        {count === 1 && `Elemento: ${kind === 'image' ? 'Imagen' : kind === 'text' ? 'Texto' : 'Figura'}`}
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
                  value={selectedElement?.props?.fill || '#4f46e5'}
                  onChange={(e) => onUpdate({ props: { ...selectedElement.props, fill: e.target.value } })}
                />
              </label>
            )}
            {kind === 'shape' && shapeType === 'rect' && (
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
            {!kind && <p className="editor-v2-props-hint">Selecciona un elemento para ver sus opciones.</p>}
          </section>
        </>
      )}

      <section className="editor-v2-props-section">
        <h4>Quick Actions</h4>
        <button type="button" className="editor-v2-quickaction coming-soon" disabled title="Próximamente">
          Configuración del elemento
        </button>
        <button type="button" className="editor-v2-quickaction coming-soon" disabled title="Próximamente">
          Guardar como bloque de plantilla
        </button>
        <button type="button" className="editor-v2-quickaction coming-soon" disabled title="Próximamente">
          Animar
        </button>
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

export default function CanvasEditorV2() {
  const { id: publicationId, pageId: pageIdParam } = useParams();
  const navigate = useNavigate();

  const [publication, setPublication] = useState(null);
  const [pages, setPages] = useState([]);
  const [loadErr, setLoadErr] = useState(null);

  // acquiring | held | denied
  const [lockState, setLockState] = useState('acquiring');
  const [lockMessage, setLockMessage] = useState('');

  // Rectángulo de selección (marquee-select) mientras el usuario arrastra
  // sobre el fondo del canvas -- estado puramente visual/local, no vive en
  // el store (no se guarda ni afecta a otras páginas).
  const [marquee, setMarquee] = useState(null); // { x, y, width, height } | null
  const marqueeStartRef = useRef(null);
  const [pluginsMenuOpen, setPluginsMenuOpen] = useState(false);

  const store = usePageEditorStore();

  // Hook de depuracion SOLO en dev (Vite lo elimina del build de produccion):
  // permite inspeccionar el estado real del store desde fuera de React
  // (p.ej. scripts de verificacion con Playwright) sin exponer nada en produccion.
  if (import.meta.env.DEV) {
    window.__pageEditorStore = store;
  }
  const { elements, isLoading, isSaving, isDirty, loadError, saveError, selectedElementIds } = store;

  const stageRef = useRef(null);
  const trRef = useRef(null);
  const shapeRefs = useRef({});
  const fileInputRef = useRef(null);

  const activePageId = pageIdParam || pages[0]?.id;
  const canEdit = lockState === 'held';
  const selectedElements = elements.filter((e) => selectedElementIds.includes(e.id));

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

  // Si no se especificó página en la URL, redirigir a la primera en cuanto se conoce.
  useEffect(() => {
    if (!pageIdParam && pages.length > 0) {
      navigate(`/publications/${publicationId}/edit/${pages[0].id}`, { replace: true });
    }
  }, [pageIdParam, pages, publicationId, navigate]);

  // Lock de edición de la publicación completa: se adquiere UNA vez al entrar
  // al editor (no por página) y se libera al salir. Heartbeat mientras dure.
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

  // Cargar la página activa CADA VEZ que cambia. store.loadPage() reemplaza
  // TODO el estado -- nunca reutiliza el de la página anterior (ver
  // comentario extenso en store/pageEditorStore.js sobre la causa raíz del
  // bug original).
  useEffect(() => {
    if (!activePageId) return undefined;
    store.loadPage(activePageId);
    return () => store.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePageId]);

  // Adjuntar el Transformer a TODOS los nodos Konva seleccionados (Konva
  // soporta redimensionar/rotar varios nodos a la vez como grupo de forma
  // nativa vía Transformer.nodes([...])).
  useEffect(() => {
    const nodes = selectedElementIds.map((id) => shapeRefs.current[id]).filter(Boolean);
    if (trRef.current) {
      trRef.current.nodes(nodes);
      trRef.current.getLayer()?.batchDraw();
    }
  }, [selectedElementIds, elements]);

  // Borrar con teclado (Delete/Backspace) cuando hay elementos seleccionados
  // y el foco no está en un input de texto.
  useEffect(() => {
    const onKeyDown = (e) => {
      const tag = document.activeElement?.tagName;
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedElementIds.length > 0 && tag !== 'INPUT' && tag !== 'TEXTAREA') {
        store.removeSelectedElements();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedElementIds]);

  const handleSelectPage = (newPageId) => {
    if (newPageId === activePageId) return;
    if (isDirty && !window.confirm('Tienes cambios sin guardar en esta página. ¿Descartarlos y cambiar de página?')) {
      return;
    }
    navigate(`/publications/${publicationId}/edit/${newPageId}`);
  };

  const handleUploadImageClick = () => fileInputRef.current?.click();

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const uploaded = await assetAPI.upload(file);
      store.addElement('image', { width: 200, height: 200, props: { src: uploaded.url } });
    } catch (err) {
      window.alert(err?.response?.data?.detail || 'No se pudo subir la imagen');
    }
  };

  const handleInsertShortcode = (key) => {
    if (!canEdit) return;
    const onlyTextSelected = selectedElements.length === 1 && selectedElements[0].kind === 'text';
    if (onlyTextSelected) {
      const el = selectedElements[0];
      const current = el.props?.text || '';
      const sep = current && !current.endsWith(' ') ? ' ' : '';
      store.updateElement(el.id, { props: { ...el.props, text: `${current}${sep}{{${key}}}` } });
    } else {
      store.addElement('text', { props: { text: `{{${key}}}`, fontSize: 24, fill: '#111111' } });
    }
    setPluginsMenuOpen(false);
  };

  const handleAlign = (type) => {
    const needs = DISTRIBUTE_ICONS.has(type) ? 3 : 2;
    if (selectedElements.length < needs) return;
    store.updateElements(computeAlignPatches(type, selectedElements));
  };

  // --- Marquee-select (rectángulo de selección arrastrando sobre el fondo) --
  const handleStageMouseDown = (e) => {
    if (e.target !== e.target.getStage()) return; // click sobre un elemento, no el fondo
    const pos = e.target.getStage().getPointerPosition();
    if (!e.evt.shiftKey) store.selectElement(null);
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
    if (hitIds.length > 0) store.selectElements(hitIds);
  };

  if (loadErr) {
    return <div className="editor-v2-error">Error: {loadErr}</div>;
  }
  if (!publication || pages.length === 0 || !activePageId) {
    return <div className="editor-v2-loading">Cargando publicación…</div>;
  }

  const stageWidthPx = publication.page_width * PX_PER_MM;
  const stageHeightPx = publication.page_height * PX_PER_MM;
  const sortedElements = [...elements].sort((a, b) => (a.z_index ?? 0) - (b.z_index ?? 0));
  const activePageNumber = pages.find((p) => p.id === activePageId)?.page_number;
  const shortcodeCtx = { pageNumber: activePageNumber, totalPages: pages.length, publicationTitle: publication.title };

  return (
    <div className="editor-v2-layout">
      <aside className="editor-v2-sidebar">
        <h3>{publication.title}</h3>
        <p className="editor-v2-orientation">
          {publication.orientation === 'landscape' ? 'Horizontal' : 'Vertical'} · {publication.page_width}×{publication.page_height}mm
        </p>
        <ul className="editor-v2-pagelist">
          {pages.map((p) => (
            <li key={p.id} className={p.id === activePageId ? 'active' : ''} onClick={() => handleSelectPage(p.id)}>
              {p.page_number}. {p.page_type === 'cover' ? 'Portada' : p.page_type === 'back_cover' ? 'Contraportada' : 'Interior'}
            </li>
          ))}
        </ul>
        <button type="button" onClick={() => navigate('/publications')}>
          Volver a publicaciones
        </button>
      </aside>

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
            onClick={() => store.addElement('text', { props: { text: 'Texto', fontSize: 24, fill: '#111111' } })}
          />
        </ToolGroup>

        <ToolGroup>
          <ToolButton
            icon="line"
            label="Línea"
            disabled={!canEdit}
            onClick={() => store.addElement('shape', { width: 160, height: 4, props: { fill: '#4f46e5', shape_type: 'line', strokeWidth: 4 } })}
          />
          <ToolButton
            icon="rectangle"
            label="Rectángulo"
            disabled={!canEdit}
            onClick={() => store.addElement('shape', { props: { fill: '#4f46e5', shape_type: 'rect' } })}
          />
          <ToolButton
            icon="circle"
            label="Círculo"
            disabled={!canEdit}
            onClick={() => store.addElement('shape', { width: 120, height: 120, props: { fill: '#4f46e5', shape_type: 'circle' } })}
          />
          <ToolButton
            icon="star"
            label="Estrella"
            disabled={!canEdit}
            onClick={() => store.addElement('shape', { width: 120, height: 120, props: { fill: '#4f46e5', shape_type: 'star' } })}
          />
        </ToolGroup>

        <ToolGroup>
          <ToolButton icon="image" label="Imagen" disabled={!canEdit} onClick={handleUploadImageClick} />
          <ToolButton icon="gallery" label="Galería" comingSoon disabled />
          <ToolButton icon="gif" label="GIF" comingSoon disabled />
          <ToolButton icon="collage" label="Collage" comingSoon disabled />
          <ToolButton icon="youtube" label="YouTube" comingSoon disabled />
          <ToolButton icon="vimeo" label="Vimeo" comingSoon disabled />
          <ToolButton icon="audio" label="Audio" comingSoon disabled />
          <ToolButton icon="soundcloud" label="SoundCloud" comingSoon disabled />
        </ToolGroup>

        <ToolGroup>
          <div className="editor-v2-plugins-wrap">
            <ToolButton
              icon="plugins"
              label="Plugins (shortcodes)"
              disabled={!canEdit}
              active={pluginsMenuOpen}
              onClick={() => setPluginsMenuOpen((v) => !v)}
            />
            {pluginsMenuOpen && (
              <div className="editor-v2-plugins-menu">
                <div className="editor-v2-plugins-menu-title">Insertar shortcode</div>
                {SHORTCODES.map((sc) => (
                  <button key={sc.key} type="button" onClick={() => handleInsertShortcode(sc.key)}>
                    {'{{' + sc.key + '}}'} <span>{sc.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </ToolGroup>

        <ToolGroup>
          <ToolButton icon="library" label="Library" comingSoon disabled />
          <ToolButton icon="blocks" label="Blocks" comingSoon disabled />
        </ToolGroup>

        <input type="file" accept="image/*" ref={fileInputRef} style={{ display: 'none' }} onChange={handleFileChange} />
      </nav>

      <main className="editor-v2-main">
        {lockState === 'acquiring' && <div className="editor-v2-banner">Adquiriendo bloqueo de edición…</div>}
        {lockState === 'denied' && (
          <div className="editor-v2-banner editor-v2-banner-warn">{lockMessage} (modo solo lectura)</div>
        )}
        {saveError && (
          <div className="editor-v2-banner editor-v2-banner-error">
            {saveError.detail}
            {saveError.status === 409 && (
              <button type="button" onClick={() => store.loadPage(activePageId)}>
                Recargar página
              </button>
            )}
          </div>
        )}

        <div className="editor-v2-toolbar">
          <button type="button" disabled={!canEdit || selectedElementIds.length === 0} onClick={() => store.removeSelectedElements()}>
            Eliminar seleccionado{selectedElementIds.length > 1 ? 's' : ''}
          </button>
          <span className="editor-v2-spacer" />
          {isDirty && <span className="editor-v2-dirty">Cambios sin guardar</span>}
          <button type="button" className="editor-v2-save" disabled={!canEdit || isSaving || !isDirty} onClick={() => store.save()}>
            {isSaving ? 'Guardando…' : 'Guardar'}
          </button>
        </div>

        {isLoading ? (
          <div className="editor-v2-loading">Cargando página…</div>
        ) : loadError ? (
          <div className="editor-v2-error">{loadError}</div>
        ) : (
          <div className="editor-v2-canvas-wrap">
            <Stage
              ref={stageRef}
              width={stageWidthPx}
              height={stageHeightPx}
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
                    onSelect: (e) => canEdit && store.selectElement(el.id, { additive: e?.evt?.shiftKey }),
                    onChange: (patch) => canEdit && store.updateElement(el.id, patch),
                    shapeRef: (node) => {
                      shapeRefs.current[el.id] = node;
                    },
                  };
                  if (el.kind === 'image') return <ImageElement key={el.id} {...shared} />;
                  if (el.kind === 'text') return <TextElement key={el.id} {...shared} shortcodeCtx={shortcodeCtx} />;
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
                    stroke="#4f46e5"
                    strokeWidth={1}
                    listening={false}
                  />
                )}
              </Layer>
            </Stage>
          </div>
        )}
      </main>

      <PropertiesPanel
        selectedElements={selectedElements}
        canEdit={canEdit}
        onUpdate={(patch) => selectedElements.length === 1 && store.updateElement(selectedElements[0].id, patch)}
        onAlign={handleAlign}
      />
    </div>
  );
}
