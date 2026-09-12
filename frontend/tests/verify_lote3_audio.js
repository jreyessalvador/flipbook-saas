// Verificacion real (Playwright/Chromium) del Lote 3: elemento de audio.
// Complementa e2e_editor_v2_regression.js, verify_lote1*.js y
// verify_lote2_shortcodes.js.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE_URL || 'http://100.71.185.7:5173';
const API = process.env.API_URL || 'http://100.71.185.7:8010';
const EMAIL = process.env.TEST_EMAIL || 'admin@flipbook.app';
const PASSWORD = process.env.TEST_PASSWORD || 'admin123';
const OUT_DIR = __dirname;

// MP3 minimo valido (un frame MPEG1 Layer3 de silencio repetido) -- basta
// para que el backend/MinIO lo acepten y el navegador pueda cargarlo como
// <audio>, no hace falta que suene contenido real.
const MP3_FRAME = Buffer.from(
  'fffb9064000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
  'hex'
);
const MP3_PATH = path.join(OUT_DIR, '_lote3_test.mp3');
fs.writeFileSync(MP3_PATH, Buffer.concat(Array(20).fill(MP3_FRAME)));
const TXT_PATH = path.join(OUT_DIR, '_lote3_test.txt');
fs.writeFileSync(TXT_PATH, 'esto no es audio');

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
      body: JSON.stringify({ title: 'Verificacion Lote3 Audio ' + Date.now(), orientation: 'portrait', page_width: 210, page_height: 297, total_pages: 2 }),
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
  await page.waitForSelector('button[aria-label="Audio"]:not([disabled])', { timeout: 15000 });

  console.log('4) subir un archivo de texto disfrazado de audio -- el chequeo de tipo del lado cliente debe rechazarlo SIN llamar a la API');
  const audioInput = await page.$('input[type="file"][accept="audio/*"]');
  if (!audioInput) throw new Error('No se encontro el input de archivo de audio (accept="audio/*")');
  await audioInput.setInputFiles({ name: 'fake.txt', mimeType: 'text/plain', buffer: fs.readFileSync(TXT_PATH) });
  await page.waitForTimeout(300);
  let count = await page.evaluate(() => window.__pageEditorStore.elements.length);
  if (count !== 0) throw new Error(`Se esperaban 0 elementos tras subir un .txt como audio, hay ${count}`);
  if (!dialogMessages.some((m) => m.toLowerCase().includes('audio'))) {
    throw new Error(`Se esperaba un alert mencionando "audio", dialogos vistos: ${JSON.stringify(dialogMessages)}`);
  }
  console.log('   OK: el .txt fue rechazado del lado cliente sin crear ningun elemento (alert:', JSON.stringify(dialogMessages), ')');

  console.log('5) subir un MP3 real -- debe crear un elemento kind=audio con props.src');
  await audioInput.setInputFiles(MP3_PATH);
  await page.waitForFunction(() => window.__pageEditorStore.elements.length === 1, { timeout: 10000 });
  let el = await page.evaluate(() => window.__pageEditorStore.elements[0]);
  if (el.kind !== 'audio' || !el.props?.src) {
    throw new Error(`Elemento inesperado tras subir el MP3: ${JSON.stringify(el)}`);
  }
  console.log('   OK: elemento kind=audio creado con props.src =', el.props.src);
  await page.screenshot({ path: `${OUT_DIR}/lote3_01_audio_insertado.png` });

  console.log('6) seleccionar el elemento y verificar el panel de propiedades (encabezado + <audio> con el src correcto)');
  await page.evaluate((id) => window.__pageEditorStore.selectElement(id), el.id);
  await page.waitForTimeout(150);
  const headerText = await page.textContent('.editor-v2-props-header');
  if (!headerText.includes('Audio')) throw new Error(`Header inesperado: "${headerText}"`);
  const audioPreviewSrc = await page.getAttribute('.editor-v2-properties audio', 'src');
  const expectedSrc = el.props.src.startsWith('http') ? el.props.src : `${API}${el.props.src}`;
  if (audioPreviewSrc !== expectedSrc) {
    throw new Error(`El <audio> de vista previa tiene src="${audioPreviewSrc}", se esperaba "${expectedSrc}"`);
  }
  console.log('   OK: panel de propiedades muestra "Audio" y el <audio controls> apunta al archivo correcto');
  await page.screenshot({ path: `${OUT_DIR}/lote3_02_panel_audio.png` });

  console.log('7) marcar "Reproducir automaticamente" y "Repetir en bucle" -- deben escribir en props');
  const checkboxes = await page.$$('.editor-v2-properties .editor-v2-field-checkbox input[type="checkbox"]');
  if (checkboxes.length !== 2) throw new Error(`Se esperaban 2 checkboxes (autoplay/loop), hay ${checkboxes.length}`);
  await checkboxes[0].click();
  await checkboxes[1].click();
  await page.waitForTimeout(150);
  el = await page.evaluate((id) => window.__pageEditorStore.elements.find((e) => e.id === id), el.id);
  if (el.props.autoplay !== true || el.props.loop !== true) {
    throw new Error(`autoplay/loop no se actualizaron correctamente: ${JSON.stringify(el.props)}`);
  }
  console.log('   OK: autoplay y loop quedaron en true en props');

  console.log('8) guardar, recargar y confirmar que el elemento de audio persiste con su src y sus flags');
  await page.click('button:has-text("Guardar")');
  await page.waitForFunction(() => window.__pageEditorStore.isDirty === false, { timeout: 10000 });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__pageEditorStore.elements && window.__pageEditorStore.elements.length > 0, { timeout: 15000 });
  await page.waitForTimeout(300);
  const persisted = await page.evaluate(() => window.__pageEditorStore.elements.find((e) => e.kind === 'audio'));
  if (!persisted || !persisted.props?.src || persisted.props.autoplay !== true || persisted.props.loop !== true) {
    throw new Error(`Tras recargar, el elemento de audio no persistio como se esperaba: ${JSON.stringify(persisted)}`);
  }
  console.log('   OK: tras guardar y recargar, el elemento de audio conserva src/autoplay/loop:', JSON.stringify(persisted.props));

  if (consoleErrors.length > 0) {
    console.log('\n=== Errores de consola detectados ===');
    consoleErrors.forEach((e) => console.log(' -', e));
    throw new Error('Se detectaron errores de consola durante la verificacion.');
  }

  console.log('\nOK -- todos los checks del Lote 3 (elemento de audio) pasaron.');
  await browser.close();
})().catch((err) => {
  console.error('FALLO:', err.message || err);
  process.exit(1);
});
