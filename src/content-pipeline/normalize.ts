export interface NormalizedToken { ok: boolean; lower?: string; upper?: string; reason?: 'INVALID_TOKEN'; }

export function normalizeEnglishV1(raw: string): NormalizedToken {
  const trimmed = raw.trim().normalize('NFC');
  if (!/^[A-Za-z]+$/.test(trimmed)) return { ok: false, reason: 'INVALID_TOKEN' };
  const lower = trimmed.toLocaleLowerCase('en-US');
  return { ok: true, lower, upper: lower.toLocaleUpperCase('en-US') };
}

export function signatureOf(word: string): string {
  return word.toLocaleUpperCase('en-US').split('').sort().join('');
}

export function countsOf(word: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const ch of word.toLocaleUpperCase('en-US')) counts[ch] = (counts[ch] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

export function canConstructExact(word: string, rack: readonly string[]): boolean {
  const counts = new Map<string, number>();
  for (const l of rack) counts.set(l.toLocaleUpperCase('en-US'), (counts.get(l.toLocaleUpperCase('en-US')) ?? 0) + 1);
  for (const ch of word.toLocaleUpperCase('en-US')) {
    const n = counts.get(ch) ?? 0;
    if (n <= 0) return false;
    counts.set(ch, n - 1);
  }
  return true;
}

export function isSubMultiset(word: string, rackWord: string): boolean {
  return canConstructExact(word, rackWord.toLocaleUpperCase('en-US').split(''));
}
