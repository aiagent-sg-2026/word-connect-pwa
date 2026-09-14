# Word Connect PWA — Architecture Design

## 1. Product boundary

This is an original swipe-word game inspired by general Word Connect mechanics. It will use no copied branding, assets, or level data. The MVP is a mobile-first, 100% offline-first, installable PWA: TypeScript, Vite, and Vanilla DOM are preferred; IndexedDB stores local state, a Service Worker owns the app shell, the Web App Manifest enables installation, Pointer Events support input, and Web Audio supports feedback. No backend is required for MVP. Privacy is local by default: only gameplay telemetry needed for local operation is collected; cloud accounts, analytics, and monetization are future, separate features.

## 2. Gameplay interaction

The core flow is letter wheel → swipe physical tile indexes → candidate → target/bonus/accept-only/invalid → progress → completion. Each duplicate letter is a separate physical tile. A physical tile cannot be reused within one swipe. A tap/select interaction is an accessible non-drag alternative: users can select tiles, review the candidate, and submit or clear it without dragging. Primary targets are at least 44px.

## 3. Dictionary and word policy

The dictionary is a build-time content pipeline, never a raw `words.txt`. Lexical evidence, frequency, and game policy are separate inputs. Word classes are exactly `TARGET`, `BONUS`, `ACCEPT_ONLY`, `BLOCKED`, and `REVIEW`. A valid word is not automatically suitable as a required answer.

A word record contains `word`, normalized `signature`, and `length`; optional `lemma`, POS, and inflection; dialects; sources; frequency, commonness, and familiarity; flags `properNoun`, `abbreviation`, `offensive`, `archaic`, and `technical`; `targetScore`, `bonusScore`; `class`; and reason codes. Normalization must not silently change meaning: `can't` must not become `cant`, hyphenated forms must not become concatenations, and accents must not become alternate spellings unless an explicit language policy says so.

Family safety uses an exact-token policy with curated evidence and classes. It must not use a naive substring profanity filter, which creates false positives and misses contextual policy concerns.

## 4. Proposed scoring heuristics

TargetScore V1 is proposed as `0.38 Frequency + 0.18 LexicalConfidence + 0.12 Morphology + 0.12 GameplayQuality + 0.10 DialectNeutrality + 0.10 Stability - penalties`. Short words, especially three-letter targets, require stricter thresholds. BonusScore is separate: `0.30 LexicalConfidence + 0.20 Morphology + 0.20 GameplayQuality + 0.15 Dialect + 0.15 RaritySweetSpot`. These are heuristics to calibrate against a human Golden Set and later player telemetry, not established truth.

## 5. Content generation

The Level Generator is answer/anchor → letter multiset → enumerate subword signatures → quality filter → target/bonus selection → difficulty score → deterministic validator → immutable content. The primary data structure is an Anagram Signature Index plus letter-multiset counts and a HashSet. An optional bitmask is a prefilter. A Trie is reserved for prefix/hints/DFS; runtime must never scan a 300k-word dictionary per swipe.

Every level contract includes `campaignVersion`, `contentVersion`, `levelId`, `revision`, `letters`, `targets`, `bonus`, optional `acceptOnly`, `difficulty`, `dictionaryVersion`, `scoringVersion`, `generatorVersion`, and `hash`.

Generator invariants: every target is constructible from the exact tile multiset; no target is `BLOCKED` or `REVIEW`; output is deterministic for identical inputs and seed; each level is solvable; duplicates are detected; and difficulty is banded.

Campaign/content immutability is P0. Once a profile starts `campaign-en-v1`, that campaign and its level hashes must not silently change. New dictionary, scoring, or generator inputs produce `campaign-en-v2`. Progress pins `campaignVersion + levelId + levelRevision + levelHash`; a mismatch fails closed into recovery.

## 6. IndexedDB and transactions

Database name: `word-connect-db`. Stores: `meta`, `profiles`, `levels`, `progress`, `economyEvents`, `settings`, `statsDaily`, `achievements`, `gameEvents`, `migrationLog`, and `saveSnapshots`. Recommended keys are `levels [campaignVersion,levelId]`, `progress [profileId,campaignVersion,levelId]`, `statsDaily [profileId,date]`, and `achievements [profileId,achievementId]`.

Meta versions include `appVersion`, `dbSchemaVersion`, `saveDataVersion`, `activeContentVersion`, `dictionaryVersion`, `scoringVersion`, `generatorVersion`, `lastSuccessfulBuild`, and `pendingBuild`.

Balance may be cached on a profile, but every material coin or hint change also appends an economy event. Level completion progress, balance, event, and daily stats are one logical IndexedDB transaction.

Structural DB migration, save-data migration, and content activation are separate. Structural work uses `onupgradeneeded` and prefers additive changes. Save migration is strictly adjacent (`v1→v2→v3`), idempotent, replay-safe, and updates markers only after success. Startup validates a schema signature (required stores and indexes) in addition to numeric DB version. IndexedDB is never auto-wiped on failure.

## 7. PWA, update, and clients

The Service Worker owns app-shell/static assets and update delivery; IndexedDB owns gameplay, content, and state. Shell cache is `wordgame-shell-{BUILD_ID}` with an optional bounded `wordgame-runtime` cache. Interception is same-origin only; arbitrary opaque cross-origin responses are not trusted or cached. Critical HTML/JS/CSS never mix build versions. A critical shell failure leaves the old worker active.

Offline ready is true only when `shellReady && campaignReady && databaseVerified`; a Service Worker being installed is insufficient.

Lifecycle: active v1 → install v2 → waiting v2 → persistent user prompt `[Later] [Update Now]` → safe gate → activation → exactly one reload → DB migrate/verify → `BOOT_OK` → old-cache cleanup. Normal releases do not unconditionally call `skipWaiting`. The safe gate verifies the current swipe ended, progress is saved, no economy/content/migration transaction is active, compatibility is staged, and multi-client readiness is known. Old cache deletion occurs only after `BOOT_OK`.

Safari tabs and the installed PWA coordinate with `BroadcastChannel` where supported and one update owner/lock. An unknown or unready client keeps an update pending rather than forcing it.

## 8. Bootstrap, recovery, and saves

The bootstrap/recovery shell is tiny and stable. Migration/bootstrap failure preserves data and offers `Retry`, `Export Save`, and `Reset` only after explicit confirmation, with a bounded error code. There is no automatic wipe.

Planned export/import uses a versioned `word-connect-save-v1.json` envelope. Schema, campaign, and integrity validation happen first; import is atomic second.

## 9. UI, integrity, and QA

The UI is mobile-first, safe-area aware, reduced-motion friendly, and has no horizontal overflow. Inputs use 16px or larger text where relevant; status-bar/safe-area surfaces are opaque and theme-aware; desktop uses a centered app-like shell. Verify 390×844, 834×1112, 1280×900, 1440×900, and a 320px narrow viewport.

Content manifest/hash verification, sanitized save imports, campaign/hash fail-closed behavior, no client-side secrets, and no remote executable-content requirement are mandatory.

P0 QA gates include: fresh online install then offline play; warm airplane reload; cold installed-PWA airplane launch; waiting prompt; Later preserving the old version; Update Now causing exactly one activation; critical asset failure preserving the old build; no mixed build; migration replay twice identically; interrupted migration preserving prior valid state; V1 unchanged after V2; all levels solvable; deterministic campaign hash; no mobile/tablet/desktop overflow; no real-browser page or console errors; accessible non-drag play; bounded runtime cache; and recovery/export proof before production-ready.
