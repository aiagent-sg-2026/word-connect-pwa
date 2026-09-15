import { readSourceFile } from './content/io.mjs';
import { buildDictionary } from '../src/content-pipeline/dictionary.ts';
import { buildGoldenQueue, evaluateGolden, exportBlindPacket, parseReviewsJson, publishGolden, readJsonIfExists, statusStats, toCsv, writeJson } from '../src/golden/workflow.ts';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';

const cmd = process.argv[2];
const outDir = 'content/golden';
const queuePath = `${outDir}/human-golden-queue-v1.json`;
const reviewsPath = 'data/golden/reviews/human-reviews-v1.json';
const adjudicationsPath = 'data/golden/reviews/human-adjudications-v1.json';
const publishedPath = `${outDir}/published-human-golden-v1.json`;
async function dict() { return buildDictionary(readSourceFile('data/qa-seed/words.json')); }
async function queue() { const q = buildGoldenQueue(await dict()); writeJson(queuePath, q); return q; }
function loadQueue() { return JSON.parse(readFileSync(queuePath, 'utf8')); }
function loadReviews() { return readJsonIfExists(reviewsPath, { reviews: [] }).reviews ?? readJsonIfExists(reviewsPath, []); }
function loadAdj() { return readJsonIfExists(adjudicationsPath, { adjudications: [] }).adjudications ?? readJsonIfExists(adjudicationsPath, []); }

if (!cmd) { console.error('Usage: golden <queue|review:export|review:validate|status|publish|eval>'); process.exit(2); }
if (cmd === 'queue') { const q = await queue(); console.log(JSON.stringify({ path: queuePath, checksum: q.checksum, candidateCount: q.candidateCount, shortfall: q.shortfall })); }
else if (cmd === 'review:export') { const q = existsSync(queuePath) ? loadQueue() : await queue(); const packet = exportBlindPacket(q); writeJson(`${outDir}/blind-review-packet-v1.json`, packet); writeFileSync(`${outDir}/blind-review-packet-v1.csv`, toCsv(packet.rows)); console.log(JSON.stringify({ json: `${outDir}/blind-review-packet-v1.json`, csv: `${outDir}/blind-review-packet-v1.csv`, candidateCount: q.candidateCount, blind: true })); }
else if (cmd === 'review:validate') { const q = existsSync(queuePath) ? loadQueue() : await queue(); const path = process.argv[3] ?? reviewsPath; const { validateReviews } = await import('../src/golden/workflow.ts'); const errors = validateReviews(q, parseReviewsJson(path)); console.log(JSON.stringify({ path, valid: errors.length === 0, errors }, null, 2)); if (errors.length) process.exitCode = 1; }
else if (cmd === 'status') { const q = existsSync(queuePath) ? loadQueue() : await queue(); const status = statusStats(q, loadReviews(), loadAdj()); writeJson(`${outDir}/human-golden-status-v1.json`, status); console.log(JSON.stringify(status, null, 2)); }
else if (cmd === 'publish') { const q = existsSync(queuePath) ? loadQueue() : await queue(); const draft = process.argv.includes('--draft'); const artifact = publishGolden(q, loadReviews(), loadAdj(), { draft }); writeJson(publishedPath, artifact); console.log(JSON.stringify({ path: publishedPath, readiness: artifact.manifest.readiness, checksum: artifact.manifest.checksum, itemCount: artifact.manifest.itemCount })); }
else if (cmd === 'eval') { const golden = existsSync(publishedPath) ? JSON.parse(readFileSync(publishedPath, 'utf8')) : publishGolden(existsSync(queuePath) ? loadQueue() : await queue(), loadReviews(), loadAdj(), { draft: true }); const report = evaluateGolden(golden, await dict()); writeJson(`${outDir}/human-golden-eval-v1.json`, report); console.log(JSON.stringify(report, null, 2)); }
else { console.error(`Unknown golden command: ${cmd}`); process.exit(2); }
