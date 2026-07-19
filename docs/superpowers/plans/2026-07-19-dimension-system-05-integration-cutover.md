# Dimension Integration, Performance, and Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect the completed document/kernel/viewport system to real viewer snapping, review workflows, BRAN/MBD external dimensions, production UI, automated performance gates, and finally enable it in one controlled cutover.

**Architecture:** Viewer composition creates one document session and viewport behind disabled flags. User creation routes through the shared SnapPort and review repository; external sources normalize into read-only kernel inputs. Production commands remain hidden until functional, persistence, accessibility, export, and performance gates all pass.

**Tech Stack:** Vue 3, Dockview, existing DTX/Xeokit candidate infrastructure, Canvas2D, Playwright, Vitest, GitHub Actions, Rust review API.

## Global Constraints

- Plans 01–04 Gates 1–4 and the coordinated Rust API changes must be complete.
- No legacy renderer fallback exists; the production command remains hidden until the final task.
- Do not expose one dimension type before the other three.
- User and external dimensions remain different owners even though they share layout.
- All current review-panel regression requirements in `AGENTS.md` apply.
- Full-test known failures must not increase.
- Do not enable `DIMENSION_V2_CUTOVER` by default until every task in this plan passes.

---

## File Structure

| Path | Operation | Responsibility |
|---|---|---|
| `src/dimension/facade/createDimensionSystem.ts` | Create | Compose document, viewport, ports, repository |
| `src/dimension/facade/createDimensionSystem.test.ts` | Create | Composition contract |
| `src/dimension/adapters/branExternalDimensions.ts` | Create | BRAN candidates → read-only dimensions |
| `src/dimension/adapters/mbdExternalDimensions.ts` | Create | semantic/explicit MBD DTO → read-only dimensions |
| `src/dimension/adapters/*.test.ts` | Create | Source mappings |
| `src/components/dock_panels/ViewerPanel.vue` | Modify | Real session, SnapPort, pointer, camera, source wiring |
| `src/ribbon/ribbonConfig.ts` | Modify | Four production creation commands |
| `src/components/DockLayout.vue` | Modify | New semantic panel |
| `src/main.ts` | Modify | Register new panel dock |
| `src/composables/useReviewStore.ts` | Modify | Real repository/session lifecycle |
| `src/composables/useBranClearanceAnnotationThree.ts` | Delete | Replace temporary stub with external adapter |
| `test/perf/dimensions/*` | Create | Kernel/paint/interactive performance gate |
| `public/dimension-perf.html` | Create | Browser benchmark |
| `e2e/dimension-review-roundtrip.spec.ts` | Create | User save/restore |
| `e2e/dimension-external-readonly.spec.ts` | Create | External capability guard |
| `.github/workflows/main.yml` | Modify | Targeted dimension gates |

---

### Task 1: Compose the Dimension System Behind Disabled Flags

**Files:**
- Create: `src/dimension/facade/createDimensionSystem.ts`
- Create: `src/dimension/facade/createDimensionSystem.test.ts`
- Modify: `src/dimension/index.ts`
- Modify: `src/components/dock_panels/ViewerPanel.vue`

**Interfaces:**
- Consumes: repository, journal, resolver, SnapPort, viewer projector/painter bindings, current user.
- Produces: one disposable system facade.

- [ ] **Step 1: Define facade contract**

```ts
export type DimensionSystem = Readonly<{
  document: DimensionDocumentSession;
  viewport: DimensionViewport;
  pointer: DimensionPointerController;
  setExternalDimensions(records: readonly ExternalDimensionRecord[]): void;
  setCurrentUser(user: Readonly<{ id: string; role: string }> | null): void;
  dispose(): void;
}>;

export async function createDimensionSystem(input: Readonly<{
  canvas: HTMLCanvasElement;
  repository: DimensionDocumentRepository;
  journal: DimensionCommandJournal;
  anchorResolver: DimensionAnchorResolver;
  snapPort: DimensionSnapPort;
  context: { taskId?: string; formId?: string; documentId: string };
  requestFrame: (callback: FrameRequestCallback) => number;
  cancelFrame: (id: number) => void;
}>): Promise<DimensionSystem>;
```

- [ ] **Step 2: Write composition tests**

Assert:
- repository load hydrates document before first paint.
- journal commands are detected but not auto-replayed.
- dispose tears down pointer and viewport exactly once.
- external records never change document records.

- [ ] **Step 3: Implement facade**

Load font and document concurrently, reconcile journal, create viewport, then pointer controller. If font or document load fails, return a typed initialization error and do not mount a half-working Canvas.

- [ ] **Step 4: Wire ViewerPanel under `DIMENSION_V2_DEV`**

Use the real viewer context, `ReviewDimensionRepository`, local journal, anchor resolver, and DTX SnapPort. Keep `DIMENSION_V2_CUTOVER` false; only `?dimension_demo=1` or explicit local flag creates the system.

