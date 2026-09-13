// Verificacion real (Playwright/Chromium) del Lote UX-2 (paleta editorial
// navy+dorado) y Lote UX-4 (brillo/contraste + esquinas redondeadas en
// imagenes). Complementa la suite existente (16 scripts previos).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE_URL || 'http://100.71.185.7:5173';
const API = process.env.API_URL || 'http://100.71.185.7:8010';
const EMAIL = process.env.TEST_EMAIL || 'admin@flipbook.app';
const PASSWORD = process.env.TEST_PASSWORD || 'admin123';
const OUT_DIR = __dirname;

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);
const PNG_PATH = path.join(OUT_DIR, '_ux4_test.png');
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

  console.log('2) UX-2 -- comprobar paleta navy/dorado en el navbar (dashboard) via getComputedStyle');
  const navbarBg = await page.$eval('.navbar', (el) => getComputedStyle(el).backgroundColor);
  if (navbarBg !== 'rgb(12, 21, 38)') throw new Error(`Navbar deberia ser navy oscuro (#0c1526), se obtuvo ${navbarBg}`);
  console.log('   OK: navbar =', navbarBg);
  await page.screenshot({ path: `${OUT_DIR}/ux2_01_dashboard.png` });

  console.log('3) crear publicacion de prueba y abrir editor');
  const token = await page.evaluate(() => localStorage.getItem('token'));
  const createResp = await page.evaluate(async ({ tok, api }) => {
    const r = await fetch(`${api}/api/publications`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
      body: JSON.stringify({ title: 'Verificacion UX-2/UX-4 ' + Date.now(), orientation: 'portrait', page_width: 210, page_height: 297, total_pages: 2 }),
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
  await page.waitForSelector('button[aria-label="Rectángulo"]:not([disabled])', { timeout: 15000 });

  console.log('4) UX-2 -- boton "Guardar" debe ser dorado, no indigo');
  const saveBg = await page.$eval('button.editor-v2-save', (el) => getComputedStyle(el).backgroundColor);
  if (saveBg !== 'rgb(201, 162, 75)') throw new Error(`Boton Guardar deberia ser dorado (#c9a24b), se obtuvo ${saveBg}`);
  console.log('   OK: boton Guardar =', saveBg);

  console.log('5) UX-2 -- figura nueva por defecto debe usar el fill navy (#14213d), no el indigo anterior');
  await page.click('button[aria-label="Rectángulo"]');
  await page.waitForFunction(() => window.__pageEditorStore.elements.length === 1, { timeout: 10000 });
  const shapeFill = await page.evaluate(() => window.__pageEditorStore.elements[0].props.fill);
  if (shapeFill !== '#14213d') throw new Error(`Fill por defecto de figura deberia ser #14213d, es ${shapeFill}`);
  console.log('   OK: fill de figura nueva =', shapeFill);

  console.log('6) UX-4 -- subir una imagen real y aplicar brillo/contraste/radio de esquina desde el panel');
  const imageInput = await page.$('input[type="file"][accept="image/*"]:not([multiple])');
  await imageInput.setInputFiles({ name: 'foto.png', mimeType: 'image/png', buffer: fs.readFileSync(PNG_PATH) });
  await page.waitForFunction(() => window.__pageEditorStore.elements.length === 2, { timeout: 10000 });
  const imageEl = await page.evaluate(() => window.__pageEditorStore.elements.find((e) => e.kind === 'image'));
  if (!imageEl) throw new Error('No se creo el elemento de imagen');

  // Seleccionar la imagen haciendo click sobre su nodo en el Stage (misma
  // tecnica que otros tests: boundingBox + mouse.click, ver lecciones de
  // scale de fit-to-screen documentadas en RECETA-DESARROLLO.md 9g).
  const stageBox = await page.locator('.editor-v2-stage').first().boundingBox();
  const nativeWidthMm = 210; // portrait, page_width
  const scale = stageBox.width / (nativeWidthMm * 3); // PX_PER_MM = 3, ver CanvasEditorV2.jsx
  await page.mouse.click(stageBox.x + (imageEl.x + imageEl.width / 2) * scale, stageBox.y + (imageEl.y + imageEl.height / 2) * scale);
  await page.waitForTimeout(300);
  const selectedAfterClick = await page.evaluate(() => window.__pageEditorStore.selectedElementIds);
  if (!selectedAfterClick.includes(imageEl.id)) throw new Error(`La imagen no quedo seleccionada tras el click: ${JSON.stringify(selectedAfterClick)}`);

  await page.waitForSelector('.editor-v2-field-range input[type="range"]', { timeout: 5000 });
  const ranges = await page.$$('.editor-v2-field-range input[type="range"]');
  if (ranges.length !== 2) throw new Error(`Se esperaban 2 sliders (brillo/contraste), hay ${ranges.length}`);
  await ranges[0].fill('0.5'); // brillo
  await ranges[0].dispatchEvent('change');
  await ranges[1].fill('60'); // contraste
  await ranges[1].dispatchEvent('change');

  const cornerRadiusInputs = await page.$$('.editor-v2-field-grid input[type="number"]');
  // El campo "Radio de esquina" es el unico NumberField visible fuera del
  // grid de Transformar en este momento (Transformar tiene su propio grid) --
  // localizarlo por el texto de su label es mas robusto.
  const cornerLabel = page.locator('.editor-v2-props-section', { hasText: 'Apariencia' }).locator('label', { hasText: 'Radio de esquina' });
  const cornerInput = cornerLabel.locator('input');
  await cornerInput.fill('20');
  await cornerInput.press('Tab');
  await page.waitForTimeout(300);

  const imgPropsAfter = await page.evaluate((id) => window.__pageEditorStore.elements.find((e) => e.id === id).props, imageEl.id);
  if (imgPropsAfter.brightness !== 0.5) throw new Error(`brightness esperado 0.5, es ${imgPropsAfter.brightness}`);
  if (imgPropsAfter.contrast !== 60) throw new Error(`contrast esperado 60, es ${imgPropsAfter.contrast}`);
  if (imgPropsAfter.cornerRadius !== 20) throw new Error(`cornerRadius esperado 20, es ${imgPropsAfter.cornerRadius}`);
  console.log('   OK: props tras ajustar sliders/radio =', JSON.stringify(imgPropsAfter));
  await page.screenshot({ path: `${OUT_DIR}/ux4_01_imagen_ajustada.png` });

  console.log('7) guardar y confirmar sin errores de consola/banner');
  await page.click('button.editor-v2-save');
  await page.waitForTimeout(1000);
  const bannerErrors = await page.$$eval('.editor-v2-banner-error', (els) => els.map((e) => e.textContent));
  if (bannerErrors.length > 0) throw new Error(`Error al guardar: ${bannerErrors.join(' | ')}`);

  console.log('8) recargar y confirmar persistencia de brightness/contrast/cornerRadius');
  await page.goto(`${BASE}/publications/${publicationId}/edit/${coverId}`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__pageEditorStore.elements.length === 2, { timeout: 10000 });
  const imgAfterReload = await page.evaluate(() => window.__pageEditorStore.elements.find((e) => e.kind === 'image'));
  if (imgAfterReload.props.brightness !== 0.5 || imgAfterReload.props.contrast !== 60 || imgAfterReload.props.cornerRadius !== 20) {
    throw new Error(`No persistieron los ajustes tras recargar: ${JSON.stringify(imgAfterReload.props)}`);
  }
  console.log('   OK: persistencia confirmada tras guardar+recargar.');
  await page.screenshot({ path: `${OUT_DIR}/ux4_02_reload.png` });

  if (consoleErrors.length > 0) {
    throw new Error('Errores de consola detectados:\n' + consoleErrors.join('\n'));
  }

  await browser.close();
  console.log('\n=== TODO OK: Lote UX-2 (paleta) y Lote UX-4 (brillo/contraste/esquinas en imagenes) verificados. ===');
})().catch((err) => {
  console.error('\n=== FALLO ===');
  console.error(err);
  process.exit(1);
});
