import { canonical, sha256 } from './hash.ts';
import { normalizeEnglishV1, signatureOf } from './normalize.ts';
import { scoreBonus, scoreTarget, SCORE_POLICY_V1_PROVISIONAL } from './scoring.ts';
import type { DictionaryArtifact, InflectionType, MorphologyError, MorphologyEvidence, ReasonCode, SourceWordInput, WordClass, WordRecord } from './types.ts';

const unsafeExact = new Set(['BADWORD']);

function chooseClass(record: WordRecord): WordClass {
  if (record.targetScore?.reasons.some(r => ['INVALID_TOKEN','SOURCE_CONFLICT','MORPHOLOGY_CONFLICT','MORPHOLOGY_INVALID','PROPER_NOUN','ABBREVIATION','UNSAFE_EXACT_TOKEN'].includes(r))) {
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

const supportedInflectionTypes = new Set<InflectionType>(['base', 'plural', 'past', 'gerund', 'comparative', 'superlative', 'other']);
const supportedMorphologyConfidences = new Set(['low', 'medium', 'high']);

function normalizedMorphology(evidence: MorphologyEvidence, currentToken: string): { morphology?: MorphologyEvidence; error?: MorphologyError } {
  const errors: string[] = [];
  if (evidence.contractVersion !== 'morphology-v1') errors.push('unsupported contractVersion');
  if (!evidence.sourceId || typeof evidence.sourceId !== 'string') errors.push('invalid sourceId');
  if (!evidence.provenance || typeof evidence.provenance !== 'string') errors.push('invalid provenance');
  if (!supportedMorphologyConfidences.has(evidence.confidence)) errors.push('invalid confidence');
  if (!supportedInflectionTypes.has(evidence.inflectionType)) errors.push('unsupported inflectionType');
  const token = normalizeEnglishV1(evidence.token);
  const lemma = normalizeEnglishV1(evidence.lemma);
  const inflectionOf = normalizeEnglishV1(evidence.inflectionOf);
  if (!token.ok) errors.push('invalid token');
  if (!lemma.ok) errors.push('invalid lemma');
  if (!inflectionOf.ok) errors.push('invalid inflectionOf');
  if (token.ok && token.lower !== currentToken) errors.push('token mismatch');
  if (errors.length) return { error: { sourceId: evidence.sourceId, evidence, errors } };
  return {
    morphology: {
      contractVersion: 'morphology-v1',
      sourceId: evidence.sourceId,
      token: token.lower!,
      lemma: lemma.lower!,
      inflectionOf: inflectionOf.lower!,
      inflectionType: evidence.inflectionType,
      provenance: evidence.provenance,
      confidence: evidence.confidence
    }
  };
}

function mergeMorphology(evidence: MorphologyEvidence[], currentToken: string): { morphology?: MorphologyEvidence; morphologyEvidence: MorphologyEvidence[]; errors: MorphologyError[]; conflict: boolean } {
  const results = evidence.map(e => normalizedMorphology(e, currentToken));
  const normalized = results.flatMap(r => r.morphology ? [r.morphology] : []);
  const errors = results.flatMap(r => r.error ? [r.error] : []);
  const sorted = normalized.sort((a, b) => canonical(a).localeCompare(canonical(b)));
  const keys = new Set(sorted.map(m => canonical({ lemma: m.lemma, inflectionOf: m.inflectionOf, inflectionType: m.inflectionType })));
  return { morphology: keys.size === 1 ? sorted[0] : undefined, morphologyEvidence: sorted, errors, conflict: keys.size > 1 };
}

export async function buildDictionary(inputs: SourceWordInput[], version = 'dict-qa-seed-v1', sourceNote = 'QA seed data authored for tests from current game vocabulary plus common edge-case words; not a licensed production corpus.'): Promise<DictionaryArtifact> {
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
    const commonnessSignals = grouped.flatMap(g => g.commonness ?? []);
    const policyOverrides = grouped.flatMap(g => g.policy ?? []);
    const morphologyInput = lexicalEvidence.flatMap(e => e.morphology ? [e.morphology] : e.lemma ? [{ contractVersion: 'morphology-v1' as const, sourceId: e.sourceId, token: e.token, lemma: e.lemma, inflectionOf: e.lemma, inflectionType: 'base' as const, provenance: 'legacy-lexical-lemma', confidence: 'medium' as const }] : []);
    const morphology = mergeMorphology(morphologyInput, n.ok ? n.lower! : key);
    const flags = {
      properNoun: lexicalEvidence.some(e => e.flags?.properNoun),
      abbreviation: lexicalEvidence.some(e => e.flags?.abbreviation),
      offensive: unsafeExact.has(key.toLocaleUpperCase('en-US')) || policyOverrides.some(p => p.class === 'BLOCKED'),
      archaic: lexicalEvidence.some(e => e.flags?.archaic),
      technical: lexicalEvidence.some(e => e.flags?.technical),
      invalidToken: !n.ok,
      sourceConflict: new Set(lexicalEvidence.map(e => e.token.toLocaleLowerCase('en-US'))).size > 1 && lexicalEvidence.length > 1,
      morphologyConflict: morphology.conflict,
      morphologyInvalid: morphology.errors.length > 0
    };
    const upper = n.ok ? n.upper! : key.toLocaleUpperCase('en-US');
    const record: WordRecord = {
      word: n.ok ? n.lower! : key,
      upper,
      signature: n.ok ? signatureOf(upper) : '',
      length: n.ok ? upper.length : key.length,
      lemma: morphology.morphology?.lemma,
      morphology: morphology.morphology,
      morphologyEvidence: morphology.morphologyEvidence,
      morphologyErrors: morphology.errors,
      pos: [...new Set(lexicalEvidence.flatMap(e => e.pos ?? []))].sort(),
      dialects: [...new Set(lexicalEvidence.flatMap(e => e.dialects ?? ['en']))].sort(),
      sources: [...new Set([...lexicalEvidence.map(e => e.sourceId), ...frequencySignals.map(f => f.sourceId), ...commonnessSignals.map(c => c.sourceId), ...policyOverrides.map(p => p.sourceId), ...morphologyInput.map(m => m.sourceId)])].sort(),
      frequency: frequencySignals.length ? Number((frequencySignals.reduce((s, f) => s + f.value, 0) / frequencySignals.length).toFixed(4)) : 0,
      commonness: commonnessSignals.length ? Number((commonnessSignals.reduce((s, c) => s + c.value, 0) / commonnessSignals.length).toFixed(4)) : 0,
      familiarity: 0,
      flags,
      lexicalEvidence,
      frequencySignals,
      commonnessSignals,
      policyOverrides,
      class: 'REVIEW',
      reasons: []
    };
    record.familiarity = Math.max(record.frequency, record.commonness, lexicalEvidence.length ? 0.5 : 0);
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
  return { schemaVersion: 'dictionary-artifact-v2', version, languagePolicy: 'en-v1-a-z-exact-token', sourceNote, records, manifest: { version, recordCount: records.length, checksum, sourceIds, blockedCount: records.filter(r => r.class === 'BLOCKED').length, reviewCount: records.filter(r => r.class === 'REVIEW').length } };
}
