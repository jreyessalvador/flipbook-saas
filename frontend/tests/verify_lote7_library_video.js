// Verificacion real (Playwright/Chromium) del Lote 7: subida de video real +
// Library (biblioteca de assets reutilizables por tenant). Complementa
// e2e_editor_v2_regression.js, verify_lote1*.js, verify_lote2_shortcodes.js,
// verify_lote3_audio.js, verify_lote4_gallery.js, verify_spread_view.js,
// verify_lote5_embed.js y verify_lote6_soundcloud_quickactions.js.
//
// Fixture de video: el host de ia-lavatur y los contenedores dev NO tienen
// el paquete "ffmpeg" del sistema instalado (y no hay sudo sin password
// para instalarlo) -- pero Playwright SI trae su propio binario de ffmpeg
// minimizado para grabar sesiones (~/.cache/ms-playwright/ffmpeg-*/), que
// SOLO sabe decodificar MJPEG y codificar VP8/webm. Se uso ese binario para
// generar un WEBM REAL Y VALIDO (VP8, 1x1, ~2s, ver receta abajo) a partir
// de un JPEG minimo de 1x1 repetido como frames -- el resultado (751 bytes)
// se embebe aqui en base64 para que el test sea autocontenible y no
// dependa de tener ffmpeg disponible en el momento de correr el test.
// Receta usada (no se ejecuta en el test, solo documentada): un JPEG de 1x1
// (287 bytes) repetido 10 veces en un archivo .mjpeg, luego:
//   ffmpeg -f image2pipe -vcodec mjpeg -r 5 -i frames.mjpeg \
//          -c:v libvpx -pix_fmt yuv420p -r 5 tiny.webm
// El decoder MJPEG reporto errores de DC (el JPEG de 1x1 no es un frame
// "limpio" para ese decoder recortado) pero el STREAM VP8 DE SALIDA es
// valido -- Chromium lo reproduce sin error de consola (confirmado durante
// esta verificacion). No hizo falta tolerar ningun error de consola
// conocido del fixture: es un video real y decodificable, tal como pedia
// el enunciado del Lote 7 como opcion preferida sobre el buffer arbitrario.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE_URL || 'http://100.71.185.7:5173';
const API = process.env.API_URL || 'http://100.71.185.7:8010';
const EMAIL = process.env.TEST_EMAIL || 'admin@flipbook.app';
const PASSWORD = process.env.TEST_PASSWORD || 'admin123';
const OUT_DIR = __dirname;

// PNG minimo valido (1x1, rojo) -- mismo fixture que verify_lote4_gallery.js.
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

// WEBM real y valido (VP8, 1x1px, ~2s) -- ver receta en el comentario de
// arriba. 751 bytes, generado una sola vez con el ffmpeg bundleado de
// Playwright y embebido aqui para que el test no dependa de tenerlo
// disponible en tiempo de ejecucion.
const WEBM_1PX = Buffer.from(
  'GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAAAAK/EU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHWTbuMU6uEElTDZ1OsggEnTbuMU6uEHFO7a1OsggKp7AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmsCrXsYMPQkBNgIxMYXZmNjEuMS4xMDBXQYxMYXZmNjEuMS4xMDBEiYhAn0AAAAAAABZUrmvMrgEAAAAAAABD14EBc8WInxIL9WTCpFycgQAitZyDdW5kiIEAhoVWX1ZQOIOBASPjg4QL68IA4JSwgQG6gQGagQJVsIhVt4ECVbiBAhJUw2f6c3OfY8CAZ8iZRaOHRU5DT0RFUkSHjExhdmY2MS4xLjEwMHNz1WPAi2PFiJ8SC/VkwqRcZ8igRaOHRU5DT0RFUkSHk0xhdmM2MS4zLjEwMCBsaWJ2cHhnyKFFo4hEVVJBVElPTkSHkzAwOjAwOjAyLjAwMDAwMDAwMAAfQ7Z1QP3ngQCjqYEAAIAQAgCdASoBAAEAC8cIhYWIhYSIP4IADA70AP7Qwv/uh76vKnMgo5WBAMgAsQEALxH8ABgAGFgv9AAkAACjlYEBkACxAQAvEfwAGAAYWC/0ACQAAKOVgQJYALEBAC8R/AAYABhYL/QAJAAAo5WBAyAAsQEALxH8ABgAGFgv9AAkAACjlYED6ACxAQAvEfwAGAAYWC/0ACQAAKOVgQSwALEBAC8R/AAYABhYL/QAJAAAo5WBBXgAsQEALxH8FGAAYWC/0AAgAACjlYEGQACxAQAvEfwAGAAYWC/0ACQAAKOVgQcIALEBAC8R/AAYABhYL/QAJAAAHFO7a5G7j7OBALeK94EB8YIBpvCBAw==',
  'base64'
);

