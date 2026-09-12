// Verificacion real (Playwright/Chromium) de la vista de hoja doble
// (spread): retirada de la barra lateral de paginas, navegacion inferior
// (Anterior/Siguiente + salto manual por numero de pagina), portada y
// contraportada siempre a hoja simple, interiores agrupadas de a 2, y ambas
// paginas de un spread editables INDEPENDIENTE y SIMULTANEAMENTE (decision
// explicita de Carlos, como InDesign) sin fuga de contenido entre ellas ni
// hacia portada/contraportada.
//
// Como correrlo (imagen oficial de Playwright via Docker, sin instalar nada
// en el host):
//
//   docker run --rm --network host \
//     -v "$(pwd)/frontend/tests:/verify" -w /verify \
//     mcr.microsoft.com/playwright:v1.48.0-jammy \
//     bash -c "node verify_spread_view.js"
//
// Variables de entorno (por defecto apuntan al entorno de dev en ia-lavatur):
//   BASE_URL / API_URL / TEST_EMAIL / TEST_PASSWORD
//
// Requiere que CanvasEditorV2 exponga en modo dev window.__pageEditorStoreLeft
// y window.__pageEditorStoreRight (una instancia de store por lado del
// spread -- ver store/pageEditorStore.js, ahora una fabrica
// createPageEditorStore() en vez de un singleton).

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

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
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

  console.log('2) crear publicacion de prueba: portada + 3 interiores + contraportada (5 hojas)');
  const token = await page.evaluate(() => localStorage.getItem('token'));
  const createResp = await page.evaluate(async ({ tok, api }) => {
    const r = await fetch(`${api}/api/publications`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
      body: JSON.stringify({
        title: 'Verificacion Spread View ' + Date.now(),
        orientation: 'portrait',
        page_width: 210,
        page_height: 297,
        total_pages: 5,
      }),
    });
    return { status: r.status, body: await r.json() };
  }, { tok: token, api: API });
  assert(createResp.status === 201, `No se pudo crear publicacion: HTTP ${createResp.status}`);
  const publicationId = createResp.body.id;
  console.log('   publicationId =', publicationId);

  const pagesResp = await page.evaluate(async ({ tok, api, pubId }) => {
    const r = await fetch(`${api}/api/pages/publications/${pubId}/pages`, { headers: { Authorization: `Bearer ${tok}` } });
    return r.json();
  }, { tok: token, api: API, pubId: publicationId });
  const sorted = pagesResp.sort((a, b) => a.page_number - b.page_number);
  assert(sorted.length === 5, `Se esperaban 5 paginas, hay ${sorted.length}`);
  const [p1, p2, p3, p4, p5] = sorted;
  console.log('   paginas:', sorted.map((p) => `${p.page_number}:${p.id.slice(0, 8)}`).join(', '));
  // Agrupacion esperada: p1 sola (portada), (p2,p3) spread, p4 sola (ultimo
  // spread interior impar -- solo 3 interiores), p5 sola (contraportada).

  const stageCount = () => page.$$eval('.editor-v2-page-slot .editor-v2-stage', (els) => els.length);
  const slotCount = () => page.$$eval('.editor-v2-page-slot', (els) => els.length);

  console.log('3) abrir editor en la portada -- debe verse UN solo Stage');
  await page.goto(`${BASE}/publications/${publicationId}/edit/${p1.id}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('button[aria-label="Texto"]:not([disabled])', { timeout: 15000 });
  await page.waitForTimeout(500);
  assert((await slotCount()) === 1, `Portada deberia mostrar 1 sola hoja, muestra ${await slotCount()}`);
  assert((await stageCount()) === 1, 'Portada deberia tener exactamente 1 Stage cargado');
  let jumpVal = await page.$eval('.editor-v2-pagenav-position input[type="number"]', (el) => el.value);
  assert(jumpVal === '1', `El campo de salto deberia mostrar 1, muestra ${jumpVal}`);
  await shot(page, 'spread_01_cover_single');
  console.log('   OK: portada = hoja simple');

  console.log('4) "Siguiente" -> debe verse el spread de paginas interiores (2,3), DOS Stages lado a lado');
  await page.click('button[aria-label="Hoja siguiente"]');
  await page.waitForTimeout(600);
  await page.waitForSelector('button[aria-label="Texto"]:not([disabled])', { timeout: 15000 });
  await page.waitForFunction(() => window.__pageEditorStoreLeft?.pageId && window.__pageEditorStoreRight?.pageId, { timeout: 10000 });
  assert((await slotCount()) === 2, `El spread interior deberia mostrar 2 hojas, muestra ${await slotCount()}`);
  assert((await stageCount()) === 2, 'El spread interior deberia tener 2 Stages cargados');
  let leftPageId = await page.evaluate(() => window.__pageEditorStoreLeft.pageId);
  let rightPageId = await page.evaluate(() => window.__pageEditorStoreRight.pageId);
  assert(leftPageId === p2.id, `El lado izquierdo del spread deberia ser la pagina 2, es ${leftPageId}`);
  assert(rightPageId === p3.id, `El lado derecho del spread deberia ser la pagina 3, es ${rightPageId}`);
  await shot(page, 'spread_02_interior_2_3');
  console.log('   OK: spread muestra paginas 2 (izq) y 3 (der)');

  console.log('5) foco/clic en el Stage IZQUIERDO -> agregar un TEXTO -- debe quedar en la pagina 2 (izquierda), no en la 3');
  const leftSlot = page.locator('.editor-v2-canvas-wrap .editor-v2-page-slot').nth(0);
  const rightSlot = page.locator('.editor-v2-canvas-wrap .editor-v2-page-slot').nth(1);
  await leftSlot.locator('canvas').first().click({ position: { x: 5, y: 5 } }); // fondo del stage izquierdo, sin tocar elementos
  await page.waitForTimeout(200);
  await page.click('button[aria-label="Texto"]');
  await page.waitForTimeout(300);

  let leftElsAfterText = await page.evaluate(() => window.__pageEditorStoreLeft.elements.length);
  let rightElsAfterText = await page.evaluate(() => window.__pageEditorStoreRight.elements.length);
  assert(leftElsAfterText === 1, `La pagina izquierda (2) deberia tener 1 elemento, tiene ${leftElsAfterText}`);
  assert(rightElsAfterText === 0, `La pagina derecha (3) NO deberia tener elementos todavia, tiene ${rightElsAfterText}`);
  console.log('   OK: el texto quedo en la pagina 2 (izquierda), la 3 (derecha) sigue vacia');

  console.log('6) foco/clic en el Stage DERECHO -> agregar un RECTANGULO -- debe quedar en la pagina 3 (derecha), sin afectar la 2');
  await rightSlot.locator('canvas').first().click({ position: { x: 5, y: 5 } }); // fondo del stage derecho
  await page.waitForTimeout(200);
  await page.click('button[aria-label="Rectángulo"]');
  await page.waitForTimeout(300);
  await shot(page, 'spread_03_both_sides_edited');

  leftElsAfterText = await page.evaluate(() => window.__pageEditorStoreLeft.elements.length);
  rightElsAfterText = await page.evaluate(() => window.__pageEditorStoreRight.elements.length);
  assert(leftElsAfterText === 1, `La pagina izquierda (2) deberia seguir con 1 elemento (el texto), tiene ${leftElsAfterText}`);
  assert(rightElsAfterText === 1, `La pagina derecha (3) deberia tener 1 elemento (el rectangulo), tiene ${rightElsAfterText}`);
  const leftKind = await page.evaluate(() => window.__pageEditorStoreLeft.elements[0].kind);
  const rightKind = await page.evaluate(() => window.__pageEditorStoreRight.elements[0].kind);
  assert(leftKind === 'text', `El elemento de la izquierda deberia ser 'text', es '${leftKind}'`);
  assert(rightKind === 'shape', `El elemento de la derecha deberia ser 'shape', es '${rightKind}'`);
  console.log('   OK: AMBAS paginas del spread son independiente y simultaneamente editables, sin fuga cruzada');

  console.log('7) guardar -- debe persistir ambos lados');
  await page.click('button.editor-v2-save');
  await page.waitForFunction(
    () => window.__pageEditorStoreLeft.isDirty === false && window.__pageEditorStoreRight.isDirty === false,
    { timeout: 10000 }
  );
  const bannerErrors = await page.$$eval('.editor-v2-banner-error', (els) => els.map((e) => e.textContent));
  assert(bannerErrors.length === 0, `Error al guardar: ${bannerErrors.join(' | ')}`);
  console.log('   OK: guardado sin errores en ninguno de los dos lados');

  console.log('8) recargar la pagina completa -- confirmar que cada hoja del spread conserva SOLO sus propios elementos');
  await page.goto(`${BASE}/publications/${publicationId}/edit/${p2.id}`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__pageEditorStoreLeft?.pageId && window.__pageEditorStoreRight?.pageId, { timeout: 15000 });
  await page.waitForFunction(
    () => (window.__pageEditorStoreLeft.elements || []).length > 0 && (window.__pageEditorStoreRight.elements || []).length > 0,
    { timeout: 15000 }
  );
  const leftAfterReload = await page.evaluate(() => window.__pageEditorStoreLeft.elements);
  const rightAfterReload = await page.evaluate(() => window.__pageEditorStoreRight.elements);
  assert(leftAfterReload.length === 1 && leftAfterReload[0].kind === 'text', `Tras recargar, la pagina 2 deberia tener solo 1 texto, tiene: ${JSON.stringify(leftAfterReload)}`);
  assert(rightAfterReload.length === 1 && rightAfterReload[0].kind === 'shape', `Tras recargar, la pagina 3 deberia tener solo 1 figura, tiene: ${JSON.stringify(rightAfterReload)}`);
  await shot(page, 'spread_04_reloaded_persisted');
  console.log('   OK: cada pagina del spread conserva solo sus propios elementos tras guardar+recargar');

  console.log('9) portada y ultimo spread interior (pagina 4, sola) siguen SIN elementos (sin fuga hacia ellas)');
  const coverCheck = await page.evaluate(async ({ tok, api, pageId }) => {
    const r = await fetch(`${api}/api/pages/${pageId}/elements`, { headers: { Authorization: `Bearer ${tok}` } });
    return r.json();
  }, { tok: token, api: API, pageId: p1.id });
  assert((coverCheck.elements || []).length === 0, `La portada deberia seguir sin elementos, tiene ${(coverCheck.elements || []).length}`);
  const backCoverCheck = await page.evaluate(async ({ tok, api, pageId }) => {
    const r = await fetch(`${api}/api/pages/${pageId}/elements`, { headers: { Authorization: `Bearer ${tok}` } });
    return r.json();
  }, { tok: token, api: API, pageId: p5.id });
  assert((backCoverCheck.elements || []).length === 0, `La contraportada deberia seguir sin elementos, tiene ${(backCoverCheck.elements || []).length}`);
  console.log('   OK: sin fuga hacia portada ni contraportada');

  console.log('10) salto manual por numero de pagina -- ir a la pagina 4 (ultimo spread interior, impar -> hoja simple)');
  const jumpInput = await page.$('.editor-v2-pagenav-position input[type="number"]');
  await jumpInput.fill(String(p4.page_number));
  await jumpInput.press('Enter');
  await page.waitForTimeout(700);
  await page.waitForFunction((pid) => window.__pageEditorStoreLeft?.pageId === pid, p4.id, { timeout: 10000 });
  assert((await slotCount()) === 1, `La pagina 4 (ultimo spread interior impar) deberia mostrarse sola, muestra ${await slotCount()} hoja(s)`);
  const p4ElsCount = await page.evaluate(() => window.__pageEditorStoreLeft.elements.length);
  assert(p4ElsCount === 0, `La pagina 4 no deberia tener elementos (nadie le agrego nada), tiene ${p4ElsCount}`);
  await shot(page, 'spread_05_page4_single_odd_leftover');
  console.log('   OK: pagina 4 se muestra sola (spread interior impar) y sin fuga de contenido');

  console.log('11) salto manual a la pagina 3 -- debe posicionar el spread (2,3) con la 3 en el lado DERECHO');
  const jumpInput2 = await page.$('.editor-v2-pagenav-position input[type="number"]');
  await jumpInput2.fill(String(p3.page_number));
  await jumpInput2.press('Enter');
  await page.waitForTimeout(700);
  await page.waitForFunction((pid) => window.__pageEditorStoreRight?.pageId === pid, p3.id, { timeout: 10000 });
  assert((await slotCount()) === 2, 'El salto a la pagina 3 deberia mostrar el spread (2,3), 2 hojas');
  leftPageId = await page.evaluate(() => window.__pageEditorStoreLeft.pageId);
  rightPageId = await page.evaluate(() => window.__pageEditorStoreRight.pageId);
  assert(leftPageId === p2.id, `El lado izquierdo deberia seguir siendo la pagina 2, es ${leftPageId}`);
  assert(rightPageId === p3.id, `El lado derecho deberia ser la pagina 3 (a la que se salto), es ${rightPageId}`);
  console.log('   OK: salto manual posiciono la pagina 3 en el lado que le corresponde (derecho)');

  console.log('12) navegar a la contraportada (ultima pagina) -- debe verse de nuevo UN solo Stage');
  const jumpInput3 = await page.$('.editor-v2-pagenav-position input[type="number"]');
  await jumpInput3.fill(String(p5.page_number));
  await jumpInput3.press('Enter');
  await page.waitForTimeout(700);
  await page.waitForFunction((pid) => window.__pageEditorStoreLeft?.pageId === pid, p5.id, { timeout: 10000 });
  assert((await slotCount()) === 1, `La contraportada deberia mostrarse sola, muestra ${await slotCount()} hoja(s)`);
  assert((await stageCount()) === 1, 'La contraportada deberia tener exactamente 1 Stage cargado');
  await shot(page, 'spread_06_backcover_single');
  console.log('   OK: contraportada = hoja simple');

  if (consoleErrors.length > 0) {
    console.log('\n=== Errores de consola detectados ===');
    consoleErrors.forEach((e) => console.log(' -', e));
    throw new Error(`Se detectaron ${consoleErrors.length} error(es) de consola del navegador durante la verificacion`);
  }

  console.log('\nOK -- todos los checks de la vista de hoja doble (spread) pasaron, sin errores de consola.');
  console.log('Screenshots:', shots.map((s) => `${s}.png`).join(', '));

  await browser.close();
})().catch((err) => {
  console.error('FALLO:', err.message || err);
  process.exit(1);
});
