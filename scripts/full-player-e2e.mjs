import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from 'playwright';

const base = process.env.FULL_PLAYER_URL || 'http://127.0.0.1:4176/word-connect-pwa/';
const url = new URL(base.endsWith('/') ? base : `${base}/`);
const port = Number(process.env.FULL_PLAYER_PORT || url.port || 4176);
const viewport = { width: Number(process.env.FULL_PLAYER_WIDTH || 320), height: Number(process.env.FULL_PLAYER_HEIGHT || 568) };
const expectedStartingCoins = 20;
const expectedCampaign = { targets: 77, bonus: 54 };

// This is deliberately source data inspection only. The runner never writes campaign data.
function readActiveCampaign() {
  const source = readFileSync(new URL('../src/content/campaign.ts', import.meta.url), 'utf8');
  const marker = 'export const CAMPAIGN: CampaignManifest = ';
  const start = source.indexOf(marker);
  if (start < 0) throw new Error('active campaign export not found');
  const jsonStart = start + marker.length;
  const jsonEnd = source.indexOf(' as const;', jsonStart);
  if (jsonEnd < 0) throw new Error('active campaign JSON boundary not found');
  return JSON.parse(source.slice(jsonStart, jsonEnd));
}

const campaign = readActiveCampaign();
if (campaign.campaignVersion !== 'campaign-en-v2' || campaign.levels.length !== 20) throw new Error('full-player requires campaign-en-v2 with 20 levels');

function startPreview() {
  if (process.env.FULL_PLAYER_EXTERNAL_URL === '1') return undefined;
  const viteBin = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url));
  return spawn(process.execPath, [viteBin, 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    stdio: ['ignore', 'pipe', 'pipe'], detached: true, env: { ...process.env }
  });
}

async function waitForPreview() {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error(`production preview did not become ready at ${url.href}`);
}

async function idb(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('word-connect-db');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const stores = ['profiles', 'progress', 'economyEvents', 'statsAggregate', 'statsDaily', 'gameEvents', 'achievements'];
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

async function cleanReset(page) {
  await page.evaluate(async () => {
    for (const registration of await navigator.serviceWorker?.getRegistrations?.() || []) await registration.unregister();
    await new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase('word-connect-db');
      request.onsuccess = resolve; request.onerror = () => reject(request.error); request.onblocked = resolve;
    });
    for (const key of await caches.keys()) if (key.startsWith('wordgame-')) await caches.delete(key);
  });
}

async function submitVisibleWord(page, word) {
  const used = new Map();
  const tiles = page.locator('.tile');
  const count = await tiles.count();
  for (const letter of word) {
    const occurrence = used.get(letter) || 0;
    let seen = 0;
    let picked = -1;
    for (let i = 0; i < count; i++) {
      const tile = tiles.nth(i);
      if ((await tile.innerText()) !== letter) continue;
      if (seen++ === occurrence) { picked = i; break; }
    }
    if (picked < 0) throw new Error(`visible tile not found for ${word} occurrence ${occurrence}`);
    await tiles.nth(picked).click();
    used.set(letter, occurrence + 1);
  }
  await page.getByRole('button', { name: 'Submit', exact: true }).click();
  await page.waitForTimeout(18);
}

