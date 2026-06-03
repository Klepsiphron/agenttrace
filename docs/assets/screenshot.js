const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1280, height: 640 });

  const htmlPath = path.resolve('/home/ryano/projects/agenttrace/docs/assets/social-preview.html');
  await page.goto('file://' + htmlPath);
  await page.waitForTimeout(1000);

  const outputPath = '/home/ryano/projects/agenttrace/docs/assets/social-preview.png';
  await page.screenshot({ path: outputPath, type: 'png' });

  console.log('Screenshot saved to:', outputPath);
  await browser.close();
})();
