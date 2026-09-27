import { describe, expect, it } from 'vitest';
import { CAMPAIGN } from '../content/campaign';
import { DAILY_POLICY, DAILY_POLICY_VERSION, isValidDayKey, localDayKey, parseDayKey, selectDailyLevel, selectDailyLevelId } from './daily';

describe('V1.3 Phase 1 daily foundation', () => {
  it('has a frozen, explicit policy identifier', () => {
    expect(DAILY_POLICY_VERSION).toBe('daily-policy-v1');
    expect(Object.isFrozen(DAILY_POLICY)).toBe(true);
  });

  it('uses local calendar fields at date boundaries', () => {
    expect(localDayKey(new Date(2024, 0, 1, 0, 1))).toBe('2024-01-01');
    expect(localDayKey(new Date(2024, 11, 31, 23, 59))).toBe('2024-12-31');
    expect(parseDayKey('2024-02-29')).toEqual({ year: 2024, month: 2, day: 29 });
  });

  it('rejects invalid dates and selector inputs', () => {
    expect(isValidDayKey('2023-02-29')).toBe(false);
    expect(isValidDayKey('2024-2-01')).toBe(false);
    expect(() => localDayKey(new Date('invalid'))).toThrow(RangeError);
    expect(() => selectDailyLevel(DAILY_POLICY_VERSION, 'campaign-en-v2', '2024-02-30', CAMPAIGN.levels)).toThrow(RangeError);
    expect(() => selectDailyLevel('', 'campaign-en-v2', '2024-02-01', CAMPAIGN.levels)).toThrow(RangeError);
    expect(() => selectDailyLevel(DAILY_POLICY_VERSION, 'campaign-en-v2', '2024-02-01', [])).toThrow(RangeError);
  });

  it('is deterministic, sensitive to inputs, and returns an existing level', () => {
    const a = selectDailyLevelId(DAILY_POLICY_VERSION, 'campaign-en-v2', '2024-02-01', CAMPAIGN.levels);
    expect(selectDailyLevelId(DAILY_POLICY_VERSION, 'campaign-en-v2', '2024-02-01', CAMPAIGN.levels)).toBe(a);
    expect(CAMPAIGN.levels.some(level => level.levelId === a)).toBe(true);
    const variants = new Set([
      a,
      selectDailyLevelId('daily-policy-v2', 'campaign-en-v2', '2024-02-01', CAMPAIGN.levels),
      selectDailyLevelId(DAILY_POLICY_VERSION, 'campaign-en-v3', '2024-02-01', CAMPAIGN.levels),
      selectDailyLevelId(DAILY_POLICY_VERSION, 'campaign-en-v2', '2024-02-02', CAMPAIGN.levels),
    ]);
    expect(variants.size).toBeGreaterThan(1);
  });

  it('does not mutate supplied levels or depend on their order', () => {
    const before = structuredClone(CAMPAIGN.levels);
    const reversed = [...CAMPAIGN.levels].reverse();
    const selected = selectDailyLevel(DAILY_POLICY_VERSION, 'campaign-en-v2', '2024-05-17', reversed);
    expect(selected).toBe(CAMPAIGN.levels.find(level => level.levelId === selected.levelId));
    expect(reversed.map(level => level.levelId)).toEqual([...CAMPAIGN.levels].reverse().map(level => level.levelId));
    expect(CAMPAIGN.levels).toEqual(before);
  });

  it('locks frozen vector expectations', () => {
    expect(selectDailyLevelId(DAILY_POLICY_VERSION, 'campaign-en-v2', '2024-01-01', CAMPAIGN.levels)).toBe('L017');
    expect(selectDailyLevelId(DAILY_POLICY_VERSION, 'campaign-en-v2', '2024-07-04', CAMPAIGN.levels)).toBe('L010');
    expect(selectDailyLevelId(DAILY_POLICY_VERSION, 'campaign-en-v2', '2025-01-01', CAMPAIGN.levels)).toBe('L008');
  });
});
