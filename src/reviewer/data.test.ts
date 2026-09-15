import { describe, expect, it } from 'vitest';
import { assertBlindPacket, exportEnvelope, validateEnvelope } from './data';

const packet = { schemaVersion:'blind-human-review-packet-v1', queueVersion:'human-golden-queue-v1', queueChecksum:'checksum', candidateCount:1, instructions:'blind', rows:[{queueVersion:'human-golden-queue-v1',queueChecksum:'checksum',word:'SYNTH',candidateId:'fixture',length:5,reviewerId:'',reviewedAt:'',source:'human-review-v1',class:'',confidence:'',note:''}] } as const;
describe('reviewer boundary contracts', () => {
  it('accepts only the blind packet shape', () => { expect(assertBlindPacket(packet).rows).toHaveLength(1); expect(() => assertBlindPacket({...packet, rows:[{...packet.rows[0], targetScore: 1}]})).toThrow(/unsupported/); expect(() => assertBlindPacket({...packet, predictedClass:'TARGET'})).toThrow(/unsupported/); });
  it('exports one canonical current row and validates own imports fail closed', () => {
    const p=assertBlindPacket(packet); const row={schemaVersion:'human-golden-review-v1' as const,queueVersion:p.queueVersion,queueChecksum:p.queueChecksum,word:'SYNTH',reviewerId:'fixture-reviewer',reviewedAt:'2026-01-01T00:00:00.000Z',source:'human-review-v1' as const,class:'TARGET' as const,confidence:.8,note:'synthetic'};
    const envelope=exportEnvelope(p,'fixture-reviewer',[row]); expect(envelope.schemaVersion).toBe('human-golden-reviews-v1'); expect(envelope.reviews).toHaveLength(1); expect(validateEnvelope(envelope,p,'fixture-reviewer')).toEqual([row]);
    expect(() => validateEnvelope(envelope,{...p,queueChecksum:'other'},'fixture-reviewer')).toThrow(/identity/); expect(() => validateEnvelope({...envelope,reviewerId:'other'},p,'fixture-reviewer')).toThrow(/identity/); expect(() => validateEnvelope({...envelope,reviews:[row,row]},p,'fixture-reviewer')).toThrow(/duplicates/);
  });
});
