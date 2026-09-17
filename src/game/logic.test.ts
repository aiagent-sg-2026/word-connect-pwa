import { describe, expect, it } from 'vitest';
import { CAMPAIGN } from '../content/campaign';
import type { ProgressRecord } from '../types';
import { hintPlan, resolveOutcome, tileWord } from './logic';
import { nextCombo } from './progression';

const level = CAMPAIGN.levels[0];
const acceptOnlyLevel = CAMPAIGN.levels[3];
const progress = (l = level): ProgressRecord => ({ profileId:'local', campaignVersion:l.campaignVersion, levelId:l.levelId, levelRevision:1, levelHash:l.hash, foundTargets:[], foundBonus:[], completed:false, updatedAt:'now' });

describe('word logic', () => {
  it('keeps duplicate physical tiles distinct and rejects tile reuse', () => {
    const letters = ['O','O','N'];
    expect(tileWord([0,1,2], letters)).toBe('OON');
    expect(() => tileWord([0,0], letters)).toThrow(/duplicate/);
  });
  it('resolves target bonus accept-only invalid and already-found', () => {
    expect(resolveOutcome(level, progress(), 'cat').kind).toBe('TARGET');
    expect(resolveOutcome(level, progress(), 'at').kind).toBe('BONUS');
    expect(resolveOutcome(acceptOnlyLevel, progress(acceptOnlyLevel), 'tsar').kind).toBe('ACCEPT_ONLY');
    expect(resolveOutcome(level, progress(), 'zzz').kind).toBe('INVALID');
    const p = progress(); p.foundTargets = ['CAT'];
    expect(resolveOutcome(level, p, 'cat').kind).toBe('ALREADY_FOUND');
  });
  it('derives durable combo transitions from every gameplay outcome', () => {
    expect(nextCombo(0, 'TARGET')).toBe(1);
    expect(nextCombo(1, 'BONUS')).toBe(2);
    for (const kind of ['ACCEPT_ONLY', 'INVALID', 'ALREADY_FOUND'] as const) expect(nextCombo(4, kind)).toBe(0);
  });
  it('keeps the three hint strategies distinct and deterministic', () => {
    const fresh = progress();
    expect(hintPlan(level, fresh, 'letter')).toEqual({ word: 'CAT', index: 1 });
    expect(hintPlan(level, fresh, 'first-letter')).toEqual({ word: 'CAT', index: 0 });
    expect(hintPlan(level, fresh, 'word')).toEqual({ word: 'CAT' });

    fresh.revealedLetters = { CAT: [1] };
    expect(hintPlan(level, fresh, 'letter')).toEqual({ word: 'CAT', index: 2 });
    expect(hintPlan(level, fresh, 'first-letter')).toEqual({ word: 'ACT', index: 0 });
  });
  it('returns no plan once the requested information is exhausted', () => {
    const p = progress();
    p.revealedLetters = { CAT: [0, 1, 2], ACT: [0, 1, 2] };
    expect(hintPlan(level, p, 'letter')).toBeUndefined();
    expect(hintPlan(level, p, 'first-letter')).toBeUndefined();
    expect(hintPlan(level, p, 'word')).toBeUndefined();
  });
});
