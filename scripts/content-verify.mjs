import { readFileSync } from 'node:fs';
import { readSourceFile } from './content/io.mjs';
import { buildDictionary } from '../src/content-pipeline/dictionary.ts';
import { computeGeneratedLevelHash, validateGenerated } from '../src/content-pipeline/generator.ts';
import { canonical, sha256 } from '../src/content-pipeline/hash.ts';
import { CAMPAIGN, LEGACY_CAMPAIGNS } from '../src/content/campaign.ts';

const dict = await buildDictionary(readSourceFile('data/qa-seed/words.json'));
const lab = JSON.parse(readFileSync('content/lab/campaign-en-lab-qa-v1.json','utf8'));
validateGenerated(lab, dict.records);
for (const level of lab.levels) {
  const recomputed = await computeGeneratedLevelHash(level);
  if (recomputed !== level.hash) throw new Error(`LAB level hash mismatch ${level.levelId}`);
}
const labCampaignHash = await sha256(canonical({ campaignVersion: lab.campaignVersion, contentVersion: lab.contentVersion, levels: lab.levels.map(l => l.hash) }));
if (labCampaignHash !== lab.campaignHash) throw new Error('LAB campaign hash mismatch');
const currentLevelHashes = [];
for (const level of CAMPAIGN.levels) {
  const copy = { ...level };
  delete copy.hash;
  const recomputed = await sha256(canonical(copy));
  if (recomputed !== level.hash) throw new Error(`${CAMPAIGN.campaignVersion} level hash mismatch ${level.levelId}`);
  currentLevelHashes.push(level.hash);
}
const currentHash = await sha256(canonical({ campaignVersion: CAMPAIGN.campaignVersion, contentVersion: CAMPAIGN.contentVersion, levels: currentLevelHashes }));
if (currentHash !== CAMPAIGN.campaignHash) throw new Error(`${CAMPAIGN.campaignVersion} hash changed`);
if (LEGACY_CAMPAIGNS[0]?.campaignVersion !== 'campaign-en-v1' || LEGACY_CAMPAIGNS[0]?.campaignHash !== 'dfa971d19011030b82636b7e3b67e678503707c7a17911bc15410c1d9d6e9c87') throw new Error('campaign-en-v1 immutable hash changed');
console.log(JSON.stringify({ ok: true, dictionaryChecksum: dict.manifest.checksum, labCampaignHash, activeCampaignVersion: CAMPAIGN.campaignVersion, activeCampaignHash: currentHash, campaignEnV1Hash: LEGACY_CAMPAIGNS[0].campaignHash }));
