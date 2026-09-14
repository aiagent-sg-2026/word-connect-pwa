# Word Connect PWA — Normative Specification

The terms MUST and MUST NOT are mandatory. SHOULD and SHOULD NOT are strong defaults that require a documented reason to deviate. Acceptance criteria are testable outcomes.

## GAME

1. The game MUST be original and use no copied branding, assets, or level data.
2. Input MUST support swipe over physical tile indexes and an accessible non-drag tap/select path. Duplicate physical tiles MUST remain distinct, and one physical tile MUST NOT be reused in one swipe.
3. Each submission MUST resolve to exactly one outcome: target, bonus, accept-only, or invalid; then update progress and completion state deterministically.

## DICT

1. The dictionary MUST be a build-time pipeline with separate lexical evidence, frequency, and policy; it MUST NOT depend on raw `words.txt` at runtime.
2. Classes MUST be exactly TARGET, BONUS, ACCEPT_ONLY, BLOCKED, or REVIEW. Valid lexical evidence MUST NOT alone make a suitable target.
3. Records MUST contain the fields and safety flags defined in DESIGN.md. Normalization MUST preserve meaning and require explicit policy for apostrophe, hyphen, and accent changes. Safety MUST use exact-token policy, not substring filtering.

## SCORE

1. The implementation SHOULD begin with the proposed TargetScore and BonusScore V1 formulas in DESIGN.md, including stricter short-word thresholds.
2. Scores MUST be calibrated with a human Golden Set and later telemetry; formulas and versions MUST be recorded in content metadata.

## GEN

1. Generation MUST use signature indexing/multiset counts and MUST NOT scan a 300k-word dictionary per swipe.
2. Output MUST be deterministic for same inputs/seed, solvable, duplicate-free, difficulty-banded, exact-multiset constructible, and free of BLOCKED/REVIEW targets.

## CONTENT

1. Every level MUST satisfy the full level contract in DESIGN.md and include a verifiable hash.
2. Campaign content MUST be immutable. New inputs MUST create a new campaign version; progress MUST pin campaignVersion, levelId, levelRevision, and levelHash and fail closed on mismatch.
3. Content activation MUST be atomic: incomplete or invalid packs MUST NOT become active.

## IDB

1. `word-connect-db` MUST provide all required stores, recommended keys, and version metadata in DESIGN.md.
2. Completion progress, balance, economy event, and stats MUST commit as one logical transaction.
3. The client MUST NOT require a backend for MVP.

## MIG

1. Structural migration MUST use `onupgradeneeded`, prefer additive changes, and be checked by a schema signature of stores/indexes plus numeric version.
2. Save migrations MUST be sequentially adjacent, idempotent, replay-safe, and mark success only after completion.
3. Failure MUST preserve prior valid state; the app MUST never blind-reset or auto-wipe IndexedDB.

## PWA

1. Offline-ready MUST require shellReady, campaignReady, and databaseVerified.
2. The app MUST be installable and playable after fresh install, warm reload, and cold installed-PWA launch in airplane mode.

## SW

1. Build-specific shell caches MUST use `wordgame-shell-{BUILD_ID}`; runtime cache MUST be bounded and same-origin only.
2. Critical assets MUST remain on the old worker if a new shell fails, and critical resources MUST NOT mix build versions.
3. Releases MUST NOT blindly call skipWaiting. Activation MUST be user-controlled through a persistent Later/Update Now prompt and safe gate. Cleanup MUST happen only after BOOT_OK and one reload.

## CLIENT

1. All tabs and installed-PWA clients SHOULD coordinate through BroadcastChannel where available and a single update owner/lock. Unknown or unready clients MUST keep updates pending.
2. Update safe gate MUST require ended swipe, saved progress, no active material transaction, staged compatibility, and multi-client readiness.

## REC

1. A tiny stable recovery shell MUST survive bootstrap/migration failures and show Retry, Export Save, and explicitly confirmed Reset with a bounded error code.
2. Recovery MUST preserve data and MUST NOT perform a blind reset.

## SAVE

1. Export/import MUST use the versioned `word-connect-save-v1.json` envelope.
2. Import MUST validate schema, campaign, integrity, and sanitization before an atomic write.

## UI

1. Primary targets MUST be ≥44px; relevant text inputs MUST be ≥16px; UI MUST honor safe areas, reduced motion, opaque theme-aware status surfaces, and no horizontal overflow.
2. Layout MUST be verified at 390×844, 834×1112, 1280×900, 1440×900, and 320px narrow widths. Non-drag input MUST be accessible.

## PERF

1. Runtime word lookup MUST use a prebuilt signature index/HashSet and bounded data, not a full dictionary scan.
2. Runtime cache MUST remain bounded, and startup/bootstrap MUST remain small enough to support cold offline launch.

## QA

1. P0 gates MUST cover all install/offline/update/migration/content-integrity/recovery/accessibility/overflow/error cases enumerated in DESIGN.md.
2. Production readiness MUST require recovery/export proof, deterministic campaign hash, all-level solvability, no mixed build, and no page or console errors in a real browser.

