import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export interface EsdbIntegrityManifest {
  schemaVersion: 'esdb-integrity-manifest-v1';
  source: { revision: string; dbSha256: string; rowsSha256: string; licenseNoticeSha256: string };
}

export function sha256Bytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function sha256File(path: string): string {
  return sha256Bytes(readFileSync(path));
}

export function sha256Rows(rows: unknown[]): string {
  return sha256Bytes(Buffer.from(JSON.stringify(rows)));
}

export function verifyEsdbIntegrity(opts: {
  manifest: EsdbIntegrityManifest;
  actualRevision: string;
  dbPath: string;
  rows?: unknown[];
  licensePath: string;
}): void {
  const expected = opts.manifest.source;
  if (opts.actualRevision !== expected.revision) {
    throw new Error(`ESDB revision mismatch: expected ${expected.revision}, got ${opts.actualRevision}`);
  }
  let dbSha: string;
  try { dbSha = sha256File(opts.dbPath); } catch { throw new Error(`ESDB source DB missing or unreadable: ${opts.dbPath}`); }
  if (dbSha !== expected.dbSha256) {
    throw new Error(`ESDB source DB SHA-256 mismatch: expected ${expected.dbSha256}, got ${dbSha}`);
  }
  if (opts.rows) {
    const rowsSha = sha256Rows(opts.rows);
    if (rowsSha !== expected.rowsSha256) {
      throw new Error(`ESDB extracted source rows SHA-256 mismatch: expected ${expected.rowsSha256}, got ${rowsSha}`);
    }
  }
  try {
    const licenseSha = sha256File(opts.licensePath);
    if (licenseSha !== expected.licenseNoticeSha256) {
      throw new Error(`ESDB Copyright/license notice SHA-256 mismatch: expected ${expected.licenseNoticeSha256}, got ${licenseSha}`);
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('Copyright/license notice SHA-256 mismatch')) throw error;
    throw new Error(`ESDB Copyright/license notice missing or unreadable: ${opts.licensePath}`);
  }
}
