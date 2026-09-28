# Quickstart: Scoped BRAN Deploy Flow Direction Validation

## Prerequisites

- `plant3d-web` dependencies installed.
- Backend workspace available at `D:\work\plant-code\plant-model-gen-cata-closure`.
- Backend quick deploy changes include `target_root_refno`, scoped metadata, and sidecar root-model activation.
- Initial validation target:
  - Project: `AvevaPlantSample`
  - DB number: `250160`
  - BRAN root: `2013286704/476`
  - URL/API form when required: `2013286704_476`

## Automated Frontend Baseline

Run the existing BRAN flow direction tests:

```bash
npx vitest run src/fixtures/bran-test-data.test.ts src/components/tools/MbdPipePanel.mode.test.ts src/ribbon/ribbonConfig.mbd.test.ts
```

Expected results:

- BRAN fixture flow direction objects are hidden by default.
- Flow objects point from segment `arrive` to `leave`.
- Invalid segments are skipped without blocking valid segments.
- Flow visibility is independent from labels and segment skeleton controls.
- MBD panel exposes the `流向` checkbox.
- MBD ribbon exposes the `mbd.flow_direction` command.

Run type checking:

```bash
npm run type-check
```

Expected result: no TypeScript errors.

## Scoped Deploy Validation

Trigger backend quick deploy with the target root.

Use the project-specific quick deploy endpoint or admin UI. The request must include:

```json
{
  "target_root_refno": "2013286704/476"
}
```

Record from the response:

- `target_root_refno`
- `scoped_refno_count`
- `scoped_viewer_url`
- quick deploy site id/name if present
- generated package path if visible in logs

Expected results:

- `target_root_refno` matches `2013286704/476` after normalization.
- `scoped_refno_count` is present and at least `1`.
- `scoped_viewer_url` is present or can be derived from the site metadata.

## Viewer Validation

Open `scoped_viewer_url` in `plant3d-web`.

If the URL does not auto-load MBD pipe annotations, request the target BRAN through the existing MBD path using one of the accepted forms:

- `2013286704/476`
- `2013286704_476`

Validate:

1. The viewer loads without a fatal app error.
2. MBD pipe annotation controls are available.
3. Before enabling `流向`, no flow direction centerlines or arrows are visible.
4. Enable `流向` from the ribbon or MBD pipe panel.
5. Blue/cyan centerlines and orange arrows appear on valid BRAN segments.
6. Disable `流向`; flow centerlines and arrows disappear without hiding other MBD annotations.
7. Toggle overall MBD visibility off; flow direction hides even if `流向` remains enabled.
8. Toggle overall MBD visibility back on; flow direction reappears only if `流向` is enabled.

## Failure Classification

Use this classification before editing frontend code:

- **Deploy service blocker**: quick deploy endpoint is unavailable or scoped generation fails before a viewer URL exists.
- **Package loading blocker**: viewer opens but cannot load the scoped model/package.
- **MBD annotation API blocker**: model loads but target BRAN annotation data cannot be fetched.
- **Data coverage blocker**: MBD annotation data loads but has no valid segments with finite `arrive` and `leave`.
- **Frontend overlay blocker**: valid scoped segment data loads, but enabling `流向` does not show the expected overlay.

Only the last category justifies changing the flow direction renderer without additional backend/data work.

## Validation Record

**2026-06-15 automated baseline**

- Command: `npx vitest run src/fixtures/bran-test-data.test.ts src/components/tools/MbdPipePanel.mode.test.ts src/ribbon/ribbonConfig.mbd.test.ts`
- Result: passed, 3 test files and 33 tests.
- Note: test output included a `localhost:3000` connection refused diagnostic, but all tests passed.
- Command: `npm run type-check`
- Result: passed.

**2026-06-15 scoped deploy validation attempt**

- Backend service: existing `plant-model-gen-cata-closure` `web_server` on `http://127.0.0.1:19090`.
- Request: `POST /api/admin/quick-deploy-test` with `project_path=D:/AVEVA/Projects/E3D2.1/AvevaPlantSample`, `dbnum=250160`, `target_root_refno=2013286704/476`, `gen_model=true`, `gen_mesh=true`, `gen_spatial_tree=true`, `start_site=true`, `wait=true`, `pipeline_db_mode=ws`, and `cata_partial_parse=true`.
- Quick deploy result: endpoint returned HTTP success wrapper, but payload `data.success=false` because room compute failed with `房间计算失败，退出码: Some(1)`.
- Scoped generation evidence: `parse_status=Parsed`, generation sidecar succeeded, `scoped_refno_count=1`, `target_root_refno=2013286704_476`, and `scoped_viewer_url=http://192.168.1.5:8090/?show_refno=2013286704_476&mbd_refno=2013286704_476&data_source=parquet`.
- Configuration evidence: generated site metadata persisted `manual_refnos=["2013286704/476"]`; `DbOption-generate.toml` contains `debug_model_refnos=["2013286704/476"]`.
- Package evidence: generated parquet manifest for `250160` contains `instances.parquet` with 1131 rows and `tubings.parquet` with 1 row.
- Site startup: quick deploy did not leave `8090` listening after the room compute failure; manually starting the generated site config brought `http://192.168.1.5:8090/api/version` online.
- MBD payload result: `GET /api/mbd/pipe/2013286704_476`, `GET /api/mbd/pipe/2013286704%2F476`, `GET /api/mbd/v2/pipe/2013286704_476`, and `GET /api/mbd/v2/pipe/2013286704%2F476` all returned empty `404 Not Found` from the scoped site, even though startup logs listed the MBD routes.
- MBD route diagnosis: the running backend was built with `--features web_server` only. In `plant-model-gen-cata-closure`, `web_server` is the base HTTP feature and does not include `mbd-pipe`; when `mbd-pipe` is disabled, `web_api::create_mbd_pipe_routes()` compiles to an empty router. MBD validation therefore requires a backend built with `mbd-pipe` or `full`.
- Visual flow direction result: blocked before browser overlay validation because target BRAN MBD annotation data could not be fetched.
- Blocker classification: **MBD annotation API blocker** caused by backend feature flags. Do not change `plant3d-web` flow renderer from this result; next work should restart the scoped site with `mbd-pipe`/`full` enabled and separately decide whether room-compute failure should block `start_site` for scoped BRAN validation.
