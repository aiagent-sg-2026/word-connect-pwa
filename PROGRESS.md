# Progress / Handoff

## Completed in local M1 implementation

- Built TypeScript + Vite vanilla DOM mobile-first game.
- Added installable PWA metadata, local SVG icons, iOS standalone tags, safe-area-aware CSS.
- Added Service Worker with build-specific shell cache, same-origin bounded runtime cache, user-controlled waiting update prompt, single reload guard, and BOOT_OK old-cache cleanup.
- Added IndexedDB local SSOT stores required by DESIGN/SPEC, schema verification, bootstrap recovery shell, export/import/reset UX.
- Added immutable `campaign-en-v1` with 20 original hand-authored levels, per-level hashes, campaign hash, constructibility/hash validation.
- Added swipe/tap gameplay, circular wheel, visual connection path, answer slots, target/bonus/accept-only/invalid/already-found outcomes, shuffle, hints, coins, transactional progress/economy/stat updates.
- Added unit tests for content validity, duplicate physical tile behavior, outcomes, no duplicate rewards, IDB bootstrap/persistence, migration fixture replay, export/import validation, content mismatch fail-closed.
- Added Playwright smoke script covering responsive viewports, no horizontal overflow, tap gameplay, no page/console errors, and warm offline reload.

## Independent reviewer notes

P0 gaps found and fixed:

1. Tap fallback initially conflicted with pointer swipe and auto-submitted one-letter candidates. Fixed by separating swipe draft state from tap selection.
2. IndexedDB store key paths initially did not match profile/settings records. Fixed profile/settings key paths and tests.
3. Import snapshot occurred inside an active write transaction and could inactivate the transaction. Fixed by creating snapshot before import transaction.

Deferred / environment-only limitations:

- Cold installed-PWA airplane launch and iOS standalone status-bar behavior require physical/device-level validation outside this VM.
- Update prompt path is implemented and helper-tested by smoke at shell level, but multi-client Safari coordination is intentionally minimal for M1.
