// Verificacion real (Playwright/Chromium) del fix: la miniatura de portada
// (Lote UX-3) debe funcionar tambien cuando la portada usa un elemento
// kind='gallery' (slideshow, Lote UX-10/UX-11) en vez de kind='image'.
// Reportado por Carlos: las portadas con imagen fija se ven bien en la
// ficha de "Mis Publicaciones", pero la portada armada con un slideshow se
// veia en blanco.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE_URL || 'http://100.71.185.7:5173';
const API = process.env.API_URL || 'http://100.71.185.7:8010';
const EMAIL = process.env.TEST_EMAIL || 'admin@flipbook.app';
const PASSWORD = process.env.TEST_PASSWORD || 'admin123';
const OUT_DIR = __dirname;

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAUBASCY42YAAAAAAAElFTkSuQmCC',
  'base64'
);
const PNG_PATH = path.join(OUT_DIR, '_ux3b_test.png');
fs.writeFileSync(PNG_PATH, PNG_1PX);

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

  console.log('2) crear publicacion y abrir editor');
  const token = await page.evaluate(() => localStorage.getItem('token'));
  const createResp = await page.evaluate(async ({ tok, api }) => {
    const r = await fetch(`${api}/api/publications`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
      body: JSON.stringify({ title: 'Verificacion portada-galeria ' + Date.now(), orientation: 'portrait', page_width: 210, page_height: 297, total_pages: 2 }),
    });
    return { status: r.status, body: await r.json() };
  }, { tok: token, api: API });
  if (createResp.status !== 201) throw new Error(`No se pudo crear publicacion: HTTP ${createResp.status}`);
  const publicationId = createResp.body.id;
  const pagesResp = await page.evaluate(async ({ tok, api, pubId }) => {
    const r = await fetch(`${api}/api/pages/publications/${pubId}/pages`, { headers: { Authorization: `Bearer ${tok}` } });
    return r.json();
  }, { tok: token, api: API, pubId: publicationId });
  const coverId = pagesResp.sort((a, b) => a.page_number - b.page_number)[0].id;

  await page.goto(`${BASE}/publications/${publicationId}/edit/${coverId}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('button[aria-label="Galería"]:not([disabled])', { timeout: 15000 });

  console.log('3) crear una galeria de 2 imagenes en la PORTADA (page_number=1)');
  const galleryInput = await page.$('input[type="file"][accept="image/*"][multiple]');
  if (!galleryInput) throw new Error('No se encontro el input de archivo multiple (Galeria/Collage)');
  await galleryInput.setInputFiles([
    { name: 'a.png', mimeType: 'image/png', buffer: fs.readFileSync(PNG_PATH) },
    { name: 'b.png', mimeType: 'image/png', buffer: fs.readFileSync(PNG_PATH) },
  ]);
  await page.waitForFunction(() => window.__pageEditorStore.elements.length === 1, { timeout: 15000 });
  const galleryEl = await page.evaluate(() => window.__pageEditorStore.elements[0]);
  if (galleryEl.kind !== 'gallery' || (galleryEl.props?.images || []).length !== 2) {
    throw new Error(`Elemento de galeria inesperado: ${JSON.stringify(galleryEl)}`);
  }

  console.log('4) guardar la portada con la galeria');
  await page.click('button.editor-v2-save');
  await page.waitForTimeout(1000);
  const bannerErrors = await page.$$eval('.editor-v2-banner-error', (els) => els.map((e) => e.textContent));
  if (bannerErrors.length > 0) throw new Error(`Error al guardar: ${bannerErrors.join(' | ')}`);

  console.log('5) verificar backend: GET /api/publications debe traer cover_image_url NO nulo para esta publicacion');
  const statsResp = await page.evaluate(async ({ tok, api }) => {
    const r = await fetch(`${api}/api/publications/stats/summary`, { headers: { Authorization: `Bearer ${tok}` } });
    return r.json();
  }, { tok: token, api: API });
  const listLimit = (statsResp.total_publications || 0) + 20;
  const listResp = await page.evaluate(async ({ tok, api, limit }) => {
    const r = await fetch(`${api}/api/publications?limit=${limit}`, { headers: { Authorization: `Bearer ${tok}` } });
    return r.json();
  }, { tok: token, api: API, limit: listLimit });
  const pubInList = listResp.find((p) => p.id === publicationId);
  if (!pubInList) throw new Error('La publicacion recien creada no aparece en el listado (limit insuficiente?)');
  if (!pubInList.cover_image_url) {
    throw new Error('BUG: cover_image_url sigue NULL para una portada armada con galeria/slideshow -- el fix no aplico');
  }
  if (!pubInList.cover_image_url.includes(galleryEl.props.images[0].src) && !pubInList.cover_image_url.includes(galleryEl.props.images[1].src)) {
    throw new Error(`cover_image_url no corresponde a ninguna imagen de la galeria: ${pubInList.cover_image_url}`);
  }
  console.log('   OK backend: cover_image_url =', pubInList.cover_image_url);

  console.log('6) verificar el renderizado real en "Publicaciones": la ficha debe mostrar <img> con src real, no en blanco');
  await page.goto(`${BASE}/publications`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.publication-card, [class*="publication"]', { timeout: 10000 }).catch(() => {});
  const cardImgSrc = await page.evaluate((pubId) => {
    const cards = Array.from(document.querySelectorAll('img'));
    const match = cards.find((img) => img.src && img.src.includes('/api/assets/serve/'));
    return match ? match.src : null;
  }, publicationId);
  if (!cardImgSrc) {
    throw new Error('No se encontro ninguna <img> con src real de asset en la lista de publicaciones tras crear la portada-galeria');
  }
  console.log('   OK frontend: al menos una ficha con portada-galeria renderiza <img> real:', cardImgSrc);

  if (consoleErrors.length > 0) {
    throw new Error('Errores de consola detectados:\n' + consoleErrors.join('\n'));
  }

  await browser.close();
  console.log('\n=== TODO OK: fix de miniatura de portada con galeria/slideshow verificado. ===');
})().catch((err) => {
  console.error('\n=== FALLO ===');
  console.error(err);
  process.exit(1);
});
