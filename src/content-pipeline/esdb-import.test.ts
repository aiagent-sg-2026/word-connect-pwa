import { describe, expect, it } from 'vitest';
import { buildDictionary } from './dictionary.ts';
import { rowsToSourceInputs, type EsdbRow } from './esdb-import.ts';

const row = (word: string, extra: Partial<EsdbRow> = {}): EsdbRow => ({ word, size: 60, spelling: '_', region: '', variant_level: 0, pos: 'n0', base_pos: 'n', pos_class: '', pos_category: '', lemma: word, ...extra });

describe('ESDB import adapter', () => {
  it('is deterministic and records ESDB commonness without fabricating frequency', async () => {
    const rows = [row('pear', { size: 50 }), row('apple', { size: 35 }), row('pear', { pos: 'ns', lemma: 'pear' })];
    const a = rowsToSourceInputs(rows);
    const b = rowsToSourceInputs([...rows].reverse());
    expect(JSON.stringify(a.inputs)).toBe(JSON.stringify(b.inputs));
    const d = await buildDictionary(a.inputs, 'test-esdb', 'test');
    const pear = d.records.find(r => r.word === 'pear')!;
    expect(pear.frequency).toBe(0);
    expect(pear.frequencySignals).toEqual([]);
    expect(pear.commonness).toBeGreaterThan(0);
    expect(pear.commonnessSignals[0].heuristic).toBe('esdb-size-v1');
  });

  it('handles duplicate normalization, punctuation and accents without deaccenting', async () => {
    const { inputs, report } = rowsToSourceInputs([row('Cafe'), row('cafe'), row('café'), row("can't")]);
    expect(report.duplicateNormalizations).toBeGreaterThan(0);
    const d = await buildDictionary(inputs, 'test-esdb', 'test');
    const by = new Map(d.records.map(r => [r.word, r]));
    expect(by.get('cafe')?.lexicalEvidence.map(e => e.token)).toContain('Cafe');
    expect(by.get('café')?.class).toBe('REVIEW');
    expect(by.get("can't")?.class).toBe('REVIEW');
    expect(by.get('café')?.flags.invalidToken).toBe(true);
  });

  it('review-gates abbreviations and proper names from ESDB metadata', async () => {
    const { inputs } = rowsToSourceInputs([row('NASA', { base_pos: 'abbr', pos_class: 'abbr' }), row('Alice', { pos_class: 'person' }), row('orange')]);
    const d = await buildDictionary(inputs, 'test-esdb', 'test');
    const by = new Map(d.records.map(r => [r.upper, r]));
    expect(by.get('NASA')?.class).toBe('REVIEW');
    expect(by.get('NASA')?.reasons).toContain('ABBREVIATION');
    expect(by.get('ALICE')?.class).toBe('REVIEW');
    expect(by.get('ALICE')?.reasons).toContain('PROPER_NOUN');
    expect(by.get('ORANGE')?.flags.properNoun).toBe(false);
  });
});
