---
name: review-closure-worker
description: Implement workflow assignment, unified timeline, annotation thread context, and refno-ledger closure features across plant3d-web and the linked backend contract.
---

# review-closure-worker

Use this worker when a feature spans more than one existing review area and must preserve the single-source-of-truth closure model.

## When To Use

Use for features that combine at least two of the following:

- workflow assignment / submit / return contract
- unified task timeline
- annotation-thread workflow context
- refno ledger aggregation
- cross-repo frontend/backend contract alignment

Prefer narrower workers when a feature cleanly fits initiation, reviewer entry, collaboration, annotation, designer tracking, or seed generation alone.

## Required Reading

Before working, read:

- mission `mission.md`
- mission `AGENTS.md`
- mission `validation-contract.md`
- mission `features.json`
- `.factory/library/review-closure-mission.md`
- `.factory/library/user-testing.md`
- `.factory/library/environment.md`

If backend work is included, also inspect the relevant `plant-model-gen` review API/model files before editing.

## Work Rules

1. Do not solve backend gaps with frontend-only placeholders unless the feature explicitly says temporary compatibility only.
2. Keep task-level timeline and refno-level ledger consistent; do not let them drift into separate truth models.
3. Every handoff must cite which assertion IDs were actually fulfilled.
4. If a feature changes contract shape, include both frontend and backend verification evidence.
5. Use `chrome-devtools-mcp` for browser validation when the feature affects user-facing review flows.

## Minimum Verification

- Frontend: `npm run type-check`
- Frontend: focused `vitest`
- Frontend: `npx eslint <changed-files> --max-warnings 0`
- Backend: `cargo check`
- Backend: focused `cargo test`
- Browser: at least one closure flow through the real UI

## Return To Orchestrator When

- the feature needs a mission-level decision about truth ownership between task timeline and refno ledger
- existing data lacks stable identifiers needed for cross-view consistency
- validation is blocked because seeded closure tasks or required backend endpoints are missing
