# Dimension Viewport, Interaction, and Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render dimension documents and external dimensions through one invalidation-driven Canvas2D viewport, support semantic snapping and transactional pointer edits, expose an accessible list, and include dimensions in PNG/SVG output.

**Architecture:** `DimensionViewport` adapts a Three camera to the pure projector contract, normalizes document/external records, runs kernel layout/collision/hit indexing, and paints once to an overlay canvas. A pointer controller talks only to `DimensionSnapPort` and the document session. Canvas remains pointer-transparent; the existing main viewer canvas routes events.

**Tech Stack:** TypeScript, Canvas2D, Three.js adapter, Vue 3 list UI, Vitest, Playwright.

## Global Constraints

- Plans 02 and 03 Gates 2 and 3 must be complete.
- Canvas overlay is always front and has `pointer-events: none`.
- No dimension creates an Object3D, DOM label, Line2, Mesh, or per-dimension canvas.
- Preview state belongs to one viewport; only pointer-up/confirm submits a command.
- External dimensions expose inspect/select/temporary-hide only.
- The accessible HTML list and Canvas share selection and bound actions.
- PNG and SVG consume the same current `LayoutResult[]`.
- Do not enable production dimension commands in this plan.

---

## File Structure

```text
src/dimension/
├── flags.ts
├── flags.test.ts
├── viewport/
│   ├── threeViewportProjector.ts
│   ├── threeViewportProjector.test.ts
│   ├── loadDimensionFont.ts
│   ├── canvasPainter.ts
│   ├── canvasPainter.test.ts
│   ├── invalidation.ts
│   ├── invalidation.test.ts
│   ├── dimensionViewport.ts
│   ├── dimensionViewport.test.ts
│   ├── viewerBindings.ts
│   └── viewerBindings.test.ts
├── ports/
│   └── snapPort.ts
├── adapters/
│   ├── normalizeUserDimensions.ts
│   ├── normalizeExternalDimensions.ts
│   └── dtxDimensionSnapPort.ts
├── interaction/
│   ├── editSession.ts
│   ├── editSession.test.ts
│   ├── pointerController.ts
│   └── pointerController.test.ts
├── ui/
│   ├── DimensionSemanticList.vue
│   ├── DimensionSemanticList.test.ts
│   └── DimensionPanelDock.vue
└── export/
    ├── composePng.ts
    ├── composePng.test.ts
    ├── svgOverlay.ts
    └── svgOverlay.test.ts
public/dimension-kernel-demo.html
src/debug/dimensionKernelDemo.ts
e2e/dimension-canvas-smoke.spec.ts
e2e/dimension-export-smoke.spec.ts
```

---

### Task 1: Add the Disabled Development Flag and Three Projector Adapter

**Files:**
- Create: `src/dimension/flags.ts`
- Create: `src/dimension/flags.test.ts`
- Create: `src/dimension/viewport/threeViewportProjector.ts`
- Create: `src/dimension/viewport/threeViewportProjector.test.ts`
- Modify: `env.d.ts`

**Interfaces:**
- Consumes: Three camera, Design-to-world matrix, CSS viewport size, DPR.
- Produces: pure `ViewportProjector`.

- [ ] **Step 1: Write flag tests**

Cover precedence:
1. `localStorage['dimension.flag.DIMENSION_V2_DEV']`.
2. `VITE_DIMENSION_V2_DEV`.
3. query `dimension_demo=1` only in non-production.
4. default false.

- [ ] **Step 2: Implement flags**

```ts
export type DimensionFlagName = 'DIMENSION_V2_DEV' | 'DIMENSION_V2_CUTOVER';

const DEFAULTS: Record<DimensionFlagName, boolean> = {
  DIMENSION_V2_DEV: false,
  DIMENSION_V2_CUTOVER: false,
};

export function isDimensionFlagEnabled(name: DimensionFlagName): boolean;
```

Add optional Vite keys to `env.d.ts`.

- [ ] **Step 3: Write projector tests**

Use orthographic and perspective cameras. Assert:
- Design origin projects to viewport center after `designToWorld`.
- project/unproject round trip within `1e-8`.
- `worldPerPixelAt` grows with perspective depth.
- viewport values are CSS pixels, independent of DPR.

- [ ] **Step 4: Implement `ThreeViewportProjector`**

