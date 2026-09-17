import { beforeEach, describe, expect, it } from 'vitest';
import { CAMPAIGN, LEGACY_CAMPAIGNS } from '../content/campaign';
import type { ProgressRecord } from '../types';
import { bootstrapData, closeGameDb, DB_NAME, exportSave, getAchievements, getProfile, getProgress, getSettings, getStats, importSave, openGameDb, submitWord, updateSettings, useHint, verifySchema, PROFILE_ID } from './store';

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
    expect((await getProfile()).coins).toBe(20);
  });
  it('persists settings updates across database reopen and recreates missing settings conservatively', async () => {
    await bootstrapData();
    expect(await getSettings()).toMatchObject({ profileId: PROFILE_ID, sound: true, haptics: true, reducedMotion: false });
    await updateSettings({ sound: false, reducedMotion: true });
    await closeGameDb();
    await bootstrapData();
    expect(await getSettings()).toMatchObject({ sound: false, haptics: true, reducedMotion: true });
    const db = await openGameDb();
    await db.delete('settings', PROFILE_ID);
    expect(await getSettings()).toMatchObject({ sound: true, haptics: true, reducedMotion: false });
  });
  it('commits target progress and coins once; replay gives no duplicate reward', async () => {
    await bootstrapData();
    const level = CAMPAIGN.levels[0];
    let res = await submitWord(level, 'CAT');
    expect(res.outcome.kind).toBe('TARGET');
    expect(res.profile.coins).toBe(23);
    res = await submitWord(level, 'CAT');
    expect(res.outcome.kind).toBe('ALREADY_FOUND');
    expect(res.profile.coins).toBe(23);
  });
  it('persists combo transitions and aggregate stats for all outcomes', async () => {
    await bootstrapData();
    const level = CAMPAIGN.levels[0];
    await submitWord(level, 'CAT');
    expect((await getProfile()).combo).toBe(1);
    await submitWord(level, 'AT');
    expect((await getProfile()).combo).toBe(2);
    await submitWord(level, 'ZZZ');
    expect((await getProfile()).combo).toBe(0);
    await submitWord(level, 'CAT');
    expect((await getProfile()).combo).toBe(0);
    const stats = await getStats();
    expect(stats).toMatchObject({ submissions: 4, targets: 1, bonus: 1, invalid: 1, alreadyFound: 1, bestCombo: 2 });
    expect(await (await openGameDb()).getAll('gameEvents')).toHaveLength(4);
  });
  it('backfills a missing v3 aggregate from durable daily, economy, and completed progress', async () => {
    await bootstrapData();
    const db = await openGameDb();
    await db.delete('statsAggregate', PROFILE_ID);
    await db.put('statsDaily', { profileId: PROFILE_ID, date: '2026-09-16', submissions: 4, targets: 2, bonus: 1 });
    await db.put('economyEvents', { profileId: PROFILE_ID, levelId: 'L001', word: 'CAT', kind: 'TARGET', coinsDelta: 5, createdAt: 'old' });
    await db.put('economyEvents', { profileId: PROFILE_ID, levelId: 'L001', word: 'ACT', kind: 'TARGET', coinsDelta: 25, createdAt: 'old' });
    await db.put('economyEvents', { profileId: PROFILE_ID, levelId: 'L001', kind: 'HINT', hint: 'CAT', hintKind: 'word', coinsDelta: -10, createdAt: 'old' });
    await db.put('progress', { profileId: PROFILE_ID, campaignVersion: CAMPAIGN.campaignVersion, levelId: 'L001', levelRevision: CAMPAIGN.levels[0].revision, levelHash: CAMPAIGN.levels[0].hash, foundTargets: ['CAT', 'ACT'], foundBonus: [], completed: true, updatedAt: 'old' });
    await bootstrapData();
    expect(await getStats()).toMatchObject({ submissions: 4, targets: 2, bonus: 1, levelsCompleted: 1, coinsEarned: 30, coinsSpent: 10, acceptOnly: 0, invalid: 0, alreadyFound: 0, bestCombo: 0 });
  });
  it('completion reward is not duplicated after reload/replay', async () => {
    await bootstrapData();
    const level = CAMPAIGN.levels[0];
    await submitWord(level, 'CAT'); await submitWord(level, 'ACT');
    const after = await getProfile();
    expect(after.coins).toBe(36); // 20 + 3 + 3 + 10 completion
    await submitWord(level, 'ACT');
    expect((await getProfile()).coins).toBe(36);
  });
  it('spends hint coins transactionally', async () => {
    await bootstrapData();
    const res = await useHint(CAMPAIGN.levels[0]);
    expect(res.hint).toBe('CAT');
    expect(res.profile.coins).toBe(12);
    expect(res.progress.revealedWords).toEqual(['CAT']);
    expect((await getProgress(CAMPAIGN.levels[0])).revealedWords).toEqual(['CAT']);
    expect((await getStats()).coinsSpent).toBe(8);
  });
  it('persists letter hints and never targets a solved word', async () => {
    await bootstrapData();
    const level = CAMPAIGN.levels[0];
    await submitWord(level, 'CAT');
    const res = await useHint(level, 'first-letter');
    expect(res.hint).toBe('ACT');
    expect(res.profile.coins).toBe(19); // 20 + 3 for CAT - 4 for the hint
    expect(res.progress.revealedLetters?.ACT).toEqual([0]);
    await closeGameDb();
    await bootstrapData();
    expect((await getProgress(level)).revealedLetters?.ACT).toEqual([0]);
  });
  it('charges 2 coins for a letter hint and prefers hidden non-first letters durably', async () => {
    await bootstrapData();
    const level = CAMPAIGN.levels[0];
    const first = await useHint(level, 'letter');
    expect(first.hint).toBe('CAT');
    expect(first.charged).toBe(true);
    expect(first.profile.coins).toBe(18);
    expect(first.progress.revealedLetters?.CAT).toEqual([1]);
    const second = await useHint(level, 'letter');
    expect(second.hint).toBe('CAT');
    expect(second.profile.coins).toBe(16);
    expect(second.progress.revealedLetters?.CAT).toEqual([1, 2]);
    await closeGameDb();
    await bootstrapData();
    expect((await getProgress(level)).revealedLetters?.CAT).toEqual([1, 2]);
  });
  it('does not charge duplicate or unavailable hint information', async () => {
    await bootstrapData();
    const level = CAMPAIGN.levels[2];
    await useHint(level, 'letter');
    await useHint(level, 'first-letter');
    await useHint(level, 'letter');
    const before = await getProfile();
    const beforeStats = await getStats();
    const result = await useHint(level, 'letter');
    expect(result.hint).toBeUndefined();
    expect(result.charged).toBe(false);
    expect(result.profile.coins).toBe(before.coins);
    expect((await getStats()).coinsSpent).toBe(beforeStats.coinsSpent);
  });
  it('does not charge or mutate when there are insufficient coins for a hint', async () => {
    await bootstrapData();
    const db = await openGameDb();
    const profile: any = await db.get('profiles', PROFILE_ID);
    profile.coins = 1;
    await db.put('profiles', profile);
    const level = CAMPAIGN.levels[0];
    const beforeProgress = await getProgress(level);
    const result = await useHint(level, 'letter');
    expect(result.hint).toBe('CAT');
    expect(result.charged).toBe(false);
    expect(result.profile.coins).toBe(1);
    expect(result.progress).toEqual(beforeProgress);
    expect(await getProfile()).toEqual(profile);
  });
  it('skips a fully letter-revealed target for Reveal Word', async () => {
    await bootstrapData();
    const level = CAMPAIGN.levels[0];
    const db = await openGameDb();
    const saved = await getProgress(level);
    saved.revealedLetters = { CAT: [0, 1, 2] };
    await db.put('progress', saved);
    const result = await useHint(level, 'word');
    expect(result.hint).toBe('ACT');
    expect(result.charged).toBe(true);
    expect(result.progress.revealedWords).toEqual(['ACT']);
    expect(result.profile.coins).toBe(12);
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
  it('does not export diagnostic game events and preserves aggregate stats through import', async () => {
    await bootstrapData();
    await submitWord(CAMPAIGN.levels[0], 'CAT');
    await useHint(CAMPAIGN.levels[0], 'letter');
    const save: any = await exportSave();
    expect(save.data.gameEvents).toBeUndefined();
    const expected = await getStats();
    await deleteDb(); await bootstrapData(); await importSave(save);
    expect(await getStats()).toMatchObject({ submissions: expected.submissions, coinsSpent: expected.coinsSpent, bestCombo: expected.bestCombo });
  });
  it('reconstructs aggregate history when importing a legacy v2 save without statsAggregate', async () => {
    await bootstrapData();
    await submitWord(CAMPAIGN.levels[0], 'CAT');
    await useHint(CAMPAIGN.levels[0], 'word');
    await submitWord(CAMPAIGN.levels[0], 'ACT');
    const save: any = await exportSave();
    delete save.data.statsAggregate;
    await resign(save);
    await deleteDb();
    await bootstrapData();
    await importSave(save);
    expect(await getStats()).toMatchObject({ submissions: 2, targets: 2, bonus: 0, levelsCompleted: 1, coinsEarned: 16, coinsSpent: 8, acceptOnly: 0, invalid: 0, alreadyFound: 0, bestCombo: 0 });
  });
  it('preserves settings through signed export and import', async () => {
    await bootstrapData();
    await updateSettings({ sound: false, haptics: false, reducedMotion: true });
    const save = await exportSave();
    await deleteDb(); await bootstrapData();
    await importSave(save);
    expect(await getSettings()).toEqual({ profileId: PROFILE_ID, sound: false, haptics: false, reducedMotion: true });
  });
  it('rejects signed invalid settings without mutating the existing settings', async () => {
    await bootstrapData();
    await updateSettings({ sound: false });
    const before = await getSettings();
    const invalid: any = await exportSave();
    invalid.data.settings[0].sound = 'yes';
    await expect(importSave(await resign(invalid))).rejects.toThrow('REC_IMPORT_INVALID');
    expect(await getSettings()).toEqual(before);
  });
  it('rejects signed imports with unsafe revealed hint state', async () => {
    await bootstrapData();
    await useHint(CAMPAIGN.levels[0], 'first-letter');
    const invalid: any = await exportSave();
    invalid.data.progress[0].revealedLetters = { DOG: [0], CAT: [99] };
    await expect(importSave(await resign(invalid))).rejects.toThrow('REC_IMPORT_INVALID');
  });
  it('rejects malformed progress records without mutating the existing save', async () => {
    await bootstrapData();
    const before = await getProfile();
    await getProgress(CAMPAIGN.levels[0]);
    const invalid: any = await exportSave();
    invalid.data.progress[0].foundTargets = undefined;
    await expect(importSave(await resign(invalid))).rejects.toThrow('REC_IMPORT_INVALID');
    expect(await getProfile()).toEqual(before);
  });
  it('rejects null progress entries with REC_IMPORT_INVALID', async () => {
    await bootstrapData();
    const invalid: any = await exportSave();
    invalid.data.progress.push(null);
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
  it('unlocks achievements transactionally and idempotently', async () => {
    await bootstrapData();
    const level = CAMPAIGN.levels[0];
    await submitWord(level, 'CAT');
    expect((await getAchievements()).map(a => a.id)).toEqual(['first-target']);
    await submitWord(level, 'CAT');
    expect(await getAchievements()).toHaveLength(1);
    const save: any = await exportSave();
    expect(save.data.achievements).toHaveLength(1);
    await deleteDb(); await bootstrapData(); await importSave(save);
    await bootstrapData();
    expect((await getAchievements()).map(a => a.id)).toEqual(['first-target']);
  });
  it('backfills only verifiable achievements from older saves without achievement data', async () => {
    await bootstrapData();
    await submitWord(CAMPAIGN.levels[0], 'CAT');
    const save: any = await exportSave();
    delete save.data.achievements;
    await resign(save);
    await deleteDb(); await bootstrapData(); await importSave(save);
    expect((await getAchievements()).map(a => a.id)).toEqual(['first-target']);
  });
  it('rejects duplicate or unknown achievement records', async () => {
    await bootstrapData();
    const save: any = await exportSave();
    save.data.achievements = [{ id: 'first-target', profileId: PROFILE_ID, unlockedAt: 'x' }, { id: 'first-target', profileId: PROFILE_ID, unlockedAt: 'y' }];
    await expect(importSave(await resign(save))).rejects.toThrow('REC_IMPORT_INVALID');
    save.data.achievements = [{ id: 'made-up', profileId: PROFILE_ID, unlockedAt: 'x' }];
    await expect(importSave(await resign(save))).rejects.toThrow('REC_IMPORT_INVALID');
  });
});
