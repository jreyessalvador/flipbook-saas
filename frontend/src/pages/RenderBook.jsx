// Lote F (2026-10-04): pagina INTERNA de render para exportar a PDF.
// La abre SOLO el worker aislado de Contabo 2 (Chromium headless) a traves
// del gateway del tunel wg-flipbook. Los datos vienen de la API interna, que
// exige el token del worker (lo inyecta el propio worker; nunca va en la URL)
// y la IP del tunel: abierta desde internet, esta pagina solo muestra un error.
// Pinta cada hoja a su tamano real (PX_PER_MM=3, sin barras ni controles) en
// un <section data-render-page="N">; el worker captura cada seccion cuando
// window.__RENDER_READY__ === true.
import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import StaticPage from '../components/reader/StaticPage';
import { RenderModeContext } from '../components/editor/CanvasEditorV2';
import { collectElementImageUrls, preloadImages } from '../services/imageCache';

const PX_PER_MM = 3;

export default function RenderBook() {
  const { jobId } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [preloaded, setPreloaded] = useState(false);

  useEffect(() => {
    document.title = 'Render';
    const meta = document.createElement('meta');
    meta.name = 'robots'; meta.content = 'noindex, nofollow';
    document.head.appendChild(meta);
    window.__RENDER_READY__ = false;
    const API = import.meta.env.VITE_API_URL || '';
    axios.get(`${API}/api/internal/render/jobs/${encodeURIComponent(jobId)}/data`)
      .then((r) => setData(r.data))
      .catch(() => { setError('Render no disponible'); window.__RENDER_ERROR__ = 'data'; });
  }, [jobId]);

  useEffect(() => {
    if (!data) return;
    const urls = (data.pages || []).flatMap((p) => collectElementImageUrls(p.elements));
    preloadImages(urls, 45000).then(() => setPreloaded(true));
  }, [data]);

  useEffect(() => {
    if (!preloaded) return undefined;
    let cancelled = false;
    const started = Date.now();
    const check = () => {
      if (cancelled) return;
      const pending = window.__renderPending ? window.__renderPending.size : 0;
      if ((pending === 0 && Date.now() - started > 1500) || Date.now() - started > 30000) {
        (document.fonts?.ready || Promise.resolve()).then(() => {
          requestAnimationFrame(() => requestAnimationFrame(() => { window.__RENDER_READY__ = true; }));
        });
      } else {
        window.setTimeout(check, 250);
      }
    };
    check();
    return () => { cancelled = true; };
  }, [preloaded]);

  if (error) return <div style={{ padding: 40, fontFamily: 'sans-serif' }}>{error}</div>;
  if (!data || !preloaded) return <div style={{ padding: 40, fontFamily: 'sans-serif' }}>Preparando…</div>;

  const publication = { page_width: data.page_width, page_height: data.page_height, title: data.title, orientation: data.orientation };
  const pages = [...(data.pages || [])].sort((a, b) => a.page_number - b.page_number);
  const w = data.page_width * PX_PER_MM;
  const h = data.page_height * PX_PER_MM;
  return (
    <RenderModeContext.Provider value>
      <style>{'html,body{margin:0;padding:0;background:#fff} .render-page{overflow:hidden;position:relative;background:#fff}'}</style>
      <main>
        {pages.map((page, i) => (
          <section key={page.id || i} className="render-page" data-render-page={i + 1} style={{ width: w, height: h }}>
            <StaticPage page={page} elements={page.elements} publication={publication} totalPages={data.total_pages || pages.length} scale={1} />
          </section>
        ))}
      </main>
    </RenderModeContext.Provider>
  );
}