```ts
export class ThreeViewportProjector implements ViewportProjector {
  constructor(input: Readonly<{
    camera: THREE.Camera;
    designToWorld: THREE.Matrix4;
    widthCssPx: number;
    heightCssPx: number;
    dpr: number;
  }>);

  readonly widthCssPx: number;
  readonly heightCssPx: number;
  readonly dpr: number;
  readonly right: Vec3;
  readonly up: Vec3;
  readonly forward: Vec3;
  project(point: Vec3): { x: number; y: number; depth: number };
  unproject(point: { x: number; y: number; depth: number }): Vec3;
  worldPerPixelAt(point: Vec3): number;
}
```

The adapter may import Three. The kernel must not.

- [ ] **Step 5: Run tests**

```powershell
npx vitest run `
  src/dimension/flags.test.ts `
  src/dimension/viewport/threeViewportProjector.test.ts
```

Expected: PASS.

---

### Task 2: Load LFF and Implement the Single Canvas2D Painter

**Files:**
- Create: `src/dimension/viewport/loadDimensionFont.ts`
- Create: `src/dimension/viewport/canvasPainter.ts`
- Create: `src/dimension/viewport/canvasPainter.test.ts`

**Interfaces:**
- Consumes: `LayoutResult[]`, `LffFont`, theme, Canvas2D context.
- Produces: one deterministic overlay paint.

- [ ] **Step 1: Implement browser font loading**

```ts
export async function loadDimensionFont(
  url = '/fonts/unicode.lff.gz',
): Promise<LffFont> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to load dimension font: ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return LffFont.fromText(await new Response(stream).text());
}
```

If `DecompressionStream` is unavailable, fail with an actionable error; do not silently fall back to platform fonts.

- [ ] **Step 2: Write painter tests with a recording context**

Use a small fake exposing `setTransform`, `clearRect`, `beginPath`, `moveTo`, `lineTo`, `stroke`, `save`, `restore`, `setLineDash`. Assert:
- DPR transform is applied once.
- canvas is cleared in CSS coordinates.
- lines are batched by style role.
- glyphs use LFF trace lines.
- no `fillText`, `strokeText`, or `measureText` call exists.

- [ ] **Step 3: Implement painter**

```ts
export class Canvas2DDimensionPainter {
  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly font: LffFont,
  ) {}

  resize(widthCssPx: number, heightCssPx: number, dpr: number): void;
  paint(layouts: readonly LayoutResult[], theme: DimensionTheme): void;
  clear(): void;
  dispose(): void;
}
```

`resize` sets physical width/height to rounded CSS × DPR and CSS style size to CSS pixels. `paint` uses a CSS-pixel transform and rounds final line endpoints to half pixels when line width is odd.

- [ ] **Step 4: Run tests**

```powershell
npx vitest run src/dimension/viewport/canvasPainter.test.ts
```

Expected: PASS.

---

### Task 3: Build Invalidation-Driven `DimensionViewport`

**Files:**
- Create: `src/dimension/viewport/invalidation.ts`
- Create: `src/dimension/viewport/invalidation.test.ts`
- Create: `src/dimension/viewport/dimensionViewport.ts`
- Create: `src/dimension/viewport/dimensionViewport.test.ts`
- Create: `src/dimension/adapters/normalizeUserDimensions.ts`
- Create: `src/dimension/adapters/normalizeExternalDimensions.ts`

**Interfaces:**
- Consumes: document session, external source snapshot, projector factory, kernel, painter.
- Produces: current layouts, hit index, selection/hover state, temporary external hiding.

- [ ] **Step 1: Define dirty reasons**

```ts
export type DimensionViewportDirtyReason =
  | 'document'
  | 'external'
  | 'camera'
  | 'size'
  | 'dpr'
  | 'theme'
  | 'format'
  | 'interaction'
  | 'preview';

export class InvalidationSet {
  add(reason: DimensionViewportDirtyReason): void;
  consume(): ReadonlySet<DimensionViewportDirtyReason>;
  get dirty(): boolean;
}
```

- [ ] **Step 2: Write scheduler tests**

Assert multiple invalidations before RAF produce one frame, static view produces none, and invalidation during paint schedules one additional frame.

- [ ] **Step 3: Implement normalizers**

```ts
export function normalizeUserDimension(
  record: UserDimensionRecord,
): NormalizedDimensionInput | null;

export type ExternalDimensionRecord = Readonly<{
  id: string;
  source: 'bran-clearance' | 'mbd';
  sourceLabel: string;
  role: 'external' | 'external-reference';
  layout: NormalizedDimensionInput | ExplicitLayoutInput;
}>;

export function normalizeExternalDimension(
  record: ExternalDimensionRecord,
): NormalizedDimensionInput | ExplicitLayoutInput;
```