- [ ] **Step 5: Run tests**

```powershell
npx vitest run src/dimension/facade/createDimensionSystem.test.ts
npm run type-check
```

Expected: PASS.

---

### Task 2: Connect Real Snap Candidates and User Creation Commands

**Files:**
- Modify: `src/components/dock_panels/ViewerPanel.vue`
- Modify: `src/composables/useXeokitMeasurementTools.ts` to expose its existing source-neutral candidate query through an injected callback without changing measurement behavior
- Create: `src/dimension/adapters/viewerSnapCandidateProvider.ts`
- Create: `src/dimension/adapters/viewerSnapCandidateProvider.test.ts`
- Modify: `src/dimension/adapters/dtxDimensionSnapPort.ts`

**Interfaces:**
- Consumes: existing ptset, mesh surface, instance origin, and primitive-key-point candidates.
- Produces: exact/approximate `SnapCandidate[]` for the four edit sessions.

- [ ] **Step 1: Extract a source-neutral candidate query**

```ts
export interface ViewerSnapCandidateProvider {
  query(screen: Vec2): readonly ViewerSnapCandidate[];
}
```

Import `ViewerSnapCandidate` from the Plan 04 DTX adapter contract. Adapt existing measurement logic; do not duplicate source priorities.

- [ ] **Step 2: Map accuracy and semantics**

Mapping:
- ptset → `p-point`, exact.
- position → `instance-origin`, exact.
- primitive key point → `primitive-key-point`, exact.
- mesh pick → `model-surface`, approximate.
- primitive metadata that supplies center, rim, and normal → `circle` or `arc`, exact.
- when no circle/arc metadata exists, the radial edit session uses center + rim point candidates and a Design axis or semantic direction; it never infers a circle silently from a mesh hit.

- [ ] **Step 3: Add development commands**

Define command ids:

```text
dimension.create.linear
dimension.create.projected
dimension.create.angular
dimension.create.radial
dimension.cancel
dimension.undo
dimension.redo
```

In dev mode they create/cancel edit sessions. They are not yet added to production ribbon config.

- [ ] **Step 4: Test all creation state machines with real candidate shapes**

Each completed command must create one user record with author id/role and the correct accuracy. Verify projected axis never stores a screen direction.

- [ ] **Step 5: Run tests**

```powershell
npx vitest run `
  src/dimension/adapters/viewerSnapCandidateProvider.test.ts `
  src/dimension/adapters/dtxDimensionSnapPort.test.ts `
  src/dimension/interaction
```

Expected: PASS.

---

### Task 3: Replace the BRAN Stub and Add the MBD Read-Only Adapter

**Files:**
- Create: `src/dimension/adapters/branExternalDimensions.ts`
- Create: `src/dimension/adapters/branExternalDimensions.test.ts`
- Create: `src/dimension/adapters/mbdExternalDimensions.ts`
- Create: `src/dimension/adapters/mbdExternalDimensions.test.ts`
- Modify: `src/components/dock_panels/ViewerPanel.vue`
- Delete: `src/composables/useBranClearanceAnnotationThree.ts`
- Delete: `src/composables/useBranClearanceAnnotationThree.test.ts`

**Interfaces:**
- Consumes: current BRAN nearest-clearance candidate and a versioned MBD DTO.
- Produces: read-only `ExternalDimensionRecord[]`.

- [ ] **Step 1: Use the canonical external record from Plan 04**

```ts
import type { ExternalDimensionRecord } from '@/dimension/adapters/normalizeExternalDimensions';
```

Do not redefine this type in the adapter files; import it from the viewport adapter contract established by Plan 04.

- [ ] **Step 2: Implement BRAN mapping**

```ts
export function branClearanceToExternalDimensions(
  candidates: readonly BranNearestClearanceAnnotationCandidate[],
  sceneWorldToDesignMetres: (point: Vec3) => Vec3,
): readonly ExternalDimensionRecord[];
```

Map start/end to a semantic external linear input. Preserve backend `label_mm` as `authoritativeText`; mark the role `external`, not reference. Skip incomplete coordinates with returned diagnostics.

- [ ] **Step 3: Define and implement MBD DTO**

```ts
export type MbdDimensionDto = Readonly<{
  id: string;
  reference?: boolean;
  formattedLabel: string;
  dimensionLine: { from: Vec3; to: Vec3 };
  extensionLines?: readonly { from: Vec3; to: Vec3 }[];
  arrowLines?: readonly { from: Vec3; to: Vec3 }[];
  labelAnchor: Vec3;
  sourceToDesign: readonly number[];
}>;

