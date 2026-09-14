import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { readSourceFile } from './content/io.mjs';
import { buildDictionary } from '../src/content-pipeline/dictionary.ts';

const outDir = 'content/lab'; mkdirSync(outDir, { recursive: true });
const artifact = await buildDictionary(readSourceFile('data/qa-seed/words.json'));
const golden = JSON.parse(readFileSync('data/golden/starter-golden-v1.json','utf8'));
const byWord = new Map(artifact.records.map(r => [r.upper, r]));
const mismatches = [];
for (const j of golden.judgments) {
  const rec = byWord.get(j.word.normalize('NFC').toLocaleUpperCase('en-US'));
  if (!rec || rec.class !== j.expectedClass) mismatches.push({ word: j.word, expected: j.expectedClass, actual: rec?.class ?? 'MISSING', reasons: rec?.reasons ?? [] });
}
const report = { scoringVersion: 'score-v1-provisional', goldenVersion: golden.version, goldenStatus: golden.status, count: golden.judgments.length, accuracy: Number(((golden.judgments.length - mismatches.length) / golden.judgments.length).toFixed(4)), mismatches };
writeFileSync(`${outDir}/score-eval-starter-golden-v1.json`, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
if (mismatches.length) process.exitCode = 1;