async function restoreViaExport(page, browserName) {
  await page.getByRole('button', { name: 'Open settings' }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export Save' }).click();
  const download = await downloadPromise;
  const savePath = `/tmp/full-player-${browserName}.json`;
  await download.saveAs(savePath);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Reset save' }).click();
  await page.waitForFunction(() => document.querySelector('.candidate')?.textContent?.includes('Reset complete'));
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.locator('#import').setInputFiles(savePath);
  await page.waitForFunction(() => document.querySelector('.candidate')?.textContent?.includes('Save imported'));
  const restored = consistency(await idb(page));
  console.log(`LIFECYCLE ${JSON.stringify({ browser: browserName, action: 'export-reset-import', targets: restored.targets, bonus: restored.bonus, completed: restored.completed, coins: restored.profile?.coins, consistent: restored.ok })}`);
  if (!restored.ok) throw new Error(`save restore consistency failed: ${JSON.stringify(restored)}`);
}

function consistency(data) {
  const profile = data.profiles[0];
  const progress = data.progress.filter(row => row.campaignVersion === campaign.campaignVersion);
  const targets = progress.reduce((n, row) => n + row.foundTargets.length, 0);
  const bonus = progress.reduce((n, row) => n + row.foundBonus.length, 0);
  const completed = progress.filter(row => row.completed).length;
  const ledger = data.economyEvents.reduce((n, event) => n + event.coinsDelta, 0);
  const earned = data.economyEvents.reduce((n, event) => n + Math.max(0, event.coinsDelta), 0);
  const spent = data.economyEvents.reduce((n, event) => n + Math.max(0, -event.coinsDelta), 0);
  const stats = data.statsAggregate[0];
  const achievementIds = data.achievements.map(row => row.id);
  const ok = !!profile && !!stats && stats.targets === targets && stats.bonus === bonus && stats.submissions === targets + bonus && stats.levelsCompleted === completed && stats.coinsEarned === earned && stats.coinsSpent === spent && ledger === profile.coins - expectedStartingCoins && new Set(achievementIds).size === achievementIds.length;
  return { ok, profile, progress, stats, targets, bonus, completed, ledger, achievementIds };
}

async function checkpoint(page, browserName, levelId) {
  const data = await idb(page);
  const check = consistency(data);
  const viewportState = await page.evaluate(() => ({
    width: innerWidth, height: innerHeight, scrollX, scrollY,
    horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1,
    verticalOverflow: document.documentElement.scrollHeight > innerHeight + 1,
    verticalPageScroll: scrollY !== 0
  }));
  const level = check.progress.find(row => row.levelId === levelId);
  const evidence = { browser: browserName, level: levelId, targets: level?.foundTargets.length ?? 0, bonus: level?.foundBonus.length ?? 0, coins: check.profile?.coins, completed: level?.completed ?? false, statsEconomyConsistent: check.ok, viewport: viewportState };
  console.log(`CHECKPOINT ${JSON.stringify(evidence)}`);
  const expected = campaign.levels.find(item => item.levelId === levelId);
  if (!level?.completed || level.foundTargets.length !== expected.targets.length || level.foundBonus.length !== expected.bonus.length || !check.ok || viewportState.horizontalOverflow || viewportState.verticalOverflow || viewportState.scrollX !== 0 || viewportState.scrollY !== 0) throw new Error(`checkpoint failed: ${JSON.stringify(evidence)}`);
}

async function run(browserName, engine) {
  const browser = await engine.launch({ headless: true });
  const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true, serviceWorkers: 'allow' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  try {
    await page.goto(url.href, { waitUntil: 'networkidle' });
    await cleanReset(page);
    await page.goto(url.href, { waitUntil: 'networkidle' });
    await page.waitForSelector('.tile');
    for (let index = 0; index < campaign.levels.length; index++) {
      const level = campaign.levels[index];
      await page.waitForFunction(expected => document.querySelector('.eyebrow')?.textContent?.includes(`LEVEL ${Number(expected.slice(1))} /`), level.levelId);
      if (level.levelId === 'L010') await restoreViaExport(page, browserName);
      for (const word of [...level.targets, ...level.bonus]) {
        await submitVisibleWord(page, word);
        if (word === level.targets[0] && level.levelId === 'L005') {
          await page.reload({ waitUntil: 'networkidle' });
          await page.waitForSelector('.tile');
          const resumed = consistency(await idb(page));
          console.log(`LIFECYCLE ${JSON.stringify({ browser: browserName, level: level.levelId, action: 'reload-resume', targets: resumed.targets, bonus: resumed.bonus, coins: resumed.profile?.coins, consistent: resumed.ok })}`);
          if (!resumed.ok) throw new Error(`reload/resume consistency failed: ${JSON.stringify(resumed)}`);
        }
      }
      await checkpoint(page, browserName, level.levelId);
      if (level.levelId === 'L015' && browserName === 'webkit') {
        console.log(`NOT_RUN ${JSON.stringify({ browser: browserName, level: level.levelId, subsystem: 'offline reload', reason: 'Playwright WebKit offline navigation is not reliable in this environment; Chromium exercises the warm-offline resume disruption.' })}`);
      }
      if (level.levelId === 'L015' && browserName === 'chromium') {
        await context.setOffline(true);
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForSelector('.tile');
        await context.setOffline(false);
        await page.reload({ waitUntil: 'networkidle' });
        await page.waitForSelector('.tile');
        const offlineRestored = consistency(await idb(page));
        console.log(`LIFECYCLE ${JSON.stringify({ browser: browserName, level: level.levelId, action: 'offline-resume', completed: offlineRestored.completed, coins: offlineRestored.profile?.coins, consistent: offlineRestored.ok })}`);
        if (!offlineRestored.ok) throw new Error(`offline/resume consistency failed: ${JSON.stringify(offlineRestored)}`);
      }
      if (index < campaign.levels.length - 1) {
        await page.getByRole('button', { name: 'Next level', exact: true }).click();
        await page.waitForTimeout(20);
      }
    }
    const finalBeforeReload = await idb(page);
    const final = consistency(finalBeforeReload);
    const campaignTotals = { targets: campaign.levels.reduce((n, level) => n + level.targets.length, 0), bonus: campaign.levels.reduce((n, level) => n + level.bonus.length, 0) };
    if (final.completed !== 20) throw new Error(`final completion count failed: ${JSON.stringify(final)}`);
    if (campaignTotals.targets === expectedCampaign.targets && final.targets !== expectedCampaign.targets) throw new Error(`final target count failed: ${JSON.stringify(final)}`);
    if (campaignTotals.bonus === expectedCampaign.bonus && final.bonus !== expectedCampaign.bonus) throw new Error(`final bonus count failed: ${JSON.stringify(final)}`);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('.tile');
    const afterReload = consistency(await idb(page));
    const finalLevel = afterReload.progress.find(row => row.levelId === 'L020');
    if (!finalLevel?.completed || afterReload.completed !== 20 || !afterReload.ok) throw new Error('final Level 20 completion did not persist after reload');
    console.log(`FINAL ${JSON.stringify({ browser: browserName, viewport: `${viewport.width}x${viewport.height}`, levelsCompleted: afterReload.completed, targets: afterReload.targets, bonus: afterReload.bonus, coins: afterReload.profile?.coins, ledger: afterReload.ledger, achievements: afterReload.achievementIds.length, level20Persisted: !!finalLevel.completed, consistent: afterReload.ok })}`);
    if (errors.length) throw new Error(`browser errors: ${errors.join(' | ')}`);
  } finally {
    await context.close();
    await browser.close();
  }
}

const preview = startPreview();
try {
  await waitForPreview();
  await run('chromium', chromium);
  await run('webkit', webkit);
} finally {
  if (preview?.pid) { preview.stopping = true; try { process.kill(-preview.pid, 'SIGTERM'); } catch {} }
}

console.log('Full-player E2E passed: Chromium and WebKit completed all 20 campaign-en-v2 levels with durable gameplay, save recovery, economy, stats, achievement, and layout evidence; Chromium additionally verified warm-offline resume.');