export function mbdToExternalDimensions(
  values: readonly MbdDimensionDto[],
): readonly ExternalDimensionRecord[];
```

Transform every point once to Design Space and emit pinned `ExplicitLayoutInput`. Reject non-finite or non-invertible transforms.

- [ ] **Step 4: Verify read-only capabilities**

Tests assert bound actions are inspect/select/temporary-hide only, reference is accepted only from MBD, and neither adapter writes `DimensionDocumentState`.

- [ ] **Step 5: Replace BRAN stub**

Viewer feeds adapter output to `dimensionSystem.setExternalDimensions`. Delete the temporary Three annotation adapter when no callers remain.

- [ ] **Step 6: Run tests**

```powershell
npx vitest run `
  src/dimension/adapters/branExternalDimensions.test.ts `
  src/dimension/adapters/mbdExternalDimensions.test.ts `
  src/dimension/ui/DimensionSemanticList.test.ts
```

Expected: PASS.

---

### Task 4: Restore Production Panel and Ribbon Behind Cutover Flag

**Files:**
- Modify: `src/ribbon/ribbonConfig.ts`
- Modify: `src/components/DockLayout.vue`
- Modify: `src/main.ts`
- Modify: `src/dimension/ui/DimensionPanelDock.vue`
- Create or modify: `src/dimension/ui/DimensionToolbar.vue`
- Create: `src/dimension/ui/DimensionToolbar.test.ts`

**Interfaces:**
- Consumes: system facade and cutover flag.
- Produces: complete four-type production entry, never partial.

- [ ] **Step 1: Build toolbar**

Buttons:
- 线性尺寸
- 投影尺寸
- 角度尺寸
- 半径/直径尺寸
- 撤销
- 重做
- 取消当前创建

Disable all creation when no viewer/system is ready. Show dirty journal state and initialization errors.

- [ ] **Step 2: Add conditional ribbon panel**

Only when `DIMENSION_V2_CUTOVER` is true, include:

```ts
{
  id: 'view.panel.dimension',
  label: '尺寸标注',
  items: [
    { kind: 'button', id: 'panel.dimension', label: '尺寸标注', icon: 'ruler', commandId: 'panel.dimension' },
  ],
}
```

- [ ] **Step 3: Register new dock**

Register `src/dimension/ui/DimensionPanelDock.vue`, not a legacy path. Add it to default layout only under cutover.

- [ ] **Step 4: Test flag-off and flag-on trees**

Flag off: no panel/button/command. Flag on: all four creation commands and semantic list appear together.

- [ ] **Step 5: Run tests**

```powershell
npx vitest run `
  src/dimension/ui/DimensionToolbar.test.ts `
  src/ribbon/ribbonConfig.test.ts `
  src/components/DockLayout.test.ts
```

Expected: PASS.

---

### Task 5: Add Real Review Round-Trip and Permission E2E

**Files:**
- Create: `e2e/dimension-review-roundtrip.spec.ts`
- Create: `e2e/dimension-permissions.spec.ts`
- Create or extend: review API test fixtures/mocks

**Interfaces:**
- Consumes: production-like review repository and workflow.
- Produces: browser proof for save/restore/conflict/permission.

- [ ] **Step 1: Test user round trip**

Scenario:
1. Open a review task as author.
2. Create a linear and angular dimension.
3. Verify local dirty state.
4. Confirm/save review.
5. Reload.
6. Verify ids, anchors, placement, author, and base version restored.
7. Verify no `dimensions` key exists in tool-store JSON.

- [ ] **Step 2: Test V5 migration**

Seed the archive key with valid and unresolved fixtures. Open dev/cutover mode. Assert valid record loads normally and unresolved record appears `STALE` with rebind/delete only.

- [ ] **Step 3: Test permissions**

Open the same task as another non-admin user. Selection and detail work; move/delete/rebind are absent. Admin sees edit actions.

- [ ] **Step 4: Test optimistic conflict**

Two isolated browser contexts load version N. Save A, then save B. B receives conflict UI with latest state and pending command replay preview; no automatic overwrite occurs.

- [ ] **Step 5: Run E2E**

```powershell
npx playwright test `
  e2e/dimension-review-roundtrip.spec.ts `
  e2e/dimension-permissions.spec.ts
```

Expected: PASS.

---

### Task 6: Implement and Enforce the Large-Plant Dimension Performance Gate

**Files:**
- Create: `test/perf/dimensions/generateFixture.ts`
- Create: `test/perf/dimensions/benchKernel.ts`
- Create: `test/perf/dimensions/benchBrowser.ts`
- Create: `test/perf/dimensions/run.ts`
- Create: `public/dimension-perf.html`
- Create: `src/debug/dimensionPerf.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: deterministic seed/count/viewport/DPR.
- Produces: machine-readable p50/p95/max layout, paint, hit, and FPS results.

- [ ] **Step 1: Define CLI contract**