User normalizer derives role from validity/anchor accuracy. Records with a null anchor snapshot remain list-only and return `null` from `normalizeUserDimension`; they never receive a fabricated viewport position. The normalizer never forwards author, unit, or raw semantic refs into the kernel.

- [ ] **Step 4: Implement viewport**

```ts
export class DimensionViewport {
  constructor(input: Readonly<{
    canvas: HTMLCanvasElement;
    font: LffFont;
    theme: DimensionTheme;
    format: DimensionFormatPolicy;
    requestFrame: (callback: FrameRequestCallback) => number;
    cancelFrame: (id: number) => void;
  }>);

  setDocument(state: DimensionDocumentState): void;
  setExternalDimensions(records: readonly ExternalDimensionRecord[]): void;
  setProjector(projector: ViewportProjector): void;
  setSelection(id: string | null): void;
  setHover(id: string | null): void;
  setPreview(input: NormalizedDimensionInput | null): void;
  setExternalHidden(id: string, hidden: boolean): void;
  invalidate(reason: DimensionViewportDirtyReason): void;
  hitTest(point: Vec2, tolerancePx: number): HitTarget | null;
  getLayouts(): readonly LayoutResult[];
  getCanvas(): HTMLCanvasElement;
  dispose(): void;
}
```

One scheduled frame performs normalize → layoutViewport → paint. Selection is document-shared; hover and external-hidden sets are viewport-local.

- [ ] **Step 5: Run viewport tests**

```powershell
npx vitest run src/dimension/viewport
```

Expected: PASS.

---

### Task 4: Implement SnapPort Adapter and Transactional Edit Sessions

**Files:**
- Create: `src/dimension/ports/snapPort.ts`
- Create: `src/dimension/adapters/dtxDimensionSnapPort.ts`
- Create: `src/dimension/adapters/dtxDimensionSnapPort.test.ts`
- Create: `src/dimension/interaction/editSession.ts`
- Create: `src/dimension/interaction/editSession.test.ts`
- Create: `src/dimension/interaction/pointerController.ts`
- Create: `src/dimension/interaction/pointerController.test.ts`

**Interfaces:**
- Consumes: existing model picking/measurement candidate providers, viewport hit test, document session.
- Produces: staged previews and exactly one intent command on commit.

- [ ] **Step 1: Define SnapPort from the roadmap**

Add:

```ts
export type SnapQuery = Readonly<{
  screen: Vec2;
  capabilities: readonly SnapCapability[];
  thresholdPx: number;
}>;

export type SnapQueryResult = Readonly<{
  candidates: readonly SnapCandidate[];
  selected: SnapCandidate | null;
}>;
```

Candidates sort by source priority, then pixel distance, then id. Accuracy comes from source: P-Point/instance origin/primitive key point/circle exact; arbitrary model surface approximate.

- [ ] **Step 2: Implement DTX adapter**

Define the viewer-facing candidate contract in the adapter module:

```ts
export type ViewerSnapCandidate = Readonly<{
  id: string;
  source: 'ptset' | 'mesh_pick_point' | 'position' | 'primitive_key_point';
  sceneWorld: Vec3;
  refno?: string;
  label?: string;
  distancePx: number;
  direction?: Vec3;
  circle?: Readonly<{ center: Vec3; rim: Vec3; normal: Vec3 }>;
}>;
```

`DtxDimensionSnapPort` receives injected functions rather than importing stores:

```ts
export class DtxDimensionSnapPort implements DimensionSnapPort {
  constructor(input: Readonly<{
    queryMeasurementCandidates: (screen: Vec2) => readonly ViewerSnapCandidate[];
    sceneWorldToDesignMetres: (point: Vec3) => Vec3;
  }>);
  query(input: SnapQuery): readonly SnapCandidate[];
}
```

Map existing source ids from `useMeasurementPickSources.ts`; do not duplicate source ranking constants.

- [ ] **Step 3: Define edit session state machine**

```ts
export type DimensionEditPhase =
  | 'pick-first'
  | 'pick-second'
  | 'pick-third'
  | 'pick-axis'
  | 'place'
  | 'ready'
  | 'cancelled'
  | 'committed';

export interface DimensionEditSession {
  readonly kind: DimensionKind;
  readonly phase: DimensionEditPhase;
  pointerMove(screen: Vec2): void;
  pointerDown(screen: Vec2): void;
  flip(): void;
  commit(): DimensionCommand | null;
  cancel(): void;
}
```

