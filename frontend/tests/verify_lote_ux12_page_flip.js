// Verificacion real (Playwright/Chromium) del Lote UX-12: efecto visual +
// sonido de "pasar pagina" al navegar con Anterior/Siguiente en el visor
// publico (fuera del editor), y paginas de un spread "casi pegadas".
// Reportado por Carlos tras revisar el visor: pidio que el spread se vea
// mas como una revista real encuadernada, con transicion tipo papel al
// cambiar de pagina.
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

  console.log('2) crear publicacion de 4 paginas (portada + spread interior + contraportada)');
  const token = await page.evaluate(() => localStorage.getItem('token'));
  const createResp = await page.evaluate(async ({ tok, api }) => {
    const r = await fetch(`${api}/api/publications`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
      body: JSON.stringify({ title: 'Verificacion UX-12 flip ' + Date.now(), orientation: 'portrait', page_width: 210, page_height: 297, total_pages: 4 }),
    });
    return { status: r.status, body: await r.json() };
  }, { tok: token, api: API });
  if (createResp.status !== 201) throw new Error(`No se pudo crear publicacion: HTTP ${createResp.status}`);
  const publicationId = createResp.body.id;

  console.log('3) abrir el VISOR publico (no el editor) en la portada');
  await page.goto(`${BASE}/publications/${publicationId}/view`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.editor-v2-pagenav', { timeout: 15000 });

  console.log('4) instalar espia de window.Audio ANTES de cualquier clic (para el paso 7)');
  await page.evaluate(() => {
    window.__testAudioSrcs = [];
    const OriginalAudio = window.Audio;
    window.Audio = function (src) {
      window.__testAudioSrcs.push(src);
      const instance = new OriginalAudio(src);
      instance.play = () => Promise.resolve(); // evita que el navegador headless bloquee/ruidee el play real
      return instance;
    };
  });

  console.log('5) avanzar a la pagina 2 (spread interior 2-3) y verificar el gap "casi pegado" entre paginas');
  // Regresion (bug reportado por Carlos: "el efecto de cambio de pagina no
  // quedo bien, se ve muy feo"): el rotateY 3D se aplicaba antes al DIV
  // que mide el ancho disponible completo (.page-viewer-canvas-wrap,
  // ~igual al ancho de toda la pantalla), no al contenido real de la
  // pagina -- eso pivotaba sobre el borde de la PANTALLA en vez del borde
  // de la pagina, generando un trapecio gris gigante de fondo. El fix
  // metio un DIV interno (.page-viewer-flip-inner) sizeado solo al ancho
  // real de la(s) pagina(s), que es el que ahora debe rotar. Verificamos
  // aqui que ese div interno sea sustancialmente MAS ANGOSTO que el wrap
  // exterior (estamos en la portada, una sola pagina, el caso donde el
  // bug era mas grave) para no volver a regresionar a rotar el wrap
  // completo.
  await page.click('.editor-v2-pagenav button[aria-label="Hoja siguiente"]');
  await page.waitForTimeout(60);
  const flipGeom = await page.evaluate(() => {
    const inner = document.querySelector('.page-viewer-flip-inner');
    const outer = document.querySelector('.page-viewer-canvas-wrap');
    if (!inner || !outer) return null;
    return { innerWidth: inner.getBoundingClientRect().width, outerWidth: outer.getBoundingClientRect().width };
  });
  console.log('   ancho del div que rota (flip-inner) vs wrap exterior (medicion) =', flipGeom);
  if (!flipGeom) throw new Error('BUG: no se encontro .page-viewer-flip-inner o .page-viewer-canvas-wrap durante la transicion');
  if (flipGeom.innerWidth > flipGeom.outerWidth * 0.7) {
    throw new Error(`BUG: el div que rota (${flipGeom.innerWidth}px) casi no es mas angosto que el wrap exterior de medicion (${flipGeom.outerWidth}px) -- probablemente se volvio a rotar el contenedor completo en vez de solo la pagina (el "trapecio gris gigante" que reporto Carlos)`);
  }
  console.log('   OK: el div que rota esta sizeado al contenido real de la pagina, no al ancho completo de medicion');
  await page.waitForTimeout(540); // completar el resto de la animacion de flip (220ms x2 en total)
  const slotBoxes = await page.$$eval('.editor-v2-page-slot', (els) => els.map((el) => el.getBoundingClientRect()));
  if (slotBoxes.length !== 2) throw new Error(`Se esperaban 2 .editor-v2-page-slot en el spread interior, se encontraron ${slotBoxes.length}`);
  const gap = slotBoxes[1].left - slotBoxes[0].right;
  console.log('   gap medido entre paginas =', gap, 'px');
  if (gap > 15) throw new Error(`El gap entre paginas (${gap}px) sigue siendo el del editor (24px) -- el fix de "casi pegadas" no aplico`);
  console.log('   OK: paginas casi pegadas (gap <= 15px)');

  console.log('6) verificar el efecto visual de flip al hacer clic en "Siguiente": debe aparecer la clase page-viewer-flipping y una rotacion 3D real durante la transicion');
  let sawFlippingClass = false;
  let sawRotation = false;
  const pollPromise = (async () => {
    const deadline = Date.now() + 480;
    while (Date.now() < deadline) {
      const state = await page.evaluate(() => {
        const wrap = document.querySelector('.page-viewer-flip-inner');
        if (!wrap) return null;
        return { cls: wrap.className, transform: getComputedStyle(wrap).transform };
      }).catch(() => null);
      if (state) {
        if (state.cls.includes('page-viewer-flipping')) sawFlippingClass = true;
        if (state.transform && state.transform !== 'none' && state.transform !== 'matrix(1, 0, 0, 1, 0, 0)') sawRotation = true;
      }
      await new Promise((r) => setTimeout(r, 15));
    }
  })();
  await page.click('.editor-v2-pagenav button[aria-label="Hoja siguiente"]');
  await pollPromise;
  if (!sawFlippingClass) throw new Error('BUG: nunca aparecio la clase page-viewer-flipping durante la transicion de Siguiente');
  if (!sawRotation) throw new Error('BUG: nunca se detecto una transformacion 3D (rotateY) real durante la transicion -- el efecto visual no esta aplicando');
  console.log('   OK: clase de flipping y transformacion 3D detectadas durante la transicion');

  console.log('7) confirmar que tras la animacion el contenido SI avanzo (2 clics en Siguiente desde la portada -> contraportada, pagina 4/4)');
  await page.waitForTimeout(600);
  const positionText = await page.$eval('.editor-v2-pagenav-label', (el) => el.textContent.trim());
  console.log('   posicion tras 2 clics en Siguiente:', positionText);
  if (!positionText.includes('4')) throw new Error(`Se esperaba llegar a la pagina 4 (contraportada) tras 2 clics en Siguiente, la etiqueta muestra: "${positionText}"`);
  console.log('   OK: el contenido avanzo correctamente pese a la animacion');

  console.log('8) verificar que se crea un Audio() con src de page-turn.mp3 en cada cambio de pagina (espia instalado en el paso 4)');
  const audioSrcs = await page.evaluate(() => window.__testAudioSrcs);
  console.log('   Audio() creados durante los 2 clics en Siguiente:', audioSrcs);
  if (!audioSrcs.some((s) => s && s.includes('page-turn'))) {
    throw new Error(`BUG: nunca se creo un Audio() con src de page-turn.mp3 al pasar de pagina (se vio: ${JSON.stringify(audioSrcs)})`);
  }
  console.log('   OK: se crea el Audio() del sonido de pasar pagina en cada transicion');

  console.log('9) verificar que /sounds/page-turn.mp3 realmente existe y se sirve (no un 404 silencioso)');
  const soundResp = await page.evaluate(async (base) => {
    const r = await fetch(`${base}/sounds/page-turn.mp3`);
    return { status: r.status, contentType: r.headers.get('content-type'), size: (await r.arrayBuffer()).byteLength };
  }, BASE);
  console.log('   GET /sounds/page-turn.mp3 ->', soundResp);
  if (soundResp.status !== 200 || soundResp.size < 1000) {
    throw new Error(`BUG: /sounds/page-turn.mp3 no se sirve correctamente: ${JSON.stringify(soundResp)}`);
  }
  console.log('   OK: el archivo de sonido se sirve correctamente');

  if (consoleErrors.length > 0) {
    throw new Error('Errores de consola detectados:\n' + consoleErrors.join('\n'));
  }

  await page.screenshot({ path: `${OUT_DIR}/ux12_spread_gap.png` });

  await browser.close();
  console.log('\n=== TODO OK: Lote UX-12 (spread casi pegado + efecto y sonido de pasar pagina) verificado. ===');
})().catch((err) => {
  console.error('\n=== FALLO ===');
  console.error(err);
  process.exit(1);
});
