import React, { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Stage, Layer, Rect, Text as KonvaText, Image as KonvaImage, Transformer } from 'react-konva';
import { usePageEditorStore } from '../../store/pageEditorStore';
import { publicationAPI } from '../../services/publicationAPI';
import { pageAPI } from '../../services/pageAPI';
import { assetAPI } from '../../services/assetAPI';
import { lockAPI } from '../../services/lockAPI';
import { API_URL } from '../../services/api';
import '../../styles/CanvasEditorV2.css';

// Fase B -- editor canvas mínimo (image/text/shape). Ver
// docs/arquitectura-editor-2026-09-12.md secciones 4-6 y RECETA-DESARROLLO.md
// sección 7. video/audio/hotspot quedan para Fase C/D.

const PX_PER_MM = 3; // escala fija de visualización, no afecta a los datos guardados (siempre en "unidades de página")
const HEARTBEAT_MS = 20000; // el lock expira a los 60s sin heartbeat (backend/app/api/locks.py)

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

function ShapeElement({ el, canEdit, onSelect, onChange, shapeRef }) {
  return (
    <Rect
      ref={shapeRef}
      x={el.x}
      y={el.y}
      width={el.width}
      height={el.height}
      rotation={el.rotation_deg}
      fill={el.props?.fill || '#4f46e5'}
      draggable={canEdit}
      onClick={onSelect}
      onTap={onSelect}
      onDragEnd={(e) => onChange({ x: e.target.x(), y: e.target.y() })}
      onTransformEnd={(e) => handleTransformEnd(e.target, onChange)}
    />
  );
}

function TextElement({ el, canEdit, onSelect, onChange, shapeRef }) {
  const handleEdit = () => {
    if (!canEdit) return;
    // Edición de texto simplificada para el MVP de Fase B -- ver
    // RECETA-DESARROLLO.md: un editor inline (contentEditable superpuesto al
    // canvas) queda como refinamiento posterior, no bloqueante.
    const next = window.prompt('Editar texto:', el.props?.text || '');
    if (next !== null) onChange({ props: { ...el.props, text: next } });
  };
  return (
    <KonvaText
      ref={shapeRef}
      x={el.x}
      y={el.y}
      width={el.width}
      height={el.height}
      rotation={el.rotation_deg}
      text={el.props?.text || 'Texto'}
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

export default function CanvasEditorV2() {
  const { id: publicationId, pageId: pageIdParam } = useParams();
  const navigate = useNavigate();

  const [publication, setPublication] = useState(null);
  const [pages, setPages] = useState([]);
  const [loadErr, setLoadErr] = useState(null);

  // acquiring | held | denied
  const [lockState, setLockState] = useState('acquiring');
  const [lockMessage, setLockMessage] = useState('');

  const store = usePageEditorStore();
  const { elements, isLoading, isSaving, isDirty, loadError, saveError, selectedElementId } = store;

  const stageRef = useRef(null);
  const trRef = useRef(null);
  const shapeRefs = useRef({});
  const fileInputRef = useRef(null);

  const activePageId = pageIdParam || pages[0]?.id;
  const canEdit = lockState === 'held';

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

  // Adjuntar el Transformer al nodo Konva seleccionado.
  useEffect(() => {
    const node = selectedElementId ? shapeRefs.current[selectedElementId] : null;
    if (trRef.current) {
      trRef.current.nodes(node ? [node] : []);
      trRef.current.getLayer()?.batchDraw();
    }
  }, [selectedElementId, elements]);

  // Borrar con teclado (Delete/Backspace) cuando hay un elemento seleccionado
  // y el foco no está en un input de texto.
  useEffect(() => {
    const onKeyDown = (e) => {
      const tag = document.activeElement?.tagName;
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedElementId && tag !== 'INPUT' && tag !== 'TEXTAREA') {
        store.removeElement(selectedElementId);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedElementId]);

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

  if (loadErr) {
    return <div className="editor-v2-error">Error: {loadErr}</div>;
  }
  if (!publication || pages.length === 0 || !activePageId) {
    return <div className="editor-v2-loading">Cargando publicación…</div>;
  }

  const stageWidthPx = publication.page_width * PX_PER_MM;
  const stageHeightPx = publication.page_height * PX_PER_MM;
  const sortedElements = [...elements].sort((a, b) => (a.z_index ?? 0) - (b.z_index ?? 0));

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
          <button type="button" disabled={!canEdit} onClick={() => store.addElement('text', { props: { text: 'Texto', fontSize: 24, fill: '#111111' } })}>
            + Texto
          </button>
          <button type="button" disabled={!canEdit} onClick={() => store.addElement('shape', { props: { fill: '#4f46e5' } })}>
            + Figura
          </button>
          <button type="button" disabled={!canEdit} onClick={handleUploadImageClick}>
            + Imagen
          </button>
          <button type="button" disabled={!canEdit || !selectedElementId} onClick={() => selectedElementId && store.removeElement(selectedElementId)}>
            Eliminar seleccionado
          </button>
          <input type="file" accept="image/*" ref={fileInputRef} style={{ display: 'none' }} onChange={handleFileChange} />
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
              onMouseDown={(e) => {
                if (e.target === e.target.getStage()) store.selectElement(null);
              }}
            >
              <Layer>
                <Rect x={0} y={0} width={stageWidthPx} height={stageHeightPx} fill="#ffffff" listening={false} />
                {sortedElements.map((el) => {
                  const shared = {
                    key: el.id,
                    el,
                    canEdit,
                    onSelect: () => canEdit && store.selectElement(el.id),
                    onChange: (patch) => canEdit && store.updateElement(el.id, patch),
                    shapeRef: (node) => {
                      shapeRefs.current[el.id] = node;
                    },
                  };
                  if (el.kind === 'image') return <ImageElement {...shared} />;
                  if (el.kind === 'text') return <TextElement {...shared} />;
                  return <ShapeElement {...shared} />;
                })}
                {canEdit && <Transformer ref={trRef} rotateEnabled resizeEnabled />}
              </Layer>
            </Stage>
          </div>
        )}
      </main>
    </div>
  );
}
