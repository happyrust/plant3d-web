# Implementation Plan: BRAN Flow Direction Scoped Deploy Validation

**Branch**: `003-bran-flow-direction-scoped-deploy-validation` | **Date**: 2026-06-15 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/003-bran-flow-direction-scoped-deploy-validation/spec.md`

## Summary

Create a repeatable validation path that starts from backend quick deploy scoped by one BRAN root and ends in `plant3d-web` with the existing flow direction overlay enabled on real generated MBD pipe annotation data. The plan preserves the implemented frontend flow renderer unless scoped data reveals a reproducible mismatch.

## Technical Context

**Language/Version**: TypeScript with Vue 3 and Three.js in `plant3d-web`; Rust backend quick deploy changes live in `plant-model-gen-cata-closure`.

**Primary Dependencies**: Existing MBD pipe annotation API, `useMbdPipeAnnotationThree`, MBD pipe panel/ribbon controls, quick deploy response fields from backend.

**Storage**: N/A for frontend behavior. Validation notes are stored in spec docs only.

**Testing**: Vitest targeted tests, `npm run type-check`, and manual or scripted browser validation against a scoped deploy URL.

**Target Platform**: Browser-based `plant3d-web` viewer loading generated plant model output.

**Project Type**: Cross-repo validation spec: frontend viewer plus backend generated package.

**Performance Goals**: Scoped deploy should make BRAN validation small enough to run without full-model generation; frontend overlay generation remains linear in loaded BRAN segments.

**Constraints**:

- Do not persist `showFlowDirection`.
- Do not infer flow topology beyond segment `arrive -> leave`.
- Do not require full-model generated data for this validation.
- Do not store secrets or machine-local credentials in the repository.
- Do not change renderer code unless real data exposes a reproducible mismatch.

**Scale/Scope**: One initial BRAN root (`2013286704/476`) and the generated scoped package needed to validate flow direction overlay behavior.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Domain Contract First**: PASS. The contract remains segment `arrive -> leave`, with scoped deploy treated as a data delivery path.
- **Preserve Existing Measurement Behavior**: PASS. This validation does not touch measurement sources or saved measurements.
- **Source Separation**: PASS. Backend scoped generation, frontend package loading, MBD annotation data, and overlay rendering are tested as separate gates.
- **Compatibility And Traceability**: PASS. No persisted viewer setting changes; validation records exact target root and endpoints.
- **Real Data Validation**: PASS. The plan exists specifically to close the prior real-data validation gap.

No constitution violations are expected.

## Project Structure

### Documentation (this feature)

```text
specs/003-bran-flow-direction-scoped-deploy-validation/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── scoped-deploy-flow-validation-contract.md
├── checklists/
│   └── requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
src/
├── composables/
│   └── useMbdPipeAnnotationThree.ts
├── components/
│   ├── dock_panels/ViewerPanel.vue
│   └── tools/MbdPipePanel.vue
├── fixtures/
│   └── bran-test-data.test.ts
└── ribbon/
    └── ribbonConfig.ts
```

**Structure Decision**: Keep this feature documentation-only until validation discovers a concrete frontend mismatch. The current source files are listed as verification surfaces, not planned edit targets.

## Phase 0: Research

Research output is captured in [research.md](./research.md).

Resolved decisions:

- Scope is real scoped deploy validation, not a new flow renderer.
- Initial target root is `2013286704/476`.
- Flow semantics remain `arrive -> leave`.
- Environment blockers are recorded separately from renderer failures.

## Phase 1: Design & Contracts

Design output:

- [data-model.md](./data-model.md) defines scoped deploy validation entities and state.
- [contracts/scoped-deploy-flow-validation-contract.md](./contracts/scoped-deploy-flow-validation-contract.md) defines the expected backend response, frontend loading, and overlay validation contract.
- [quickstart.md](./quickstart.md) defines the repeatable validation commands and manual steps.

## Implementation Approach

1. Run existing automated coverage for BRAN flow direction:
   - BRAN fixture renderer tests.
   - MBD pipe panel mode tests.
   - MBD ribbon config tests.
   - TypeScript type-check.
2. Trigger or obtain a backend quick deploy scoped to `target_root_refno=2013286704/476`.
3. Record quick deploy metadata:
   - target root refno.
   - scoped refno count.
   - scoped viewer URL.
   - generated package location if available.
4. Open the scoped viewer URL in `plant3d-web`.
5. Request MBD pipe annotations for the target root, accepting documented slash/underscore normalization.
6. Enable `流向` from the ribbon or MBD pipe panel.
7. Validate and record:
   - flow overlay hidden by default.
   - valid segments create visible centerlines and arrows when enabled.
   - overlay hides when `流向` or overall MBD visibility is disabled.
   - no unrelated label or segment skeleton control is required.
8. If any gate fails, classify it as deploy service, package loading, MBD annotation API/data, or frontend overlay behavior.

## Post-Design Constitution Check

- **Domain Contract First**: PASS. The contract file keeps `arrive -> leave` as the only direction source.
- **Preserve Existing Measurement Behavior**: PASS. Validation is outside measurement paths.
- **Source Separation**: PASS. Gates prevent backend/data blockers from being mislabeled as renderer bugs.
- **Compatibility And Traceability**: PASS. The validation record captures commands, target root, and results without changing persisted state.
- **Real Data Validation**: PASS. Quickstart explicitly requires scoped deploy evidence when available and blocker evidence when unavailable.

## Complexity Tracking

No additional complexity exceptions. The cross-repo dependency is managed through validation gates rather than new shared runtime coupling.
