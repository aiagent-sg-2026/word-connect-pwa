import { readSourceFile } from './content/io.mjs';
import { buildDictionary } from '../src/content-pipeline/dictionary.ts';
import { assertValidQueue, buildGoldenQueue, evaluateGolden, exportBlindPacket, parseReviewsFile, publishGolden, readJsonIfExists, statusStats, toCsv, validateReviews, writeJson } from '../src/golden/workflow.ts';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';

const cmd = process.argv[2];
const production = process.argv.includes('--production');
const outDir = 'content/golden';
const queuePath = production ? `${outDir}/human-golden-queue-esdb-en-us-v1.json` : `${outDir}/human-golden-queue-v1.json`;
const reviewsPath = production ? 'data/golden/reviews/human-reviews-esdb-en-us-v1.json' : 'data/golden/reviews/human-reviews-v1.json';
const adjudicationsPath = production ? 'data/golden/reviews/human-adjudications-esdb-en-us-v1.json' : 'data/golden/reviews/human-adjudications-v1.json';
const publishedPath = `${outDir}/published-human-golden-v1.json`;
async function dict() {
  if (production) {
    const path = 'content/corpus/dictionary-esdb-en-us-v1.json';
    if (!existsSync(path)) throw new Error('Production dictionary missing; run npm run corpus:build:production first');
    return JSON.parse(readFileSync(path, 'utf8'));
  }
  return buildDictionary(readSourceFile('data/qa-seed/words.json'));
}
async function queue() { const q = buildGoldenQueue(await dict()); writeJson(queuePath, q); return q; }
function loadQueue() { const q = JSON.parse(readFileSync(queuePath, 'utf8')); assertValidQueue(q); return q; }
function loadReviews() { return existsSync(reviewsPath) ? parseReviewsFile(reviewsPath) : []; }
function loadAdj() { return readJsonIfExists(adjudicationsPath, { adjudications: [] }).adjudications ?? readJsonIfExists(adjudicationsPath, []); }

function argValue(name) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; }
if (!cmd) { console.error('Usage: golden <queue|review:export|review:validate [--file PATH]|review:import --file PATH|adjudication:validate [--file PATH]|status|publish|eval>'); process.exit(2); }
if (cmd === 'queue') { const q = await queue(); console.log(JSON.stringify({ path: queuePath, checksum: q.checksum, candidateCount: q.candidateCount, shortfall: q.shortfall })); }
else if (cmd === 'review:export') { const q = existsSync(queuePath) ? loadQueue() : await queue(); const packet = exportBlindPacket(q); const stem = production ? 'blind-review-packet-esdb-en-us-v1' : 'blind-review-packet-v1'; writeJson(`${outDir}/${stem}.json`, packet); writeFileSync(`${outDir}/${stem}.csv`, toCsv(packet.rows)); console.log(JSON.stringify({ json: `${outDir}/${stem}.json`, csv: `${outDir}/${stem}.csv`, candidateCount: q.candidateCount, blind: true })); }
else if (cmd === 'review:validate') { const q = existsSync(queuePath) ? loadQueue() : await queue(); const path = argValue('--file') ?? process.argv[3] ?? reviewsPath; const errors = validateReviews(q, parseReviewsFile(path)); console.log(JSON.stringify({ path, valid: errors.length === 0, errors }, null, 2)); if (errors.length) process.exitCode = 1; }
else if (cmd === 'review:import') { const q = existsSync(queuePath) ? loadQueue() : await queue(); const path = argValue('--file') ?? process.argv[3]; if (!path) throw new Error('review:import requires --file PATH'); const reviews = parseReviewsFile(path); const errors = validateReviews(q, reviews); if (errors.length) { console.error(JSON.stringify({ path, imported: false, errors }, null, 2)); process.exit(1); } mkdirSync('data/golden/reviews', { recursive: true }); writeJson(reviewsPath, { schemaVersion: 'human-golden-reviews-v1', queueVersion: q.source.queueVersion, queueChecksum: q.checksum, reviews }); console.log(JSON.stringify({ path: reviewsPath, imported: true, count: reviews.length })); }
else if (cmd === 'adjudication:validate') { const q = existsSync(queuePath) ? loadQueue() : await queue(); const path = argValue('--file') ?? process.argv[3] ?? adjudicationsPath; const { validateAdjudications } = await import('../src/golden/workflow.ts'); const adj = readJsonIfExists(path, { adjudications: [] }).adjudications ?? readJsonIfExists(path, []); const errors = validateAdjudications(q, loadReviews(), adj); console.log(JSON.stringify({ path, valid: errors.length === 0, errors }, null, 2)); if (errors.length) process.exitCode = 1; }
else if (cmd === 'status') { const q = existsSync(queuePath) ? loadQueue() : await queue(); const status = statusStats(q, loadReviews(), loadAdj()); const stem = production ? 'human-golden-status-esdb-en-us-v1.json' : 'human-golden-status-v1.json'; writeJson(`${outDir}/${stem}`, status); console.log(JSON.stringify(status, null, 2)); }
else if (cmd === 'publish') { const q = existsSync(queuePath) ? loadQueue() : await queue(); const draft = process.argv.includes('--draft'); const artifact = publishGolden(q, loadReviews(), loadAdj(), { draft }); writeJson(publishedPath, artifact); console.log(JSON.stringify({ path: publishedPath, readiness: artifact.manifest.readiness, checksum: artifact.manifest.checksum, itemCount: artifact.manifest.itemCount })); }
else if (cmd === 'eval') { const golden = existsSync(publishedPath) ? JSON.parse(readFileSync(publishedPath, 'utf8')) : publishGolden(existsSync(queuePath) ? loadQueue() : await queue(), loadReviews(), loadAdj(), { draft: true }); const report = evaluateGolden(golden, await dict()); writeJson(`${outDir}/human-golden-eval-v1.json`, report); console.log(JSON.stringify(report, null, 2)); }
else { console.error(`Unknown golden command: ${cmd}`); process.exit(2); }
