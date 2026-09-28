# Quickstart: BRAN Pipe Flow Direction

## Prerequisites

- Dependencies installed with the repository's normal package manager.
- Worktree on feature branch `002-bran-flow-direction`.
- Existing BRAN fixture available at `src/fixtures/bran-test-data.json`.

## Targeted Automated Validation

Run the BRAN fixture test after implementation:

```bash
npx vitest run src/fixtures/bran-test-data.test.ts
```

Expected results:

- Default `showFlowDirection` is `false`.
- Rendering BRAN fixture data creates flow objects for valid segments, but they remain hidden until flow direction is enabled.
- Enabling flow direction makes flow centerlines and arrows visible when MBD annotations are visible.
- Representative fixture segments point in the expected directions, including +X for the first checked segment and +Y for the second checked segment.
- Hiding overall MBD annotations hides flow direction even when `showFlowDirection` remains enabled.
- `clearAll()` clears the flow object collection.

Run the MBD panel test if panel controls are covered there:

```bash
npx vitest run src/components/tools/MbdPipePanel.mode.test.ts
```

Expected results:

- The panel exposes a `流向` checkbox.
- The checkbox reads and toggles `vis.showFlowDirection.value`.

Run type checking:

```bash
npm run type-check
```

Expected result: no TypeScript errors.

## Manual Viewer Validation

Start the app:

```bash
npm run dev
```

Open an MBD BRAN demo or generated package that loads pipe annotation data.

Validate:

1. Before enabling the feature, existing MBD BRAN annotations look unchanged.
2. In the MBD ribbon display group, click `流向`; blue centerlines and orange direction arrows appear on valid pipe segments.
3. Click `流向` again; flow centerlines and arrows disappear without hiding dimensions, welds, slopes, or labels.
4. Open the MBD pipe annotation panel and toggle the `流向` checkbox; it controls the same overlay.
5. Toggle `全部显隐` off; flow direction hides even if the flow checkbox remains enabled.
6. Toggle `全部显隐` back on; flow direction reappears only if the flow checkbox is still enabled.
7. Refresh the page; flow direction starts hidden again.

## Visual Review Notes

- Centerlines should be visually distinct from existing pipe geometry and segment skeleton lines.
- Arrow markers should point along segment direction and should not include text labels.
- Very short or invalid segments may be skipped when they cannot produce stable direction.
- Long segments should show repeated arrows without excessive density.

## Validation Record

**2026-06-15 automated/browser smoke validation**

- Started Vite on `http://127.0.0.1:5174/` because port `5173` was already occupied.
- Opened `/?dtx_demo=mbd_pipe&mbd_pipe_case=rebarviz_beam&mbd_dim_mode=rebarviz` with Playwright.
- Verified the MBD ribbon displays the `流向` command.
- Opened the MBD pipe annotation panel and verified the `流向` checkbox is present.
- Verified the panel checkbox toggles `false -> true -> false`.
- Verified clicking the ribbon `流向` command sets the same panel checkbox to checked.
- Note: the page emitted backend proxy `500` console errors for unrelated project/tree API calls, but the MBD demo data and flow controls loaded for this validation.

**2026-06-15 deployed test-site data validation attempt**

- Intended data source: deployed site `quicktest-250160-8080` / AvevaPlantSample `dbnum=250160` / BRAN sample `2013286704/476`, based on `plant-model-gen-cata-closure` validation docs.
- Probed local site APIs:
  - `http://127.0.0.1:8080/api/version` -> connection refused.
  - `http://127.0.0.1:8080/api/mbd/pipe/2013286704_476` -> connection refused.
  - `http://127.0.0.1:3100/api/version` -> connection refused.
- Probed documented remote viewer/backend endpoints:
  - `http://192.168.31.60:3102/?output_project=AvevaPlantSample&show_dbnum=250160` -> timeout.
  - `http://192.168.31.60:8080/api/version` -> timeout.
  - `http://192.168.31.60:8080/api/mbd/pipe/2013286704_476` -> timeout.
- Checked expected local deployed data paths; all were absent in this workspace:
  - `plant-model-gen-cata-closure/dist/package/Plant3D-AIOS-win-x64/release/runtime/admin_sites/quicktest-250160-8080`
  - `plant-model-gen-cata-closure/dist/package/Plant3D-AIOS-win-x64/release/runtime/admin_sites/quicktest-250160-8080/output/AvevaPlantSample/parquet/250160`
  - `plant-model-gen-cata-closure/output/parquet/250160`
- Checked `plant-model-gen-cata-closure/runtime/`; no `admin_sites/` directory or archived `quick-deploy-last-payload.json` is present, so the same deployed site cannot be restored from this workspace.
- Result: real deployed test-site data validation could not be completed in the current environment because neither the deployed site service nor its generated data package is available. The feature remains covered by fixture tests, type-check, and the local MBD demo smoke validation above.
