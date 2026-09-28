import { API_URL } from './api';

// Caché de imágenes ya decodificadas (Lote FLIP-2, 28-sep-2026).
//
// Motivo: al pasar página, cada PageCanvas que se monta creaba su propio
// `new Image()` y hasta que llegaba el `onload` (asíncrono, aunque el archivo
// ya estuviera en la caché HTTP) la página se pintaba en blanco. Con esta
// caché, una imagen que ya se cargó una vez (o que se precargó para la hoja
// siguiente) está disponible de forma SÍNCRONA en el primer render.
//
// Solo lectura: los elementos Konva comparten el mismo HTMLImageElement, que
// nunca se muta (los filtros de brillo/contraste trabajan sobre node.cache()).

const MAX_ENTRIES = 400;
const loaded = new Map(); // url -> HTMLImageElement ya cargado
const pending = new Map(); // url -> Promise<HTMLImageElement|null>

export function resolveAssetUrl(src) {
  if (!src) return null;
  return src.startsWith('http') || src.startsWith('data:') || src.startsWith('blob:') ? src : `${API_URL}${src}`;
}

export function getCachedImage(url) {
  if (!url) return null;
  const img = loaded.get(url);
  if (!img) return null;
  // refresco LRU
  loaded.delete(url);
  loaded.set(url, img);
  return img;
}

function remember(url, img) {
  loaded.set(url, img);
  if (loaded.size > MAX_ENTRIES) {
    const oldest = loaded.keys().next().value;
    loaded.delete(oldest);
  }
}

export function loadImage(url) {
  if (!url) return Promise.resolve(null);
  const cached = getCachedImage(url);
  if (cached) return Promise.resolve(cached);
  if (pending.has(url)) return pending.get(url);
  const p = new Promise((resolve) => {
    const img = new window.Image();
    img.crossOrigin = 'anonymous'; // mismo modo CORS que usa Konva (useHtmlImage)
    img.onload = () => {
      const done = () => {
        remember(url, img);
        pending.delete(url);
        resolve(img);
      };
      // decode() evita el "parpadeo" de decodificación en el primer frame
      if (img.decode) img.decode().then(done, done);
      else done();
    };
    img.onerror = () => {
      pending.delete(url);
      resolve(null);
    };
    img.src = url;
  });
  pending.set(url, p);
  return p;
}

// URLs de imagen que usa una lista de elementos de página (imágenes y galerías).
export function collectElementImageUrls(elements) {
  const urls = [];
  (elements || []).forEach((el) => {
    if (el?.kind === 'image' && el.props?.src) urls.push(resolveAssetUrl(el.props.src));
    if (el?.kind === 'gallery') {
      (el.props?.images || []).forEach((img) => {
        const src = typeof img === 'string' ? img : img?.src;
        if (src) urls.push(resolveAssetUrl(src));
      });
    }
  });
  return urls.filter(Boolean);
}

// Precarga con tope de tiempo: nunca bloquea la navegación más de `timeoutMs`.
export function preloadImages(urls, timeoutMs = 1500) {
  const unique = [...new Set(urls.filter(Boolean))];
  if (unique.length === 0) return Promise.resolve();
  const all = Promise.all(unique.map(loadImage));
  const timeout = new Promise((resolve) => window.setTimeout(resolve, timeoutMs));
  return Promise.race([all, timeout]);
}
