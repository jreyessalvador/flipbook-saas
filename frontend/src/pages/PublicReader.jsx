import React, { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { PageCanvas, computeSpreadViews } from '../components/editor/CanvasEditorV2';
import { createPageEditorStore } from '../store/pageEditorStore';
import Icon from '../components/common/Icon';
import '../styles/PageViewer.css'; // clases .page-viewer-flip* (efecto pasar pagina, Lote UX-12)

const ReaderPage = ({ page, publication, totalPages, onHotspotActivate, scale }) => {
  const [useStore] = useState(() => createPageEditorStore());

  useEffect(() => {
    useStore.setState({
      pageId: page.id || `public-${page.page_number}`,
      version: 0,
      elements: (page.elements || []).map((element) => ({ ...element })),
      selectedElementIds: [],
      isLoading: false,
      loadError: null,
    });
  }, [page, useStore]);

  return (
    <PageCanvas
      useStoreHook={useStore}
      canEdit={false}
      publication={publication}
      pageNumber={page.page_number}
      totalPages={totalPages}
      onFocus={() => {}}
      onHotspotActivate={(hotspot) => onHotspotActivate(hotspot, page)}
      scale={scale}
    />
  );
};


// ---------------------------------------------------------------------------
// Lectura responsive (2026-09-27, reportado por Carlos en iPhone 13 Pro): la
// escala era fija (0.72) y siempre se mostraba el spread de 2 paginas, que en
// un movil en vertical se salia de la pantalla. Ahora:
//  - la escala se calcula para que la vista quepa en el area disponible;
//  - en pantallas estrechas o en vertical se lee pagina a pagina;
//  - swipe izquierda/derecha en tactil y flechas del teclado.
// ---------------------------------------------------------------------------
const PX_PER_MM = 3; // debe coincidir con CanvasEditorV2
const FRAME_PAD = 4; // padding del marco negro
const PAGE_GAP = 2;
const SINGLE_PAGE_MAX_WIDTH = 768;
const FLIP_HALF_MS = 220;
const ZOOM_STEPS = [1, 1.5, 2, 3];
const SOUND_KEY = 'reader.sound';

const iconBtn = {
  background: 'rgba(255,255,255,0.08)',
  border: '1px solid rgba(255,255,255,0.12)',
  color: '#fff',
  borderRadius: '6px',
  minWidth: '2.1rem',
  height: '2.1rem',
  padding: '0 0.4rem',
  fontSize: '1rem',
  lineHeight: 1,
  cursor: 'pointer',
};

const readSoundPref = () => {
  try { return localStorage.getItem(SOUND_KEY) !== 'off'; } catch { return true; }
};

const useElementSize = () => {
  // callback ref: el nodo aparece solo cuando termina la carga
  const [node, setNode] = useState(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    if (!node) return undefined;
    const update = () => setSize({ width: node.clientWidth, height: node.clientHeight });
    update();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    ro?.observe(node);
    window.addEventListener('orientationchange', update);
    window.addEventListener('resize', update);
    return () => {
      ro?.disconnect();
      window.removeEventListener('orientationchange', update);
      window.removeEventListener('resize', update);
    };
  }, [node]);
  return [setNode, size];
};

