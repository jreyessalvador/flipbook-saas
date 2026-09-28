import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../services/AuthContext';
import { can } from '../../services/permissions';
import { useParams, useNavigate } from 'react-router-dom';
import { publicationAPI } from '../../services/publicationAPI';
import { pageAPI } from '../../services/pageAPI';
import { elementAPI } from '../../services/elementAPI';
import { collectElementImageUrls, preloadImages } from '../../services/imageCache';
import { computeSpreadViews } from './CanvasEditorV2';
import FlipBook, { pagesOfView } from '../reader/FlipBook';
import StaticPage from '../reader/StaticPage';
import '../../styles/PageViewer.css';
import Icon from '../common/Icon';
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
  const { user } = useAuth();
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

  // Lote FLIP-2 (28-sep-2026): pasar pagina con hoja real (FlipBook).
  // Antes (UX-12) giraba el spread completo y los elementos de la pagina
  // nueva se pedian a la API DESPUES del giro -- por eso se veia una hoja
  // gris y luego "Cargando pagina...". Ahora los elementos se guardan en una
  // cache de solo lectura por pagina, se precargan las hojas vecinas y el
  // FlipBook no empieza a girar hasta tener datos + imagenes listos.
  // (Solo lectura: cada StaticPage copia los elementos a su propio store, la
  // advertencia de elementAPI.js sobre no compartir elements aplica al editor.)
  const flipBookRef = useRef(null);
  const [pageData, setPageData] = useState({}); // pageId -> { elements, error }
  const pageDataRef = useRef({});
  const inflightRef = useRef(new Map());

  const fetchPage = useCallback((pageId) => {
    if (!pageId) return Promise.resolve(null);
    if (pageDataRef.current[pageId]) return Promise.resolve(pageDataRef.current[pageId]);
    if (inflightRef.current.has(pageId)) return inflightRef.current.get(pageId);
    const req = elementAPI.get(pageId)
      .then((data) => ({ elements: data.elements || [], error: null }))
      .catch((err) => ({ elements: [], error: err?.response?.data?.detail || 'No se pudo cargar la página' }))
      .then((entry) => {
        inflightRef.current.delete(pageId);
        if (!entry.error) pageDataRef.current[pageId] = entry;
        setPageData((prev) => ({ ...prev, [pageId]: entry }));
        return entry;
      });
    inflightRef.current.set(pageId, req);
    return req;
  }, []);

  const ensurePages = useCallback(async (pgs, imageTimeoutMs) => {
    const entries = await Promise.all(pgs.map((pg) => fetchPage(pg?.id)));
    await preloadImages(entries.flatMap((e) => collectElementImageUrls(e?.elements)), imageTimeoutMs);
  }, [fetchPage]);

  // Antes de girar: datos + imagenes de las 4 paginas implicadas (max 2,5 s)
  const preparePages = useCallback(
    (pgs) => Promise.race([ensurePages(pgs, 1200), new Promise((r) => window.setTimeout(r, 2500))]),
    [ensurePages],
  );

  // Vista actual + precarga de las vecinas (±2)
  useEffect(() => {
    if (!views.length) return undefined;
    ensurePages(pagesOfView(views[currentViewIndex]), 8000);
    const t = window.setTimeout(() => {
      const around = [1, -1, 2, -2].flatMap((d) => pagesOfView(views[currentViewIndex + d]));
      ensurePages(around, 8000);
    }, 200);
    return () => window.clearTimeout(t);
  }, [views, currentViewIndex, ensurePages]);

  const turnSoundRef = useRef(null);
  const playPageTurnSound = () => {
    try {
      if (!turnSoundRef.current) {
        turnSoundRef.current = new Audio('/sounds/page-turn.mp3');
        turnSoundRef.current.preload = 'auto';
      }
      const audio = turnSoundRef.current.cloneNode();
      audio.volume = 0.55;
      audio.play().catch(() => {});
    } catch (_err) {
      // no-op: el sonido es cosmetico, nunca debe romper la navegacion
    }
  };

  const leftPageId = currentView?.left?.id || null;

  const activeLeftPageNumber = currentView?.left?.page_number;
  const activeRightPageNumber = currentView?.right?.page_number;

  useEffect(() => {
    setPageJumpDraft(activeLeftPageNumber ? String(activeLeftPageNumber) : '');
  }, [activeLeftPageNumber]);

  const handlePrev = () => flipBookRef.current?.prev();
  const handleNext = () => flipBookRef.current?.next();
  const commitPageJump = () => {
    const n = parseInt(pageJumpDraft, 10);
    if (!Number.isFinite(n) || n < 1 || n > totalPages) {
      setPageJumpDraft(activeLeftPageNumber ? String(activeLeftPageNumber) : '');
      return;
    }
    const idx = findViewIndexForPageNumber(views, n);
    if (idx >= 0) flipBookRef.current?.flipTo(idx);
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
      // Lote FLIP-2: en modo dual el libro reserva SIEMPRE 2 huecos (la
      // portada va a la derecha del lomo), asi la escala no salta al abrirla.
      const contentWidthPx = viewMode === 'dual' ? stageWidthPx * 2 : stageWidthPx;
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
  }, [publication, viewMode, !!currentView]);

  if (loadErr) {
    return (
      <div className="page-viewer-container">
        <div className="error-message">{loadErr}</div>
        <button onClick={() => navigate('/collections')} className="btn-secondary">
          Volver a Colecciones
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
          <button onClick={() => navigate(publication?.collection_id ? `/collections/${publication.collection_id}` : '/collections')} className="btn-back">
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
              aria-label="Vista simple"
            >
              <Icon name="page" size={18} />
            </button>
            <button
              className={viewMode === 'dual' ? 'active' : ''}
              onClick={() => setViewMode('dual')}
              title="Vista dual"
              aria-label="Vista dual"
            >
              <Icon name="book" size={18} />
            </button>
          </div>
          {can(user, 'editor') && <button onClick={() => navigate(`/publications/${id}/edit/${leftPageId}`)} className="btn-primary">
            Editar Contenido
          </button>}
        </div>
      </div>

      <div
        ref={canvasWrapRef}
        className="editor-v2-canvas-wrap page-viewer-canvas-wrap"
      >
        <FlipBook
          ref={flipBookRef}
          views={views}
          index={currentViewIndex}
          onIndexChange={setCurrentViewIndex}
          mode={viewMode === 'single' ? 'single' : 'spread'}
          pageWidth={publication.page_width * PX_PER_MM * fitScale}
          pageHeight={publication.page_height * PX_PER_MM * fitScale}
          onFlipStart={playPageTurnSound}
          preparePages={preparePages}
          renderPage={(p) => {
            const entry = pageData[p.id];
            return (
              <StaticPage
                page={p}
                elements={entry?.elements}
                loading={!entry}
                error={entry?.error}
                publication={publication}
                totalPages={totalPages}
                scale={fitScale}
              />
            );
          }}
        />
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
