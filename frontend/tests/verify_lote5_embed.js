// Verificacion real (Playwright/Chromium) del Lote 5: embeds de YouTube y Vimeo.
// Complementa e2e_editor_v2_regression.js, verify_lote1*.js,
// verify_lote2_shortcodes.js, verify_lote3_audio.js, verify_lote4_gallery.js
// y verify_spread_view.js.
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
      body: JSON.stringify({ title: 'Verificacion Lote5 Embed ' + Date.now(), orientation: 'portrait', page_width: 210, page_height: 297, total_pages: 2 }),
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
  await page.waitForSelector('button[aria-label="YouTube"]:not([disabled])', { timeout: 15000 });

  console.log('4) YouTube: pegar una URL en formato corto youtu.be/XXXX');
  await page.click('button[aria-label="YouTube"]');
  await page.waitForSelector('.editor-v2-embed-menu input');
  await page.fill('.editor-v2-embed-menu input', 'https://youtu.be/dQw4w9WgXcQ');
  await page.click('.editor-v2-embed-menu button:has-text("Insertar")');
  await page.waitForFunction(() => window.__pageEditorStore.elements.length === 1, { timeout: 10000 });
  let el = await page.evaluate(() => window.__pageEditorStore.elements[0]);
  if (el.kind !== 'embed' || el.props?.provider !== 'youtube' || el.props?.video_id !== 'dQw4w9WgXcQ' || el.props?.url !== 'https://youtu.be/dQw4w9WgXcQ') {
    throw new Error(`Elemento de YouTube inesperado: ${JSON.stringify(el)}`);
  }
  console.log('   OK: kind=embed, provider=youtube, video_id=dQw4w9WgXcQ, url intacta');
  await page.screenshot({ path: `${OUT_DIR}/lote5_01_youtube.png` });
  const youtubeElId = el.id;

  console.log('5) Vimeo: pegar una URL en formato vimeo.com/XXXXXXXX');
  await page.click('button[aria-label="Vimeo"]');
  await page.waitForSelector('.editor-v2-embed-menu input');
  await page.fill('.editor-v2-embed-menu input', 'https://vimeo.com/76979871');
  await page.click('.editor-v2-embed-menu button:has-text("Insertar")');
  await page.waitForFunction(() => window.__pageEditorStore.elements.length === 2, { timeout: 10000 });
  el = await page.evaluate(() => window.__pageEditorStore.elements[window.__pageEditorStore.elements.length - 1]);
  if (el.kind !== 'embed' || el.props?.provider !== 'vimeo' || el.props?.video_id !== '76979871' || el.props?.url !== 'https://vimeo.com/76979871') {
    throw new Error(`Elemento de Vimeo inesperado: ${JSON.stringify(el)}`);
  }
  console.log('   OK: kind=embed, provider=vimeo, video_id=76979871, url intacta');
  await page.screenshot({ path: `${OUT_DIR}/lote5_02_vimeo.png` });
  const vimeoElId = el.id;

  console.log('6) URL invalida/no reconocida -- debe mostrar error inline y NO crear elemento');
  await page.click('button[aria-label="YouTube"]');
  await page.waitForSelector('.editor-v2-embed-menu input');
  await page.fill('.editor-v2-embed-menu input', 'https://example.com/no-es-un-video');
  await page.click('.editor-v2-embed-menu button:has-text("Insertar")');
  await page.waitForSelector('.editor-v2-embed-error');
  const errorText = await page.textContent('.editor-v2-embed-error');
  if (!errorText || errorText.trim().length === 0) throw new Error('Se esperaba un mensaje de error inline en el popover');
  const countAfterInvalid = await page.evaluate(() => window.__pageEditorStore.elements.length);
  if (countAfterInvalid !== 2) throw new Error(`Se esperaban 2 elementos tras URL invalida (no debe crearse ninguno), hay ${countAfterInvalid}`);
  console.log('   OK: error inline mostrado ("' + errorText.trim() + '") y ningun elemento creado');
  await page.screenshot({ path: `${OUT_DIR}/lote5_03_error_inline.png` });
  // Cerrar el popover para no interferir con los siguientes pasos.
  await page.click('button[aria-label="YouTube"]');

  console.log('7) seleccionar el embed de YouTube y verificar el panel de propiedades (enlace + provider)');
  await page.evaluate((id) => window.__pageEditorStore.selectElement(id), youtubeElId);
  await page.waitForTimeout(200);
  let headerText = await page.textContent('.editor-v2-props-header');
  if (!headerText.includes('YouTube')) throw new Error(`Header inesperado para el embed de YouTube: "${headerText}"`);
  let hrefYoutube = await page.getAttribute('.editor-v2-embed-link', 'href');
  if (hrefYoutube !== 'https://youtu.be/dQw4w9WgXcQ') throw new Error(`href inesperado en el panel (YouTube): "${hrefYoutube}"`);
  console.log('   OK: panel muestra "YouTube" con enlace href correcto:', hrefYoutube);

  console.log('8) seleccionar el embed de Vimeo y verificar el panel de propiedades (enlace + provider)');
  await page.evaluate((id) => window.__pageEditorStore.selectElement(id), vimeoElId);
  await page.waitForTimeout(200);
  headerText = await page.textContent('.editor-v2-props-header');
  if (!headerText.includes('Vimeo')) throw new Error(`Header inesperado para el embed de Vimeo: "${headerText}"`);
  let hrefVimeo = await page.getAttribute('.editor-v2-embed-link', 'href');
  if (hrefVimeo !== 'https://vimeo.com/76979871') throw new Error(`href inesperado en el panel (Vimeo): "${hrefVimeo}"`);
  console.log('   OK: panel muestra "Vimeo" con enlace href correcto:', hrefVimeo);
  await page.screenshot({ path: `${OUT_DIR}/lote5_04_panel_vimeo.png` });

  console.log('9) guardar, recargar y confirmar que ambos embeds persisten con sus props intactas');
  await page.click('button:has-text("Guardar")');
  await page.waitForFunction(() => window.__pageEditorStore.isDirty === false, { timeout: 10000 });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__pageEditorStore.elements && window.__pageEditorStore.elements.length === 2, { timeout: 15000 });
  await page.waitForTimeout(300);
  const persisted = await page.evaluate(() => window.__pageEditorStore.elements);
  const persistedYoutube = persisted.find((e) => e.kind === 'embed' && e.props?.provider === 'youtube' && e.props?.video_id === 'dQw4w9WgXcQ' && e.props?.url === 'https://youtu.be/dQw4w9WgXcQ');
  const persistedVimeo = persisted.find((e) => e.kind === 'embed' && e.props?.provider === 'vimeo' && e.props?.video_id === '76979871' && e.props?.url === 'https://vimeo.com/76979871');
  if (!persistedYoutube) throw new Error(`No se encontro tras recargar el embed de YouTube: ${JSON.stringify(persisted)}`);
  if (!persistedVimeo) throw new Error(`No se encontro tras recargar el embed de Vimeo: ${JSON.stringify(persisted)}`);
  console.log('   OK: tras guardar y recargar, ambos embeds (YouTube y Vimeo) persisten con props intactas');

  if (consoleErrors.length > 0) {
    console.log('\n=== Errores de consola detectados ===');
    consoleErrors.forEach((e) => console.log(' -', e));
    throw new Error('Se detectaron errores de consola durante la verificacion.');
  }

  console.log('\nOK -- todos los checks del Lote 5 (YouTube/Vimeo embeds) pasaron.');
  await browser.close();
})().catch((err) => {
  console.error('FALLO:', err.message || err);
  process.exit(1);
});
