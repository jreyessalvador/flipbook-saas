// Verificacion Playwright del Lote UX-3 (parte 2): zoom fit-to-screen en
// el editor + visor publico renderizando contenido REAL (antes siempre
// mostraba "Pagina vacia", bug real encontrado en este lote).
const { chromium } = require('playwright');

const BASE = process.env.BASE_URL || 'http://100.71.185.7:5173';
const API = process.env.API_URL || 'http://100.71.185.7:8010';
const EMAIL = process.env.TEST_EMAIL || 'admin@flipbook.app';
const PASSWORD = process.env.TEST_PASSWORD || 'admin123';
const OUT_DIR = __dirname;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
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

  console.log('2) crear publicacion de 5 hojas (portada + 3 interiores + contraportada) y agregarle un rectangulo real en la portada');
  const pub = await page.evaluate(async ({ tok, api }) => {
    const r = await fetch(`${api}/api/publications`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
      body: JSON.stringify({ title: 'UX3 fit+viewer ' + Date.now(), orientation: 'portrait', page_width: 210, page_height: 297, total_pages: 5 }),
    });
    return r.json();
  }, { tok: token, api: API });

  const pagesResp = await page.evaluate(async ({ tok, api, pubId }) => {
    const r = await fetch(`${api}/api/pages/publications/${pubId}/pages`, { headers: { Authorization: `Bearer ${tok}` } });
    return r.json();
  }, { tok: token, api: API, pubId: pub.id });
  const sorted = pagesResp.sort((a, b) => a.page_number - b.page_number);
  const coverId = sorted[0].id;

  const currentElements = await page.evaluate(async ({ tok, api, pageId }) => {
    const r = await fetch(`${api}/api/pages/${pageId}/elements`, { headers: { Authorization: `Bearer ${tok}` } });
    return r.json();
  }, { tok: token, api: API, pageId: coverId });

  await page.evaluate(async ({ tok, api, pageId, version }) => {
    const r = await fetch(`${api}/api/pages/${pageId}/elements`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
      body: JSON.stringify({ version, elements: [{ kind: 'shape', x: 20, y: 20, width: 150, height: 100, rotation_deg: 0, z_index: 0, props: { shape_type: 'rect', fill: '#ff4444' } }] }),
    });
    if (!r.ok) throw new Error('No se pudo guardar el rectangulo: HTTP ' + r.status);
  }, { tok: token, api: API, pageId: coverId, version: currentElements.version });

  console.log('3) abrir el EDITOR en la portada -- debe caber sin scroll vertical (fit-to-screen)');
  await page.goto(`${BASE}/publications/${pub.id}/edit/${coverId}`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__pageEditorStoreLeft?.elements?.length === 1, { timeout: 10000 });

  const wrapMetrics = await page.evaluate(() => {
    const wrap = document.querySelector('.editor-v2-canvas-wrap');
    return { scrollHeight: wrap.scrollHeight, clientHeight: wrap.clientHeight };
  });
  console.log('   editor-v2-canvas-wrap:', JSON.stringify(wrapMetrics));
  if (wrapMetrics.scrollHeight > wrapMetrics.clientHeight + 2) {
    throw new Error(`El wrap del canvas sigue necesitando scroll vertical: scrollHeight=${wrapMetrics.scrollHeight} > clientHeight=${wrapMetrics.clientHeight}`);
  }
  console.log('   OK: la portada cabe completa sin scroll vertical al entrar');
  await page.screenshot({ path: `${OUT_DIR}/ux3_01_editor_fit_cover.png` });

  console.log('4) abrir el VISOR PUBLICO en la misma portada -- debe mostrar el rectangulo real, no "Pagina vacia"');
  await page.goto(`${BASE}/publications/${pub.id}/view`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.editor-v2-stage', { timeout: 10000 });
  const emptyPageText = await page.locator('text=Página vacía').count();
  if (emptyPageText > 0) throw new Error('El visor sigue mostrando "Pagina vacia" pese a que la portada tiene un elemento real guardado');
  const rectCount = await page.evaluate(() => document.querySelectorAll('.editor-v2-stage').length);
  if (rectCount < 1) throw new Error('No se encontro ningun Stage de Konva en el visor');
  console.log('   OK: el visor NO muestra "Pagina vacia" -- renderiza el Stage real con el rectangulo');
  await page.screenshot({ path: `${OUT_DIR}/ux3_02_viewer_cover_real_content.png` });

  console.log('5) footer del visor: debe ser compacto (.editor-v2-pagenav) y permitir saltar de pagina con el campo editable');
  const pagenavCount = await page.locator('.editor-v2-pagenav').count();
  if (pagenavCount !== 1) throw new Error('No se encontro el footer compacto .editor-v2-pagenav en el visor');
  const thumbnailsBarCount = await page.locator('.thumbnails-bar').count();
  if (thumbnailsBarCount !== 0) throw new Error('La franja vieja de miniaturas (.thumbnails-bar) sigue presente -- deberia haberse retirado');
  await page.fill('.editor-v2-pagenav input[type="number"]', '3');
  await page.locator('.editor-v2-pagenav input[type="number"]').press('Enter');
  await page.waitForTimeout(500);
  const positionLabel = await page.textContent('.editor-v2-pagenav-position');
  console.log('   posicion tras saltar a la pagina 3:', positionLabel.trim());
  if (!positionLabel.includes('3')) throw new Error(`El salto manual a la pagina 3 no funciono, footer muestra: "${positionLabel}"`);
  console.log('   OK: footer compacto, sin franja de miniaturas, salto manual de pagina funciona');
  await page.screenshot({ path: `${OUT_DIR}/ux3_03_viewer_footer_compact.png` });

  console.log('6) el visor en un spread interior tambien debe caber sin scroll vertical');
  const spreadMetrics = await page.evaluate(() => {
    const wrap = document.querySelector('.editor-v2-canvas-wrap');
    return { scrollHeight: wrap.scrollHeight, clientHeight: wrap.clientHeight };
  });
  console.log('   editor-v2-canvas-wrap (spread):', JSON.stringify(spreadMetrics));
  if (spreadMetrics.scrollHeight > spreadMetrics.clientHeight + 2) {
    throw new Error(`El spread del visor sigue necesitando scroll vertical: scrollHeight=${spreadMetrics.scrollHeight} > clientHeight=${spreadMetrics.clientHeight}`);
  }
  console.log('   OK: el spread tambien cabe sin scroll vertical');

  if (consoleErrors.length > 0) {
    console.log('\n=== Errores de consola detectados (no tolerados) ===');
    consoleErrors.forEach((e) => console.log(' -', e));
    throw new Error('Se detectaron errores de consola inesperados.');
  }

  console.log('\nOK -- el Lote UX-3 (parte 2: fit-to-screen + visor con contenido real) paso sin errores de consola.');
  await browser.close();
})().catch(async (err) => {
  console.error('FALLO:', err.message || err);
  process.exit(1);
});
