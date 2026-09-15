import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import type { DictionaryArtifact, WordClass, WordRecord } from '../content-pipeline/types.ts';
import { GOLDEN_CLASSES, type FinalGoldenItem, type GoldenAdjudication, type GoldenCandidate, type GoldenQueueArtifact, type GoldenReadiness, type GoldenSourceProvenance, type GoldenSplit, type HumanReview, type PublishedGoldenArtifact } from './contracts.ts';

export const HUMAN_GOLDEN_TARGET = 2000;
export const GOLDEN_QUEUE_VERSION = 'human-golden-queue-v1';
export const GOLDEN_EVALUATOR_VERSION = 'human-golden-evaluator-v1';
export const GOLDEN_SPLIT_POLICY_VERSION = 'golden-split-hash-70-15-15-v1';
export const GOLDEN_SEED = 'word-connect-human-golden-v1';

export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort().map(k => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(',')}}`;
}
export function sha256(value: unknown): string { return createHash('sha256').update(typeof value === 'string' ? value : canonical(value)).digest('hex'); }
const upper = (w: string) => w.normalize('NFC').toLocaleUpperCase('en-US');
const hashInt = (s: string) => parseInt(sha256(s).slice(0, 12), 16);

function sourceOf(dictionary: DictionaryArtifact): GoldenSourceProvenance {
  return { dictionaryVersion: dictionary.version, dictionaryChecksum: dictionary.manifest.checksum, scoringVersion: 'score-v1-provisional', evaluatorVersion: GOLDEN_EVALUATOR_VERSION, queueVersion: GOLDEN_QUEUE_VERSION, splitPolicyVersion: GOLDEN_SPLIT_POLICY_VERSION, seed: GOLDEN_SEED };
}

function strataFor(r: WordRecord): string[] {
  const target = r.targetScore?.score ?? 0; const bonus = r.bonusScore?.score ?? 0;
  const band = Math.abs(target - (r.length === 3 ? 0.78 : 0.68)) <= 0.08 || Math.abs(bonus - 0.42) <= 0.08 ? 'boundary' : target >= 0.8 ? 'high-score' : 'low-mid-score';
  return [
    `length:${r.length <= 3 ? 'short' : r.length <= 5 ? 'medium' : 'long'}`,
    `class:${r.class}`,
    `band:${band}`,
    r.length === 3 ? 'short-3-letter' : 'not-3-letter',
    r.morphology ? `morphology:${r.morphology.inflectionType}` : 'morphology:none',
    r.dialects.length > 1 ? 'dialect:multi' : `dialect:${r.dialects[0] ?? 'unknown'}`,
    Object.entries(r.flags).filter(([,v]) => v).map(([k]) => `flag:${k}`).sort().join('|') || 'flag:none',
    r.reasons.includes('REVIEW_REQUIRED') ? 'review-required' : 'review-not-required'
  ];
}

export function queueChecksum(queue: Omit<GoldenQueueArtifact, 'checksum'> & { checksum?: string }): string {
  return sha256({ ...queue, checksum: undefined });
}

export function validateQueue(queue: GoldenQueueArtifact): string[] {
  const errors: string[] = [];
  if (queue.schemaVersion !== 'golden-queue-v1') errors.push('queue: invalid schemaVersion');
  const sourceQueueVersion = queue.source?.queueVersion;
  if (sourceQueueVersion !== GOLDEN_QUEUE_VERSION) errors.push('queue: invalid source queueVersion');
  if (!queue.checksum || queue.checksum !== queueChecksum(queue)) errors.push('queue: checksum mismatch');
  if (!Number.isInteger(queue.targetCount) || queue.targetCount < 0) errors.push('queue: invalid targetCount');
  if (queue.candidateCount !== queue.candidates?.length) errors.push('queue: candidateCount mismatch');
  if (queue.shortfall !== Math.max(0, queue.targetCount - queue.candidateCount)) errors.push('queue: shortfall mismatch');
  const seen = new Set<string>();
  for (const [i, c] of (queue.candidates ?? []).entries()) {
    const p = `queue.candidates[${i}]`;
    if (c.schemaVersion !== 'golden-candidate-v1') errors.push(`${p}: invalid schemaVersion`);
    if (c.queueVersion !== sourceQueueVersion) errors.push(`${p}: queueVersion mismatch`);
    if (c.source?.queueVersion !== sourceQueueVersion || c.source?.dictionaryChecksum !== queue.source?.dictionaryChecksum) errors.push(`${p}: source mismatch`);
    if (c.upper !== upper(c.word)) errors.push(`${p}: upper mismatch`);
    if (c.length !== [...c.upper].length) errors.push(`${p}: length mismatch`);
    if (seen.has(c.upper)) errors.push(`${p}: duplicate word`); seen.add(c.upper);
  }
  return errors;
}

export function assertValidQueue(queue: GoldenQueueArtifact): void {
  const errors = validateQueue(queue);
  if (errors.length) throw new Error(errors.join('\n'));
}

export function buildGoldenQueue(dictionary: DictionaryArtifact, targetCount = HUMAN_GOLDEN_TARGET): GoldenQueueArtifact {
  const source = sourceOf(dictionary);
  const unique = new Map<string, WordRecord>();
  for (const r of dictionary.records) if (!unique.has(r.upper)) unique.set(r.upper, r);
  const candidates = [...unique.values()].map((r): GoldenCandidate => ({ schemaVersion: 'golden-candidate-v1', queueVersion: GOLDEN_QUEUE_VERSION, word: r.word, upper: r.upper, length: r.length, candidateId: sha256(`${GOLDEN_SEED}:candidate:${r.upper}`).slice(0, 16), strata: strataFor(r), predictedClass: r.class, targetScore: r.targetScore?.score, bonusScore: r.bonusScore?.score, reasons: r.reasons, source }));
  candidates.sort((a,b) => {
    const ab = a.strata.includes('band:boundary') ? 0 : 1; const bb = b.strata.includes('band:boundary') ? 0 : 1;
    return ab - bb || hashInt(`${GOLDEN_SEED}:${a.upper}`) - hashInt(`${GOLDEN_SEED}:${b.upper}`) || a.upper.localeCompare(b.upper);
  });
  const selected = candidates.slice(0, targetCount).sort((a,b) => a.upper.localeCompare(b.upper));
  const unsigned = { schemaVersion: 'golden-queue-v1' as const, targetCount, candidateCount: selected.length, shortfall: Math.max(0, targetCount - selected.length), generatedAt: '1970-01-01T00:00:00.000Z', checksum: '', source, candidates: selected };
  return { ...unsigned, checksum: queueChecksum(unsigned) };
}

export function exportBlindPacket(queue: GoldenQueueArtifact) {
  assertValidQueue(queue);
  const rows = queue.candidates.map(c => ({ queueVersion: queue.source.queueVersion, queueChecksum: queue.checksum, word: c.upper, candidateId: c.candidateId, length: c.length, reviewerId: '', reviewedAt: '', source: 'human-review-v1', class: '', confidence: '', note: '' }));
  return { schemaVersion: 'blind-human-review-packet-v1', queueVersion: queue.source.queueVersion, queueChecksum: queue.checksum, candidateCount: queue.candidateCount, instructions: 'Fill reviewerId, reviewedAt ISO timestamp, source=human-review-v1, class TARGET/BONUS/ACCEPT_ONLY/BLOCKED/REVIEW, confidence 0..1, optional note. Packet intentionally omits scorer outputs and policy strata.', rows };
}
export function toCsv(rows: Record<string, unknown>[]): string {
  const headers = Object.keys(rows[0] ?? { queueVersion:'', queueChecksum:'', word:'', candidateId:'', length:'', reviewerId:'', reviewedAt:'', source:'', class:'', confidence:'', note:'' });
  const cell = (v: unknown) => `"${(Array.isArray(v) ? v.join(';') : String(v ?? '')).replaceAll('"','""')}"`;
  return `${headers.join(',')}\n${rows.map(r => headers.map(h => cell(r[h])).join(',')).join('\n')}\n`;
}

