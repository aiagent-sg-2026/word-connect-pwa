import { readFileSync } from 'node:fs';
import { readSourceFile } from './content/io.mjs';
import { buildDictionary } from '../src/content-pipeline/dictionary.ts';
import { validateGenerated } from '../src/content-pipeline/generator.ts';
import { canonical, sha256 } from '../src/content-pipeline/hash.ts';
import { CAMPAIGN } from '../src/content/campaign.ts';

const dict = await buildDictionary(readSourceFile('data/qa-seed/words.json'));
const lab = JSON.parse(readFileSync('content/lab/campaign-en-lab-qa-v1.json','utf8'));
validateGenerated(lab, dict.records);
const currentHash = await sha256(canonical({ campaignVersion: CAMPAIGN.campaignVersion, contentVersion: CAMPAIGN.contentVersion, levels: CAMPAIGN.levels.map(l => l.hash) }));
if (currentHash !== CAMPAIGN.campaignHash) throw new Error('campaign-en-v1 hash changed');
console.log(JSON.stringify({ ok: true, dictionaryChecksum: dict.manifest.checksum, labCampaignHash: lab.campaignHash, campaignEnV1Hash: currentHash }));
