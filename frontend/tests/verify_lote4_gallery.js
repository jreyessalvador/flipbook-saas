// Verificacion real (Playwright/Chromium) del Lote 4: galeria, collage y GIF.
// Complementa e2e_editor_v2_regression.js, verify_lote1*.js,
// verify_lote2_shortcodes.js y verify_lote3_audio.js.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE_URL || 'http://100.71.185.7:5173';
const API = process.env.API_URL || 'http://100.71.185.7:8010';
const EMAIL = process.env.TEST_EMAIL || 'admin@flipbook.app';
const PASSWORD = process.env.TEST_PASSWORD || 'admin123';
const OUT_DIR = __dirname;

// PNG minimo valido (1x1, rojo) -- basta para que backend/MinIO lo acepten
// y el navegador lo pinte como <img>, no hace falta contenido real.
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);
// GIF minimo valido (1x1, no animado -- basta para el chequeo de tipo).
const GIF_1PX = Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64');

function writePng(name) {
  const p = path.join(OUT_DIR, name);
  fs.writeFileSync(p, PNG_1PX);
  return p;
}
function writeGif(name) {
  const p = path.join(OUT_DIR, name);
  fs.writeFileSync(p, GIF_1PX);
  return p;
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const consoleErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', (err) => consoleErrors.push('pageerror: ' + err.message));
  const dialogMessages = [];
  page.on('dialog', async (dialog) => {
    dialogMessages.push(dialog.message());
    await dialog.dismiss();
  });

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
      body: JSON.stringify({ title: 'Verificacion Lote4 Galeria ' + Date.now(), orientation: 'portrait', page_width: 210, page_height: 297, total_pages: 2 }),
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
  await page.waitForSelector('button[aria-label="Galería"]:not([disabled])', { timeout: 15000 });

  console.log('4) Galeria: subir 3 imagenes -- debe crear UN elemento kind=gallery con layout=grid y 3 imagenes');
  const galleryInput = await page.$('input[type="file"][multiple][accept="image/*"] >> nth=0');
  if (!galleryInput) throw new Error('No se encontro el primer input de archivo multiple de imagenes (Galeria)');
  const galleryFiles = [writePng('_lote4_g1.png'), writePng('_lote4_g2.png'), writePng('_lote4_g3.png')];
  await galleryInput.setInputFiles(galleryFiles);
  await page.waitForFunction(() => window.__pageEditorStore.elements.length === 1, { timeout: 15000 });
  let el = await page.evaluate(() => window.__pageEditorStore.elements[0]);
  if (el.kind !== 'gallery' || el.props?.layout !== 'grid' || (el.props?.images || []).length !== 3) {
    throw new Error(`Elemento de galeria inesperado: ${JSON.stringify(el)}`);
  }
  console.log('   OK: elemento kind=gallery, layout=grid, 3 imagenes:', el.props.images.map((i) => i.src));
  await page.screenshot({ path: `${OUT_DIR}/lote4_01_galeria_grid.png` });

  console.log('5) seleccionar el elemento y verificar el panel de propiedades (encabezado "Galería" + 3 miniaturas)');
  await page.evaluate((id) => window.__pageEditorStore.selectElement(id), el.id);
  await page.waitForTimeout(200);
  let headerText = await page.textContent('.editor-v2-props-header');
  if (!headerText.includes('Galería')) throw new Error(`Header inesperado: "${headerText}"`);
  let thumbCount = await page.$$eval('.editor-v2-gallery-thumb', (els) => els.length);
  if (thumbCount !== 3) throw new Error(`Se esperaban 3 miniaturas en el panel, hay ${thumbCount}`);
  console.log('   OK: panel muestra "Galería" con 3 miniaturas');
  await page.screenshot({ path: `${OUT_DIR}/lote4_02_panel_galeria.png` });

  console.log('6) quitar una imagen desde el panel -- debe quedar en 2');
  await page.click('.editor-v2-gallery-thumb-remove >> nth=0');
  await page.waitForTimeout(200);
  el = await page.evaluate((id) => window.__pageEditorStore.elements.find((e) => e.id === id), el.id);
  if ((el.props?.images || []).length !== 2) throw new Error(`Se esperaban 2 imagenes tras quitar una, hay ${(el.props?.images || []).length}`);
  console.log('   OK: quedaron 2 imagenes tras remover una desde el panel');

  console.log('7) cambiar a layout Mosaico desde el panel -- props.layout debe pasar a "mosaic" y el header a "Collage"');
  await page.click('.editor-v2-gallery-layout-row button:has-text("Mosaico")');
  await page.waitForTimeout(200);
  el = await page.evaluate((id) => window.__pageEditorStore.elements.find((e) => e.id === id), el.id);
  if (el.props?.layout !== 'mosaic') throw new Error(`Se esperaba layout=mosaic, fue: ${el.props?.layout}`);
  headerText = await page.textContent('.editor-v2-props-header');
  if (!headerText.includes('Collage')) throw new Error(`Header inesperado tras cambiar a mosaico: "${headerText}"`);
  console.log('   OK: layout=mosaic y header actualizado a "Collage"');
  await page.screenshot({ path: `${OUT_DIR}/lote4_03_mosaico.png` });

  console.log('8) "Agregar imágenes" desde el panel -- debe anexar, no reemplazar (2 + 2 = 4)');
  const appendInput = await page.$('input[type="file"][multiple][accept="image/*"] >> nth=2');
  if (!appendInput) throw new Error('No se encontro el tercer input multiple de imagenes (Agregar imagenes)');
  await appendInput.setInputFiles([writePng('_lote4_g4.png'), writePng('_lote4_g5.png')]);
  await page.waitForFunction(
    (id) => window.__pageEditorStore.elements.find((e) => e.id === id)?.props?.images?.length === 4,
    el.id,
    { timeout: 10000 }
  );
  el = await page.evaluate((id) => window.__pageEditorStore.elements.find((e) => e.id === id), el.id);
  console.log('   OK: tras "Agregar imágenes" quedaron', el.props.images.length, 'imagenes (se anexaron, no reemplazaron)');

  console.log('9) Collage (boton de rail dedicado): subir 2 imagenes -- debe crear un SEGUNDO elemento kind=gallery layout=mosaic');
  const collageInput = await page.$('input[type="file"][multiple][accept="image/*"] >> nth=1');
  if (!collageInput) throw new Error('No se encontro el input multiple de imagenes de Collage (rail)');
  await collageInput.setInputFiles([writePng('_lote4_c1.png'), writePng('_lote4_c2.png')]);
  await page.waitForFunction(() => window.__pageEditorStore.elements.length === 2, { timeout: 10000 });
  const collageEl = await page.evaluate(() => window.__pageEditorStore.elements[window.__pageEditorStore.elements.length - 1]);
  if (collageEl.kind !== 'gallery' || collageEl.props?.layout !== 'mosaic' || (collageEl.props?.images || []).length !== 2) {
    throw new Error(`Elemento de collage (boton de rail) inesperado: ${JSON.stringify(collageEl)}`);
  }
  console.log('   OK: boton de rail "Collage" crea kind=gallery con layout=mosaic directamente');

  console.log('10) GIF: subir un .png disfrazado de GIF por nombre pero con mimeType real image/png -- el input solo acepta image/gif, pero probamos el chequeo de tipo de contenido explicito con un .txt');
  const gifInput = await page.$('input[type="file"][accept="image/gif"]');
  if (!gifInput) throw new Error('No se encontro el input de archivo accept="image/gif"');
  const txtPath = path.join(OUT_DIR, '_lote4_fake.txt');
  fs.writeFileSync(txtPath, 'no es un gif');
  await gifInput.setInputFiles({ name: 'fake.txt', mimeType: 'text/plain', buffer: fs.readFileSync(txtPath) });
  await page.waitForTimeout(300);
  let countAfterFakeGif = await page.evaluate(() => window.__pageEditorStore.elements.length);
  if (countAfterFakeGif !== 2) throw new Error(`Se esperaban 2 elementos tras intentar subir un .txt como GIF (debe rechazarse), hay ${countAfterFakeGif}`);
  if (!dialogMessages.some((m) => m.toLowerCase().includes('gif'))) {
    throw new Error(`Se esperaba un alert mencionando "GIF", dialogos vistos: ${JSON.stringify(dialogMessages)}`);
  }
  console.log('   OK: el .txt fue rechazado del lado cliente antes de subir (alert:', JSON.stringify(dialogMessages), ')');

  console.log('11) GIF: subir un GIF real -- debe crear un elemento kind=image (reutilizado, no kind=gallery)');
  await gifInput.setInputFiles(writeGif('_lote4_real.gif'));
  await page.waitForFunction(() => window.__pageEditorStore.elements.length === 3, { timeout: 10000 });
  const gifEl = await page.evaluate(() => window.__pageEditorStore.elements[window.__pageEditorStore.elements.length - 1]);
  if (gifEl.kind !== 'image' || !gifEl.props?.src) {
    throw new Error(`Elemento inesperado tras subir el GIF real: ${JSON.stringify(gifEl)}`);
  }
  console.log('   OK: el GIF real crea un elemento kind=image (limitacion documentada: Konva no lo anima) con props.src =', gifEl.props.src);
  await page.screenshot({ path: `${OUT_DIR}/lote4_04_gif.png` });

  console.log('12) guardar, recargar y confirmar que los 3 elementos (galeria/collage/gif) persisten con su forma correcta');
  await page.click('button:has-text("Guardar")');
  await page.waitForFunction(() => window.__pageEditorStore.isDirty === false, { timeout: 10000 });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__pageEditorStore.elements && window.__pageEditorStore.elements.length === 3, { timeout: 15000 });
  await page.waitForTimeout(300);
  const persisted = await page.evaluate(() => window.__pageEditorStore.elements);
  const persistedGallery = persisted.find((e) => e.kind === 'gallery' && e.props?.layout === 'mosaic' && (e.props?.images || []).length === 4);
  const persistedCollage = persisted.find((e) => e.kind === 'gallery' && e.props?.layout === 'mosaic' && (e.props?.images || []).length === 2);
  const persistedGif = persisted.find((e) => e.kind === 'image' && e.props?.src?.includes('gif') === false ? false : e.kind === 'image');
  if (!persistedGallery) throw new Error(`No se encontro tras recargar la galeria de 4 imagenes en mosaico: ${JSON.stringify(persisted)}`);
  if (!persistedCollage) throw new Error(`No se encontro tras recargar el collage de 2 imagenes: ${JSON.stringify(persisted)}`);
  if (!persisted.some((e) => e.kind === 'image')) throw new Error('No se encontro tras recargar el elemento kind=image del GIF');
  console.log('   OK: tras guardar y recargar, los 3 elementos (galeria de 4, collage de 2, gif) persisten correctamente');

  if (consoleErrors.length > 0) {
    console.log('\n=== Errores de consola detectados ===');
    consoleErrors.forEach((e) => console.log(' -', e));
    throw new Error('Se detectaron errores de consola durante la verificacion.');
  }

  console.log('\nOK -- todos los checks del Lote 4 (galeria, collage, GIF) pasaron.');
  await browser.close();
})().catch((err) => {
  console.error('FALLO:', err.message || err);
  process.exit(1);
});
