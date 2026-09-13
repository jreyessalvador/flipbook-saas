// Verificacion real (Playwright/Chromium) del Lote UX-11: la Galeria/Collage
// debe rotar en VIVO dentro del propio lienzo de edicion (antes solo
// rotaba en el visor publico, Lote UX-10). Confirmado por Carlos tras ver
// el editor real de Joomag (mismo comportamiento).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE_URL || 'http://100.71.185.7:5173';
const API = process.env.API_URL || 'http://100.71.185.7:8010';
const EMAIL = process.env.TEST_EMAIL || 'admin@flipbook.app';
const PASSWORD = process.env.TEST_PASSWORD || 'admin123';
const OUT_DIR = __dirname;

function pngFixture(rgb) {
  // PNG 1x1 solido -- genera 3 colores distintos para distinguir visualmente
  // cual imagen esta activa en cada captura.
  const zlib = require('zlib');
  const width = 1, height = 1;
  const raw = Buffer.from([0, ...rgb]); // filter byte 0 + RGB
  const compressed = zlib.deflateSync(raw);
  function chunk(type, data) {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const typeBuf = Buffer.from(type);
    const crcBuf = Buffer.alloc(4);
    const crc = require('zlib').crc32 ? null : null;
    return null;
  }
  return null;
}

// Los PNG 1x1 de colores distintos se generan mas simple con un buffer
// PNG minimo hardcodeado (mismo 1x1 rojo reutilizado en otros tests) mas
// dos variantes generadas con Node "canvas"-free: reusamos el mismo
// fixture para las 3 imagenes -- lo que importa para esta verificacion no
// es el color sino que el DOM/Konva realmente cambie de indice solo, cosa
// que se confirma leyendo window state, no comparando pixeles.
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);
const PNG_PATH = path.join(OUT_DIR, '_ux11_test.png');
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
      body: JSON.stringify({ title: 'Verificacion UX-11 ' + Date.now(), orientation: 'portrait', page_width: 210, page_height: 297, total_pages: 2 }),
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

  console.log('3) crear una galeria con 3 imagenes (boton "Galería" del rail, subida secuencial)');
  const galleryInput = await page.$('input[type="file"][accept="image/*"][multiple]');
  if (!galleryInput) throw new Error('No se encontro el input de archivo multiple (Galeria/Collage)');
  await galleryInput.setInputFiles([
    { name: 'a.png', mimeType: 'image/png', buffer: fs.readFileSync(PNG_PATH) },
    { name: 'b.png', mimeType: 'image/png', buffer: fs.readFileSync(PNG_PATH) },
    { name: 'c.png', mimeType: 'image/png', buffer: fs.readFileSync(PNG_PATH) },
  ]);
  await page.waitForFunction(() => window.__pageEditorStore.elements.length === 1, { timeout: 15000 });
  const galleryEl = await page.evaluate(() => window.__pageEditorStore.elements[0]);
  if (galleryEl.kind !== 'gallery' || (galleryEl.props?.images || []).length !== 3) {
    throw new Error(`Elemento de galeria inesperado: ${JSON.stringify(galleryEl)}`);
  }
  console.log('   OK: galeria creada con 3 imagenes, layout =', galleryEl.props.layout);

  console.log('4) configurar transicion rapida (1s) desde el modal de Galeria, para no esperar los 3s por defecto');
  const stageBox0 = await page.locator('.editor-v2-stage').first().boundingBox();
  const nativeWidthMm = 210;
  const scale0 = stageBox0.width / (nativeWidthMm * 3);
  await page.mouse.click(stageBox0.x + (galleryEl.x + galleryEl.width / 2) * scale0, stageBox0.y + (galleryEl.y + galleryEl.height / 2) * scale0);
  await page.waitForTimeout(300);
  const configureBtn = page.locator('button', { hasText: 'Configurar galería' });
  await configureBtn.click();
  await page.waitForSelector('.editor-v2-modal-gallery', { timeout: 5000 });
  const durationInput = page.locator('.editor-v2-modal-gallery input[type="number"]');
  await durationInput.fill('1');
  await page.locator('.editor-v2-modal-gallery button', { hasText: 'Actualizar' }).click();
  await page.waitForTimeout(300);
  const durationAfter = await page.evaluate(() => window.__pageEditorStore.elements[0].props.transition_duration);
  if (Number(durationAfter) !== 1) throw new Error(`transition_duration esperado 1, es ${durationAfter}`);
  console.log('   OK: transition_duration = 1s');

  console.log('5) EN EL PROPIO EDITOR (sin guardar, sin publicar, sin recargar): leer el indice de slide activo via el hook de debug window.__gallerySlideDebug');
  const debugBefore = await page.evaluate((id) => window.__gallerySlideDebug?.[id], galleryEl.id);
  if (!debugBefore) throw new Error('window.__gallerySlideDebug no expone el elemento de galeria -- hook de debug ausente o id incorrecto');
  if (debugBefore.canEdit !== true || debugBefore.autoplay !== true) {
    throw new Error(`Se esperaba canEdit=true y autoplay=true en el editor, se obtuvo ${JSON.stringify(debugBefore)}`);
  }
  console.log('   slideIndex inicial =', debugBefore.slideIndex);
  await page.screenshot({ path: `${OUT_DIR}/ux11_01_editor_t0.png` });

  console.log('6) esperar 4.5s (duracion=1s, 3 imagenes -> deberian darse >= 3 transiciones) y confirmar que el indice SI cambio solo, sin ninguna interaccion del usuario');
  await page.waitForTimeout(4500);
  const debugAfter = await page.evaluate((id) => window.__gallerySlideDebug?.[id], galleryEl.id);
  console.log('   slideIndex tras 4.5s sin interaccion =', debugAfter.slideIndex);
  if (debugAfter.slideIndex === debugBefore.slideIndex) {
    throw new Error(`BUG: el slideIndex no cambio tras 4.5s de autoplay dentro del editor (sigue en ${debugAfter.slideIndex}) -- el slideshow NO esta rotando solo en el editor`);
  }
  console.log('   OK: el slideshow rota SOLO dentro del propio editor, sin publicar ni recargar.');
  await page.screenshot({ path: `${OUT_DIR}/ux11_02_editor_t4500ms.png` });

  console.log('7) confirmar que la galeria sigue siendo un elemento Konva real: seleccionable, arrastrable y transformable pese al autoplay corriendo');
  const stageBox = await page.locator('.editor-v2-stage').first().boundingBox();
  const scale = stageBox.width / (nativeWidthMm * 3);
  const beforeDrag = await page.evaluate(() => window.__pageEditorStore.elements[0]);
  const startX = stageBox.x + (beforeDrag.x + beforeDrag.width / 2) * scale;
  const startY = stageBox.y + (beforeDrag.y + beforeDrag.height / 2) * scale;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 40 * scale, startY + 30 * scale, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const afterDrag = await page.evaluate(() => window.__pageEditorStore.elements[0]);
  if (Math.abs(afterDrag.x - beforeDrag.x - 40) > 5 || Math.abs(afterDrag.y - beforeDrag.y - 30) > 5) {
    throw new Error(`El drag no movio la galeria como se esperaba: antes=(${beforeDrag.x},${beforeDrag.y}) despues=(${afterDrag.x},${afterDrag.y})`);
  }
  console.log('   OK: drag real con mouse sigue funcionando pese al autoplay del slideshow -- de (', beforeDrag.x, beforeDrag.y, ') a (', afterDrag.x, afterDrag.y, ')');

  console.log('8) guardar y confirmar sin errores');
  await page.click('button.editor-v2-save');
  await page.waitForTimeout(1000);
  const bannerErrors = await page.$$eval('.editor-v2-banner-error', (els) => els.map((e) => e.textContent));
  if (bannerErrors.length > 0) throw new Error(`Error al guardar: ${bannerErrors.join(' | ')}`);

  if (consoleErrors.length > 0) {
    throw new Error('Errores de consola detectados durante el autoplay/drag en el editor:\n' + consoleErrors.join('\n'));
  }

  await browser.close();
  console.log('\n=== TODO OK: Lote UX-11 (slideshow en vivo dentro del editor) verificado -- rota solo, sigue siendo arrastrable, sin errores de consola. ===');
})().catch((err) => {
  console.error('\n=== FALLO ===');
  console.error(err);
  process.exit(1);
});
