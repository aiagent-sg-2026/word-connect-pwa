import { describe, expect, it } from 'vitest';
import { buildDictionary } from '../content-pipeline/dictionary.ts';
import type { SourceWordInput } from '../content-pipeline/types.ts';
import { buildGoldenQueue, canonical, evaluateGolden, exportBlindPacket, parseCsv, parseReviewsFile, publishGolden, queueChecksum, resolveItems, sha256, splitFor, statusStats, toCsv, validateQueue, validateReviews } from './workflow.ts';
import type { GoldenAdjudication, HumanReview } from './contracts.ts';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const words: SourceWordInput[] = [
  { word: 'cat', lexical: [{ sourceId: 't', token: 'cat', confidence: 1, lemma: 'cat' }], frequency: [{ sourceId: 'f', value: 0.9, scale: '0..1' }] },
  { word: 'dog', lexical: [{ sourceId: 't', token: 'dog', confidence: 1, lemma: 'dog' }], frequency: [{ sourceId: 'f', value: 0.85, scale: '0..1' }] },
  { word: 'stone', lexical: [{ sourceId: 't', token: 'stone', confidence: 1, lemma: 'stone' }], frequency: [{ sourceId: 'f', value: 0.8, scale: '0..1' }] },
  { word: 'nasa', lexical: [{ sourceId: 't', token: 'nasa', confidence: .8, flags: { abbreviation: true } }], frequency: [{ sourceId: 'f', value: .6, scale: '0..1' }] },
  { word: 'badword', lexical: [{ sourceId: 't', token: 'badword', confidence: 1 }], frequency: [{ sourceId: 'f', value: .5, scale: '0..1' }] }
];
const review = (word: string, checksum: string, reviewerId: string, klass = 'TARGET'): HumanReview => ({ schemaVersion: 'human-golden-review-v1', queueVersion: 'human-golden-queue-v1', queueChecksum: checksum, word, reviewerId, reviewedAt: '2026-01-01T00:00:00.000Z', source: 'human-review-v1', class: klass as HumanReview['class'], confidence: 0.9 });
const adjudication = (word: string, checksum: string, adjudicatorId = 'adj-1', sourceReviewerIds = ['rev-a','rev-b'], finalClass: HumanReview['class'] = 'TARGET'): GoldenAdjudication => ({ schemaVersion: 'human-golden-adjudication-v1', queueVersion: 'human-golden-queue-v1', queueChecksum: checksum, word, adjudicatorId, adjudicatedAt: '2026-01-02T00:00:00.000Z', source: 'human-adjudication-v1', finalClass, sourceReviewerIds });

