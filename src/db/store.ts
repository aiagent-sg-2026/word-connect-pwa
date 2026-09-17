import { openDB, type IDBPDatabase } from 'idb';
import { CAMPAIGN, LEGACY_CAMPAIGNS } from '../content/campaign';
import { validateCampaign } from '../content/validate';
import { hintPlan, resolveOutcome } from '../game/logic';
import { nextCombo } from '../game/progression';
import { eligibleAchievements } from '../game/achievements';
import { ECONOMY, hintCost } from '../game/economy';
import type { AchievementRecord, LevelContract, ProfileRecord, ProgressRecord, SettingsRecord, StatsAggregateRecord, WordOutcome } from '../types';

type AnyDb = IDBPDatabase<any>;
export const DB_NAME = 'word-connect-db';
export const DB_VERSION = 4;
export const PROFILE_ID = 'local';
export const SAVE_DATA_VERSION = 2;
export const SCHEMA_SIGNATURE = 'v4:meta,profiles,levels,progress,economyEvents,settings,statsDaily,statsAggregate,achievements,gameEvents,migrationLog,saveSnapshots';

let dbp: Promise<AnyDb> | undefined;
let materialTransactions = 0;
declare const __BUILD_ID__: string;
declare const __APP_VERSION__: string;
const buildMeta = () => ({ appVersion: typeof __APP_VERSION__ === 'undefined' ? '0.1.0' : __APP_VERSION__, buildId: typeof __BUILD_ID__ === 'undefined' ? 'test' : __BUILD_ID__ });
const now = () => new Date().toISOString();
const defaultReducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const defaultSettings = (): SettingsRecord => ({ profileId: PROFILE_ID, sound: true, haptics: true, reducedMotion: defaultReducedMotion() });
const emptyAggregate = (): StatsAggregateRecord => ({ profileId: PROFILE_ID, submissions: 0, targets: 0, bonus: 0, acceptOnly: 0, invalid: 0, alreadyFound: 0, levelsCompleted: 0, coinsEarned: 0, coinsSpent: 0, bestCombo: 0, updatedAt: now() });
const achievementIds = new Set(['first-target','combo-3','combo-5','first-level','bonus-finder','coins-50','coins-100']);
function isSettingsRecord(value: unknown): value is SettingsRecord {
  const settings = value as Partial<SettingsRecord> | null;
  return !!settings && typeof settings === 'object' && settings.profileId === PROFILE_ID && typeof settings.sound === 'boolean' && typeof settings.haptics === 'boolean' && typeof settings.reducedMotion === 'boolean';
}
function assertSettingsRecord(value: unknown): asserts value is SettingsRecord {
  if (!isSettingsRecord(value)) throw new Error('REC_SETTINGS_INVALID');
}
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
      if (!db.objectStoreNames.contains('statsAggregate')) db.createObjectStore('statsAggregate', { keyPath: 'profileId' });
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
  const required = ['meta','profiles','levels','progress','economyEvents','settings','statsDaily','statsAggregate','achievements','gameEvents','migrationLog','saveSnapshots'];
  for (const s of required) if (!db.objectStoreNames.contains(s)) throw new Error(`REC_SCHEMA_MISSING_${s}`);
  const tx = db.transaction(['meta','profiles','levels','progress','settings','statsDaily','statsAggregate'], 'readonly');
  const keyPaths: Record<string, unknown> = {
    profiles: 'profileId', settings: 'profileId', levels: ['campaignVersion','levelId'], progress: ['profileId','campaignVersion','levelId'], statsDaily: ['profileId','date'], statsAggregate: 'profileId'
  };
  for (const [store, expected] of Object.entries(keyPaths)) if (JSON.stringify(tx.objectStore(store).keyPath) !== JSON.stringify(expected)) throw new Error(`REC_SCHEMA_KEYPATH_${store}`);
  if (db.version !== DB_VERSION) throw new Error('REC_SCHEMA_VERSION');
  const sig = await tx.objectStore('meta').get('schemaSignature');
  const legacySignature = 'v3:meta,profiles,levels,progress,economyEvents,settings,statsDaily,achievements,gameEvents,migrationLog,saveSnapshots';
  if (sig && sig.value !== SCHEMA_SIGNATURE && sig.value !== legacySignature) throw new Error('REC_SCHEMA_SIGNATURE');
  await tx.done;
}

const knownCampaigns = [CAMPAIGN, ...LEGACY_CAMPAIGNS];
const knownCampaignByVersion = new Map(knownCampaigns.map(c => [c.campaignVersion, c]));

function assertKnownCampaignVersion(version: string): void {
  if (!knownCampaignByVersion.has(version)) throw new Error('REC_CAMPAIGN_VERSION_UNSUPPORTED');
}

