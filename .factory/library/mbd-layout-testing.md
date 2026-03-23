# MBD Layout Testing Guide

## Primary Validation Surfaces

Use these files as the main regression surfaces for the mission:
- `src/composables/useMbdPipeAnnotationThree.flyTo.test.ts`
- `src/fixtures/bran-test-data.test.ts`
- new focused pure-layout tests under `src/composables/mbd/`

## What to Prove

Prefer semantic assertions over brittle snapshots:
- same-side placement for grouped planar dimensions
- stable lane ordering across `segment`, `chain`, `overall`, and auxiliaries
- deterministic declutter for dense `port`, `cut_tubi`, `tag`, and fitting labels
- camera independence when hints or branch context are sufficient
- safe suppression for invalid geometry
- manual override precedence and restoration
- clear/rerender stability and mode-toggle stability

## BRAN Regression Anchor

Use BRAN `24381_145717` whenever a concrete branch-level regression target is needed.

If the exact BRAN cannot be reproduced from local data, workers should:
1. record that as a blocker or risk
2. use the closest captured-equivalent fixture file that exercises the same semantic layout problem
3. explain in the handoff why the substitute fixture is topology-equivalent
4. avoid calling a toy inline object a BRAN regression harness

## Suggested Command Order

1. `npm run type-check`
2. focused eslint from `.factory/services.yaml`
3. `npx vitest run src/composables/useMbdPipeAnnotationThree.flyTo.test.ts src/fixtures/bran-test-data.test.ts`
4. any new pure-layout Vitest files added during the mission

## Evidence Standard

A good handoff should tie changed assertions to concrete evidence:
- which test file or command proved the assertion
- what semantic behavior was verified
- any remaining gap, especially if BRAN-specific evidence is missing or approximate
