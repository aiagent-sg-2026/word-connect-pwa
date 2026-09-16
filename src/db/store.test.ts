import { beforeEach, describe, expect, it } from 'vitest';
import { CAMPAIGN, LEGACY_CAMPAIGNS } from '../content/campaign';
import type { ProgressRecord } from '../types';
import { bootstrapData, closeGameDb, DB_NAME, exportSave, getProfile, getProgress, importSave, openGameDb, submitWord, useHint, verifySchema, PROFILE_ID } from './store';

async function deleteDb() { await closeGameDb(); await new Promise<void>((resolve, reject) => { const r = indexedDB.deleteDatabase(DB_NAME); r.onsuccess = () => resolve(); r.onerror = () => reject(r.error); r.onblocked = () => resolve(); }); }
function stable(value: unknown): string { if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`; if (value && typeof value === 'object') return `{${Object.keys(value as Record<string, unknown>).sort().map(k => `${JSON.stringify(k)}:${stable((value as Record<string, unknown>)[k])}`).join(',')}}`; return JSON.stringify(value); }
async function resign(save: any) { const { integrity, ...rest } = save; const bytes = new TextEncoder().encode(stable(rest)); const hash = await crypto.subtle.digest('SHA-256', bytes); save.integrity = { ...integrity, digest: [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('') }; return save; }
async function seedProductionV1(progress: ProgressRecord[] = [{ ...baseV1Progress('L001'), foundTargets: ['CAT', 'ACT'], completed: true, completedAt: 'old-done' }]) {
  const v1 = LEGACY_CAMPAIGNS[0];
  const db = await openGameDb();
  await db.put('profiles', { profileId: PROFILE_ID, campaignVersion: v1.campaignVersion, coins: 77, hintsUsed: 2, currentLevelId: 'L004', createdAt: 'old', updatedAt: 'old' });
  await db.put('settings', { profileId: PROFILE_ID, sound: true, haptics: true, reducedMotion: false });
  for (const level of v1.levels) await db.put('levels', level);
  for (const p of progress) await db.put('progress', p);
  return db;
}
function baseV1Progress(levelId: string): ProgressRecord {
  const level = LEGACY_CAMPAIGNS[0].levels.find(l => l.levelId === levelId)!;
  return { profileId: PROFILE_ID, campaignVersion: level.campaignVersion, levelId, levelRevision: level.revision, levelHash: level.hash, foundTargets: [], foundBonus: [], completed: false, updatedAt: 'old' };
}

beforeEach(async () => { await deleteDb(); });

describe('indexeddb persistence', () => {
  it('bootstraps and verifies required schema signature stores', async () => {
    await bootstrapData();
    await expect(verifySchema(await openGameDb())).resolves.toBeUndefined();
    expect((await getProfile()).coins).toBe(25);
  });
  it('commits target progress and coins once; replay gives no duplicate reward', async () => {
    await bootstrapData();
    const level = CAMPAIGN.levels[0];
    let res = await submitWord(level, 'CAT');
    expect(res.outcome.kind).toBe('TARGET');
    expect(res.profile.coins).toBe(30);
    res = await submitWord(level, 'CAT');
    expect(res.outcome.kind).toBe('ALREADY_FOUND');
    expect(res.profile.coins).toBe(30);
  });
  it('completion reward is not duplicated after reload/replay', async () => {
    await bootstrapData();
    const level = CAMPAIGN.levels[0];
    await submitWord(level, 'CAT'); await submitWord(level, 'ACT');
    const after = await getProfile();
    expect(after.coins).toBe(55); // 25 + 5 + 5 + 20 completion
    await submitWord(level, 'ACT');
    expect((await getProfile()).coins).toBe(55);
  });
  it('spends hint coins transactionally', async () => {
    await bootstrapData();
    const res = await useHint(CAMPAIGN.levels[0]);
    expect(res.hint).toBe('CAT');
    expect(res.profile.coins).toBe(15);
    expect(res.progress.revealedWords).toEqual(['CAT']);
    expect((await getProgress(CAMPAIGN.levels[0])).revealedWords).toEqual(['CAT']);
  });
  it('persists letter hints and never targets a solved word', async () => {
    await bootstrapData();
    const level = CAMPAIGN.levels[0];
    await submitWord(level, 'CAT');
    const res = await useHint(level, 'first-letter');
    expect(res.hint).toBe('ACT');
    expect(res.profile.coins).toBe(25); // 25 + 5 for CAT - 5 for the hint
    expect(res.progress.revealedLetters?.ACT).toEqual([0]);
    await closeGameDb();
    await bootstrapData();
    expect((await getProgress(level)).revealedLetters?.ACT).toEqual([0]);
  });
  it('accept-only TSAR on L004 gives no coins and no progression', async () => {
    await bootstrapData();
    const before = await getProfile();
    const res = await submitWord(CAMPAIGN.levels[3], 'TSAR');
    expect(res.outcome.kind).toBe('ACCEPT_ONLY');
    expect(res.profile.coins).toBe(before.coins);
    expect(res.progress.foundTargets).toEqual([]);
    expect(res.progress.foundBonus).toEqual([]);
    expect(res.progress.completed).toBe(false);
  });
  it('pins level hash and fails closed on mismatch', async () => {
    await bootstrapData();
    const level = CAMPAIGN.levels[0];
    await getProgress(level);
    await expect(getProgress({...level, hash:'changed'})).rejects.toThrow('REC_CONTENT_MISMATCH');
  });
  it('exports and validates import atomically with durable hint state', async () => {
    await bootstrapData();
    await submitWord(CAMPAIGN.levels[0], 'CAT');
    await useHint(CAMPAIGN.levels[0], 'first-letter');
    const save: any = await exportSave();
    expect(save.campaignVersion).toBe('campaign-en-v2');
    expect(save.campaignHash).toBe(CAMPAIGN.campaignHash);
    await deleteDb(); await bootstrapData();
    await expect(importSave(save)).resolves.toBeUndefined();
    expect((await getProgress(CAMPAIGN.levels[0])).revealedLetters?.ACT).toEqual([0]);
    await expect(importSave({envelope:'word-connect-save-v1', campaignVersion: CAMPAIGN.campaignVersion, campaignHash:'bad', data:{}})).rejects.toThrow('REC_IMPORT_INVALID');
  });
  it('rejects signed imports with unsafe revealed hint state', async () => {
    await bootstrapData();
    await useHint(CAMPAIGN.levels[0], 'first-letter');
    const invalid: any = await exportSave();
    invalid.data.progress[0].revealedLetters = { DOG: [0], CAT: [99] };
    await expect(importSave(await resign(invalid))).rejects.toThrow('REC_IMPORT_INVALID');
  });
  it('rejects corrupted import integrity before mutating existing save data', async () => {
    await bootstrapData();
    const before = (await getProfile()).coins;
    const invalid: any = await exportSave();
    invalid.data.profiles[0].coins = -100;
    await expect(importSave(invalid)).rejects.toThrow('REC_IMPORT_INTEGRITY');
    expect((await getProfile()).coins).toBe(before);
  });
  it('rejects imported progress with forged content hash or duplicate found words', async () => {
    await bootstrapData();
    const invalid: any = await exportSave();
    invalid.data.progress.push({ profileId: 'local', campaignVersion: CAMPAIGN.campaignVersion, levelId: 'L001', levelRevision: 1, levelHash: 'forged', foundTargets: ['CAT', 'CAT'], foundBonus: [], completed: false, updatedAt: 'x' });
    invalid.integrity.digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('bad')).then(b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join(''));
    await expect(importSave(invalid)).rejects.toThrow();
  });
  it('legacy profile migration adds production v1 campaignVersion once before campaign migration', async () => {
    await bootstrapData();
    const db = await openGameDb();
    const profile: any = await db.get('profiles', 'local');
    profile.coins = 77;
    delete profile.campaignVersion;
    await db.put('profiles', profile);
    await db.put('meta', { id: 'saveDataVersion', value: 1 });
    await bootstrapData();
    await bootstrapData();
    const migrated = await getProfile();
    expect(migrated.campaignVersion).toBe(CAMPAIGN.campaignVersion);
    expect(migrated.coins).toBe(77);
    expect((await db.get('meta', 'saveDataVersion')).value).toBe(2);
  });
  it('migrates existing production v1 DB to v2 preserving coins, completion, current level, and old records', async () => {
    const db = await seedProductionV1([
      { ...baseV1Progress('L001'), foundTargets: ['CAT', 'ACT'], completed: true, completedAt: 'old-done' },
      { ...baseV1Progress('L004'), foundTargets: ['STAR'], foundBonus: ['RAT'], completed: false }
    ]);
    await bootstrapData();
    const profile = await getProfile();
    expect(profile.campaignVersion).toBe(CAMPAIGN.campaignVersion);
    expect(profile.coins).toBe(77);
    expect(profile.hintsUsed).toBe(2);
    expect(profile.currentLevelId).toBe('L004');
    const v2L1 = await db.get('progress', [PROFILE_ID, CAMPAIGN.campaignVersion, 'L001']);
    expect(v2L1.levelHash).toBe(CAMPAIGN.levels[0].hash);
    expect(v2L1.foundTargets).toEqual(['CAT', 'ACT']);
    expect(v2L1.completed).toBe(true);
    const v2L4 = await db.get('progress', [PROFILE_ID, CAMPAIGN.campaignVersion, 'L004']);
    expect(v2L4.foundBonus).toEqual(['RAT']);
    expect(await db.get('progress', [PROFILE_ID, LEGACY_CAMPAIGNS[0].campaignVersion, 'L001'])).toBeTruthy();
    expect(await db.get('levels', [LEGACY_CAMPAIGNS[0].campaignVersion, 'L001'])).toMatchObject({ hash: LEGACY_CAMPAIGNS[0].levels[0].hash });
  });
  it('v1 to v2 campaign migration is idempotent', async () => {
    const db = await seedProductionV1([{ ...baseV1Progress('L001'), foundTargets: ['CAT'], completed: false }]);
    await bootstrapData();
    const once = await db.get('progress', [PROFILE_ID, CAMPAIGN.campaignVersion, 'L001']);
    await bootstrapData();
    const twice = await db.get('progress', [PROFILE_ID, CAMPAIGN.campaignVersion, 'L001']);
    expect(twice).toEqual(once);
    expect((await getProfile()).campaignVersion).toBe(CAMPAIGN.campaignVersion);
  });
  it('fails closed for incompatible campaign versions without reset', async () => {
    const db = await openGameDb();
    await db.put('profiles', { profileId: PROFILE_ID, campaignVersion: 'campaign-en-v99', coins: 88, hintsUsed: 0, currentLevelId: 'L001', createdAt: 'x', updatedAt: 'x' });
    await expect(bootstrapData()).rejects.toThrow('REC_CAMPAIGN_VERSION_UNSUPPORTED');
    expect((await db.get('profiles', PROFILE_ID)).coins).toBe(88);
  });
  it('fails closed for invalid v1 progress without writing v2 migrated progress', async () => {
    const db = await seedProductionV1([{ ...baseV1Progress('L001'), foundTargets: ['CAT', 'TACT'], completed: false }]);
    await expect(bootstrapData()).rejects.toThrow('REC_CAMPAIGN_MIGRATION_INVALID_PROGRESS');
    expect((await db.get('profiles', PROFILE_ID)).campaignVersion).toBe(LEGACY_CAMPAIGNS[0].campaignVersion);
    expect(await db.get('progress', [PROFILE_ID, CAMPAIGN.campaignVersion, 'L001'])).toBeUndefined();
  });
  it('fails closed before overwriting immutable known campaign level content', async () => {
    await bootstrapData();
    const db = await openGameDb();
    await db.put('levels', { ...CAMPAIGN.levels[0], hash: 'conflict' });
    await expect(bootstrapData()).rejects.toThrow('REC_CONTENT_IMMUTABLE_CONFLICT');
    await db.put('levels', CAMPAIGN.levels[0]);
    await db.put('levels', { ...LEGACY_CAMPAIGNS[0].levels[0], hash: 'conflict' });
    await expect(bootstrapData()).rejects.toThrow('REC_CONTENT_IMMUTABLE_CONFLICT');
  });
});
