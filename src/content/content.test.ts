import { describe, expect, it } from 'vitest';
import { CAMPAIGN } from './campaign';
import { canConstruct, validateCampaign } from './validate';

describe('campaign content', () => {
  it('has 20 deterministic solvable levels with valid hashes', async () => {
    expect(CAMPAIGN.levels).toHaveLength(20);
    await expect(validateCampaign()).resolves.toBeUndefined();
    for (const level of CAMPAIGN.levels) for (const target of level.targets) expect(canConstruct(target, level.letters)).toBe(true);
  });
  it('fails closed on content hash mismatch', async () => {
    const bad = structuredClone(CAMPAIGN); bad.levels[0].targets[0] = 'BAD';
    await expect(validateCampaign(bad)).rejects.toThrow(/hash mismatch|unconstructible/);
  });
});
