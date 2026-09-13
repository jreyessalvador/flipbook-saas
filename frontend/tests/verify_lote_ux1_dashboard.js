// Verificacion Playwright del Lote UX-1: Dashboard con datos reales
// (antes mostraba Publicaciones/Visitas/Almacenamiento fijos en 0).
const { chromium } = require('playwright');

const BASE = process.env.BASE_URL || 'http://100.71.185.7:5173';
const API = process.env.API_URL || 'http://100.71.185.7:8010';
const EMAIL = process.env.TEST_EMAIL || 'admin@flipbook.app';
const PASSWORD = process.env.TEST_PASSWORD || 'admin123';

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

  console.log('2) obtener el numero real de publicaciones directo de la API para comparar');
  const token = await page.evaluate(() => localStorage.getItem('token'));
  const apiStats = await page.evaluate(async ({ tok, api }) => {
    const r = await fetch(`${api}/api/publications/stats/summary`, { headers: { Authorization: `Bearer ${tok}` } });
    return r.json();
  }, { tok: token, api: API });
  console.log('   API dice:', JSON.stringify(apiStats));
  if (apiStats.total_publications <= 0) throw new Error('Se esperaba al menos 1 publicacion real en el tenant de prueba');

  console.log('3) esperar a que el Dashboard deje de mostrar el placeholder de carga y compare con la API');
  await page.waitForFunction(() => {
    const cards = document.querySelectorAll('.stat-card .value');
    return cards.length === 4 && cards[0].textContent.trim() !== '...' && cards[0].textContent.trim() !== '…';
  }, { timeout: 10000 });

  const cardValues = await page.$$eval('.stat-card .value', (els) => els.map((e) => e.textContent.trim()));
  console.log('   Dashboard muestra:', JSON.stringify(cardValues));

  if (cardValues[0] === '0') throw new Error(`El Dashboard sigue mostrando 0 publicaciones fijas pese a que la API reporta ${apiStats.total_publications}`);
  if (Number(cardValues[0]) !== apiStats.total_publications) {
    throw new Error(`Publicaciones del Dashboard (${cardValues[0]}) no coincide con la API (${apiStats.total_publications})`);
  }
  console.log('   OK: la tarjeta de Publicaciones coincide con la API:', cardValues[0]);

  if (cardValues[2] === '0 MB' && apiStats.storage_bytes > 0) {
    throw new Error(`El Dashboard sigue mostrando 0 MB pese a que hay ${apiStats.storage_bytes} bytes reales`);
  }
  console.log('   OK: la tarjeta de Almacenamiento ya no esta fija en 0 MB:', cardValues[2]);

  if (consoleErrors.length > 0) {
    console.log('\n=== Errores de consola detectados (no tolerados) ===');
    consoleErrors.forEach((e) => console.log(' -', e));
    throw new Error('Se detectaron errores de consola inesperados.');
  }

  console.log('\nOK -- el Dashboard del Lote UX-1 muestra datos reales, sin errores de consola.');
  await browser.close();
})().catch(async (err) => {
  console.error('FALLO:', err.message || err);
  process.exit(1);
});