const useViewportSize = () => {
  const [w, setW] = useState(() => (typeof window !== 'undefined' ? window.innerWidth : 1024));
  const [h, setH] = useState(() => (typeof window !== 'undefined' ? window.innerHeight : 768));
  useEffect(() => {
    const onResize = () => { setW(window.innerWidth); setH(window.innerHeight); };
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, []);
  return { vw: w, vh: h };
};

const PublicReader = () => {
  const { id: routeId, tenant, collection, edition } = useParams();
  const navigate = useNavigate();
  const [publication, setPublication] = useState(null);
  const [pages, setPages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [currentSpreadIndex, setCurrentSpreadIndex] = useState(0);
  const { vw, vh } = useViewportSize();
  const singlePage = vw < SINGLE_PAGE_MAX_WIDTH || vw < vh;
  const compact = singlePage || vh < 500; // movil en horizontal: poca altura
  const [stageRef, stageSize] = useElementSize();
  const anchorPageRef = useRef(1); // pagina visible, para no perder el sitio al rotar
  const touchRef = useRef(null);
  const rootRef = useRef(null);
  // Efecto de pasar pagina (mismo que el visor interno, Lote UX-12)
  const [flipState, setFlipState] = useState(null); // null | { direction, phase }
  const flipTimeoutRef = useRef(null);
  useEffect(() => () => window.clearTimeout(flipTimeoutRef.current), []);
  const [soundOn, setSoundOn] = useState(readSoundPref);
  const [zoomIdx, setZoomIdx] = useState(0);
  const zoom = ZOOM_STEPS[zoomIdx];
  const [isFullscreen, setIsFullscreen] = useState(false);
  const canFullscreen = typeof document !== 'undefined' && !!document.fullscreenEnabled;

  const activateHotspot = (hotspot, sourcePage) => {
    const props = hotspot?.props || {};
    const action = props.action;
    const sortedPages = [...pages].sort((a, b) => a.page_number - b.page_number);
    const target = action === 'page' ? sortedPages.find((page) => page.id === props.target_page_id)
      : action === 'next' ? sortedPages.find((page) => page.page_number === sourcePage.page_number + 1)
      : action === 'previous' ? sortedPages.find((page) => page.page_number === sourcePage.page_number - 1)
      : action === 'cover' ? sortedPages[0]
      : action === 'back_cover' ? sortedPages[sortedPages.length - 1]
      : null;
    if (target) {
      const views = singlePage
        ? sortedPages.map((pg) => ({ left: pg, right: null }))
        : computeSpreadViews(sortedPages, publication?.total_pages ?? sortedPages.length);
      const viewIndex = views.findIndex((view) => view.left?.id === target.id || view.right?.id === target.id);
      if (viewIndex >= 0) setCurrentSpreadIndex(viewIndex);
      return;
    }
    if (action === 'url' && /^https:\/\//i.test(props.value || '')) window.open(props.value, '_blank', 'noopener,noreferrer');
    else if (action === 'email' && props.value) window.location.href = `mailto:${props.value}`;
    else if (action === 'phone' && props.value) window.location.href = `tel:${String(props.value).replace(/[^+0-9]/g, '')}`;
  };

  useEffect(() => {
    fetchPublicData();
  }, [routeId, tenant, collection, edition]);

  const fetchPublicData = async () => {
    try {
      setLoading(true);
      setError('');
      const API_URL = import.meta.env.VITE_API_URL || '';

      // URL amigable /r/{empresa}/{coleccion}/{edicion}: primero se resuelve al id
      let id = routeId;
      let meta = null;
      if (!id) {
        const seg = (v) => encodeURIComponent(v || '');
        const res = await axios.get(`${API_URL}/api/public/r/${seg(tenant)}/${seg(collection)}/${seg(edition)}`);
        meta = res.data;
        id = meta.id;
      }
      const [pubRes, pagesRes] = await Promise.all([
        meta ? Promise.resolve({ data: meta }) : axios.get(`${API_URL}/api/public/publications/${id}`),
        axios.get(`${API_URL}/api/public/publications/${id}/pages`)
      ]);

      // Enlaces antiguos /leer/{id}: mostrar en la barra la URL canonica amigable
      const canonical = pubRes.data?.url_path;
      if (routeId && canonical && canonical.startsWith('/r/') && window.location.pathname !== canonical) {
        window.history.replaceState(window.history.state, '', canonical + window.location.search + window.location.hash);
      }
      setPublication(pubRes.data);
      setPages(pagesRes.data || []);
    } catch (err) {
      console.error('Error cargando publicación pública:', err);
      setError(err.response?.data?.detail || 'No se pudo cargar la publicación solicitada.');
    } finally {
      setLoading(false);
    }
  };

  const spreadViews = useMemo(() => {
    if (!publication) return [];
    const sorted = [...pages].sort((a, b) => a.page_number - b.page_number);
    return singlePage
      ? sorted.map((pg) => ({ left: pg, right: null }))
      : computeSpreadViews(sorted, publication.total_pages ?? sorted.length);
  }, [pages, publication, singlePage]);

  // Al cambiar de modo (rotar el movil) mantener la pagina que se estaba leyendo
  useEffect(() => {
    if (!spreadViews.length) return;
    const idx = spreadViews.findIndex((v) => [v.left, v.right].some((pg) => pg && pg.page_number === anchorPageRef.current));
    setCurrentSpreadIndex(idx >= 0 ? idx : 0);
  }, [singlePage, spreadViews.length]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const v = spreadViews[currentSpreadIndex];
    if (v?.left) anchorPageRef.current = v.left.page_number;
  }, [currentSpreadIndex, spreadViews]);

  const playPageTurnSound = useCallback(() => {
    if (!soundOn) return;
    try {
      const audio = new Audio('/sounds/page-turn.mp3');
      audio.volume = 0.55;
      audio.play().catch(() => {});
    } catch { /* cosmetico: nunca debe romper la navegacion */ }
  }, [soundOn]);

  const flipTo = useCallback((targetIdx, direction) => {
    if (flipState) return; // animacion en curso: ignora pulsaciones repetidas
    if (targetIdx < 0 || targetIdx >= spreadViews.length) return;
    const reduceMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    playPageTurnSound();
    if (reduceMotion) { setCurrentSpreadIndex(targetIdx); return; }
    setFlipState({ direction, phase: 'out' });
    window.clearTimeout(flipTimeoutRef.current);
    flipTimeoutRef.current = window.setTimeout(() => {
      setCurrentSpreadIndex(targetIdx); // el contenido cambia con la hoja de canto
      setFlipState({ direction, phase: 'in' });
      flipTimeoutRef.current = window.setTimeout(() => setFlipState(null), FLIP_HALF_MS);
    }, FLIP_HALF_MS);
  }, [flipState, spreadViews.length, playPageTurnSound]);

  const goPrev = useCallback(() => flipTo(currentSpreadIndex - 1, 'prev'), [flipTo, currentSpreadIndex]);
  const goNext = useCallback(() => flipTo(currentSpreadIndex + 1, 'next'), [flipTo, currentSpreadIndex]);

  const toggleSound = () => {
    setSoundOn((on) => {
      try { localStorage.setItem(SOUND_KEY, on ? 'off' : 'on'); } catch { /* sin storage */ }
      return !on;
    });
  };

  useEffect(() => {
    const onFs = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);
  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    else rootRef.current?.requestFullscreen?.().catch(() => {});
  };

  // Titulo de la pestana = titulo de la revista
  useEffect(() => {
    if (!publication?.title) return undefined;
    const prev = document.title;
    document.title = `${publication.title} · Cetrix Revistas`;
    return () => { document.title = prev; };
  }, [publication?.title]);

  // Al cambiar de pagina se vuelve al tamano ajustado
  useEffect(() => { setZoomIdx(0); }, [currentSpreadIndex, singlePage]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.target && ['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown') goNext();
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') goPrev();
      else if (e.key === '+' || e.key === '=') setZoomIdx((z) => Math.min(ZOOM_STEPS.length - 1, z + 1));
      else if (e.key === '-') setZoomIdx((z) => Math.max(0, z - 1));
      else if (e.key === '0') setZoomIdx(0);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goNext, goPrev]);

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', backgroundColor: 'var(--color-navy-dark, #0c1526)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <h2>Cargando Revista Digital...</h2>
      </div>
    );
  }

  if (error || !publication) {
    return (
      <div style={{ minHeight: '100vh', backgroundColor: 'var(--color-navy-dark, #0c1526)', color: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1rem', padding: '2rem' }}>
        <h2 style={{ color: '#f87171' }}>{error || 'Publicación no disponible.'}</h2>
        <button
          onClick={() => navigate('/')}
          style={{ backgroundColor: 'var(--color-gold, #c9a24b)', color: '#0c1526', border: 'none', padding: '0.75rem 1.5rem', borderRadius: '6px', fontWeight: 600, cursor: 'pointer' }}
        >
          Volver al Inicio
        </button>
      </div>
    );
  }

  const currentSpread = spreadViews[currentSpreadIndex] || { left: null, right: null };
  const currentPages = [currentSpread.left, currentSpread.right].filter(Boolean);
  const isFirst = currentSpreadIndex === 0;
  const isLast = currentSpreadIndex >= spreadViews.length - 1;

  // Escala para que la vista actual quepa en el area disponible
  const pageWpx = publication.page_width * PX_PER_MM;
  const pageHpx = publication.page_height * PX_PER_MM;
  const slots = singlePage ? 1 : 2; // spread reserva siempre 2 huecos: la escala no "salta" en portada
  // Area medida por ResizeObserver; mientras no haya medida se estima con el
  // viewport (cabecera ~52px, pie ~64px, padding) para no pintar nunca de mas.
  const boxW = stageSize.width > 0 ? stageSize.width : vw - (compact ? 12 : 32);
  const boxH = stageSize.height > 0 ? stageSize.height : vh - (compact ? 96 : 116) - (compact ? 12 : 32);
  const availW = Math.max(0, boxW - 2 * FRAME_PAD - (slots - 1) * PAGE_GAP);
  const availH = Math.max(0, boxH - 2 * FRAME_PAD);
  const fitScale = Math.max(0.15, Math.min(1.25, availW / (slots * pageWpx), availH / pageHpx));
  const renderScale = fitScale * zoom;
  const pageLabel = singlePage
    ? `${currentPages[0]?.page_number ?? '-'} / ${pages.length}`
    : `Página ${currentPages.map((pg) => pg.page_number).join('-')}`;

  const onTouchStart = (e) => {
    const pinchZoomed = (window.visualViewport?.scale || 1) > 1.05;
    if (e.touches.length > 1 || zoom > 1 || pinchZoomed) { touchRef.current = null; return; }
    const t = e.touches[0];
    touchRef.current = { x: t.clientX, y: t.clientY };
  };
  const onTouchEnd = (e) => {
    const start = touchRef.current;
    touchRef.current = null;
    if (!start) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return; // no es swipe horizontal
    if (dx < 0) goNext(); else goPrev();
  };

  return (
    <div ref={rootRef} style={{ height: '100dvh', minHeight: '-webkit-fill-available', backgroundColor: 'var(--color-navy-dark, #0c1526)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Reader Header */}
      <header style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: '0.75rem',
        padding: compact ? '0.4rem 0.75rem' : '0.75rem 1.5rem',
        backgroundColor: 'var(--color-navy, #14213d)',
        borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
        color: '#fff',
        zIndex: 50,
        flexShrink: 0
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', minWidth: 0 }}>
          <button
            onClick={() => navigate(publication.collection?.slug && publication.tenant?.slug ? `/r/${publication.tenant.slug}/${publication.collection.slug}` : '/')}
            style={{ background: 'none', border: 'none', color: 'var(--color-gold, #c9a24b)', fontSize: '1rem', cursor: 'pointer', fontWeight: 600 }}
            title={publication.collection?.name ? `Volver a ${publication.collection.name}` : 'Volver al inicio'}
          >
            ← Volver
          </button>
          <span style={{ fontSize: compact ? '0.95rem' : '1.1rem', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{publication.title}</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexShrink: 0 }}>
          {!singlePage && (
            <span style={{ fontSize: '0.9rem', color: '#94a3b8', whiteSpace: 'nowrap', marginRight: '0.5rem' }}>
              Vista {currentSpreadIndex + 1} de {spreadViews.length}
            </span>
          )}
          <button type="button" onClick={toggleSound} style={iconBtn} title={soundOn ? 'Silenciar sonido de página' : 'Activar sonido de página'} aria-label={soundOn ? 'Silenciar sonido' : 'Activar sonido'} aria-pressed={soundOn}>
            <Icon name={soundOn ? 'volume' : 'mute'} size={20} />
          </button>
          {canFullscreen && (
            <button type="button" onClick={toggleFullscreen} style={iconBtn} title={isFullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'} aria-label={isFullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'}>
              <Icon name={isFullscreen ? 'minimize' : 'maximize'} size={20} />
            </button>
          )}
        </div>
      </header>

      {/* Main Canvas Display (Modo Lectura / Spread View) */}
      <div
        style={{ flex: 1, minHeight: 0, padding: compact ? '0.35rem' : '1rem', display: 'flex' }}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
       <div ref={stageRef} style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', overflow: zoom > 1 ? 'auto' : 'hidden', perspective: '2200px', WebkitOverflowScrolling: 'touch' }}>
        <div
          className={`page-viewer-flip-inner${currentPages.length > 1 ? ' page-viewer-flip-inner-spread' : ''}${flipState ? ` page-viewer-flipping page-viewer-flipping-${flipState.direction} page-viewer-flipping-${flipState.phase}` : ''}`}
          style={{ margin: 'auto', display: 'flex', gap: `${PAGE_GAP}px`, backgroundColor: '#000', padding: `${FRAME_PAD}px`, borderRadius: '4px', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)' }}
        >
          {currentPages.map((p) => (
            <div key={p.id || p.page_number} style={{ backgroundColor: '#fff', lineHeight: 0 }}>
              <ReaderPage page={p} publication={publication} totalPages={pages.length} onHotspotActivate={activateHotspot} scale={renderScale} />
            </div>
          ))}
        </div>
       </div>
      </div>

      {/* Reader Controls (Navegación Inferior) */}
      <footer style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        gap: compact ? '0.75rem' : '1.5rem',
        padding: compact ? '0.35rem 0.75rem calc(0.35rem + env(safe-area-inset-bottom))' : '1rem',
        backgroundColor: 'var(--color-navy, #14213d)',
        borderTop: '1px solid rgba(255, 255, 255, 0.08)',
        zIndex: 50,
        flexShrink: 0
      }}>
        <button
          disabled={isFirst || !!flipState}
          onClick={goPrev}
          aria-label="Página anterior"
          style={{
            backgroundColor: isFirst ? 'rgba(255,255,255,0.05)' : 'var(--color-gold, #c9a24b)',
            color: isFirst ? '#64748b' : '#0c1526',
            border: 'none',
            padding: compact ? '0.45rem 1rem' : '0.6rem 1.25rem',
            borderRadius: '6px',
            fontWeight: 700,
            cursor: isFirst ? 'not-allowed' : 'pointer'
          }}
        >
          ◄ Anterior
        </button>

        <span style={{ color: '#fff', fontSize: '0.9rem', fontWeight: 500, whiteSpace: 'nowrap' }}>
          {pageLabel}
        </span>
        {vw >= 480 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }} role="group" aria-label="Zoom">
          <button type="button" style={iconBtn} onClick={() => setZoomIdx((z) => Math.max(0, z - 1))} disabled={zoomIdx === 0} aria-label="Alejar" title="Alejar (−)">−</button>
          <button type="button" style={{ ...iconBtn, minWidth: '3.2rem', fontSize: '0.8rem' }} onClick={() => setZoomIdx(0)} title="Ajustar a pantalla (0)" aria-label="Ajustar a pantalla">{Math.round(zoom * 100)}%</button>
          <button type="button" style={iconBtn} onClick={() => setZoomIdx((z) => Math.min(ZOOM_STEPS.length - 1, z + 1))} disabled={zoomIdx === ZOOM_STEPS.length - 1} aria-label="Acercar" title="Acercar (+)">+</button>
        </div>
        )}

        <button
          disabled={isLast || !!flipState}
          onClick={goNext}
          aria-label="Página siguiente"
          style={{
            backgroundColor: isLast ? 'rgba(255,255,255,0.05)' : 'var(--color-gold, #c9a24b)',
            color: isLast ? '#64748b' : '#0c1526',
            border: 'none',
            padding: compact ? '0.45rem 1rem' : '0.6rem 1.25rem',
            borderRadius: '6px',
            fontWeight: 700,
            cursor: isLast ? 'not-allowed' : 'pointer'
          }}
        >
          Siguiente ►
        </button>
      </footer>
    </div>
  );
};

export default PublicReader;
