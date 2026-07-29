# Zone-scoped model version compare plan

## Goal

In `plant3d-web`, let a user compare the same reference number across two model versions inside a dedicated compare zone:

- choose `from` and `to` releases;
- search or pick one `refno` / one zone-scoped affected model;
- see the old and new model side by side;
- see whether that refno is added, deleted, changed, or absent in either version.

## Current facts

- `src/components/incremental/IncrementalUpdatePanel.vue` already builds incremental model rows and dispatches `plant3d:incremental-version-compare`.
- `src/components/model-tree/ModelTreePanel.vue` already listens to that event and shows a virtual `增量对比模型` list.
- `src/components/dock_panels/ViewerPanel.vue` already renders before/after canvases, but those are proxy boxes, not true release-local model assets.
- Backend `plant-model-gen-cata-closure` already exposes the better versioned contract:
  - `GET /api/model-version/releases`
  - `GET /api/model-version/compare-readiness`
  - `GET /api/model-version/diff`
  - `GET /api/model-version/releases/{release_id}/runtime-scene`
  - `GET /api/model-version/releases/{release_id}/mesh-assets`
  - `/model-version/compare` and `/model-version/release-viewer`
- Backend diff rows include `component_key` and `refno_str`. Runtime scene selection uses `component_key`.

## Decision

Build a new `modelVersionCompare` dock panel in the right zone, reusing the backend model-version APIs and release-viewer iframe selection APIs first.

Skipped for this phase:

- no new native Three.js model-version renderer;
- no new release-generation workflow in the frontend;
- no frontend guessing of `refno_u64` encoding.

If backend filtering by string refno is missing, the first frontend path uses diff rows returned by `/api/model-version/diff` and their `component_key`. Add backend `refno` filtering only if direct typed refno search needs to work without preloading the diff list.

## Scope

### Phase 1: API adapter

Create `src/api/modelVersionCompareApi.ts`.

It should wrap only the read APIs needed by the UI:

- list releases with `project`, `dbnum`, and `complete_visual_only`;
- load compare readiness for a release pair;
- load diff rows for a release pair;
- build release viewer URLs for each release;
- normalize `refno` display strings for slash/underscore matching.

Verification:

```powershell
rtk npx vitest run src/api/modelVersionCompareApi.test.ts --reporter=dot
rtk npm run type-check
```

### Phase 2: Compare zone panel

Create `src/components/model-version/ModelVersionComparePanel.vue` and `src/components/dock_panels/ModelVersionComparePanelDock.vue`.

Wire it into:

- `src/components/DockLayout.vue`
- `src/ribbon/ribbonConfig.ts`
- `src/composables/usePanelZones.ts`

UI content:

- release selectors: old/new;
- optional project/db filter;
- compare readiness status;
- `refno` search box;
- diff table filtered by `refno_str`, change type, and noun;
- selected row summary with old/new presence.

The "zone" is the comparison working area: one panel owns the release pair, current refno, diff row, and side-by-side viewer state. It can later accept a spatial zone/root refno filter, but the first useful version is refno-scoped.

Verification:

```powershell
rtk npx vitest run src/components/model-version/ModelVersionComparePanel.test.ts --reporter=dot
rtk npm run type-check
```

### Phase 3: Side-by-side model view

Inside the compare panel, embed two release-viewer iframes:

- left iframe: `from_release_id`;
- right iframe: `to_release_id`;
- when a diff row is selected, call each iframe's existing `__MODEL_VERSION_SELECT_COMPONENT(componentKey, ...)`;
- show expected absence for added/deleted rows instead of treating it as a load error;
- add optional camera sync by calling the release-viewer camera get/set APIs already used by backend `/model-version/compare`.

This reuses backend-tested release-viewer behavior and avoids duplicating GLB loading in the main `ViewerPanel`.

Verification:

```powershell
rtk npx playwright test e2e/model-version-compare-zone.spec.ts
```

The E2E should assert:

- the panel opens from Ribbon;
- two releases are selected;
- readiness is visible;
- selecting one changed row sets the same `component_key` on both panes;
- for added/deleted rows, the absent side is reported as expected absence;
- no `Parquet 不可用` or ordinary model-load failure toast is shown.

### Phase 4: Direct refno fallback

If users must type a refno that is not in the loaded diff page, add one backend read-only enhancement:

```text
GET /api/model-version/diff?...&refno=17496_496493
GET /api/model-version/releases/{release_id}/runtime-scene?...&refno=17496_496493
```

Backend should translate `refno` to the existing `component_key` server-side, because the frontend should not guess `refno_u64`.

Verification:

```powershell
rtk cargo check --features web_server,model-version-ducklake --bin web_server
rtk npm run type-check
```

## Done

- In `../plant3d-web`, the user can open one compare zone/panel and compare one selected refno across two releases.
- The page shows old/new side-by-side model views, not just proxy boxes.
- The selected refno uses the same `component_key` in both panes.
- Added/deleted/changed states are visible and do not become generic load errors.
- The existing incremental proxy compare remains available as a demo/fallback, but is no longer the target production version-compare path.
