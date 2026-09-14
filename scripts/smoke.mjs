import { chromium } from 'playwright';
const base = process.env.SMOKE_URL || 'http://127.0.0.1:4173';
const browser = await chromium.launch({ headless: true });
const sizes = [[390,844],[834,1112],[1280,900],[1440,900],[320,700]];
const errors = [];
for (const [width,height] of sizes) {
  const page = await browser.newPage({ viewport:{width,height} });
  page.on('console', msg => { if (msg.type() === 'error') errors.push(`${width}x${height}: ${msg.text()}`); });
  page.on('pageerror', err => errors.push(`${width}x${height}: ${err.message}`));
  await page.goto(base, { waitUntil:'networkidle' });
  await page.waitForSelector('.tile');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  if (overflow) errors.push(`${width}x${height}: horizontal overflow`);
  if (width === 390) {
    await page.getByRole('button', { name:'C', exact:true }).click();
    await page.getByRole('button', { name:'A', exact:true }).click();
    await page.getByRole('button', { name:'T', exact:true }).click();
    await page.getByRole('button', { name:'Submit' }).click();
    await page.waitForTimeout(100);
    const text = await page.locator('body').innerText();
    if (!text.includes('Great!') || !text.includes('🪙 30')) errors.push('tap gameplay failed');
  }
  await page.close();
}
const page = await browser.newPage();
await page.goto(base, { waitUntil:'networkidle' });
await page.waitForFunction(() => navigator.serviceWorker?.controller || navigator.serviceWorker?.ready);
await page.context().setOffline(true);
await page.reload({ waitUntil:'networkidle' });
await page.waitForSelector('.tile');
await page.context().setOffline(false);
await browser.close();
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('Smoke passed: responsive viewports, tap gameplay, warm offline reload.');
