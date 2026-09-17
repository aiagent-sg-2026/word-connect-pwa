import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const base = process.env.SMOKE_URL || 'http://127.0.0.1:4173/word-connect-pwa/';
const url = new URL(base.endsWith('/') ? base : `${base}/`);
const previewPort = Number(process.env.SMOKE_PORT || url.port || 4173);
const errors = [];

function startPreview() {
  if (process.env.SMOKE_EXTERNAL_URL === '1') return undefined;
  const viteBin = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url));
  const child = spawn(process.execPath, [viteBin, 'preview', '--host', '127.0.0.1', '--port', String(previewPort), '--strictPort'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
    env: { ...process.env }
  });
  child.stdout.on('data', chunk => process.stdout.write(chunk));
  child.stderr.on('data', chunk => process.stderr.write(chunk));
  child.stopping = false;
  child.on('exit', code => { if (!child.stopping && code && code !== 0) errors.push(`vite preview exited with ${code}`); });
  return child;
}

async function waitForPreview() {
  const deadline = Date.now() + 20_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok && (await response.text()).includes('Word Connect')) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) { lastError = error; }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`production preview did not become ready at ${url.href}: ${lastError?.message || lastError}`);
}

function collectPageErrors(page, label) {
  page.on('console', msg => { if (msg.type() === 'error') errors.push(`${label}: console: ${msg.text()}`); });
  page.on('pageerror', err => errors.push(`${label}: pageerror: ${err.message}`));
  page.on('requestfailed', req => {
    const failure = req.failure()?.errorText || 'request failed';
    if (!failure.includes('net::ERR_INTERNET_DISCONNECTED')) errors.push(`${label}: ${req.url()} ${failure}`);
  });
}

async function clearGameState(page) {
  await page.evaluate(async () => {
    await indexedDB.deleteDatabase('word-connect-db');
    const registrations = await navigator.serviceWorker?.getRegistrations?.() || [];
    await Promise.all(registrations.map(reg => reg.unregister()));
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith('wordgame-')).map(key => caches.delete(key)));
  });
}

let preview;
let browser;
try {
  preview = startPreview();
  await waitForPreview();
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ serviceWorkers: 'allow' });
  const sizes = [[390,844],[834,1112],[1280,900],[1440,900],[320,700]];

  for (const [width,height] of sizes) {
    const page = await context.newPage();
    collectPageErrors(page, `${width}x${height}`);
    await page.setViewportSize({ width, height });
    await page.goto(url.href, { waitUntil:'networkidle' });
    if (new URL(page.url()).pathname !== url.pathname) errors.push(`${width}x${height}: expected subpath ${url.pathname}, got ${page.url()}`);
    if (width === 390) await clearGameState(page);
    if (width === 390) await page.goto(url.href, { waitUntil:'networkidle' });
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
      if (!text.includes('Great!') || !text.includes('🪙 23')) errors.push('tap gameplay failed');
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
        if (!text.includes('Level complete') || !text.includes('🪙 36')) errors.push('pointer swipe gameplay failed');
      } else errors.push('pointer swipe tile boxes missing');
    }
    await page.close();
  }

  const page = await context.newPage();
  collectPageErrors(page, 'offline');
  await page.goto(url.href, { waitUntil:'networkidle' });
  await page.waitForSelector('.tile');
  const sw = await page.evaluate(async expectedPath => {
    const reg = await navigator.serviceWorker.ready;
    return { supported: 'serviceWorker' in navigator, scope: reg.scope, scriptURL: reg.active?.scriptURL || reg.waiting?.scriptURL || reg.installing?.scriptURL || '', controlled: !!navigator.serviceWorker.controller, expectedPath };
  }, url.pathname);
  if (!sw.supported) errors.push('service worker unavailable');
  if (!new URL(sw.scope).pathname.endsWith(url.pathname)) errors.push(`service worker scope ${sw.scope} does not match ${url.pathname}`);
  if (!new URL(sw.scriptURL).pathname.endsWith(`${url.pathname}sw.js`)) errors.push(`service worker script ${sw.scriptURL} does not match subpath sw.js`);
  await page.reload({ waitUntil:'networkidle' });
  if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) errors.push('page not controlled by service worker after reload');
  const client = await context.newCDPSession(page);
  await client.send('Network.clearBrowserCache');
  await context.setOffline(true);
  await page.reload({ waitUntil:'networkidle' });
  await page.waitForSelector('.tile');
  if (new URL(page.url()).pathname !== url.pathname) errors.push(`offline reload left subpath: ${page.url()}`);
  await context.setOffline(false);
  await page.close();

  const a = await context.newPage();
  const b = await context.newPage();
  collectPageErrors(a, 'multi-a');
  collectPageErrors(b, 'multi-b');
  await Promise.all([a.goto(url.href, { waitUntil:'networkidle' }), b.goto(url.href, { waitUntil:'networkidle' })]);
  await Promise.all([a.waitForSelector('.tile'), b.waitForSelector('.tile')]);
  if (!(await a.evaluate(() => 'serviceWorker' in navigator)) || !(await b.evaluate(() => 'serviceWorker' in navigator))) errors.push('multi-client sw unavailable');
  await Promise.all([a.close(), b.close()]);
} finally {
  await browser?.close();
  if (preview?.pid) {
    preview.stopping = true;
    try { process.kill(-preview.pid, 'SIGTERM'); } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
    try { process.kill(-preview.pid, 'SIGKILL'); } catch {}
  }
}

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log(`Smoke passed at ${url.href}: production preview, repository subpath, responsive viewports, tap + pointer swipe gameplay, no console/page errors, service worker registration/scope, warm offline reload after HTTP cache clear, two-page SW presence.`);
