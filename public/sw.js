const BUILD_ID = new URL(self.location.href).searchParams.get('build') || 'dev';
const SHELL = `wordgame-shell-${BUILD_ID}`;
const RUNTIME = 'wordgame-runtime';
const CRITICAL = ['/', '/index.html', '/manifest.webmanifest', '/icons/icon-192.svg', '/icons/icon-512.svg'];
let bootOk = false;
let activatedByUser = false;

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    await cache.addAll(CRITICAL);
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING_IF_SAFE' && event.data.safe === true && event.data.buildId === BUILD_ID) {
    activatedByUser = true;
    self.skipWaiting();
  }
  if (event.data?.type === 'BOOT_OK' && event.data.buildId === BUILD_ID) {
    bootOk = true;
    event.waitUntil((async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter(k => k.startsWith('wordgame-shell-') && k !== SHELL).map(k => caches.delete(k)));
    })());
  }
});

async function boundedPut(cache, request, response) {
  await cache.put(request, response);
  const keys = await cache.keys();
  while (keys.length > 60) {
    const key = keys.shift();
    if (key) await cache.delete(key);
  }
}

function isShellRequest(request, url) {
  return request.mode === 'navigate' || CRITICAL.includes(url.pathname);
}

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || event.request.method !== 'GET') return;
  event.respondWith((async () => {
    const shellRequest = isShellRequest(event.request, url);
    const shellCache = await caches.open(SHELL);
    const runtimeCache = await caches.open(RUNTIME);
    const cache = shellRequest ? shellCache : runtimeCache;
    const cached = await cache.match(event.request);
    if (cached) return cached;
    try {
      const response = await fetch(event.request);
      if (response.ok && response.type === 'basic') await boundedPut(cache, event.request, response.clone());
      return response;
    } catch (err) {
      if (event.request.mode === 'navigate') return (await shellCache.match('/index.html')) || Response.error();
      return Response.error();
    }
  })());
});