export function validateReviews(queue: GoldenQueueArtifact, reviews: HumanReview[]): string[] {
  const errors: string[] = [...validateQueue(queue)]; const words = new Set(queue.candidates.map(c => c.upper)); const seen = new Set<string>();
  reviews.forEach((r, i) => {
    const p = `review[${i}]`;
    if (r.schemaVersion !== 'human-golden-review-v1') errors.push(`${p}: invalid schemaVersion`);
    if (r.queueVersion !== queue.source.queueVersion || r.queueChecksum !== queue.checksum) errors.push(`${p}: candidate checksum/version mismatch`);
    const w = upper(String(r.word ?? '')); if (!words.has(w)) errors.push(`${p}: unknown word`);
    if (!r.reviewerId || typeof r.reviewerId !== 'string' || r.reviewerId.trim().length < 3) errors.push(`${p}: invalid reviewerId`);
    if (r.source !== 'human-review-v1') errors.push(`${p}: missing human source`);
    if (!GOLDEN_CLASSES.includes(r.class)) errors.push(`${p}: invalid class`);
    if (!Number.isFinite(r.confidence) || r.confidence < 0 || r.confidence > 1) errors.push(`${p}: invalid confidence`);
    if (!r.reviewedAt || Number.isNaN(Date.parse(r.reviewedAt))) errors.push(`${p}: invalid reviewedAt`);
    const key = `${w}:${r.reviewerId}`; if (seen.has(key)) errors.push(`${p}: duplicate same-reviewer/word`); seen.add(key);
  });
  return errors;
}

