import { describe, expect, it } from 'vitest';
import { buildDictionary } from './dictionary.ts';
import { computeGeneratedLevelHash, findCandidatesForRack, generateLabCampaign, validateGenerated, buildCandidateLookup, buildSignatureIndex } from './generator.ts';
import { canonical, sha256 } from './hash.ts';
import { canConstructExact, countsOf, normalizeEnglishV1, signatureOf } from './normalize.ts';
import type { SourceWordInput } from './types.ts';

const fixture: SourceWordInput[] = [
  { word: 'cat', lexical: [{ sourceId: 'lex', token: 'cat', confidence: 0.95, dialects: ['en'] }], frequency: [{ sourceId: 'freq', value: 0.9, scale: '0..1' }], policy: [{ sourceId: 'policy', class: 'TARGET', reasons: ['OK_TARGET'] }] },
  { word: 'act', lexical: [{ sourceId: 'lex', token: 'act', confidence: 0.9, dialects: ['en'] }], frequency: [{ sourceId: 'freq', value: 0.84, scale: '0..1' }], policy: [{ sourceId: 'policy', class: 'TARGET', reasons: ['OK_TARGET'] }] },
  { word: 'tac', lexical: [{ sourceId: 'lex', token: 'tac', confidence: 0.82, dialects: ['en'] }], frequency: [{ sourceId: 'freq', value: 0.7, scale: '0..1' }], policy: [{ sourceId: 'policy', class: 'BONUS', reasons: ['OK_BONUS'] }] },
  { word: 'at', lexical: [{ sourceId: 'lex', token: 'at', confidence: 0.9, dialects: ['en'] }], frequency: [{ sourceId: 'freq', value: 0.95, scale: '0..1' }], policy: [{ sourceId: 'policy', class: 'ACCEPT_ONLY', reasons: ['OK_ACCEPT_ONLY'] }] },
  { word: 'badword', lexical: [{ sourceId: 'lex', token: 'badword', confidence: 0.9, dialects: ['en'] }], frequency: [{ sourceId: 'freq', value: 0.7, scale: '0..1' }], policy: [{ sourceId: 'policy', class: 'BLOCKED', reasons: ['UNSAFE_EXACT_TOKEN'] }] },
  { word: 'Alice', lexical: [{ sourceId: 'lex', token: 'Alice', confidence: 0.9, dialects: ['en'], flags: { properNoun: true } }], frequency: [{ sourceId: 'freq', value: 0.7, scale: '0..1' }] },
  { word: 'nasa', lexical: [{ sourceId: 'lex', token: 'nasa', confidence: 0.9, dialects: ['en'], flags: { abbreviation: true } }], frequency: [{ sourceId: 'freq', value: 0.7, scale: '0..1' }] },
  { word: "can't", lexical: [{ sourceId: 'lex', token: "can't", confidence: 0.9, dialects: ['en'] }], frequency: [{ sourceId: 'freq', value: 0.7, scale: '0..1' }] },
  { word: 'dog', lexical: [{ sourceId: 'lex', token: 'dog', confidence: 0.95, dialects: ['en'] }], frequency: [{ sourceId: 'freq', value: 0.91, scale: '0..1' }], policy: [{ sourceId: 'policy', class: 'TARGET', reasons: ['OK_TARGET'] }] },
  { word: 'god', lexical: [{ sourceId: 'lex', token: 'god', confidence: 0.9, dialects: ['en'] }], frequency: [{ sourceId: 'freq', value: 0.82, scale: '0..1' }], policy: [{ sourceId: 'policy', class: 'TARGET', reasons: ['OK_TARGET'] }] }
];

