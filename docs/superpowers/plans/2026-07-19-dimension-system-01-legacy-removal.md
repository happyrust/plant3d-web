# Legacy Dimension Subsystem Removal Implementation Plan

> **Status:** Gate 1 implemented and verified on 2026-07-19. Type-check, build, targeted archive/replay/removal guards pass; unrelated full-suite baseline drift is recorded in `src/fixtures/dimensions/README.md`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Freeze non-executable legacy evidence, preserve every browser V5 dimension payload in an archive, and completely remove the old dimension runtime while keeping the rest of the application buildable and behaviorally unchanged.

**Architecture:** A one-way V5 archive bridge runs before the existing tool store can write V6. All legacy dimension producers are disabled before renderers and state are removed. Shared measurement and annotation classes remain untouched.

**Tech Stack:** Vue 3, TypeScript, localStorage migration, Vitest, vue-tsc, Vite.

## Global Constraints

- Follow roadmap `2026-07-19-dimension-system-roadmap.md`.
- Preserve `LinearDimension.ts`, `AlignedDimension.ts`, and `AngleDimension.ts`; they render classic measurements.
- Preserve `AnnotationBase`, `AnnotationMaterials`, `AnnotationInteractionController`, `SolveSpaceVectorFont`, `SolveSpaceBillboardVectorText`, `solvespaceLike`, offset-direction helpers, Xeokit measurements, leaders, welds, and slopes.
- Do not clear or overwrite V4/V5 dimensions before the archive write has succeeded.
- Do not create the new dimension runtime in this plan.
- Record baseline versus after for all currently failing unrelated tests; zero new failures is the gate.
- Preserve the substantial unrelated working-tree changes and do not commit unless the user explicitly requests it.

---

## File Structure

| Path | Operation | Responsibility |
|---|---|---|
| `src/fixtures/dimensions/README.md` | Create | Frozen case catalog and provenance |
| `src/fixtures/dimensions/v5-samples/*.json` | Create | Raw V5 migration inputs |
| `src/fixtures/dimensions/canonical/*.json` | Create | Four first-release geometry cases |
| `src/fixtures/dimensions/goldens/layout/*.json` | Create | Structural legacy/SolveSpace expectations |
| `src/migrations/legacyDimensionV5Archive.ts` | Create | One-way, untyped browser archive |
| `src/migrations/legacyDimensionV5Archive.test.ts` | Create | Archive idempotency and no-data tests |
| `src/testing/dimensionLegacyRemovalGuard.test.ts` | Create | Deny legacy production symbols after removal |
| `src/composables/useToolStore.ts` | Modify | Archive V5, write V6 without dimensions |
| `src/composables/useBranClearanceAnnotationThree.ts` | Modify | Temporary no-render adapter |
| `src/composables/useBranClearanceAnnotationThree.test.ts` | Modify | Assert temporary disabled behavior |
| `src/components/dock_panels/ViewerPanel.vue` | Modify | Remove legacy dimension command/render/interaction wiring |
| `src/composables/useDtxTools.ts` | Modify | Remove dimension tools and prevent pipe measurement from producing dimensions |
| `src/ribbon/ribbonConfig.ts` | Modify | Remove production dimension entry |
| `src/components/DockLayout.vue` | Modify | Remove dimension docks and commands |
| `src/main.ts` | Modify | Unregister dimension panels |
| `src/utils/three/annotation/index.ts` | Modify | Remove only 3D/user-dimension exports |
| Legacy dimension files listed in Task 5 | Delete | Complete old subsystem removal |

---

### Task 1: Record the Baseline and Freeze Non-Executable Fixtures

