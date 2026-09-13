// Verificacion Playwright del Lote UX-3 (parte 1): miniatura real de
// portada en las fichas de "Mis Publicaciones".
const { chromium } = require('playwright');

const BASE = process.env.BASE_URL || 'http://100.71.185.7:5173';
const API = process.env.API_URL || 'http://100.71.185.7:8010';
const EMAIL = process.env.TEST_EMAIL || 'admin@flipbook.app';
const PASSWORD = process.env.TEST_PASSWORD || 'admin123';

// PNG minimo valido (1x1, rojo) -- mismo fixture que otros lotes.
const PNG_1PX_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const consoleErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', (err) => consoleErrors.push('pageerror: ' + err.message));

  console.log('1) login');
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await Promise.all([
    page.waitForURL(/dashboard/, { timeout: 10000 }),
    page.click('button[type="submit"]'),
  ]);
  const token = await page.evaluate(() => localStorage.getItem('token'));

  console.log('2) crear una publicacion SIN imagen en la portada -- debe quedar en blanco');
  const pubEmpty = await page.evaluate(async ({ tok, api }) => {
    const r = await fetch(`${api}/api/publications`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
      body: JSON.stringify({ title: 'UX3 sin portada ' + Date.now(), orientation: 'portrait', page_width: 210, page_height: 297, total_pages: 2 }),
    });
    return r.json();
  }, { tok: token, api: API });

  console.log('3) crear una publicacion CON una imagen real en la portada');
  const pubWithImage = await page.evaluate(async ({ tok, api }) => {
    const r = await fetch(`${api}/api/publications`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
      body: JSON.stringify({ title: 'UX3 con portada ' + Date.now(), orientation: 'portrait', page_width: 210, page_height: 297, total_pages: 2 }),
    });
    return r.json();
  }, { tok: token, api: API });

  const pagesResp = await page.evaluate(async ({ tok, api, pubId }) => {
    const r = await fetch(`${api}/api/pages/publications/${pubId}/pages`, { headers: { Authorization: `Bearer ${tok}` } });
    return r.json();
  }, { tok: token, api: API, pubId: pubWithImage.id });
  const coverId = pagesResp.sort((a, b) => a.page_number - b.page_number)[0].id;

  // subir una imagen real y crear el elemento directamente via API (mas
  // rapido y confiable que pasar por el editor para este test puntual)
  const uploadResp = await page.evaluate(async ({ tok, api, b64 }) => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const blob = new Blob([bytes], { type: 'image/png' });
    const form = new FormData();
    form.append('file', blob, 'portada.png');
    const r = await fetch(`${api}/api/assets/upload`, { method: 'POST', headers: { Authorization: `Bearer ${tok}` }, body: form });
    return r.json();
  }, { tok: token, api: API, b64: PNG_1PX_B64 });

  const currentElements = await page.evaluate(async ({ tok, api, pageId }) => {
    const r = await fetch(`${api}/api/pages/${pageId}/elements`, { headers: { Authorization: `Bearer ${tok}` } });
    return r.json();
  }, { tok: token, api: API, pageId: coverId });

  await page.evaluate(async ({ tok, api, pageId, src, version }) => {
    const r = await fetch(`${api}/api/pages/${pageId}/elements`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
      body: JSON.stringify({ version, elements: [{ kind: 'image', x: 0, y: 0, width: 400, height: 300, rotation_deg: 0, z_index: 0, props: { src } }] }),
    });
    if (!r.ok) throw new Error('No se pudo guardar el elemento de imagen: HTTP ' + r.status + ' ' + await r.text());
  }, { tok: token, api: API, pageId: coverId, src: uploadResp.url, version: currentElements.version });

  console.log('4) verificar el backend directamente: GET /api/publications con limite alto (hay 90+ publicaciones de pruebas previas, la lista con limit=20 por defecto de la UI no garantiza incluir estas dos nuevas -- ver nota en el commit de docs)');
  const fullList = await page.evaluate(async ({ tok, api }) => {
    const r = await fetch(`${api}/api/publications?limit=500`, { headers: { Authorization: `Bearer ${tok}` } });
    return r.json();
  }, { tok: token, api: API });
  const backendEmpty = fullList.find((p) => p.id === pubEmpty.id);
  const backendWithImage = fullList.find((p) => p.id === pubWithImage.id);
  if (!backendEmpty || !backendWithImage) throw new Error('No se encontraron las publicaciones de prueba en GET /api/publications?limit=500');
  if (backendEmpty.cover_image_url !== null) throw new Error(`Se esperaba cover_image_url=null para la publicacion sin portada, vino: ${JSON.stringify(backendEmpty.cover_image_url)}`);
  if (!backendWithImage.cover_image_url || !backendWithImage.cover_image_url.includes('/api/assets/serve/')) {
    throw new Error(`cover_image_url inesperado para la publicacion con portada: ${JSON.stringify(backendWithImage.cover_image_url)}`);
  }
  console.log('   OK backend: sin portada -> cover_image_url=null; con portada -> cover_image_url =', backendWithImage.cover_image_url);

  console.log('5) verificar el renderizado real: abrir "Publicaciones" (lista por defecto) y confirmar que el wiring frontend funciona en lo que se muestra');
  await page.goto(`${BASE}/publications`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.publication-card', { timeout: 10000 });
  const cardsWithImg = await page.locator('.card-header img').count();
  const cardsBlank = await page.locator('.placeholder-image-empty').count();
  console.log('   fichas visibles con miniatura real:', cardsWithImg, '| fichas en blanco:', cardsBlank);
  if (cardsWithImg === 0 && cardsBlank === 0) throw new Error('Ninguna ficha visible -- el listado parece vacio o roto');
  // Con 90+ publicaciones de pruebas previas casi seguro hay de ambos tipos
  // en la primera pagina, pero no se fuerza (evita un test fragil atado al
  // orden exacto de insercion en Postgres, que no esta garantizado sin
  // ORDER BY explicito -- limitacion de paginacion ya anotada aparte).
  if (cardsWithImg > 0) {
    const firstImgSrc = await page.locator('.card-header img').first().getAttribute('src');
    if (!firstImgSrc || !firstImgSrc.includes('/api/assets/serve/')) throw new Error(`src de miniatura visible inesperado: "${firstImgSrc}"`);
    console.log('   OK: al menos una ficha visible renderiza <img> con src real:', firstImgSrc);
  }
  if (cardsBlank > 0) {
    console.log('   OK: al menos una ficha visible usa el placeholder en blanco (sin icono generico)');
  }

  if (consoleErrors.length > 0) {
    console.log('\n=== Errores de consola detectados (no tolerados) ===');
    consoleErrors.forEach((e) => console.log(' -', e));
    throw new Error('Se detectaron errores de consola inesperados.');
  }

  console.log('\nOK -- el Lote UX-3 (miniaturas de portada) paso sin errores de consola.');
  await browser.close();
})().catch(async (err) => {
  console.error('FALLO:', err.message || err);
  process.exit(1);
});
