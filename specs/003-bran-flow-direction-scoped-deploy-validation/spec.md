# Feature Specification: BRAN Flow Direction Scoped Deploy Validation

**Feature Branch**: `003-bran-flow-direction-scoped-deploy-validation`

**Created**: 2026-06-15

**Status**: Draft

**Input**: User description: "Continue testing BRAN flow direction annotation in plant3d-web, combine with the current backend scoped BRAN generation changes, use grill-me analysis, and write a spec kit."

## User Scenarios & Testing

### User Story 1 - Validate Flow Direction On Scoped BRAN Deploy (Priority: P1)

As a model reviewer, I can open a quick-deployed viewer that is scoped to one BRAN root and verify the existing flow direction overlay on that real generated branch, so fixture coverage is backed by a deployable sample.

**Why this priority**: The frontend BRAN flow direction MVP already has fixture and UI tests. The remaining risk is whether the backend scoped deploy path produces a small, loadable BRAN package whose MBD pipe annotation data drives the same overlay.

**Independent Test**: Trigger quick deploy with a known BRAN root refno, open the returned scoped viewer URL, load MBD pipe annotations for the same root, enable `流向`, and verify valid segments display arrive-to-leave centerlines and arrows.

**Acceptance Scenarios**:

1. **Given** quick deploy receives `target_root_refno=2013286704/476`, **When** generation completes, **Then** the deployment response reports the same target root and a scoped viewer URL.
2. **Given** the scoped viewer URL is opened in `plant3d-web`, **When** MBD pipe annotations for the target BRAN are requested, **Then** the loaded annotation data identifies the same BRAN root or normalized equivalent.
3. **Given** the target BRAN annotation data contains valid segments, **When** the user enables `流向`, **Then** flow centerlines and arrows appear for those valid segments.
4. **Given** the user disables `流向`, **When** other MBD annotation controls remain visible, **Then** flow direction hides without hiding dimensions, welds, slopes, labels, or segment skeletons.

---

### User Story 2 - Preserve Existing Frontend Flow Direction Behavior (Priority: P1)

As a frontend maintainer, I can rerun the existing BRAN flow direction tests after the backend-scoped validation work, so the integration work does not regress the implemented UI and renderer contract.

**Why this priority**: The scoped deploy validation should not rewrite the flow renderer unless a real data mismatch is found.

**Independent Test**: Run the existing BRAN fixture, MBD pipe panel, ribbon config, and type-check commands.

**Acceptance Scenarios**:

1. **Given** no real data mismatch is found, **When** the validation spec is completed, **Then** no frontend renderer behavior is changed.
2. **Given** the existing tests are run, **When** the branch is ready for review, **Then** the BRAN fixture tests still verify default hidden state, arrive-to-leave direction, invalid segment skipping, visibility independence, and cleanup.
3. **Given** the panel and ribbon tests are run, **When** they pass, **Then** both `流向` controls still operate the same `showFlowDirection` state.

---

### User Story 3 - Record Actionable Diagnostics When Real Deploy Data Is Unavailable (Priority: P2)

As a developer validating the flow direction feature, I can distinguish a frontend rendering problem from an unavailable deploy service or missing generated package, so blocked manual validation does not hide the next required action.

**Why this priority**: The previous manual validation attempt was blocked by unavailable local and remote deploy endpoints. The new backend scoped generation changes should provide a repeatable path, but the spec must still capture failure evidence clearly.

**Independent Test**: Attempt the scoped deploy validation path and record the exact endpoint, response, viewer URL, and MBD annotation API availability.

**Acceptance Scenarios**:

1. **Given** quick deploy is unavailable, **When** validation is attempted, **Then** the result records the failing endpoint and does not claim frontend visual validation passed.
2. **Given** quick deploy succeeds but the viewer cannot load MBD annotation data, **When** validation is attempted, **Then** the result records the missing API/data path separately from flow renderer behavior.
3. **Given** MBD annotation data loads but contains no valid segments, **When** `流向` is enabled, **Then** the result records a data coverage problem rather than a renderer regression.