```powershell
npx tsx test/perf/dimensions/run.ts `
  --loaded-count 10000 `
  --visible-count 2000 `
  --viewport 1920x1080 `
  --dpr 2 `
  --seed 42 `
  --assert-update-p95-ms 16 `
  --assert-hit-p95-ms 2 `
  --assert-fps-min 60
```

- [ ] **Step 2: Generate stable inputs**

Generate a balanced mix:
- 800 visible linear.
- 400 visible projected.
- 400 visible angular.
- 400 visible radial.
- 8,000 additional loaded records outside the active viewport.
- 20% approximate.
- 10% invalid.
- 25% pinned.

Store only the seed/config in source; generation is deterministic.

- [ ] **Step 3: Measure browser pipeline**

The browser benchmark records:
- normalize/layout/collision/hit-index duration.
- Canvas paint duration.
- 1,000 pointer hit queries.
- 10 seconds of scripted camera updates and RAF cadence.

Discard 30 warmup frames. Compute percentile by sorted sample index `Math.ceil(0.95 * n) - 1`.

- [ ] **Step 4: Add scripts**

```json
"perf:dimensions": "npx tsx test/perf/dimensions/run.ts",
"perf:dimensions:kernel": "npx tsx test/perf/dimensions/benchKernel.ts",
"perf:dimensions:browser": "npx tsx test/perf/dimensions/benchBrowser.ts",
"perf:dimensions:ui": "vite --open /dimension-perf.html"
```

- [ ] **Step 5: Run and record reference result**

```powershell
npm run perf:dimensions
```

Expected: update p95 ≤ 16 ms, hit p95 ≤ 2 ms, FPS ≥ 60 on the documented reference machine.

If the gate fails, optimize before cutover; do not weaken thresholds in code.

---

### Task 7: Add Targeted CI Gates

**Files:**
- Modify: `.github/workflows/main.yml`

**Interfaces:**
- Produces: automated dimension quality gate without relying on unrelated known-failing full tests.

- [ ] **Step 1: Add type and targeted test steps**

After `npm ci`:

```yaml
- name: Type check
  run: npm run type-check

- name: Dimension tests
  run: npx vitest run src/dimension

- name: Dimension removal guard
  run: npx vitest run src/testing/dimensionLegacyRemovalGuard.test.ts

- name: Build
  run: npm run build-only
```

Do not run the auto-fixing `npm run lint` in CI; this plan adds no CI lint step.

- [ ] **Step 2: Run workflow-equivalent commands locally**

```powershell
npm ci
npm run type-check
npx vitest run src/dimension
npx vitest run src/testing/dimensionLegacyRemovalGuard.test.ts
npm run build-only
```

Expected: PASS.

---

### Task 8: Perform the Single Production Cutover

**Files:**
- Modify: `src/dimension/flags.ts`
- Modify: release documentation/changelog used by the repository
- Modify: `docs/notes/solvespace-dimension-dataflow.md` to describe the new flow or mark it superseded

**Interfaces:**
- Produces: production-enabled complete system.

- [ ] **Step 1: Run the complete acceptance matrix**

```powershell
npm run type-check
npm run lint
npm run build
npx vitest run src/dimension
npx vitest run src/testing/dimensionLegacyRemovalGuard.test.ts
npx playwright test e2e/dimension-*.spec.ts
npm run perf:dimensions
```

Also run the mandatory review twin-panel suites from `AGENTS.md` and record baseline versus after.

- [ ] **Step 2: Manually verify the four canonical creation flows**

For each type:
- exact and approximate snap.
- create, preview, commit, undo, redo.
- move label/line where supported.
- save, reload, restore.
- PNG and SVG export.
- keyboard list selection.

Verify external BRAN/MBD rows cannot mutate.

- [ ] **Step 3: Verify no incomplete path remains**

```powershell
rg "LinearDimension3D|AngleDimension3D|DimensionAnnotationManager|dimension_linear|dimension_angle|dimensions:\\s*\\[\\]" src
```

Expected: no production matches.

- [ ] **Step 4: Enable cutover atomically**

Only now change:

```ts
const DEFAULTS: Record<DimensionFlagName, boolean> = {
  DIMENSION_V2_DEV: false,
  DIMENSION_V2_CUTOVER: true,
};
```

No per-type flags are allowed.

- [ ] **Step 5: Re-run build and smoke after default change**

```powershell
npm run type-check
npm run build
npx playwright test e2e/dimension-canvas-smoke.spec.ts e2e/dimension-review-roundtrip.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Close Gate 5**

Publish:
- exact test counts and known unrelated baseline.
- performance machine and p95/FPS values.
- backend dimension document version contract.
- V5 migration counts: valid, invalid/rebind-required, malformed.
- PNG/SVG examples.

The rebuild is complete only after production default is enabled and all evidence is recorded.
