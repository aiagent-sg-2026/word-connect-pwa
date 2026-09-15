import type { HumanReview, GoldenClass } from '../golden/contracts.ts';

export const REVIEW_CLASSES: readonly GoldenClass[] = ['TARGET', 'BONUS', 'ACCEPT_ONLY', 'BLOCKED', 'REVIEW'];
export type BlindRow = { queueVersion: string; queueChecksum: string; word: string; candidateId: string; length: number; reviewerId: ''; reviewedAt: ''; source: 'human-review-v1'; class: ''; confidence: ''; note: '' };
export type BlindPacket = { schemaVersion: 'blind-human-review-packet-v1'; queueVersion: string; queueChecksum: string; candidateCount: number; instructions: string; rows: BlindRow[] };
export type ReviewerEnvelope = { schemaVersion: 'human-golden-reviews-v1'; queueVersion: string; queueChecksum: string; source: 'human-review-v1'; reviewerId: string; reviews: HumanReview[] };

const upper = (word: string) => word.normalize('NFC').toLocaleUpperCase('en-US');

export function assertBlindPacket(value: unknown): BlindPacket {
  if (!value || typeof value !== 'object') throw new Error('Packet is not an object');
  const p = value as Partial<BlindPacket> & Record<string, unknown>;
  const topAllowed = new Set(['schemaVersion', 'queueVersion', 'queueChecksum', 'candidateCount', 'instructions', 'rows']);
  if (Object.keys(p).some(k => !topAllowed.has(k))) throw new Error('Packet contains unsupported top-level data');
  if (p.schemaVersion !== 'blind-human-review-packet-v1' || typeof p.queueVersion !== 'string' || typeof p.queueChecksum !== 'string' || typeof p.instructions !== 'string' || !Array.isArray(p.rows)) throw new Error('Packet identity is invalid');
  const allowed = new Set(['queueVersion','queueChecksum','word','candidateId','length','reviewerId','reviewedAt','source','class','confidence','note']);
  const words = new Set<string>(); const ids = new Set<string>();
  for (const [i, row] of p.rows.entries()) {
    if (!row || typeof row !== 'object' || Object.keys(row).some(k => !allowed.has(k))) throw new Error(`Packet row ${i} contains unsupported data`);
    const r = row as BlindRow;
    if (r.queueVersion !== p.queueVersion || r.queueChecksum !== p.queueChecksum || typeof r.word !== 'string' || r.word !== upper(r.word) || typeof r.candidateId !== 'string' || !r.candidateId || !Number.isInteger(r.length) || r.length !== [...r.word].length || r.source !== 'human-review-v1') throw new Error(`Packet row ${i} is invalid`);
    if (r.reviewerId !== '' || r.reviewedAt !== '' || r.class !== '' || r.confidence !== '' || r.note !== '') throw new Error(`Packet row ${i} is not blind`);
    if (words.has(r.word) || ids.has(r.candidateId)) throw new Error(`Packet row ${i} is duplicated`);
    words.add(r.word); ids.add(r.candidateId);
  }
  if (p.candidateCount !== p.rows.length) throw new Error('Packet count mismatch');
  return value as BlindPacket;
}

export function reviewKey(queueChecksum: string, reviewerId: string, word: string): string { return `${queueChecksum}\u0000${reviewerId}\u0000${upper(word)}`; }

export function validateEnvelope(value: unknown, packet: BlindPacket, reviewerId: string): HumanReview[] {
  if (!value || typeof value !== 'object') throw new Error('Review file is not an object');
  const e = value as Partial<ReviewerEnvelope>;
  if (e.schemaVersion !== 'human-golden-reviews-v1' || e.queueVersion !== packet.queueVersion || e.queueChecksum !== packet.queueChecksum || e.source !== 'human-review-v1' || e.reviewerId !== reviewerId || !Array.isArray(e.reviews)) throw new Error('Review file identity does not match this packet and reviewer');
  const words = new Map(packet.rows.map(r => [r.word, r]));
  const seen = new Set<string>();
  for (const [i, review] of e.reviews.entries()) {
    if (!review || typeof review !== 'object') throw new Error(`Review ${i} is invalid`);
    const r = review as HumanReview;
    if (r.schemaVersion !== 'human-golden-review-v1' || r.queueVersion !== packet.queueVersion || r.queueChecksum !== packet.queueChecksum || r.source !== 'human-review-v1' || r.reviewerId !== reviewerId) throw new Error(`Review ${i} identity is invalid`);
    const row = words.get(upper(r.word));
    if (!row) throw new Error(`Review ${i} names an unknown word`);
    if (r.word !== row.word || r.reviewerId.trim().length < 3 || !REVIEW_CLASSES.includes(r.class) || !Number.isFinite(r.confidence) || r.confidence < 0 || r.confidence > 1 || !r.reviewedAt || Number.isNaN(Date.parse(r.reviewedAt))) throw new Error(`Review ${i} has invalid label data`);
    if (r.note !== undefined && typeof r.note !== 'string') throw new Error(`Review ${i} note is invalid`);
    const key = reviewKey(packet.queueChecksum, reviewerId, row.word); if (seen.has(key)) throw new Error(`Review ${i} duplicates a word`); seen.add(key);
  }
  return e.reviews;
}

export function exportEnvelope(packet: BlindPacket, reviewerId: string, reviews: HumanReview[]): ReviewerEnvelope {
  if (reviewerId.trim().length < 3) throw new Error('Reviewer ID must be at least 3 characters');
  const validated = reviews.map(r => ({ ...r }));
  const envelope: ReviewerEnvelope = { schemaVersion: 'human-golden-reviews-v1', queueVersion: packet.queueVersion, queueChecksum: packet.queueChecksum, source: 'human-review-v1', reviewerId, reviews: validated.sort((a,b) => a.word.localeCompare(b.word)) };
  validateEnvelope(envelope, packet, reviewerId);
  return envelope;
}
