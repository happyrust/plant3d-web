# MBD Layout Consistency Architecture

## Mission Scope

This mission delivers a frontend-first refactor for MBD pipe annotation layout in `plant3d-web`.

Primary scope:
- extract a pure branch-level layout engine from `src/composables/useMbdPipeAnnotationThree.ts`
- replace camera-sensitive primary placement decisions with deterministic branch/hint-driven logic
- support the approved phase-1 annotation families: `segment`, `chain`, `overall`, `port`, `bend`, `cut_tubi`, `tag`, and fittings
- keep the current frontend contract backward-compatible while adding optional future-facing hint fields
- prove the behavior through focused unit and fixture tests

This mission does **not** move layout authority to another repository, and it does **not** redesign unrelated viewer or Dock architecture.

## Source-of-Truth Rules

- `src/composables/useMbdPipeAnnotationThree.ts` remains the public rendering entrypoint and orchestration seam
- `src/api/mbdPipeApi.ts` is the frontend source of truth for `MbdLayoutHint`
- New deterministic logic should live in pure functions or modules under `src/composables/mbd/` whenever possible
- Existing session-only manual override behavior remains authoritative over auto-layout
- Existing fixture and fly-to tests are the baseline regression surfaces; expand them rather than inventing detached ad hoc checks

## Expected Data Flow

### Normal layout path
1. MBD DTO data enters the existing render entrypoint.
2. Layout hints and branch geometry are normalized into a branch-level layout context.
3. The pure layout engine resolves side, lane, and anchor decisions before annotation objects are created.
4. The render glue consumes those results to build dimensions and floating-label annotations.
5. Bounded declutter/alignment helpers may clean up residual collisions, but they should no longer act as the primary placement engine.

### Fallback path
1. If layout hints are partial or missing, the frontend derives placement from deterministic branch/topology rules.
2. Only if branch/topology data is insufficient may camera-sensitive logic participate as the last fallback.
3. If required geometry cannot produce a safe placement, the annotation is suppressed predictably instead of rendering unstable geometry.

### Override path
1. Session-only manual overrides are merged after auto-layout is computed.
2. Rerenders preserve those overrides for the targeted annotation id.
3. Resetting an override returns the annotation to the deterministic auto-layout result.

## Highest-Risk Seams

- Regressions from moving logic out of the large existing composable without preserving current behavior where still intended
- Accidentally letting optional future fields change legacy payload behavior when absent
- Camera updates or mode toggles still mutating semantic placement after the refactor
- Port and auxiliary declutter remaining order-dependent rather than deterministic
- BRAN-specific regressions hiding behind tests that only assert raw numeric offsets instead of semantic layout guarantees
