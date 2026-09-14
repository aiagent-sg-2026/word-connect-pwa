import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const buildId = process.env.BUILD_ID || new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);

function generatedServiceWorker() {
  return {
    name: 'word-connect-generated-service-worker',
    closeBundle() {
      const dist = 'dist';
      const assets = readdirSync(join(dist, 'assets')).filter(f => /\.(js|css)$/.test(f)).map(f => `/assets/${f}`).sort();
      const critical = ['/', '/index.html', '/manifest.webmanifest', '/icons/icon-192.svg', '/icons/icon-512.svg', ...assets];
      const sw = `const BUILD_ID = ${JSON.stringify(buildId)};\nconst SHELL = \`wordgame-shell-\${BUILD_ID}\`;\nconst RUNTIME = 'wordgame-runtime';\nconst CRITICAL = ${JSON.stringify(critical, null, 2)};\nlet bootOk = false;\nconst READY_TIMEOUT_MS = 2500;\n\nself.addEventListener('install', event => {\n  event.waitUntil((async () => {\n    const cache = await caches.open(SHELL);\n    await cache.addAll(CRITICAL);\n  })());\n});\n\nself.addEventListener('activate', event => { event.waitUntil(self.clients.claim()); });\n\nasync function clientReady(client) {\n  return await new Promise(resolve => {\n    const channel = new MessageChannel();\n    const timer = setTimeout(() => resolve(false), READY_TIMEOUT_MS);\n    channel.port1.onmessage = event => { clearTimeout(timer); resolve(event.data?.type === 'WC_READY_RESPONSE' && event.data.ready === true); };\n    try { client.postMessage({ type: 'WC_READY_REQUEST', buildId: BUILD_ID }, [channel.port2]); } catch { clearTimeout(timer); resolve(false); }\n  });\n}\nasync function allWindowClientsReady() {\n  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });\n  const results = await Promise.all(clients.map(clientReady));\n  return results.length > 0 && results.every(Boolean);\n}\n\nself.addEventListener('message', event => {\n  if (event.data?.type === 'SKIP_WAITING_IF_SAFE' && event.data.safe === true && event.data.owner) {\n    event.waitUntil((async () => { if (await allWindowClientsReady()) await self.skipWaiting(); })());\n  }\n  if (event.data?.type === 'BOOT_OK' && event.data.buildId === BUILD_ID) {\n    bootOk = true;\n    event.waitUntil((async () => {\n      const keys = await caches.keys();\n      await Promise.all(keys.filter(k => k.startsWith('wordgame-shell-') && k !== SHELL).map(k => caches.delete(k)));\n    })());\n  }\n});\n\nasync function boundedPut(cache, request, response) {\n  await cache.put(request, response);\n  const keys = await cache.keys();\n  while (keys.length > 60) { const key = keys.shift(); if (key) await cache.delete(key); }\n}\nfunction criticalRequestFor(request, url) {\n  if (request.mode === 'navigate') return '/index.html';\n  return CRITICAL.includes(url.pathname) ? url.pathname : undefined;\n}\n\nself.addEventListener('fetch', event => {\n  const url = new URL(event.request.url);\n  if (url.origin !== self.location.origin || event.request.method !== 'GET') return;\n  event.respondWith((async () => {\n    const shellKey = criticalRequestFor(event.request, url);\n    const shellCache = await caches.open(SHELL);\n    if (shellKey) {\n      const cached = await shellCache.match(shellKey);\n      if (cached) return cached;\n      const response = await fetch(event.request);\n      if (response.ok && response.type === 'basic') await shellCache.put(shellKey, response.clone());\n      return response;\n    }\n    const runtimeCache = await caches.open(RUNTIME);\n    const cached = await runtimeCache.match(event.request);\n    if (cached) return cached;\n    try { const response = await fetch(event.request); if (response.ok && response.type === 'basic') await boundedPut(runtimeCache, event.request, response.clone()); return response; }\n    catch { return event.request.mode === 'navigate' ? (await shellCache.match('/index.html')) || Response.error() : Response.error(); }\n  })());\n});\n`;
      writeFileSync(join(dist, 'sw.js'), sw);
      const index = readFileSync(join(dist, 'index.html'), 'utf8');
      if (!assets.every(a => index.includes(a))) throw new Error('Generated SW critical assets are not all in index.html');
    }
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [mode === 'development' ? basicSsl() : undefined, generatedServiceWorker()].filter(Boolean),
  define: {
    __BUILD_ID__: JSON.stringify(buildId),
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version || '0.1.0')
  }
}));
