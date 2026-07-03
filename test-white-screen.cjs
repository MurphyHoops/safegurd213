const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('console', msg => console.log('BROWSER CONSOLE:', msg.text()));
  page.on('pageerror', err => console.error('BROWSER ERROR:', err.message));
  await page.goto('http://localhost:3000');
  console.log('Waiting for 5 seconds to check for panic or white screen...');
  await page.waitForTimeout(5000);
  const panicUiExists = await page.evaluate(() => !!document.getElementById('panic-ui'));
  const rootHtmlLength = await page.evaluate(() => document.getElementById('root') ? document.getElementById('root').innerHTML.trim().length : -1);
  const bodyHtml = await page.evaluate(() => document.body.innerHTML);
  console.log(`DIAGNOSTIC RESULT: panicUiExists = ${panicUiExists}, rootHtmlLength = ${rootHtmlLength}`);
  if (panicUiExists) {
    console.log('PANIC UI HTML DETECTED!');
    const diagnosticText = await page.evaluate(() => {
      const el = document.getElementById('panic-ui');
      return el ? el.innerText : '';
    });
    console.log('DIAGNOSTIC TEXT:', diagnosticText);
  }
  await browser.close();
})();
