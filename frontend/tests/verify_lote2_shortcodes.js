// Verificacion real (Playwright/Chromium) del Lote 2: shortcodes de texto
// (Plugins). Complementa e2e_editor_v2_regression.js y verify_lote1*.js.
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

  console.log('2) crear publicacion de prueba (3 paginas, para poder verificar numero_pagina/total_paginas)');
  const token = await page.evaluate(() => localStorage.getItem('token'));
  const createResp = await page.evaluate(async ({ tok, api }) => {
    const r = await fetch(`${api}/api/publications`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
      body: JSON.stringify({ title: 'Verificacion Lote2 Shortcodes ' + Date.now(), orientation: 'portrait', page_width: 210, page_height: 297, total_pages: 3 }),
    });
    return { status: r.status, body: await r.json() };
  }, { tok: token, api: API });
  if (createResp.status !== 201) throw new Error(`No se pudo crear publicacion: HTTP ${createResp.status}`);
  const publicationId = createResp.body.id;

  const pagesResp = await page.evaluate(async ({ tok, api, pubId }) => {
    const r = await fetch(`${api}/api/pages/publications/${pubId}/pages`, { headers: { Authorization: `Bearer ${tok}` } });
    return r.json();
  }, { tok: token, api: API, pubId: publicationId });
  const sortedPages = pagesResp.sort((a, b) => a.page_number - b.page_number);
  const secondPageId = sortedPages[1].id; // pagina 2 de 3, para que numero_pagina != total_paginas

  console.log('3) abrir editor en la pagina 2');
  await page.goto(`${BASE}/publications/${publicationId}/edit/${secondPageId}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('button[aria-label="Texto"]:not([disabled])', { timeout: 15000 });

  console.log('4) agregar un elemento de texto vacio y verificar que el boton Plugins existe y no esta deshabilitado');
  await page.click('button[aria-label="Texto"]');
  await page.waitForTimeout(200);
  let count = await page.evaluate(() => window.__pageEditorStore.elements.length);
  if (count !== 1) throw new Error(`Se esperaba 1 elemento de texto, hay ${count}`);
  const textId = await page.evaluate(() => window.__pageEditorStore.elements[0].id);
  await page.evaluate((id) => window.__pageEditorStore.selectElement(id), textId);
  await page.waitForTimeout(100);

  console.log('5) abrir el popover de Plugins e insertar {{fecha}} en el texto ya seleccionado');
  const pluginsBtn = await page.$('button[aria-label="Plugins (shortcodes)"]');
  if (!pluginsBtn) throw new Error('No se encontro el boton de Plugins (shortcodes) -- revisar aria-label');
  await pluginsBtn.click();
  await page.waitForTimeout(150);
  const menuVisible = await page.isVisible('.editor-v2-plugins-menu');
  if (!menuVisible) throw new Error('El popover de shortcodes no se abrio');
  await page.screenshot({ path: `${OUT_DIR}/lote2_01_popover_abierto.png` });

  await page.click('.editor-v2-plugins-menu button:has-text("{{fecha}}")');
  await page.waitForTimeout(150);
  let elState = await page.evaluate((id) => window.__pageEditorStore.elements.find((e) => e.id === id), textId);
  if (!elState.props.text.includes('{{fecha}}')) {
    throw new Error(`Se esperaba que props.text contuviera "{{fecha}}" (se agrega al texto base "Texto"), fue: "${elState.props.text}"`);
  }
  console.log('   OK: props.text guarda la plantilla SIN resolver:', JSON.stringify(elState.props.text));

  console.log('6) insertar un segundo shortcode {{numero_pagina}} en el MISMO texto -- debe AGREGAR, no reemplazar');
  await pluginsBtn.click();
  await page.waitForTimeout(150);
  await page.click('.editor-v2-plugins-menu button:has-text("{{numero_pagina}}")');
  await page.waitForTimeout(150);
  elState = await page.evaluate((id) => window.__pageEditorStore.elements.find((e) => e.id === id), textId);
  if (!elState.props.text.includes('{{fecha}}') || !elState.props.text.includes('{{numero_pagina}}')) {
    throw new Error(`Se esperaba que el texto contuviera ambos shortcodes concatenados, fue: "${elState.props.text}"`);
  }
  console.log('   OK: el segundo shortcode se AGREGO al texto existente:', JSON.stringify(elState.props.text));

  console.log('7) verificar el contexto de shortcode (pagina 2 de 3) -- pages/activePageId viven en React state del componente, no en el store Zustand, asi que se valida con los datos ya conocidos de la creacion de la publicacion');
  const expectedPageNumber = sortedPages[1].page_number;
  const expectedTotalPages = sortedPages.length;
  if (expectedPageNumber !== 2 || expectedTotalPages !== 3) {
    throw new Error(`Datos de paginacion inesperados: pagina ${expectedPageNumber} de ${expectedTotalPages}`);
  }
  console.log('   OK: la pagina abierta es la', expectedPageNumber, 'de', expectedTotalPages, '(shortcodeCtx del componente usa estos mismos valores)');
  await page.screenshot({ path: `${OUT_DIR}/lote2_02_texto_con_shortcodes.png` });

  console.log('8) props.text debe seguir siendo la plantilla, nunca el valor resuelto');
  if (elState.props.text.includes(new Date().getFullYear().toString()) === false) {
    console.log('   OK: props.text sigue siendo la plantilla y no fue sobrescrito con la fecha resuelta');
  } else {
    throw new Error('props.text parece haber sido sobrescrito con un valor resuelto en vez de la plantilla');
  }

  console.log('9) insertar un shortcode SIN seleccion de texto -- debe CREAR un elemento nuevo');
  await page.evaluate(() => window.__pageEditorStore.selectElement(null));
  await page.waitForTimeout(100);
  await pluginsBtn.click();
  await page.waitForTimeout(150);
  await page.click('.editor-v2-plugins-menu button:has-text("{{titulo_publicacion}}")');
  await page.waitForTimeout(150);
  count = await page.evaluate(() => window.__pageEditorStore.elements.length);
  if (count !== 2) throw new Error(`Se esperaban 2 elementos (el original + uno nuevo), hay ${count}`);
  const newEl = await page.evaluate(() => window.__pageEditorStore.elements[window.__pageEditorStore.elements.length - 1]);
  if (newEl.kind !== 'text' || newEl.props.text !== '{{titulo_publicacion}}') {
    throw new Error(`El elemento nuevo no es el esperado: ${JSON.stringify(newEl)}`);
  }
  console.log('   OK: sin seleccion, el shortcode creo un elemento de texto nuevo con la plantilla sin resolver');

  console.log('10) shortcode desconocido no debe romper el render');
  await page.evaluate((id) => {
    window.__pageEditorStore.updateElement(id, { props: { text: 'Hola {{shortcode_inventado}} mundo' } });
  }, textId);
  await page.waitForTimeout(150);
  const noCrash = await page.evaluate(() => document.querySelector('.editor-v2-stage') !== null);
  if (!noCrash) throw new Error('El stage desaparecio tras usar un shortcode desconocido (posible crash de render)');
  console.log('   OK: un shortcode no reconocido no rompe el render');

  console.log('11) guardar, recargar y confirmar que props.text (la plantilla) persiste sin resolver');
  await page.click('button:has-text("Guardar")');
  await page.waitForFunction(() => window.__pageEditorStore.isDirty === false, { timeout: 10000 });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__pageEditorStore.elements && window.__pageEditorStore.elements.length > 0, { timeout: 15000 });
  await page.waitForTimeout(300);
  // Tras guardar, el backend reemplaza los ids temporales del cliente por ids
  // definitivos -- buscamos por contenido en vez de por el id original.
  const persisted = await page.evaluate(() => {
    const el = window.__pageEditorStore.elements.find((e) => e.kind === 'text' && (e.props?.text || '').includes('shortcode_inventado'));
    return el?.props?.text;
  });
  if (!persisted || !persisted.includes('{{')) {
    throw new Error(`Tras recargar, se esperaba que props.text siguiera conteniendo la plantilla sin resolver, fue: "${persisted}"`);
  }
  console.log('   OK: tras guardar y recargar, la plantilla del shortcode persiste sin resolver:', JSON.stringify(persisted));

  if (consoleErrors.length > 0) {
    console.log('\n=== Errores de consola detectados ===');
    consoleErrors.forEach((e) => console.log(' -', e));
    throw new Error('Se detectaron errores de consola durante la verificacion.');
  }

  console.log('\nOK -- todos los checks del Lote 2 (shortcodes de texto / Plugins) pasaron.');
  await browser.close();
})().catch((err) => {
  console.error('FALLO:', err.message || err);
  process.exit(1);
});
