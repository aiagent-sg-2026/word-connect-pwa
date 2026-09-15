import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const packet = JSON.parse(readFileSync('content/golden/blind-review-packet-esdb-en-us-v1.json', 'utf8'));
const forbidden = /predictedClass|targetScore|bonusScore|\breasons\b|\bstrata\b|\bflags\b|frequencySignals|commonnessSignals/i;
if (Object.keys(packet.rows[0] ?? {}).some(k => forbidden.test(k)) || forbidden.test(JSON.stringify(packet))) throw new Error('Blind packet audit failed');
if (packet.rows.length !== 2000 || new Set(packet.rows.map(r => r.word)).size !== 2000 || new Set(packet.rows.map(r => r.candidateId)).size !== 2000) throw new Error('Blind packet count/uniqueness failed');
if (!existsSync('reviewer-dist/reviewer-sw.js') || !existsSync('reviewer-dist/reviewer-manifest.webmanifest')) throw new Error('Reviewer PWA artifacts missing');
function textFiles(root) { const out=[]; for (const name of readdirSync(root)) { const p=join(root,name); if(statSync(p).isDirectory()) out.push(...textFiles(p)); else out.push(p); } return out; }
const reviewerFiles=textFiles('reviewer-dist');
for (const path of reviewerFiles) { const text=readFileSync(path,'utf8'); if (forbidden.test(text)) throw new Error(`Reviewer output leaks forbidden field marker: ${path}`); }
const sw=readFileSync('reviewer-dist/reviewer-sw.js','utf8');
if (!sw.includes('ACTIVATE_UPDATE') || /install[^;]{0,600}skipWaiting/i.test(sw)) throw new Error('Reviewer update lifecycle is not user-controlled');
const manifest=JSON.parse(readFileSync('reviewer-dist/reviewer-manifest.webmanifest','utf8'));
if (manifest.scope !== '/word-connect-pwa/reviewer/' || manifest.display !== 'standalone') throw new Error('Reviewer manifest scope/display mismatch');
if (!existsSync('reviewer-dist/icons/icon-192.svg') || !existsSync('reviewer-dist/icons/icon-512.svg')) throw new Error('Reviewer local icons missing');
if (existsSync('dist')) { const mainMarkers=/blind-human-review-packet|human-golden-queue|dictionary-esdb|Human Golden Reviewer|word-connect-human-reviewer-v1/i; for(const path of textFiles('dist')) { const text=readFileSync(path,'utf8'); if(mainMarkers.test(text)) throw new Error(`Main runtime contains reviewer/corpus marker: ${path}`); } }
console.log(JSON.stringify({ verified:true, blindRows:packet.rows.length, reviewerOutputFiles:reviewerFiles.length, serviceWorker:'user-controlled-update', localIcons:true, mainRuntimeIsolation:existsSync('dist') }));
