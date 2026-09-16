import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from 'playwright';

const port = 4175;
const base = `http://127.0.0.1:${port}/word-connect-pwa/`;
const vite = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url));
const preview = spawn(process.execPath, [vite, 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { stdio: 'ignore' });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function ready() { for (let i = 0; i < 80; i++) { try { if ((await fetch(base)).ok) return; } catch {} await wait(100); } throw new Error('preview did not start'); }
async function playWord(page, word) { for (const letter of word) await page.getByRole('button', { name: letter, exact: true }).click(); await page.getByRole('button', { name: 'Submit' }).click(); await page.waitForTimeout(40); }
async function settle(page) { await page.waitForFunction(() => !!document.querySelector('.tile') && !document.querySelector('.sheet')); }
try {
  await ready();
  for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
    const browser = await engine.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 320, height: 568 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(base, { waitUntil: 'networkidle' }); await settle(page);
    await page.getByRole('button', { name: 'Open settings' }).click();
    for (const [id, expected] of [['sound','false'], ['haptics','false'], ['reducedMotion','true']]) {
      await page.locator(`#setting-${id}`).click();
      await page.waitForFunction(([selector, checked]) => document.querySelector(selector)?.getAttribute('aria-checked') === checked, [`#setting-${id}`, expected]);
    }
    if (await page.locator('#setting-sound[aria-checked="false"]').count() !== 1 || await page.locator('#setting-haptics[aria-checked="false"]').count() !== 1 || await page.locator('#setting-reducedMotion[aria-checked="true"]').count() !== 1) throw new Error(`${name}: settings did not toggle`);
    if (await page.evaluate(() => document.documentElement.dataset.reducedMotion) !== 'true') throw new Error(`${name}: reduced motion hook missing`);
    const reducedTransition = await page.locator('.tile').first().evaluate(el => getComputedStyle(el).transitionDuration);
    if (reducedTransition !== '0s') throw new Error(`${name}: reduced motion did not suppress tile transition (${reducedTransition})`);
    await page.locator('.sheet-close').click(); await settle(page); await page.reload({ waitUntil: 'networkidle' }); await settle(page);
    await page.getByRole('button', { name: 'Open settings' }).click();
    if (await page.locator('#setting-sound[aria-checked="false"]').count() !== 1 || await page.locator('#setting-haptics[aria-checked="false"]').count() !== 1 || await page.locator('#setting-reducedMotion[aria-checked="true"]').count() !== 1) throw new Error(`${name}: settings did not persist after reload`);
    await page.locator('#setting-reducedMotion').click();
    await page.waitForFunction(() => document.documentElement.dataset.reducedMotion === 'false');
    const normalTransition = await page.locator('.tile').first().evaluate(el => getComputedStyle(el).transitionDuration);
    if (normalTransition === '0s') throw new Error(`${name}: motion did not restore after toggle`);
    await page.locator('.sheet-close').click(); await settle(page);
    await page.getByRole('button', { name: 'Shuffle' }).click();
    if (await page.locator('.app-shell[data-feedback="shuffle"]').count() !== 1) throw new Error(`${name}: shuffle marker missing`);
    await playWord(page, 'CAT'); if (await page.locator('.app-shell[data-feedback="target"]').count() !== 1) throw new Error(`${name}: target marker missing`);
    const progressAnimation = await page.locator('.progress > div').evaluate(el => getComputedStyle(el).animationName);
    if (!progressAnimation.includes('progress-pop')) throw new Error(`${name}: progress feedback missing (${progressAnimation})`);
    await playWord(page, 'CAT'); if (await page.locator('.app-shell[data-feedback="already-found"]').count() !== 1) throw new Error(`${name}: already-found marker missing`);
    await playWord(page, 'C'); if (await page.locator('.app-shell[data-feedback="invalid"]').count() !== 1) throw new Error(`${name}: invalid marker missing`);
    await playWord(page, 'AT'); if (await page.locator('.app-shell[data-feedback="bonus"]').count() !== 1) throw new Error(`${name}: bonus marker missing`);
    await playWord(page, 'ACT'); if (await page.locator('[data-celebration="true"]').count() !== 1) throw new Error(`${name}: celebration marker missing`);
    if (await page.locator('#next').count() !== 1 || await page.locator('#next').evaluate(el => el.getBoundingClientRect().height < 44)) throw new Error(`${name}: next level unavailable`);
    await page.reload({ waitUntil: 'networkidle' }); await settle(page);
    if (await page.locator('[data-celebration="true"]').count() !== 0) throw new Error(`${name}: celebration replayed after reload`);
    await page.getByRole('button', { name: 'Hint' }).click(); if (await page.locator('.hint-choice').count() !== 3) throw new Error(`${name}: hint unavailable`); await page.locator('.sheet-close').click();
    await page.getByRole('button', { name: 'Open settings' }).click(); if (await page.locator('#export').count() !== 1) throw new Error(`${name}: settings unavailable`);
    const scroll = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.scrollHeight, innerWidth, innerHeight]);
    if (scroll[0] > scroll[2] || scroll[1] > scroll[3] || errors.length) throw new Error(`${name}: scroll/errors ${JSON.stringify({ scroll, errors })}`);
    console.log(`v1.1 ${name}: PASS`); await browser.close();
  }
} finally { preview.kill('SIGTERM'); }
