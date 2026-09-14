import { openDB, type IDBPDatabase } from 'idb';
import { CAMPAIGN } from '../content/campaign';
import { validateCampaign } from '../content/validate';
import { resolveOutcome, targetHint } from '../game/logic';
import type { LevelContract, ProfileRecord, ProgressRecord, SettingsRecord, WordOutcome } from '../types';

type AnyDb = IDBPDatabase<any>;
export const DB_NAME = 'word-connect-db';
export const DB_VERSION = 2;
export const PROFILE_ID = 'local';
export const SCHEMA_SIGNATURE = 'v2:meta,profiles,levels,progress,economyEvents,settings,statsDaily,achievements,gameEvents,migrationLog,saveSnapshots';

let dbp: Promise<AnyDb> | undefined;
let materialTransactions = 0;
const now = () => new Date().toISOString();
export const hasActiveMaterialTransaction = () => materialTransactions > 0;
async function material<T>(work: () => Promise<T>): Promise<T> { materialTransactions++; try { return await work(); } finally { materialTransactions--; } }

export async function openGameDb(): Promise<AnyDb> {
  if (!dbp) dbp = openDB(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion, _newVersion, tx) {
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('profiles')) db.createObjectStore('profiles', { keyPath: 'profileId' });
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'profileId' });
      for (const store of ['economyEvents','achievements','gameEvents','migrationLog','saveSnapshots']) if (!db.objectStoreNames.contains(store)) db.createObjectStore(store, { keyPath: 'id', autoIncrement: true });
      if (!db.objectStoreNames.contains('levels')) db.createObjectStore('levels', { keyPath: ['campaignVersion','levelId'] });
      if (!db.objectStoreNames.contains('progress')) db.createObjectStore('progress', { keyPath: ['profileId','campaignVersion','levelId'] });
      if (!db.objectStoreNames.contains('statsDaily')) db.createObjectStore('statsDaily', { keyPath: ['profileId','date'] });
      tx.objectStore('migrationLog').put({ id: `struct-${oldVersion}-to-${DB_VERSION}`, oldVersion, newVersion: DB_VERSION, completedAt: now() });
    }
  });
  return dbp;
}

export async function closeGameDb(): Promise<void> {
  if (dbp) (await dbp).close();
  dbp = undefined;
}

export async function verifySchema(db?: AnyDb): Promise<void> {
  db ||= await openGameDb();
  const required = ['meta','profiles','levels','progress','economyEvents','settings','statsDaily','achievements','gameEvents','migrationLog','saveSnapshots'];
  for (const s of required) if (!db.objectStoreNames.contains(s)) throw new Error(`REC_SCHEMA_MISSING_${s}`);
  const tx = db.transaction(['meta','profiles','levels','progress','settings','statsDaily'], 'readonly');
  const keyPaths: Record<string, unknown> = {
    profiles: 'profileId', settings: 'profileId', levels: ['campaignVersion','levelId'], progress: ['profileId','campaignVersion','levelId'], statsDaily: ['profileId','date']
  };
  for (const [store, expected] of Object.entries(keyPaths)) if (JSON.stringify(tx.objectStore(store).keyPath) !== JSON.stringify(expected)) throw new Error(`REC_SCHEMA_KEYPATH_${store}`);
  if (db.version !== DB_VERSION) throw new Error('REC_SCHEMA_VERSION');
  const sig = await tx.objectStore('meta').get('schemaSignature');
  if (sig && sig.value !== SCHEMA_SIGNATURE) throw new Error('REC_SCHEMA_SIGNATURE');
  await tx.done;
}

export async function bootstrapData(): Promise<void> {
  await validateCampaign();
  const db = await openGameDb();
  await verifySchema(db);
  const tx = db.transaction(['meta','profiles','levels','progress','settings'], 'readwrite');
  tx.objectStore('meta').put({ id: 'schemaSignature', value: SCHEMA_SIGNATURE });
  tx.objectStore('meta').put({ id: 'activeContentVersion', value: CAMPAIGN.contentVersion });
  tx.objectStore('meta').put({ id: 'campaignHash', value: CAMPAIGN.campaignHash });
  let profile = await tx.objectStore('profiles').get(PROFILE_ID) as ProfileRecord | undefined;
  if (!profile) {
    profile = { profileId: PROFILE_ID, coins: 25, hintsUsed: 0, currentLevelId: CAMPAIGN.levels[0].levelId, createdAt: now(), updatedAt: now() };
    await tx.objectStore('profiles').put(profile);
    await tx.objectStore('settings').put({ id: PROFILE_ID, profileId: PROFILE_ID, sound: true, haptics: true, reducedMotion: matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false } as SettingsRecord & {id:string});
  }
  for (const level of CAMPAIGN.levels) await tx.objectStore('levels').put(level);
  await tx.done;
}

