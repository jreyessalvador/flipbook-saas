import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { publicationAPI } from '../../services/publicationAPI';
import { pageAPI } from '../../services/pageAPI';
import { createPageEditorStore } from '../../store/pageEditorStore';
import { computeSpreadViews, PageCanvas } from './CanvasEditorV2';
import '../../styles/PageViewer.css';
import '../../styles/CanvasEditorV2.css'; // reutiliza .editor-v2-pagenav (barra inferior compacta, mismo lenguaje visual que el editor)

const PX_PER_MM = 3; // debe coincidir con PX_PER_MM de CanvasEditorV2.jsx

function findViewIndexForPageId(views, pageId) {
  if (!pageId) return -1;
  return views.findIndex((v) => v.left?.id === pageId || v.right?.id === pageId);
}

function findViewIndexForPageNumber(views, pageNumber) {
  return views.findIndex((v) => v.left?.page_number === pageNumber || v.right?.page_number === pageNumber);
}

// Lote UX-3 (parte 2): reescrito por completo. El PageViewer anterior NO
// renderizaba contenido real -- comprobaba `page.content` (el blob JSON
// deprecado desde la Fase A, nunca escrito por el editor nuevo) y por eso
// SIEMPRE mostraba "Página vacía", incluso en páginas con elementos reales
// ya guardados (bug real encontrado a partir de la captura de Carlos, no
// solo un problema de miniatura/zoom). Ahora reutiliza exactamente el mismo
// PageCanvas/store/fit-to-screen que el editor, en modo solo lectura
// (canEdit=false) -- misma logica de agrupacion en spreads
// (computeSpreadViews), mismo footer compacto de navegacion.
const PageViewer = () => {
  const { id } = useParams();
  const navigate = useNavigate();

  const [publication, setPublication] = useState(null);
  const [pages, setPages] = useState([]);
  const [loadErr, setLoadErr] = useState(null);
  const [viewMode, setViewMode] = useState('dual'); // dual o single -- el usuario puede forzar hoja simple incluso en interiores

  const [pageJumpDraft, setPageJumpDraft] = useState('');

  useEffect(() => {
    let cancelled = false;
    Promise.all([publicationAPI.get(id), pageAPI.getPublicationPages(id)])
      .then(([pub, pgs]) => {
        if (cancelled) return;
        setPublication(pub);
        setPages(pgs);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('Error loading publication/pages:', err);
        setLoadErr('Error al cargar la publicación');
      });
    return () => { cancelled = true; };
  }, [id]);

  const totalPages = publication?.total_pages ?? pages.length;

  // En modo 'single' cada pagina es su propia vista (sin pares); en 'dual'
  // se reutiliza EXACTAMENTE la misma agrupacion que el editor
  // (computeSpreadViews) para que el comportamiento sea consistente.
  const views = useMemo(() => {
    if (pages.length === 0) return [];
    if (viewMode === 'single') {
      return [...pages].sort((a, b) => a.page_number - b.page_number).map((p) => ({ left: p, right: null }));
    }
    return computeSpreadViews(pages, totalPages);
  }, [pages, totalPages, viewMode]);

  const [currentViewIndex, setCurrentViewIndex] = useState(0);
  useEffect(() => {
    // Al cambiar de modo (dual/single) o cargar las paginas, intenta
    // mantener la MISMA pagina izquierda visible en vez de resetear a 0.
    setCurrentViewIndex((prevIdx) => {
      if (views.length === 0) return 0;
      const prevLeftId = views[prevIdx]?.left?.id;
      if (prevLeftId) {
        const idx = findViewIndexForPageId(views, prevLeftId);
        if (idx >= 0) return idx;
      }
      return 0;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [views]);

  const currentView = views[currentViewIndex];

  const [useLeftStore] = useState(() => createPageEditorStore());
  const [useRightStore] = useState(() => createPageEditorStore());
  const leftPageId = currentView?.left?.id || null;
  const rightPageId = currentView?.right?.id || null;

  useEffect(() => {
    if (leftPageId) useLeftStore.getState().loadPage(leftPageId);
  }, [leftPageId, useLeftStore]);
  useEffect(() => {
    if (rightPageId) useRightStore.getState().loadPage(rightPageId);
    else useRightStore.setState({ elements: [], pageId: null, isLoading: false });
  }, [rightPageId, useRightStore]);

  const activeLeftPageNumber = currentView?.left?.page_number;
  const activeRightPageNumber = currentView?.right?.page_number;

  useEffect(() => {
    setPageJumpDraft(activeLeftPageNumber ? String(activeLeftPageNumber) : '');
  }, [activeLeftPageNumber]);

  const goToViewIndex = (idx) => {
    if (idx < 0 || idx >= views.length) return;
    setCurrentViewIndex(idx);
  };
  const handlePrev = () => goToViewIndex(currentViewIndex - 1);
  const handleNext = () => goToViewIndex(currentViewIndex + 1);
  const commitPageJump = () => {
    const n = parseInt(pageJumpDraft, 10);
    if (!Number.isFinite(n) || n < 1 || n > totalPages) {
      setPageJumpDraft(activeLeftPageNumber ? String(activeLeftPageNumber) : '');
      return;
    }
    const idx = findViewIndexForPageNumber(views, n);
    if (idx >= 0) setCurrentViewIndex(idx);
  };

  // Fit-to-screen: identico criterio al editor (ver CanvasEditorV2.jsx) --
  // el Stage se escala con Konva (scaleX/scaleY, nunca CSS transform) para
  // caber siempre en el area visible sin scroll al entrar a una pagina.
  const canvasWrapRef = useRef(null);
  const [fitScale, setFitScale] = useState(1);
  useLayoutEffect(() => {
    const wrap = canvasWrapRef.current;
    if (!wrap || !publication || !currentView) return;
    const recomputeScale = () => {
      const stageWidthPx = publication.page_width * PX_PER_MM;
      const stageHeightPx = publication.page_height * PX_PER_MM;
      const isSpread = !!currentView.right;
      const CANVAS_WRAP_GAP = 24;
      const contentWidthPx = isSpread ? stageWidthPx * 2 + CANVAS_WRAP_GAP : stageWidthPx;
      const availableWidth = wrap.clientWidth - 48;
      const availableHeight = wrap.clientHeight - 48;
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
    return (
      <div className="page-viewer-container">
        <div className="error-message">{loadErr}</div>
        <button onClick={() => navigate('/publications')} className="btn-secondary">
          Volver a Publicaciones
        </button>
      </div>
    );
  }
  if (!publication || pages.length === 0 || !currentView) {
    return (
      <div className="page-viewer-container">
        <div className="loading">Cargando páginas...</div>
      </div>
    );
  }

  const positionLabel = currentView.right
    ? `${activeLeftPageNumber}-${activeRightPageNumber} / ${totalPages}`
    : `${activeLeftPageNumber} / ${totalPages}`;

  return (
    <div className="page-viewer-container">
      <div className="viewer-header">
        <div className="header-left">
          <button onClick={() => navigate('/publications')} className="btn-back">
            ← Volver
          </button>
          <h2>{publication.title}</h2>
        </div>
        <div className="header-right">
          <div className="view-mode-toggle">
            <button
              className={viewMode === 'single' ? 'active' : ''}
              onClick={() => setViewMode('single')}
              title="Vista simple"
            >
              📄
            </button>
            <button
              className={viewMode === 'dual' ? 'active' : ''}
              onClick={() => setViewMode('dual')}
              title="Vista dual"
            >
              📖
            </button>
          </div>
          <button onClick={() => navigate(`/publications/${id}/edit/${leftPageId}`)} className="btn-primary">
            Editar Contenido
          </button>
        </div>
      </div>

      <div ref={canvasWrapRef} className={`editor-v2-canvas-wrap page-viewer-canvas-wrap${currentView.right ? ' editor-v2-canvas-wrap-spread' : ''}`}>
        <div className="editor-v2-page-slot">
          <PageCanvas
            useStoreHook={useLeftStore}
            canEdit={false}
            publication={publication}
            pageNumber={activeLeftPageNumber}
            totalPages={totalPages}
            onFocus={() => {}}
            scale={fitScale}
          />
        </div>
        {currentView.right && (
          <div className="editor-v2-page-slot">
            <PageCanvas
              useStoreHook={useRightStore}
              canEdit={false}
              publication={publication}
              pageNumber={activeRightPageNumber}
              totalPages={totalPages}
              onFocus={() => {}}
              scale={fitScale}
            />
          </div>
        )}
      </div>

      {/* Barra inferior compacta (Lote UX-3 parte 2): reemplaza la franja
          alta anterior de "Controles de navegación" + la fila de
          miniaturas por cada pagina (que ocupaba demasiado alto, reportado
          por Carlos) -- mismas clases .editor-v2-pagenav que el editor. */}
      <div className="editor-v2-pagenav">
        <button type="button" onClick={handlePrev} disabled={currentViewIndex <= 0} aria-label="Hoja anterior">
          ← Anterior
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
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
            aria-label="Ir a la página"
          />
          <span className="editor-v2-pagenav-label"> {currentView.right ? `(hoja ${positionLabel})` : `/ ${totalPages}`}</span>
        </span>
        <button type="button" onClick={handleNext} disabled={currentViewIndex >= views.length - 1} aria-label="Hoja siguiente">
          Siguiente →
        </button>
      </div>
    </div>
  );
};

export default PageViewer;
