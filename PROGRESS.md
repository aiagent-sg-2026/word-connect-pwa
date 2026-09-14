# Progress / Handoff

## Completed in local M1 implementation

- Built TypeScript + Vite vanilla DOM mobile-first game.
- Added installable PWA metadata, local SVG icons, iOS standalone tags, safe-area-aware CSS.
- Added generated Service Worker with stable `/sw.js` registration, baked build id, exact hashed critical asset precache into build-specific shell cache, same-origin bounded runtime cache, user-controlled waiting update prompt, single reload guard, multi-client readiness handshake, and BOOT_OK old-cache cleanup.
- Added IndexedDB local SSOT stores required by DESIGN/SPEC, schema verification, bootstrap recovery shell, export/import/reset UX.
- Added immutable `campaign-en-v1` with 20 original hand-authored levels, per-level hashes, campaign hash, constructibility/hash validation.
- Added swipe/tap gameplay, circular wheel, visual connection path, answer slots, target/bonus/accept-only/invalid/already-found outcomes, shuffle, hints, coins, transactional progress/economy/stat updates.
- Added unit tests for content validity, duplicate physical tile behavior, outcomes, no duplicate rewards, IDB bootstrap/persistence, schema/key-path verification, real legacy profile save migration replay, immutable campaign overwrite fail-closed, SHA-256 save integrity rejection before mutation, content mismatch fail-closed, and deterministic update safe-gate/owner-lock/readiness helpers.
- Added Playwright smoke script covering responsive viewports, no horizontal overflow, tap and pointer-swipe gameplay, no page/console errors, warm offline reload after clearing ordinary HTTP cache, and two-page Service Worker presence.

## Phase 4–6 LAB content-engineering foundation

- Added build-time dictionary contracts for `WordRecord`, exact classes, lexical evidence, frequency signals, policy overrides, provenance and reason codes.
- Added deterministic English V1 normalization: NFC, canonical lower/upper, a-z exact-token policy, no silent apostrophe/hyphen/accent transformations, exact-token safety gates, proper-noun/abbreviation/invalid/source-conflict REVIEW gates, and BLOCKED/REVIEW target rejection.
- Added local JSON/CSV/TSV import adapter support and `data/qa-seed/words.json`, explicitly labeled QA seed data rather than a licensed production corpus.
- Added `score-v1-provisional` with versioned weights/thresholds, short-word strictness, per-word explanations, and starter Golden Set evaluation. The ~2,000 human-reviewed Golden Set remains pending and Phase 5 is not production-complete.
- Added signature index, exact multiset constructibility, deterministic seeded LAB generator, difficulty scoring, duplicate identity detection, campaign/level hashes, and verification commands. Generated LAB artifacts are separate from and do not replace `campaign-en-v1`.
- Closed Phase 4–6 reviewer gaps locally: generator candidate discovery now uses reusable signature/count/bitmask index lookup per rack instead of per-anchor full-record constructibility scans; morphology uses explicit `morphology-v1` build-time metadata with bounded inflection types and deterministic conflict-to-REVIEW handling; `content:verify` independently recomputes every LAB level hash and campaign hash before accepting artifacts.

## Independent reviewer notes

P0 gaps found and fixed:

1. Tap fallback initially conflicted with pointer swipe and auto-submitted one-letter candidates. Fixed by separating swipe draft state from tap selection.
2. IndexedDB store key paths initially did not match profile/settings records. Fixed profile/settings key paths and tests.
3. Import snapshot occurred inside an active write transaction and could inactivate the transaction. Fixed by creating snapshot before import transaction.
4. Second hardening pass strengthened update activation so Update Now sends a skip-waiting request only after a client-side safe gate and single-owner lock; the worker rejects unsafe activation messages and keeps shell/runtime cache lookups build-coherent.
5. Save import now validates envelope version, campaign/hash, profile shape, progress hashes, and duplicate found words before opening the write transaction, then replaces imported stores atomically with a pre-import snapshot.
6. Schema verification now checks numeric DB version plus required stores and key paths; PWA metadata uses an opaque iOS status bar setting.
7. Third repair pass fixed SW build/update atomicity, real multi-client readiness handshakes, version metadata/save migration, immutable content storage, and versioned SHA-256 save integrity verification.

Deferred / environment-only limitations:

- Phase 4/5/6 remain LAB/provisional rather than production-complete: no licensed production corpus, no ~2,000-word human Golden Set, and QA seed corpus currently generates 94 unique LAB levels for the default seed/scale.
- Cold installed-PWA airplane launch and iOS standalone status-bar behavior require physical/device-level validation outside this VM.
- Update prompt path is implemented with deterministic helper tests and Chromium smoke coverage for the built shell. Full Safari multi-client lifecycle behavior (tabs plus installed PWA across process boundaries) remains a device/browser-lifecycle verification item, not faked in this VM.
