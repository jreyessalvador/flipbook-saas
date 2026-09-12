import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Stage, Layer, Rect, Ellipse, Line, Star, Path, Group, Text as KonvaText, Image as KonvaImage, Transformer } from 'react-konva';
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
// Hotspot, YouTube, Vimeo, SoundCloud, Library, Blocks y Quick Actions --
// quedan para lotes siguientes, no bloquean lo ya verificado.
// Línea/Círculo/Estrella y Alinear/Distribuir (con selección múltiple,
// Lote 1), Plugins/shortcodes de texto (Lote 2), Audio (Lote 3) y
// Galería/Collage/GIF (Lote 4) SÍ son funcionales. GIF reutiliza kind=
// 'image' (Konva no anima GIFs -- limitación conocida, ver
// RECETA-DESARROLLO.md); Galería y Collage comparten kind='gallery' y solo
// difieren en props.layout ('grid'/'mosaic'), intercambiable después desde
// el panel de propiedades.
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

// Elemento de audio (Lote 3): en el canvas se representa con un icono fijo
// (Group con fondo + icono de altavoz) -- Konva no puede reproducir audio,
// asi que la reproduccion real de PRUEBA se ofrece en el panel de
// propiedades (ver PropertiesPanel) via un <audio controls> nativo del
// navegador. El overlay <audio> sincronizado sobre el propio canvas
// (como en el Reader final, Fase E) queda fuera de alcance de este lote --
// ver docs/arquitectura-editor-2026-09-12.md seccion 6.
function AudioElement({ el, canEdit, onSelect, onChange, shapeRef }) {
  const accent = '#4f46e5';
  return (
    <Group
      ref={shapeRef}
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
    >
      <Rect width={el.width} height={el.height} fill="#eef2ff" stroke={accent} strokeWidth={1.5} cornerRadius={8} />
      <Path data={ICON_PATHS.audio} x={14} y={el.height / 2 - 10} scaleX={1.1} scaleY={1.1} stroke={accent} strokeWidth={1.8} />
      <KonvaText text="Audio" x={44} y={el.height / 2 - 8} fontSize={14} fill={accent} />
    </Group>
  );
}

// Galería / Collage (Lote 4): comparten el mismo kind='gallery' y el mismo
// componente -- solo cambia props.layout ('grid': cuadricula uniforme,
// 'mosaic': una imagen grande a la izquierda + el resto apiladas a la
// derecha). Sin reordenar por arrastre en este MVP (agregar/quitar y
// cambiar de layout sí son funcionales).
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

