import { mkdirSync, writeFileSync } from 'node:fs';
import { readSourceFile } from './content/io.mjs';
import { buildDictionary } from '../src/content-pipeline/dictionary.ts';
import { canonical } from '../src/content-pipeline/hash.ts';

const source = process.argv[2] ?? 'data/qa-seed/words.json';
const outDir = process.argv[3] ?? 'content/lab';
mkdirSync(outDir, { recursive: true });
const artifact = await buildDictionary(readSourceFile(source));
writeFileSync(`${outDir}/dictionary-qa-seed-v1.json`, canonical(artifact) + '\n');
const lines = [`Dictionary ${artifact.version}`, `Records: ${artifact.manifest.recordCount}`, `Checksum: ${artifact.manifest.checksum}`, `Source note: ${artifact.sourceNote}`, '', 'Class counts:'];
for (const cls of ['TARGET','BONUS','ACCEPT_ONLY','BLOCKED','REVIEW']) lines.push(`${cls}: ${artifact.records.filter(r => r.class === cls).length}`);
lines.push('', 'Records:');
for (const r of artifact.records) lines.push(`${r.upper}\t${r.class}\ttarget=${r.targetScore?.score}\tbonus=${r.bonusScore?.score}\t${r.reasons.join(',')}`);
writeFileSync(`${outDir}/dictionary-report-qa-seed-v1.txt`, lines.join('\n') + '\n');
console.log(JSON.stringify(artifact.manifest));
