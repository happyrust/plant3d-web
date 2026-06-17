# Contract: Scoped Deploy Flow Direction Validation

## Purpose

Define the cross-repo validation contract between backend scoped quick deploy output and the existing `plant3d-web` BRAN flow direction overlay.

## Backend Quick Deploy Contract

The backend quick deploy request includes one scoped BRAN root.

Expected request fields:

- `target_root_refno`: Example `2013286704/476`.
- Existing quick deploy fields required by the backend environment, such as project/db/site options.

Expected response fields:

- `target_root_refno`: Echoes the normalized target root when scoped generation is requested.
- `scoped_refno_count`: Non-null when scoped generation is active.
- `scoped_viewer_url`: URL used for direct frontend validation when generation succeeds.

Expected backend behavior:

- The generation sidecar is invoked in root-model mode for the target root.
- The generated package contains only the scoped output needed for the BRAN validation path.
- Missing or invalid target roots should fail clearly before frontend validation begins.

## Refno Normalization Contract

Both forms may appear during validation:

- Slash form: `2013286704/476`.
- URL/API key form: `2013286704_476`.

Expected behavior:

- Validation may use underscore form for URLs or MBD pipe API routes.
- Validation records must preserve the original requested slash form.
- A mismatch should be reported only after normalizing slash and underscore forms.

## Frontend Viewer Loading Contract

The scoped viewer URL should open a `plant3d-web` session with enough context to load the scoped model and MBD pipe annotation controls.

Expected behavior:

- The viewer loads without a fatal app error.
- MBD pipe annotation controls are reachable from the ribbon and panel.
- Unrelated project/tree API errors are recorded as diagnostics, not flow failures, if MBD payload loading still succeeds.

## MBD Annotation Data Contract

The validation must request MBD pipe annotation data for the target root.

Expected payload:

- `input_refno` or `branch_refno` matches the target root after slash/underscore normalization.
- `segments` is present.
- At least one segment has complete finite `arrive` and `leave` coordinates for a visual pass.

Failure classification:

- No API response: MBD annotation API blocker.
- API response for a different branch: data routing blocker.
- API response with no valid segments: data coverage blocker.
- Valid segments load but no flow overlay appears: frontend overlay blocker.

## Flow Overlay Contract

The existing `specs/002-bran-flow-direction` renderer contract remains authoritative.

Expected behavior:

- `showFlowDirection` defaults to `false`.
- Effective visibility is `isVisible && showFlowDirection`.
- Flow objects are derived from segment `arrive -> leave`.
- Flow direction is independent from labels and segment skeleton visibility.
- `clearAll()` removes flow direction objects.

Validation-specific pass criteria:

1. Before enabling `流向`, flow direction is hidden.
2. After enabling `流向`, at least one valid scoped BRAN segment displays flow centerline and arrows.
3. After disabling `流向`, flow direction hides while other MBD content remains controlled by its own settings.
4. If overall MBD visibility is disabled, flow direction hides even when `showFlowDirection` remains enabled.

## Evidence Contract

Each validation attempt must record:

- Automated test commands and pass/fail result.
- Quick deploy target root and response metadata.
- Viewer URL or generated package path.
- MBD annotation request form used.
- Manual/browser visual result.
- Blocker classification when any gate cannot complete.

Evidence must not include secrets, API keys, or sensitive local credentials.
