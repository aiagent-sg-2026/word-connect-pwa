import { announceUpdate, claimUpdateOwner, isUpdateSafe, type UpdateSafetyState } from './updateCoordinator';

declare const __BUILD_ID__: string;

type UpdateHandlers = { onWaiting: (registration: ServiceWorkerRegistration) => void; onOfflineReady: () => void };

let refreshing = false;
export function registerServiceWorker(handlers: UpdateHandlers): void {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    sessionStorage.setItem('wc-reloaded-for-sw', __BUILD_ID__);
    location.reload();
  });
  window.addEventListener('load', async () => {
    const reg = await navigator.serviceWorker.register(`/sw.js?build=${encodeURIComponent(__BUILD_ID__)}`);
    if (reg.waiting) handlers.onWaiting(reg);
    reg.addEventListener('updatefound', () => {
      const installing = reg.installing;
      if (!installing) return;
      installing.addEventListener('statechange', () => { if (installing.state === 'installed') navigator.serviceWorker.controller ? handlers.onWaiting(reg) : handlers.onOfflineReady(); });
    });
    if (navigator.serviceWorker.controller) handlers.onOfflineReady();
  });
}

export function askWaitingWorkerToActivate(reg: ServiceWorkerRegistration, state: UpdateSafetyState): boolean {
  const owner = claimUpdateOwner();
  if (!owner || !isUpdateSafe(state)) return false;
  announceUpdate({ type: 'UPDATE_ACTIVATING', buildId: __BUILD_ID__, owner });
  reg.waiting?.postMessage({ type: 'SKIP_WAITING_IF_SAFE', safe: true, buildId: __BUILD_ID__, owner });
  return true;
}

export function bootOk(): void {
  navigator.serviceWorker?.controller?.postMessage({ type: 'BOOT_OK', buildId: __BUILD_ID__ });
}