**Files:**
- Create: `src/fixtures/dimensions/README.md`
- Create: `src/fixtures/dimensions/v5-samples/valid-linear.json`
- Create: `src/fixtures/dimensions/v5-samples/unresolvable-worldpos.json`
- Create: `src/fixtures/dimensions/canonical/linear.json`
- Create: `src/fixtures/dimensions/canonical/projected.json`
- Create: `src/fixtures/dimensions/canonical/angular.json`
- Create: `src/fixtures/dimensions/canonical/radial.json`
- Create: `src/fixtures/dimensions/goldens/layout/legacy-linear.json`
- Create: `src/fixtures/dimensions/interactions/create-linear.json`

**Interfaces:**
- Consumes: legacy V5 JSON shape only as raw JSON.
- Produces: immutable JSON inputs consumed by Plans 02 and 03; no fixture imports a legacy TypeScript module.

- [ ] **Step 1: Capture the pre-change quality baseline**

Run:

```powershell
npm run type-check
npm run build
npm test
```

Expected:
- `type-check` and `build` use the current repository baseline.
- Record exact Vitest passed/failed file and test counts in `src/fixtures/dimensions/README.md`.
- Do not fix unrelated failures in this task.

- [ ] **Step 2: Write the fixture catalog**

Use this structure:

```md
# Frozen Dimension Fixtures

These JSON files are non-executable evidence captured before ADR-0038 removal.
They must not import or invoke the legacy dimension implementation.

## Provenance

- Legacy schema: `useToolStore` V5.
- Layout semantics: SolveSpace revision `9aeb715efd8c274851af0fdad5b275dde1198bf5`.
- Accepted decisions: `CONTEXT.md`, `docs/adr/0001`–`0040`.

## Cases

- `v5-samples/valid-linear.json`: V5 linear record with `designWorldPos`.
- `v5-samples/unresolvable-worldpos.json`: V5 world-only record that must migrate invalid.
- `canonical/linear.json`: aligned two-anchor case.
- `canonical/projected.json`: absolute X-axis projection.
- `canonical/angular.json`: minor and major 90° cases.
- `canonical/radial.json`: radius and diameter cases.
```

- [ ] **Step 3: Freeze representative V5 payloads**

The valid fixture must use the old envelope and include both world and design positions:

```json
{
  "version": 5,
  "dimensions": [
    {
      "id": "legacy-linear-valid",
      "kind": "linear_distance",
      "origin": {
        "entityId": "A",
        "worldPos": [10, 20, 30],
        "designWorldPos": [1, 2, 3],
        "sourceInfo": { "source": "ptset", "candidateId": "P1", "refno": "A" }
      },
      "target": {
        "entityId": "B",
        "worldPos": [40, 50, 60],
        "designWorldPos": [4, 5, 6],
        "sourceInfo": { "source": "primitive_key_point", "candidateId": "K1", "refno": "B" }
      },
      "offset": 0.5,
      "direction": [0, 1, 0],
      "labelT": 0.5,
      "visible": true,
      "createdAt": 1700000000000
    }
  ]
}
```

The unresolved fixture must omit `designWorldPos` and preserve a `textOverride` so Plan 03 proves it does not silently trust either field.

- [ ] **Step 4: Freeze canonical geometry and interaction sequences**

All canonical coordinates are Design Space metres. The linear case begins with:

```json
{
  "id": "linear-1000mm",
  "kind": "linear",
  "anchors": { "a": [0, 0, 0], "b": [1, 0, 0] },
  "placement": { "offsetM": 0.15, "labelT": 0.5, "side": 1 },
  "expectedValueM": 1
}
```

The interaction fixture contains semantic actions, not browser-specific event objects:

```json
{
  "case": "create-linear",
  "steps": [
    { "type": "lock-candidate", "candidateId": "P1" },
    { "type": "lock-candidate", "candidateId": "P2" },
    { "type": "preview-placement", "screen": { "x": 500, "y": 300 } },
    { "type": "commit" }
  ],
  "expectedCommand": "create"
}
```

- [ ] **Step 5: Verify fixtures are data-only**

Run:

