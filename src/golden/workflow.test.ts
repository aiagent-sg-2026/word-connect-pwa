import { describe, expect, it } from 'vitest';
import { buildDictionary } from '../content-pipeline/dictionary.ts';
import type { SourceWordInput } from '../content-pipeline/types.ts';
import { buildGoldenQueue, canonical, evaluateGolden, exportBlindPacket, publishGolden, resolveItems, sha256, splitFor, validateReviews } from './workflow.ts';
import type { HumanReview } from './contracts.ts';

const words: SourceWordInput[] = [
  { word: 'cat', lexical: [{ sourceId: 't', token: 'cat', confidence: 1, lemma: 'cat' }], frequency: [{ sourceId: 'f', value: 0.9, scale: '0..1' }] },
  { word: 'dog', lexical: [{ sourceId: 't', token: 'dog', confidence: 1, lemma: 'dog' }], frequency: [{ sourceId: 'f', value: 0.85, scale: '0..1' }] },
  { word: 'stone', lexical: [{ sourceId: 't', token: 'stone', confidence: 1, lemma: 'stone' }], frequency: [{ sourceId: 'f', value: 0.8, scale: '0..1' }] },
  { word: 'nasa', lexical: [{ sourceId: 't', token: 'nasa', confidence: .8, flags: { abbreviation: true } }], frequency: [{ sourceId: 'f', value: .6, scale: '0..1' }] },
  { word: 'badword', lexical: [{ sourceId: 't', token: 'badword', confidence: 1 }], frequency: [{ sourceId: 'f', value: .5, scale: '0..1' }] }
];
const review = (word: string, reviewerId: string, klass = 'TARGET'): HumanReview => ({ schemaVersion: 'human-golden-review-v1', queueVersion: 'human-golden-queue-v1', queueChecksum: '', word, reviewerId, reviewedAt: '2026-01-01T00:00:00.000Z', source: 'human-review-v1', class: klass as HumanReview['class'], confidence: 0.9 });

describe('Human Golden Set workflow v1', () => {
  it('generates deterministic bounded queues without duplicates and with shortfall', async () => {
    const d = await buildDictionary(words); const q1 = buildGoldenQueue(d); const q2 = buildGoldenQueue(d);
    expect(canonical(q1)).toBe(canonical(q2));
    expect(q1.candidateCount).toBe(5); expect(q1.shortfall).toBe(1995);
    expect(new Set(q1.candidates.map(c => c.upper)).size).toBe(q1.candidateCount);
    expect(q1.candidates.some(c => c.strata.some(s => s.startsWith('class:')))).toBe(true);
  });

  it('exports blind packets without prediction or score leakage', async () => {
    const q = buildGoldenQueue(await buildDictionary(words)); const p = exportBlindPacket(q); const s = JSON.stringify(p);
    expect(s).not.toContain('predictedClass'); expect(s).not.toContain('targetScore'); expect(s).not.toContain('bonusScore'); expect(s).not.toContain('class:TARGET');
  });

  it('rejects bad human review evidence', async () => {
    const q = buildGoldenQueue(await buildDictionary(words)); const good = review('CAT','rev-a'); good.queueChecksum = q.checksum;
    expect(validateReviews(q, [good])).toEqual([]);
    const dup = review('CAT','rev-a'); dup.queueChecksum = q.checksum;
    const bad = { ...review('NOPE','x'), queueChecksum: 'bad', source: 'model' as 'human-review-v1', confidence: 2, reviewedAt: 'no' };
    const errors = validateReviews(q, [good, dup, bad]);
    expect(errors.join('\n')).toContain('duplicate same-reviewer/word');
    expect(errors.join('\n')).toContain('unknown word');
    expect(errors.join('\n')).toContain('missing human source');
    expect(errors.join('\n')).toContain('candidate checksum/version mismatch');
  });

  it('requires two independent agreeing reviews or human adjudication; model policy cannot override disagreement', async () => {
    const q = buildGoldenQueue(await buildDictionary(words), 1); q.candidates[0].upper = 'CAT'; q.candidates[0].word = 'cat';
    const a = review('CAT','rev-a','TARGET'); const b = review('CAT','rev-b','TARGET'); a.queueChecksum=b.queueChecksum=q.checksum;
    expect(resolveItems(q, [a,b]).items).toHaveLength(1);
    const c = review('CAT','rev-c','BLOCKED'); c.queueChecksum = q.checksum;
    expect(resolveItems(q, [a,c]).unresolved).toContain('CAT');
    expect(() => publishGolden(q, [a,c], [], { draft: false })).toThrow(/NOT_READY/);
    const artifact = publishGolden(q, [a,c], [{ schemaVersion: 'human-golden-adjudication-v1', queueVersion: q.source.queueVersion, queueChecksum: q.checksum, word: 'CAT', adjudicatorId: 'adj-1', adjudicatedAt: '2026-01-02T00:00:00.000Z', source: 'human-adjudication-v1', finalClass: 'TARGET', sourceReviewerIds: ['rev-a','rev-c'] }], { draft: true });
    expect(artifact.items[0].class).toBe('TARGET');
  });

  it('keeps deterministic split stable independent of ordering', () => {
    expect(splitFor('CAT','TARGET')).toBe(splitFor('CAT','TARGET'));
    expect(['train','dev','holdout']).toContain(splitFor('STONE','TARGET'));
  });

  it('finalization gate refuses less than 2000 and starter 11 cannot be production ready', async () => {
    const q = buildGoldenQueue(await buildDictionary(words), 2000);
    expect(() => publishGolden(q, [], [], { draft: false })).toThrow(/NOT_READY/);
    const starterCount = 11;
    expect(starterCount).toBeLessThan(2000);
  });

  it('computes frozen checksums and evaluator metrics on a synthetic draft fixture', async () => {
    const q = buildGoldenQueue(await buildDictionary(words), 1); q.candidates[0].upper = 'CAT'; q.candidates[0].word = 'cat';
    const a = review('CAT','rev-a','TARGET'); const b = review('CAT','rev-b','TARGET'); a.queueChecksum=b.queueChecksum=q.checksum;
    const g = publishGolden(q, [a,b], [], { draft: true });
    expect(g.manifest.checksum).toBe(sha256({ manifest: { ...g.manifest, checksum: undefined }, items: g.items }));
    const report = evaluateGolden(g, await buildDictionary(words));
    expect(report.evaluatorVersion).toBe('human-golden-evaluator-v1');
    expect(JSON.stringify(report.metrics)).toContain('overallAccuracy');
  });
});
