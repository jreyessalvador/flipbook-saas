// Verificacion visual (interaccion REAL de mouse, no solo llamadas al store)
// del marquee-select y el drag de figuras -- complementa verify_lote1.js.
const { chromium } = require('playwright');

const BASE = process.env.BASE_URL || 'http://100.71.185.7:5173';
const API = process.env.API_URL || 'http://100.71.185.7:8010';
const EMAIL = process.env.TEST_EMAIL || 'admin@flipbook.app';
const PASSWORD = process.env.TEST_PASSWORD || 'admin123';
const OUT_DIR = __dirname;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const consoleErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', (err) => consoleErrors.push('pageerror: ' + err.message));

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await Promise.all([page.waitForURL(/dashboard/, { timeout: 10000 }), page.click('button[type="submit"]')]);

  const token = await page.evaluate(() => localStorage.getItem('token'));
  const createResp = await page.evaluate(async ({ tok, api }) => {
    const r = await fetch(`${api}/api/publications`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
      body: JSON.stringify({ title: 'Verificacion Lote1 Visual ' + Date.now(), orientation: 'portrait', page_width: 210, page_height: 297, total_pages: 4 }),
    });
    return { status: r.status, body: await r.json() };
  }, { tok: token, api: API });
  const publicationId = createResp.body.id;
  const pagesResp = await page.evaluate(async ({ tok, api, pubId }) => {
    const r = await fetch(`${api}/api/pages/publications/${pubId}/pages`, { headers: { Authorization: `Bearer ${tok}` } });
    return r.json();
  }, { tok: token, api: API, pubId: publicationId });
  const coverId = pagesResp.sort((a, b) => a.page_number - b.page_number)[0].id;

  await page.goto(`${BASE}/publications/${publicationId}/edit/${coverId}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  console.log('1) agregar rectangulo, circulo y estrella; separarlos');
  await page.click('button[aria-label="Rectángulo"]');
  await page.waitForTimeout(100);
  await page.click('button[aria-label="Círculo"]');
  await page.waitForTimeout(100);
  await page.click('button[aria-label="Estrella"]');
  await page.waitForTimeout(100);
  await page.evaluate(() => {
    const s = window.__pageEditorStore;
    const ids = s.elements.map((e) => e.id);
    s.updateElement(ids[0], { x: 20, y: 20 });
    s.updateElement(ids[1], { x: 260, y: 100 });
    s.updateElement(ids[2], { x: 500, y: 180 });
  });
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT_DIR}/lote1_01_tres_formas.png` });

  console.log('2) marquee-select real: arrastrar el mouse sobre el fondo del canvas para envolver las 3 formas');
  const stageBox = await page.locator('.editor-v2-stage').boundingBox();
  const startX = stageBox.x + 5;
  const startY = stageBox.y + 5;
  const endX = stageBox.x + Math.min(stageBox.width - 5, 700);
  const endY = stageBox.y + Math.min(stageBox.height - 5, 260);
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move((startX + endX) / 2, (startY + endY) / 2, { steps: 5 });
  await page.mouse.move(endX, endY, { steps: 5 });
  await page.screenshot({ path: `${OUT_DIR}/lote1_02_marquee_arrastrando.png` });
  await page.mouse.up();
  await page.waitForTimeout(200);

  const selCount = await page.evaluate(() => window.__pageEditorStore.selectedElementIds.length);
  if (selCount !== 3) throw new Error(`Marquee-select con mouse real: se esperaban 3 seleccionados, hay ${selCount}`);
  console.log('   OK: marquee-select con arrastre de mouse REAL selecciono las 3 formas');
  await page.screenshot({ path: `${OUT_DIR}/lote1_03_marquee_resultado.png` });

  console.log('3) drag real de una figura individual con el mouse (sin multi-seleccion)');
  await page.mouse.click(5, 5); // clic fuera para limpiar seleccion (fuera del stage, en el encabezado oscuro superior -- ya no hay sidebar lateral)
  await page.waitForTimeout(100);
  const before = await page.evaluate(() => window.__pageEditorStore.elements[0]);
  const shapeScreenX = stageBox.x + before.x + before.width / 2;
  const shapeScreenY = stageBox.y + before.y + before.height / 2;
  await page.mouse.move(shapeScreenX, shapeScreenY);
  await page.mouse.down();
  await page.mouse.move(shapeScreenX + 80, shapeScreenY + 40, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  const after = await page.evaluate(() => window.__pageEditorStore.elements[0]);
  if (Math.abs(after.x - before.x - 80) > 5 || Math.abs(after.y - before.y - 40) > 5) {
    throw new Error(`Drag real no movio la figura como se esperaba: antes ${JSON.stringify(before)} despues ${JSON.stringify(after)}`);
  }
  console.log('   OK: drag real con mouse movio la figura correctamente (rect de', before.x, before.y, 'a', after.x, after.y, ')');
  await page.screenshot({ path: `${OUT_DIR}/lote1_04_drag_resultado.png` });

  if (consoleErrors.length > 0) {
    console.log('\n=== Errores de consola ===');
    consoleErrors.forEach((e) => console.log(' -', e));
    throw new Error('Errores de consola detectados.');
  }

  console.log('\nOK -- verificacion visual con interaccion real de mouse paso completa.');
  await browser.close();
})().catch((err) => {
  console.error('FALLO:', err.message || err);
  process.exit(1);
});