Implement one constructor per type. Linear locks two points. Projected locks two points plus a stable axis. Angular locks vertex plus two ray points. Radial accepts either (a) one exact circle/arc candidate carrying center, rim, and normal, or (b) a manual fallback of center point, rim point, then Design X/Y/Z or a semantic direction for the normal; both flows produce the same radial record.

- [ ] **Step 4: Test transaction boundaries**

Assert 100 pointer moves produce preview updates but zero commands. One pointer-up/confirm produces one command. Escape produces none. Permission failure returns a typed error, not a silent no-op.

- [ ] **Step 5: Implement pointer controller**

The controller receives native pointer events from the main viewer canvas. It checks existing dimension hit regions first when not creating, delegates model candidate queries only when a dimension edit session needs anchors, and returns:

```ts
export type PointerDispatchResult =
  | Readonly<{ consumed: false }>
  | Readonly<{ consumed: true; requestRender: true }>;
```

The caller decides whether to stop other viewer tools.

- [ ] **Step 6: Run tests**

```powershell
npx vitest run src/dimension/adapters/dtxDimensionSnapPort.test.ts src/dimension/interaction
```

Expected: PASS.

---

### Task 5: Mount the Development Viewport in `ViewerPanel`

**Files:**
- Modify: `src/components/dock_panels/ViewerPanel.vue`
- Modify: `src/composables/useViewerContext.ts`
- Modify: `src/assets/main.scss`
- Create: `src/dimension/viewport/viewerBindings.ts`
- Create: `src/dimension/viewport/viewerBindings.test.ts`

**Interfaces:**
- Consumes: existing viewer lifecycle and disabled dev flag.
- Produces: a development-only Canvas overlay and context refs; production UI remains off.

- [ ] **Step 1: Add overlay markup**

Immediately after the WebGL canvas:

```vue
<canvas
  v-if="dimensionDevEnabled"
  ref="dimensionOverlayCanvas"
  class="dimension-viewport-overlay"
  aria-hidden="true"
/>
```

CSS:

```scss
.dimension-viewport-overlay {
  position: absolute;
  inset: 0;
  z-index: 905;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
```

- [ ] **Step 2: Bind resize/camera invalidation**

`handleResize` calls painter resize and `viewport.invalidate('size')` / `('dpr')`. `renderFrame` updates the `ThreeViewportProjector` and invalidates camera only when `cameraChanged`. Do not run layout directly in the main renderer call.

- [ ] **Step 3: Route pointer events**

In the existing main-canvas tool router, call the new controller only while a dev dimension command or a dimension hit is active. If it returns `consumed: true`, do not pass the same event to OrbitControls or other tools.

- [ ] **Step 4: Extend viewer context**

Add shallow refs:

```ts
dimensionDocument: ShallowRef<DimensionDocumentSession | null>;
dimensionViewport: ShallowRef<DimensionViewport | null>;
dimensionPointerController: ShallowRef<DimensionPointerController | null>;
```

- [ ] **Step 5: Dispose completely**

On unmount: cancel scheduled frames, detach listeners, clear Canvas, release references, and set context refs to null.

- [ ] **Step 6: Run viewer tests**

```powershell
npx vitest run `
  src/dimension/viewport/viewerBindings.test.ts `
  src/components/dock_panels/viewerToolbarSelection.test.ts
npm run type-check
```

Expected: PASS; dev flag false creates no Canvas.

---

### Task 6: Build the Accessible Semantic List

**Files:**
- Create: `src/dimension/ui/DimensionSemanticList.vue`
- Create: `src/dimension/ui/DimensionSemanticList.test.ts`
- Create: `src/dimension/ui/DimensionPanelDock.vue`
- Modify: `src/main.ts` to register `DimensionPanelDock` while the dock remains hidden unless a dimension flag is enabled

**Interfaces:**
- Consumes: document session, selection, format policy, bound action resolver.
- Produces: keyboard/reader-accessible dimension management.

- [ ] **Step 1: Define bound actions**

```ts
export type DimensionBoundAction =
  | 'select'
  | 'rebind'
  | 'delete'
  | 'flip-angle'
  | 'toggle-radial-display'
  | 'hide-external';

export function getDimensionBoundActions(
  item: UserDimensionRecord | ExternalDimensionRecord,
  user: { id: string; role: string } | null,
): readonly DimensionBoundAction[];
```

- [ ] **Step 2: Implement semantic list**