```powershell
rg "from |import\\(|LinearDimension3D|AngleDimension3D|useDimensionAnnotation" "src/fixtures/dimensions" --glob "!README.md"
```

Expected: no matches.

---

### Task 2: Archive Browser V5 Dimensions Before V6 Writes

**Files:**
- Create: `src/migrations/legacyDimensionV5Archive.ts`
- Create: `src/migrations/legacyDimensionV5Archive.test.ts`
- Modify: `src/composables/useToolStore.ts`

**Interfaces:**
- Consumes: scoped V4/V5 tool-store JSON strings.
- Produces: `plant3d-web-dimensions-v5-archive:<scope>` with raw `unknown[]` records.

- [ ] **Step 1: Write failing archive tests**

```ts
import { describe, expect, it } from 'vitest';

import {
  archiveLegacyDimensions,
  type StorageLike,
  type LegacyDimensionArchive,
} from './legacyDimensionV5Archive';

function storageAdapter(values: Map<string, string>): StorageLike {
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

describe('archiveLegacyDimensions', () => {
  it('archives V5 dimensions once without interpreting their shape', () => {
    const storage = new Map<string, string>();
    storage.set('tools', JSON.stringify({ version: 5, dimensions: [{ id: 'd1', custom: true }] }));

    const first = archiveLegacyDimensions(storageAdapter(storage), {
      sourceKey: 'tools',
      archiveKey: 'archive',
      scope: 'project=A|db=1',
      now: () => 123,
    });
    const second = archiveLegacyDimensions(storageAdapter(storage), {
      sourceKey: 'tools',
      archiveKey: 'archive',
      scope: 'project=A|db=1',
      now: () => 456,
    });

    expect(first).toBe('created');
    expect(second).toBe('exists');
    expect(JSON.parse(storage.get('archive')!) satisfies LegacyDimensionArchive).toEqual({
      version: 1,
      sourceVersion: 5,
      scope: 'project=A|db=1',
      archivedAt: 123,
      records: [{ id: 'd1', custom: true }],
    });
  });

  it('does not create an archive when no dimension array exists', () => {
    const storage = new Map<string, string>([['tools', JSON.stringify({ version: 5 })]]);
    expect(archiveLegacyDimensions(storageAdapter(storage), {
      sourceKey: 'tools',
      archiveKey: 'archive',
      scope: 's',
      now: () => 1,
    })).toBe('empty');
    expect(storage.has('archive')).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```powershell
npx vitest run src/migrations/legacyDimensionV5Archive.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the untyped archive bridge**

```ts
export type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

export type LegacyDimensionArchive = Readonly<{
  version: 1;
  sourceVersion: 4 | 5;
  scope: string;
  archivedAt: number;
  records: readonly unknown[];
}>;

export type ArchiveLegacyDimensionsOptions = Readonly<{
  sourceKey: string;
  archiveKey: string;
  scope: string;
  now: () => number;
}>;

export function parseLegacyDimensionArchive(
  raw: string,
  input: Readonly<{ scope: string; archivedAt: number }>,
): LegacyDimensionArchive | null;

export function archiveLegacyDimensions(
  storage: StorageLike,
  options: ArchiveLegacyDimensionsOptions,
): 'created' | 'exists' | 'empty' | 'invalid' {
  if (storage.getItem(options.archiveKey) !== null) return 'exists';
  const raw = storage.getItem(options.sourceKey);
  if (!raw) return 'empty';
  const archive = parseLegacyDimensionArchive(raw, {
    scope: options.scope,
    archivedAt: options.now(),
  });
  if (!archive) return 'invalid';
  if (archive.records.length === 0) return 'empty';
  storage.setItem(options.archiveKey, JSON.stringify(archive));
  return 'created';
}
```

`parseLegacyDimensionArchive` performs the JSON/version/array validation shown in the tests and never casts records to an old TypeScript dimension type.

- [ ] **Step 4: Run archive tests**

Run:

