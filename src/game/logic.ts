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

export type HintPlan = { word: string; index?: number };

/** Stable target order is the campaign order; partially revealed targets get priority for letter hints. */
export function hintPlan(level: LevelContract, progress: ProgressRecord, kind: 'letter' | 'first-letter' | 'word'): HintPlan | undefined {
  const unsolved = level.targets.filter(word => !progress.foundTargets.includes(word) && !progress.revealedWords?.includes(word));
  if (kind === 'word') {
    const candidate = unsolved.find(word => (progress.revealedLetters?.[word] ?? []).length < word.length);
    return candidate ? { word: candidate } : undefined;
  }
  const withIndexes = unsolved.map(word => ({ word, indexes: progress.revealedLetters?.[word] ?? [] }));
  if (kind === 'first-letter') {
    const candidate = withIndexes.find(({ indexes }) => indexes.length === 0 && !indexes.includes(0))
      ?? withIndexes.find(({ indexes }) => !indexes.includes(0));
    return candidate ? { word: candidate.word, index: 0 } : undefined;
  }
  // Smart letter hints should expose a new non-first character whenever possible.
  // Keep partially revealed answers ahead of untouched answers, then preserve
  // campaign order within each group.
  const hasHiddenNonFirst = ({ word, indexes }: { word: string; indexes: number[] }) =>
    Array.from({ length: word.length }, (_, i) => i).some(i => i > 0 && !indexes.includes(i));
  const candidate = withIndexes.find(({ word, indexes }) => indexes.length > 0 && hasHiddenNonFirst({ word, indexes }))
    ?? withIndexes.find(hasHiddenNonFirst)
    ?? withIndexes.find(({ word, indexes }) => indexes.length < word.length);
  if (!candidate) return undefined;
  const index = Array.from({ length: candidate.word.length }, (_, i) => i).find(i => i > 0 && !candidate.indexes.includes(i))
    ?? Array.from({ length: candidate.word.length }, (_, i) => i).find(i => !candidate.indexes.includes(i));
  return index === undefined ? undefined : { word: candidate.word, index };
}

export function targetHint(level: LevelContract, progress: ProgressRecord): string | undefined {
  return hintPlan(level, progress, 'word')?.word;
}