Requirements:
- root `role="listbox"`.
- each row `role="option"` and `aria-selected`.
- Up/Down move active option; Enter selects; Delete invokes only when bound.
- invalid row announces `STALE`; approximate row announces `近似`.
- external rows expose inspect and temporary hide only.
- no direct store mutations; all actions call injected callbacks.

- [ ] **Step 3: Test accessibility**

Use the repository's existing `createApp` + happy-dom component harness; do not add `@vue/test-utils`. Assert roles, keyboard navigation, permission-hidden actions, and shared selection callback.

- [ ] **Step 4: Run tests**

```powershell
npx vitest run src/dimension/ui/DimensionSemanticList.test.ts
```

Expected: PASS.

---

### Task 7: Add PNG Composition and SVG Overlay Export

**Files:**
- Create: `src/dimension/export/composePng.ts`
- Create: `src/dimension/export/composePng.test.ts`
- Create: `src/dimension/export/svgOverlay.ts`
- Create: `src/dimension/export/svgOverlay.test.ts`
- Modify: `src/composables/useScreenshot.ts`

**Interfaces:**
- Consumes: WebGL canvas, dimension Canvas, current layouts, font, export metadata.
- Produces: composed raster and deterministic SVG overlay.

- [ ] **Step 1: Implement composed canvas**

```ts
export function composeViewerCanvases(input: Readonly<{
  webgl: CanvasImageSource;
  dimensions?: CanvasImageSource | null;
  width: number;
  height: number;
  createCanvas: (width: number, height: number) => HTMLCanvasElement;
}>): HTMLCanvasElement;
```

Draw WebGL first and dimensions second. Preserve physical pixel size. If no dimension layer exists, output remains byte-equivalent in dimensions and format to the old screenshot path.

- [ ] **Step 2: Update screenshot composable**

`captureToBlob`, `captureToDataURL`, download, and upload all use the composed canvas when `viewerContext.dimensionViewport` is available.

- [ ] **Step 3: Implement SVG serializer**

```ts
export type DimensionExportMetadata = Readonly<{
  formatPolicy: DimensionFormatPolicy;
  viewport: { widthCssPx: number; heightCssPx: number; dpr: number };
  exportedAt: number;
}>;

export function layoutResultsToSvg(
  layouts: readonly LayoutResult[],
  font: LffFont,
  metadata: DimensionExportMetadata,
): string;
```

Emit `<line>` for line primitives and `<path>` for LFF glyph contours. Include metadata as escaped JSON in `<metadata>`. Never emit `<text>` with a platform font.

- [ ] **Step 4: Run export tests**

```powershell
npx vitest run src/dimension/export src/composables/useScreenshot.test.ts
```

Expected: PASS.

---

### Task 8: Add Development Demo and Browser Smoke Tests

**Files:**
- Create: `public/dimension-kernel-demo.html`
- Create: `src/debug/dimensionKernelDemo.ts`
- Create: `e2e/dimension-canvas-smoke.spec.ts`
- Create: `e2e/dimension-export-smoke.spec.ts`

**Interfaces:**
- Consumes: kernel, viewport, frozen canonical fixtures.
- Produces: backend-free browser verification.

- [ ] **Step 1: Expose a structured demo API**

```ts
declare global {
  interface Window {
    __dimensionDemo?: {
      ready: boolean;
      getLayouts(): readonly LayoutResult[];
      setState(id: string, state: InteractionState): void;
      exportSvg(): string;
      capturePng(): Promise<Blob>;
    };
  }
}
```

Render all four canonical dimensions at DPR 1 and 2 controls.

- [ ] **Step 2: Add structural Playwright assertions**

The smoke test checks:
- four ids exist.
- hover/selected/invalid change style roles.
- Canvas physical size equals CSS × DPR.
- SVG contains paths and metadata but no `<text>`.

- [ ] **Step 3: Add limited pixel snapshots**

Capture only:
- DPR 2 baseline.
- selected state.
- invalid `STALE` state.

Do not compare against SolveSpace screenshots.

- [ ] **Step 4: Run E2E**

```powershell
npx playwright test e2e/dimension-canvas-smoke.spec.ts e2e/dimension-export-smoke.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Close Gate 4**

Run:

```powershell
npx vitest run src/dimension/viewport src/dimension/interaction src/dimension/ui src/dimension/export
npm run type-check
npm run lint
```

Review checkpoint:
- dev flag off leaves production unchanged.
- static viewer does no dimension work.
- pointer moves do not write document commands.
- Canvas, list, PNG, and SVG share the same current layouts.
