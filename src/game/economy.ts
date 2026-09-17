import type { HintKind } from '../db/store';

/** Current policy applies only to new actions; durable historical events are never rewritten. */
export const ECONOMY = Object.freeze({
  version: 'v1.2-phase3',
  startingCoins: 20,
  targetReward: 3,
  bonusReward: 1,
  completionReward: 10,
  hintCosts: Object.freeze({ letter: 2, 'first-letter': 4, word: 8 })
});

export function rewardFor(kind: 'TARGET' | 'BONUS'): number {
  return kind === 'TARGET' ? ECONOMY.targetReward : ECONOMY.bonusReward;
}

export function hintCost(kind: HintKind): number { return ECONOMY.hintCosts[kind]; }