const PNG_PATH = path.join(OUT_DIR, '_lote7_test.png');
fs.writeFileSync(PNG_PATH, PNG_1PX);
const WEBM_PATH = path.join(OUT_DIR, '_lote7_test.webm');
fs.writeFileSync(WEBM_PATH, WEBM_1PX);
const TXT_PATH = path.join(OUT_DIR, '_lote7_test.txt');
fs.writeFileSync(TXT_PATH, 'esto no es un video');

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

  const uploadRequests = [];
  page.on('request', (req) => {
    if (req.url().includes('/api/assets/upload')) uploadRequests.push(req.url());
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
      body: JSON.stringify({ title: 'Verificacion Lote7 Library+Video ' + Date.now(), orientation: 'portrait', page_width: 210, page_height: 297, total_pages: 2 }),
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
  await page.waitForSelector('button[aria-label="Video"]:not([disabled])', { timeout: 15000 });

  console.log('4) subir una imagen real via el boton "Imagen" (regresion basica)');
  const imageInput = await page.$('input[type="file"][accept="image/*"]:not([multiple])');
  if (!imageInput) throw new Error('No se encontro el input de archivo de imagen (accept="image/*", sin multiple)');
  await imageInput.setInputFiles({ name: 'foto.png', mimeType: 'image/png', buffer: fs.readFileSync(PNG_PATH) });
  await page.waitForFunction(() => window.__pageEditorStore.elements.length === 1, { timeout: 10000 });
  let el = await page.evaluate(() => window.__pageEditorStore.elements[0]);
  if (el.kind !== 'image' || !el.props?.src) throw new Error(`Elemento de imagen inesperado: ${JSON.stringify(el)}`);
  console.log('   OK: kind=image creado, src =', el.props.src);
  const firstImageSrc = el.props.src;

  console.log('5) subir un .txt via el boton "Video" -- debe rechazarse del lado cliente (alert), sin llamar a la API ni crear elemento');
  const videoInput = await page.$('input[type="file"][accept="video/*"]');
  if (!videoInput) throw new Error('No se encontro el input de archivo de video (accept="video/*")');
  const uploadsBeforeTxt = uploadRequests.length;
  await videoInput.setInputFiles({ name: 'fake.txt', mimeType: 'text/plain', buffer: fs.readFileSync(TXT_PATH) });
  await page.waitForTimeout(300);
  let count = await page.evaluate(() => window.__pageEditorStore.elements.length);
  if (count !== 1) throw new Error(`Se esperaba seguir con 1 elemento tras subir un .txt como video, hay ${count}`);
  if (uploadRequests.length !== uploadsBeforeTxt) throw new Error('El .txt rechazado del lado cliente NO deberia haber llamado a /api/assets/upload');
  if (!dialogMessages.some((m) => m.toLowerCase().includes('video'))) {
    throw new Error(`Se esperaba un alert mencionando "video", dialogos vistos: ${JSON.stringify(dialogMessages)}`);
  }
  console.log('   OK: el .txt fue rechazado del lado cliente sin crear ningun elemento ni llamar a la API (alert:', JSON.stringify(dialogMessages), ')');

  console.log('6) subir un archivo de video real (webm VP8 decodificable) via el boton "Video"');
  await videoInput.setInputFiles({ name: 'clip.webm', mimeType: 'video/webm', buffer: fs.readFileSync(WEBM_PATH) });
  await page.waitForFunction(() => window.__pageEditorStore.elements.length === 2, { timeout: 10000 });
  let videoEl = await page.evaluate(() => window.__pageEditorStore.elements.find((e) => e.kind === 'video'));
  if (!videoEl || !videoEl.props?.src || videoEl.props.autoplay !== false || videoEl.props.loop !== false || videoEl.props.muted !== false) {
    throw new Error(`Elemento de video inesperado: ${JSON.stringify(videoEl)}`);
  }
  console.log('   OK: kind=video creado, src =', videoEl.props.src, ', autoplay/loop/muted en false por defecto');
  const videoElId = videoEl.id;
  await page.screenshot({ path: `${OUT_DIR}/lote7_01_video_insertado.png` });

  console.log('7) abrir "Library" -- debe aparecer la imagen Y el video recien subidos');
  await page.click('button[aria-label="Library"]');
  await page.waitForSelector('.editor-v2-library-menu', { timeout: 10000 });
  await page.waitForSelector('.editor-v2-library-item', { timeout: 10000 });
  await page.waitForTimeout(300);
  let libraryCount = await page.locator('.editor-v2-library-item').count();
  if (libraryCount < 2) throw new Error(`Se esperaban al menos 2 assets en la biblioteca (imagen + video), hay ${libraryCount}`);
  console.log('   OK: la biblioteca muestra', libraryCount, 'assets (>= imagen + video)');
  await page.screenshot({ path: `${OUT_DIR}/lote7_02_library_todos.png` });

  console.log('8) click en la miniatura de imagen de la biblioteca -- debe insertar un SEGUNDO elemento image con el MISMO src, sin resubir');
  const uploadsBeforeLibraryInsert = uploadRequests.length;
  const imageThumb = page.locator('.editor-v2-library-item').filter({ has: page.locator('img') }).first();
  await imageThumb.click();
  await page.waitForFunction(() => window.__pageEditorStore.elements.length === 3, { timeout: 10000 });
  if (uploadRequests.length !== uploadsBeforeLibraryInsert) throw new Error('Insertar desde la Library NO deberia llamar a /api/assets/upload (debe reutilizar la URL, no volver a subir)');
  const imagesAfterLibrary = await page.evaluate(() => window.__pageEditorStore.elements.filter((e) => e.kind === 'image'));
  if (imagesAfterLibrary.length !== 2) throw new Error(`Se esperaban 2 elementos image tras insertar desde la Library, hay ${imagesAfterLibrary.length}`);
  if (imagesAfterLibrary[0].props.src !== imagesAfterLibrary[1].props.src || imagesAfterLibrary[0].props.src !== firstImageSrc) {
    throw new Error(`Los dos elementos image deberian compartir el mismo src (reutilizacion): ${JSON.stringify(imagesAfterLibrary.map((e) => e.props.src))}`);
  }
  console.log('   OK: segundo elemento image insertado con el mismo src, ninguna nueva llamada a /api/assets/upload');

  console.log('9) reabrir "Library" (se cerro tras insertar) y filtrar por tipo "Video" -- solo debe aparecer el video');
  await page.click('button[aria-label="Library"]');
  await page.waitForSelector('.editor-v2-library-tabs', { timeout: 10000 });
  await page.click('.editor-v2-library-tabs button:has-text("Video")');
  await page.waitForTimeout(400);
  // Nota: la biblioteca es del TENANT y persiste entre corridas de este
  // mismo test (y de otras verificaciones que hayan subido assets antes) --
  // no se asume un conteo exacto, solo que el filtro "Video" (a) muestra al
  // menos el que se acaba de subir y (b) NUNCA una miniatura de imagen.
  const videoOnlyCount = await page.locator('.editor-v2-library-item').count();
  if (videoOnlyCount < 1) throw new Error(`Se esperaba al menos 1 asset al filtrar por Video, hay ${videoOnlyCount}`);
  const hasImgInVideoFilter = await page.locator('.editor-v2-library-item img').count();
  if (hasImgInVideoFilter !== 0) throw new Error('El filtro "Video" no deberia mostrar ninguna miniatura de imagen');
  console.log('   OK: el filtro "Video" muestra', videoOnlyCount, 'asset(s), ninguna imagen');
  await page.screenshot({ path: `${OUT_DIR}/lote7_03_library_filtro_video.png` });
  // cerrar el popover de Library haciendo click de nuevo en el boton del rail
  await page.click('button[aria-label="Library"]');

  console.log('10) seleccionar el elemento de video y revisar el panel de propiedades (header, <video controls>, checkboxes)');
  await page.evaluate((id) => window.__pageEditorStore.selectElement(id), videoElId);
  await page.waitForTimeout(200);
  const headerText = await page.textContent('.editor-v2-props-header');
  if (!headerText.includes('Video')) throw new Error(`Header inesperado para el elemento de video: "${headerText}"`);
  const videoTagCount = await page.locator('.editor-v2-properties video').count();
  if (videoTagCount !== 1) throw new Error(`Se esperaba exactamente un <video> en el panel de propiedades, hay ${videoTagCount}`);
  const videoSrcAttr = await page.getAttribute('.editor-v2-properties video', 'src');
  if (!videoSrcAttr || !videoSrcAttr.includes('/api/assets/serve/')) throw new Error(`src del <video> del panel inesperado: "${videoSrcAttr}"`);
  console.log('   OK: panel muestra "Video" con <video controls> apuntando a', videoSrcAttr);
  await page.screenshot({ path: `${OUT_DIR}/lote7_04_panel_video.png` });

  console.log('11) marcar los 3 checkboxes (autoplay/loop/muted) y confirmar que props se actualiza');
  const videoCheckboxes = page.locator('.editor-v2-properties section:has(h4:text("Video")) input[type="checkbox"]');
  const checkboxCount = await videoCheckboxes.count();
  if (checkboxCount !== 3) throw new Error(`Se esperaban 3 checkboxes en la seccion Video, hay ${checkboxCount}`);
  await videoCheckboxes.nth(0).check();
  await videoCheckboxes.nth(1).check();
  await videoCheckboxes.nth(2).check();
  await page.waitForTimeout(200);
  let videoState = await page.evaluate((id) => window.__pageEditorStore.elements.find((e) => e.id === id), videoElId);
  if (videoState.props?.autoplay !== true || videoState.props?.loop !== true || videoState.props?.muted !== true) {
    throw new Error(`Los 3 checkboxes de video no se guardaron correctamente: ${JSON.stringify(videoState.props)}`);
  }
  console.log('   OK: autoplay/loop/muted quedaron en true en props');

  console.log('12) guardar, recargar y confirmar que TODO persiste (video con flags + 2 imagenes con el mismo src)');
  await page.click('button:has-text("Guardar")');
  await page.waitForFunction(() => window.__pageEditorStore.isDirty === false, { timeout: 10000 });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__pageEditorStore.elements && window.__pageEditorStore.elements.length === 3, { timeout: 15000 });
  await page.waitForTimeout(300);
  const persisted = await page.evaluate(() => window.__pageEditorStore.elements);

  const persistedVideo = persisted.find((e) => e.kind === 'video');
  if (!persistedVideo) throw new Error('No se encontro el elemento de video tras recargar');
  if (persistedVideo.props?.src !== videoEl.props.src) throw new Error(`src del video no persistio: ${JSON.stringify(persistedVideo.props)}`);
  if (persistedVideo.props?.autoplay !== true || persistedVideo.props?.loop !== true || persistedVideo.props?.muted !== true) {
    throw new Error(`Los flags del video no persistieron: ${JSON.stringify(persistedVideo.props)}`);
  }
  console.log('   OK: el video persiste con src y autoplay/loop/muted en true');

  const persistedImages = persisted.filter((e) => e.kind === 'image');
  if (persistedImages.length !== 2) throw new Error(`Se esperaban 2 elementos image tras recargar, hay ${persistedImages.length}`);
  if (persistedImages[0].props.src !== persistedImages[1].props.src || persistedImages[0].props.src !== firstImageSrc) {
    throw new Error(`Los dos elementos image deberian seguir compartiendo el mismo src tras recargar: ${JSON.stringify(persistedImages.map((e) => e.props.src))}`);
  }
  console.log('   OK: los 2 elementos image persisten compartiendo el mismo src (reutilizacion via Library)');
  await page.screenshot({ path: `${OUT_DIR}/lote7_05_tras_recargar.png` });

  if (consoleErrors.length > 0) {
    console.log('\n=== Errores de consola detectados (no tolerados) ===');
    consoleErrors.forEach((e) => console.log(' -', e));
    throw new Error('Se detectaron errores de consola inesperados durante la verificacion.');
  }

  console.log('\nOK -- todos los checks del Lote 7 (Library + subida de video real) pasaron.');
  await browser.close();
})().catch(async (err) => {
  console.error('FALLO:', err.message || err);
  process.exit(1);
});
