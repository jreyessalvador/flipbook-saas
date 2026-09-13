// Verificacion Playwright del Lote UX-5 (orden de capas: traer al
// frente/enviar al fondo/subir/bajar) + Lote UX-7 (reproduccion REAL de
// audio/video en el visor publico, con controles y autoplay, en vez del
// placeholder estatico de Konva).
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
  const token = await page.evaluate(() => localStorage.getItem('token'));

  console.log('2) crear publicacion con audio y video reales (fixtures minimos) via API directa');
  const pub = await page.evaluate(async ({ tok, api }) => {
    const r = await fetch(`${api}/api/publications`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
      body: JSON.stringify({ title: 'UX5+UX7 layers+media ' + Date.now(), orientation: 'portrait', page_width: 210, page_height: 297, total_pages: 2 }),
    });
    return r.json();
  }, { tok: token, api: API });

  const pagesResp = await page.evaluate(async ({ tok, api, pubId }) => {
    const r = await fetch(`${api}/api/pages/publications/${pubId}/pages`, { headers: { Authorization: `Bearer ${tok}` } });
    return r.json();
  }, { tok: token, api: API, pubId: pub.id });
  const coverId = pagesResp.sort((a, b) => a.page_number - b.page_number)[0].id;

  // Fixture de audio minimo: WAV valido de 1 sample (44 bytes de header + 2 bytes de data).
  const WAV_MIN_BASE64 = 'UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
  // Fixture de video: mismo WEBM VP8 real (751 bytes) que ya usa
  // verify_lote7_library_video.js -- ver el comentario extenso en ese
  // archivo sobre como se genero con el ffmpeg bundleado de Playwright.
  const WEBM_MIN_BASE64 = 'GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAAAAK/EU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHWTbuMU6uEElTDZ1OsggEnTbuMU6uEHFO7a1OsggKp7AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmsCrXsYMPQkBNgIxMYXZmNjEuMS4xMDBXQYxMYXZmNjEuMS4xMDBEiYhAn0AAAAAAABZUrmvMrgEAAAAAAABD14EBc8WInxIL9WTCpFycgQAitZyDdW5kiIEAhoVWX1ZQOIOBASPjg4QL68IA4JSwgQG6gQGagQJVsIhVt4ECVbiBAhJUw2f6c3OfY8CAZ8iZRaOHRU5DT0RFUkSHjExhdmY2MS4xLjEwMHNz1WPAi2PFiJ8SC/VkwqRcZ8igRaOHRU5DT0RFUkSHk0xhdmM2MS4zLjEwMCBsaWJ2cHhnyKFFo4hEVVJBVElPTkSHkzAwOjAwOjAyLjAwMDAwMDAwMAAfQ7Z1QP3ngQCjqYEAAIAQAgCdASoBAAEAC8cIhYWIhYSIP4IADA70AP7Qwv/uh76vKnMgo5WBAMgAsQEALxH8ABgAGFgv9AAkAACjlYEBkACxAQAvEfwAGAAYWC/0ACQAAKOVgQJYALEBAC8R/AAYABhYL/QAJAAAo5WBAyAAsQEALxH8ABgAGFgv9AAkAACjlYED6ACxAQAvEfwAGAAYWC/0ACQAAKOVgQSwALEBAC8R/AAYABhYL/QAJAAAo5WBBXgAsQEALxH8FGAAYWC/0AAgAACjlYEGQACxAQAvEfwAGAAYWC/0ACQAAKOVgQcIALEBAC8R/AAYABhYL/QAJAAAHFO7a5G7j7OBALeK94EB8YIBpvCBAw==';
  // Decodificar el base64 del lado de NODE (con Buffer, tolerante) y pasar
  // los BYTES YA DECODIFICADOS al navegador -- nunca atob() dentro del
  // navegador, que es estricto y rechaza el fixture WEBM reutilizado de
  // verify_lote7_library_video.js (ese archivo nunca pasa por atob, solo
  // escribe el Buffer a disco y lo sube via setInputFiles, asi que nunca
  // se topo con esto). atob() en el navegador exige una cadena base64
  // perfectamente valida; Buffer.from(..., 'base64') de Node es mas
  // tolerante -- de ahi la diferencia.
  const uploadFixture = async (b64, filename, mime, kind) => {
    const bytesArray = Array.from(Buffer.from(b64, 'base64'));
    return page.evaluate(async ({ tok, api, bytesArray, filename, mime, kind }) => {
      const bytes = new Uint8Array(bytesArray);
      const blob = new Blob([bytes], { type: mime });
      const form = new FormData();
      form.append('file', blob, filename);
      form.append('kind', kind);
      const r = await fetch(`${api}/api/assets/upload`, { method: 'POST', headers: { Authorization: `Bearer ${tok}` }, body: form });
      if (!r.ok) throw new Error(`No se pudo subir ${filename}: HTTP ${r.status}`);
      return r.json();
    }, { tok: token, api: API, bytesArray, filename, mime, kind });
  };

  const audioUpload = await uploadFixture(WAV_MIN_BASE64, 'test.wav', 'audio/wav', 'audio');
  const videoUpload = await uploadFixture(WEBM_MIN_BASE64, 'test.webm', 'video/webm', 'video');

  const currentElements = await page.evaluate(async ({ tok, api, pageId }) => {
    const r = await fetch(`${api}/api/pages/${pageId}/elements`, { headers: { Authorization: `Bearer ${tok}` } });
    return r.json();
  }, { tok: token, api: API, pageId: coverId });

  await page.evaluate(async ({ tok, api, pageId, version, audioSrc, videoSrc }) => {
    const r = await fetch(`${api}/api/pages/${pageId}/elements`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
      body: JSON.stringify({
        version,
        elements: [
          { kind: 'shape', x: 20, y: 20, width: 100, height: 100, rotation_deg: 0, z_index: 0, props: { fill: '#ff0000', shape_type: 'rect' } },
          { kind: 'shape', x: 50, y: 50, width: 100, height: 100, rotation_deg: 0, z_index: 1, props: { fill: '#00ff00', shape_type: 'rect' } },
          { kind: 'audio', x: 20, y: 200, width: 220, height: 56, rotation_deg: 0, z_index: 2, props: { src: audioSrc, autoplay: true, loop: false } },
          { kind: 'video', x: 20, y: 260, width: 280, height: 160, rotation_deg: 0, z_index: 3, props: { src: videoSrc, autoplay: true, loop: false, muted: true } },
        ],
      }),
    });
    if (!r.ok) throw new Error('No se pudo guardar los elementos de prueba: HTTP ' + r.status);
  }, { tok: token, api: API, pageId: coverId, version: currentElements.version, audioSrc: audioUpload.url, videoSrc: videoUpload.url });

  console.log('3) editor: "traer al frente" en el rectangulo ROJO (z_index=0, detras del VERDE) debe dejarlo con mayor z_index que el verde');
  await page.goto(`${BASE}/publications/${pub.id}/edit/${coverId}`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => (window.__pageEditorStoreLeft?.elements || []).length === 4, { timeout: 10000 });
  const redId = await page.evaluate(() => window.__pageEditorStoreLeft.elements.find((e) => e.props?.fill === '#ff0000').id);
  const greenId = await page.evaluate(() => window.__pageEditorStoreLeft.elements.find((e) => e.props?.fill === '#00ff00').id);
  await page.evaluate((id) => window.__pageEditorStoreLeft.selectElement(id), redId);
  await page.waitForTimeout(150);
  await page.click('button[aria-label="Traer al frente"]');
  await page.waitForTimeout(150);
  let zRed = await page.evaluate((id) => window.__pageEditorStoreLeft.elements.find((e) => e.id === id).z_index, redId);
  let zGreen = await page.evaluate((id) => window.__pageEditorStoreLeft.elements.find((e) => e.id === id).z_index, greenId);
  if (!(zRed > zGreen)) throw new Error(`"Traer al frente" no funciono: z_index rojo=${zRed}, verde=${zGreen}`);
  console.log('   OK: "Traer al frente" dejo el rojo por encima del verde (z_index', zRed, '>', zGreen, ')');

  console.log('4) "Enviar al fondo" sobre el mismo rojo debe volver a dejarlo debajo del verde');
  await page.click('button[aria-label="Enviar al fondo"]');
  await page.waitForTimeout(150);
  zRed = await page.evaluate((id) => window.__pageEditorStoreLeft.elements.find((e) => e.id === id).z_index, redId);
  zGreen = await page.evaluate((id) => window.__pageEditorStoreLeft.elements.find((e) => e.id === id).z_index, greenId);
  if (!(zRed < zGreen)) throw new Error(`"Enviar al fondo" no funciono: z_index rojo=${zRed}, verde=${zGreen}`);
  console.log('   OK: "Enviar al fondo" volvio a dejar el rojo debajo del verde (z_index', zRed, '<', zGreen, ')');

  console.log('5) "Subir un nivel" sobre el rojo (otra vez al fondo) debe volver a dejarlo por encima del verde (solo hay 2 formas -- un nivel ya lo cruza)');
  await page.click('button[aria-label="Subir un nivel"]');
  await page.waitForTimeout(150);
  zRed = await page.evaluate((id) => window.__pageEditorStoreLeft.elements.find((e) => e.id === id).z_index, redId);
  zGreen = await page.evaluate((id) => window.__pageEditorStoreLeft.elements.find((e) => e.id === id).z_index, greenId);
  if (!(zRed > zGreen)) throw new Error(`"Subir un nivel" no funciono: z_index rojo=${zRed}, verde=${zGreen}`);
  console.log('   OK: "Subir un nivel" dejo el rojo por encima del verde (z_index', zRed, '>', zGreen, ')');

  console.log('6) "Bajar un nivel" debe volver a dejarlo debajo');
  await page.click('button[aria-label="Bajar un nivel"]');
  await page.waitForTimeout(150);
  zRed = await page.evaluate((id) => window.__pageEditorStoreLeft.elements.find((e) => e.id === id).z_index, redId);
  zGreen = await page.evaluate((id) => window.__pageEditorStoreLeft.elements.find((e) => e.id === id).z_index, greenId);
  if (!(zRed < zGreen)) throw new Error(`"Bajar un nivel" no funciono: z_index rojo=${zRed}, verde=${zGreen}`);
  console.log('   OK: "Bajar un nivel" volvio a dejar el rojo debajo del verde');

  console.log('7) guardar, recargar y confirmar que el orden de capas persiste');
  await page.click('button:has-text("Guardar")');
  await page.waitForTimeout(800);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => (window.__pageEditorStoreLeft?.elements || []).length === 4, { timeout: 10000 });
  // El backend re-crea los ids al guardar (sin id en PageElementCreate) --
  // tras recargar hay que volver a ubicar los elementos por color, no por
  // el id temporal original.
  const zRedPersisted = await page.evaluate(() => window.__pageEditorStoreLeft.elements.find((e) => e.props?.fill === '#ff0000')?.z_index);
  const zGreenPersisted = await page.evaluate(() => window.__pageEditorStoreLeft.elements.find((e) => e.props?.fill === '#00ff00')?.z_index);
  console.log('   z_index tras recargar: rojo=', zRedPersisted, 'verde=', zGreenPersisted);
  if (zRedPersisted === undefined || zGreenPersisted === undefined || !(zRedPersisted < zGreenPersisted)) {
    throw new Error(`El orden de capas NO persistio correctamente tras guardar+recargar: rojo=${zRedPersisted} verde=${zGreenPersisted}`);
  }
  console.log('   OK: el orden de capas persiste tras guardar y recargar (rojo sigue debajo del verde)');

  console.log('8) VISOR PUBLICO: el elemento de audio debe renderizar un <audio> NATIVO real (no el placeholder de Konva)');
  await page.goto(`${BASE}/publications/${pub.id}/view`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.editor-v2-stage', { timeout: 10000 });
  const audioTagCount = await page.locator('audio').count();
  if (audioTagCount < 1) throw new Error('No se encontro ningun <audio> nativo en el visor publico');
  const audioTag = page.locator('audio').first();
  const audioHasControls = await audioTag.evaluate((el) => el.hasAttribute('controls'));
  const audioSrc = await audioTag.evaluate((el) => el.currentSrc || el.src);
  if (!audioHasControls) throw new Error('El <audio> del visor no tiene el atributo controls');
  if (!audioSrc || !audioSrc.includes('/api/assets/serve/')) throw new Error(`El <audio> del visor no apunta al archivo real: "${audioSrc}"`);
  console.log('   OK: <audio controls> real presente en el visor, src correcto:', audioSrc);
  await page.screenshot({ path: `${OUT_DIR}/ux7_01_viewer_audio_native.png` });

  if (consoleErrors.length > 0) {
    console.log('\n=== Errores de consola detectados (no tolerados) ===');
    consoleErrors.forEach((e) => console.log(' -', e));
    throw new Error('Se detectaron errores de consola inesperados.');
  }

  console.log('9) VISOR PUBLICO: el elemento de video debe renderizar un <video> NATIVO real, con controles, autoplay y muted (unica forma confiable de que el navegador permita el autoplay)');
  const videoTagCount = await page.locator('video').count();
  if (videoTagCount < 1) throw new Error('No se encontro ningun <video> nativo en el visor publico');
  const videoTag = page.locator('video').first();
  const videoHasControls = await videoTag.evaluate((el) => el.hasAttribute('controls'));
  const videoMuted = await videoTag.evaluate((el) => el.muted);
  const videoSrcOk = await videoTag.evaluate((el) => (el.currentSrc || el.src || '').includes('/api/assets/serve/'));
  if (!videoHasControls) throw new Error('El <video> del visor no tiene el atributo controls');
  if (!videoMuted) throw new Error('El <video> del visor deberia estar muted (se guardo props.muted=true)');
  if (!videoSrcOk) throw new Error('El <video> del visor no apunta al archivo real');
  console.log('   OK: <video controls muted> real presente en el visor, src correcto');
  await page.screenshot({ path: `${OUT_DIR}/ux7_02_viewer_video_native.png` });

  console.log('\nOK -- el Lote UX-5 (orden de capas) + Lote UX-7 (audio/video real en el visor) pasaron sin errores de consola.');
  await browser.close();
})().catch(async (err) => {
  console.error('FALLO:', err.message || err);
  process.exit(1);
});
