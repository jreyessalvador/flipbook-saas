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
    // Posiciones deliberadamente conservadoras (antes: 20/260/500) -- con
    // el zoom fit-to-screen del editor (Lote UX-3) el canvas visible puede
    // llegar a ocupar menos ancho en pantalla que el ancho nativo de la
    // pagina, y una figura demasiado cerca del borde derecho (630 = ancho
    // nativo de esta pagina A4) dejaba el marquee sin margen real para
    // cubrirla de forma confiable. Con estas posiciones las 3 formas caben
    // holgadamente lejos del borde, sin depender de cuanto reduzca el
    // fit-to-screen el canvas.
    s.updateElement(ids[0], { x: 20, y: 20 });
    s.updateElement(ids[1], { x: 220, y: 100 });
    s.updateElement(ids[2], { x: 400, y: 180 });
  });
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT_DIR}/lote1_01_tres_formas.png` });

  console.log('2) marquee-select real: arrastrar el mouse sobre el fondo del canvas para envolver las 3 formas');
  const stageBox = await page.locator('.editor-v2-stage').boundingBox();
  // El editor aplica zoom fit-to-screen (Lote UX-3, Konva Stage
  // scaleX/scaleY) -- stageBox ya no es 1:1 con las coordenadas de pagina
  // (mm*3) que usa el store, asi que los limites del marquee (antes
  // hardcodeados a 700x260px asumiendo scale=1) se calculan a partir de la
  // posicion REAL de las 3 formas + margen, convertidos a espacio de
  // pantalla con el scale real -- si no, con el canvas escalado hacia
  // abajo el marquee podia quedarse corto y no llegar a cubrir la estrella
  // (la mas alejada a la derecha).
  const scale = stageBox.width / (210 * 3); // publicacion creada como A4 portrait (210mm de ancho) mas arriba
  const shapesBounds = await page.evaluate(() => {
    const els = window.__pageEditorStore.elements;
    return {
      maxX: Math.max(...els.map((e) => e.x + e.width)),
      maxY: Math.max(...els.map((e) => e.y + e.height)),
    };
  });
  const startX = stageBox.x + 5;
  const startY = stageBox.y + 5;
  const endX = stageBox.x + Math.min(stageBox.width - 5, (shapesBounds.maxX + 40) * scale);
  const endY = stageBox.y + Math.min(stageBox.height - 5, (shapesBounds.maxY + 40) * scale);
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
  const shapeScreenX = stageBox.x + (before.x + before.width / 2) * scale;
  const shapeScreenY = stageBox.y + (before.y + before.height / 2) * scale;
  await page.mouse.move(shapeScreenX, shapeScreenY);
  await page.mouse.down();
  await page.mouse.move(shapeScreenX + 80, shapeScreenY + 40, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  const after = await page.evaluate(() => window.__pageEditorStore.elements[0]);
  // Comparacion en espacio de PANTALLA (multiplicando el delta guardado por
  // `scale`) -- nunca comparando unidades de pagina directamente contra los
  // 80/40px de arrastre en pantalla, o falla espuriamente con scale != 1.
  if (Math.abs((after.x - before.x) * scale - 80) > 5 || Math.abs((after.y - before.y) * scale - 40) > 5) {
    throw new Error(`Drag real no movio la figura como se esperaba: antes ${JSON.stringify(before)} despues ${JSON.stringify(after)} scale=${scale}`);
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
