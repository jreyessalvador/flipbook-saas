const { chromium } = require('playwright');

(async () => {
  console.log('--- Verificando Landing Page y Reader Público (sin autenticación) ---');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const baseUrl = process.env.TEST_URL || 'http://100.71.185.7:5173';

  // 1. Acceder a la Landing Page pública
  console.log(`Navegando a la raíz pública: ${baseUrl}`);
  await page.goto(baseUrl, { waitUntil: 'networkidle' });

  // Verificar título principal
  const heroTitle = await page.textContent('h1');
  console.log(`Título de Hero encontrado: "${heroTitle.trim()}"`);
  if (!heroTitle.includes('Transforma tus documentos')) {
    throw new Error('El título de Hero no coincide.');
  }

  // 2. Verificar que exista el botón "Acceso Clientes"
  const loginBtn = await page.locator('button:has-text("Acceso Clientes")');
  if (await loginBtn.count() === 0) {
    throw new Error('No se encontró el botón de Acceso Clientes.');
  }
  console.log('✓ Botón Acceso Clientes verificado.');

  // 3. Abrir Modal de Login
  await loginBtn.click();
  const modalHeader = await page.locator('h2:has-text("Acceso a Plataforma")');
  if (await modalHeader.count() === 0) {
    throw new Error('No se abrió el modal de inicio de sesión.');
  }
  console.log('✓ Modal de inicio de sesión B2B verificado.');

  // 4. Cerrar Modal
  await page.click('button:has-text("✕")');

  // 5. Verificar catálogo / showcase de publicaciones
  const showcaseHeading = await page.locator('h2:has-text("Publicaciones Destacadas")');
  if (await showcaseHeading.count() === 0) {
    throw new Error('Sección de Showcase no encontrada.');
  }
  console.log('✓ Sección de Showcase verificada.');

  console.log('--- ¡TODAS LAS VERIFICACIONES PÚBLICAS PASARON CON ÉXITO! ---');
  await browser.close();
})();
