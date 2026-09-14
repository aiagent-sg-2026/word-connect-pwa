import { describe, expect, it } from 'vitest';
import { buildDictionary } from './dictionary.ts';
import { generateLabCampaign, validateGenerated, buildSignatureIndex } from './generator.ts';
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

  it('indexes signatures with exact repeated-letter multisets', async () => {
    const d = await buildDictionary(fixture);
    const idx = buildSignatureIndex(d.records);
    expect(idx.get('ACT')?.words).toContain('CAT');
    expect(canConstructExact('MOON', ['M','O','N'])).toBe(false);
    expect(canConstructExact('MONO', ['M','O','O','N'])).toBe(true);
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
