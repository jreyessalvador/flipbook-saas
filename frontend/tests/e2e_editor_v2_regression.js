// Regresion end-to-end de Fase B (editor canvas react-konva) contra un
// navegador real -- complementa backend/tests/test_editor_v2_regression.sh
// (que solo prueba la API por curl, nunca la UI). Reproduce el escenario de
// bug original reportado por Carlos: editar la portada, guardar, navegar a
// la contraportada y volver, confirmando que no hay fuga de contenido.
//
// Como correrlo (no requiere instalar nada en el host, usa la imagen oficial
// de Playwright via Docker):
//
//   docker run --rm --network host \
//     -v "$(pwd)/frontend/tests:/verify" -w /verify \
//     mcr.microsoft.com/playwright:v1.48.0-jammy \
//     bash -c "node e2e_editor_v2_regression.js"
//
// Variables de entorno (por defecto apuntan al entorno de dev en ia-lavatur):
//   BASE_URL  -- origen del frontend (Vite dev server)
//   API_URL   -- origen del backend
//   TEST_EMAIL / TEST_PASSWORD -- credenciales (admin por defecto de init_db.py)
//
// Requiere que el componente CanvasEditorV2 exponga window.__pageEditorStore
// en modo dev (import.meta.env.DEV) -- ver frontend/src/components/editor/CanvasEditorV2.jsx.

const { chromium } = require('playwright');

const BASE = process.env.BASE_URL || 'http://100.71.185.7:5173';
const API = process.env.API_URL || 'http://100.71.185.7:8010';
const EMAIL = process.env.TEST_EMAIL || 'admin@flipbook.app';
const PASSWORD = process.env.TEST_PASSWORD || 'admin123';

const OUT_DIR = __dirname;
const shots = [];

async function shot(page, name) {
  const path = `${OUT_DIR}/${name}.png`;
  await page.screenshot({ path });
  shots.push(name);
}

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
  await shot(page, '01_dashboard');
  console.log('   OK, logged in ->', page.url());

  console.log('2) crear publicacion de prueba (API directa -- no depende del formulario UI)');
  const token = await page.evaluate(() => localStorage.getItem('token'));
  const createResp = await page.evaluate(async ({ tok, api }) => {
    const r = await fetch(`${api}/api/publications`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
      body: JSON.stringify({
        title: 'Verificacion Fase B ' + Date.now(),
        orientation: 'portrait',
        page_width: 210,
        page_height: 297,
        total_pages: 4,
      }),
    });
    return { status: r.status, body: await r.json() };
  }, { tok: token, api: API });
  if (createResp.status !== 201) throw new Error(`No se pudo crear publicacion de prueba: HTTP ${createResp.status}`);
  const publicationId = createResp.body.id;
  console.log('   publicationId =', publicationId);

  console.log('3) obtener paginas de la publicacion');
  const pagesResp = await page.evaluate(async ({ tok, api, pubId }) => {
    const r = await fetch(`${api}/api/pages/publications/${pubId}/pages`, {
      headers: { Authorization: `Bearer ${tok}` },
    });
    return r.json();
  }, { tok: token, api: API, pubId: publicationId });
  const sorted = pagesResp.sort((a, b) => a.page_number - b.page_number);
  const coverId = sorted[0].id;
  const backCoverId = sorted[sorted.length - 1].id;
  console.log('   cover =', coverId, 'back_cover =', backCoverId);

  console.log('4) abrir editor en la portada');
  await page.goto(`${BASE}/publications/${publicationId}/edit/${coverId}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await shot(page, '04_editor_cover_empty');

  console.log('5) agregar texto y figura en la portada, guardar');
  await page.click('button[aria-label="Texto"]');
  await page.waitForTimeout(300);
  await page.click('button[aria-label="Rectángulo"]');
  await page.waitForTimeout(300);
  await shot(page, '05_editor_cover_with_elements');

  const debugState = await page.evaluate(() => {
    const s = window.__pageEditorStore;
    return s ? { isDirty: s.isDirty, elementsCount: s.elements.length } : { noStore: true };
  });
  if (debugState.noStore) throw new Error('window.__pageEditorStore no existe -- CanvasEditorV2 cambio o no esta en modo dev');
  if (debugState.elementsCount !== 2) throw new Error(`Se esperaban 2 elementos tras los clicks, hay ${debugState.elementsCount}`);
  console.log('   OK: 2 elementos agregados localmente, isDirty =', debugState.isDirty);

  const saveBtn = await page.$('button.editor-v2-save');
  await saveBtn.click();
  await page.waitForTimeout(1000);
  await shot(page, '06_editor_cover_saved');

  const bannerErrors = await page.$$eval('.editor-v2-banner-error', (els) => els.map((e) => e.textContent));
  if (bannerErrors.length > 0) throw new Error(`Error al guardar: ${bannerErrors.join(' | ')}`);
  console.log('   OK: guardado sin errores.');

  console.log('6) navegar a la contraportada (via el campo de salto de la barra inferior, la lista lateral de paginas ya no existe) -- AQUI es donde el bug original fugaba contenido');
  const pageJumpInput = await page.$('.editor-v2-pagenav-position input[type="number"]');
  await pageJumpInput.fill(String(sorted[sorted.length - 1].page_number));
  await pageJumpInput.press('Enter');
  await page.waitForTimeout(1500);
  await shot(page, '07_editor_back_cover');

  const backCoverDebug = await page.evaluate(() => {
    const s = window.__pageEditorStore;
    return { pageId: s.pageId, elementsCount: s.elements.length };
  });
  if (backCoverDebug.pageId !== backCoverId) throw new Error('No se navego realmente a la contraportada');
  if (backCoverDebug.elementsCount !== 0) {
    throw new Error(`BUG REPRODUCIDO: la contraportada tiene ${backCoverDebug.elementsCount} elementos (deberia tener 0) -- fuga de contenido portada->contraportada`);
  }
  console.log('   OK: contraportada vacia, sin fuga de contenido.');

  console.log('7) volver a la portada y confirmar que conserva sus elementos');
  await page.goto(`${BASE}/publications/${publicationId}/edit/${coverId}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await shot(page, '08_editor_cover_reloaded');

  const coverReloadedDebug = await page.evaluate(() => {
    const s = window.__pageEditorStore;
    return { elementsCount: s.elements.length };
  });
  if (coverReloadedDebug.elementsCount !== 2) {
    throw new Error(`BUG: la portada deberia conservar sus 2 elementos, tiene ${coverReloadedDebug.elementsCount}`);
  }
  console.log('   OK: portada conserva sus 2 elementos tras navegar y volver.');

  if (consoleErrors.length > 0) {
    console.log('\n=== Errores de consola detectados (revisar) ===');
    consoleErrors.forEach((e) => console.log(' -', e));
  }

  console.log('\nOK -- todos los checks de regresion (Fase B, UI real) pasaron.');
  console.log('Screenshots:', shots.map((s) => `${s}.png`).join(', '));

  await browser.close();
})().catch((err) => {
  console.error('FALLO:', err.message || err);
  process.exit(1);
});