async function migrateSaveData(db: AnyDb): Promise<void> {
  const current = (await db.get('meta', 'saveDataVersion'))?.value ?? 1;
  if (current >= SAVE_DATA_VERSION) return;
  const tx = db.transaction(['meta','profiles','migrationLog'], 'readwrite');
  const profile = await tx.objectStore('profiles').get(PROFILE_ID) as (Partial<ProfileRecord> & { profileId: string }) | undefined;
  if (profile && !profile.campaignVersion) {
    await tx.objectStore('profiles').put({ ...profile, campaignVersion: LEGACY_CAMPAIGNS[0]?.campaignVersion ?? CAMPAIGN.campaignVersion, updatedAt: profile.updatedAt || now() });
    await tx.objectStore('migrationLog').put({ id: `save-v${current}-to-${SAVE_DATA_VERSION}-profile-campaign`, from: current, to: SAVE_DATA_VERSION, profileId: PROFILE_ID, campaignVersion: LEGACY_CAMPAIGNS[0]?.campaignVersion ?? CAMPAIGN.campaignVersion, completedAt: now() });
  } else if (profile?.campaignVersion) {
    assertKnownCampaignVersion(profile.campaignVersion);
    await tx.objectStore('migrationLog').put({ id: `save-v${current}-to-${SAVE_DATA_VERSION}-noop`, from: current, to: SAVE_DATA_VERSION, completedAt: now() });
  } else {
    await tx.objectStore('migrationLog').put({ id: `save-v${current}-to-${SAVE_DATA_VERSION}-noop`, from: current, to: SAVE_DATA_VERSION, completedAt: now() });
  }
  await tx.objectStore('meta').put({ id: 'saveDataVersion', value: SAVE_DATA_VERSION });
  await tx.done;
}

async function assertNoCampaignOverwrite(db: AnyDb): Promise<void> {
  const tx = db.transaction('levels', 'readonly');
  for (const campaign of knownCampaigns) for (const level of campaign.levels) {
    const existing = await tx.objectStore('levels').get([level.campaignVersion, level.levelId]) as LevelContract | undefined;
    if (existing && (existing.hash !== level.hash || existing.revision !== level.revision)) throw new Error('REC_CONTENT_IMMUTABLE_CONFLICT');
  }
  await tx.done;
}

function assertProgressCompatible(progress: ProgressRecord, from: LevelContract, to: LevelContract): void {
  if (progress.levelRevision !== from.revision || progress.levelHash !== from.hash) throw new Error('REC_CAMPAIGN_MIGRATION_INVALID_PROGRESS');
  if (new Set(progress.foundTargets).size !== progress.foundTargets.length || new Set(progress.foundBonus).size !== progress.foundBonus.length) throw new Error('REC_CAMPAIGN_MIGRATION_INVALID_PROGRESS');
  const targets = new Set(to.targets); const bonus = new Set(to.bonus);
  if (!progress.foundTargets.every(w => targets.has(w)) || !progress.foundBonus.every(w => bonus.has(w))) throw new Error('REC_CAMPAIGN_MIGRATION_INVALID_PROGRESS');
  if (progress.completed !== (progress.foundTargets.length === to.targets.length)) throw new Error('REC_CAMPAIGN_MIGRATION_INVALID_PROGRESS');
}

async function migrateActiveCampaign(db: AnyDb): Promise<void> {
  const profile = await db.get('profiles', PROFILE_ID) as ProfileRecord | undefined;
  if (!profile) return;
  assertKnownCampaignVersion(profile.campaignVersion);
  if (profile.campaignVersion === CAMPAIGN.campaignVersion) return;
  const source = knownCampaignByVersion.get(profile.campaignVersion)!;
  const sourceById = new Map(source.levels.map(l => [l.levelId, l]));
  const targetById = new Map(CAMPAIGN.levels.map(l => [l.levelId, l]));
  if (!targetById.has(profile.currentLevelId)) throw new Error('REC_CAMPAIGN_MIGRATION_INVALID_PROFILE');
  const oldProgress = await db.getAll('progress') as ProgressRecord[];
  const carried = oldProgress.filter(p => p.profileId === PROFILE_ID && p.campaignVersion === source.campaignVersion).map(p => {
    const from = sourceById.get(p.levelId); const to = targetById.get(p.levelId);
    if (!from || !to) throw new Error('REC_CAMPAIGN_MIGRATION_INVALID_PROGRESS');
    assertProgressCompatible(p, from, to);
    return { ...p, campaignVersion: CAMPAIGN.campaignVersion, levelRevision: to.revision, levelHash: to.hash, updatedAt: now() } satisfies ProgressRecord;
  });
  const tx = db.transaction(['profiles','progress','migrationLog'], 'readwrite');
  await tx.objectStore('profiles').put({ ...profile, campaignVersion: CAMPAIGN.campaignVersion, currentLevelId: profile.currentLevelId, updatedAt: now() });
  for (const p of carried) {
    const existing = await tx.objectStore('progress').get([PROFILE_ID, CAMPAIGN.campaignVersion, p.levelId]) as ProgressRecord | undefined;
    if (existing && (existing.levelHash !== p.levelHash || existing.levelRevision !== p.levelRevision)) throw new Error('REC_CONTENT_MISMATCH');
    await tx.objectStore('progress').put(existing ?? p);
  }
  await tx.objectStore('migrationLog').put({ id: `campaign-${source.campaignVersion}-to-${CAMPAIGN.campaignVersion}`, from: source.campaignVersion, to: CAMPAIGN.campaignVersion, profileId: PROFILE_ID, completedAt: now() });
  await tx.done;
}

