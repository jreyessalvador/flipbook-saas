import React, { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { computeSpreadViews } from '../components/editor/CanvasEditorV2';
import FlipBook, { pagesOfView } from '../components/reader/FlipBook';
import StaticPage from '../components/reader/StaticPage';
import Icon from '../components/common/Icon';
import { collectElementImageUrls, preloadImages } from '../services/imageCache';

const imageUrlsOfPages = (pgs) => pgs.flatMap((pg) => collectElementImageUrls(pg?.elements));

// ---------------------------------------------------------------------------
// Lectura responsive (2026-09-27, reportado por Carlos en iPhone 13 Pro): la
// escala era fija (0.72) y siempre se mostraba el spread de 2 paginas, que en
// un movil en vertical se salia de la pantalla. Ahora:
//  - la escala se calcula para que la vista quepa en el area disponible;
//  - en pantallas estrechas o en vertical se lee pagina a pagina;
//  - swipe izquierda/derecha en tactil y flechas del teclado.
// ---------------------------------------------------------------------------
const PX_PER_MM = 3; // debe coincidir con CanvasEditorV2
const FRAME_PAD = 10; // aire para la sombra del libro (antes marco negro de 4px)
const SINGLE_PAGE_MAX_WIDTH = 768;
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

// Preferencia del LECTOR (localStorage): 'on' | 'off' | null (sin elegir).
// Si no ha elegido, manda el ajuste de la edicion (Lote L4, viewer.sound_enabled).
const readSoundPref = () => {
  try {
    const v = localStorage.getItem(SOUND_KEY);
    return v === 'on' ? true : v === 'off' ? false : null;
  } catch { return null; }
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

const PublicReader = ({ embed = false }) => {
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
  const rootRef = useRef(null);
  // Efecto de pasar pagina: FlipBook (Lote FLIP-2) -- hoja real de dos caras
  const flipBookRef = useRef(null);
  const [soundPref, setSoundPref] = useState(readSoundPref);
  const soundOn = soundPref ?? (publication?.viewer?.sound_enabled ?? true);
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
      if (viewIndex >= 0) flipBookRef.current?.flipTo(viewIndex);
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
      if (!embed && routeId && canonical && canonical.startsWith('/r/') && window.location.pathname !== canonical) {
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

  const turnSoundRef = useRef(null);
  const playPageTurnSound = useCallback(() => {
    if (!soundOn) return;
    try {
      if (!turnSoundRef.current) {
        // Lote L4: sonido propio de la edicion (biblioteca de la empresa) o el predeterminado
        const custom = publication?.viewer?.sound_url;
        const API = import.meta.env.VITE_API_URL || '';
        turnSoundRef.current = new Audio(custom ? (custom.startsWith('http') ? custom : `${API}${custom}`) : '/sounds/page-turn.mp3');
        turnSoundRef.current.preload = 'auto';
      }
      const audio = turnSoundRef.current.cloneNode();
      audio.volume = 0.55;
      audio.play().catch(() => {});
    } catch { /* cosmetico: nunca debe romper la navegacion */ }
  }, [soundOn, publication?.viewer?.sound_url]);

  // Antes de girar: imagenes de las paginas implicadas ya decodificadas
  const preparePages = useCallback((pgs) => preloadImages(imageUrlsOfPages(pgs), 1200), []);

  // Precarga en segundo plano de las hojas vecinas (±2 vistas)
  useEffect(() => {
    const around = [1, -1, 2, -2].flatMap((d) => pagesOfView(spreadViews[currentSpreadIndex + d]));
    const t = window.setTimeout(() => preloadImages(imageUrlsOfPages(around), 8000), 150);
    return () => window.clearTimeout(t);
  }, [currentSpreadIndex, spreadViews]);

  const goPrev = useCallback(() => flipBookRef.current?.prev(), []);
  const goNext = useCallback(() => flipBookRef.current?.next(), []);

  const toggleSound = () => {
    const next = !soundOn;
    try { localStorage.setItem(SOUND_KEY, next ? 'on' : 'off'); } catch { /* sin storage */ }
    setSoundPref(next);
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
  const availW = Math.max(0, boxW - 2 * FRAME_PAD);
  const availH = Math.max(0, boxH - 2 * FRAME_PAD);
  const fitScale = Math.max(0.15, Math.min(1.25, availW / (slots * pageWpx), availH / pageHpx));
  const renderScale = fitScale * zoom;
  const pageLabel = singlePage
    ? `${currentPages[0]?.page_number ?? '-'} / ${pages.length}`
    : `Página ${currentPages.map((pg) => pg.page_number).join('-')}`;

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
          {embed ? (
            // Lote L4: dentro de un iframe no hay "Volver"; enlace a la version completa
            <a
              href={publication.url_path || `/leer/${publication.id}`}
              target="_blank"
              rel="noopener"
              style={{ color: 'var(--color-gold, #c9a24b)', fontSize: '0.85rem', fontWeight: 600, textDecoration: 'none', whiteSpace: 'nowrap' }}
              title="Abrir en Cetrix Revistas"
            >
              Cetrix Revistas ↗
            </a>
          ) : (
          <button
            onClick={() => navigate(publication.collection?.slug && publication.tenant?.slug ? `/r/${publication.tenant.slug}/${publication.collection.slug}` : '/')}
            style={{ background: 'none', border: 'none', color: 'var(--color-gold, #c9a24b)', fontSize: '1rem', cursor: 'pointer', fontWeight: 600 }}
            title={publication.collection?.name ? `Volver a ${publication.collection.name}` : 'Volver al inicio'}
          >
            ← Volver
          </button>
          )}
          <span style={{ fontSize: compact ? '0.95rem' : '1.1rem', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{publication.title}</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexShrink: 0 }}>
          {!singlePage && (
            <span style={{ fontSize: '0.9rem', color: '#94a3b8', whiteSpace: 'nowrap', marginRight: '0.5rem' }}>
              Vista {currentSpreadIndex + 1} de {spreadViews.length}
            </span>
          )}
          {publication.viewer?.download_url && (
            <a
              href={`${import.meta.env.VITE_API_URL || ''}${publication.viewer.download_url}`}
              download
              rel="nofollow"
              style={{ ...iconBtn, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
              title="Descargar en PDF"
              aria-label="Descargar en PDF"
            >
              <Icon name="download" size={20} />
            </a>
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
      >
       <div ref={stageRef} style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', overflow: zoom > 1 ? 'auto' : 'hidden', WebkitOverflowScrolling: 'touch' }}>
        <FlipBook
          ref={flipBookRef}
          views={spreadViews}
          index={currentSpreadIndex}
          onIndexChange={setCurrentSpreadIndex}
          mode={singlePage ? 'single' : 'spread'}
          pageWidth={pageWpx * renderScale}
          pageHeight={pageHpx * renderScale}
          onFlipStart={playPageTurnSound}
          preparePages={preparePages}
          dragEnabled={zoom === 1}
          renderPage={(p) => (
            <StaticPage
              page={p}
              elements={p.elements}
              publication={publication}
              totalPages={pages.length}
              onHotspotActivate={activateHotspot}
              scale={renderScale}
            />
          )}
        />
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
          disabled={isFirst}
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
          disabled={isLast}
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
