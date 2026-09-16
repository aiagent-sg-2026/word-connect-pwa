import type { OutcomeKind } from '../types';

/** The combo is deliberately outcome-derived: only a new target or bonus word continues it. */
export function nextCombo(combo: number, outcome: OutcomeKind): number {
  return outcome === 'TARGET' || outcome === 'BONUS' ? Math.max(0, combo) + 1 : 0;
}

export function comboContinues(outcome: OutcomeKind): boolean {
  return outcome === 'TARGET' || outcome === 'BONUS';
}
