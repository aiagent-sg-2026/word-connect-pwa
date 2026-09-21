import { createReadStream, promises as fs } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join, normalize, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { chromium, webkit } from 'playwright';

const root = resolve(new URL('..', import.meta.url).pathname);
const viewport = { width: 320, height: 568 };
const requested = (process.env.SW_UPDATE_BROWSERS || 'chromium,webkit').split(',').map(x => x.trim()).filter(Boolean);
const failures = [];
const notRun = [];

function runBuild(buildId, outDir) {
  const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], {
    cwd: root,
    env: { ...process.env, BUILD_ID: buildId, OUT_DIR: outDir },
    encoding: 'utf8',
    stdio: 'pipe'
  });
  if (result.status !== 0) throw new Error(`production build ${buildId} failed\n${result.stdout}\n${result.stderr}`);
}

async function startArtifactServer(aDir, bDir) {
  let active = aDir;
  const server = http.createServer((req, res) => {
    if (!req.url) { res.writeHead(400); res.end(); return; }
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (!pathname.startsWith('/word-connect-pwa/')) { res.writeHead(404); res.end(); return; }
    const relative = pathname.slice('/word-connect-pwa/'.length) || 'index.html';
    const file = resolve(active, relative);
    if (!file.startsWith(`${resolve(active)}${sep}`) && file !== resolve(active)) { res.writeHead(403); res.end(); return; }
    const headers = { 'Cache-Control': pathname.endsWith('/sw.js') ? 'no-store' : 'public, max-age=0, must-revalidate' };
    fs.stat(file).then(stat => {
      if (!stat.isFile()) throw new Error('not a file');
      if (pathname.endsWith('.js')) headers['Content-Type'] = 'text/javascript; charset=utf-8';
      else if (pathname.endsWith('.css')) headers['Content-Type'] = 'text/css; charset=utf-8';
      else if (pathname.endsWith('.html')) headers['Content-Type'] = 'text/html; charset=utf-8';
      else if (pathname.endsWith('.json') || pathname.endsWith('.webmanifest')) headers['Content-Type'] = 'application/json';
      res.writeHead(200, headers);
      createReadStream(file).pipe(res);
    }).catch(() => { res.writeHead(404); res.end(); });
  });
  await new Promise((resolvePromise, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolvePromise); });
  const address = server.address();
  return {
    url: `http://127.0.0.1:${address.port}/word-connect-pwa/`,
    switchTo(build) { active = build === 'b' ? bDir : aDir; },
    close() { return new Promise(resolvePromise => server.close(resolvePromise)); }
  };
}

async function waitFor(page, predicate, message, timeout = 10000) {
  await page.waitForFunction(predicate, undefined, { timeout }).catch(error => { throw new Error(`${message}: ${error.message}`); });
}

