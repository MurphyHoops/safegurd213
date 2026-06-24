const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  
  // Set localStorage items before page loads
  await page.addInitScript(() => {
    window.localStorage.setItem('SCANNER_VISIBLE', 'true');
    window.localStorage.setItem('SCANNER_GLOBAL_MODE', '"BACKTEST"');
  });

  page.on('console', msg => console.log('BROWSER CONSOLE:', msg.text()));
  page.on('pageerror', err => console.error('BROWSER ERROR:', err.message));
  await page.goto('http://localhost:3000');
  await page.waitForTimeout(10000);
  await browser.close();
})();
