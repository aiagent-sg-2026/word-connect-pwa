import type { WordClass } from '../content-pipeline/types.ts';

export type GoldenClass = WordClass;
export type ReviewSource = 'human-review-v1';
export type GoldenReadiness = 'READY' | 'DRAFT' | 'PARTIAL' | 'NOT_READY';
export type GoldenSplit = 'train' | 'dev' | 'holdout';

export const GOLDEN_CLASSES: GoldenClass[] = ['TARGET', 'BONUS', 'ACCEPT_ONLY', 'BLOCKED', 'REVIEW'];

export interface GoldenSourceProvenance {
  dictionaryVersion: string;
  dictionaryChecksum: string;
  scoringVersion: string;
  evaluatorVersion: string;
  queueVersion: string;
  splitPolicyVersion: string;
  seed: string;
}

export interface GoldenCandidate {
  schemaVersion: 'golden-candidate-v1';
  queueVersion: string;
  word: string;
  upper: string;
  length: number;
  candidateId: string;
  strata: string[];
  predictedClass: GoldenClass;
  targetScore?: number;
  bonusScore?: number;
  reasons: string[];
  source: GoldenSourceProvenance;
}

export interface GoldenQueueArtifact {
  schemaVersion: 'golden-queue-v1';
  targetCount: number;
  candidateCount: number;
  shortfall: number;
  generatedAt: string;
  checksum: string;
  source: GoldenSourceProvenance;
  candidates: GoldenCandidate[];
}

export interface HumanReview {
  schemaVersion: 'human-golden-review-v1';
  queueVersion: string;
  queueChecksum: string;
  word: string;
  reviewerId: string;
  reviewedAt: string;
  source: ReviewSource;
  class: GoldenClass;
  confidence: number;
  reason?: string;
  note?: string;
}

export interface GoldenAdjudication {
  schemaVersion: 'human-golden-adjudication-v1';
  queueVersion: string;
  queueChecksum: string;
  word: string;
  adjudicatorId: string;
  adjudicatedAt: string;
  source: 'human-adjudication-v1';
  finalClass: GoldenClass;
  sourceReviewerIds: string[];
  note?: string;
}

export interface FinalGoldenItem {
  schemaVersion: 'final-golden-item-v1';
  word: string;
  class: GoldenClass;
  split: GoldenSplit;
  reviewerIds: string[];
  adjudicatorId?: string;
  evidenceChecksum: string;
}

export interface GoldenManifest {
  schemaVersion: 'golden-manifest-v1';
  version: string;
  readiness: GoldenReadiness;
  targetCount: number;
  itemCount: number;
  unresolvedCount: number;
  checksum: string;
  queueChecksum: string;
  source: GoldenSourceProvenance;
  splitPolicy: { version: string; train: number; dev: number; holdout: number; protectedHoldout: true };
  gates: Record<string, boolean>;
}

export interface PublishedGoldenArtifact {
  schemaVersion: 'published-human-golden-v1';
  manifest: GoldenManifest;
  items: FinalGoldenItem[];
}

export interface GoldenEvaluatorReport {
  schemaVersion: 'golden-evaluator-report-v1';
  evaluatorVersion: string;
  readiness: GoldenReadiness;
  goldenChecksum: string;
  dictionaryChecksum: string;
  scoringVersion: string;
  metrics?: unknown;
  warning?: string;
}
