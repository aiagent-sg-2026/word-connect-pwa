export type WordClass = 'TARGET' | 'BONUS' | 'ACCEPT_ONLY' | 'BLOCKED' | 'REVIEW';

export interface LevelContract {
  campaignVersion: string;
  contentVersion: string;
  levelId: string;
  revision: number;
  letters: string[];
  targets: string[];
  bonus: string[];
  acceptOnly: string[];
  difficulty: 1 | 2 | 3 | 4 | 5;
  dictionaryVersion: string;
  scoringVersion: string;
  generatorVersion: string;
  hash: string;
}

export interface CampaignManifest {
  campaignVersion: string;
  contentVersion: string;
  levels: LevelContract[];
  campaignHash: string;
}

export interface ProgressRecord {
  profileId: string;
  campaignVersion: string;
  levelId: string;
  levelRevision: number;
  levelHash: string;
  foundTargets: string[];
  foundBonus: string[];
  completed: boolean;
  /** Durable paid-hint state. Optional keeps existing saves backward compatible. */
  revealedLetters?: Record<string, number[]>;
  revealedWords?: string[];
  completedAt?: string;
  updatedAt: string;
}

export interface ProfileRecord {
  profileId: string;
  campaignVersion: string;
  coins: number;
  hintsUsed: number;
  currentLevelId: string;
  createdAt: string;
  updatedAt: string;
  /** Consecutive newly accepted target/bonus words across gameplay submissions. */
  combo?: number;
  bestCombo?: number;
}

export interface SettingsRecord { profileId: string; sound: boolean; haptics: boolean; reducedMotion: boolean; }
export type OutcomeKind = 'TARGET' | 'BONUS' | 'ACCEPT_ONLY' | 'INVALID' | 'ALREADY_FOUND';
export interface WordOutcome { kind: OutcomeKind; word: string; coinsDelta: number; message: string; }

export interface StatsAggregateRecord {
  profileId: string;
  submissions: number;
  targets: number;
  bonus: number;
  acceptOnly: number;
  invalid: number;
  alreadyFound: number;
  levelsCompleted: number;
  coinsEarned: number;
  coinsSpent: number;
  bestCombo: number;
  updatedAt: string;
}