export function validateAdjudications(queue: GoldenQueueArtifact, reviews: HumanReview[], adjudications: GoldenAdjudication[]): string[] {
  const errors: string[] = [...validateQueue(queue), ...validateReviews(queue, reviews)]; const words = new Set(queue.candidates.map(c => c.upper)); const reviewsByWord = new Map<string, HumanReview[]>();
  for (const r of reviews) { const w = upper(r.word); reviewsByWord.set(w, [...(reviewsByWord.get(w) ?? []), r]); }
  const seen = new Set<string>();
  adjudications.forEach((a, i) => {
    const p = `adjudication[${i}]`; const w = upper(String(a.word ?? ''));
    if (a.schemaVersion !== 'human-golden-adjudication-v1') errors.push(`${p}: invalid schemaVersion`);
    if (a.queueVersion !== queue.source.queueVersion || a.queueChecksum !== queue.checksum) errors.push(`${p}: candidate checksum/version mismatch`);
    if (!words.has(w)) errors.push(`${p}: unknown word`);
    if (seen.has(w)) errors.push(`${p}: duplicate adjudication/word`); seen.add(w);
    if (!a.adjudicatorId || typeof a.adjudicatorId !== 'string' || a.adjudicatorId.trim().length < 3) errors.push(`${p}: invalid adjudicatorId`);
    if (a.source !== 'human-adjudication-v1') errors.push(`${p}: missing human adjudication source`);
    if (!GOLDEN_CLASSES.includes(a.finalClass)) errors.push(`${p}: invalid finalClass`);
    if (!a.adjudicatedAt || Number.isNaN(Date.parse(a.adjudicatedAt))) errors.push(`${p}: invalid adjudicatedAt`);
    const wordReviews = reviewsByWord.get(w) ?? [];
    const known = new Set(wordReviews.map(r => r.reviewerId));
    const sourceIds = Array.isArray(a.sourceReviewerIds) ? [...new Set(a.sourceReviewerIds)] : [];
    if (sourceIds.length < 2) errors.push(`${p}: sourceReviewerIds must include at least two distinct reviewers`);
    for (const id of a.sourceReviewerIds ?? []) if (!known.has(id)) errors.push(`${p}: unknown sourceReviewerId ${id}`);
    if (sourceIds.includes(a.adjudicatorId)) errors.push(`${p}: adjudicator must be distinct from source reviewers`);
    if (known.size < 2) errors.push(`${p}: adjudication requires at least two distinct human reviews`);
    const sourceClasses = new Set(wordReviews.filter(r => sourceIds.includes(r.reviewerId)).map(r => r.class));
    if (sourceClasses.size < 2) errors.push(`${p}: adjudication requires an actual source-review disagreement`);
  });
  return errors;
}

