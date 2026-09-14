import { CAMPAIGN } from './campaign';
import type { CampaignManifest, LevelContract } from '../types';

export const normalizeWord = (word: string) => word.trim().toUpperCase();

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export async function sha256(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function computeLevelHash(level: LevelContract): Promise<string> {
  const copy = { ...level, hash: undefined } as Record<string, unknown>;
  delete copy.hash;
  return sha256(canonical(copy));
}

export function canConstruct(word: string, letters: readonly string[]): boolean {
  const counts = new Map<string, number>();
  for (const l of letters) counts.set(l, (counts.get(l) ?? 0) + 1);
  for (const ch of normalizeWord(word)) {
    const n = counts.get(ch) ?? 0;
    if (n <= 0) return false;
    counts.set(ch, n - 1);
  }
  return true;
}

export async function validateCampaign(campaign: CampaignManifest = CAMPAIGN): Promise<void> {
  const ids = new Set<string>();
  for (const level of campaign.levels) {
    if (ids.has(level.levelId)) throw new Error(`duplicate level ${level.levelId}`);
    ids.add(level.levelId);
    if (level.campaignVersion !== campaign.campaignVersion) throw new Error(`campaign mismatch ${level.levelId}`);
    const computed = await computeLevelHash(level);
    if (computed !== level.hash) throw new Error(`hash mismatch ${level.levelId}`);
    const words = [...level.targets, ...level.bonus, ...level.acceptOnly].map(normalizeWord);
    if (new Set(words).size !== words.length) throw new Error(`duplicate word ${level.levelId}`);
    for (const word of [...level.targets, ...level.bonus]) if (!canConstruct(word, level.letters)) throw new Error(`unconstructible word ${level.levelId}:${word}`);
  }
  const campaignHash = await sha256(canonical({ campaignVersion: campaign.campaignVersion, contentVersion: campaign.contentVersion, levels: campaign.levels.map(l => l.hash) }));
  if (campaignHash !== campaign.campaignHash) throw new Error('campaign hash mismatch');
}
