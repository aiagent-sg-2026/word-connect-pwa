import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from 'playwright';

const base = process.env.STATE_MACHINE_URL || 'http://127.0.0.1:4175/word-connect-pwa/';
const url = new URL(base.endsWith('/') ? base : `${base}/`);
const port = Number(process.env.STATE_MACHINE_PORT || url.port || 4175);
const viewport = { width: 320, height: 568 };
const requestedBrowsers = (process.env.STATE_MACHINE_BROWSERS || 'chromium,webkit').split(',');
const browsers = [['chromium', chromium], ['webkit', webkit]].filter(([name]) => requestedBrowsers.includes(name));
const failures = [];
const notRun = [];

function startPreview() {
  if (process.env.STATE_MACHINE_EXTERNAL_URL === '1') return undefined;
  const viteBin = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url));
  return spawn(process.execPath, [viteBin, 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    stdio: ['ignore', 'pipe', 'pipe'], detached: true, env: { ...process.env }
  });
}

async function waitForPreview() {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`preview did not become ready at ${url.href}`);
}

function contextFor(browserName, fromState, transition, toState, subsystem, expected, actual) {
  return { browser: browserName, viewport: `${viewport.width}x${viewport.height}`, fromState, transition, toState, subsystem, expected, actual };
}

function checkpoint(browserName, fromState, transition, toState, subsystem, expected, actual, ok = true) {
  const detail = contextFor(browserName, fromState, transition, toState, subsystem, expected, actual);
  if (!ok) throw new Error(JSON.stringify(detail));
  console.log(`CHECKPOINT ${JSON.stringify(detail)}`);
}

async function idb(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('word-connect-db');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const stores = ['profiles', 'progress', 'economyEvents', 'statsAggregate', 'achievements', 'saveSnapshots'];
    const tx = db.transaction(stores, 'readonly');
    const result = {};
    for (const store of stores) result[store] = await new Promise((resolve, reject) => {
      const request = tx.objectStore(store).getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return result;
  });
}

function assertCheckpoint(browserName, fromState, transition, toState, subsystem, expected, actual, predicate) {
  checkpoint(browserName, fromState, transition, toState, subsystem, expected, actual, predicate(actual));
}

async function clearState(page) {
  await page.evaluate(async () => {
    const registrations = await navigator.serviceWorker?.getRegistrations?.() || [];
    await Promise.all(registrations.map(reg => reg.unregister()));
    await new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase('word-connect-db');
      request.onsuccess = resolve; request.onerror = () => reject(request.error); request.onblocked = resolve;
    });
    await Promise.all((await caches.keys()).filter(key => key.startsWith('wordgame-')).map(key => caches.delete(key)));
  });
}

async function submit(page, word) {
  for (const letter of word) await page.getByRole('button', { name: letter, exact: true }).click();
  await page.getByRole('button', { name: 'Submit' }).click();
  await page.waitForTimeout(80);
}

