// Verificacion real (Playwright/Chromium) del Lote 6: SoundCloud (embed) +
// Quick Actions (Configuracion del elemento: nombre/bloquear/ocultar en
// Reader, y Animar). Complementa e2e_editor_v2_regression.js,
// verify_lote1*.js, verify_lote2_shortcodes.js, verify_lote3_audio.js,
// verify_lote4_gallery.js, verify_spread_view.js y verify_lote5_embed.js.
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
      body: JSON.stringify({ title: 'Verificacion Lote6 SoundCloud+QuickActions ' + Date.now(), orientation: 'portrait', page_width: 210, page_height: 297, total_pages: 2 }),
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
  await page.waitForSelector('button[aria-label="SoundCloud"]:not([disabled])', { timeout: 15000 });

  console.log('4) SoundCloud: pegar una URL valida (usuario/track-slug)');
  await page.click('button[aria-label="SoundCloud"]');
  await page.waitForSelector('.editor-v2-embed-menu input');
  await page.fill('.editor-v2-embed-menu input', 'https://soundcloud.com/some-artist/a-track-slug');
  await page.click('.editor-v2-embed-menu button:has-text("Insertar")');
  await page.waitForFunction(() => window.__pageEditorStore.elements.length === 1, { timeout: 10000 });
  let el = await page.evaluate(() => window.__pageEditorStore.elements[0]);
  if (el.kind !== 'embed' || el.props?.provider !== 'soundcloud' || el.props?.video_id !== 'some-artist/a-track-slug' || el.props?.url !== 'https://soundcloud.com/some-artist/a-track-slug') {
    throw new Error(`Elemento de SoundCloud inesperado: ${JSON.stringify(el)}`);
  }
  console.log('   OK: kind=embed, provider=soundcloud, video_id=some-artist/a-track-slug, url intacta');
  await page.screenshot({ path: `${OUT_DIR}/lote6_01_soundcloud.png` });
  const soundcloudElId = el.id;

  console.log('5) panel de propiedades del SoundCloud: header + enlace clicable correcto');
  await page.evaluate((id) => window.__pageEditorStore.selectElement(id), soundcloudElId);
  await page.waitForTimeout(200);
  let headerText = await page.textContent('.editor-v2-props-header');
  if (!headerText.includes('SoundCloud')) throw new Error(`Header inesperado para el embed de SoundCloud: "${headerText}"`);
  const hrefSoundcloud = await page.getAttribute('.editor-v2-embed-link', 'href');
  if (hrefSoundcloud !== 'https://soundcloud.com/some-artist/a-track-slug') throw new Error(`href inesperado en el panel (SoundCloud): "${hrefSoundcloud}"`);
  console.log('   OK: panel muestra "SoundCloud" con enlace href correcto:', hrefSoundcloud);
  await page.screenshot({ path: `${OUT_DIR}/lote6_02_panel_soundcloud.png` });

  console.log('6) SoundCloud con campo vacio -- debe rechazarse (error inline, sin crear elemento).');
  console.log('   Decision documentada: SoundCloud no tiene un formato tan verificable como el id numerico');
  console.log('   de Vimeo o el patron alfanumerico de YouTube, asi que se acepta cualquier URL de');
  console.log('   soundcloud.com/m.soundcloud.com con 2+ segmentos de ruta -- se prueba el campo vacio,');
  console.log('   que SI se rechaza siempre (parseVideoUrl(\'\') === null).');
  await page.click('button[aria-label="SoundCloud"]');
  await page.waitForSelector('.editor-v2-embed-menu input');
  await page.fill('.editor-v2-embed-menu input', '');
  await page.click('.editor-v2-embed-menu button:has-text("Insertar")');
  await page.waitForSelector('.editor-v2-embed-error');
  const errorText = await page.textContent('.editor-v2-embed-error');
  if (!errorText || errorText.trim().length === 0) throw new Error('Se esperaba un mensaje de error inline en el popover');
  const countAfterInvalid = await page.evaluate(() => window.__pageEditorStore.elements.length);
  if (countAfterInvalid !== 1) throw new Error(`Se esperaba 1 elemento tras campo vacio (no debe crearse ninguno), hay ${countAfterInvalid}`);
  console.log('   OK: error inline mostrado ("' + errorText.trim() + '") y ningun elemento creado');
  // Tambien probamos un enlace de perfil suelto (1 solo segmento de ruta) --
  // se rechaza por la validacion minima de formato (>=2 segmentos).
  await page.fill('.editor-v2-embed-menu input', 'https://soundcloud.com/solo-usuario');
  await page.click('.editor-v2-embed-menu button:has-text("Insertar")');
  await page.waitForSelector('.editor-v2-embed-error');
  const countAfterProfileOnly = await page.evaluate(() => window.__pageEditorStore.elements.length);
  if (countAfterProfileOnly !== 1) throw new Error(`Un enlace de perfil suelto no deberia crear elemento, hay ${countAfterProfileOnly}`);
  console.log('   OK: un enlace de perfil suelto (sin track) tambien se rechaza');
  await page.click('button[aria-label="SoundCloud"]'); // cerrar popover

  console.log('7) agregar un rectangulo para probar Quick Actions (nombre/bloquear/ocultar/animar)');
  await page.click('button[aria-label="Rectángulo"]');
  await page.waitForFunction(() => window.__pageEditorStore.elements.length === 2, { timeout: 10000 });
  const shapeEl = await page.evaluate(() => window.__pageEditorStore.elements.find((e) => e.kind === 'shape'));
  const shapeId = shapeEl.id;
  await page.evaluate((id) => window.__pageEditorStore.selectElement(id), shapeId);
  await page.waitForTimeout(200);

  console.log('8) abrir "Configuracion del elemento" y cambiar el nombre');
  await page.click('button:has-text("Configuración del elemento")');
  await page.waitForSelector('.editor-v2-element-settings');
  const nameInput = page.locator('.editor-v2-element-settings input[type="text"]');
  await nameInput.fill('Mi rectangulo de prueba');
  await nameInput.blur();
  await page.waitForTimeout(200);
  let shapeState = await page.evaluate((id) => window.__pageEditorStore.elements.find((e) => e.id === id), shapeId);
  if (shapeState.props?.element_name !== 'Mi rectangulo de prueba') {
    throw new Error(`element_name no se guardo correctamente: ${JSON.stringify(shapeState.props)}`);
  }
  console.log('   OK: props.element_name guardado:', shapeState.props.element_name);
  const headerAfterName = await page.textContent('.editor-v2-props-header');
  if (!headerAfterName.includes('Mi rectangulo de prueba')) throw new Error(`El header no refleja el nombre del elemento: "${headerAfterName}"`);
  console.log('   OK: el header del panel muestra el nombre del elemento');
  await page.screenshot({ path: `${OUT_DIR}/lote6_03_element_settings.png` });

  console.log('9) verificar que sin "locked", el rectangulo SIGUE siendo arrastrable por defecto (props.locked===undefined)');
  const stageBox = await page.locator('.editor-v2-stage').boundingBox();
  let before = await page.evaluate((id) => window.__pageEditorStore.elements.find((e) => e.id === id), shapeId);
  if (before.props?.locked !== undefined) throw new Error('Se esperaba props.locked undefined por defecto en un elemento nuevo');
  let shapeScreenX = stageBox.x + before.x + before.width / 2;
  let shapeScreenY = stageBox.y + before.y + before.height / 2;
  await page.mouse.move(shapeScreenX, shapeScreenY);
  await page.mouse.down();
  await page.mouse.move(shapeScreenX + 60, shapeScreenY + 30, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  let after = await page.evaluate((id) => window.__pageEditorStore.elements.find((e) => e.id === id), shapeId);
  if (Math.abs(after.x - before.x - 60) > 5 || Math.abs(after.y - before.y - 30) > 5) {
    throw new Error(`Sin locked, el arrastre deberia funcionar (comportamiento por defecto): antes ${JSON.stringify(before)} despues ${JSON.stringify(after)}`);
  }
  console.log('   OK: draggable=true por defecto (props.locked undefined no se trata como bloqueado)');

  console.log('10) activar "Bloquear elemento" y confirmar que YA NO es arrastrable');
  const lockedCheckbox = page.locator('.editor-v2-element-settings input[type="checkbox"]').first();
  await lockedCheckbox.check();
  await page.waitForTimeout(200);
  shapeState = await page.evaluate((id) => window.__pageEditorStore.elements.find((e) => e.id === id), shapeId);
  if (shapeState.props?.locked !== true) throw new Error(`props.locked no quedo en true: ${JSON.stringify(shapeState.props)}`);
  console.log('   OK: props.locked === true');

  before = shapeState;
  shapeScreenX = stageBox.x + before.x + before.width / 2;
  shapeScreenY = stageBox.y + before.y + before.height / 2;
  await page.mouse.move(shapeScreenX, shapeScreenY);
  await page.mouse.down();
  await page.mouse.move(shapeScreenX + 60, shapeScreenY + 30, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  after = await page.evaluate((id) => window.__pageEditorStore.elements.find((e) => e.id === id), shapeId);
  if (Math.abs(after.x - before.x) > 0.5 || Math.abs(after.y - before.y) > 0.5) {
    throw new Error(`El elemento bloqueado NO deberia poder arrastrarse: antes ${JSON.stringify(before)} despues ${JSON.stringify(after)}`);
  }
  console.log('   OK: bloqueado -- el intento de arrastre no cambio x/y');
  // Sigue siendo seleccionable: al hacer click sobre el, la seleccion se mantiene.
  await page.mouse.click(shapeScreenX, shapeScreenY);
  await page.waitForTimeout(150);
  const stillSelected = await page.evaluate((id) => window.__pageEditorStore.selectedElementIds.includes(id), shapeId);
  if (!stillSelected) throw new Error('Un elemento bloqueado deberia seguir siendo seleccionable');
  console.log('   OK: el elemento bloqueado sigue siendo seleccionable');
  await page.screenshot({ path: `${OUT_DIR}/lote6_04_bloqueado.png` });

  console.log('11) desactivar "Bloquear elemento" y confirmar que vuelve a ser arrastrable');
  await lockedCheckbox.uncheck();
  await page.waitForTimeout(200);
  shapeState = await page.evaluate((id) => window.__pageEditorStore.elements.find((e) => e.id === id), shapeId);
  if (shapeState.props?.locked !== false) throw new Error(`props.locked no quedo en false: ${JSON.stringify(shapeState.props)}`);
  before = shapeState;
  shapeScreenX = stageBox.x + before.x + before.width / 2;
  shapeScreenY = stageBox.y + before.y + before.height / 2;
  await page.mouse.move(shapeScreenX, shapeScreenY);
  await page.mouse.down();
  await page.mouse.move(shapeScreenX + 40, shapeScreenY + 20, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  after = await page.evaluate((id) => window.__pageEditorStore.elements.find((e) => e.id === id), shapeId);
  if (Math.abs(after.x - before.x - 40) > 5 || Math.abs(after.y - before.y - 20) > 5) {
    throw new Error(`Tras desbloquear, el arrastre deberia volver a funcionar: antes ${JSON.stringify(before)} despues ${JSON.stringify(after)}`);
  }
  console.log('   OK: desbloqueado -- el arrastre vuelve a funcionar');

  console.log('12) activar "Ocultar en el Reader"');
  const hiddenCheckbox = page.locator('.editor-v2-element-settings input[type="checkbox"]').nth(1);
  await hiddenCheckbox.check();
  await page.waitForTimeout(200);
  shapeState = await page.evaluate((id) => window.__pageEditorStore.elements.find((e) => e.id === id), shapeId);
  if (shapeState.props?.hidden_in_reader !== true) throw new Error(`props.hidden_in_reader no quedo en true: ${JSON.stringify(shapeState.props)}`);
  console.log('   OK: props.hidden_in_reader === true');

  console.log('13) cambiar "Animar" a una opcion distinta de "Ninguna"');
  const animateSelect = page.locator('.editor-v2-properties select');
  await animateSelect.selectOption('slide-up');
  await page.waitForTimeout(200);
  shapeState = await page.evaluate((id) => window.__pageEditorStore.elements.find((e) => e.id === id), shapeId);
  if (shapeState.props?.animation !== 'slide-up') throw new Error(`props.animation no quedo en 'slide-up': ${JSON.stringify(shapeState.props)}`);
  console.log('   OK: props.animation === "slide-up"');
  await page.screenshot({ path: `${OUT_DIR}/lote6_05_quickactions_completo.png` });

  console.log('14) guardar, recargar y confirmar que TODO persiste (SoundCloud + nombre/locked/hidden/animation)');
  await page.click('button:has-text("Guardar")');
  await page.waitForFunction(() => window.__pageEditorStore.isDirty === false, { timeout: 10000 });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__pageEditorStore.elements && window.__pageEditorStore.elements.length === 2, { timeout: 15000 });
  await page.waitForTimeout(300);
  const persisted = await page.evaluate(() => window.__pageEditorStore.elements);

  const persistedSoundcloud = persisted.find((e) => e.kind === 'embed' && e.props?.provider === 'soundcloud');
  if (!persistedSoundcloud || persistedSoundcloud.props?.video_id !== 'some-artist/a-track-slug' || persistedSoundcloud.props?.url !== 'https://soundcloud.com/some-artist/a-track-slug') {
    throw new Error(`El elemento de SoundCloud no persistio correctamente: ${JSON.stringify(persistedSoundcloud)}`);
  }
  console.log('   OK: SoundCloud persiste con provider/video_id/url intactos');

  const persistedShape = persisted.find((e) => e.kind === 'shape');
  if (!persistedShape) throw new Error('No se encontro el rectangulo tras recargar');
  const p = persistedShape.props || {};
  if (p.element_name !== 'Mi rectangulo de prueba') throw new Error(`element_name no persistio: ${JSON.stringify(p)}`);
  if (p.locked !== false) throw new Error(`locked no persistio como false: ${JSON.stringify(p)}`);
  if (p.hidden_in_reader !== true) throw new Error(`hidden_in_reader no persistio como true: ${JSON.stringify(p)}`);
  if (p.animation !== 'slide-up') throw new Error(`animation no persistio como 'slide-up': ${JSON.stringify(p)}`);
  console.log('   OK: nombre/locked/hidden_in_reader/animation del rectangulo persisten correctamente tras guardar+recargar');
  await page.screenshot({ path: `${OUT_DIR}/lote6_06_tras_recargar.png` });

  if (consoleErrors.length > 0) {
    console.log('\n=== Errores de consola detectados ===');
    consoleErrors.forEach((e) => console.log(' -', e));
    throw new Error('Se detectaron errores de consola durante la verificacion.');
  }

  console.log('\nOK -- todos los checks del Lote 6 (SoundCloud + Quick Actions) pasaron.');
  await browser.close();
})().catch((err) => {
  console.error('FALLO:', err.message || err);
  process.exit(1);
});