export async function bootstrapData(): Promise<void> {
  await validateCampaign();
  const db = await openGameDb();
  await verifySchema(db);
  await assertNoCampaignOverwrite(db);
  await migrateSaveData(db);
  await migrateActiveCampaign(db);
  const tx = db.transaction(['meta','profiles','levels','progress','settings','statsDaily','economyEvents','statsAggregate'], 'readwrite');
  const metaBuild = buildMeta();
  tx.objectStore('meta').put({ id: 'schemaSignature', value: SCHEMA_SIGNATURE });
  tx.objectStore('meta').put({ id: 'appVersion', value: metaBuild.appVersion });
  tx.objectStore('meta').put({ id: 'lastSuccessfulBuild', value: metaBuild.buildId });
  tx.objectStore('meta').put({ id: 'pendingBuild', value: null });
  tx.objectStore('meta').put({ id: 'dbSchemaVersion', value: DB_VERSION });
  tx.objectStore('meta').put({ id: 'saveDataVersion', value: SAVE_DATA_VERSION });
  tx.objectStore('meta').put({ id: 'activeContentVersion', value: CAMPAIGN.contentVersion });
  tx.objectStore('meta').put({ id: 'dictionaryVersion', value: CAMPAIGN.levels[0].dictionaryVersion });
  tx.objectStore('meta').put({ id: 'scoringVersion', value: CAMPAIGN.levels[0].scoringVersion });
  tx.objectStore('meta').put({ id: 'generatorVersion', value: CAMPAIGN.levels[0].generatorVersion });
  tx.objectStore('meta').put({ id: 'campaignHash', value: CAMPAIGN.campaignHash });
  let profile = await tx.objectStore('profiles').get(PROFILE_ID) as ProfileRecord | undefined;
  if (!profile) {
    profile = { profileId: PROFILE_ID, campaignVersion: CAMPAIGN.campaignVersion, coins: ECONOMY.startingCoins, hintsUsed: 0, currentLevelId: CAMPAIGN.levels[0].levelId, createdAt: now(), updatedAt: now(), combo: 0, bestCombo: 0 };
    await tx.objectStore('profiles').put(profile);
  } else if (profile.campaignVersion !== CAMPAIGN.campaignVersion) {
    throw new Error('REC_CAMPAIGN_VERSION_UNSUPPORTED');
  }
  const settings = await tx.objectStore('settings').get(PROFILE_ID);
  if (settings === undefined) await tx.objectStore('settings').put({ id: PROFILE_ID, ...defaultSettings() });
  const aggregate = await tx.objectStore('statsAggregate').get(PROFILE_ID);
  if (aggregate === undefined) {
    const rebuilt = aggregateFromDurableEvidence(
      await tx.objectStore('statsDaily').getAll(),
      await tx.objectStore('economyEvents').getAll(),
      await tx.objectStore('progress').getAll(),
    );
    await tx.objectStore('statsAggregate').put(rebuilt);
  }
  if (profile.combo === undefined || profile.bestCombo === undefined) await tx.objectStore('profiles').put({ ...profile, combo: profile.combo ?? 0, bestCombo: profile.bestCombo ?? 0 });
  for (const level of CAMPAIGN.levels) await tx.objectStore('levels').put(level);
  await tx.done;
  await backfillAchievements(db);
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

export async function getStats(): Promise<StatsAggregateRecord> {
  const db = await openGameDb();
  const value = await db.get('statsAggregate', PROFILE_ID) as StatsAggregateRecord | undefined;
  return value ?? emptyAggregate();
}

export async function getAchievements(): Promise<AchievementRecord[]> {
  const db = await openGameDb();
  return (await db.getAll('achievements') as AchievementRecord[]).filter(a => a.profileId === PROFILE_ID);
}

async function backfillAchievements(db: AnyDb): Promise<void> {
  const profile = await db.get('profiles', PROFILE_ID) as ProfileRecord | undefined;
  if (!profile) return;
  const stats = (await db.get('statsAggregate', PROFILE_ID) as StatsAggregateRecord | undefined) ?? emptyAggregate();
  const progress = (await db.getAll('progress') as ProgressRecord[]).filter(p => p.profileId === PROFILE_ID && p.campaignVersion === CAMPAIGN.campaignVersion);
  const existing = new Set((await db.getAll('achievements') as AchievementRecord[]).filter(a => a.profileId === PROFILE_ID).map(a => a.id));
  const eligible = eligibleAchievements(profile, stats, progress).filter(id => !existing.has(id));
  if (!eligible.length) return;
  const tx = db.transaction('achievements', 'readwrite');
  for (const id of eligible) await tx.store.put({ id, profileId: PROFILE_ID, unlockedAt: now() });
  await tx.done;
}

export async function getSettings(): Promise<SettingsRecord> {
  const db = await openGameDb();
  const tx = db.transaction(['profiles', 'settings'], 'readwrite');
  const profile = await tx.objectStore('profiles').get(PROFILE_ID);
  if (!profile) throw new Error('REC_PROFILE_MISSING');
  const existing = await tx.objectStore('settings').get(PROFILE_ID);
  const settings = existing === undefined ? { id: PROFILE_ID, ...defaultSettings() } : existing;
  assertSettingsRecord(settings);
  if (existing === undefined) await tx.objectStore('settings').put(settings);
  await tx.done;
  return { profileId: settings.profileId, sound: settings.sound, haptics: settings.haptics, reducedMotion: settings.reducedMotion };
}

export async function updateSettings(patch: Partial<Pick<SettingsRecord, 'sound' | 'haptics' | 'reducedMotion'>>): Promise<SettingsRecord> {
  if (!patch || typeof patch !== 'object' || Object.keys(patch).some(key => !['sound', 'haptics', 'reducedMotion'].includes(key)) || Object.values(patch).some(value => typeof value !== 'boolean')) throw new Error('REC_SETTINGS_INVALID');
  const db = await openGameDb();
  const tx = db.transaction(['profiles', 'settings'], 'readwrite');
  if (!(await tx.objectStore('profiles').get(PROFILE_ID))) throw new Error('REC_PROFILE_MISSING');
  const existing = await tx.objectStore('settings').get(PROFILE_ID);
  const current = existing === undefined ? { id: PROFILE_ID, ...defaultSettings() } : existing;
  assertSettingsRecord(current);
  const updated = { ...current, ...patch, profileId: PROFILE_ID };
  await tx.objectStore('settings').put(updated);
  await tx.done;
  return { profileId: updated.profileId, sound: updated.sound, haptics: updated.haptics, reducedMotion: updated.reducedMotion };
}

export async function getProgress(level: LevelContract): Promise<ProgressRecord> {
  const db = await openGameDb();
  const key = [PROFILE_ID, level.campaignVersion, level.levelId];
  let p = await db.get('progress', key) as ProgressRecord | undefined;
  if (!p) {
    p = { profileId: PROFILE_ID, campaignVersion: level.campaignVersion, levelId: level.levelId, levelRevision: level.revision, levelHash: level.hash, foundTargets: [], foundBonus: [], completed: false, revealedLetters: {}, revealedWords: [], updatedAt: now() };
    await db.put('progress', p);
  }
  if (p.levelRevision !== level.revision || p.levelHash !== level.hash) throw new Error('REC_CONTENT_MISMATCH');
  return p;
}

export async function submitWord(level: LevelContract, word: string): Promise<{profile: ProfileRecord; progress: ProgressRecord; outcome: WordOutcome; unlocked: string[]}> {
  return material(async () => {
    const db = await openGameDb();
    const tx = db.transaction(['profiles','progress','economyEvents','statsDaily','statsAggregate','gameEvents','achievements'], 'readwrite');
    const profile = await tx.objectStore('profiles').get(PROFILE_ID) as ProfileRecord;
    let progress = await tx.objectStore('progress').get([PROFILE_ID, level.campaignVersion, level.levelId]) as ProgressRecord | undefined;
    progress ||= { profileId: PROFILE_ID, campaignVersion: level.campaignVersion, levelId: level.levelId, levelRevision: level.revision, levelHash: level.hash, foundTargets: [], foundBonus: [], completed: false, updatedAt: now() };
    if (progress.levelHash !== level.hash || progress.levelRevision !== level.revision) throw new Error('REC_CONTENT_MISMATCH');
    const outcome = resolveOutcome(level, progress, word);
    const comboBefore = profile.combo ?? 0;
    const combo = nextCombo(comboBefore, outcome.kind);
    if (outcome.kind === 'TARGET') progress.foundTargets = [...progress.foundTargets, outcome.word];
    if (outcome.kind === 'BONUS') progress.foundBonus = [...progress.foundBonus, outcome.word];
    if (outcome.coinsDelta) profile.coins += outcome.coinsDelta;
    profile.combo = combo;
    profile.bestCombo = Math.max(profile.bestCombo ?? 0, combo);
    const firstComplete = !progress.completed && progress.foundTargets.length === level.targets.length;
    if (firstComplete) { progress.completed = true; progress.completedAt = now(); profile.coins += ECONOMY.completionReward; }
    progress.updatedAt = profile.updatedAt = now();
    await tx.objectStore('profiles').put(profile);
    await tx.objectStore('progress').put(progress);
    if (outcome.coinsDelta || firstComplete) await tx.objectStore('economyEvents').add({ profileId: PROFILE_ID, levelId: level.levelId, word: outcome.word, kind: outcome.kind, coinsDelta: outcome.coinsDelta + (firstComplete ? ECONOMY.completionReward : 0), createdAt: now() });
    const date = new Date().toISOString().slice(0,10);
    const stat = (await tx.objectStore('statsDaily').get([PROFILE_ID,date])) || { profileId: PROFILE_ID, date, submissions: 0, targets: 0, bonus: 0 };
    stat.submissions++; if (outcome.kind === 'TARGET') stat.targets++; if (outcome.kind === 'BONUS') stat.bonus++;
    await tx.objectStore('statsDaily').put(stat);
    const aggregate = (await tx.objectStore('statsAggregate').get(PROFILE_ID) as StatsAggregateRecord | undefined) ?? emptyAggregate();
    aggregate.submissions++; aggregate.targets += outcome.kind === 'TARGET' ? 1 : 0; aggregate.bonus += outcome.kind === 'BONUS' ? 1 : 0;
    aggregate.acceptOnly += outcome.kind === 'ACCEPT_ONLY' ? 1 : 0; aggregate.invalid += outcome.kind === 'INVALID' ? 1 : 0; aggregate.alreadyFound += outcome.kind === 'ALREADY_FOUND' ? 1 : 0;
    aggregate.levelsCompleted += firstComplete ? 1 : 0; aggregate.coinsEarned += Math.max(0, outcome.coinsDelta) + (firstComplete ? ECONOMY.completionReward : 0); aggregate.bestCombo = Math.max(aggregate.bestCombo, combo); aggregate.updatedAt = now();
    await tx.objectStore('statsAggregate').put(aggregate);
    await tx.objectStore('gameEvents').add({ profileId: PROFILE_ID, levelId: level.levelId, word: outcome.word, outcome: outcome.kind, comboBefore, comboAfter: combo, createdAt: now() });
    const existing = new Set((await tx.objectStore('achievements').getAll() as AchievementRecord[]).filter(a => a.profileId === PROFILE_ID).map(a => a.id));
    const progressRows = (await tx.objectStore('progress').getAll() as ProgressRecord[]).filter(p => p.profileId === PROFILE_ID && p.campaignVersion === CAMPAIGN.campaignVersion);
    const unlocked = eligibleAchievements(profile, aggregate, progressRows).filter(id => !existing.has(id));
    for (const id of unlocked) await tx.objectStore('achievements').put({ id, profileId: PROFILE_ID, unlockedAt: now() });
    await tx.done;
    return { profile, progress, outcome, unlocked };
  });
}

export type HintKind = 'letter' | 'first-letter' | 'word';
export const HINT_COSTS: Record<HintKind, number> = ECONOMY.hintCosts;

export async function useHint(level: LevelContract, kind: HintKind = 'word'): Promise<{hint?: string; profile: ProfileRecord; progress: ProgressRecord; charged: boolean; kind: HintKind}> {
  return material(async () => {
    const db = await openGameDb();
    const tx = db.transaction(['profiles','progress','economyEvents','statsAggregate'], 'readwrite');
    const profile = await tx.objectStore('profiles').get(PROFILE_ID) as ProfileRecord;
    let progress = await tx.objectStore('progress').get([PROFILE_ID, level.campaignVersion, level.levelId]) as ProgressRecord | undefined;
    progress ||= { profileId: PROFILE_ID, campaignVersion: level.campaignVersion, levelId: level.levelId, levelRevision: level.revision, levelHash: level.hash, foundTargets: [], foundBonus: [], completed: false, revealedLetters: {}, revealedWords: [], updatedAt: now() };
    if (progress.levelHash !== level.hash || progress.levelRevision !== level.revision) throw new Error('REC_CONTENT_MISMATCH');
    const plan = hintPlan(level, progress, kind);
    const hint = plan?.word;
    let charged = false;
    const cost = hintCost(kind);
    if (hint && profile.coins >= cost) {
      charged = true; profile.coins -= cost; profile.hintsUsed++; profile.updatedAt = now();
      progress.revealedLetters ||= {}; progress.revealedWords ||= [];
      if (kind === 'word') progress.revealedWords = [...new Set([...progress.revealedWords, hint])];
      else { const indexes = progress.revealedLetters[hint] || []; const next = plan!.index!; progress.revealedLetters[hint] = [...new Set([...indexes, next])].filter(i => i >= 0 && i < hint.length).sort((a,b)=>a-b); }
      progress.updatedAt = now(); await tx.objectStore('profiles').put(profile); await tx.objectStore('progress').put(progress); await tx.objectStore('economyEvents').add({ profileId: PROFILE_ID, levelId: level.levelId, kind: 'HINT', coinsDelta: -cost, hint, hintKind: kind, createdAt: now() });
      const aggregate = (await tx.objectStore('statsAggregate').get(PROFILE_ID) as StatsAggregateRecord | undefined) ?? emptyAggregate();
      aggregate.coinsSpent += cost; aggregate.updatedAt = now();
      await tx.objectStore('statsAggregate').put(aggregate);
    }
    await tx.done;
    return { hint, profile, progress, charged, kind };
  });
}

export async function setCurrentLevel(levelId: string): Promise<void> { const db = await openGameDb(); const p = await getProfile(); p.currentLevelId = levelId; p.updatedAt = now(); await db.put('profiles', p); }

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value as Record<string, unknown>).sort().map(k => `${JSON.stringify(k)}:${stable((value as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
async function digestPayload(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(stable(value));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function aggregateFromDurableEvidence(dailyRows: unknown[], economyRows: unknown[], progressRows: unknown[]): StatsAggregateRecord {
  const aggregate = emptyAggregate();
  for (const row of dailyRows) {
    const r = row as Record<string, unknown>;
    if (r.profileId !== PROFILE_ID || typeof r.date !== 'string') throw new Error('REC_IMPORT_INVALID');
    for (const key of ['submissions', 'targets', 'bonus']) if (r[key] !== undefined && (!Number.isInteger(r[key]) || Number(r[key]) < 0)) throw new Error('REC_IMPORT_INVALID');
    aggregate.submissions += Number(r.submissions ?? 0); aggregate.targets += Number(r.targets ?? 0); aggregate.bonus += Number(r.bonus ?? 0);
    if (aggregate.targets + aggregate.bonus > aggregate.submissions) throw new Error('REC_IMPORT_INVALID');
  }
  for (const event of economyRows) {
    const e = event as Record<string, unknown>;
    if (!e || e.profileId !== PROFILE_ID || typeof e.levelId !== 'string' || !byLevel(e.levelId) || !['TARGET','BONUS','HINT'].includes(String(e.kind)) || !Number.isInteger(e.coinsDelta) || typeof e.createdAt !== 'string') throw new Error('REC_IMPORT_INVALID');
    if (e.kind === 'HINT' && (!['letter','first-letter','word'].includes(String(e.hintKind)) || typeof e.hint !== 'string')) throw new Error('REC_IMPORT_INVALID');
    if (e.kind !== 'HINT' && typeof e.word !== 'string') throw new Error('REC_IMPORT_INVALID');
    const delta = Number(e.coinsDelta);
    aggregate.coinsEarned += Math.max(0, delta);
    aggregate.coinsSpent += Math.max(0, -delta);
  }
  const byId = new Map(CAMPAIGN.levels.map(l => [l.levelId, l]));
  for (const value of progressRows) {
    const p = value as Partial<ProgressRecord>;
    if (!p || typeof p !== 'object' || p.profileId !== PROFILE_ID || p.campaignVersion !== CAMPAIGN.campaignVersion) continue;
    const level = byId.get(String(p.levelId));
    if (!level || p.levelRevision !== level.revision || p.levelHash !== level.hash || !Array.isArray(p.foundTargets) || !Array.isArray(p.foundBonus) || typeof p.completed !== 'boolean') throw new Error('REC_IMPORT_INVALID');
    if (new Set(p.foundTargets).size !== p.foundTargets.length || new Set(p.foundBonus).size !== p.foundBonus.length || !p.foundTargets.every(w => typeof w === 'string' && level.targets.includes(w)) || !p.foundBonus.every(w => typeof w === 'string' && level.bonus.includes(w)) || p.completed !== (p.foundTargets.length === level.targets.length)) throw new Error('REC_IMPORT_INVALID');
    aggregate.levelsCompleted += p.completed ? 1 : 0;
  }
  return aggregate;
}
function withoutIntegrity(envelope: any): any { const { integrity, ...rest } = envelope || {}; return rest; }

export async function exportSave(): Promise<object> {
  const db = await openGameDb();
  const dump: Record<string, unknown[]> = {};
  // gameEvents are diagnostic history, not required player state; omit them from portable saves.
  for (const s of ['profiles','progress','settings','economyEvents','statsDaily','statsAggregate','achievements']) dump[s] = await db.getAll(s);
  const envelope = { envelope: 'word-connect-save-v2', exportedAt: now(), campaignVersion: CAMPAIGN.campaignVersion, campaignHash: CAMPAIGN.campaignHash, saveDataVersion: SAVE_DATA_VERSION, data: dump };
  return { ...envelope, integrity: { algorithm: 'SHA-256', digest: await digestPayload(envelope) } };
}

function requireArray(data: Record<string, unknown>, store: string): unknown[] { const value = data[store]; if (!Array.isArray(value)) throw new Error('REC_IMPORT_INVALID'); return value; }
function nonNegativeInt(value: unknown): value is number { return Number.isInteger(value) && Number(value) >= 0; }
async function validateSaveEnvelope(envelope: any): Promise<Record<string, unknown[]>> {
  if (!envelope || envelope.envelope !== 'word-connect-save-v2' || envelope.campaignVersion !== CAMPAIGN.campaignVersion || envelope.campaignHash !== CAMPAIGN.campaignHash || envelope.saveDataVersion !== SAVE_DATA_VERSION || !envelope.data || envelope.integrity?.algorithm !== 'SHA-256') throw new Error('REC_IMPORT_INVALID');
  if (envelope.integrity.digest !== await digestPayload(withoutIntegrity(envelope))) throw new Error('REC_IMPORT_INTEGRITY');
  const data = envelope.data as Record<string, unknown>;
  const out: Record<string, unknown[]> = {};
  for (const store of ['profiles','progress','settings','economyEvents','statsDaily']) out[store] = requireArray(data, store);
  const hasAggregate = Array.isArray(data.statsAggregate);
  if (data.achievements !== undefined && !Array.isArray(data.achievements)) throw new Error('REC_IMPORT_INVALID');
  out.achievements = data.achievements === undefined ? [] : data.achievements as unknown[];
  out.statsAggregate = hasAggregate ? data.statsAggregate as unknown[] : [];
  out.gameEvents = [];
  const profiles = out.profiles as ProfileRecord[];
  if (profiles.length !== 1 || profiles[0].profileId !== PROFILE_ID || profiles[0].campaignVersion !== CAMPAIGN.campaignVersion || !nonNegativeInt(profiles[0].coins) || !nonNegativeInt(profiles[0].hintsUsed) || !CAMPAIGN.levels.some(l => l.levelId === profiles[0].currentLevelId) || (profiles[0].combo !== undefined && !nonNegativeInt(profiles[0].combo)) || (profiles[0].bestCombo !== undefined && !nonNegativeInt(profiles[0].bestCombo))) throw new Error('REC_IMPORT_INVALID');
  profiles[0] = { ...profiles[0], combo: profiles[0].combo ?? 0, bestCombo: profiles[0].bestCombo ?? 0 };
  const settings = out.settings;
  if (settings.length !== 1 || !isSettingsRecord(settings[0])) throw new Error('REC_IMPORT_INVALID');
  for (const event of out.economyEvents) {
    const e = event as Record<string, unknown>;
    if (!e || e.profileId !== PROFILE_ID || typeof e.levelId !== 'string' || !byLevel(e.levelId) || !['TARGET','BONUS','HINT'].includes(String(e.kind)) || !Number.isInteger(e.coinsDelta) || typeof e.createdAt !== 'string') throw new Error('REC_IMPORT_INVALID');
    if (e.kind === 'HINT' && (!['letter','first-letter','word'].includes(String(e.hintKind)) || typeof e.hint !== 'string')) throw new Error('REC_IMPORT_INVALID');
    if (e.kind !== 'HINT' && typeof e.word !== 'string') throw new Error('REC_IMPORT_INVALID');
  }
  for (const row of out.statsDaily) {
    const r = row as Record<string, unknown>;
    if (!r || r.profileId !== PROFILE_ID || typeof r.date !== 'string' || ['submissions','targets','bonus'].some(key => !nonNegativeInt(r[key]))) throw new Error('REC_IMPORT_INVALID');
  }
  const byId = new Map(CAMPAIGN.levels.map(l => [l.levelId, l]));
  for (const p of out.progress as ProgressRecord[]) {
    if (!p || typeof p !== 'object') throw new Error('REC_IMPORT_INVALID');
    const level = byId.get(p.levelId);
    if (!level || p.profileId !== PROFILE_ID || p.campaignVersion !== CAMPAIGN.campaignVersion || p.levelRevision !== level.revision || p.levelHash !== level.hash || !Array.isArray(p.foundTargets) || !Array.isArray(p.foundBonus) || typeof p.completed !== 'boolean') throw new Error('REC_IMPORT_INVALID');
    const targetSet = new Set(level.targets); const bonusSet = new Set(level.bonus);
    if (new Set(p.foundTargets).size !== p.foundTargets.length || new Set(p.foundBonus).size !== p.foundBonus.length) throw new Error('REC_IMPORT_INVALID');
    if (!p.foundTargets.every(w => typeof w === 'string' && targetSet.has(w)) || !p.foundBonus.every(w => typeof w === 'string' && bonusSet.has(w))) throw new Error('REC_IMPORT_INVALID');
    if (p.revealedWords !== undefined && (!Array.isArray(p.revealedWords) || new Set(p.revealedWords).size !== p.revealedWords.length || !p.revealedWords.every(w => typeof w === 'string' && targetSet.has(w)))) throw new Error('REC_IMPORT_INVALID');
    if (p.revealedLetters !== undefined) {
      if (!p.revealedLetters || typeof p.revealedLetters !== 'object' || Array.isArray(p.revealedLetters)) throw new Error('REC_IMPORT_INVALID');
      for (const [word, indexes] of Object.entries(p.revealedLetters)) {
        if (!targetSet.has(word) || !Array.isArray(indexes) || new Set(indexes).size !== indexes.length || !indexes.every(i => Number.isInteger(i) && i >= 0 && i < word.length)) throw new Error('REC_IMPORT_INVALID');
      }
    }
  }
  if (!hasAggregate) out.statsAggregate = [aggregateFromDurableEvidence(out.statsDaily, out.economyEvents, out.progress)];
  if (out.statsAggregate.length !== 1) throw new Error('REC_IMPORT_INVALID');
  const aggregate = out.statsAggregate[0] as Partial<StatsAggregateRecord>;
  if (!aggregate || aggregate.profileId !== PROFILE_ID || ['submissions','targets','bonus','acceptOnly','invalid','alreadyFound','levelsCompleted','coinsEarned','coinsSpent','bestCombo'].some(k => !nonNegativeInt(aggregate[k as keyof StatsAggregateRecord]))) throw new Error('REC_IMPORT_INVALID');
  const trustedEligible = new Set(eligibleAchievements(profiles[0], aggregate as StatsAggregateRecord, out.progress as ProgressRecord[]));
  const ids = new Set<string>();
  for (const record of out.achievements as AchievementRecord[]) {
    if (!record || typeof record !== 'object' || record.profileId !== PROFILE_ID || typeof record.id !== 'string' || !achievementIds.has(record.id) || !trustedEligible.has(record.id) || typeof record.unlockedAt !== 'string' || ids.has(record.id)) throw new Error('REC_IMPORT_INVALID');
    ids.add(record.id);
  }
  return out;
}

function byLevel(levelId: string): LevelContract | undefined { return CAMPAIGN.levels.find(level => level.levelId === levelId); }

export async function importSave(envelope: any): Promise<void> {
  const data = await validateSaveEnvelope(envelope);
  const snapshot = await exportSave();
  await material(async () => {
    const db = await openGameDb();
    const tx = db.transaction(['profiles','progress','settings','economyEvents','statsDaily','statsAggregate','gameEvents','achievements','saveSnapshots'], 'readwrite');
    await tx.objectStore('saveSnapshots').add({ createdAt: now(), reason: 'pre-import', data: snapshot });
    for (const store of ['profiles','progress','settings','economyEvents','statsDaily','statsAggregate','gameEvents','achievements']) {
      await tx.objectStore(store).clear();
      for (const item of data[store]) await tx.objectStore(store).put(item);
    }
    await tx.done;
    await backfillAchievements(db);
  });
}

export async function resetAll(): Promise<void> { const db = await openGameDb(); db.close(); dbp = undefined; await new Promise<void>((resolve, reject) => { const req = indexedDB.deleteDatabase(DB_NAME); req.onsuccess = () => resolve(); req.onerror = () => reject(req.error); req.onblocked = () => reject(new Error('REC_RESET_BLOCKED')); }); await bootstrapData(); }
