# Data Model: BRAN Flow Direction Scoped Deploy Validation

## Target BRAN Root

The BRAN root selected for scoped generation and frontend validation.

**Fields**:

- `target_root_refno`: Canonical user-facing refno. Initial value: `2013286704/476`.
- `url_key`: URL/API-safe equivalent when needed. Example: `2013286704_476`.
- `dbnum`: Source database number when known. Initial value: `250160`.
- `project`: Source project when known. Initial value: `AvevaPlantSample`.

**Validation rules**:

- The root must be non-empty.
- Slash and underscore forms must be treated as equivalent only for URL/API normalization; validation notes must record which form was used.

## Scoped Deploy Result

The backend quick deploy output used to open the frontend viewer.

**Fields**:

- `target_root_refno`: Echoed target root from the backend response.
- `scoped_refno_count`: Number of scoped roots reported by the backend, expected to be at least 1 for a scoped run.
- `scoped_viewer_url`: Viewer URL returned or derived for the scoped package.
- `site_id` / `site_name`: Optional quick deploy site identifiers.
- `package_path`: Optional generated package path if validation happens from local files.

**Validation rules**:

- `target_root_refno` must match the requested target root after normalization.
- `scoped_viewer_url` must be present for direct browser validation, or a documented equivalent URL must be constructed.
- Missing deploy output is a deploy gate blocker, not a frontend renderer failure.

## Scoped Viewer Session

The `plant3d-web` browser session opened against the scoped deploy result.

**Fields**:

- `viewer_url`: The URL opened in the browser.
- `output_project`: Project identifier passed through viewer query params when present.
- `show_dbnum`: Database number passed through viewer query params when present.
- `mbd_refno` / `mbd_pipe`: Optional query-triggered MBD annotation refno.
- `console_errors`: Non-fatal and fatal browser console messages captured during validation.

**Validation rules**:

- The viewer must load enough model context to expose MBD pipe annotation controls.
- Unrelated project/tree API failures must be recorded but not treated as flow overlay failures if MBD annotation data still loads.

## MBD Pipe Annotation Payload

The data consumed by `useMbdPipeAnnotationThree.renderBranch()`.

**Fields**:

- `input_refno`: Refno requested by the UI/API.
- `branch_refno`: Refno represented by the payload.
- `branch_name`: Human-readable branch name when available.
- `segments`: Segment collection with `arrive` and `leave` coordinates.
- `dims`, `welds`, `slopes`, `bends`, `fittings`, `tags`: Existing annotation collections.

**Validation rules**:

- `input_refno` or `branch_refno` should match the target root after slash/underscore normalization.
- Segments with complete finite `arrive` and `leave` coordinates are valid for flow direction.
- Missing or directionless segments are data coverage findings, not automatic renderer failures.

## Flow Overlay Validation Result

The outcome of enabling and disabling `流向` in the scoped viewer.

**Fields**:

- `default_hidden`: Whether flow direction is hidden before user action.
- `valid_segment_count`: Count of valid flow segments in the loaded payload.
- `visible_after_enable`: Whether centerlines and arrows become visible after enabling `流向`.
- `hidden_after_disable`: Whether flow direction hides after disabling `流向`.
- `hidden_when_mbd_hidden`: Whether flow direction hides when overall MBD visibility is disabled.
- `direction_sample`: Optional sampled segment id and direction check.

**Validation rules**:

- A pass requires at least one valid segment and visible flow objects after enablement.
- If there are zero valid segments, the result is blocked by data coverage.
- Direction samples must use `arrive -> leave`, not topology inference.

## Validation Record

Durable evidence stored in spec quickstart notes or follow-up validation logs.

**Fields**:

- `date`
- `commands_run`
- `quick_deploy_endpoint`
- `quick_deploy_result`
- `viewer_url`
- `mbd_payload_result`
- `automated_test_result`
- `manual_visual_result`
- `blockers`

**Validation rules**:

- A validation record must classify blockers into deploy service, package loading, MBD annotation API/data, or frontend overlay behavior.
- A validation record must not include API keys, credentials, or local secrets.
