# Production corpus: ESDB en-US v1

Build command:

```bash
npm run corpus:build:production
npm run golden:queue:production
```

Source: official English Speller Database (ESDB, formerly SCOWLv2) from `https://github.com/en-wl/wordlist.git`, tag/branch `v2`, commit `1e5b7d3a72f47a71da5d28686c1dd4b397178485`, retrieval date `2026-09-15`.

Extraction uses American English spelling (`_`/`A`), regions empty/US, size `<=60`, variant level `<=1`. Main lexical rows exclude abbreviations, proper-name classes, nonword/special/wordpart categories, and unsupported non-ASCII/punctuation tokens. A bounded deterministic review-gate sample is retained for hard-gate coverage. Accents are preserved at source; game V1 rejects unsupported tokens rather than deaccenting.

No wordfreq or bulk frequency export is used. ESDB size is converted only to `commonnessSignals[].heuristic = esdb-size-v1`; `frequencySignals` remain empty and `frequency` remains 0 unless a separately reviewed compatible frequency adapter is added later.

Notices and provenance:

- Notice: `THIRD_PARTY_NOTICES/ESDB-Copyright.txt`
- Machine-readable manifest: `content/corpus/esdb-en-us-v1.provenance.json`
- Derived dictionary: `content/corpus/dictionary-esdb-en-us-v1.json`

The derived corpus and Golden tooling are build-time content artifacts and are not imported by the PWA runtime. `campaign-en-v1` remains unchanged.
