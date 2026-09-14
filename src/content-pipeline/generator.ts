import type { CampaignManifest, LevelContract } from '../types.ts';
import { canonical, sha256 } from './hash.ts';
import { canConstructExact, countsOf, signatureOf } from './normalize.ts';
import type { WordRecord } from './types.ts';

export const GENERATOR_VERSION = 'generator-v1-lab-provisional';

export interface SignatureIndexEntry { signature: string; words: string[]; counts: Record<string, number>; bitmask: number; }
export interface GeneratorReport { requested: number; generated: number; skipped: string[]; duplicateCandidates: string[]; campaignHash: string; }

export function bitmaskOf(word: string): number {
  let mask = 0;
  for (const ch of word.toLocaleUpperCase('en-US')) mask |= 1 << (ch.charCodeAt(0) - 65);
  return mask >>> 0;
}

export function buildSignatureIndex(records: WordRecord[]): Map<string, SignatureIndexEntry> {
  const index = new Map<string, SignatureIndexEntry>();
  for (const r of records.filter(r => r.class !== 'BLOCKED' && r.class !== 'REVIEW' && r.signature)) {
    const e = index.get(r.signature) ?? { signature: r.signature, words: [], counts: countsOf(r.upper), bitmask: bitmaskOf(r.upper) };
    e.words.push(r.upper);
    e.words.sort();
    index.set(r.signature, e);
  }
  return new Map([...index.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

function seedRank(seed: string, value: unknown): number {
  let h = 2166136261;
  for (const ch of canonical([seed, value])) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function seededOrder<T>(items: T[], seed: string): T[] {
  return [...items].sort((a, b) => seedRank(seed, a) - seedRank(seed, b) || canonical(a).localeCompare(canonical(b)));
}

async function levelHash(level: LevelContract): Promise<string> {
  const copy = { ...level } as Record<string, unknown>;
  delete copy.hash;
  return sha256(canonical(copy));
}

export async function generateLabCampaign(records: WordRecord[], opts: { seed: string; maxLevels: number; campaignVersion?: string } ): Promise<{ campaign: CampaignManifest; report: GeneratorReport }> {
  const campaignVersion = opts.campaignVersion ?? 'campaign-en-lab-qa-v1';
  const contentVersion = 'content-lab-qa-v1';
  const dictionaryVersion = 'dict-qa-seed-v1';
  const scoringVersion = 'score-v1-provisional';
  const eligibleAnchors = records.filter(r => r.class === 'TARGET' && r.length >= 3 && r.length <= 7);
  const levels: LevelContract[] = [];
  const identities = new Set<string>();
  const duplicateCandidates: string[] = [];
  const skipped: string[] = [];
  let i = 1;
  for (const anchor of seededOrder(eligibleAnchors, opts.seed)) {
    if (levels.length >= opts.maxLevels) break;
    const rack = anchor.upper.split('');
    const candidates = records.filter(r => r.signature && canConstructExact(r.upper, rack));
    const targets = seededOrder(candidates.filter(r => r.class === 'TARGET' && r.length >= 3).map(r => r.upper), opts.seed).slice(0, 8).sort();
    const bonus = seededOrder(candidates.filter(r => r.class === 'BONUS').map(r => r.upper), opts.seed).slice(0, 8).sort();
    const acceptOnly = candidates.filter(r => r.class === 'ACCEPT_ONLY').map(r => r.upper).sort();
    if (!targets.includes(anchor.upper)) targets.push(anchor.upper);
    const classOverlap = new Set([...targets, ...bonus, ...acceptOnly]).size !== targets.length + bonus.length + acceptOnly.length;
    if (targets.length < 1 || classOverlap || targets.some(w => !canConstructExact(w, rack))) { skipped.push(anchor.upper); continue; }
    const identity = signatureOf(anchor.upper) + ':' + targets.join('|');
    if (identities.has(identity)) { duplicateCandidates.push(anchor.upper); continue; }
    identities.add(identity);
    const difficultyRaw = Math.min(5, Math.max(1, Math.ceil((anchor.length + targets.length / 2 + bonus.length / 4) / 2.3))) as 1|2|3|4|5;
    const level: LevelContract = { campaignVersion, contentVersion, dictionaryVersion, scoringVersion, generatorVersion: GENERATOR_VERSION, levelId: `LAB${String(i).padStart(3, '0')}`, revision: 1, letters: rack, targets: targets.sort(), bonus, acceptOnly, difficulty: difficultyRaw, hash: '' };
    level.hash = await levelHash(level);
    levels.push(level); i++;
  }
  const campaignHash = await sha256(canonical({ campaignVersion, contentVersion, levels: levels.map(l => l.hash) }));
  return { campaign: { campaignVersion, contentVersion, campaignHash, levels }, report: { requested: opts.maxLevels, generated: levels.length, skipped, duplicateCandidates, campaignHash } };
}

export function validateGenerated(campaign: CampaignManifest, records: WordRecord[]): void {
  const classes = new Map(records.map(r => [r.upper, r.class]));
  const ids = new Set<string>();
  const identities = new Set<string>();
  for (const l of campaign.levels) {
    if (ids.has(l.levelId)) throw new Error(`duplicate id ${l.levelId}`);
    ids.add(l.levelId);
    const words = [...l.targets, ...l.bonus, ...l.acceptOnly];
    if (new Set(words).size !== words.length) throw new Error(`class overlap ${l.levelId}`);
    for (const t of l.targets) {
      if (!canConstructExact(t, l.letters)) throw new Error(`unconstructible ${l.levelId}:${t}`);
      if (classes.get(t) === 'BLOCKED' || classes.get(t) === 'REVIEW') throw new Error(`forbidden target ${t}`);
    }
    const identity = l.letters.slice().sort().join('') + ':' + l.targets.slice().sort().join('|');
    if (identities.has(identity)) throw new Error(`duplicate identity ${l.levelId}`);
    identities.add(identity);
  }
}