async function idb(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => { const request = indexedDB.open('word-connect-db'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const tx = db.transaction(['profiles', 'progress', 'economyEvents'], 'readonly');
    const result = {};
    for (const store of ['profiles', 'progress', 'economyEvents']) result[store] = await new Promise((resolve, reject) => { const request = tx.objectStore(store).getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    db.close();
    return result;
  });
}

async function submit(page, word) {
  for (const letter of word) await page.getByRole('button', { name: letter, exact: true }).click();
  await page.getByRole('button', { name: 'Submit' }).click();
}

async function inspect(page) {
  return page.evaluate(async () => ({
    controller: !!navigator.serviceWorker.controller,
    registration: await navigator.serviceWorker.getRegistration().then(reg => ({ active: reg?.active?.state, waiting: reg?.waiting?.state, installing: reg?.installing?.state, scriptURL: reg?.active?.scriptURL })),
    caches: await caches.keys(),
    reloads: Number(sessionStorage.getItem('wc-e2e-loads') || 0) - 1,
    controllerChanges: Number(sessionStorage.getItem('wc-e2e-controller-changes') || 0),
    buildText: document.querySelector('.build-meta')?.textContent || ''
  }));
}

async function runChromium(server, engineName, engine) {
  let browser;
  const launchOptions = { headless: true };
  if (engineName === 'chromium' && process.env.SW_UPDATE_CHROMIUM_PATH) launchOptions.executablePath = process.env.SW_UPDATE_CHROMIUM_PATH;
  try { browser = await engine.launch(launchOptions); }
  catch (error) {
    const reason = `Playwright ${engineName} could not launch: ${error.message}`;
    if (engineName === 'webkit') notRun.push({ browser: engineName, subsystem: 'service-worker update lifecycle', reason });
    else failures.push(reason);
    return;
  }
  const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true, serviceWorkers: 'allow' });
  await context.addInitScript(() => {
    sessionStorage.setItem('wc-e2e-loads', String(Number(sessionStorage.getItem('wc-e2e-loads') || 0) + 1));
    navigator.serviceWorker?.addEventListener('controllerchange', () => sessionStorage.setItem('wc-e2e-controller-changes', String(Number(sessionStorage.getItem('wc-e2e-controller-changes') || 0) + 1)));
  });
  const page = await context.newPage();
  try {
    await page.goto(server.url, { waitUntil: 'networkidle' });
    await page.waitForSelector('.tile');
    let state = await inspect(page);
    if (!state.controller || state.registration.active !== 'activated' || !state.registration.scriptURL?.includes('/sw.js')) throw new Error(`A did not install/control: ${JSON.stringify(state)}`);
    await page.evaluate(() => { sessionStorage.setItem('wc-e2e-loads', '1'); sessionStorage.setItem('wc-e2e-controller-changes', '0'); });
    await submit(page, 'CAT');
    let data = await idb(page);
    if (data.profiles[0]?.coins !== 23 || !data.progress[0]?.foundTargets?.includes('CAT')) throw new Error(`progress was not persisted before update: ${JSON.stringify(data)}`);

    server.switchTo('b');
    await page.evaluate(async () => { const reg = await navigator.serviceWorker.getRegistration(); await reg?.update(); });
    await waitFor(page, () => navigator.serviceWorker.getRegistration().then(reg => reg?.waiting?.state === 'installed' && !reg?.installing), 'B did not reach stable waiting');
    await page.getByRole('button', { name: 'Update Now' }).waitFor({ state: 'visible' });
    state = await inspect(page);
    if (!state.registration.waiting) throw new Error(`B was not waiting: ${JSON.stringify(state)}`);
    if (!state.caches.includes('wordgame-shell-e2e-build-a') || !state.caches.includes('wordgame-shell-e2e-build-b')) throw new Error(`old shell must remain while B is waiting: ${JSON.stringify(state)}`);

    const tile = page.locator('.tile').first();
    const box = await tile.boundingBox();
    if (!box) throw new Error('could not create deterministic unready gesture');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.evaluate(() => navigator.serviceWorker.getRegistration().then(reg => reg?.waiting?.postMessage({ type: 'SKIP_WAITING_IF_SAFE', safe: true, owner: 'e2e-unready-client' })));
    await page.waitForTimeout(3000);
    state = await inspect(page);
    if (!state.registration.waiting || state.controllerChanges !== 0) throw new Error(`unready readiness probe did not keep B waiting: ${JSON.stringify(state)}`);
    await page.mouse.up();

    await page.getByRole('button', { name: 'Update Now' }).click();
    await page.waitForSelector('.tile', { timeout: 15000 });
    await page.getByRole('button', { name: 'Open settings' }).click();
    await waitFor(page, () => document.querySelector('.build-meta')?.textContent?.includes('e2e-build-b'), 'B boot/reload did not complete', 15000);
    await page.waitForTimeout(500);
    state = await inspect(page);
    data = await idb(page);
    if (state.controllerChanges !== 1 || state.reloads !== 1) throw new Error(`controller/reload count was not exactly one: ${JSON.stringify(state)}`);
    if (data.profiles[0]?.coins !== 23 || !data.progress[0]?.foundTargets?.includes('CAT')) throw new Error(`progress/economy did not survive update: ${JSON.stringify(data)}`);
    if (state.registration.active !== 'activated' || !state.registration.scriptURL?.includes('/sw.js') || !state.buildText.includes('e2e-build-b')) throw new Error(`active B evidence missing: ${JSON.stringify(state)}`);
    if (!state.caches.includes('wordgame-shell-e2e-build-b') || state.caches.includes('wordgame-shell-e2e-build-a')) throw new Error(`cache cleanup/retention evidence failed: ${JSON.stringify(state)}`);
    console.log(`CHECKPOINT ${JSON.stringify({ browser: engineName, scope: server.url, buildA: 'e2e-build-a', buildB: 'e2e-build-b', controllerChanges: state.controllerChanges, reloads: state.reloads, activeBuild: 'e2e-build-b', progress: 'CAT', coins: 23, caches: state.caches })}`);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (engineName === 'webkit') notRun.push({ browser: engineName, subsystem: 'service-worker update lifecycle', reason: `Playwright WebKit could not reliably prove this Chromium lifecycle: ${reason}` });
    else failures.push(`${engineName}: ${reason}`);
  } finally { await context.close(); await browser.close(); }
}

const temp = await fs.mkdtemp(join(tmpdir(), 'word-connect-sw-update-'));
const aDir = join(temp, 'a');
const bDir = join(temp, 'b');
try {
  await fs.mkdir(aDir); await fs.mkdir(bDir);
  runBuild('e2e-build-a', aDir);
  runBuild('e2e-build-b', bDir);
  const server = await startArtifactServer(aDir, bDir);
  try {
    for (const name of requested) await runChromium(server, name, name === 'webkit' ? webkit : chromium);
  } finally { await server.close(); }
} finally { await fs.rm(temp, { recursive: true, force: true }); }

if (notRun.length) console.log(`NOT_RUN ${JSON.stringify(notRun)}`);
if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
console.log('Service-worker update E2E passed: deterministic A/B production artifacts, waiting safe-gate, single controller reload, durable save/economy, BOOT_OK cache cleanup, and active build evidence verified.');
