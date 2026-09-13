// Verificacion Playwright de Lote UX-9 (embed real -- iframe de YouTube en
// el visor publico en vez del placeholder estatico) y Lote UX-10 (galeria
// tipo slideshow real con controles/autoplay/leyendas + modal "Propiedades
// de la galeria" con titulo/descripcion por imagen, modo de imagen,
// transicion). Reportado por Carlos con 4 capturas: "no se muestra la
// miniatura" del YouTube, y pedido de que la galeria funcione como
// slideshow con controles de transicion/tiempo.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE_URL || 'http://100.71.185.7:5173';
const API_URL = process.env.API_URL || 'http://100.71.185.7:8010';
const EMAIL = process.env.TEST_EMAIL || 'admin@flipbook.app';
const PASSWORD = process.env.TEST_PASSWORD || 'admin123';
const OUT_DIR = __dirname;

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);
function writePng(name) {
  const p = path.join(OUT_DIR, name);
  fs.writeFileSync(p, PNG_1PX);
  return p;
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
  const token = await page.evaluate(() => localStorage.getItem('token'));

  console.log('2) crear publicacion de prueba via API directa');
  const pub = await page.evaluate(async ({ tok, api }) => {
    const r = await fetch(`${api}/api/publications`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
      body: JSON.stringify({ title: 'UX9-10 embed+gallery ' + Date.now(), orientation: 'portrait', page_width: 210, page_height: 297, total_pages: 2 }),
    });
    return r.json();
  }, { tok: token, api: API_URL });

  const pagesResp = await page.evaluate(async ({ tok, api, pubId }) => {
    const r = await fetch(`${api}/api/pages/publications/${pubId}/pages`, { headers: { Authorization: `Bearer ${tok}` } });
    return r.json();
  }, { tok: token, api: API_URL, pubId: pub.id });
  const coverId = pagesResp.sort((a, b) => a.page_number - b.page_number)[0].id;

  console.log('3) abrir el editor en la portada');
  await page.goto(`${BASE}/publications/${pub.id}/edit/${coverId}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('button[aria-label="Galería"]:not([disabled])', { timeout: 15000 });

  console.log('4) insertar embed de YouTube');
  await page.click('button[aria-label="YouTube"]');
  await page.waitForSelector('.editor-v2-embed-menu', { state: 'visible', timeout: 5000 });
  await page.fill('.editor-v2-embed-input', 'https://youtu.be/dQw4w9WgXcQ');
  await page.click('.editor-v2-embed-menu button:has-text("Insertar")');
  await page.waitForFunction(() => (window.__pageEditorStore?.elements || []).some((e) => e.kind === 'embed'), { timeout: 5000 });
  const embedEl = await page.evaluate(() => window.__pageEditorStore.elements.find((e) => e.kind === 'embed'));
  console.log('   embed insertado:', embedEl.props.provider, embedEl.props.video_id);

  console.log('5) subir 3 imagenes -- debe crear un elemento kind=gallery con 3 imagenes');
  const galleryInput = await page.$('input[type="file"][multiple][accept="image/*"] >> nth=0');
  if (!galleryInput) throw new Error('No se encontro el primer input de archivo multiple de imagenes (Galeria)');
  const galleryFiles = [writePng('_ux910_g1.png'), writePng('_ux910_g2.png'), writePng('_ux910_g3.png')];
  await galleryInput.setInputFiles(galleryFiles);
  await page.waitForFunction(() => (window.__pageEditorStore?.elements || []).some((e) => e.kind === 'gallery' && (e.props?.images || []).length === 3), { timeout: 15000 });
  console.log('   OK: galeria creada con 3 imagenes');

  console.log('6) seleccionar la galeria y abrir el modal "Configurar galería"');
  await page.evaluate(() => {
    const gal = window.__pageEditorStore.elements.find((e) => e.kind === 'gallery');
    window.__pageEditorStore.selectElement(gal.id);
  });
  await page.click('button:has-text("Configurar galería")');
  await page.waitForSelector('.editor-v2-modal-gallery', { state: 'visible', timeout: 5000 });

  console.log('7) escribir título/descripción en la 1ra imagen, activar leyendas, elegir transición "Deslizar", duración 1s, guardar');
  await page.locator('.editor-v2-modal-image-row').first().locator('input[placeholder="Título"]').fill('Playa al atardecer');
  await page.locator('.editor-v2-modal-image-row').first().locator('input[placeholder="Descripción"]').fill('Foto de prueba UX-10');
  await page.check('.editor-v2-modal-checkboxes label:has-text("Activar leyendas") input');
  await page.selectOption('.editor-v2-modal-gallery .editor-v2-field-grid select >> nth=1', 'slide');
  await page.fill('.editor-v2-modal-gallery .editor-v2-field-grid input[type="number"]', '1');
  await page.click('.editor-v2-modal-footer button:has-text("Actualizar")');
  await page.waitForSelector('.editor-v2-modal-gallery', { state: 'hidden', timeout: 5000 });

  const galAfter = await page.evaluate(() => window.__pageEditorStore.elements.find((e) => e.kind === 'gallery'));
  if (galAfter.props.images[0].title !== 'Playa al atardecer') throw new Error('El título de la 1ra imagen no se guardó: ' + JSON.stringify(galAfter.props.images[0]));
  if (!galAfter.props.captions_enabled) throw new Error('captions_enabled no quedó activo');
  if (galAfter.props.transition_effect !== 'slide') throw new Error('transition_effect no quedó en "slide": ' + galAfter.props.transition_effect);
  if (Number(galAfter.props.transition_duration) !== 1) throw new Error('transition_duration no quedó en 1: ' + galAfter.props.transition_duration);
  console.log('   OK: props de la galería guardados correctamente ->', JSON.stringify({ title: galAfter.props.images[0].title, captions_enabled: galAfter.props.captions_enabled, transition_effect: galAfter.props.transition_effect, transition_duration: galAfter.props.transition_duration }));

  console.log('8) guardar la página (para que el visor público lea props actualizados)');
  await page.click('button.editor-v2-save');
  await page.waitForFunction(() => window.__pageEditorStore.isDirty === false, { timeout: 10000 }).catch(() => {});

  console.log('9) abrir el visor público (modo lectura, misma sesión) y verificar el iframe real de YouTube');
  const viewerPage = page;
  await viewerPage.goto(`${BASE}/publications/${pub.id}/view`, { waitUntil: 'networkidle' });
  await viewerPage.waitForSelector('.editor-v2-stage', { timeout: 10000 });
  await viewerPage.waitForTimeout(1500);

  const iframeSrc = await viewerPage.evaluate(() => {
    const ifr = document.querySelector('iframe[src*="youtube-nocookie.com/embed/"]');
    return ifr ? ifr.getAttribute('src') : null;
  });
  if (!iframeSrc) throw new Error('No se encontró el <iframe> real de YouTube en el visor público (sigue mostrando el placeholder estático)');
  if (!iframeSrc.includes('dQw4w9WgXcQ')) throw new Error('El iframe de YouTube no apunta al video_id correcto: ' + iframeSrc);
  console.log('   OK: iframe real de YouTube presente en el visor ->', iframeSrc);

  console.log('10) verificar el slideshow real de la galería (imagenes + controles + leyenda)');
  const galleryCheck = await viewerPage.evaluate(() => {
    const imgs = Array.from(document.querySelectorAll('img')).filter((img) => (img.getAttribute('style') || '').includes('object-fit'));
    const nav = document.querySelector('.editor-v2-gallery-nav-next');
    const dots = document.querySelectorAll('.editor-v2-gallery-dot');
    const caption = document.querySelector('.editor-v2-gallery-caption');
    return { slideImgCount: imgs.length, hasNav: !!nav, dotCount: dots.length, captionText: caption ? caption.textContent : null };
  });
  console.log('   galleryCheck:', JSON.stringify(galleryCheck));
  if (galleryCheck.slideImgCount !== 3) throw new Error('Se esperaban 3 <img> del slideshow, se encontraron: ' + galleryCheck.slideImgCount);
  if (!galleryCheck.hasNav) throw new Error('No se encontraron los controles prev/next del slideshow');
  if (galleryCheck.dotCount !== 3) throw new Error('Se esperaban 3 dots de navegación, se encontraron: ' + galleryCheck.dotCount);
  if (!galleryCheck.captionText || !galleryCheck.captionText.includes('Playa al atardecer')) throw new Error('La leyenda de la imagen activa no se muestra: ' + galleryCheck.captionText);
  console.log('   OK: slideshow real presente con controles, dots y leyenda');

  console.log('11) verificar que la imagen activa rota tras esperar el autoplay (duracion=1s)');
  const firstActiveSrc = await viewerPage.evaluate(() => {
    const active = Array.from(document.querySelectorAll('img')).find((img) => img.style.opacity === '1');
    return active ? active.src : null;
  });
  await viewerPage.waitForTimeout(1800);
  const secondActiveSrc = await viewerPage.evaluate(() => {
    const active = Array.from(document.querySelectorAll('img')).find((img) => img.style.opacity === '1');
    return active ? active.src : null;
  });
  if (firstActiveSrc === secondActiveSrc) throw new Error('La imagen activa del slideshow no rotó tras el intervalo de autoplay (1s)');
  console.log('   OK: autoplay rota la imagen activa');

  const allErrors = consoleErrors;
  if (allErrors.length > 0) {
    console.log('\n=== Errores de consola detectados (no tolerados) ===');
    allErrors.forEach((e) => console.log(' -', e));
    throw new Error('Se detectaron errores de consola inesperados.');
  }

  console.log('\nOK -- Lote UX-9 (embed real con miniatura en el visor) y Lote UX-10 (galería tipo slideshow real + modal de propiedades) verificados correctamente.');
  await browser.close();
})().catch(async (err) => {
  console.error('FALLO:', err.message || err);
  process.exit(1);
});