export function getLevel(levelId: string): LevelContract {
  const level = CAMPAIGN.levels.find(l => l.levelId === levelId);
  if (!level) throw new Error('level not found');
  return level;
}

export async function getProfile(): Promise<ProfileRecord> {
  const db = await openGameDb();
  const p = await db.get('profiles', PROFILE_ID) as ProfileRecord | undefined;
  if (!p) throw new Error('REC_PROFILE_MISSING');
  return p;
}

export async function getProgress(level: LevelContract): Promise<ProgressRecord> {
  const db = await openGameDb();
  const key = [PROFILE_ID, level.campaignVersion, level.levelId];
  let p = await db.get('progress', key) as ProgressRecord | undefined;
  if (!p) {
    p = { profileId: PROFILE_ID, campaignVersion: level.campaignVersion, levelId: level.levelId, levelRevision: level.revision, levelHash: level.hash, foundTargets: [], foundBonus: [], completed: false, updatedAt: now() };
    await db.put('progress', p);
  }
  if (p.levelRevision !== level.revision || p.levelHash !== level.hash) throw new Error('REC_CONTENT_MISMATCH');
  return p;
}

export async function submitWord(level: LevelContract, word: string): Promise<{profile: ProfileRecord; progress: ProgressRecord; outcome: WordOutcome}> {
  return material(async () => {
    const db = await openGameDb();
    const tx = db.transaction(['profiles','progress','economyEvents','statsDaily'], 'readwrite');
    const profile = await tx.objectStore('profiles').get(PROFILE_ID) as ProfileRecord;
    let progress = await tx.objectStore('progress').get([PROFILE_ID, level.campaignVersion, level.levelId]) as ProgressRecord | undefined;
    progress ||= { profileId: PROFILE_ID, campaignVersion: level.campaignVersion, levelId: level.levelId, levelRevision: level.revision, levelHash: level.hash, foundTargets: [], foundBonus: [], completed: false, updatedAt: now() };
    if (progress.levelHash !== level.hash || progress.levelRevision !== level.revision) throw new Error('REC_CONTENT_MISMATCH');
    const outcome = resolveOutcome(level, progress, word);
    if (outcome.kind === 'TARGET') progress.foundTargets = [...progress.foundTargets, outcome.word];
    if (outcome.kind === 'BONUS') progress.foundBonus = [...progress.foundBonus, outcome.word];
    if (outcome.coinsDelta) profile.coins += outcome.coinsDelta;
    const firstComplete = !progress.completed && progress.foundTargets.length === level.targets.length;
    if (firstComplete) { progress.completed = true; progress.completedAt = now(); profile.coins += 20; }
    progress.updatedAt = profile.updatedAt = now();
    await tx.objectStore('profiles').put(profile);
    await tx.objectStore('progress').put(progress);
    if (outcome.coinsDelta || firstComplete) await tx.objectStore('economyEvents').add({ profileId: PROFILE_ID, levelId: level.levelId, word: outcome.word, kind: outcome.kind, coinsDelta: outcome.coinsDelta + (firstComplete ? 20 : 0), createdAt: now() });
    const date = new Date().toISOString().slice(0,10);
    const stat = (await tx.objectStore('statsDaily').get([PROFILE_ID,date])) || { profileId: PROFILE_ID, date, submissions: 0, targets: 0, bonus: 0 };
    stat.submissions++; if (outcome.kind === 'TARGET') stat.targets++; if (outcome.kind === 'BONUS') stat.bonus++;
    await tx.objectStore('statsDaily').put(stat);
    await tx.done;
    return { profile, progress, outcome };
  });
}

