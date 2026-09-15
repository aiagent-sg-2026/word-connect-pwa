import './styles.css';
import packetJson from '../../content/golden/blind-review-packet-esdb-en-us-v1.json';
import { assertBlindPacket, exportEnvelope, REVIEW_CLASSES, reviewKey, validateEnvelope, type BlindPacket } from './data';
import type { HumanReview, GoldenClass } from '../golden/contracts.ts';
import { getReviews, getReviewerId, saveReview, setReviewerId } from './store';

const packet = assertBlindPacket(packetJson as unknown) as BlindPacket;
const app = document.querySelector<HTMLDivElement>('#app')!;
let reviewerId = ''; let reviews: HumanReview[] = []; let index = 0; let notice = '';
let offlineState = 'Offline shell loading'; let waitingWorker: ServiceWorker | undefined; let reloadForUpdate = false;
const reviewMap = () => new Map(reviews.map(r => [reviewKey(packet.queueChecksum, reviewerId, r.word), r]));
const current = () => packet.rows[index];
const escapeHtml = (s: string) => s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');

function render() {
  const row = current(); const existing = reviewMap().get(reviewKey(packet.queueChecksum, reviewerId, row.word)); const done = reviews.length; const complete = done === packet.rows.length;
  app.innerHTML = `<div class="shell"><header><div><p class="eyebrow">Human Golden Reviewer</p><h1>Blind review</h1></div><span class="offline">${escapeHtml(offlineState)}</span></header><section class="identity"><label for="reviewer">Reviewer ID</label><input id="reviewer" minlength="3" maxlength="80" value="${escapeHtml(reviewerId)}" placeholder="Your stable ID" autocomplete="off"><button id="save-id">Save ID</button></section><section class="progress" aria-label="Review progress"><div><strong>${done}</strong> / ${packet.rows.length} reviewed</div><progress max="${packet.rows.length}" value="${done}"></progress><small>${complete ? 'Packet complete' : `${packet.rows.length - done} remaining`}</small></section><main><p class="position">Word ${index + 1} of ${packet.rows.length} · ${existing ? 'Reviewed' : 'Not reviewed'}</p><div class="word" aria-label="Word to review">${escapeHtml(row.word)}</div><p class="length">${row.length} letters</p><details class="guide"><summary>Label guide</summary><ul><li><strong>TARGET</strong> — valid ordinary English and fair as a required puzzle answer.</li><li><strong>BONUS</strong> — valid, but better as an optional extra than a required answer.</li><li><strong>ACCEPT ONLY</strong> — acceptable input, but should not be required or rewarded as bonus.</li><li><strong>BLOCKED</strong> — should not be accepted in the game.</li><li><strong>REVIEW</strong> — uncertain; needs follow-up rather than a guess.</li></ul></details><div class="labels" role="group" aria-label="Choose one human label">${REVIEW_CLASSES.map((c,i) => `<button class="label ${existing?.class === c ? 'selected' : ''}" data-class="${c}" aria-pressed="${existing?.class === c}"><span class="shortcut">${i+1}</span>${c.replace('_',' ')}</button>`).join('')}</div><label class="confidence" for="confidence">Confidence <output id="confidence-value">${existing?.confidence ?? '0.50'}</output><input id="confidence" type="range" min="0" max="1" step="0.01" value="${existing?.confidence ?? '0.5'}"></label><label for="note">Optional note</label><textarea id="note" rows="3" maxlength="500" placeholder="Optional context for the review">${escapeHtml(existing?.note ?? '')}</textarea><button class="primary" id="save" ${!reviewerId ? 'disabled' : ''}>Save judgment</button><div class="nav"><button id="previous">← Previous</button><button id="next">Next →</button><button id="skip">Skip / defer →</button><button id="unreviewed">Next unreviewed</button></div></main><section class="tools"><button id="export">Export my reviews</button><label class="import">Import my reviews<input id="import" type="file" accept="application/json"></label><p>Reviews stay on this device until you export them. Skipping or deferring never creates a review.</p><small>Keyboard: 1–5 label, S save, U next unreviewed, ←/→ navigate.</small></section><p class="notice" role="status">${escapeHtml(notice)}</p><footer>Queue ${escapeHtml(packet.queueVersion)} · ${escapeHtml(packet.queueChecksum.slice(0,12))}…</footer>${waitingWorker ? `<aside class="update" role="status"><strong>Reviewer update ready</strong><p>Your saved reviews stay local.</p><button id="update-later">Later</button><button id="update-now">Update now</button></aside>` : ''}</div>`;
  bind();
}

