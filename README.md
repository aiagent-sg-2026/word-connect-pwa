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
npm run score:eval
npm run content:generate
npm run content:verify
npm run golden:queue
npm run golden:review:export
npm run golden:review:validate
npm run golden:status
npm run golden:publish:draft
npm run golden:eval
```

Phase 4–6 tooling is build-time only. It emits deterministic LAB/QA artifacts under `content/lab/` and Human Golden workflow artifacts under `content/golden/` from `data/qa-seed/words.json`, an original bounded QA seed lexicon derived from current hand-authored vocabulary plus authored edge-case/common words. It is not a licensed production corpus and does not replace runtime `campaign-en-v1`. Current LAB hardening includes index-driven candidate lookup (signature/count/bitmask subset checks), dictionary artifact schema `dictionary-artifact-v2`, versioned morphology metadata (`morphology-v1`) with bounded original QA seed coverage, fail-closed invalid/mismatched/conflicting morphology to REVIEW behavior, independent LAB level/campaign hash recomputation in `npm run content:verify`, and Human Golden Set V1 queue/review/publish/eval gates documented in `docs/human-golden-workflow-v1.md`. Current queue count is 187, shortfall is 1,813, and human reviewed/resolved count is 0; Phase 5 human data is DRAFT/PARTIAL, not READY.

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

## Documentation

- [DESIGN.md](DESIGN.md) — architecture and decisions
- [SPEC.md](SPEC.md) — normative requirements and acceptance criteria
- [ROADMAP.md](ROADMAP.md) — phased implementation plan
- [PROGRESS.md](PROGRESS.md) — implementation/review/QA handoff
