import { beforeEach, describe, expect, it } from 'vitest';
import { CAMPAIGN } from '../content/campaign';
import { bootstrapData, closeGameDb, DB_NAME, exportSave, getProfile, getProgress, importSave, openGameDb, submitWord, useHint, verifySchema } from './store';

async function deleteDb() { await closeGameDb(); await new Promise<void>((resolve, reject) => { const r = indexedDB.deleteDatabase(DB_NAME); r.onsuccess = () => resolve(); r.onerror = () => reject(r.error); r.onblocked = () => resolve(); }); }

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
  });
  it('pins level hash and fails closed on mismatch', async () => {
    await bootstrapData();
    const level = CAMPAIGN.levels[0];
    await getProgress(level);
    await expect(getProgress({...level, hash:'changed'})).rejects.toThrow('REC_CONTENT_MISMATCH');
  });
  it('exports and validates import atomically', async () => {
    await bootstrapData();
    await submitWord(CAMPAIGN.levels[0], 'CAT');
    const save = await exportSave();
    await deleteDb(); await bootstrapData();
    await expect(importSave(save)).resolves.toBeUndefined();
    await expect(importSave({envelope:'word-connect-save-v1', campaignVersion: CAMPAIGN.campaignVersion, campaignHash:'bad', data:{}})).rejects.toThrow('REC_IMPORT_INVALID');
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
  it('legacy profile migration adds campaignVersion once and preserves coins/progress on replay', async () => {
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
  it('fails closed before overwriting immutable same campaign level content', async () => {
    await bootstrapData();
    const db = await openGameDb();
    await db.put('levels', { ...CAMPAIGN.levels[0], hash: 'conflict' });
    await expect(bootstrapData()).rejects.toThrow('REC_CONTENT_IMMUTABLE_CONFLICT');
  });
});
