import type { LevelContract, ProgressRecord, WordOutcome } from '../types';
import { rewardFor } from './economy';
import { normalizeWord } from '../content/validate';

export function levelSets(level: LevelContract) {
  return {
    target: new Set(level.targets.map(normalizeWord)),
    bonus: new Set(level.bonus.map(normalizeWord)),
    acceptOnly: new Set(level.acceptOnly.map(normalizeWord))
  };
}

export function tileWord(indexes: number[], letters: readonly string[]): string {
  const used = new Set<number>();
  let out = '';
  for (const idx of indexes) {
    if (idx < 0 || idx >= letters.length) throw new Error('tile index out of range');
    if (used.has(idx)) throw new Error('duplicate tile reuse');
    used.add(idx);
    out += letters[idx];
  }
  return normalizeWord(out);
}

export function resolveOutcome(level: LevelContract, progress: ProgressRecord, word: string): WordOutcome {
  const w = normalizeWord(word);
  const sets = levelSets(level);
  if ((progress.foundTargets.includes(w) && sets.target.has(w)) || (progress.foundBonus.includes(w) && sets.bonus.has(w))) return { kind: 'ALREADY_FOUND', word: w, coinsDelta: 0, message: 'Already found' };
  if (sets.target.has(w)) return { kind: 'TARGET', word: w, coinsDelta: rewardFor('TARGET'), message: 'Great!' };
  if (sets.bonus.has(w)) return { kind: 'BONUS', word: w, coinsDelta: rewardFor('BONUS'), message: 'Bonus word!' };
  if (sets.acceptOnly.has(w)) return { kind: 'ACCEPT_ONLY', word: w, coinsDelta: 0, message: 'Valid word, not in puzzle' };
  return { kind: 'INVALID', word: w, coinsDelta: 0, message: 'Not in this puzzle' };
}

export function targetHint(level: LevelContract, progress: ProgressRecord): string | undefined {
  return level.targets.find(w => !progress.foundTargets.includes(w));
}