```powershell
npx vitest run src/migrations/legacyDimensionV5Archive.test.ts
```

Expected: PASS.

- [ ] **Step 5: Call the archive before loading or writing V6**

In `useToolStore.ts`, add:

```ts
const STORAGE_KEY_V6 = 'plant3d-web-tools-v6';
const LEGACY_DIMENSION_ARCHIVE_KEY = 'plant3d-web-dimensions-v5-archive';

function archiveLegacyDimensionsForScope(scope: string): void {
  archiveLegacyDimensions(localStorage, {
    sourceKey: withStorageScope(STORAGE_KEY_V5, scope),
    archiveKey: withStorageScope(LEGACY_DIMENSION_ARCHIVE_KEY, scope),
    scope,
    now: Date.now,
  });
}
```

Invoke it at the start of `loadPersisted(scope)` and before the first V6 persistence write. Never delete V4/V5 keys in this plan.

---

### Task 3: Remove Production Entry Points and Disable Legacy Producers

**Files:**
- Modify: `src/ribbon/ribbonConfig.ts`
- Modify: `src/components/DockLayout.vue`
- Modify: `src/main.ts`
- Modify: `src/components/dock_panels/ViewerPanel.vue`
- Modify: `src/composables/useDtxTools.ts`
- Modify: `src/composables/useBranClearanceAnnotationThree.ts`
- Modify: `src/composables/useBranClearanceAnnotationThree.test.ts`

**Interfaces:**
- Consumes: existing viewer/toast and BRAN candidate contracts.
- Produces: no path can create a new legacy dimension; BRAN renderer reports every candidate as temporarily skipped.

- [ ] **Step 1: Remove dimension panels and commands**

Delete:
- `view.panel.dimension` from `ribbonConfig.ts`.
- default `dimension` panel and `panel.dimension` / `dimension.settings` cases from `DockLayout.vue`.
- `DimensionPanelDock` and `DimensionStylePanelDock` imports/registrations from `main.ts`.
- `dimension.linear`, `dimension.angle`, `dimension.clear`, and panel-opening handlers from `ViewerPanel.vue`.

- [ ] **Step 2: Make BRAN rendering explicitly unavailable**

Keep ID and label helper functions, but replace `renderAnnotations` with:

```ts
function renderAnnotations(
  candidates: BranNearestClearanceAnnotationCandidate[],
): BranClearanceRenderResult {
  clearAnnotations();
  const skipped = candidates.map((item) => ({
    id: makeBranClearanceAnnotationId(item.targetGroup, item.candidate.refno, item.index),
    reason: 'Dimension renderer unavailable during ADR-0038 rebuild',
  }));
  lastWarnings = skipped;
  requestRender?.();
  return { drawnIds: [], skipped };
}
```

Remove the `Vector3` and `LinearDimension3D` imports.

- [ ] **Step 3: Rewrite the BRAN test**

Replace renderer-construction assertions with:

```ts
it('reports candidates as skipped while the dimension renderer is absent', () => {
  const { system, addAnnotation } = createAnnotationSystemMock();
  const adapter = useBranClearanceAnnotationThree(system, { requestRender: vi.fn() });
  const result = adapter.renderAnnotations([
    candidate('wall', '24381/target-1', 0, {
      start_point: { x: 1, y: 2, z: 3 },
      end_point: { x: 4, y: 5, z: 6 },
      label_mm: 1200,
    }),
  ]);
  expect(result.drawnIds).toEqual([]);
  expect(result.skipped[0]?.reason).toContain('ADR-0038');
  expect(addAnnotation).not.toHaveBeenCalled();
});
```

- [ ] **Step 4: Disable pipe-to-pipe and pipe-to-structure dimension commits**

In `useDtxTools.ts`, remove calls to `store.addDimension` from those modes and emit:

```ts
emitToast({
  message: '尺寸标注正在重构，净距计算结果暂不创建尺寸',
  type: 'warning',
});
```