export async function useHint(level: LevelContract): Promise<{hint?: string; profile: ProfileRecord; progress: ProgressRecord; charged: boolean}> {
  return material(async () => {
    const db = await openGameDb();
    const tx = db.transaction(['profiles','progress','economyEvents'], 'readwrite');
    const profile = await tx.objectStore('profiles').get(PROFILE_ID) as ProfileRecord;
    let progress = await tx.objectStore('progress').get([PROFILE_ID, level.campaignVersion, level.levelId]) as ProgressRecord | undefined;
    progress ||= { profileId: PROFILE_ID, campaignVersion: level.campaignVersion, levelId: level.levelId, levelRevision: level.revision, levelHash: level.hash, foundTargets: [], foundBonus: [], completed: false, updatedAt: now() };
    if (progress.levelHash !== level.hash || progress.levelRevision !== level.revision) throw new Error('REC_CONTENT_MISMATCH');
    const hint = targetHint(level, progress);
    let charged = false;
    if (hint && profile.coins >= 10) { charged = true; profile.coins -= 10; profile.hintsUsed++; profile.updatedAt = now(); await tx.objectStore('profiles').put(profile); await tx.objectStore('progress').put(progress); await tx.objectStore('economyEvents').add({ profileId: PROFILE_ID, levelId: level.levelId, kind: 'HINT', coinsDelta: -10, hint, createdAt: now() }); }
    await tx.done;
    return { hint, profile, progress, charged };
  });
}

export async function setCurrentLevel(levelId: string): Promise<void> { const db = await openGameDb(); const p = await getProfile(); p.currentLevelId = levelId; p.updatedAt = now(); await db.put('profiles', p); }

export async function exportSave(): Promise<object> { const db = await openGameDb(); const dump: Record<string, unknown[]> = {}; for (const s of ['meta','profiles','progress','settings','economyEvents','statsDaily']) dump[s] = await db.getAll(s); return { envelope: 'word-connect-save-v1', exportedAt: now(), campaignVersion: CAMPAIGN.campaignVersion, campaignHash: CAMPAIGN.campaignHash, data: dump }; }

function requireArray(data: Record<string, unknown>, store: string): unknown[] { const value = data[store]; if (!Array.isArray(value)) throw new Error('REC_IMPORT_INVALID'); return value; }
function validateSaveEnvelope(envelope: any): Record<string, unknown[]> {
  if (!envelope || envelope.envelope !== 'word-connect-save-v1' || envelope.campaignVersion !== CAMPAIGN.campaignVersion || envelope.campaignHash !== CAMPAIGN.campaignHash || !envelope.data) throw new Error('REC_IMPORT_INVALID');
  const data = envelope.data as Record<string, unknown>;
  const out: Record<string, unknown[]> = {};
  for (const store of ['profiles','progress','settings','economyEvents','statsDaily']) out[store] = requireArray(data, store);
  const profiles = out.profiles as ProfileRecord[];
  if (profiles.length !== 1 || profiles[0].profileId !== PROFILE_ID || !Number.isFinite(profiles[0].coins) || profiles[0].coins < 0 || !CAMPAIGN.levels.some(l => l.levelId === profiles[0].currentLevelId)) throw new Error('REC_IMPORT_INVALID');
  const byId = new Map(CAMPAIGN.levels.map(l => [l.levelId, l]));
  for (const p of out.progress as ProgressRecord[]) {
    const level = byId.get(p.levelId);
    if (!level || p.profileId !== PROFILE_ID || p.campaignVersion !== CAMPAIGN.campaignVersion || p.levelRevision !== level.revision || p.levelHash !== level.hash) throw new Error('REC_IMPORT_INVALID');
    const targetSet = new Set(level.targets); const bonusSet = new Set(level.bonus);
    if (new Set(p.foundTargets).size !== p.foundTargets.length || new Set(p.foundBonus).size !== p.foundBonus.length) throw new Error('REC_IMPORT_INVALID');
    if (!p.foundTargets.every(w => targetSet.has(w)) || !p.foundBonus.every(w => bonusSet.has(w))) throw new Error('REC_IMPORT_INVALID');
  }
  return out;
}

export async function importSave(envelope: any): Promise<void> {
  const data = validateSaveEnvelope(envelope);
  const snapshot = await exportSave();
  await material(async () => {
    const db = await openGameDb();
    const tx = db.transaction(['profiles','progress','settings','economyEvents','statsDaily','saveSnapshots'], 'readwrite');
    await tx.objectStore('saveSnapshots').add({ createdAt: now(), reason: 'pre-import', data: snapshot });
    for (const store of ['profiles','progress','settings','economyEvents','statsDaily']) {
      await tx.objectStore(store).clear();
      for (const item of data[store]) await tx.objectStore(store).put(item);
    }
    await tx.done;
  });
}

export async function resetAll(): Promise<void> { const db = await openGameDb(); db.close(); dbp = undefined; await new Promise<void>((resolve, reject) => { const req = indexedDB.deleteDatabase(DB_NAME); req.onsuccess = () => resolve(); req.onerror = () => reject(req.error); req.onblocked = () => reject(new Error('REC_RESET_BLOCKED')); }); await bootstrapData(); }
