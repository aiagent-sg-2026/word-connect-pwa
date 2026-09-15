export type WordClass = 'TARGET' | 'BONUS' | 'ACCEPT_ONLY' | 'BLOCKED' | 'REVIEW';
export type ReasonCode =
  | 'OK_TARGET' | 'OK_BONUS' | 'OK_ACCEPT_ONLY'
  | 'POLICY_OVERRIDE' | 'LOW_TARGET_SCORE' | 'LOW_BONUS_SCORE'
  | 'SHORT_TARGET_STRICT' | 'PROPER_NOUN' | 'ABBREVIATION'
  | 'UNSAFE_EXACT_TOKEN' | 'INVALID_TOKEN' | 'SOURCE_CONFLICT' | 'MORPHOLOGY_CONFLICT' | 'MORPHOLOGY_INVALID' | 'REVIEW_REQUIRED';

export type InflectionType = 'base' | 'plural' | 'past' | 'gerund' | 'comparative' | 'superlative' | 'other';
export type MorphologyConfidence = 'low' | 'medium' | 'high';

export interface MorphologyEvidence {
  contractVersion: 'morphology-v1';
  sourceId: string;
  token: string;
  lemma: string;
  inflectionOf: string;
  inflectionType: InflectionType;
  provenance: string;
  confidence: MorphologyConfidence;
}

export interface LexicalEvidence {
  sourceId: string;
  token: string;
  confidence: number;
  pos?: string[];
  lemma?: string;
  morphology?: MorphologyEvidence;
  dialects?: string[];
  flags?: Partial<Record<'properNoun' | 'abbreviation' | 'archaic' | 'technical', boolean>>;
}

export interface FrequencySignal { sourceId: string; value: number; scale: '0..1'; }
export interface PolicyOverride { sourceId: string; class?: WordClass; reasons: ReasonCode[]; note?: string; }

export interface SourceWordInput {
  word: string;
  lexical?: LexicalEvidence[];
  frequency?: FrequencySignal[];
  policy?: PolicyOverride[];
}

export interface ScoreBreakdown {
  version: string;
  score: number;
  features: Record<string, number>;
  penalties: Record<string, number>;
  reasons: ReasonCode[];
}

export interface MorphologyError {
  sourceId: string;
  evidence: MorphologyEvidence;
  errors: string[];
}

export interface WordRecord {
  word: string;
  upper: string;
  signature: string;
  length: number;
  lemma?: string;
  pos: string[];
  dialects: string[];
  sources: string[];
  frequency: number;
  commonness: number;
  familiarity: number;
  morphology?: MorphologyEvidence;
  morphologyEvidence: MorphologyEvidence[];
  morphologyErrors: MorphologyError[];
  flags: { properNoun: boolean; abbreviation: boolean; offensive: boolean; archaic: boolean; technical: boolean; invalidToken: boolean; sourceConflict: boolean; morphologyConflict: boolean; morphologyInvalid: boolean; };
  lexicalEvidence: LexicalEvidence[];
  frequencySignals: FrequencySignal[];
  policyOverrides: PolicyOverride[];
  targetScore?: ScoreBreakdown;
  bonusScore?: ScoreBreakdown;
  class: WordClass;
  reasons: ReasonCode[];
}

export interface DictionaryArtifact {
  schemaVersion: 'dictionary-artifact-v2';
  version: string;
  languagePolicy: 'en-v1-a-z-exact-token';
  sourceNote: string;
  records: WordRecord[];
  manifest: { version: string; recordCount: number; checksum: string; sourceIds: string[]; blockedCount: number; reviewCount: number; };
}
