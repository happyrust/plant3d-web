# Tasks: BRAN Flow Direction Scoped Deploy Validation

**Input**: Design documents from `/specs/003-bran-flow-direction-scoped-deploy-validation/`

**Tests**: Test tasks are included because the spec is a validation hardening effort. Existing renderer tests must remain green before real scoped deploy evidence is trusted.

## Phase 1: Setup

**Purpose**: Confirm the current frontend flow direction baseline and identify the scoped deploy environment.

- [x] T001 Run targeted BRAN flow direction automated tests in `plant3d-web`.
- [x] T002 Run `npm run type-check` in `plant3d-web`.
- [x] T003 Identify the running quick deploy endpoint or admin UI in `plant-model-gen-cata-closure`.
- [x] T004 Confirm the deploy request fields needed in addition to `target_root_refno=2013286704/476`.

---

## Phase 2: Scoped Deploy Gate

**Purpose**: Produce or locate a scoped BRAN package that can drive real frontend validation.

- [x] T005 Trigger quick deploy with `target_root_refno=2013286704/476`.
- [x] T006 Verify the response includes matching `target_root_refno`, non-null `scoped_refno_count`, and `scoped_viewer_url`.
- [x] T007 Record site id/name, generated package path, and relevant backend logs.
- [x] T008 If quick deploy fails, classify the failure as deploy service or scoped generation blocker before touching frontend code.

---

## Phase 3: Viewer And MBD Data Gate

**Purpose**: Prove the scoped package is loadable by `plant3d-web` and exposes target BRAN MBD annotation data.

- [x] T009 Open `scoped_viewer_url` in `plant3d-web`.
- [x] T010 Verify the viewer loads without a fatal app error.
- [x] T011 Request MBD pipe annotations for `2013286704/476` or `2013286704_476`.
- [ ] T012 Verify `input_refno` or `branch_refno` matches the target root after normalization.
- [ ] T013 Count valid segments with finite, non-identical `arrive` and `leave` coordinates.
- [x] T014 If MBD data is missing or contains no valid segments, classify the failure as MBD API/data coverage blocker.

---

## Phase 4: Flow Direction Overlay Gate

**Purpose**: Validate the existing frontend overlay against real scoped BRAN data.

- [ ] T015 Verify flow direction is hidden by default when scoped BRAN annotations load.
- [ ] T016 Enable `流向` from the MBD ribbon and verify visible centerlines/arrows on valid segments.
- [ ] T017 Disable `流向` and verify only flow direction hides.
- [ ] T018 Enable `流向` from the MBD pipe panel and verify it controls the same state.
- [ ] T019 Toggle overall MBD visibility and verify effective flow visibility is `isVisible && showFlowDirection`.
- [ ] T020 Sample at least one segment and verify direction follows `arrive -> leave`.

---

## Phase 5: Evidence And Follow-up

**Purpose**: Make the validation result reviewable and prevent ambiguous failures.

- [x] T021 Append the scoped deploy validation result to `quickstart.md`.
- [x] T022 Include endpoint, target root, viewer URL, MBD annotation result, and blocker classification when relevant.
- [ ] T023 If a frontend overlay blocker is found, add a failing test before changing renderer behavior.
- [ ] T024 If validation passes without frontend changes, leave renderer files untouched.

## Dependencies

- T005 depends on T003-T004.
- T009 depends on T006 unless an equivalent generated package is provided manually.
- T015-T020 depend on T012-T013.
- T023 depends on a reproducible frontend overlay blocker.

## Parallel Execution Examples

After the scoped deploy environment is known, these can run independently:

- T001 and T002.
- T010 viewer smoke validation and T011 MBD annotation request capture.
- T016 ribbon toggle validation and T018 panel toggle validation, if both controls are visible in the same session.

## Notes

- Keep this spec documentation-focused until evidence points to a frontend defect.
- Do not store credentials or environment-specific secrets in validation notes.
- Preserve the existing `specs/002-bran-flow-direction` renderer contract.
