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
    let text = await page.locator('body').innerText();
    if (!text.includes('Great!') || !text.includes('🪙 30')) errors.push('tap gameplay failed');
    await page.getByRole('button', { name:'Clear' }).click();
    const centers = [];
    for (const letter of ['A','C','T']) centers.push(await page.getByRole('button', { name: letter, exact: true }).boundingBox());
    if (centers.every(Boolean)) {
      await page.mouse.move(centers[0].x + centers[0].width/2, centers[0].y + centers[0].height/2);
      await page.mouse.down();
      for (const b of centers.slice(1)) await page.mouse.move(b.x + b.width/2, b.y + b.height/2, { steps: 8 });
      await page.mouse.up();
      await page.waitForTimeout(150);
      text = await page.locator('body').innerText();
      if (!text.includes('Level complete') || !text.includes('🪙 55')) errors.push('pointer swipe gameplay failed');
    } else errors.push('pointer swipe tile boxes missing');
  }
  await page.close();
}
const page = await browser.newPage();
await page.goto(base, { waitUntil:'networkidle' });
await page.waitForFunction(() => navigator.serviceWorker?.controller || navigator.serviceWorker?.ready);
await page.waitForSelector('.tile');
const client = await page.context().newCDPSession(page);
await client.send('Network.clearBrowserCache');
await page.context().setOffline(true);
await page.reload({ waitUntil:'networkidle' });
await page.waitForSelector('.tile');
await page.context().setOffline(false);

const a = await browser.newPage();
const b = await browser.newPage();
await Promise.all([a.goto(base, { waitUntil:'networkidle' }), b.goto(base, { waitUntil:'networkidle' })]);
await Promise.all([a.waitForSelector('.tile'), b.waitForSelector('.tile')]);
if (!(await a.evaluate(() => 'serviceWorker' in navigator)) || !(await b.evaluate(() => 'serviceWorker' in navigator))) errors.push('multi-client sw unavailable');
await Promise.all([a.close(), b.close()]);
await browser.close();
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('Smoke passed: responsive viewports, tap + pointer swipe gameplay, warm offline reload after HTTP cache clear, two-page SW presence.');