Preserve geometric query and status computation only when used by non-dimension UI; otherwise remove the mode branch entirely.

- [ ] **Step 5: Run entry-point tests**

Run:

```powershell
npx vitest run `
  src/composables/useBranClearanceAnnotationThree.test.ts `
  src/ribbon/ribbonConfig.test.ts `
  src/components/DockLayout.test.ts
npm run type-check
```

Expected: PASS with no dimension panel registered.

---

### Task 4: Remove Viewer and Tool Interaction Wiring

**Files:**
- Modify: `src/components/dock_panels/ViewerPanel.vue`
- Modify: `src/composables/useDtxTools.ts`

**Interfaces:**
- Consumes: no new interfaces.
- Produces: viewer has no `DimensionAnnotationManager`, `dim_` interaction branch, preview object, context menu, or dimension keyboard action.

- [ ] **Step 1: Remove ViewerPanel dimension imports and refs**

Remove `DimensionAnnotationManager`, `LinearDimension3D`, `AngleDimension3D`, `dimensionAnnoMgrRef`, and dimension context-menu state.

- [ ] **Step 2: Remove ViewerPanel runtime synchronization**

Delete:
- `DimensionAnnotationManager.sync(store.dimensions)` watcher/initialization.
- `dim_` selection, drag, label, context-menu, and double-click branches.
- reference/supplementary menu actions.
- dimension deletion from the Delete-key handler.
- `store.dimensions` from `hasMarks`.
- dimension background/theme calls.

- [ ] **Step 3: Remove useDtxTools preview and creation**

Delete:
- `dimensionPoints`.
- `dim_preview`.
- `updateDimensionPreview`.
- pointer move and pointer commit branches for `dimension_linear` / `dimension_angle`.
- `flyToDimension` and `removeDimension` exports.
- dimension status text.

- [ ] **Step 4: Run viewer/tool regression tests**

Run:

```powershell
npx vitest run `
  src/composables/useDtxTools.objectMeasure.test.ts `
  src/components/dock_panels/viewerToolbarSelection.test.ts `
  src/composables/useXeokitMeasurementTools.test.ts `
  src/components/tools/MeasurementPanel.test.ts
