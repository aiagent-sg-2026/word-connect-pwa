import type { HintKind } from '../db/store';

/** V1.1 economy policy, centralized for future balancing. */
export const ECONOMY = Object.freeze({
  startingCoins: 25,
  targetReward: 5,
  bonusReward: 1,
  completionReward: 20,
  hintCosts: Object.freeze({ letter: 3, 'first-letter': 5, word: 10 })
});

export function rewardFor(kind: 'TARGET' | 'BONUS'): number {
  return kind === 'TARGET' ? ECONOMY.targetReward : ECONOMY.bonusReward;
}

export function hintCost(kind: HintKind): number { return ECONOMY.hintCosts[kind]; }
