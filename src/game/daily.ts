import type { LevelContract } from '../types';

/** Frozen policy metadata: changing either value intentionally changes the vectors. */
export const DAILY_POLICY = Object.freeze({
  version: 'daily-policy-v1',
  algorithm: 'fnv1a32-sorted-level-ids-v1',
} as const);
export const DAILY_POLICY_VERSION = DAILY_POLICY.version;

const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface DayKeyParts { year: number; month: number; day: number; }

function invalid(message: string): never {
  throw new RangeError(`Invalid daily input: ${message}`);
}

/** Returns the local calendar date without using locale or timezone formatting. */
export function localDayKey(date: Date): string {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) invalid('date');
  const year = date.getFullYear();
  if (year < 0 || year > 9999) invalid('date year');
  return `${String(year).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** Parses and validates the calendar date, independently of the runtime timezone. */
export function parseDayKey(dayKey: string): DayKeyParts {
  if (typeof dayKey !== 'string') invalid('day key');
  const match = DAY_KEY.exec(dayKey);
  if (!match) invalid('day key format');
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth) invalid('calendar date');
  return { year, month, day };
}

export function isValidDayKey(dayKey: string): boolean {
  try { parseDayKey(dayKey); return true; } catch { return false; }
}

function validateSelectorInput(policyVersion: string, campaignVersion: string, dayKey: string, levels: readonly LevelContract[]): void {
  if (typeof policyVersion !== 'string' || policyVersion.length === 0) invalid('policy version');
  if (typeof campaignVersion !== 'string' || campaignVersion.length === 0) invalid('campaign version');
  parseDayKey(dayKey);
  if (!Array.isArray(levels) || levels.length === 0) invalid('levels');
  const ids = new Set<string>();
  for (const level of levels) {
    if (!level || typeof level.levelId !== 'string' || level.levelId.length === 0) invalid('level id');
    if (ids.has(level.levelId)) invalid('duplicate level id');
    ids.add(level.levelId);
  }
}

// FNV-1a is specified here explicitly so selection is independent of crypto APIs and locale.
function fnv1a32(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Selects one of the supplied level objects; the contracts are never copied or mutated. */
export function selectDailyLevel(policyVersion: string, campaignVersion: string, dayKey: string, levels: readonly LevelContract[]): LevelContract {
  validateSelectorInput(policyVersion, campaignVersion, dayKey, levels);
  const ordered = [...levels].sort((a, b) => compareCodeUnits(a.levelId, b.levelId));
  const index = fnv1a32(`${policyVersion}\u0000${campaignVersion}\u0000${dayKey}`) % ordered.length;
  return ordered[index];
}

export function selectDailyLevelId(policyVersion: string, campaignVersion: string, dayKey: string, levels: readonly LevelContract[]): string {
  return selectDailyLevel(policyVersion, campaignVersion, dayKey, levels).levelId;
}