### Edge Cases

- `target_root_refno` uses slash form (`2013286704/476`) while viewer or MBD APIs use underscore form (`2013286704_476`).
- Quick deploy completes but returns no `scoped_viewer_url`.
- The scoped package contains geometry but no MBD pipe annotation payload for the target BRAN.
- The MBD annotation payload contains segments with missing or zero-length `arrive`/`leave` coordinates.
- The scoped BRAN contains only one or a few very short valid segments.
- Existing fixture tests pass while real generated data exposes a coordinate convention mismatch.
- Dev server proxy errors appear for unrelated project/tree APIs while MBD demo or scoped data still loads.

## Requirements

### Functional Requirements

- **FR-001**: The validation flow MUST start from a quick deploy request that includes one explicit `target_root_refno`.
- **FR-002**: The quick deploy result MUST expose enough scoped metadata to identify the requested BRAN root in validation notes.
- **FR-003**: The validation flow MUST open or construct a viewer URL that loads the scoped project output in `plant3d-web`.
- **FR-004**: The validation flow MUST request MBD pipe annotation data for the target BRAN root using the normalized refno form accepted by the frontend route or API.
- **FR-005**: The validation flow MUST verify that enabling `流向` makes flow direction objects visible only when MBD pipe annotations are visible.
- **FR-006**: The validation flow MUST verify that flow direction remains derived from segment `arrive -> leave` and does not infer topology from neighboring components.
- **FR-007**: The validation flow MUST preserve the existing default hidden behavior for new viewer sessions.
- **FR-008**: The validation flow MUST rerun existing automated frontend tests before any manual scoped deploy result is considered review-ready.
- **FR-009**: The validation record MUST separate backend deploy availability, viewer package loading, MBD annotation API/data availability, and flow overlay behavior.
- **FR-010**: The validation work MUST NOT persist API keys, deploy credentials, or machine-local secrets in the repository.
- **FR-011**: The validation work MUST NOT change frontend renderer behavior unless a reproducible real-data mismatch is identified and documented.

### Key Entities

- **Scoped BRAN Deploy**: A quick-deployed package generated from one `target_root_refno` rather than the full model.
- **Target BRAN Root**: The BRAN refno being validated, initially `2013286704/476`.
- **Scoped Viewer URL**: A viewer URL returned by quick deploy or derived from its metadata that opens the scoped package in `plant3d-web`.
- **MBD Pipe Annotation Payload**: The BRAN annotation data loaded by the frontend, including segments with `arrive` and `leave` coordinates.
- **Validation Record**: The durable notes that state which automated and manual checks were run, with pass/fail/blocker evidence.

## Success Criteria

### Measurable Outcomes

- **SC-001**: Existing automated BRAN flow direction tests pass: fixture, MBD panel, ribbon config, and TypeScript type-check.
- **SC-002**: A scoped deploy attempt records the exact target root, deployment result, and viewer URL or failure point.
- **SC-003**: If scoped MBD data is available, at least one valid segment is confirmed to produce visible flow direction objects after `流向` is enabled.
- **SC-004**: If scoped MBD data is unavailable, the validation record identifies whether the blocker is deploy service, package loading, MBD API, or data coverage.
- **SC-005**: No frontend behavior changes are made without a failing reproducible test or documented real-data mismatch.

## Assumptions

- The backend scoped generation work in `plant-model-gen-cata-closure` provides `target_root_refno`, `scoped_viewer_url`, and `--root-model` sidecar activation.
- The initial real-data target is AvevaPlantSample `dbnum=250160` and BRAN root `2013286704/476`, matching previous validation notes.
- `plant3d-web` keeps the flow overlay contract from `specs/002-bran-flow-direction`: session-only, hidden by default, and derived from segment `arrive -> leave`.
- This spec is a validation and integration hardening spec, not a replacement for the existing flow direction renderer MVP spec.
