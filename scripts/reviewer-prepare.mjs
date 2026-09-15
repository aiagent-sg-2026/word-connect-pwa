import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
execFileSync(process.execPath, ['scripts/golden.mjs', 'review:export', '--production'], { stdio: 'inherit' });
const packet = JSON.parse(readFileSync('content/golden/blind-review-packet-esdb-en-us-v1.json', 'utf8'));
const forbidden = /predictedClass|targetScore|bonusScore|reasons|strata|flags|frequency|commonness/i;
const keys = Object.keys(packet.rows[0] ?? {});
if (keys.some(k => forbidden.test(k)) || JSON.stringify(packet).match(forbidden)) throw new Error('Production blind packet contains forbidden reviewer data');
if (packet.rows.length !== 2000 || new Set(packet.rows.map(r => r.word)).size !== 2000) throw new Error('Production packet is not 2,000 unique rows');
console.log(JSON.stringify({ prepared: true, path: 'content/golden/blind-review-packet-esdb-en-us-v1.json', candidateCount: packet.rows.length, blind: true }));
