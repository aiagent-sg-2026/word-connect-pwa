import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { verifyEsdbIntegrity, type EsdbIntegrityManifest } from './integrity.ts';

const dir = mkdtempSync(join(tmpdir(), 'word-connect-integrity-'));
const dbPath = join(dir, 'scowl.db');
const licensePath = join(dir, 'Copyright');
const rows = [{ word: 'apple', size: 35, pos: 'n0' }];
writeFileSync(dbPath, 'hermetic-db');
writeFileSync(licensePath, 'official notice');
const manifest: EsdbIntegrityManifest = {
  schemaVersion: 'esdb-integrity-manifest-v1',
  source: {
    revision: 'pinned-revision',
    dbSha256: 'da8eb16f11d33472d330a8bcf438ecdca9720ab3456a0d59b44082b35aac2463',
    rowsSha256: '6c20823b324c18e776b8fae84ec57bcdc7457784689918e500eb4410003fe329',
    licenseNoticeSha256: '2c6a622b3d0cf7cbb4bc0fa05ccc30869de90052d57c2dbcadbba23adc9ba880'
  }
};
const valid = () => verifyEsdbIntegrity({ manifest, actualRevision: 'pinned-revision', dbPath, rows, licensePath });

describe('ESDB pinned integrity gate', () => {
  it('accepts the exact pinned revision and all expected artifacts', () => expect(valid()).toBeUndefined());
  it.each([
    ['revision', () => verifyEsdbIntegrity({ manifest, actualRevision: 'other-revision', dbPath, rows, licensePath }), 'revision mismatch'],
    ['DB', () => { writeFileSync(dbPath, 'tampered-db'); return verifyEsdbIntegrity({ manifest, actualRevision: 'pinned-revision', dbPath, rows, licensePath }); }, 'source DB SHA-256 mismatch'],
    ['rows', () => { writeFileSync(dbPath, 'hermetic-db'); return verifyEsdbIntegrity({ manifest, actualRevision: 'pinned-revision', dbPath, rows: [...rows, { word: 'tampered' }], licensePath }); }, 'extracted source rows SHA-256 mismatch'],
    ['license', () => { writeFileSync(dbPath, 'hermetic-db'); return verifyEsdbIntegrity({ manifest, actualRevision: 'pinned-revision', dbPath, rows, licensePath: join(dir, 'missing-license') }); }, 'Copyright/license notice missing or unreadable']
  ])('fails closed on %s mismatch', (_, attempt, message) => expect(attempt).toThrow(message));

  it('fails closed on a changed Copyright/license notice', () => {
    writeFileSync(licensePath, 'tampered notice');
    expect(() => verifyEsdbIntegrity({ manifest, actualRevision: 'pinned-revision', dbPath, rows, licensePath })).toThrow('Copyright/license notice SHA-256 mismatch');
  });
});
