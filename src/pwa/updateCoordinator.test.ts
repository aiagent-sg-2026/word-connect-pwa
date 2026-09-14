import { beforeEach, describe, expect, it, vi } from 'vitest';
import { claimUpdateOwner, currentClientReady, isUpdateSafe, setReadinessProbe } from './updateCoordinator';

describe('service worker update coordination helpers', () => {
  beforeEach(() => localStorage.clear());

  it('fails closed unless every safe-gate condition is true', () => {
    const safe = { swipeEnded: true, progressSaved: true, materialTransactionActive: false, compatibilityStaged: true, allClientsReady: true };
    expect(isUpdateSafe(safe)).toBe(true);
    expect(isUpdateSafe({ ...safe, swipeEnded: false })).toBe(false);
    expect(isUpdateSafe({ ...safe, progressSaved: false })).toBe(false);
    expect(isUpdateSafe({ ...safe, materialTransactionActive: true })).toBe(false);
    expect(isUpdateSafe({ ...safe, compatibilityStaged: false })).toBe(false);
    expect(isUpdateSafe({ ...safe, allClientsReady: false })).toBe(false);
  });

  it('allows only one update owner until the lock expires', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.123);
    expect(claimUpdateOwner(1000, 'tab-a')).toBe('tab-a');
    expect(claimUpdateOwner(2000, 'tab-b')).toBeUndefined();
    expect(claimUpdateOwner(32_000, 'tab-b')).toBe('tab-b');
    vi.restoreAllMocks();
  });

  it('readiness probe fails closed on unready or throwing clients', async () => {
    setReadinessProbe(() => false);
    await expect(currentClientReady()).resolves.toBe(false);
    setReadinessProbe(() => { throw new Error('not ready'); });
    await expect(currentClientReady()).resolves.toBe(false);
    setReadinessProbe(() => true);
    await expect(currentClientReady()).resolves.toBe(true);
  });
});