async function refreshReviews() { reviews = reviewerId ? await getReviews(reviewerId, packet.queueVersion, packet.queueChecksum) : []; }
function goNext(message = '') { index=Math.min(packet.rows.length-1,index+1); notice=message; render(); }
function bind() {
  document.querySelector('#save-id')?.addEventListener('click', async () => { const id = document.querySelector<HTMLInputElement>('#reviewer')!.value.trim(); try { await setReviewerId(id); reviewerId=id; await refreshReviews(); notice='Reviewer ID saved locally'; render(); } catch (e) { notice=(e as Error).message; render(); } });
  document.querySelector<HTMLInputElement>('#confidence')?.addEventListener('input', e => { document.querySelector('#confidence-value')!.textContent=(e.target as HTMLInputElement).value; });
  document.querySelectorAll<HTMLButtonElement>('[data-class]').forEach(b => b.addEventListener('click', () => { document.querySelectorAll('[data-class]').forEach(x=>{ x.classList.remove('selected'); x.setAttribute('aria-pressed','false'); }); b.classList.add('selected'); b.setAttribute('aria-pressed','true'); }));
  document.querySelector('#save')?.addEventListener('click', async () => { const selected=document.querySelector<HTMLButtonElement>('.label.selected')?.dataset.class as GoldenClass|undefined; if (!selected) { notice='Choose one label before saving'; render(); return; } const r: HumanReview={schemaVersion:'human-golden-review-v1',queueVersion:packet.queueVersion,queueChecksum:packet.queueChecksum,word:current().word,reviewerId,reviewedAt:new Date().toISOString(),source:'human-review-v1',class:selected,confidence:Number(document.querySelector<HTMLInputElement>('#confidence')!.value),note:document.querySelector<HTMLTextAreaElement>('#note')!.value || undefined}; await saveReview(r); await refreshReviews(); notice='Judgment saved on this device'; if (index < packet.rows.length-1) index++; render(); });
  document.querySelector('#previous')?.addEventListener('click', () => { index=Math.max(0,index-1); notice=''; render(); });
  document.querySelector('#next')?.addEventListener('click', () => goNext(''));
  document.querySelector('#skip')?.addEventListener('click', () => goNext('Deferred; no review was created'));
  document.querySelector('#unreviewed')?.addEventListener('click', () => { const map=reviewMap(); const n=packet.rows.findIndex((r,i)=>i>index&&!map.has(reviewKey(packet.queueChecksum,reviewerId,r.word))); const fallback=packet.rows.findIndex(r=>!map.has(reviewKey(packet.queueChecksum,reviewerId,r.word))); index=n>=0?n:fallback>=0?fallback:index; notice=''; render(); });
  document.querySelector('#export')?.addEventListener('click', () => { if (!reviewerId) { notice='Save a reviewer ID before exporting'; render(); return; } try { const blob=new Blob([JSON.stringify(exportEnvelope(packet,reviewerId,reviews),null,2)],{type:'application/json'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=`human-golden-reviews-${reviewerId}.json`; a.click(); URL.revokeObjectURL(a.href); notice='Exported current judgments'; render(); } catch(err) { notice=`Export rejected: ${(err as Error).message}`; render(); } });
  document.querySelector<HTMLInputElement>('#import')?.addEventListener('change', async e => { const file=(e.currentTarget as HTMLInputElement).files?.[0]; if (!file || !reviewerId) { notice='Save your reviewer ID before importing'; render(); return; } try { const incoming=validateEnvelope(JSON.parse(await file.text()),packet,reviewerId); for(const r of incoming) await saveReview(r); await refreshReviews(); notice=`Imported ${incoming.length} judgments`; render(); } catch (err) { notice=`Import rejected: ${(err as Error).message}`; render(); } });
  document.querySelector('#update-later')?.addEventListener('click', () => { waitingWorker=undefined; notice='Update postponed'; render(); });
  document.querySelector('#update-now')?.addEventListener('click', () => { if (!waitingWorker) return; reloadForUpdate=true; waitingWorker.postMessage({type:'ACTIVATE_UPDATE'}); });
}

document.addEventListener('keydown', e => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
  if (/^[1-5]$/.test(e.key)) document.querySelectorAll<HTMLButtonElement>('[data-class]')[Number(e.key)-1]?.click();
  if (e.key==='ArrowLeft') document.querySelector<HTMLButtonElement>('#previous')?.click();
  if (e.key==='ArrowRight') document.querySelector<HTMLButtonElement>('#next')?.click();
  if (e.key.toLowerCase()==='u') document.querySelector<HTMLButtonElement>('#unreviewed')?.click();
  if (e.key.toLowerCase()==='s') document.querySelector<HTMLButtonElement>('#save')?.click();
});

async function registerReviewerServiceWorker() {
  if (!('serviceWorker' in navigator)) { offlineState='Offline unavailable'; render(); return; }
  const base=import.meta.env.BASE_URL;
  const hadController=!!navigator.serviceWorker.controller;
  const reg=await navigator.serviceWorker.register(`${base}reviewer-sw.js`,{scope:base});
  const observe=(worker?:ServiceWorker|null)=>{ if(!worker)return; worker.addEventListener('statechange',()=>{ if(worker.state==='installed'&&navigator.serviceWorker.controller){waitingWorker=worker;notice='Update available';render();} }); };
  observe(reg.installing); reg.addEventListener('updatefound',()=>observe(reg.installing));
  if(reg.waiting&&navigator.serviceWorker.controller) waitingWorker=reg.waiting;
  await navigator.serviceWorker.ready; offlineState='Offline ready'; render();
  navigator.serviceWorker.addEventListener('controllerchange',()=>{ if(hadController&&reloadForUpdate) location.reload(); });
}

async function start() { reviewerId=await getReviewerId(); await refreshReviews(); render(); await registerReviewerServiceWorker(); }
start().catch(e => { app.textContent=`Reviewer could not start: ${(e as Error).message}`; });
