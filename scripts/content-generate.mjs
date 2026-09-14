import { mkdirSync, writeFileSync } from 'node:fs';
import { readSourceFile } from './content/io.mjs';
import { buildDictionary } from '../src/content-pipeline/dictionary.ts';
import { generateLabCampaign, validateGenerated } from '../src/content-pipeline/generator.ts';
import { canonical } from '../src/content-pipeline/hash.ts';

const seed = process.env.CONTENT_SEED ?? 'lab-seed-v1';
const maxLevels = Number(process.env.CONTENT_MAX_LEVELS ?? 1000);
const outDir = 'content/lab'; mkdirSync(outDir, { recursive: true });
const dict = await buildDictionary(readSourceFile('data/qa-seed/words.json'));
const { campaign, report } = await generateLabCampaign(dict.records, { seed, maxLevels });
validateGenerated(campaign, dict.records);
writeFileSync(`${outDir}/campaign-en-lab-qa-v1.json`, canonical(campaign) + '\n');
writeFileSync(`${outDir}/generator-report-v1.json`, JSON.stringify({ ...report, seed, note: report.generated < maxLevels ? 'QA seed corpus too small for requested scale; no fake words synthesized.' : 'Requested scale generated.' }, null, 2) + '\n');
console.log(JSON.stringify({ ...report, seed }));
