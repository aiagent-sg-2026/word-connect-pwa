# Human Golden Set Workflow V1

Build-time-only workflow for WordScore calibration. It never ships in the runtime bundle and never treats model output as human truth.

## Commands

```bash
npm run golden:queue             # deterministic candidate queue from build-time dictionary
npm run golden:review:export     # blind JSON + CSV packet; no predictions/scores/reasons/class bands/flags
npm run golden:review:validate -- --file PATH  # validate JSON or CSV reviews; defaults to canonical JSON
npm run golden:review:import -- --file PATH    # atomically replace canonical reviews only after validation
npm run golden:adjudication:validate           # validate explicit JSON adjudications
npm run golden:status            # progress/coverage/readiness report
npm run golden:publish           # production gate; refuses until READY
npm run golden:publish:draft     # explicit draft artifact for workflow testing
npm run golden:eval              # frozen evaluator report for published/draft artifact
```

## Contracts and gates

Contracts live in `src/golden/contracts.ts`. Golden classes are exactly `TARGET`, `BONUS`, `ACCEPT_ONLY`, `BLOCKED`, `REVIEW`.

A valid human review must include an opaque `reviewerId`, ISO `reviewedAt`, `source: "human-review-v1"`, class, confidence `0..1`, and optional reason/note. Model-generated or policy-generated labels cannot satisfy the human gate. Validation rejects unknown words, duplicate same-reviewer/word rows, invalid class/source/timestamp/confidence, and queue version/checksum mismatches. CSV import supports quoted commas, escaped quotes, and newlines; invalid imports fail before replacing the canonical review file.

A production final item requires two distinct human reviewers for every word. Two distinct agreeing reviews resolve the word without adjudication. Adjudication (`source: "human-adjudication-v1"`) is allowed only after at least two distinct human reviews for that word actually disagree; the adjudicator must be distinct from the source reviewers, and `sourceReviewerIds` must name at least two known reviewers involved in the disagreement. One review plus adjudication is invalid. Policy/model overrides cannot auto-resolve human disagreement.

Every queue load/export/status/review-validation/publish path recomputes and verifies the queue checksum over source, version, target/counts, and candidates; a merely truthy checksum is not accepted. `npm run golden:publish` refuses READY unless: the fixed `HUMAN_GOLDEN_TARGET` of 2,000 is met independent of `queue.targetCount`, all items are resolved, no duplicates exist, queue checksum/version is frozen, and split integrity passes. `--draft` is deliberately separate and never means 2,000 human-reviewed words exist.

## Frozen evaluator principle

For a comparison run, freeze evaluator version, thresholds/scoring version, source dictionary checksum, candidate/final Golden checksum, split policy, and baseline scoring version. Before evaluator use, the published manifest+items checksum is independently recomputed and mismatches fail closed. Missing or unverifiable human evidence is `UNKNOWN/PENDING`, never PASS. Evaluator changes require a new evaluator version and new baseline; expected labels must not be tuned to make the current scorer pass.

## Current state

Current QA seed dictionary has 187 records. The deterministic queue therefore has 187 candidates and a shortfall of 1,813 to the 2,000 target. Current human reviewed/resolved count is 0. The existing 11-item starter Golden remains `qa-starter-not-2000-human-reviewed` and is non-production regression coverage only.

Next human action: obtain a licensed/provenance-valid larger corpus, run `golden:queue`, export blind packets, collect two independent reviews per word, adjudicate disagreements, validate/import, then publish only when `golden:status` reports READY.