npm run type-check
```

Expected: targeted suites pass; no remaining compile references to dimension tool modes.

---

> **Build-green execution order:** After Task 4, execute Task 6 before Task 5. The unregistered legacy panels and adapter still import `DimensionRecord` and `store.dimensions`; deleting those unused files first allows the final store/type removal to compile at every checkpoint. Section numbers are retained to match the original review discussion.

### Task 5: Remove Dimension State and Write Tool Store V6

**Files:**
- Modify: `src/composables/useToolStore.ts`
- Modify: `src/components/review/reviewRecordReplay.ts`
- Modify: `src/review/adapters/toolStoreAdapter.ts`
- Modify: `src/composables/useDtxTools.objectMeasure.test.ts`
- Modify: affected tests that explicitly assert an empty `dimensions` field

**Interfaces:**
- Consumes: immutable V4/V5 archives plus the latest Task 2 V6 bridge payload.
- Produces: `PersistedStateV6` containing measurements and annotations only.

- [ ] **Step 1: Add a failing V6 persistence test**

The test must assert:
- V5 dimensions are archived.
- dimensions created or edited after the immutable V5 archive are copied from `PersistedStateV6Bridge` into `plant3d-web-dimensions-v6-bridge-archive:<scope>`.
- V6 payload has no `dimensions`.
- V5 source key remains intact.

- [ ] **Step 2: Define V6**

```ts
type PersistedStateV6 = {
  version: 6;
  measurements: MeasurementRecord[];
  annotations: AnnotationRecord[];
  obbAnnotations: ObbAnnotationRecord[];
  cloudAnnotations: CloudAnnotationRecord[];
  rectAnnotations: RectAnnotationRecord[];
  xeokitDistanceMeasurements: XeokitDistanceMeasurementRecord[];
  xeokitAngleMeasurements: XeokitAngleMeasurementRecord[];
  xeokitElevationPointMeasurements: XeokitElevationPointMeasurementRecord[];
  xeokitElevationDeltaMeasurements: XeokitElevationDeltaMeasurementRecord[];
};
```

Update local persistence and tool JSON export to V6.

Before the first final V6 write, archive the current bridge dimensions under a separate immutable envelope:

```ts
export type LegacyDimensionBridgeArchive = Readonly<{
  version: 1;
  sourceVersion: 'v6-bridge';
  scope: string;
  archivedAt: number;
  records: readonly unknown[];
}>;
```

Use key `plant3d-web-dimensions-v6-bridge-archive:<scope>`. Create it from the latest existing bridge payload, never from the older V5 archive, and never overwrite an existing bridge archive.

- [ ] **Step 3: Remove legacy dimension state**

Delete from `useToolStore.ts`:
- `DimensionKind`, record unions, and imports.
- tool modes `dimension_linear` and `dimension_angle`.
- `dimensions`, `activeDimensionId`, `pendingDimensionEditId`.
- CRUD/count/computed values and clear-all calls.
- public exports.

`importJSON` continues to accept V1–V5 for non-dimension data. Before normalization, it calls `parseLegacyDimensionArchive(raw, ...)`; a non-empty result is written to `plant3d-web-dimensions-v5-import:<scope>:<archivedAt>`. It never assigns old dimensions to runtime state.

Remove the temporary Task 4 `useDtxTools legacy dimension removal` test block after the dimension tool modes are removed from the `ToolMode` type; keep the pipe-net-distance no-dimension regression test.

- [ ] **Step 4: Remove empty-dimensions compatibility output**

After Plan 01, review replay should no longer emit a fake `dimensions: []` property. Plan 03 later introduces `dimensionDocument`. Update `reviewRecordReplay`, `toolStoreAdapter`, and tests to omit the key entirely.

- [ ] **Step 5: Run store/review migration tests**

Run:

```powershell
npx vitest run `
  src/migrations/legacyDimensionV5Archive.test.ts `
  src/composables/useToolStore.persistence.test.ts `
  src/components/tools/ToolManagerPanel.import.test.ts `
  src/review/adapters/importSnapshotAdapter.test.ts `
  src/review/adapters/toolStoreAdapter.test.ts `
  src/components/review/reviewRecordReplay.test.ts
npm run type-check
```

Expected: PASS and V4/V5 plus V6-bridge archive assertions prove no historical or post-Task-2 dimension payload was lost.

---

### Task 6: Delete Dimension-Specific Files, Exports, Demos, and Tests

**Files:**
- Delete: `src/composables/useDimensionAnnotation.ts`
- Delete: `src/composables/useDimensionStyleStore.ts`
- Delete: `src/components/tools/DimensionPanel.vue`
- Delete: `src/components/tools/DimensionStylePanel.vue`
- Delete: `src/components/dock_panels/DimensionPanelDock.vue`
- Delete: `src/components/dock_panels/DimensionStylePanelDock.vue`
- Delete: `src/utils/three/annotation/annotations/LinearDimension3D.ts`
- Delete: `src/utils/three/annotation/annotations/AngleDimension3D.ts`
- Delete: `src/utils/three/annotation/annotations/RadiusDimension.ts`
- Delete: matching 3D/radius tests
- Delete: `src/debug/dimensionPipeSandbox.ts`
- Delete: `public/dimension-pipe-sandbox.html`
- Delete: `src/debug/rebarBeamDemo.ts`
- Delete: `rebar-beam-demo.html`
- Modify: `src/utils/three/annotation/index.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: no new interfaces.
- Produces: no production legacy dimension renderer remains.

- [ ] **Step 1: Delete only dimension-specific implementation**

