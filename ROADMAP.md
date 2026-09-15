# Word Connect PWA — Implementation Roadmap

## Phase 0 — Architecture freeze

Tasks: approve DESIGN.md and SPEC.md; freeze invariants, data contracts, versioning, safety policy, and P0 gates; define ownership of shell, content, and state.

Exit gate: architecture review accepts the docs and explicitly defers implementation to M1.

## Phase 1 — Repository/PWA skeleton

Tasks: add TypeScript/Vite/Vanilla DOM skeleton, manifest, basic Service Worker, stable bootstrap shell, responsive layout, and CI-quality browser error checks.

Exit gate: installable shell loads at required viewports and is inspectable offline with no game logic.

## Phase 2 — IndexedDB/persistence

Tasks: create stores, schema signature, metadata, transactional repository, structural migration harness, and failure-preserving recovery path.

Exit gate: data round-trips, schema verifies, and interrupted/replayed fixtures are safe.

## Phase 3 — Core gameplay

Tasks: letter wheel, Pointer Events swipe indexes, accessible tap/select alternative, exact tile reuse rules, outcomes, progress, coins, hints, and audio feedback.

Exit gate: local play is deterministic and completion/economy/stats commit atomically.

## Phase 4 — Dictionary pipeline

Tasks: ingest lexical evidence, frequency, dialects, morphology, safety flags, reason codes, normalization policy, and exact-token review workflow.

Status: LAB foundation implemented with `npm run dictionary:build`; artifact `dict-qa-seed-v1` contains classified, explainable QA seed records and manifest checksum. Production corpus/licensing remains a later content milestone.

Exit gate: versioned build artifact contains only classified, explainable records.

## Phase 5 — WordScore V1 + ~2,000-word human Golden Set

Tasks: implement proposed TargetScore/BonusScore, stricter short-word thresholds, curate roughly 2,000 judgments, and record scoring version.

Status: `score-v1-provisional` implemented with explicit versioned config and `npm run score:eval` against `starter-golden-v1`. Human Golden Set Workflow V1 is implemented as build-time tooling (`golden:queue`, blind export, JSON/CSV validate/import, adjudication validate, status, publish, eval) with versioned contracts, recomputed checksum gates, strict two-distinct-reviewer/adjudication policy, fixed 2,000 production floor, deterministic 70/15/15 split, and frozen evaluator rule. The current QA seed dictionary yields only 187 candidates, shortfall 1,813; current human reviewed/resolved count is 0. The starter 11 judgments remain non-production QA coverage only; the ~2,000 human-reviewed Golden Set exit gate is not complete.

Exit gate: human Golden Set calibration report and reproducible score build.

## Phase 6 — Signature index/generator

Tasks: build anagram signature index, multiset/HashSet lookup, optional bitmask prefilter, generator, validator, duplicate checks, solvability checks, and difficulty bands.

Status: LAB generator implemented as `generator-v1-lab-provisional` via `npm run content:generate` and `npm run content:verify`. With the bounded QA seed corpus it honestly generates fewer than 1,000 unique quality levels and records the blocker; it does not mutate `campaign-en-v1`.

Exit gate: identical inputs/seed produce identical valid level packs without runtime dictionary scans.

## Phase 7 — Virtual Player/difficulty calibration

Tasks: model completion paths, tune difficulty and hints, test short words, and compare generated levels with human review.

Exit gate: calibrated bands meet target completion and fairness thresholds.

## Phase 8 — Immutable content packs

Tasks: define campaign manifests, hashes, revisions, atomic activation, pinned progress, and V1/V2 compatibility fixtures.

Exit gate: a started campaign cannot silently change and hash mismatch fails closed.

## Phase 9 — Safe update lifecycle

Tasks: build-specific caches, waiting prompt, Later/Update Now, safe gate, client lock/BroadcastChannel coordination, BOOT_OK, and delayed cleanup.

Exit gate: P0 update gates pass, including exactly one activation and no mixed build.

## Phase 10 — Save export/import/recovery

Tasks: versioned envelope, validate-first import, atomic write, bounded recovery codes, Retry/Export/confirmed Reset, and migration recovery UX.

Exit gate: export proof and failure fixtures preserve recoverable data.

## Phase 11 — Production campaign scaling

Tasks: scale review from 100 QA levels to 1,000 beta levels to 5,000–10,000 production levels; monitor quality and content hashes.

Exit gate: each scale passes solvability, safety, determinism, and human sampling gates.

## Phase 12 — Product hardening

Tasks: accessibility audit, device/browser matrix, performance and cache bounds, privacy review, observability without secrets, and release runbooks.

Exit gate: all P0 QA gates pass in real browsers and production readiness is signed off.

## Phase 13 — Optional post-MVP cloud/monetization/social

Tasks: separately design accounts, sync, analytics consent, monetization, leaderboards, and social features with threat/privacy reviews.

Exit gate: explicit product approval, independent security/privacy review, and no regression to offline MVP.

## Recommended first implementation milestone

**M1 = 20-Level Offline Vertical Slice.** Prove installable PWA + airplane-mode play + swipe/tap input + IndexedDB progress + coins/hints transaction + immutable hand-authored 20 levels + update waiting prompt + one migration fixture + recovery shell. Do not begin M1 during this documentation bootstrap.

## Production corpus / Human Golden status update

- ESDB en-US v1 acquisition/import is implemented as build-time tooling (`npm run corpus:build:production`) from pinned upstream commit `1e5b7d3a72f47a71da5d28686c1dd4b397178485`; notices/provenance are preserved under `THIRD_PARTY_NOTICES/` and `content/corpus/`.
- Production Human Golden queue command is `npm run golden:queue:production`; queue is DRAFT with 2,000 candidates, shortfall 0, and 0 human reviews. Phase 5 remains blocked on real independent human review/adjudication before READY/publish.
- Phase 5 reviewer surface V1 is implemented separately under `/word-connect-reviewer/`; operational verification is covered by `npm run reviewer:verify` and `npm run reviewer:smoke`. Phase 5 itself remains incomplete until two real independent reviews per production word and adjudication of disagreements are imported.
