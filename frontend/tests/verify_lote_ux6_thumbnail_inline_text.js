// Verificacion Playwright del Lote UX-6 (13-sep-2026): miniatura de
// portada sin recortar (object-fit: contain en vez de cover) + edicion
// inline de texto (reemplaza window.prompt por un <textarea> superpuesto).
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
  let dialogTriggered = false;
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', (err) => consoleErrors.push('pageerror: ' + err.message));
  page.on('dialog', async (dialog) => {
    dialogTriggered = true; // NO debe dispararse ningun dialog nativo (prompt/alert) al editar texto
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
  const token = await page.evaluate(() => localStorage.getItem('token'));

  console.log('2) crear publicacion vertical (A4 portrait) con una imagen real como portada, via API directa');
  const pub = await page.evaluate(async ({ tok, api }) => {
    const r = await fetch(`${api}/api/publications`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
      body: JSON.stringify({ title: 'UX6 thumbnail+inline-text ' + Date.now(), orientation: 'portrait', page_width: 210, page_height: 297, total_pages: 2 }),
    });
    return r.json();
  }, { tok: token, api: API });

  const pagesResp = await page.evaluate(async ({ tok, api, pubId }) => {
    const r = await fetch(`${api}/api/pages/publications/${pubId}/pages`, { headers: { Authorization: `Bearer ${tok}` } });
    return r.json();
  }, { tok: token, api: API, pubId: pub.id });
  const coverId = pagesResp.sort((a, b) => a.page_number - b.page_number)[0].id;

  // PNG 1x1 real como fixture de imagen (no importa el contenido visual, solo que sea decodificable)
  const PNG_1PX_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  const uploadResult = await page.evaluate(async ({ tok, api, pngB64 }) => {
    const byteChars = atob(pngB64);
    const bytes = new Uint8Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i);
    const blob = new Blob([bytes], { type: 'image/png' });
    const form = new FormData();
    form.append('file', blob, 'cover.png');
    form.append('kind', 'image');
    const r = await fetch(`${api}/api/assets/upload`, { method: 'POST', headers: { Authorization: `Bearer ${tok}` }, body: form });
    if (!r.ok) throw new Error('No se pudo subir la imagen de portada: HTTP ' + r.status);
    return r.json();
  }, { tok: token, api: API, pngB64: PNG_1PX_BASE64 });

  const currentElements = await page.evaluate(async ({ tok, api, pageId }) => {
    const r = await fetch(`${api}/api/pages/${pageId}/elements`, { headers: { Authorization: `Bearer ${tok}` } });
    return r.json();
  }, { tok: token, api: API, pageId: coverId });

  await page.evaluate(async ({ tok, api, pageId, version, src }) => {
    const r = await fetch(`${api}/api/pages/${pageId}/elements`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
      body: JSON.stringify({ version, elements: [{ kind: 'image', x: 0, y: 0, width: 210, height: 297, rotation_deg: 0, z_index: 0, props: { src } }] }),
    });
    if (!r.ok) throw new Error('No se pudo guardar la imagen de portada: HTTP ' + r.status);
  }, { tok: token, api: API, pageId: coverId, version: currentElements.version, src: uploadResult.url });

  console.log('3) "Publicaciones" -- la miniatura de la portada NO debe estar recortada (object-fit: contain, no cover)');
  // GET /api/publications por defecto pagina limit=20 sin ORDER BY explicito
  // (hallazgo fuera de alcance ya documentado en RECETA-DESARROLLO.md
  // seccion 9f) -- con el volumen de publicaciones de prueba acumulado en
  // este repo, la publicacion recien creada no siempre aparece en la
  // primera pagina de la UI. Se verifica lo esencial (que el backend siga
  // devolviendo el campo correctamente) por API directa, y por separado se
  // hace un chequeo suelto de CSS sobre lo que SI se alcanza a renderizar
  // en la vista paginada por defecto -- mismo criterio que
  // verify_lote_ux3_thumbnails.js.
  const pubList = await page.evaluate(async ({ tok, api }) => {
    const r = await fetch(`${api}/api/publications?limit=500`, { headers: { Authorization: `Bearer ${tok}` } });
    return r.json();
  }, { tok: token, api: API });
  const thisPub = (pubList.items || pubList).find((p) => p.id === pub.id);
  if (!thisPub || !thisPub.cover_image_url) throw new Error('El backend no devolvio cover_image_url para la publicacion de prueba');
  console.log('   OK (backend): cover_image_url presente ->', thisPub.cover_image_url);

  await page.goto(`${BASE}/publications`, { waitUntil: 'networkidle' });
  const anyCardImg = page.locator('.card-header img').first();
  const anyImgCount = await page.locator('.card-header img').count();
  if (anyImgCount > 0) {
    await anyCardImg.waitFor({ timeout: 10000 });
    const fitMode = await anyCardImg.evaluate((el) => getComputedStyle(el).objectFit);
    console.log('   object-fit de una miniatura visible:', fitMode);
    if (fitMode !== 'contain') throw new Error(`Se esperaba object-fit: contain, se encontro: ${fitMode}`);
    console.log('   OK: las miniaturas usan "contain" -- muestran la portada completa, sin recortar');
  } else {
    console.log('   (sin fichas con miniatura en la primera pagina de la vista -- verificado igual por backend arriba)');
  }
  await page.screenshot({ path: `${OUT_DIR}/ux6_01_publications_thumbnail.png` });

  console.log('4) abrir el editor en la portada, insertar un texto y editarlo con doble clic (SIN dialogo nativo)');
  await page.goto(`${BASE}/publications/${pub.id}/edit/${coverId}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.editor-v2-stage', { timeout: 10000 });
  // Boton "Texto" del rail -- mismo selector que usa e2e_editor_v2_regression.js
  await page.click('button[aria-label="Texto"]');
  await page.waitForFunction(() => (window.__pageEditorStoreLeft?.elements || []).some((e) => e.kind === 'text'), { timeout: 5000 });

  const stageBox = await page.locator('.editor-v2-stage').first().boundingBox();
  const textEl = await page.evaluate(() => {
    const t = (window.__pageEditorStoreLeft?.elements || []).find((e) => e.kind === 'text');
    return { x: t.x, y: t.y, width: t.width, height: t.height };
  });
  const clickX = stageBox.x + textEl.x + textEl.width / 2;
  const clickY = stageBox.y + textEl.y + textEl.height / 2;
  await page.mouse.dblclick(clickX, clickY);
  await page.waitForTimeout(300);

  const textarea = page.locator('.editor-v2-inline-text-editor');
  const textareaCount = await textarea.count();
  if (textareaCount !== 1) throw new Error('No aparecio el <textarea> de edicion inline tras el doble clic');
  if (dialogTriggered) throw new Error('Se disparo un dialogo nativo (window.prompt/alert) -- ya no deberia usarse para editar texto');
  console.log('   OK: aparecio el textarea inline, sin dialogo nativo');
  await page.screenshot({ path: `${OUT_DIR}/ux6_02_inline_text_editor_open.png` });

  await textarea.fill('Texto editado inline');
  await textarea.press('Enter');
  await page.waitForTimeout(300);

  const afterEditCount = await page.locator('.editor-v2-inline-text-editor').count();
  if (afterEditCount !== 0) throw new Error('El textarea de edicion inline no se cerro tras presionar Enter');
  const savedText = await page.evaluate(() => (window.__pageEditorStoreLeft?.elements || []).find((e) => e.kind === 'text')?.props?.text);
  if (savedText !== 'Texto editado inline') throw new Error(`El texto no se actualizo correctamente, valor actual: "${savedText}"`);
  console.log('   OK: Enter confirma el cambio, el textarea se cierra y el texto queda actualizado en el store');
  await page.screenshot({ path: `${OUT_DIR}/ux6_03_inline_text_editor_committed.png` });

  console.log('5) guardar y recargar -- el texto editado debe persistir');
  await page.click('button:has-text("Guardar")');
  await page.waitForTimeout(800);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => (window.__pageEditorStoreLeft?.elements || []).length > 0, { timeout: 10000 });
  const persistedText = await page.evaluate(() => (window.__pageEditorStoreLeft?.elements || []).find((e) => e.kind === 'text')?.props?.text);
  if (persistedText !== 'Texto editado inline') throw new Error(`El texto no persistio tras guardar+recargar, valor actual: "${persistedText}"`);
  console.log('   OK: el texto editado persiste tras guardar y recargar');

  console.log('6) doble clic + Escape debe CANCELAR sin cambiar el texto');
  const stageBox2 = await page.locator('.editor-v2-stage').first().boundingBox();
  const textEl2 = await page.evaluate(() => {
    const t = (window.__pageEditorStoreLeft?.elements || []).find((e) => e.kind === 'text');
    return { x: t.x, y: t.y, width: t.width, height: t.height };
  });
  await page.mouse.dblclick(stageBox2.x + textEl2.x + textEl2.width / 2, stageBox2.y + textEl2.y + textEl2.height / 2);
  await page.waitForTimeout(300);
  await page.locator('.editor-v2-inline-text-editor').fill('esto no deberia guardarse');
  await page.locator('.editor-v2-inline-text-editor').press('Escape');
  await page.waitForTimeout(300);
  const afterEscape = await page.evaluate(() => (window.__pageEditorStoreLeft?.elements || []).find((e) => e.kind === 'text')?.props?.text);
  if (afterEscape !== 'Texto editado inline') throw new Error(`Escape no debio cambiar el texto, valor actual: "${afterEscape}"`);
  console.log('   OK: Escape cancela sin aplicar el cambio');

  if (consoleErrors.length > 0) {
    console.log('\n=== Errores de consola detectados (no tolerados) ===');
    consoleErrors.forEach((e) => console.log(' -', e));
    throw new Error('Se detectaron errores de consola inesperados.');
  }

  console.log('\nOK -- el Lote UX-6 (miniatura sin recorte + edicion inline de texto) paso sin errores de consola.');
  await browser.close();
})().catch(async (err) => {
  console.error('FALLO:', err.message || err);
  process.exit(1);
});
