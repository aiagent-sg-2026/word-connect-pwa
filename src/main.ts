import './styles/app.css';
import { CAMPAIGN } from './content/campaign';
import { bootstrapData, exportSave, getLevel, getProfile, getProgress, hasActiveMaterialTransaction, HINT_COSTS, importSave, resetAll, setCurrentLevel, submitWord, useHint, type HintKind } from './db/store';
import { tileWord } from './game/logic';
import { askWaitingWorkerToActivate, bootOk, registerServiceWorker } from './pwa/register';
import { setReadinessProbe } from './pwa/updateCoordinator';
import type { LevelContract, ProfileRecord, ProgressRecord } from './types';

declare const __BUILD_ID__: string;
declare const __APP_VERSION__: string;

const app = document.querySelector<HTMLDivElement>('#app')!;
let profile: ProfileRecord;
let level: LevelContract;
let progress: ProgressRecord;
let selected: number[] = [];
let swipeDraft: number[] = [];
let dragging = false;
let waitingReg: ServiceWorkerRegistration | undefined;

function vibrate(ms = 12) { try { navigator.vibrate?.(ms); } catch {} }
function beep() { try { const ctx = new AudioContext(); const osc = ctx.createOscillator(); const gain = ctx.createGain(); gain.gain.value = 0.04; osc.frequency.value = 660; osc.connect(gain).connect(ctx.destination); osc.start(); osc.stop(ctx.currentTime + 0.05); } catch {} }

async function loadState(levelId?: string) {
  profile = await getProfile();
  level = getLevel(levelId || profile.currentLevelId);
  progress = await getProgress(level);
}

function answerSlots() {
  return level.targets.map(w => { const found = progress.foundTargets.includes(w); const revealed = progress.revealedWords?.includes(w); const letters = progress.revealedLetters?.[w] || []; return `<div class="slot ${found || revealed ? 'known' : ''}" aria-label="${w.length} letter word">${(found || revealed) ? w.split('').map(c=>`<span>${c}</span>`).join('') : w.split('').map((c,i)=>`<span>${letters.includes(i) ? c : ''}</span>`).join('')}</div>`; }).join('');
}

function wheel() {
  const n = level.letters.length;
  return `<div class="wheel" id="wheel" aria-label="Letter wheel. Tap letters then Submit, or swipe across letters."><svg id="path" aria-hidden="true"></svg>${level.letters.map((l,i)=>{ const a = (i / n) * Math.PI * 2 - Math.PI/2; const x = 50 + Math.cos(a)*34; const y = 50 + Math.sin(a)*34; return `<button class="tile ${selected.includes(i)?'sel':''}" data-i="${i}" style="left:${x}%;top:${y}%" aria-pressed="${selected.includes(i)}">${l}</button>`; }).join('')}</div>`;
}

function render(message = '') {
  const index = CAMPAIGN.levels.findIndex(l => l.levelId === level.levelId);
  const candidate = selected.length ? tileWord(selected, level.letters) : '';
  app.innerHTML = `<div class="app-shell"><header><div class="level-mark"><span class="eyebrow">LEVEL ${index+1} / ${CAMPAIGN.levels.length}</span><strong>${progress.foundTargets.length} / ${level.targets.length}</strong></div><div class="hud-actions"><div class="coins" aria-label="Coins">🪙 ${profile.coins}</div><button id="settings" class="icon-button" aria-label="Open settings">⚙</button></div></header><section class="progress" aria-label="Level progress"><div style="width:${(progress.foundTargets.length/level.targets.length)*100}%"></div></section><main><section class="answers" aria-label="Answer slots">${answerSlots()}</section><div class="candidate" aria-live="polite" aria-label="Current word">${candidate || message || 'Tap or swipe letters'}</div>${wheel()}<section class="controls"><button id="submit" ${!candidate?'disabled':''}>Submit</button><button id="clear" class="compact">Clear</button><button id="shuffle" class="secondary">Shuffle</button><button id="hint" class="secondary">Hint</button></section><section class="bonus" aria-live="polite"><span>★ Bonus</span> ${progress.foundBonus.length ? progress.foundBonus.join(', ') : 'Find extra words for +1'}</section>${progress.completed ? `<section class="complete"><div><span class="eyebrow">PUZZLE COMPLETE</span><h2>Level complete!</h2></div><button id="next">${index === CAMPAIGN.levels.length-1 ? 'Replay final level' : 'Next level'}</button></section>` : ''}</main>${waitingReg ? `<aside class="update"><strong>Update ready</strong><button id="later">Later</button><button id="updateNow">Update Now</button></aside>` : ''}<div id="sheet-root"></div></div>`;
  bindEvents(); drawPath();
}

