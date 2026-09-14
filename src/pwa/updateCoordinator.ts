export type UpdateSafetyState = {
  swipeEnded: boolean;
  progressSaved: boolean;
  materialTransactionActive: boolean;
  compatibilityStaged: boolean;
  allClientsReady: boolean;
};

export type ReadinessProbe = () => boolean | Promise<boolean>;

const CHANNEL = 'word-connect-update';
const LOCK_KEY = 'word-connect-update-owner';
const LOCK_MS = 30_000;

let readinessProbe: ReadinessProbe = () => true;

export function setReadinessProbe(probe: ReadinessProbe): void { readinessProbe = probe; }
export async function currentClientReady(): Promise<boolean> { try { return await readinessProbe(); } catch { return false; } }

export function isUpdateSafe(state: UpdateSafetyState): boolean {
  return state.swipeEnded && state.progressSaved && !state.materialTransactionActive && state.compatibilityStaged && state.allClientsReady;
}

export function claimUpdateOwner(now = Date.now(), owner = `${now}-${Math.random().toString(36).slice(2)}`): string | undefined {
  try {
    const raw = localStorage.getItem(LOCK_KEY);
    const current = raw ? JSON.parse(raw) as { owner: string; expiresAt: number } : undefined;
    if (current && current.expiresAt > now) return current.owner === owner ? owner : undefined;
    localStorage.setItem(LOCK_KEY, JSON.stringify({ owner, expiresAt: now + LOCK_MS }));
    return owner;
  } catch {
    return owner;
  }
}

export function announceUpdate(message: unknown): void {
  try {
    const bc = new BroadcastChannel(CHANNEL);
    bc.postMessage(message);
    bc.close();
  } catch {
    // BroadcastChannel is unavailable in some Safari contexts; local lock still prevents multi-owner activation.
  }
}
