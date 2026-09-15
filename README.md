# Word Connect PWA

An original, family-safe, offline-first swipe-word puzzle PWA. The M1 vertical slice is implemented locally: 20 hand-authored levels, installable PWA shell, IndexedDB save data, coins/hints, swipe and accessible tap play, save export/import, recovery/reset, and automated tests/smoke checks.

## Run locally

```bash
npm install
npm run dev
```

Vite dev uses local HTTPS via `@vitejs/plugin-basic-ssl` for PWA-compatible development.

## Test, build, and content tooling

```bash
npm test
npm run build
npm run dictionary:build
npm run corpus:build:production
npm run golden:queue:production
npm run score:eval
npm run content:generate
npm run content:verify
npm run golden:queue
npm run golden:review:export
npm run golden:review:export:production
npm run golden:review:validate -- --file data/golden/reviews/human-reviews-v1.json
npm run golden:review:combine:production -- --out /tmp/combined-reviews.json reviewer-a.json reviewer-b.json
npm run golden:review:import -- --file path/to/combined-reviews.json
npm run golden:adjudication:validate
npm run golden:status
npm run golden:publish:draft
npm run golden:eval
npm run reviewer:verify
npm run reviewer:smoke
```

Phase 4–6 tooling is build-time only. It emits deterministic LAB/QA artifacts under `content/lab/` and Human Golden workflow artifacts under `content/golden/` from `data/qa-seed/words.json`, an original bounded QA seed lexicon derived from current hand-authored vocabulary plus authored edge-case/common words. It is not a licensed production corpus and does not replace runtime `campaign-en-v1`. Current LAB hardening includes index-driven candidate lookup (signature/count/bitmask subset checks), dictionary artifact schema `dictionary-artifact-v2`, versioned morphology metadata (`morphology-v1`) with bounded original QA seed coverage, fail-closed invalid/mismatched/conflicting morphology to REVIEW behavior, independent LAB level/campaign hash recomputation in `npm run content:verify`, and Human Golden Set V1 queue/review/import/publish/eval gates documented in `docs/human-golden-workflow-v1.md`. Golden queue and published artifacts are recomputed/checksum-verified before use; production READY requires the fixed 2,000-human target and strict two-reviewer/adjudication invariants. QA seed queue count remains 187 with shortfall 1,813. Production corpus import now builds from pinned official ESDB (`en-wl/wordlist` v2 commit `1e5b7d3a72f47a71da5d28686c1dd4b397178485`) into `content/corpus/dictionary-esdb-en-us-v1.json`; provenance is in `content/corpus/esdb-en-us-v1.provenance.json` and notices are in `THIRD_PARTY_NOTICES/`. The ESDB-derived production Human Golden queue command is `npm run golden:queue:production`; current candidateCount is 2,000, shortfall 0, human reviewed/resolved count 0, readiness DRAFT (not READY). ESDB size/commonness is a provisional commonness heuristic only, never corpus frequency.

Browser smoke after building:

```bash
npm run preview -- --host 127.0.0.1 --port 4175
SMOKE_URL=http://127.0.0.1:4175 npm run smoke
```

The smoke check verifies the built app in Chromium at 390x844, 834x1112, 1280x900, 1440x900, and 320px narrow; checks for no horizontal overflow/page errors; plays targets through tap and pointer-swipe input; then proves a warm offline reload after clearing ordinary HTTP cache. Unit tests also cover content integrity, legacy save migration replay, immutable campaign conflict fail-closed behavior, no duplicate rewards, SHA-256 save integrity rejection before mutation, and deterministic update safe-gate/readiness helpers.

## Install/offline behavior

1. Run `npm run build` and serve with `npm run preview` or any HTTPS/static host.
2. Open the app once online so the generated Service Worker precaches the exact built HTML/manifest/icons/hashed JS/CSS shell assets.
3. Install from the browser PWA prompt/menu.
4. Reopen or reload offline; the app shell, content, and IndexedDB save continue to work locally.

Device-only validation still required for cold installed-PWA airplane launch and iOS standalone status-bar rendering.

## Phase 5 reviewer PWA

The separate Human Golden Reviewer is built with `npm run reviewer:build` into `reviewer-dist/` and is served at `/word-connect-pwa/reviewer/`. `npm run reviewer:prepare` regenerates the deterministic production blind packet from the existing Golden workflow. The reviewer stores its stable reviewer ID, queue-scoped current judgments, and local change history in a separate IndexedDB database. It never fills a label automatically; export is an explicit action and emits a `human-golden-review-v1` envelope accepted by the existing Golden validator. Reviews stay on the device until export. Independent reviewer exports are combined with the fail-closed `golden:review:combine:production` command before any explicit canonical import. The reviewer build is offline-capable through its dedicated manifest and service worker.

Phase 5 is not complete: the production queue remains DRAFT until two independent human reviews for all 2,000 words and any required adjudication are collected and imported through the existing fail-closed workflow.

## Documentation

- [DESIGN.md](DESIGN.md) — architecture and decisions
- [SPEC.md](SPEC.md) — normative requirements and acceptance criteria
- [ROADMAP.md](ROADMAP.md) — phased implementation plan
- [PROGRESS.md](PROGRESS.md) — implementation/review/QA handoff