function addIndex(i: number) { if (!selected.includes(i)) { selected.push(i); vibrate(); render(); } }
function indexFromPoint(x: number, y: number): number | undefined { const el = document.elementFromPoint(x,y) as HTMLElement | null; const tile = el?.closest<HTMLElement>('.tile'); return tile ? Number(tile.dataset.i) : undefined; }

function bindEvents() {
  document.querySelectorAll<HTMLButtonElement>('.tile').forEach(btn => {
    btn.addEventListener('click', () => addIndex(Number(btn.dataset.i)));
    btn.addEventListener('pointerdown', e => { dragging = true; swipeDraft = [Number(btn.dataset.i)]; (e.target as Element).setPointerCapture?.(e.pointerId); });
    btn.addEventListener('pointermove', e => { if (!dragging) return; const i = indexFromPoint(e.clientX, e.clientY); if (i !== undefined && !swipeDraft.includes(i)) { swipeDraft.push(i); selected = [...swipeDraft]; render(); } });
    btn.addEventListener('pointerup', async () => { if (dragging && swipeDraft.length > 1) { selected = [...swipeDraft]; await submitSelected(); } swipeDraft = []; dragging = false; });
  });
  document.querySelector('#submit')?.addEventListener('click', submitSelected);
  document.querySelector('#clear')?.addEventListener('click', () => { selected=[]; render('Cleared'); });
  document.querySelector('#shuffle')?.addEventListener('click', () => { level = {...level, letters:[...level.letters].sort(()=>Math.random()-0.5)}; selected=[]; render('Shuffled'); });
  document.querySelector('#hint')?.addEventListener('click', () => openHintSheet());
  document.querySelector('#settings')?.addEventListener('click', () => openSettingsSheet());
  document.querySelector('#next')?.addEventListener('click', async () => { const i = CAMPAIGN.levels.findIndex(l=>l.levelId===level.levelId); const next = CAMPAIGN.levels[Math.min(i+1, CAMPAIGN.levels.length-1)]; await setCurrentLevel(next.levelId); selected=[]; await loadState(next.levelId); render('Next puzzle'); });
  document.querySelector('#later')?.addEventListener('click', () => { waitingReg = undefined; render('Update postponed'); });
  document.querySelector('#updateNow')?.addEventListener('click', async () => {
    if (!waitingReg) return;
    const ready = !dragging && !hasActiveMaterialTransaction() && !!profile?.campaignVersion && profile.campaignVersion === CAMPAIGN.campaignVersion;
    const started = await askWaitingWorkerToActivate(waitingReg, { swipeEnded: !dragging, progressSaved: true, materialTransactionActive: hasActiveMaterialTransaction(), compatibilityStaged: profile.campaignVersion === CAMPAIGN.campaignVersion, allClientsReady: ready });
    if (!started) render('Update will wait until this window is ready');
  });
}

