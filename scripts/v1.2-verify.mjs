import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from 'playwright';

const port = 4176;
const base = `http://127.0.0.1:${port}/word-connect-pwa/`;
const vite = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url));
const preview = spawn(process.execPath, [vite, 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { stdio: 'ignore' });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function ready() { for (let i = 0; i < 80; i++) { try { if ((await fetch(base)).ok) return; } catch {} await wait(100); } throw new Error('preview did not start'); }
async function settle(page) { await page.waitForFunction(() => !!document.querySelector('.tile') && !document.querySelector('.sheet')); }
async function word(page, value) { for (const letter of value) await page.getByRole('button', { name: letter, exact: true }).click(); await page.getByRole('button', { name: 'Submit' }).click(); await page.waitForTimeout(80); }
async function noScroll(page, name) { const result = await page.evaluate(() => ({ w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight, iw: innerWidth, ih: innerHeight })); if (result.w > result.iw || result.h > result.ih) throw new Error(`${name}: scroll ${JSON.stringify(result)}`); }

try {
  await ready();
  for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
    const browser = await engine.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 320, height: 568 }, isMobile: true, hasTouch: true });
    const page = await context.newPage(); const errors = [];
    page.on('pageerror', error => errors.push(error.message)); page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(base, { waitUntil: 'networkidle' }); await settle(page); await noScroll(page, name);
    await page.getByRole('button', { name: 'Open settings' }).click();
    if (await page.getByRole('button', { name: 'Player Stats' }).count() !== 1) throw new Error(`${name}: stats entry missing`);
    await page.getByRole('button', { name: 'Player Stats' }).click();
    if (await page.getByRole('heading', { name: 'Player Stats' }).count() !== 1 || await page.locator('.stats-row').count() !== 7) throw new Error(`${name}: stats sheet incomplete`);
    if (await page.locator('.stats-row').evaluateAll(rows => rows.some(row => row.getBoundingClientRect().height < 44))) throw new Error(`${name}: stats control too small`);
    await page.locator('.sheet-close').click(); await settle(page);
    await word(page, 'CAT');
    if (await page.locator('.candidate').textContent().then(text => !text.includes('Great!'))) throw new Error(`${name}: target result missing`);
    if (await page.getByRole('status').count() !== 1 || !(await page.getByRole('status').textContent()).includes('First target')) throw new Error(`${name}: achievement unlock toast missing`);
    if (await page.locator('.achievement-toast-medal').count() !== 1 || await page.locator('.achievement-toast-eyebrow').textContent() !== 'Achievement unlocked') throw new Error(`${name}: achievement unlock presentation incomplete`);
    await word(page, 'AT');
    if (await page.locator('.candidate').textContent().then(text => !text.includes('Combo ×2'))) throw new Error(`${name}: combo feedback missing`);
    await page.reload({ waitUntil: 'networkidle' }); await settle(page);
    await page.getByRole('button', { name: 'Open settings' }).click(); await page.getByRole('button', { name: 'Player Stats' }).click();
    const statsText = await page.locator('.stats-list').textContent();
    if (!statsText.includes('Submissions') || !statsText.includes('2') || !statsText.includes('Best combo')) throw new Error(`${name}: stats did not persist`);
    await page.locator('.sheet-close').click(); await settle(page); await page.getByRole('button', { name: 'Hint' }).click(); await page.locator('[data-hint-kind="letter"]').click(); await page.waitForTimeout(60);
    await page.getByRole('button', { name: 'Open settings' }).click(); await page.getByRole('button', { name: 'Player Stats' }).click();
    if (!(await page.locator('.stats-list').textContent()).includes('Coins spent')) throw new Error(`${name}: hint spend stat missing`);
    await page.locator('.sheet-close').click(); await settle(page);
    await page.getByRole('button', { name: 'Open settings' }).click(); await page.locator('#setting-reducedMotion').click(); await page.locator('.sheet-close').click(); await settle(page); await word(page, 'ACT');
    const reducedToastMotion = await page.locator('.achievement-toast').evaluate(el => getComputedStyle(el).animationName);
    if (reducedToastMotion !== 'none') throw new Error(`${name}: achievement toast ignored reduced motion`);
    if (await page.locator('[data-celebration="true"]').count() !== 1 || !(await page.locator('.complete').textContent()).includes('Best combo')) throw new Error(`${name}: completion summary missing`);
    await page.getByRole('button', { name: 'Open settings' }).click();
    await page.getByRole('button', { name: 'Achievements' }).first().click();
    await page.getByRole('heading', { name: 'Achievements' }).waitFor();
    if (await page.locator('.achievement-row.unlocked').count() < 1) throw new Error(`${name}: achievement UI did not show unlock`);
    await page.locator('.sheet-close').click(); await settle(page);
    await page.getByRole('button', { name: 'Open settings' }).click();
    const exportPromise = page.waitForEvent('download'); await page.locator('#export').click(); const download = await exportPromise; const savePath = await download.path();
    if (!savePath) throw new Error(`${name}: save export missing`);
    page.once('dialog', dialog => dialog.accept()); await page.locator('#reset').click();
    await page.waitForTimeout(120); await page.getByRole('button', { name: 'Open settings' }).click(); await page.setInputFiles('#import', savePath); await page.waitForTimeout(160); await settle(page); await page.getByRole('button', { name: 'Open settings' }).click(); await page.getByRole('button', { name: 'Player Stats' }).click();
    if (!(await page.locator('.stats-list').textContent()).includes('Best combo')) throw new Error(`${name}: imported stats missing`);
    await page.locator('.sheet-close').click(); await settle(page); await page.getByRole('button', { name: 'Open settings' }).click(); await page.getByRole('button', { name: 'Achievements' }).first().click();
    await page.getByRole('heading', { name: 'Achievements' }).waitFor();
    if (await page.locator('.achievement-row.unlocked').count() < 1) throw new Error(`${name}: imported achievements missing`);
    await noScroll(page, name); if (errors.length) throw new Error(`${name}: browser errors ${JSON.stringify(errors)}`);
    console.log(`v1.2 ${name}: PASS`); await browser.close();
  }
} finally { preview.kill('SIGTERM'); }
