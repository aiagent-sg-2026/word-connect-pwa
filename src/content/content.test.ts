import { describe, expect, it } from 'vitest';
import { CAMPAIGN, LEGACY_CAMPAIGNS } from './campaign';
import { canConstruct, computeLevelHash, sha256, canonical, validateCampaign } from './validate';

async function rehashCampaign(campaign: typeof CAMPAIGN) {
  for (const level of campaign.levels) level.hash = await computeLevelHash(level);
  campaign.campaignHash = await sha256(canonical({ campaignVersion: campaign.campaignVersion, contentVersion: campaign.contentVersion, levels: campaign.levels.map(l => l.hash) }));
  return campaign;
}

describe('campaign content', () => {
  it('has active v2 deterministic solvable levels with valid hashes', async () => {
    expect(CAMPAIGN.campaignVersion).toBe('campaign-en-v2');
    expect(CAMPAIGN.levels).toHaveLength(20);
    await expect(validateCampaign()).resolves.toBeUndefined();
    for (const level of CAMPAIGN.levels) for (const word of [...level.targets, ...level.bonus, ...level.acceptOnly]) expect(canConstruct(word, level.letters)).toBe(true);
  });
  it('preserves production v1 immutable hashes while active v2 removes impossible TACT and keeps TSAR', () => {
    const v1 = LEGACY_CAMPAIGNS[0];
    expect(v1.campaignVersion).toBe('campaign-en-v1');
    expect(v1.campaignHash).toBe('dfa971d19011030b82636b7e3b67e678503707c7a17911bc15410c1d9d6e9c87');
    expect(v1.levels[0].hash).toBe('f217c120cd572896a195eaabf21c4f1f4c27be35c8c6d9e74850bc0cc7ea47ce');
    expect(v1.levels[0].acceptOnly).toEqual(['TACT']);
    expect(CAMPAIGN.levels[0].acceptOnly).toEqual([]);
    expect(CAMPAIGN.levels[3].acceptOnly).toEqual(['TSAR']);
  });
  it('fails closed on content hash mismatch', async () => {
    const bad = structuredClone(CAMPAIGN); bad.levels[0].targets[0] = 'BAD';
    await expect(validateCampaign(bad)).rejects.toThrow(/hash mismatch|unconstructible/);
  });
  it('fails closed on unconstructible accept-only repeated-letter mismatch', async () => {
    const bad = await rehashCampaign(structuredClone(CAMPAIGN));
    bad.levels[0].acceptOnly = ['TACT'];
    await rehashCampaign(bad);
    await expect(validateCampaign(bad)).rejects.toThrow(/unconstructible word L001:TACT/);
  });
});
