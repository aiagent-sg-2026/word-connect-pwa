import { normalizeEnglishV1 } from './normalize.ts';
import type { InflectionType, SourceWordInput } from './types.ts';

export const ESDB_SOURCE_ID = 'esdb-v2-1e5b7d3';

export interface EsdbRow {
  word: string;
  size: number;
  spelling: string;
  region: string;
  variant_level: string | number;
  pos: string;
  base_pos: string;
  pos_class: string;
  pos_category: string;
  lemma?: string;
}

export interface EsdbImportReport {
  inputRows: number;
  uniqueInputs: number;
  acceptedInputs: number;
  duplicateNormalizations: number;
  rejected: Record<string, number>;
  byLength: Record<string, number>;
  byCommonnessSize: Record<string, number>;
  byDialect: Record<string, number>;
  byClassHint: Record<string, number>;
}

const properClasses = new Set(['name', 'name?', 'person', 'place', 'surname', 'trademark']);
const abbreviationClasses = new Set(['abbr', 'abbr?']);
const technicalPos = new Set(['wp', 'we']);

function inflectionFromPos(pos: string): InflectionType {
  if (pos.endsWith('0')) return 'base';
  if (pos.endsWith('s')) return 'plural';
  if (pos.endsWith('d')) return 'past';
  if (pos.endsWith('g')) return 'gerund';
  if (pos.endsWith('r')) return 'comparative';
  if (pos.endsWith('t')) return 'superlative';
  return 'other';
}

function commonnessFromSize(size: number): number {
  // ESDB size is a vetted inclusion/commonness bucket, not corpus frequency.
  return Number(Math.max(0, Math.min(1, (85 - size) / 50)).toFixed(4));
}

export function rowsToSourceInputs(rows: EsdbRow[], opts = { includeReviewExamples: true }): { inputs: SourceWordInput[]; report: EsdbImportReport } {
  const grouped = new Map<string, EsdbRow[]>();
  const rejected: Record<string, number> = {};
  const reject = (reason: string) => { rejected[reason] = (rejected[reason] ?? 0) + 1; };
  for (const row of rows) {
    const n = normalizeEnglishV1(row.word);
    const proper = properClasses.has(row.pos_class);
    const abbr = abbreviationClasses.has(row.pos_class) || row.base_pos === 'abbr';
    const special = ['nonword', 'special', 'wordpart'].includes(row.pos_category);
    const invalid = !n.ok;
    const reviewExample = opts.includeReviewExamples && (proper || abbr || invalid || special);
    if (!reviewExample && (proper || abbr || special)) { reject(proper ? 'proper-name' : abbr ? 'abbreviation' : 'special-category'); continue; }
    if (!reviewExample && invalid) { reject('unsupported-token'); continue; }
    if (invalid && !reviewExample) continue;
    const key = n.ok ? n.lower! : row.word.normalize('NFC');
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }
  const inputs: SourceWordInput[] = [];
  for (const [word, rs] of [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const bestSize = Math.min(...rs.map(r => Number(r.size)));
    const n = normalizeEnglishV1(word);
    const reviewRows = rs.filter(r => properClasses.has(r.pos_class) || abbreviationClasses.has(r.pos_class) || r.base_pos === 'abbr' || ['nonword', 'special', 'wordpart'].includes(r.pos_category) || !normalizeEnglishV1(r.word).ok);
    const rowsForEvidence = rs.sort((a, b) => Number(a.size) - Number(b.size) || String(a.pos).localeCompare(String(b.pos))).slice(0, 6);
    inputs.push({
      word,
      lexical: rowsForEvidence.map(r => {
        const lemma = r.lemma && normalizeEnglishV1(r.lemma).ok ? normalizeEnglishV1(r.lemma).lower! : undefined;
        const tokenOk = normalizeEnglishV1(r.word).ok;
        return {
          sourceId: ESDB_SOURCE_ID,
          token: r.word,
          confidence: 0.92,
          pos: [r.base_pos || r.pos].filter(Boolean),
          lemma,
          dialects: r.spelling === 'A' || r.region === 'US' ? ['en-US'] : ['en'],
          flags: {
            properNoun: properClasses.has(r.pos_class),
            abbreviation: abbreviationClasses.has(r.pos_class) || r.base_pos === 'abbr',
            technical: technicalPos.has(r.pos) || r.pos_category === 'wordpart'
          },
          morphology: tokenOk && lemma ? { contractVersion: 'morphology-v1' as const, sourceId: ESDB_SOURCE_ID, token: normalizeEnglishV1(r.word).lower!, lemma, inflectionOf: lemma, inflectionType: inflectionFromPos(r.pos), provenance: 'ESDB scowl_ lemma_id/words join; basic inflection inferred from ESDB POS code suffix', confidence: 'medium' as const } : undefined
        };
      }),
      commonness: n.ok ? [{ sourceId: ESDB_SOURCE_ID, value: commonnessFromSize(bestSize), scale: '0..1', heuristic: 'esdb-size-v1', note: 'Derived from ESDB size bucket; not corpus frequency.' }] : [],
      policy: reviewRows.length ? [{ sourceId: `${ESDB_SOURCE_ID}-hard-gate`, reasons: reviewRows.some(r => !normalizeEnglishV1(r.word).ok) ? ['INVALID_TOKEN'] : reviewRows.some(r => abbreviationClasses.has(r.pos_class) || r.base_pos === 'abbr') ? ['ABBREVIATION'] : ['PROPER_NOUN'] }] : []
    });
  }
  const accepted = inputs.filter(i => normalizeEnglishV1(i.word).ok);
  const countBy = (xs: string[]) => xs.reduce<Record<string, number>>((m, x) => (m[x] = (m[x] ?? 0) + 1, m), {});
  return { inputs, report: { inputRows: rows.length, uniqueInputs: grouped.size, acceptedInputs: accepted.length, duplicateNormalizations: rows.length - grouped.size, rejected, byLength: countBy(accepted.map(i => String(normalizeEnglishV1(i.word).upper!.length))), byCommonnessSize: countBy(rows.map(r => String(r.size))), byDialect: countBy(rows.map(r => r.spelling === 'A' || r.region === 'US' ? 'en-US' : 'en')), byClassHint: countBy(inputs.map(i => i.policy?.length ? 'REVIEW' : 'LEXICAL')) } };
}
