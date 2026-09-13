// Verificacion Playwright del fix de UX-8: los popovers del rail de
// herramientas (YouTube/Vimeo/SoundCloud, Plugins/shortcodes, Library) ya no
// deben quedar recortados/ocultos por el propio overflow del rail
// (.editor-v2-tools-rail tiene overflow-y:auto, lo que por la spec de CSS
// fuerza tambien el eje X a no-visible -- cualquier popover mas ancho que el
// rail de 56px quedaba clipeado). Bug real reportado por Carlos con captura
// de pantalla al abrir el popover de YouTube. Este test verifica, con
// bounding boxes reales del navegador, que el popover completo cae DENTRO
// del viewport (nunca fuera por ningun borde) para los 3 botones de embed,
// el de shortcodes y el de Library -- no solo que el elemento exista en el
// DOM (que ya pasaba, y por eso el bug nunca lo agarraron los tests
// anteriores).
const { chromium } = require('playwright');

const BASE = process.env.BASE_URL || 'http://100.71.185.7:5173';
const EMAIL = process.env.TEST_EMAIL || 'admin@flipbook.app';
const PASSWORD = process.env.TEST_PASSWORD || 'admin123';

function assertFullyInViewport(box, viewport, label) {
  if (!box) throw new Error(`${label}: no se pudo obtener el bounding box (no visible/no existe)`);
  const okLeft = box.x >= 0;
  const okTop = box.y >= 0;
  const okRight = box.x + box.width <= viewport.width + 1; // +1 tolerancia de redondeo
  const okBottom = box.y + box.height <= viewport.height + 1;
  if (!(okLeft && okTop && okRight && okBottom)) {
    throw new Error(
      `${label}: el popover se sale del viewport -- box=${JSON.stringify(box)} viewport=${JSON.stringify(viewport)}`
    );
  }
  console.log(`   OK: ${label} completamente visible -- box=`, box);
}

(async () => {
  const browser = await chromium.launch();
  // Ventana angosta a propósito (dentro de lo razonable) para forzar que el
  // rail de herramientas sea más alto que el viewport visible -- asi los
  // botones YouTube/Vimeo/SoundCloud/Plugins/Library, que están abajo del
  // todo en el rail, son el escenario mas exigente para el fix.
  const viewport = { width: 1024, height: 700 };
  const page = await browser.newPage({ viewport });
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

  console.log('2) crear publicacion de prueba via API directa');
  const pub = await page.evaluate(async ({ tok, api }) => {
    const r = await fetch(`${api}/api/publications`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
      body: JSON.stringify({ title: 'UX8 rail popover ' + Date.now(), orientation: 'portrait', page_width: 210, page_height: 297, total_pages: 2 }),
    });
    return r.json();
  }, { tok: token, api: process.env.API_URL || 'http://100.71.185.7:8010' });

  const API = process.env.API_URL || 'http://100.71.185.7:8010';
  const pagesResp = await page.evaluate(async ({ tok, api, pubId }) => {
    const r = await fetch(`${api}/api/pages/publications/${pubId}/pages`, { headers: { Authorization: `Bearer ${tok}` } });
    return r.json();
  }, { tok: token, api: API, pubId: pub.id });
  const coverId = pagesResp.sort((a, b) => a.page_number - b.page_number)[0].id;

  console.log('3) abrir el editor en la portada');
  await page.goto(`${BASE}/publications/${pub.id}/edit/${coverId}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.editor-v2-tools-rail', { timeout: 10000 });

  const vp = page.viewportSize();

  console.log('4) popover de YouTube completamente dentro del viewport');
  await page.click('button[aria-label="YouTube"]');
  await page.waitForSelector('.editor-v2-embed-menu', { state: 'visible', timeout: 5000 });
  let box = await page.locator('.editor-v2-embed-menu').boundingBox();
  assertFullyInViewport(box, vp, 'Popover de YouTube');
  await page.screenshot({ path: '/tmp/ux8_01_youtube_popover.png' });
  await page.click('button[aria-label="YouTube"]'); // cerrar

  console.log('5) popover de Vimeo completamente dentro del viewport');
  await page.click('button[aria-label="Vimeo"]');
  await page.waitForSelector('.editor-v2-embed-menu', { state: 'visible', timeout: 5000 });
  box = await page.locator('.editor-v2-embed-menu').boundingBox();
  assertFullyInViewport(box, vp, 'Popover de Vimeo');
  await page.click('button[aria-label="Vimeo"]');

  console.log('6) popover de SoundCloud completamente dentro del viewport');
  await page.click('button[aria-label="SoundCloud"]');
  await page.waitForSelector('.editor-v2-embed-menu', { state: 'visible', timeout: 5000 });
  box = await page.locator('.editor-v2-embed-menu').boundingBox();
  assertFullyInViewport(box, vp, 'Popover de SoundCloud');
  await page.click('button[aria-label="SoundCloud"]');

  console.log('7) popover de Plugins (shortcodes) completamente dentro del viewport');
  await page.click('button[aria-label="Plugins (shortcodes)"]');
  await page.waitForSelector('.editor-v2-plugins-menu', { state: 'visible', timeout: 5000 });
  box = await page.locator('.editor-v2-plugins-menu').first().boundingBox();
  assertFullyInViewport(box, vp, 'Popover de Plugins');
  await page.click('button[aria-label="Plugins (shortcodes)"]');

  console.log('8) popover de Library completamente dentro del viewport');
  await page.click('button[aria-label="Library"]');
  await page.waitForSelector('.editor-v2-library-menu', { state: 'visible', timeout: 5000 });
  box = await page.locator('.editor-v2-library-menu').boundingBox();
  assertFullyInViewport(box, vp, 'Popover de Library');
  await page.screenshot({ path: '/tmp/ux8_02_library_popover.png' });
  await page.click('button[aria-label="Library"]');

  console.log('9) el popover de YouTube sigue siendo funcional (insertar un embed real)');
  await page.click('button[aria-label="YouTube"]');
  await page.waitForSelector('.editor-v2-embed-menu', { state: 'visible', timeout: 5000 });
  await page.fill('.editor-v2-embed-input', 'https://youtu.be/dQw4w9WgXcQ');
  await page.click('.editor-v2-embed-menu button:has-text("Insertar")');
  await page.waitForFunction(() => (window.__pageEditorStoreLeft?.elements || []).some((e) => e.kind === 'embed'), { timeout: 5000 });
  console.log('   OK: el embed de YouTube se sigue insertando correctamente tras el fix de posicionamiento');

  if (consoleErrors.length > 0) {
    console.log('\n=== Errores de consola detectados (no tolerados) ===');
    consoleErrors.forEach((e) => console.log(' -', e));
    throw new Error('Se detectaron errores de consola inesperados.');
  }

  console.log('\nOK -- los 5 popovers del rail quedan completamente visibles dentro del viewport, sin errores de consola.');
  await browser.close();
})().catch(async (err) => {
  console.error('FALLO:', err.message || err);
  process.exit(1);
});