export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let quoted = false;
  for (let i = 0; i < text.length; i++) { const ch = text[i];
    if (quoted) { if (ch === '"' && text[i+1] === '"') { cell += '"'; i++; } else if (ch === '"') quoted = false; else cell += ch; }
    else if (ch === '"') quoted = true; else if (ch === ',') { row.push(cell); cell = ''; } else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; } else if (ch !== '\r') cell += ch;
  }
  if (quoted) throw new Error('CSV has unterminated quoted field');
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  while (rows.length && rows[rows.length-1].every(c => c === '')) rows.pop();
  const headers = rows.shift() ?? [];
  return rows.map(r => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ''])));
}

function rowToReview(r: Record<string, unknown>): HumanReview {
  return { schemaVersion: (r.schemaVersion as HumanReview['schemaVersion']) ?? 'human-golden-review-v1', queueVersion: String(r.queueVersion ?? ''), queueChecksum: String(r.queueChecksum ?? ''), word: String(r.word ?? ''), reviewerId: String(r.reviewerId ?? ''), reviewedAt: String(r.reviewedAt ?? ''), source: String(r.source ?? '') as HumanReview['source'], class: String(r.class ?? '') as HumanReview['class'], confidence: typeof r.confidence === 'number' ? r.confidence : Number(r.confidence), reason: r.reason == null ? undefined : String(r.reason), note: r.note == null ? undefined : String(r.note) };
}

export function parseReviewsFile(path: string): HumanReview[] {
  const text = readFileSync(path, 'utf8');
  if (path.toLowerCase().endsWith('.csv')) return parseCsv(text).map(rowToReview);
  const v = JSON.parse(text); const rows = Array.isArray(v) ? v : v.reviews ?? v.rows ?? [];
  return rows.map(rowToReview);
}
export const parseReviewsJson = parseReviewsFile;

export function resolveItems(queue: GoldenQueueArtifact, reviews: HumanReview[], adjudications: GoldenAdjudication[] = []): { items: FinalGoldenItem[]; unresolved: string[]; stats: ReturnType<typeof statusStats> } {
  const valid = [...validateReviews(queue, reviews), ...validateAdjudications(queue, reviews, adjudications)]; if (valid.length) throw new Error(valid.join('\n'));
  const byWord = new Map<string, HumanReview[]>(); for (const r of reviews) byWord.set(upper(r.word), [...(byWord.get(upper(r.word)) ?? []), r]);
  const adjByWord = new Map(adjudications.map(a => [upper(a.word), a]));
  const items: FinalGoldenItem[] = []; const unresolved: string[] = [];
  for (const c of queue.candidates) {
    const rs = byWord.get(c.upper) ?? []; const classes = new Set(rs.map(r => r.class)); const adj = adjByWord.get(c.upper);
    let finalClass: WordClass | undefined; let adjudicatorId: string | undefined;
    if (rs.length >= 2 && new Set(rs.map(r => r.reviewerId)).size >= 2 && classes.size === 1) finalClass = rs[0].class;
    else if (adj && rs.length >= 2 && new Set(rs.map(r => r.reviewerId)).size >= 2 && classes.size > 1 && adj.source === 'human-adjudication-v1' && GOLDEN_CLASSES.includes(adj.finalClass) && adj.queueChecksum === queue.checksum) { finalClass = adj.finalClass; adjudicatorId = adj.adjudicatorId; }
    if (finalClass) items.push({ schemaVersion: 'final-golden-item-v1', word: c.upper, class: finalClass, split: splitFor(c.upper, finalClass), reviewerIds: rs.map(r => r.reviewerId).sort(), adjudicatorId, evidenceChecksum: sha256({ reviews: rs, adjudication: adj ?? null }) });
    else unresolved.push(c.upper);
  }
  return { items, unresolved, stats: statusStats(queue, reviews, adjudications) };
}

