import type { ReasonCode, ScoreBreakdown, WordRecord } from './types.ts';

export const SCORE_POLICY_V1_PROVISIONAL = {
  version: 'score-v1-provisional',
  status: 'provisional-until-2000-human-golden-set',
  targetWeights: { frequency: 0.38, lexicalConfidence: 0.18, morphology: 0.12, gameplayQuality: 0.12, dialectNeutrality: 0.10, stability: 0.10 },
  bonusWeights: { lexicalConfidence: 0.30, morphology: 0.20, gameplayQuality: 0.20, dialect: 0.15, raritySweetSpot: 0.15 },
  thresholds: { target: 0.68, target3: 0.78, bonus: 0.42 },
  penalties: { properNoun: 1, abbreviation: 1, offensive: 1, archaic: 0.15, technical: 0.12 }
} as const;

const clamp = (n: number) => Math.max(0, Math.min(1, n));
const avg = (values: number[], fallback = 0) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : fallback;

export function hardGateReasons(record: Pick<WordRecord, 'flags'>): ReasonCode[] {
  const r: ReasonCode[] = [];
  if (record.flags.invalidToken) r.push('INVALID_TOKEN');
  if (record.flags.sourceConflict) r.push('SOURCE_CONFLICT');
  if (record.flags.morphologyConflict) r.push('MORPHOLOGY_CONFLICT');
  if (record.flags.morphologyInvalid) r.push('MORPHOLOGY_INVALID');
  if (record.flags.properNoun) r.push('PROPER_NOUN');
  if (record.flags.abbreviation) r.push('ABBREVIATION');
  if (record.flags.offensive) r.push('UNSAFE_EXACT_TOKEN');
  return r;
}

export function scoreTarget(record: WordRecord): ScoreBreakdown {
  const features = {
    frequency: clamp(record.frequency),
    lexicalConfidence: avg(record.lexicalEvidence.map(e => e.confidence), 0),
    morphology: record.flags.morphologyConflict || record.flags.morphologyInvalid ? 0 : record.morphology?.inflectionType === 'base' ? 0.94 : record.morphology ? 0.82 : record.flags.technical || record.flags.archaic ? 0.55 : 0.9,
    gameplayQuality: clamp((record.length - 2) / 4),
    dialectNeutrality: record.dialects.length <= 1 || record.dialects.includes('en') ? 1 : 0.72,
    stability: record.policyOverrides.length ? 0.85 : 0.95
  };
  const penalties: Record<string, number> = {};
  if (record.flags.archaic) penalties.archaic = SCORE_POLICY_V1_PROVISIONAL.penalties.archaic;
  if (record.flags.technical) penalties.technical = SCORE_POLICY_V1_PROVISIONAL.penalties.technical;
  const weighted = Object.entries(SCORE_POLICY_V1_PROVISIONAL.targetWeights).reduce((sum, [k, w]) => sum + features[k as keyof typeof features] * w, 0);
  const score = clamp(weighted - Object.values(penalties).reduce((a, b) => a + b, 0));
  const reasons: ReasonCode[] = hardGateReasons(record);
  const threshold = record.length === 3 ? SCORE_POLICY_V1_PROVISIONAL.thresholds.target3 : SCORE_POLICY_V1_PROVISIONAL.thresholds.target;
  if (record.length === 3 && score < threshold) reasons.push('SHORT_TARGET_STRICT');
  if (score < threshold) reasons.push('LOW_TARGET_SCORE');
  if (!reasons.length) reasons.push('OK_TARGET');
  return { version: SCORE_POLICY_V1_PROVISIONAL.version, score: Number(score.toFixed(4)), features, penalties, reasons };
}

export function scoreBonus(record: WordRecord): ScoreBreakdown {
  const raritySweetSpot = 1 - Math.abs(record.frequency - 0.42) / 0.42;
  const features = {
    lexicalConfidence: avg(record.lexicalEvidence.map(e => e.confidence), 0),
    morphology: record.flags.morphologyConflict || record.flags.morphologyInvalid ? 0 : record.morphology?.inflectionType === 'base' ? 0.92 : record.morphology ? 0.84 : record.flags.technical || record.flags.archaic ? 0.6 : 0.88,
    gameplayQuality: clamp((record.length - 1) / 5),
    dialect: record.dialects.length <= 1 ? 0.95 : 0.75,
    raritySweetSpot: clamp(raritySweetSpot)
  };
  const penalties: Record<string, number> = {};
  const weighted = Object.entries(SCORE_POLICY_V1_PROVISIONAL.bonusWeights).reduce((sum, [k, w]) => sum + features[k as keyof typeof features] * w, 0);
  const score = clamp(weighted);
  const reasons: ReasonCode[] = hardGateReasons(record);
  if (score < SCORE_POLICY_V1_PROVISIONAL.thresholds.bonus) reasons.push('LOW_BONUS_SCORE');
  if (!reasons.length) reasons.push('OK_BONUS');
  return { version: SCORE_POLICY_V1_PROVISIONAL.version, score: Number(score.toFixed(4)), features, penalties, reasons };
}
