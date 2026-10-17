import { useEffect, useRef } from 'react';

// Estadisticas de lectura SIN cookies (lote L6). No usa localStorage, sessionStorage ni cookies;
// el servidor identifica al lector con un hash diario que no se guarda. Respeta DNT / GPC.
const API_URL = import.meta.env.VITE_API_URL || '';
const URL_EVENTS = `${API_URL}/api/public/events`;

const optedOut = () => {
  try {
    return navigator.doNotTrack === '1' || window.doNotTrack === '1' || navigator.globalPrivacyControl === true;
  } catch { return false; }
};

const post = (payload) => {
  if (optedOut()) return;
  const body = JSON.stringify(payload);
  try {
    // text/plain: peticion "simple", sin preflight; sendBeacon sobrevive al cierre de la pestana
    if (navigator.sendBeacon && navigator.sendBeacon(URL_EVENTS, new Blob([body], { type: 'text/plain;charset=UTF-8' }))) return;
  } catch { /* se prueba fetch */ }
  try { fetch(URL_EVENTS, { method: 'POST', body, keepalive: true, headers: { 'Content-Type': 'text/plain;charset=UTF-8' } }).catch(() => {}); } catch { /* sin medicion */ }
};

// Clic en un hotspot del lector: solo se envia el tipo y, si es una web, su dominio (lo recorta el servidor).
export const trackReaderClick = (publicationId, action, value, embed = false) => {
  if (!publicationId) return;
  const act = action === 'url' ? 'url' : action === 'email' ? 'email' : action === 'phone' ? 'phone'
    : ['page', 'next', 'previous', 'cover', 'back_cover'].includes(action) ? 'page' : null;
  if (!act) return;
  post({ p: publicationId, e: 'click', a: act, x: act === 'url' ? value : undefined, m: embed ? 1 : 0 });
};

// Apertura (1 por carga), hojas vistas y tiempo activo en cada hoja (solo con la pestana visible).
export function useReaderStats(publicationId, embed, pageNumbers) {
  const pagesRef = useRef([]);
  const sinceRef = useRef(null);
  const accRef = useRef(0);
  const key = (pageNumbers || []).join(',');

  const flush = () => {
    const now = Date.now();
    const ms = accRef.current + (sinceRef.current ? now - sinceRef.current : 0);
    accRef.current = 0;
    sinceRef.current = document.visibilityState === 'visible' ? now : null;
    if (publicationId && pagesRef.current.length && ms >= 300) post({ p: publicationId, e: 'time', g: pagesRef.current, t: Math.min(ms, 300000), m: embed ? 1 : 0 });
  };

  useEffect(() => {
    if (!publicationId) return undefined;
    let src = '';
    try { src = new URLSearchParams(window.location.search).get('src') || ''; } catch { /* sin origen */ }
    post({ p: publicationId, e: 'open', s: src, r: document.referrer || '', m: embed ? 1 : 0 });
    const onVis = () => {
      if (document.visibilityState === 'hidden') {
        if (sinceRef.current) { accRef.current += Date.now() - sinceRef.current; sinceRef.current = null; }
        flush();
        sinceRef.current = null;
      } else { sinceRef.current = Date.now(); }
    };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [publicationId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!publicationId || !key) return;
    flush();                                   // cierra el tiempo de la(s) hoja(s) anterior(es)
    pagesRef.current = key.split(',').map(Number);
    sinceRef.current = document.visibilityState === 'visible' ? Date.now() : null;
    post({ p: publicationId, e: 'view', g: pagesRef.current, m: embed ? 1 : 0 });
  }, [publicationId, key]); // eslint-disable-line react-hooks/exhaustive-deps
}