describe('content pipeline', () => {
  it('normalizes deterministically without silent apostrophe hyphen or accent changes', () => {
    expect(normalizeEnglishV1(' Cat ').upper).toBe('CAT');
    expect(normalizeEnglishV1("can't").ok).toBe(false);
    expect(normalizeEnglishV1('co-op').ok).toBe(false);
    expect(normalizeEnglishV1('café').ok).toBe(false);
    expect(signatureOf('MOON')).toBe('MNOO');
    expect(countsOf('MOON')).toEqual({ M: 1, N: 1, O: 2 });
  });

  it('separates classes and gates REVIEW/BLOCKED/proper nouns/abbreviations', async () => {
    const d = await buildDictionary(fixture);
    const by = new Map(d.records.map(r => [r.upper, r]));
    expect(by.get('CAT')?.class).toBe('TARGET');
    expect(by.get('TAC')?.class).toBe('BONUS');
    expect(by.get('AT')?.class).toBe('ACCEPT_ONLY');
    expect(by.get('BADWORD')?.class).toBe('BLOCKED');
    expect(by.get('ALICE')?.class).toBe('REVIEW');
    expect(by.get('NASA')?.class).toBe('REVIEW');
    expect([...by.values()].filter(r => r.class === 'REVIEW').every(r => r.reasons.includes('REVIEW_REQUIRED'))).toBe(true);
    const invalidOverride = await buildDictionary([{ word: "can't", lexical: [{ sourceId: 'lex', token: "can't", confidence: 1, dialects: ['en'] }], frequency: [{ sourceId: 'freq', value: 1, scale: '0..1' }], policy: [{ sourceId: 'bad-policy', class: 'TARGET', reasons: ['POLICY_OVERRIDE'] }] }]);
    expect(invalidOverride.records[0].class).toBe('REVIEW');
  });

  it('uses explicit short target thresholds in scoring', async () => {
    const d = await buildDictionary([{ word: 'owl', lexical: [{ sourceId: 'lex', token: 'owl', confidence: 0.5, dialects: ['en'] }], frequency: [{ sourceId: 'freq', value: 0.35, scale: '0..1' }] }]);
    expect(d.records[0].targetScore?.reasons).toContain('SHORT_TARGET_STRICT');
    expect(d.records[0].class).not.toBe('TARGET');
  });

  it('indexes signatures and looks up candidates with exact repeated-letter multisets', async () => {
    const d = await buildDictionary([
      ...fixture,
      { word: 'moon', lexical: [{ sourceId: 'lex', token: 'moon', confidence: 0.95, dialects: ['en'] }], frequency: [{ sourceId: 'freq', value: 0.9, scale: '0..1' }], policy: [{ sourceId: 'policy', class: 'TARGET', reasons: ['OK_TARGET'] }] },
      { word: 'mono', lexical: [{ sourceId: 'lex', token: 'mono', confidence: 0.95, dialects: ['en'] }], frequency: [{ sourceId: 'freq', value: 0.9, scale: '0..1' }], policy: [{ sourceId: 'policy', class: 'BONUS', reasons: ['OK_BONUS'] }] },
      { word: 'mom', lexical: [{ sourceId: 'lex', token: 'mom', confidence: 0.95, dialects: ['en'] }], frequency: [{ sourceId: 'freq', value: 0.9, scale: '0..1' }], policy: [{ sourceId: 'policy', class: 'TARGET', reasons: ['OK_TARGET'] }] }
    ]);
    const idx = buildSignatureIndex(d.records);
    expect(idx.get('ACT')?.words).toContain('CAT');
    const lookup = buildCandidateLookup(d.records);
    const stats = { indexEntriesVisited: 0, candidateWordsReturned: 0 };
    const words = findCandidatesForRack(lookup, ['M','O','O','N'], stats).map(r => r.upper);
    expect(words).toEqual(expect.arrayContaining(['MOON', 'MONO']));
    expect(words).not.toContain('MOM');
    expect(stats.indexEntriesVisited).toBeGreaterThan(0);
    expect(stats.candidateWordsReturned).toBe(words.length);
    expect(canConstructExact('MOON', ['M','O','N'])).toBe(false);
    expect(canConstructExact('MONO', ['M','O','O','N'])).toBe(true);
  });

  it('formalizes morphology metadata and reviews conflicting evidence safely', async () => {
    const d = await buildDictionary([
      { word: 'play', lexical: [{ sourceId: 'lex-a', token: 'play', confidence: 0.95, pos: ['verb'], morphology: { contractVersion: 'morphology-v1', sourceId: 'morph-a', token: 'play', lemma: 'play', inflectionOf: 'play', inflectionType: 'base', provenance: 'qa-seed', confidence: 'high' } }], frequency: [{ sourceId: 'freq', value: 0.9, scale: '0..1' }], policy: [{ sourceId: 'policy', class: 'TARGET', reasons: ['OK_TARGET'] }] },
      { word: 'cats', lexical: [{ sourceId: 'lex-a', token: 'cats', confidence: 0.95, pos: ['noun'], morphology: { contractVersion: 'morphology-v1', sourceId: 'morph-a', token: 'cats', lemma: 'cat', inflectionOf: 'cat', inflectionType: 'plural', provenance: 'qa-seed', confidence: 'high' } }], frequency: [{ sourceId: 'freq', value: 0.9, scale: '0..1' }] },
      { word: 'played', lexical: [{ sourceId: 'lex-a', token: 'played', confidence: 0.95, pos: ['verb'], morphology: { contractVersion: 'morphology-v1', sourceId: 'morph-a', token: 'played', lemma: 'play', inflectionOf: 'play', inflectionType: 'past', provenance: 'qa-seed', confidence: 'high' } }], frequency: [{ sourceId: 'freq', value: 0.9, scale: '0..1' }] },
      { word: 'playing', lexical: [{ sourceId: 'lex-a', token: 'playing', confidence: 0.95, pos: ['verb'], morphology: { contractVersion: 'morphology-v1', sourceId: 'morph-a', token: 'playing', lemma: 'play', inflectionOf: 'play', inflectionType: 'gerund', provenance: 'qa-seed', confidence: 'high' } }], frequency: [{ sourceId: 'freq', value: 0.9, scale: '0..1' }] },
      { word: 'axes', lexical: [
        { sourceId: 'lex-a', token: 'axes', confidence: 0.95, morphology: { contractVersion: 'morphology-v1', sourceId: 'morph-a', token: 'axes', lemma: 'axis', inflectionOf: 'axis', inflectionType: 'plural', provenance: 'qa-seed', confidence: 'high' } },
        { sourceId: 'lex-b', token: 'axes', confidence: 0.95, morphology: { contractVersion: 'morphology-v1', sourceId: 'morph-b', token: 'axes', lemma: 'axe', inflectionOf: 'axe', inflectionType: 'plural', provenance: 'qa-seed', confidence: 'high' } }
      ], frequency: [{ sourceId: 'freq', value: 0.9, scale: '0..1' }], policy: [{ sourceId: 'policy', class: 'TARGET', reasons: ['OK_TARGET'] }] }
    ]);
    const by = new Map(d.records.map(r => [r.upper, r]));
    expect(by.get('PLAY')?.morphology?.inflectionType).toBe('base');
    expect(by.get('CATS')?.morphology?.inflectionType).toBe('plural');
    expect(by.get('PLAYED')?.morphology?.inflectionType).toBe('past');
    expect(by.get('PLAYING')?.morphology?.inflectionType).toBe('gerund');
    expect(by.get('AXES')?.flags.morphologyConflict).toBe(true);
    expect(by.get('AXES')?.class).toBe('REVIEW');
    expect(by.get('AXES')?.reasons).toContain('MORPHOLOGY_CONFLICT');
  });

  it('verifier hash helpers reject tampered lab level and campaign hashes', async () => {
    const d = await buildDictionary(fixture);
    const { campaign } = await generateLabCampaign(d.records, { seed: 'same', maxLevels: 2 });
    const tamperedLevel = { ...campaign.levels[0], targets: [...campaign.levels[0].targets, 'ZZZ'] };
    expect(await computeGeneratedLevelHash(tamperedLevel)).not.toBe(campaign.levels[0].hash);
    expect(await sha256(canonical({ campaignVersion: campaign.campaignVersion, contentVersion: campaign.contentVersion, levels: campaign.levels.map(l => l.hash) }))).toBe(campaign.campaignHash);
    expect(await sha256(canonical({ campaignVersion: campaign.campaignVersion, contentVersion: campaign.contentVersion, levels: ['bad', ...campaign.levels.slice(1).map(l => l.hash)] }))).not.toBe(campaign.campaignHash);
  });

  it('generates deterministic constructible duplicate-free lab campaigns and rejects forbidden targets', async () => {
    const d = await buildDictionary(fixture);
    const a = await generateLabCampaign(d.records, { seed: 'same', maxLevels: 10 });
    const b = await generateLabCampaign(d.records, { seed: 'same', maxLevels: 10 });
    const c = await generateLabCampaign(d.records, { seed: 'different', maxLevels: 10 });
    expect(canonical(a.campaign)).toBe(canonical(b.campaign));
    expect(await sha256(canonical(a.campaign))).toBe(await sha256(canonical(b.campaign)));
    expect(canonical(a.campaign)).not.toBe(canonical(c.campaign));
    validateGenerated(a.campaign, d.records);
    const forbidden = new Set(['BADWORD', 'ALICE', 'NASA']);
    expect(a.campaign.levels.flatMap(l => l.targets).some(w => forbidden.has(w))).toBe(false);
    for (const level of a.campaign.levels) for (const t of level.targets) expect(canConstructExact(t, level.letters)).toBe(true);
  });
});