describe('Human Golden Set workflow v1', () => {
  it('generates deterministic bounded queues without duplicates and with shortfall', async () => {
    const d = await buildDictionary(words); const q1 = buildGoldenQueue(d); const q2 = buildGoldenQueue(d);
    expect(canonical(q1)).toBe(canonical(q2));
    expect(q1.candidateCount).toBe(5); expect(q1.shortfall).toBe(1995);
    expect(validateQueue(q1)).toEqual([]);
    expect(new Set(q1.candidates.map(c => c.upper)).size).toBe(q1.candidateCount);
  });

  it('exports blind packets without prediction, score, reason, class, band, flag, or review-required leakage', async () => {
    const q = buildGoldenQueue(await buildDictionary(words)); const p = exportBlindPacket(q); const s = JSON.stringify(p);
    expect(s).not.toMatch(/predictedClass|targetScore|bonusScore|reason|class:|band:|flag:|review-required|review-not-required/i);
    expect(Object.keys(p.rows[0])).toEqual(['queueVersion','queueChecksum','word','candidateId','length','reviewerId','reviewedAt','source','class','confidence','note']);
  });

  it('rejects bad human review evidence and same reviewer duplicates', async () => {
    const q = buildGoldenQueue(await buildDictionary(words)); const w = q.candidates[0].upper; const good = review(w, q.checksum, 'rev-a');
    expect(validateReviews(q, [good])).toEqual([]);
    const dup = review(w, q.checksum, 'rev-a');
    const bad = { ...review('NOPE', 'bad', 'xx'), source: 'model' as 'human-review-v1', confidence: 2, reviewedAt: 'no' };
    const errors = validateReviews(q, [good, dup, bad]);
    expect(errors.join('\n')).toContain('duplicate same-reviewer/word');
    expect(errors.join('\n')).toContain('unknown word');
    expect(errors.join('\n')).toContain('missing human source');
    expect(errors.join('\n')).toContain('candidate checksum/version mismatch');
  });

  it('enforces two-human-review and third-party adjudication invariants', async () => {
    const q = buildGoldenQueue(await buildDictionary(words), 1); const w = q.candidates[0].upper;
    const a = review(w, q.checksum, 'rev-a', 'TARGET'); const b = review(w, q.checksum, 'rev-b', 'TARGET'); const c = review(w, q.checksum, 'rev-b', 'BLOCKED');
    expect(resolveItems(q, [a,b]).items).toHaveLength(1);
    expect(resolveItems(q, [a,c]).unresolved).toContain(w);
    expect(() => resolveItems(q, [a], [adjudication(w, q.checksum)])).toThrow(/at least two distinct human reviews/);
    expect(() => resolveItems(q, [a,c], [adjudication(w, q.checksum, 'rev-a')])).toThrow(/adjudicator must be distinct/);
    expect(resolveItems(q, [a,c], [adjudication(w, q.checksum, 'adj-1', ['rev-a','rev-b'], 'BLOCKED')]).items[0].class).toBe('BLOCKED');
  });

  it('keeps status and publish readiness parity after valid adjudication', async () => {
    const q = buildGoldenQueue(await buildDictionary(words), 1); const w = q.candidates[0].upper;
    const a = review(w, q.checksum, 'rev-a', 'TARGET'); const b = review(w, q.checksum, 'rev-b', 'BLOCKED'); const adj = adjudication(w, q.checksum, 'adj-1', ['rev-a','rev-b'], 'TARGET');
    const status = statusStats(q, [a,b], [adj]);
    const artifact = publishGolden(q, [a,b], [adj], { draft: true });
    expect(status.reviews.unresolvedDisagreements).toBe(0);
    expect(status.readiness).toBe('DRAFT');
    expect(artifact.manifest.readiness).toBe(status.readiness);
    expect(artifact.manifest.gates.fixedTargetMet).toBe(false);
  });

  it('refuses production READY when targetCount is lowered below fixed 2000', async () => {
    const q = buildGoldenQueue(await buildDictionary(words), 1); const w = q.candidates[0].upper;
    const a = review(w, q.checksum, 'rev-a', 'TARGET'); const b = review(w, q.checksum, 'rev-b', 'TARGET');
    expect(() => publishGolden(q, [a,b], [], { draft: false })).toThrow(/NOT_READY/);
    expect(statusStats(q, [a,b]).gates.fixedTargetMet).toBe(false);
  });

  it('fails closed on tampered queue candidates, target, source, and checksum', async () => {
    const q = buildGoldenQueue(await buildDictionary(words));
    expect(validateQueue({ ...q, targetCount: 1 })).toContain('queue: checksum mismatch');
    expect(validateQueue({ ...q, checksum: 'truthy' })).toContain('queue: checksum mismatch');
    expect(validateQueue({ ...q, source: { ...q.source, dictionaryChecksum: 'tampered' } })).toContain('queue: checksum mismatch');
    const tampered = { ...q, candidates: [{ ...q.candidates[0], upper: 'ZZZ' }, ...q.candidates.slice(1)] };
    expect(() => exportBlindPacket(tampered)).toThrow(/checksum mismatch/);
  });

  it('rejects tampered published Golden before eval', async () => {
    const q = buildGoldenQueue(await buildDictionary(words), 1); const w = q.candidates[0].upper;
    const a = review(w, q.checksum, 'rev-a', 'TARGET'); const b = review(w, q.checksum, 'rev-b', 'TARGET');
    const g = publishGolden(q, [a,b], [], { draft: true });
    expect(g.manifest.checksum).toBe(sha256({ manifest: { ...g.manifest, checksum: undefined }, items: g.items }));
    const tampered = { ...g, items: [{ ...g.items[0], class: 'BLOCKED' as const }] };
    const d = await buildDictionary(words);
    expect(() => evaluateGolden(tampered, d)).toThrow(/checksum mismatch/);
  });

  it('keeps deterministic split stable independent of ordering', () => {
    expect(splitFor('CAT','TARGET')).toBe(splitFor('CAT','TARGET'));
    expect(['train','dev','holdout']).toContain(splitFor('STONE','TARGET'));
  });

  it('CSV roundtrips quoted comma, quote, and newline note fields', async () => {
    const q = buildGoldenQueue(await buildDictionary(words), 1); const w = q.candidates[0].upper;
    const rows = [{ queueVersion: q.source.queueVersion, queueChecksum: q.checksum, word: w, reviewerId: 'rev-a', reviewedAt: '2026-01-01T00:00:00.000Z', source: 'human-review-v1', class: 'TARGET', confidence: 0.8, reason: 'ok', note: 'comma, quote " and\nnewline' }];
    const csv = toCsv(rows); const parsed = parseCsv(csv);
    expect(parsed[0].note).toBe('comma, quote " and\nnewline');
    const dir = mkdtempSync(join(tmpdir(), 'golden-csv-')); const file = join(dir, 'reviews.csv'); writeFileSync(file, csv);
    expect(parseReviewsFile(file)[0].confidence).toBe(0.8);
    expect(validateReviews(q, parseReviewsFile(file))).toEqual([]);
    const invalid = join(dir, 'invalid.csv'); writeFileSync(invalid, csv.replace('rev-a', 'x'));
    expect(validateReviews(q, parseReviewsFile(invalid)).length).toBeGreaterThan(0);
    expect(readFileSync(file, 'utf8')).toBe(csv);
  });

  it('current 187-style shortfall remains draft/not ready with zero human reviews', async () => {
    const q = buildGoldenQueue(await buildDictionary(words), 2000);
    const status = statusStats(q, []);
    expect(status.shortfall).toBe(1995);
    expect(status.reviews.zero).toBe(q.candidateCount);
    expect(status.readiness).not.toBe('READY');
  });
});
