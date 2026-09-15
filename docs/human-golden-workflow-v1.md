# Human Golden Set Workflow V1

Build-time-only workflow for WordScore calibration. It never ships in the runtime bundle and never treats model output as human truth.

## Commands

```bash
npm run golden:queue             # deterministic candidate queue from build-time dictionary
npm run golden:review:export     # blind JSON + CSV packet; no predictions/scores/reasons/class bands/flags
npm run golden:review:validate -- --file PATH  # validate JSON or CSV reviews; defaults to canonical JSON
npm run golden:review:import -- --file PATH    # atomically replace canonical reviews only after validation
npm run golden:review:combine:production -- --out PATH REVIEW_A.json REVIEW_B.json  # safely combine independent reviewer exports
npm run golden:adjudication:validate           # validate explicit JSON adjudications
npm run golden:status            # progress/coverage/readiness report
npm run golden:publish           # production gate; refuses until READY
npm run golden:publish:draft     # explicit draft artifact for workflow testing
npm run golden:eval              # frozen evaluator report for published/draft artifact
```

## Contracts and gates

Contracts live in `src/golden/contracts.ts`. Golden classes are exactly `TARGET`, `BONUS`, `ACCEPT_ONLY`, `BLOCKED`, `REVIEW`.

Human reviewer rubric (shown without any model/scorer hints):

- `TARGET`: valid ordinary English and fair as a required puzzle answer.
- `BONUS`: valid, but better as an optional extra than a required answer.
- `ACCEPT_ONLY`: acceptable input, but should not be required or rewarded as bonus.
- `BLOCKED`: should not be accepted in the game.
- `REVIEW`: uncertain; defer for follow-up rather than guessing.

A valid human review must include an opaque `reviewerId`, ISO `reviewedAt`, `source: "human-review-v1"`, class, confidence `0..1`, and optional reason/note. Model-generated or policy-generated labels cannot satisfy the human gate. Validation rejects unknown words, duplicate same-reviewer/word rows, invalid class/source/timestamp/confidence, and queue version/checksum mismatches. CSV import supports quoted commas, escaped quotes, and newlines; invalid imports fail before replacing the canonical review file.

A production final item requires two distinct human reviewers for every word. Two distinct agreeing reviews resolve the word without adjudication. Adjudication (`source: "human-adjudication-v1"`) is allowed only after at least two distinct human reviews for that word actually disagree; the adjudicator must be distinct from the source reviewers, and `sourceReviewerIds` must name at least two known reviewers involved in the disagreement. One review plus adjudication is invalid. Policy/model overrides cannot auto-resolve human disagreement.

Every queue load/export/status/review-validation/publish path recomputes and verifies the queue checksum over source, version, target/counts, and candidates; a merely truthy checksum is not accepted. `npm run golden:publish` refuses READY unless: the fixed `HUMAN_GOLDEN_TARGET` of 2,000 is met independent of `queue.targetCount`, all items are resolved, no duplicates exist, queue checksum/version is frozen, and split integrity passes. `--draft` is deliberately separate and never means 2,000 human-reviewed words exist.

## Frozen evaluator principle

For a comparison run, freeze evaluator version, thresholds/scoring version, source dictionary checksum, candidate/final Golden checksum, split policy, and baseline scoring version. Before evaluator use, the published manifest+items checksum is independently recomputed and mismatches fail closed. Missing or unverifiable human evidence is `UNKNOWN/PENDING`, never PASS. Evaluator changes require a new evaluator version and new baseline; expected labels must not be tuned to make the current scorer pass.

## Reviewer PWA V1

`npm run reviewer:prepare` regenerates the production blind packet from the frozen production queue. `npm run reviewer:build` creates a separate offline/local-first PWA under `reviewer-dist/`; it is not part of the game runtime bundle. A reviewer must enter a stable reviewer ID before any judgment can be stored. Current judgments and local change history are stored in a reviewer-only IndexedDB database, scoped by queue checksum + reviewer + word. Skip/defer creates no review. Import is fail-closed on reviewer or queue identity mismatch, and export produces a `human-golden-reviews-v1` envelope whose rows remain `human-golden-review-v1` and pass the existing `validateReviews` contract. The UI consumes only blind fields and never exposes scorer predictions, scores, reasons, strata, policy flags, frequency or commonness signals. Reviews stay on-device until an explicit export.

Independent reviewer exports MUST be combined before canonical import; `review:combine` validates the frozen queue identity, rejects duplicate same-reviewer/word rows, and writes only the explicit `--out` path. It never mutates the canonical review file.

The Reviewer PWA is a collection surface only. It never auto-labels, generates reviewer identities, promotes a queue to READY, adjudicates disagreements, or writes canonical production review files. Two distinct real human reviews per word and the existing disagreement/adjudication rules remain authoritative.

## Current state

The QA seed dictionary still has 187 records and its 11-item starter Golden remains `qa-starter-not-2000-human-reviewed` as non-production regression coverage. Separately, the pinned ESDB production dictionary supplies a deterministic production queue of 2,000 unique candidates with shortfall 0. Canonical production human reviewed/resolved count remains 0 and readiness remains `DRAFT`.

Next human action: use the separate Reviewer PWA to collect Reviewer 1 and Reviewer 2 exports independently, validate/import them through the existing Golden workflow, adjudicate only real disagreements with a distinct adjudicator, and publish only when `npm run golden:status -- --production` reports READY.
