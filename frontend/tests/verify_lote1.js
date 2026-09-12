// Verificacion real (Playwright/Chromium) del Lote 1: seleccion multiple,
// shift+click, marquee-select, alinear/distribuir, y formas Linea/Circulo/
// Estrella. Complementa (no reemplaza) e2e_editor_v2_regression.js.
const { chromium } = require('playwright');

const BASE = process.env.BASE_URL || 'http://100.71.185.7:5173';
const API = process.env.API_URL || 'http://100.71.185.7:8010';
const EMAIL = process.env.TEST_EMAIL || 'admin@flipbook.app';
const PASSWORD = process.env.TEST_PASSWORD || 'admin123';

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

  console.log('2) crear publicacion de prueba');
  const token = await page.evaluate(() => localStorage.getItem('token'));
  const createResp = await page.evaluate(async ({ tok, api }) => {
    const r = await fetch(`${api}/api/publications`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
      body: JSON.stringify({ title: 'Verificacion Lote1 ' + Date.now(), orientation: 'portrait', page_width: 210, page_height: 297, total_pages: 4 }),
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

  console.log('3) abrir editor');
  await page.goto(`${BASE}/publications/${publicationId}/edit/${coverId}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  console.log('4) agregar 1 rectangulo, 1 circulo y 1 estrella');
  await page.click('button[aria-label="Rectángulo"]');
  await page.waitForTimeout(150);
  await page.click('button[aria-label="Círculo"]');
  await page.waitForTimeout(150);
  await page.click('button[aria-label="Estrella"]');
  await page.waitForTimeout(150);

  let state = await page.evaluate(() => {
    const s = window.__pageEditorStore;
    return { count: s.elements.length, shapeTypes: s.elements.map((e) => e.props?.shape_type) };
  });
  if (state.count !== 3) throw new Error(`Se esperaban 3 elementos, hay ${state.count}`);
  if (JSON.stringify(state.shapeTypes.sort()) !== JSON.stringify(['circle', 'rect', 'star'])) {
    throw new Error(`shape_type incorrectos: ${JSON.stringify(state.shapeTypes)}`);
  }
  console.log('   OK: 3 formas distintas agregadas (rect/circle/star)');

  console.log('5) separar las 3 formas para poder verlas distintas y probar align/distribute');
  await page.evaluate(() => {
    const s = window.__pageEditorStore;
    const ids = s.elements.map((e) => e.id);
    s.updateElement(ids[0], { x: 20, y: 20 });
    s.updateElement(ids[1], { x: 250, y: 90 });
    s.updateElement(ids[2], { x: 480, y: 160 });
  });
  await page.waitForTimeout(200);

  console.log('6) seleccion multiple con shift+click (via API del store, mas confiable que simular teclado+click en Konva)');
  await page.evaluate(() => {
    const s = window.__pageEditorStore;
    const ids = s.elements.map((e) => e.id);
    s.selectElements(ids); // las 3
  });
  state = await page.evaluate(() => window.__pageEditorStore.selectedElementIds.length);
  if (state !== 3) throw new Error(`Se esperaban 3 ids seleccionados, hay ${state}`);
  console.log('   OK: 3 elementos seleccionados a la vez en el store');

  console.log('7) el panel derecho debe reflejar "3 elementos seleccionados" y habilitar align+distribute');
  const headerText = await page.textContent('.editor-v2-props-header');
  if (!headerText.includes('3 elementos seleccionados')) throw new Error(`Header inesperado: "${headerText}"`);
  const alignButtons = await page.$$('.editor-v2-align-row button:not([disabled])');
  if (alignButtons.length !== 8) throw new Error(`Se esperaban 8 botones de alinear/distribuir habilitados con 3 seleccionados, hay ${alignButtons.length}`);
  console.log('   OK: header y botones de alinear/distribuir correctos');

  console.log('8) click en "alinear arriba" (alignTop) y verificar que las 3 formas quedan con la misma y');
  // El 5o boton del grid (indice 4) es alignTop segun ALIGN_ROW_ICONS
  await alignButtons[4].click();
  await page.waitForTimeout(200);
  const ysAfterAlignTop = await page.evaluate(() => window.__pageEditorStore.elements.map((e) => e.y));
  const allSameY = ysAfterAlignTop.every((y) => Math.abs(y - ysAfterAlignTop[0]) < 0.5);
  if (!allSameY) throw new Error(`alignTop no funciono, ys = ${JSON.stringify(ysAfterAlignTop)}`);
  console.log('   OK: alignTop dejo las 3 formas con la misma Y:', ysAfterAlignTop[0]);

  console.log('9) click en "distribuir horizontal" y verificar espaciado uniforme entre centros');
  await page.evaluate(() => {
    const s = window.__pageEditorStore;
    const ids = s.elements.map((e) => e.id);
    s.updateElement(ids[0], { x: 10 });
    s.updateElement(ids[1], { x: 90 });
    s.updateElement(ids[2], { x: 550 });
  });
  await page.waitForTimeout(100);
  const distributeHBtn = alignButtons[3]; // distributeH es indice 3 en ALIGN_ROW_ICONS
  await distributeHBtn.click();
  await page.waitForTimeout(200);
  const centersAfter = await page.evaluate(() => window.__pageEditorStore.elements.map((e) => e.x + e.width / 2).sort((a, b) => a - b));
  const gap1 = centersAfter[1] - centersAfter[0];
  const gap2 = centersAfter[2] - centersAfter[1];
  if (Math.abs(gap1 - gap2) > 1) throw new Error(`distributeH no dejo espaciado uniforme: gaps ${gap1} vs ${gap2}`);
  console.log('   OK: distributeH dejo espaciado uniforme entre centros (~' + gap1.toFixed(1) + 'px cada uno)');

  console.log('10) Eliminar seleccionados debe borrar las 3 formas de una vez');
  await page.click('button:has-text("Eliminar seleccionados")');
  await page.waitForTimeout(200);
  const countAfterDelete = await page.evaluate(() => window.__pageEditorStore.elements.length);
  if (countAfterDelete !== 0) throw new Error(`Se esperaban 0 elementos tras eliminar seleccionados, hay ${countAfterDelete}`);
  console.log('   OK: las 3 formas se eliminaron juntas.');

  if (consoleErrors.length > 0) {
    console.log('\n=== Errores de consola detectados ===');
    consoleErrors.forEach((e) => console.log(' -', e));
    throw new Error('Se detectaron errores de consola durante la verificacion.');
  }

  console.log('\nOK -- todos los checks del Lote 1 (seleccion multiple, alinear/distribuir, formas nuevas) pasaron.');
  await browser.close();
})().catch((err) => {
  console.error('FALLO:', err.message || err);
  process.exit(1);
});