export function splitFor(word: string, klass: string): GoldenSplit { const n = hashInt(`${GOLDEN_SPLIT_POLICY_VERSION}:${GOLDEN_SEED}:${klass}:${upper(word)}`) % 10000; return n < 7000 ? 'train' : n < 8500 ? 'dev' : 'holdout'; }

export function statusStats(queue: GoldenQueueArtifact, reviews: HumanReview[] = [], adjudications: GoldenAdjudication[] = []) {
  const validation = [...validateReviews(queue, reviews), ...validateAdjudications(queue, reviews, adjudications)]; if (validation.length) throw new Error(validation.join('\n'));
  const byWord = new Map<string, HumanReview[]>(); for (const r of reviews) byWord.set(upper(r.word), [...(byWord.get(upper(r.word)) ?? []), r]);
  const adjByWord = new Map(adjudications.map(a => [upper(a.word), a]));
  let zero=0, one=0, twoPlus=0, agree=0, disagreements=0, resolved=0, adjudicatedResolved=0;
  for (const c of queue.candidates) {
    const rs = byWord.get(c.upper) ?? []; const distinct = new Set(rs.map(r=>r.reviewerId)).size; const classes = new Set(rs.map(r=>r.class));
    if (distinct===0) zero++; else if (distinct===1) one++; else { twoPlus++; if (classes.size === 1) { agree++; resolved++; } else if (adjByWord.has(c.upper)) { adjudicatedResolved++; resolved++; } else disagreements++; }
  }
  const coverage = { classes: countBy(queue.candidates.map(c => c.predictedClass)), lengths: countBy(queue.candidates.map(c => String(c.length))), strata: countBy(queue.candidates.flatMap(c => c.strata)) };
  const gates = readinessGates(queue, disagreements, zero, one);
  const readiness: GoldenReadiness = Object.values(gates).every(Boolean) ? 'READY' : queue.candidateCount ? 'DRAFT' : 'NOT_READY';
  return { targetCount: queue.targetCount, fixedHumanGoldenTarget: HUMAN_GOLDEN_TARGET, candidateCount: queue.candidateCount, shortfall: queue.shortfall, reviews: { zero, one, twoPlus, agreementRate: twoPlus ? Number((agree / twoPlus).toFixed(4)) : null, unresolvedDisagreements: disagreements, adjudicatedCount: adjudicatedResolved, resolvedCount: Math.max(0, resolved) }, coverage, gates, readiness };
}
const countBy = (xs: string[]) => xs.reduce<Record<string, number>>((m,x) => (m[x]=(m[x]??0)+1, m), {});

function readinessGates(queue: GoldenQueueArtifact, unresolvedDisagreements: number, zero: number, one: number) {
  return { fixedTargetMet: queue.candidateCount >= HUMAN_GOLDEN_TARGET, targetCountNotLowered: queue.targetCount >= HUMAN_GOLDEN_TARGET, allResolved: zero === 0 && one === 0 && unresolvedDisagreements === 0, queueChecksumFrozen: validateQueue(queue).length === 0 };
}

export function publishGolden(queue: GoldenQueueArtifact, reviews: HumanReview[], adjudications: GoldenAdjudication[] = [], opts: { draft?: boolean, version?: string } = {}): PublishedGoldenArtifact {
  const { items, unresolved, stats } = resolveItems(queue, reviews, adjudications);
  const duplicateGate = new Set(items.map(i => i.word)).size === items.length;
  const gates = { ...stats.gates, noDuplicates: duplicateGate, splitIntegrity: items.every(i => ['train','dev','holdout'].includes(i.split)) };
  const ready = Object.values(gates).every(Boolean); if (!ready && !opts.draft) throw new Error(`Golden Set is NOT_READY: ${JSON.stringify({ gates, unresolvedCount: unresolved.length, shortfall: queue.shortfall })}`);
  const unsignedManifest = { schemaVersion: 'golden-manifest-v1' as const, version: opts.version ?? 'human-golden-v1', readiness: stats.readiness, targetCount: queue.targetCount, itemCount: items.length, unresolvedCount: unresolved.length, checksum: '', queueChecksum: queue.checksum, source: queue.source, splitPolicy: { version: GOLDEN_SPLIT_POLICY_VERSION, train: 70, dev: 15, holdout: 15, protectedHoldout: true as const }, gates };
  const checksum = sha256({ manifest: { ...unsignedManifest, checksum: undefined }, items });
  return { schemaVersion: 'published-human-golden-v1', manifest: { ...unsignedManifest, checksum }, items };
}

