import type { ProfileRecord, ProgressRecord, StatsAggregateRecord } from '../types';

export interface AchievementDefinition { id: string; title: string; description: string; }
export const ACHIEVEMENTS: readonly AchievementDefinition[] = [
  { id: 'first-target', title: 'First target', description: 'Find your first target word.' },
  { id: 'combo-3', title: 'On a roll', description: 'Reach a combo of ×3.' },
  { id: 'combo-5', title: 'Word streak', description: 'Reach a combo of ×5.' },
  { id: 'first-level', title: 'Level complete', description: 'Complete your first level.' },
  { id: 'bonus-finder', title: 'Bonus finder', description: 'Find your first bonus word.' },
  { id: 'coins-50', title: 'Coin collector', description: 'Earn 50 coins.' },
  { id: 'coins-100', title: 'Coin hoard', description: 'Earn 100 coins.' },
];
export function eligibleAchievements(profile: ProfileRecord, stats: StatsAggregateRecord, progress: ProgressRecord[]): string[] {
  const combo = Math.max(stats.bestCombo, profile.bestCombo ?? 0);
  const rules: Record<string, boolean> = {
    'first-target': stats.targets > 0 || progress.some(p => p.foundTargets.length > 0),
    'combo-3': combo >= 3, 'combo-5': combo >= 5,
    'first-level': stats.levelsCompleted > 0 || progress.some(p => p.completed),
    'bonus-finder': stats.bonus > 0 || progress.some(p => p.foundBonus.length > 0),
    'coins-50': stats.coinsEarned >= 50, 'coins-100': stats.coinsEarned >= 100,
  };
  return ACHIEVEMENTS.filter(a => rules[a.id]).map(a => a.id);
}
