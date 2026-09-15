import { defineConfig } from 'vite';
import { copyFileSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const base = '/word-connect-pwa/reviewer/';
const buildId = process.env.BUILD_ID || new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);

function reviewerServiceWorker() {
  return {
    name: 'reviewer-service-worker',
    closeBundle() {
      const dist = 'reviewer-dist';
      mkdirSync(join(dist, 'icons'), { recursive: true });
      copyFileSync('public/icons/icon-192.svg', join(dist, 'icons/icon-192.svg'));
      copyFileSync('public/icons/icon-512.svg', join(dist, 'icons/icon-512.svg'));
      copyFileSync(join(dist, 'reviewer.html'), join(dist, 'index.html'));
      writeFileSync(join(dist, 'reviewer-manifest.webmanifest'), JSON.stringify({
        name: 'Human Golden Reviewer', short_name: 'Golden Review', start_url: base, scope: base, display: 'standalone',
        theme_color: '#17352a', background_color: '#0c1712',
        icons: [
          { src: `${base}icons/icon-192.svg`, sizes: '192x192', type: 'image/svg+xml' },
          { src: `${base}icons/icon-512.svg`, sizes: '512x512', type: 'image/svg+xml' }
        ]
      }, null, 2) + '\n');
      const assets = readdirSync(join(dist, 'assets')).filter(f => /\.(js|css)$/.test(f)).map(f => `${base}assets/${f}`).sort();
      const critical = [base, `${base}index.html`, `${base}reviewer.html`, `${base}reviewer-manifest.webmanifest`, `${base}icons/icon-192.svg`, `${base}icons/icon-512.svg`, ...assets];
      const sw = `const CACHE=${JSON.stringify(`golden-reviewer-${buildId}`)};const PREFIX='golden-reviewer-';const BASE=${JSON.stringify(base)};const CRITICAL=${JSON.stringify(critical)};self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(CRITICAL))));self.addEventListener('activate',e=>e.waitUntil(Promise.all([caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith(PREFIX)&&k!==CACHE).map(k=>caches.delete(k)))),self.clients.claim()])));self.addEventListener('message',e=>{if(e.data&&e.data.type==='ACTIVATE_UPDATE')self.skipWaiting();});self.addEventListener('fetch',e=>{if(e.request.method!=='GET')return;const u=new URL(e.request.url);if(u.origin!==self.location.origin||!u.pathname.startsWith(BASE))return;e.respondWith(caches.match(e.request).then(x=>x||fetch(e.request).then(r=>{if(r.ok){const c=r.clone();caches.open(CACHE).then(k=>k.put(e.request,c));}return r;}).catch(()=>e.request.mode==='navigate'?caches.match(BASE):undefined)));});`;
      writeFileSync(join(dist, 'reviewer-sw.js'), sw);
    }
  };
}

export default defineConfig({ base, plugins: [reviewerServiceWorker()], build: { outDir: 'reviewer-dist', emptyOutDir: true, rollupOptions: { input: 'reviewer.html' } } });