function GalleryElement({ el, canEdit, onSelect, onChange, shapeRef }) {
  const images = el.props?.images || [];
  const layout = el.props?.layout || 'grid';
  const tiles = computeGalleryTiles(layout, images.length, el.width, el.height);
  return (
    <Group
      ref={shapeRef}
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
    >
      <Rect width={el.width} height={el.height} fill="#f3f4f6" stroke="#9ca3af" strokeWidth={1} />
      {images.map((img, i) => tiles[i] && <GalleryTile key={`${img.src}-${i}`} src={img.src} {...tiles[i]} />)}
      {images.length === 0 && (
        <KonvaText text="Galería vacía -- agrega imágenes desde el panel" x={10} y={el.height / 2 - 8} width={el.width - 20} fontSize={13} fill="#6b7280" />
      )}
    </Group>
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

function PropertiesPanel({ selectedElements, canEdit, onUpdate, onAlign, onAppendImagesClick }) {
  const count = selectedElements.length;
  const selectedElement = count === 1 ? selectedElements[0] : null;
  const disabled = !canEdit || !selectedElement;
  const kind = selectedElement?.kind;
  const shapeType = selectedElement?.props?.shape_type || 'rect';

  return (
    <aside className="editor-v2-properties">
      <div className="editor-v2-props-header">
        {count === 0 && 'Ningún elemento seleccionado'}
        {count === 1 && `Elemento: ${kind === 'image' ? 'Imagen' : kind === 'text' ? 'Texto' : kind === 'audio' ? 'Audio' : kind === 'gallery' ? (selectedElement?.props?.layout === 'mosaic' ? 'Collage' : 'Galería') : 'Figura'}`}
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
            </section>
          )}
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
function PageCanvas({ useStoreHook, canEdit, publication, pageNumber, totalPages, onFocus }) {
  const { elements, isLoading, loadError, selectedElementIds } = useStoreHook();

  const stageRef = useRef(null);
  const trRef = useRef(null);
  const shapeRefs = useRef({});
  const marqueeStartRef = useRef(null);
  const [marquee, setMarquee] = useState(null);

  useEffect(() => {
    const nodes = selectedElementIds.map((id) => shapeRefs.current[id]).filter(Boolean);
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
    return <div className="editor-v2-loading editor-v2-page-slot" style={{ width: stageWidthPx, height: stageHeightPx }}>Cargando página…</div>;
  }
  if (loadError) {
    return <div className="editor-v2-error editor-v2-page-slot" style={{ width: stageWidthPx, height: stageHeightPx }}>{loadError}</div>;
  }

  return (
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
            onSelect: (e) => {
              onFocus();
              if (canEdit) useStoreHook.getState().selectElement(el.id, { additive: e?.evt?.shiftKey });
            },
            onChange: (patch) => canEdit && useStoreHook.getState().updateElement(el.id, patch),
            shapeRef: (node) => {
              shapeRefs.current[el.id] = node;
            },
          };
          if (el.kind === 'image') return <ImageElement key={el.id} {...shared} />;
          if (el.kind === 'text') return <TextElement key={el.id} {...shared} shortcodeCtx={shortcodeCtx} />;
          if (el.kind === 'audio') return <AudioElement key={el.id} {...shared} />;
          if (el.kind === 'gallery') return <GalleryElement key={el.id} {...shared} />;
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
  const galleryInputRef = useRef(null);
  const collageInputRef = useRef(null);
  const gifInputRef = useRef(null);
  const galleryAppendInputRef = useRef(null);

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
  const handleUploadGalleryClick = () => galleryInputRef.current?.click();
  const handleUploadCollageClick = () => collageInputRef.current?.click();
  const handleUploadGifClick = () => gifInputRef.current?.click();
  const handleUploadGalleryAppendClick = () => galleryAppendInputRef.current?.click();

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

  const handleAlign = (type) => {
    const needs = DISTRIBUTE_ICONS.has(type) ? 3 : 2;
    if (selectedElements.length < needs) return;
    focusedStoreHook.getState().updateElements(computeAlignPatches(type, selectedElements));
  };

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
              onClick={() => focusedStoreHook.getState().addElement('shape', { width: 160, height: 4, props: { fill: '#4f46e5', shape_type: 'line', strokeWidth: 4 } })}
            />
            <ToolButton
              icon="rectangle"
              label="Rectángulo"
              disabled={!canEdit}
              onClick={() => focusedStoreHook.getState().addElement('shape', { props: { fill: '#4f46e5', shape_type: 'rect' } })}
            />
            <ToolButton
              icon="circle"
              label="Círculo"
              disabled={!canEdit}
              onClick={() => focusedStoreHook.getState().addElement('shape', { width: 120, height: 120, props: { fill: '#4f46e5', shape_type: 'circle' } })}
            />
            <ToolButton
              icon="star"
              label="Estrella"
              disabled={!canEdit}
              onClick={() => focusedStoreHook.getState().addElement('shape', { width: 120, height: 120, props: { fill: '#4f46e5', shape_type: 'star' } })}
            />
          </ToolGroup>

          <ToolGroup>
            <ToolButton icon="image" label="Imagen" disabled={!canEdit} onClick={handleUploadImageClick} />
            <ToolButton icon="gallery" label="Galería" disabled={!canEdit} onClick={handleUploadGalleryClick} />
            <ToolButton icon="gif" label="GIF" disabled={!canEdit} onClick={handleUploadGifClick} />
            <ToolButton icon="collage" label="Collage" disabled={!canEdit} onClick={handleUploadCollageClick} />
            <ToolButton icon="youtube" label="YouTube" comingSoon disabled />
            <ToolButton icon="vimeo" label="Vimeo" comingSoon disabled />
            <ToolButton icon="audio" label="Audio" disabled={!canEdit} onClick={handleUploadAudioClick} />
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
          <input type="file" accept="audio/*" ref={audioInputRef} style={{ display: 'none' }} onChange={handleAudioFileChange} />
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

          <div className={`editor-v2-canvas-wrap${currentView.right ? ' editor-v2-canvas-wrap-spread' : ''}`}>
            <div className={`editor-v2-page-slot${focusedSide === 'left' ? ' focused' : ''}`}>
              <PageCanvas
                useStoreHook={useLeftStore}
                canEdit={canEdit}
                publication={publication}
                pageNumber={activeLeftPageNumber}
                totalPages={totalPages}
                onFocus={() => setFocusedSide('left')}
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
        />
      </div>
    </div>
  );
}
