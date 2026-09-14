import { readFileSync } from 'node:fs';

export function readSourceFile(path) {
  const text = readFileSync(path, 'utf8');
  if (path.endsWith('.json')) return JSON.parse(text);
  const rows = text.trim().split(/\r?\n/).filter(Boolean);
  const sep = path.endsWith('.tsv') ? '\t' : ',';
  const header = rows.shift().split(sep);
  return rows.map(row => Object.fromEntries(row.split(sep).map((v, i) => [header[i], v]))).map(r => ({
    word: r.word,
    lexical: [{ sourceId: r.lexicalSourceId ?? 'local-tabular-lexicon', token: r.word, confidence: Number(r.confidence ?? 0.75), pos: r.pos ? r.pos.split('|') : [], dialects: r.dialects ? r.dialects.split('|') : ['en'] }],
    frequency: [{ sourceId: r.frequencySourceId ?? 'local-tabular-frequency', value: Number(r.frequency ?? 0.5), scale: '0..1' }],
    policy: r.class ? [{ sourceId: r.policySourceId ?? 'local-tabular-policy', class: r.class, reasons: ['POLICY_OVERRIDE'] }] : []
  }));
}
