import { canonical, sha256 } from './hash.ts';
import { normalizeEnglishV1, signatureOf } from './normalize.ts';
import { scoreBonus, scoreTarget, SCORE_POLICY_V1_PROVISIONAL } from './scoring.ts';
import type { DictionaryArtifact, ReasonCode, SourceWordInput, WordClass, WordRecord } from './types.ts';

const unsafeExact = new Set(['BADWORD']);

function chooseClass(record: WordRecord): WordClass {
  if (record.targetScore?.reasons.some(r => ['INVALID_TOKEN','SOURCE_CONFLICT','PROPER_NOUN','ABBREVIATION','UNSAFE_EXACT_TOKEN'].includes(r))) {
    return record.flags.offensive ? 'BLOCKED' : 'REVIEW';
  }
  for (const p of record.policyOverrides) if (p.class) return p.class;
  if (record.targetScore?.score !== undefined) {
    const threshold = record.length === 3 ? SCORE_POLICY_V1_PROVISIONAL.thresholds.target3 : SCORE_POLICY_V1_PROVISIONAL.thresholds.target;
    if (record.targetScore.score >= threshold) return 'TARGET';
  }
  if ((record.bonusScore?.score ?? 0) >= SCORE_POLICY_V1_PROVISIONAL.thresholds.bonus) return 'BONUS';
  return 'ACCEPT_ONLY';
}

export async function buildDictionary(inputs: SourceWordInput[], version = 'dict-qa-seed-v1'): Promise<DictionaryArtifact> {
  const byWord = new Map<string, SourceWordInput[]>();
  for (const input of inputs) {
    const n = normalizeEnglishV1(input.word);
    const key = n.ok ? n.lower! : input.word.trim().normalize('NFC');
    byWord.set(key, [...(byWord.get(key) ?? []), input]);
  }
  const records: WordRecord[] = [];
  for (const [key, grouped] of [...byWord.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const n = normalizeEnglishV1(key);
    const lexicalEvidence = grouped.flatMap(g => g.lexical ?? []);
    const frequencySignals = grouped.flatMap(g => g.frequency ?? []);
    const policyOverrides = grouped.flatMap(g => g.policy ?? []);
    const flags = {
      properNoun: lexicalEvidence.some(e => e.flags?.properNoun),
      abbreviation: lexicalEvidence.some(e => e.flags?.abbreviation),
      offensive: unsafeExact.has(key.toLocaleUpperCase('en-US')) || policyOverrides.some(p => p.class === 'BLOCKED'),
      archaic: lexicalEvidence.some(e => e.flags?.archaic),
      technical: lexicalEvidence.some(e => e.flags?.technical),
      invalidToken: !n.ok,
      sourceConflict: new Set(lexicalEvidence.map(e => e.token.toLocaleLowerCase('en-US'))).size > 1 && lexicalEvidence.length > 1
    };
    const upper = n.ok ? n.upper! : key.toLocaleUpperCase('en-US');
    const record: WordRecord = {
      word: n.ok ? n.lower! : key,
      upper,
      signature: n.ok ? signatureOf(upper) : '',
      length: n.ok ? upper.length : key.length,
      lemma: lexicalEvidence.find(e => e.lemma)?.lemma,
      pos: [...new Set(lexicalEvidence.flatMap(e => e.pos ?? []))].sort(),
      dialects: [...new Set(lexicalEvidence.flatMap(e => e.dialects ?? ['en']))].sort(),
      sources: [...new Set([...lexicalEvidence.map(e => e.sourceId), ...frequencySignals.map(f => f.sourceId), ...policyOverrides.map(p => p.sourceId)])].sort(),
      frequency: Number((frequencySignals.reduce((s, f) => s + f.value, 0) / Math.max(1, frequencySignals.length)).toFixed(4)),
      commonness: 0,
      familiarity: 0,
      flags,
      lexicalEvidence,
      frequencySignals,
      policyOverrides,
      class: 'REVIEW',
      reasons: []
    };
    record.commonness = record.frequency;
    record.familiarity = Math.max(record.frequency, lexicalEvidence.length ? 0.5 : 0);
    record.targetScore = scoreTarget(record);
    record.bonusScore = scoreBonus(record);
    record.class = chooseClass(record);
    const reasons = new Set<ReasonCode>([...record.targetScore.reasons, ...record.bonusScore.reasons, ...policyOverrides.flatMap(p => p.reasons)]);
    if (record.class === 'ACCEPT_ONLY') reasons.add('OK_ACCEPT_ONLY');
    if (policyOverrides.length) reasons.add('POLICY_OVERRIDE');
    record.reasons = [...reasons].sort();
    if (record.class === 'REVIEW') record.reasons.push('REVIEW_REQUIRED');
    records.push(record);
  }
  const sourceIds = [...new Set(records.flatMap(r => r.sources))].sort();
  const checksum = await sha256(canonical({ version, records }));
  return { version, languagePolicy: 'en-v1-a-z-exact-token', sourceNote: 'QA seed data authored for tests from current game vocabulary plus common edge-case words; not a licensed production corpus.', records, manifest: { version, recordCount: records.length, checksum, sourceIds, blockedCount: records.filter(r => r.class === 'BLOCKED').length, reviewCount: records.filter(r => r.class === 'REVIEW').length } };
}