function closeSheet() { document.querySelector('#sheet-root')!.innerHTML = ''; document.removeEventListener('keydown', onSheetKey); }
function sheet(title: string, body: string) { document.querySelector('#sheet-root')!.innerHTML = `<div class="sheet-backdrop" data-close-sheet><section class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title"><button class="sheet-close" data-close-sheet aria-label="Close">×</button><h2 id="sheet-title">${title}</h2>${body}</section></div>`; document.querySelectorAll<HTMLElement>('[data-close-sheet]').forEach(el => el.addEventListener('click', e => { if (e.target === e.currentTarget || el.classList.contains('sheet-close')) closeSheet(); })); document.addEventListener('keydown', onSheetKey); document.querySelector<HTMLButtonElement>('.sheet-close')?.focus(); }
function onSheetKey(e: KeyboardEvent) { if (e.key === 'Escape') { closeSheet(); document.removeEventListener('keydown', onSheetKey); } }
function openHintSheet() { sheet('Choose a hint', `<p class="sheet-note">Hints reveal progress in this puzzle and persist in your save.</p><div class="sheet-options">${([['letter','Reveal a letter','3 coins','Reveals the next hidden letter'],['first-letter','First letter','5 coins','Reveals the first letter'],['word','Reveal word','10 coins','Shows one unsolved answer']] as [HintKind,string,string,string][]).map(([kind,label,cost,desc]) => `<button class="hint-choice" data-hint-kind="${kind}"><strong>${label}<span>${cost}</span></strong><small>${desc}</small></button>`).join('')}</div>`); document.querySelectorAll<HTMLButtonElement>('[data-hint-kind]').forEach(b => b.addEventListener('click', async () => { const kind = b.dataset.hintKind as HintKind; const res = await useHint(level, kind); closeSheet(); profile = res.profile; progress = res.progress; render(res.charged ? (kind === 'word' ? 'Word revealed' : 'Letter revealed') : res.hint ? `Need ${HINT_COSTS[kind]} coins` : 'No unsolved hint available'); })); }
function openSettingsSheet() { sheet('Settings', `<div class="settings-list"><button id="export">Export Save</button><label class="import">Import Save<input id="import" type="file" accept="application/json"></label><button id="reset" class="danger">Reset save</button></div><p class="build-meta">v${__APP_VERSION__} · build ${__BUILD_ID__}</p>`); document.querySelector('#export')?.addEventListener('click', async () => { const blob = new Blob([JSON.stringify(await exportSave(), null, 2)], {type:'application/json'}); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'word-connect-save-v2.json'; a.click(); URL.revokeObjectURL(a.href); }); document.querySelector<HTMLInputElement>('#import')?.addEventListener('change', async e => { const file = (e.currentTarget as HTMLInputElement).files?.[0]; if (!file) return; try { await importSave(JSON.parse(await file.text())); await loadState(); closeSheet(); render('Save imported'); } catch { closeSheet(); render('Import failed validation'); } }); document.querySelector('#reset')?.addEventListener('click', async () => { if (confirm('Reset all local Word Connect data? This cannot be undone unless you exported a save.')) { await resetAll(); await loadState(CAMPAIGN.levels[0].levelId); closeSheet(); render('Reset complete'); } }); }

async function submitSelected() {
  if (!selected.length) return;
  try { const word = tileWord(selected, level.letters); const res = await submitWord(level, word); profile = res.profile; progress = res.progress; selected = []; if (res.outcome.kind === 'TARGET' || res.outcome.kind === 'BONUS') { beep(); vibrate(20); } render(res.outcome.message); } catch { selected = []; render('Tile cannot be reused'); }
}

function drawPath() {
  const svg = document.querySelector<SVGSVGElement>('#path'); const wheelEl = document.querySelector<HTMLElement>('#wheel');
  if (!svg || !wheelEl || selected.length < 2) return;
  const rect = wheelEl.getBoundingClientRect();
  const pts = selected.map(i => { const el = document.querySelector<HTMLElement>(`.tile[data-i="${i}"]`)!; const r = el.getBoundingClientRect(); return `${r.left + r.width/2 - rect.left},${r.top + r.height/2 - rect.top}`; });
  svg.innerHTML = `<polyline points="${pts.join(' ')}" fill="none" stroke="#f2d071" stroke-width="10" stroke-linecap="round" stroke-linejoin="round" opacity=".85"/>`;
}

setReadinessProbe(() => !dragging && !hasActiveMaterialTransaction() && !!profile?.campaignVersion && profile.campaignVersion === CAMPAIGN.campaignVersion);

function recovery(error: unknown) {
  const code = error instanceof Error ? error.message.slice(0,80) : 'REC_UNKNOWN';
  app.innerHTML = `<main class="recovery"><h1>Recovery</h1><p>Word Connect could not finish startup. Your save was preserved.</p><code>${code}</code><button id="retry">Retry</button><button id="export">Export Save</button><button id="reset">Reset (destructive)</button></main>`;
  document.querySelector('#retry')?.addEventListener('click', start);
  document.querySelector('#export')?.addEventListener('click', async () => { const blob = new Blob([JSON.stringify(await exportSave(), null, 2)], {type:'application/json'}); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download='word-connect-save-v2.json'; a.click(); });
  document.querySelector('#reset')?.addEventListener('click', async () => { if (confirm('Permanently reset local save?')) { await resetAll(); start(); } });
}

async function start() { try { await bootstrapData(); await loadState(); render(); bootOk(); } catch (e) { recovery(e); } }

registerServiceWorker({ onWaiting: reg => { waitingReg = reg; render('Update available'); }, onOfflineReady: () => console.info('offline shell ready') });
start();