export function validatePublishedGolden(golden: PublishedGoldenArtifact): string[] {
  const errors: string[] = [];
  if (golden.schemaVersion !== 'published-human-golden-v1') errors.push('golden: invalid schemaVersion');
  if (golden.manifest?.schemaVersion !== 'golden-manifest-v1') errors.push('golden.manifest: invalid schemaVersion');
  if (golden.manifest?.itemCount !== golden.items?.length) errors.push('golden.manifest: itemCount mismatch');
  const expected = sha256({ manifest: { ...golden.manifest, checksum: undefined }, items: golden.items });
  if (!golden.manifest?.checksum || golden.manifest.checksum !== expected) errors.push('golden.manifest: checksum mismatch');
  return errors;
}

export function evaluateGolden(golden: PublishedGoldenArtifact, dictionary: DictionaryArtifact) {
  const integrity = validatePublishedGolden(golden); if (integrity.length) throw new Error(integrity.join('\n'));
  const byWord = new Map(dictionary.records.map(r => [r.upper, r]));
  const rows = golden.items.map(i => ({ item: i, actual: byWord.get(i.word)?.class ?? 'MISSING' }));
  const classes = GOLDEN_CLASSES; const confusion: Record<string, Record<string, number>> = {}; for (const c of classes) confusion[c] = Object.fromEntries(classes.map(k => [k,0]));
  let correct = 0; for (const r of rows) if (r.actual !== 'MISSING') { confusion[r.item.class][r.actual]++; if (r.item.class === r.actual) correct++; }
  const perClass = Object.fromEntries(classes.map(c => { const tp=confusion[c][c]; const support=rows.filter(r=>r.item.class===c).length; const predicted=rows.filter(r=>r.actual===c).length; const precision=predicted?tp/predicted:0; const recall=support?tp/support:0; const f1=precision+recall?2*precision*recall/(precision+recall):0; return [c,{ precision:+precision.toFixed(4), recall:+recall.toFixed(4), f1:+f1.toFixed(4), support }]; }));
  const subset3 = rows.filter(r => r.item.word.length === 3); const acc = (rs: typeof rows) => rs.length ? +(rs.filter(r=>r.item.class===r.actual).length/rs.length).toFixed(4) : null;
  return { schemaVersion: 'golden-evaluator-report-v1', evaluatorVersion: GOLDEN_EVALUATOR_VERSION, readiness: golden.manifest.readiness, goldenChecksum: golden.manifest.checksum, dictionaryChecksum: dictionary.manifest.checksum, scoringVersion: golden.manifest.source.scoringVersion, metrics: { warning: golden.manifest.readiness === 'READY' ? undefined : 'NOT_READY/PARTIAL: metrics are workflow checks, not production calibration proof', overallAccuracy: acc(rows), perClass, confusionMatrix: confusion, target: perClass.TARGET, threeLetter: { accuracy: acc(subset3), support: subset3.length }, bySplit: Object.fromEntries(['train','dev','holdout'].map(s => [s, { accuracy: acc(rows.filter(r=>r.item.split===s)), support: rows.filter(r=>r.item.split===s).length }])), unresolvedCount: golden.manifest.unresolvedCount, missingCount: rows.filter(r=>r.actual==='MISSING').length } };
}

export function writeJson(path: string, value: unknown) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(value, null, 2) + '\n'); }
export function readJsonIfExists<T>(path: string, fallback: T): T { return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) as T : fallback; }
