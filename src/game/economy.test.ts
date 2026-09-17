import { describe, expect, it } from 'vitest';
import { CAMPAIGN } from '../content/campaign';
import { ECONOMY, rewardFor } from './economy';
import { hintPlan } from './logic';

describe('V1.2 Phase 3 economy policy', () => {
  it('keeps the 20-level perfect-play economy intentional', () => {
    const targets = CAMPAIGN.levels.reduce((n, level) => n + level.targets.length, 0);
    const bonus = CAMPAIGN.levels.reduce((n, level) => n + level.bonus.length, 0);
    const completions = CAMPAIGN.levels.length;
    const perfect = ECONOMY.startingCoins + targets * rewardFor('TARGET') + bonus * rewardFor('BONUS') + completions * ECONOMY.completionReward;
    expect({ targets, bonus, completions, perfect }).toEqual({ targets: 77, bonus: 54, completions: 20, perfect: 505 });
    expect(perfect).toBeLessThan(864);
  });

  it('targets hints deterministically and avoids duplicate first-letter information', () => {
    const level = CAMPAIGN.levels[0];
    const progress: any = { foundTargets: [], revealedWords: [], revealedLetters: { CAT: [0] } };
    expect(hintPlan(level, progress, 'letter')).toEqual({ word: 'CAT', index: 1 });
    expect(hintPlan(level, progress, 'first-letter')).toEqual({ word: 'ACT', index: 0 });
    progress.revealedLetters.ACT = [0];
    expect(hintPlan(level, progress, 'first-letter')).toBeUndefined();
  });
});
