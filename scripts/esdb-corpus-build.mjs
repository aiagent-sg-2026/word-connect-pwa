import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { buildDictionary } from '../src/content-pipeline/dictionary.ts';
import { rowsToSourceInputs } from '../src/content-pipeline/esdb-import.ts';
import { canonical, sha256 } from '../src/content-pipeline/hash.ts';

const repo = 'https://github.com/en-wl/wordlist.git';
const rev = '1e5b7d3a72f47a71da5d28686c1dd4b397178485';
const tag = 'v2';
const cache = process.env.ESDB_CACHE_DIR ?? '.cache/esdb';
const outDir = process.argv[2] ?? 'content/corpus';
const date = '2026-09-15';
const sourceNote = 'Production corpus derived from official English Speller Database (ESDB/SCOWLv2) en-wl/wordlist v2, American English size<=60 variant<=1. ESDB size/commonness is used only as a provisional commonness heuristic, not corpus frequency.';

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: opts.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit', encoding: 'utf8', ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed\n${r.stderr ?? ''}`);
  return r.stdout ?? '';
}
function hashFile(path) { return createHash('sha256').update(readFileSync(path)).digest('hex'); }
function hashInt(s) { return parseInt(createHash('sha256').update(s).digest('hex').slice(0, 12), 16); }
function selectCorpusInputs(inputs, target) {
  const compatible = inputs.filter(i => /^[a-z]+$/.test(i.word));
  const review = inputs.filter(i => i.policy?.length).sort((a, b) => a.word.localeCompare(b.word)).slice(0, 300);
  const must = compatible.filter(i => i.word.length === 3);
  const chosen = new Map([...review, ...must].map(i => [i.word, i]));
  for (const i of compatible.sort((a, b) => hashInt(`esdb-corpus-v1:${a.word}`) - hashInt(`esdb-corpus-v1:${b.word}`) || a.word.localeCompare(b.word))) {
    if (chosen.size >= target) break;
    chosen.set(i.word, i);
  }
  return [...chosen.values()].sort((a, b) => a.word.localeCompare(b.word));
}

mkdirSync('.cache', { recursive: true });
if (!existsSync(`${cache}/.git`)) run('git', ['clone', repo, cache]);
run('git', ['-C', cache, 'fetch', '--tags', 'origin', rev]);
run('git', ['-C', cache, 'checkout', '--detach', rev]);
const actual = run('git', ['-C', cache, 'rev-parse', 'HEAD'], { capture: true }).trim();
if (actual !== rev) throw new Error(`ESDB revision mismatch: ${actual}`);
run('make', ['scowl.db'], { cwd: cache });
const dbPath = `${cache}/scowl.db`;
const dbSha = hashFile(dbPath);

const selectCols = `word,size,spelling,region,variant_level,pos,base_pos,pos_class,pos_category,(select word from words l where l.word_id=s.lemma_id) as lemma`;
const sqlMain = `select ${selectCols} from scowl_ s where size <= 60 and variant_level <= 1 and spelling in ('_','A') and region in ('','US') and word not glob '*[^ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz]*' and coalesce(pos_class,'') not in ('abbr','abbr?','name','name?','person','place','surname','trademark') and coalesce(pos_category,'') not in ('nonword','special','wordpart')`;
const sqlReview = `select ${selectCols} from scowl_ s where size <= 60 and variant_level <= 1 and spelling in ('_','A') and region in ('','US') and (coalesce(pos_class,'') in ('abbr','abbr?','name','name?','person','place','surname','trademark') or coalesce(pos_category,'') in ('nonword','special','wordpart') or word glob '*[^ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz]*') order by lower(word), size, pos limit 200`;
const rowsPath = `${outDir}/.esdb-rows.tmp.json`;
mkdirSync(outDir, { recursive: true });
run('bash', ['-lc', `sqlite3 -json ${JSON.stringify(dbPath)} ${JSON.stringify(`select * from (${sqlMain}) union all select * from (${sqlReview}) order by word, size, pos;`)} > ${JSON.stringify(rowsPath)}`]);
const rows = JSON.parse(readFileSync(rowsPath, 'utf8'));
const sourceRowsSha = createHash('sha256').update(JSON.stringify(rows)).digest('hex');
const { inputs, report } = rowsToSourceInputs(rows);
const selectedInputs = selectCorpusInputs(inputs, 12000);
const dict = await buildDictionary(selectedInputs, 'dict-esdb-en-us-v1', sourceNote);
mkdirSync(outDir, { recursive: true });
mkdirSync('THIRD_PARTY_NOTICES', { recursive: true });
copyFileSync(`${cache}/Copyright`, 'THIRD_PARTY_NOTICES/ESDB-Copyright.txt');
const artifactPath = `${outDir}/dictionary-esdb-en-us-v1.json`;
writeFileSync(artifactPath, canonical(dict) + '\n');
const artifactSha = hashFile(artifactPath);
const classCounts = Object.fromEntries(['TARGET','BONUS','ACCEPT_ONLY','REVIEW','BLOCKED'].map(c => [c, dict.records.filter(r => r.class === c).length]));
const provenance = { schemaVersion: 'lexical-corpus-provenance-v1', source: { name: 'English Speller Database (ESDB, formerly SCOWLv2)', url: repo, tag, revision: rev, retrievalDate: date, licenseNoticeFile: 'THIRD_PARTY_NOTICES/ESDB-Copyright.txt', sourceDbChecksumSha256: dbSha, sourceRowsChecksumSha256: sourceRowsSha }, extraction: { command: 'npm run corpus:build:production', cacheDir: cache, config: { sizeMax: 60, spellings: ['_','A'], regions: ['','US'], variantLevelMax: 1, selectedInputCap: 12000, selection: 'deterministic hash selection retaining 3-letter and review-gate examples', excludedMainPosClasses: ['abbr','abbr?','name','name?','person','place','surname','trademark'], excludedMainPosCategories: ['nonword','special','wordpart'], accents: 'preserve-at-source; unsupported game tokens rejected/review-gated, never deaccented', frequency: 'none; ESDB size bucket converted only to commonness heuristic esdb-size-v1' } }, derived: { artifactPath, artifactChecksumSha256: artifactSha, dictionaryChecksum: dict.manifest.checksum, recordCount: dict.manifest.recordCount, selectedInputCount: selectedInputs.length, classCounts, report } };
writeFileSync(`${outDir}/esdb-en-us-v1.provenance.json`, JSON.stringify(provenance, null, 2) + '\n');
writeFileSync(`${outDir}/dictionary-esdb-en-us-v1.report.json`, JSON.stringify({ ...report, classCounts, artifactSha, dictionaryChecksum: dict.manifest.checksum }, null, 2) + '\n');
console.log(JSON.stringify({ artifactPath, artifactSha, dictionaryChecksum: dict.manifest.checksum, recordCount: dict.manifest.recordCount, classCounts }, null, 2));