Do **not** delete:

```text
src/utils/three/annotation/annotations/LinearDimension.ts
src/utils/three/annotation/annotations/AlignedDimension.ts
src/utils/three/annotation/annotations/AngleDimension.ts
src/utils/three/annotation/core/**
src/utils/three/annotation/interaction/**
src/utils/three/annotation/text/**
src/utils/three/annotation/utils/**
```

- [ ] **Step 2: Clean barrel exports**

Keep classic measurement exports and remove only:

```ts
export { LinearDimension3D, type LinearDimension3DParams } from './annotations/LinearDimension3D';
export { AngleDimension3D, type AngleDimension3DParams } from './annotations/AngleDimension3D';
export { RadiusDimension, type RadiusDimensionParams } from './annotations/RadiusDimension';
```

- [ ] **Step 3: Remove broken demos/scripts**

Remove `demo:rebarviz-beam` from `package.json`. Remove standalone pages that import deleted renderers. Do not remove unrelated benchmark scripts.

- [ ] **Step 4: Mark legacy documents superseded**

Add one line below the title of legacy SolveSpace dimension implementation plans/reports:

```md
> Superseded by `docs/adr/0038-delete-the-old-dimension-system-in-a-build-green-milestone.md`.
```

Do not alter ADRs or frozen fixtures.

---

### Task 7: Add the Removal Guard and Close Gate 1

**Files:**
- Create: `src/testing/dimensionLegacyRemovalGuard.test.ts`

**Interfaces:**
- Consumes: production source tree.
- Produces: permanent denial of accidental legacy reintroduction.

- [ ] **Step 1: Add a source denylist test**

```ts
import { readdirSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const forbidden = [
  'Linear' + 'Dimension3D',
  'Angle' + 'Dimension3D',
  'Dimension' + 'AnnotationManager',
  'use' + 'DimensionAnnotation',
  'dimension_' + 'linear',
  'dimension_' + 'angle',
];

function productionTsFiles(dir = join(process.cwd(), 'src')): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'fixtures') return [];
      return productionTsFiles(path);
    }
    return ['.ts', '.tsx', '.vue'].includes(extname(entry.name)) ? [path] : [];
  });
}

describe('legacy dimension removal guard', () => {
  it('keeps forbidden runtime symbols out of production source', () => {
    const offenders = productionTsFiles()
      .filter((path) => !path.endsWith('dimensionLegacyRemovalGuard.test.ts'))
      .filter((path) => !/\\.(test|spec)\\.[cm]?[jt]sx?$/.test(path))
      .flatMap((path) => {
        const source = readFileSync(path, 'utf8');
        return forbidden.filter((token) => source.includes(token)).map((token) => `${path}:${token}`);
      });
    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 2: Run targeted non-dimension guards**

```powershell
npx vitest run `
  src/testing/dimensionLegacyRemovalGuard.test.ts `
  src/composables/useMeasurementPickSources.test.ts `
  src/composables/useXeokitMeasurementTools.test.ts `
  src/components/tools/MeasurementPanel.test.ts `
  src/utils/three/annotation/annotations/XeokitDistanceMeasurement.test.ts `
  src/utils/three/annotation/annotations/WeldAnnotation.test.ts `
  src/utils/three/annotation/annotations/SlopeAnnotation.test.ts `
  src/utils/three/annotation/annotations/LeaderAnnotation.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run repository gates**

```powershell
npm run type-check
npm run lint
npm run build
npm test
```

Expected:
- type-check/build succeed.
- targeted guards pass.
- Full Vitest has zero new failing files/tests compared with Task 1 baseline.

- [ ] **Step 4: Review checkpoint**

Confirm:
- V5 archive keys exist in migration tests.
- New `src/dimension/` runtime does not yet exist.
- Production has no dimension entry points.
- Measurement and other annotation behavior remains available.

Gate 1 is complete only after all four statements are true.
