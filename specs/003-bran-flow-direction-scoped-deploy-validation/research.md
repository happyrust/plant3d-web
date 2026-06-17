# Research: BRAN Flow Direction Scoped Deploy Validation

## Grill-Me Analysis

The grill-me rule for this task is: answer every question from code and existing artifacts when possible; only leave questions open when they require a user or environment decision. The current recommendation is to proceed without interrupting the user because the codebase already answers the core scope questions.

### Q1. Are we testing a new frontend flow renderer or validating the existing renderer against real scoped data?

**Recommended answer**: Validate the existing renderer against real scoped data.

**Rationale**: `specs/002-bran-flow-direction` already defines and implements the frontend MVP. Its tasks are checked off, and targeted tests currently pass. The new backend work adds `target_root_refno`, scoped response metadata, and `--root-model` generation, so the unclosed risk is integration with quick-deployed BRAN data.

### Q2. What is the first real BRAN target?

**Recommended answer**: Use `2013286704/476` as the first target root.

**Rationale**: Existing quickstart notes name `quicktest-250160-8080` / AvevaPlantSample `dbnum=250160` / BRAN sample `2013286704/476`. The backend scoped generation work also uses the same form for quick deploy scoping.

### Q3. Should the frontend infer flow from topology if real generated data has gaps?

**Recommended answer**: No. Keep flow semantics fixed to segment `arrive -> leave`.

**Rationale**: The original flow direction spec intentionally rejects topology inference. A data gap should be recorded as MBD payload coverage, not hidden by frontend inference.

### Q4. Should `showFlowDirection` become persistent after real-data validation?

**Recommended answer**: No. Keep it session-only and hidden by default.

**Rationale**: Existing acceptance criteria and tests depend on default hidden behavior. Persisting it would change the user-visible contract and visual density.

### Q5. Should scoped deploy validation block on unrelated project/tree API proxy errors?

**Recommended answer**: No, but record them.

**Rationale**: The previous browser smoke validation saw unrelated backend proxy `500` errors while MBD demo controls still loaded. The validation record should separate viewer package loading, MBD annotation loading, and unrelated shell/project APIs.

### Q6. What counts as a pass if the deploy service is unavailable?

**Recommended answer**: Automated frontend tests can pass, but real scoped validation remains blocked.

**Rationale**: The previous deployed test-site attempt was blocked by connection refused/timeouts and missing generated package paths. A blocked deploy is not a frontend regression, but it is also not a real-data visual pass.

### Q7. Should this spec require new automated tests immediately?

**Recommended answer**: Require a small validation harness only if the scoped package or MBD API is available in a stable local form.

**Rationale**: Existing automated tests already cover renderer behavior. Without a stable generated package or API fixture, a new test would be brittle. The first deliverable should be a repeatable quickstart and evidence record; automation can follow once the scoped package path stabilizes.

### Q8. What is the highest-risk mismatch between backend scoped generation and frontend flow overlay?

**Recommended answer**: Refno normalization and MBD annotation payload availability.

**Rationale**: Backend APIs and viewer URLs may use slash form (`2013286704/476`) or underscore form (`2013286704_476`). The viewer can load geometry while the MBD annotation API still fails or returns a branch that does not match the target.

## Decisions

### Decision 1: Create a separate validation spec instead of editing the MVP spec as the main artifact.

**Reason**: The MVP flow renderer is already specified and tested. The new work is cross-repo validation driven by backend scoped quick deploy changes.

### Decision 2: Keep frontend implementation unchanged unless real scoped data exposes a reproducible mismatch.

**Reason**: Current targeted tests and type-check pass. Spec work should not churn renderer code without evidence.

### Decision 3: Treat unavailable deploy services as an explicit blocker category.

**Reason**: It prevents false failure attribution to `plant3d-web` when the data source cannot be reached.

### Decision 4: Preserve the existing `arrive -> leave` contract.

**Reason**: It is testable, documented, and independent of topology or backend inference.

## Current Evidence

- `npx vitest run src/fixtures/bran-test-data.test.ts src/components/tools/MbdPipePanel.mode.test.ts src/ribbon/ribbonConfig.mbd.test.ts` passed: 3 files, 33 tests.
- `npm run type-check` passed.
- Existing quickstart records a prior real deployed data validation attempt that was blocked by unavailable local/remote endpoints and missing generated package paths.

## Open Environment Dependencies

- A running `plant-model-gen-cata-closure` quick deploy service or an equivalent generated scoped package.
- A `plant3d-web` dev or hosted viewer configured to load that generated output.
- MBD pipe annotation API/data for the target BRAN root.