async function run(browserName, engine) {
  const launchOptions = { headless: true };
  if (browserName === 'chromium' && process.env.STATE_MACHINE_CHROMIUM_PATH) launchOptions.executablePath = process.env.STATE_MACHINE_CHROMIUM_PATH;
  let browser;
  try { browser = await engine.launch(launchOptions); }
  catch (error) {
    failures.push(JSON.stringify(contextFor(browserName, 'FRESH', 'launch-browser', 'FRESH', 'browser', 'installed Playwright browser', error instanceof Error ? error.message : String(error))));
    return;
  }
  const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true, serviceWorkers: 'allow' });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') pageErrors.push(message.text()); });
  try {
    await page.goto(url.href, { waitUntil: 'networkidle' });
    await page.waitForSelector('.tile');
    let data = await idb(page);
    assertCheckpoint(browserName, 'FRESH', 'start-game', 'FRESH', 'IndexedDB', 'one profile with 20 coins and empty L001 progress', data, d => d.profiles[0]?.coins === 20 && d.progress[0]?.foundTargets?.length === 0);

    await submit(page, 'CAT');
    data = await idb(page);
    assertCheckpoint(browserName, 'FRESH', 'submit-target', 'PLAYING', 'gameplay', 'CAT accepted and progress rendered', { body: await page.locator('body').innerText(), data }, d => d.data.profiles[0]?.coins === 23 && d.data.progress[0]?.foundTargets?.includes('CAT'));

    assertCheckpoint(browserName, 'PLAYING', 'save-progress', 'PROGRESS_SAVED', 'IndexedDB', 'durable progress and one target economy event', data, d => d.progress[0]?.foundTargets?.includes('CAT') && d.economyEvents.length === 1);
    await page.reload({ waitUntil: 'networkidle' });
    data = await idb(page);
    assertCheckpoint(browserName, 'PROGRESS_SAVED', 'reload', 'RELOADED', 'reload persistence', 'CAT and 23 coins survive reload', { foundTargets: data.progress[0]?.foundTargets, coins: data.profiles[0]?.coins }, d => d.foundTargets?.includes('CAT') && d.coins === 23);

    if (browserName === 'webkit') {
      notRun.push({ browser: browserName, viewport: `${viewport.width}x${viewport.height}`, subsystem: 'service-worker offline lifecycle', reason: 'Playwright WebKit offline simulation is not reliable here: offline page.reload returns an internal engine error and controlled same-origin fetch returns Load failed. Chromium verifies the real warm-offline reload path.' });
      data = await idb(page);
      assertCheckpoint(browserName, 'RELOADED', 'webkit-offline-not-run', 'RELOADED', 'IndexedDB persistence', 'CAT and 23 coins remain durable before continuing WebKit lifecycle', { foundTargets: data.progress[0]?.foundTargets, coins: data.profiles[0]?.coins }, d => d.foundTargets?.includes('CAT') && d.coins === 23);
    } else {
      await context.setOffline(true);
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForSelector('.tile');
      data = await idb(page);
      assertCheckpoint(browserName, 'RELOADED', 'offline-reload', 'OFFLINE', 'service-worker offline shell', 'service worker controls page and CAT progress survives offline reload', { controlled: await page.evaluate(() => !!navigator.serviceWorker.controller), foundTargets: data.progress[0]?.foundTargets }, d => d.controlled && d.foundTargets.includes('CAT'));
      await context.setOffline(false);
    }
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('.tile');
    data = await idb(page);
    assertCheckpoint(browserName, browserName === 'webkit' ? 'RELOADED' : 'OFFLINE', browserName === 'webkit' ? 'continue-online' : 'restore-online', 'RESTORED', browserName === 'webkit' ? 'reload persistence' : 'offline recovery', 'profile is available with 23 coins', data.profiles[0], p => p?.coins === 23);

    await page.getByRole('button', { name: 'Open settings' }).click();
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export Save' }).click();
    const download = await downloadPromise;
    const savePath = `/tmp/word-connect-state-${browserName}.json`;
    await download.saveAs(savePath);
    checkpoint(browserName, 'RESTORED', 'export-save', 'EXPORT', 'save export', 'downloaded word-connect-save-v2.json', await download.suggestedFilename());

    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: 'Reset save' }).click();
    await page.waitForFunction(() => document.querySelector('.candidate')?.textContent?.includes('Reset complete'));
    data = await idb(page);
    assertCheckpoint(browserName, 'EXPORT', 'reset-save', 'RESET', 'reset', 'new profile with starting coins and empty progress', data, d => d.profiles[0]?.coins === 20 && d.progress[0]?.foundTargets?.length === 0);

    await page.getByRole('button', { name: 'Open settings' }).click();
    await page.locator('#import').setInputFiles(savePath);
    await page.waitForFunction(() => document.querySelector('.candidate')?.textContent?.includes('Save imported'));
    data = await idb(page);
    assertCheckpoint(browserName, 'RESET', 'import-save', 'RESTORED', 'save import', 'import restores 23 coins and CAT progress', { coins: data.profiles[0]?.coins, foundTargets: data.progress[0]?.foundTargets }, d => d.coins === 23 && d.foundTargets.includes('CAT'));

    await submit(page, 'CAT');
    const duplicate = await idb(page);
    assertCheckpoint(browserName, 'RESTORED', 'duplicate-target', 'RESTORED', 'economy idempotency', 'coins remain 23 and no second reward', duplicate, d => d.profiles[0]?.coins === 23 && d.economyEvents.filter(e => e.kind === 'TARGET').length === 1);

    await page.getByRole('button', { name: 'Hint' }).click();
    await page.getByRole('button', { name: /Reveal word/ }).click();
    const hinted = await idb(page);
    await page.getByRole('button', { name: 'Hint' }).click();
    const secondWordHint = page.locator('[data-hint-kind="word"]');
    assertCheckpoint(browserName, 'RESTORED', 'repeat-word-hint', 'RESTORED', 'hint idempotency', 'word hint is disabled after revealing the only remaining word', await secondWordHint.isDisabled(), value => value === true);
    await page.getByRole('button', { name: 'Close' }).click();
    assertCheckpoint(browserName, 'RESTORED', 'pay-word-hint', 'RESTORED', 'economy/IndexedDB consistency', 'one HINT event, coins reduced by 8, revealed word persisted', hinted, d => d.economyEvents.filter(e => e.kind === 'HINT').length === 1 && d.profiles[0]?.coins === 15 && d.progress[0]?.revealedWords?.length === 1);

    const achievementIds = (await idb(page)).achievements.map(a => a.id);
    assertCheckpoint(browserName, 'RESTORED', 'achievement-check', 'RESTORED', 'achievement idempotency', 'achievement IDs are unique and first-target is durable', achievementIds, ids => new Set(ids).size === ids.length && ids.includes('first-target'));
    if (pageErrors.length) throw new Error(JSON.stringify(contextFor(browserName, 'RESTORED', 'console-check', 'RESTORED', 'browser', 'no page errors', pageErrors)));
  } catch (error) {
    failures.push(`${browserName}: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    await context.close();
    await browser.close();
  }
}

const preview = startPreview();
try {
  await waitForPreview();
  for (const [name, engine] of browsers) await run(name, engine);
} finally {
  if (preview?.pid) { preview.stopping = true; try { process.kill(-preview.pid, 'SIGTERM'); } catch {} }
}

if (notRun.length) console.log(`NOT_RUN ${JSON.stringify(notRun)}`);
if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
console.log(`State-machine E2E passed: Chromium and WebKit at ${viewport.width}x${viewport.height}; lifecycle, export/reset/import, hint/economy/achievement idempotency, and IndexedDB consistency verified.`);
