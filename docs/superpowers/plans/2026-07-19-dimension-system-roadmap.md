# Dimension Annotation System Rebuild Roadmap

> **已于 2026-07-23 被取代：** 后续绘制底层工作统一执行 [`2026-07-23-solvespace-scene-dimension-renderer.md`](./2026-07-23-solvespace-scene-dimension-renderer.md)。本文保留为已完成领域/持久化工作的历史记录，不得继续执行其中的屏幕 `LayoutResult`、Canvas2D viewport 或 Canvas 切换任务。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the legacy dimension subsystem without breaking unrelated viewer features, then deliver a framework-neutral, testable dimension document/layout/viewport system and cut it over only after all four first-release dimension types satisfy persistence, accessibility, export, and performance gates.

**Architecture:** A `DimensionDocument` owns editable user-dimension state and intent commands. A framework-neutral kernel converts normalized Design Space inputs into screen-space `LayoutResult` primitives; each `DimensionViewport` performs bounded collision resolution, hit indexing, and one Canvas2D paint pass. Viewer, review, DTX/Xeokit, MBD, persistence, and export behavior enter through explicit adapters and ports.

**Tech Stack:** Vue 3, TypeScript 5.9, Canvas2D, Three.js camera adapter only, Vitest, Playwright, SurrealDB-backed Rust review API, SolveSpace LFF font and layout semantics.

## Global Constraints

- The accepted domain language is `CONTEXT.md`; architectural decisions are `docs/adr/0001` through `0040`.
- Delete the legacy dimension subsystem in a build-green milestone before adding the new runtime implementation.
- Preserve non-executable V5 data/golden fixtures and archive browser V5 dimensions before any V6 tool-store write.
- New runtime code lives only under `src/dimension/` and must not import legacy dimension renderers, stores, panels, or adapters.
- Do not delete shared measurement/annotation infrastructure: `LinearDimension`, `AlignedDimension`, `AngleDimension`, `AnnotationBase`, `AnnotationMaterials`, `AnnotationInteractionController`, Xeokit measurements, weld, slope, and leader annotations remain until separately migrated.
- Persisted geometry uses Design Space metres/radians; viewer recenter, Three world transforms, camera state, and pixel offsets never enter `DimensionDocument`.
- First release supports `linear`, `projected`, `angular`, and `radial` only.
- All dimensions render in front through one DPR-aware Canvas2D overlay per viewport.
- Layout, hit testing, SVG export, and Canvas painting consume the same `LayoutResult`.
- User dimensions are author/admin editable and persist with review records. External dimensions are read-only and never enter the user document.
- Display units and precision are viewport/user preferences; export metadata records the active format policy.
- Target: 10,000 loaded and 2,000 visible dimensions at 1920×1080 DPR 2, 60 FPS, update p95 ≤ 16 ms, hit-test p95 ≤ 2 ms.
- Existing full Vitest has unrelated known failures. Every phase must record baseline versus after and introduce zero new failures; targeted dimension and non-dimension guard suites must pass.
- The current workspace is a Git repository with substantial unrelated uncommitted work. Preserve those changes and do not create commits unless the user explicitly requests one; each task ends with a review checkpoint.

---

## Plan Set and Dependency Graph

```text
01 Legacy removal
   │
   ├──────────────┐
   ▼              ▼
02 Layout kernel  03 Document & persistence
   │              │
   └──────┬───────┘
          ▼
04 Viewport, interaction & export
          │
          ▼
05 Integration, performance & cutover
```

1. [`2026-07-19-dimension-system-01-legacy-removal.md`](./2026-07-19-dimension-system-01-legacy-removal.md)
2. [`2026-07-19-dimension-system-02-layout-kernel.md`](./2026-07-19-dimension-system-02-layout-kernel.md)
3. [`2026-07-19-dimension-system-03-document-persistence.md`](./2026-07-19-dimension-system-03-document-persistence.md)
4. [`2026-07-19-dimension-system-04-viewport-interaction-export.md`](./2026-07-19-dimension-system-04-viewport-interaction-export.md)
5. [`2026-07-19-dimension-system-05-integration-cutover.md`](./2026-07-19-dimension-system-05-integration-cutover.md)

Plans 02 and 03 may execute in parallel after Plan 01. Plan 04 consumes the public interfaces from both. Plan 05 is the only plan allowed to enable production UI.

Current execution:

- Gate 1 complete: [remove legacy dimension runtime and preserve archives](https://github.com/happyrust/plant3d-web/issues/50).
- Gate 2 in progress: [implement pure SolveSpace layout kernel](https://github.com/happyrust/plant3d-web/issues/51).
- Gate 3 foundation in progress: [implement document domain and recovery journal](https://github.com/happyrust/plant3d-web/issues/52).

---

## Canonical Cross-Plan Interfaces

All plans use these names. A task may add fields only by updating this roadmap and every downstream interface block first.

```ts
// src/dimension/domain/types.ts
export type Vec2 = Readonly<{ x: number; y: number }>;
export type Vec3 = readonly [number, number, number];
export type DimensionKind = 'linear' | 'projected' | 'angular' | 'radial';
export type DimensionAccuracy = 'exact' | 'approximate';
export type DimensionValidity = 'valid' | 'invalid';
export type DimensionArcChoice = 'minor' | 'major';
export type RadialDisplay = 'radius' | 'diameter';

export type SemanticAnchorRef = Readonly<{
  source: 'p-point' | 'instance-origin' | 'primitive-key-point' | 'model-surface' | 'circle' | 'arc' | 'direction';
  refno?: string;
  candidateId?: string;
}>;

export type DimensionAnchor = Readonly<{
  snapshot: Vec3 | null;
  accuracy: DimensionAccuracy;
  semanticRef?: SemanticAnchorRef;
}>;

export type ProjectionAxisRef =
  | Readonly<{ kind: 'design-axis'; axis: 'x' | 'y' | 'z' }>
  | Readonly<{ kind: 'semantic-direction'; snapshot: Vec3; semanticRef: SemanticAnchorRef }>;

export type LinearPlacementIntent = Readonly<{
  offsetM: number;
  labelT: number;
  side: 1 | -1;
}>;

export type AngularPlacementIntent = Readonly<{
  radiusM?: number;
  labelT: number;
  arcChoice: DimensionArcChoice;
}>;

export type RadialPlacementIntent = Readonly<{
  leaderDirection: Vec3;
  labelDistanceM: number;
}>;

export type UserDimensionRecord =
  | Readonly<{ id: string; kind: 'linear'; a: DimensionAnchor; b: DimensionAnchor; placement: LinearPlacementIntent; authorId: string; authorRole: string; createdAt: number; updatedAt: number; validity: DimensionValidity }>
  | Readonly<{ id: string; kind: 'projected'; a: DimensionAnchor; b: DimensionAnchor; axis: ProjectionAxisRef; placement: LinearPlacementIntent; authorId: string; authorRole: string; createdAt: number; updatedAt: number; validity: DimensionValidity }>
  | Readonly<{ id: string; kind: 'angular'; vertex: DimensionAnchor; rayA: DimensionAnchor; rayB: DimensionAnchor; placement: AngularPlacementIntent; authorId: string; authorRole: string; createdAt: number; updatedAt: number; validity: DimensionValidity }>
  | Readonly<{ id: string; kind: 'radial'; center: DimensionAnchor; rim: DimensionAnchor; normal: ProjectionAxisRef; display: RadialDisplay; placement: RadialPlacementIntent; authorId: string; authorRole: string; createdAt: number; updatedAt: number; validity: DimensionValidity }>;
```

```ts
// src/dimension/domain/document.ts
export type DimensionDocumentState = Readonly<{
  schemaVersion: 1;
  documentId: string;
  taskId?: string;
  formId?: string;
  baseVersion: number;
  records: readonly UserDimensionRecord[];
}>;

export type DimensionCommandIntent =
  | Readonly<{ type: 'create'; record: UserDimensionRecord }>
  | Readonly<{ type: 'delete'; dimensionId: string }>
  | Readonly<{ type: 'replace-placement'; dimensionId: string; placement: LinearPlacementIntent | AngularPlacementIntent | RadialPlacementIntent }>
  | Readonly<{ type: 'set-angle-arc'; dimensionId: string; arcChoice: DimensionArcChoice }>
  | Readonly<{ type: 'set-radial-display'; dimensionId: string; display: RadialDisplay }>
  | Readonly<{ type: 'rebind-anchor'; dimensionId: string; anchorSlot: string; anchor: DimensionAnchor }>;

export type DimensionCommand = Readonly<{
  commandId: string;
  actorId: string;
  actorRole: string;
  at: number;
}> & DimensionCommandIntent;
```

```ts
// src/dimension/kernel/types.ts
export type InteractionState = 'normal' | 'hovered' | 'selected';
export type DimensionSemanticRole = 'normal' | 'external' | 'external-reference' | 'invalid' | 'approximate';

export type ScreenLine = Readonly<{
  kind: 'line';
  from: Vec2;
  to: Vec2;
  part: 'dimension' | 'extension' | 'projection' | 'leader' | 'arc' | 'arrow';
  styleRole: string;
}>;

export type ScreenGlyphRun = Readonly<{
  kind: 'glyph-run';
  text: string;
  origin: Vec2;
  capHeightPx: number;
  bounds: Readonly<{ x: number; y: number; width: number; height: number }>;
  styleRole: string;
}>;

export type LayoutPrimitive = ScreenLine | ScreenGlyphRun;
export type HitRegion =
  | Readonly<{ kind: 'segment'; from: Vec2; to: Vec2; widthPx: number; part: string }>
  | Readonly<{ kind: 'rect'; rect: Readonly<{ x: number; y: number; width: number; height: number }>; part: string }>;

export type LayoutResult = Readonly<{
  dimensionId: string;
  primitives: readonly LayoutPrimitive[];
  hitRegions: readonly HitRegion[];
  labelBounds: Readonly<{ x: number; y: number; width: number; height: number }>;
  labelPinned: boolean;
  derived: Readonly<{ valueM?: number; valueRad?: number; formattedLabel: string }>;
}>;

export type ExternalDimensionRecord = Readonly<{
  id: string;
  source: 'bran-clearance' | 'mbd';
  sourceLabel: string;
  role: 'external' | 'external-reference';
  layout: NormalizedDimensionInput | ExplicitLayoutInput;
}>;
```

```ts
// src/dimension/kernel/projector.ts
export interface ViewportProjector {
  readonly widthCssPx: number;
  readonly heightCssPx: number;
  readonly dpr: number;
  readonly right: Vec3;
  readonly up: Vec3;
  readonly forward: Vec3;
  project(point: Vec3): Readonly<{ x: number; y: number; depth: number }>;
  unproject(point: Readonly<{ x: number; y: number; depth: number }>): Vec3;
  worldPerPixelAt(point: Vec3): number;
}
```

```ts
// src/dimension/ports/snapPort.ts
export type SnapCapability = 'point' | 'direction' | 'circle' | 'arc';
export type SnapCandidate = Readonly<{
  id: string;
  capability: SnapCapability;
  anchor: DimensionAnchor;
  direction?: Vec3;
  normal?: Vec3;
  label: string;
  distancePx: number;
}>;

export interface DimensionSnapPort {
  query(input: Readonly<{
    screen: Vec2;
    capabilities: readonly SnapCapability[];
    thresholdPx: number;
  }>): readonly SnapCandidate[];
}
```

```ts
// src/dimension/ports/repository.ts
export type SaveDimensionDocumentResult =
  | Readonly<{ ok: true; state: DimensionDocumentState }>
  | Readonly<{ ok: false; reason: 'conflict'; latest: DimensionDocumentState }>
  | Readonly<{ ok: false; reason: 'network' | 'forbidden' | 'invalid'; message: string }>;

export interface DimensionDocumentRepository {
  load(context: Readonly<{ taskId?: string; formId?: string }>): Promise<DimensionDocumentState>;
  save(state: DimensionDocumentState): Promise<SaveDimensionDocumentResult>;
}
```

---

## Phase Gates

### Gate 1 — Legacy removed

- Frozen fixtures and browser V5 archive exist.
- No production imports of `LinearDimension3D`, `AngleDimension3D`, `useDimensionAnnotation`, `DimensionPanel`, or `dimension_linear`.
- Measurement, annotation, review, build, and targeted non-dimension tests show zero new failures.

### Gate 2 — Kernel complete

- Four layouts match structural goldens.
- LFF glyph paths and bounds are deterministic.
- Explicit-layout inputs normalize to the same `LayoutResult`.
- Collision pass and hit index meet deterministic unit tests.

### Gate 3 — Document complete

- Command reducer, permissions, undo/redo, local journal, V5 migration, invalid anchors, review snapshot round-trip, and optimistic conflicts are covered.
- Backend `review_records` transports `dimensionDocument` and atomically checks `dimensionDocumentVersion`.

### Gate 4 — Viewport complete

- One Canvas2D overlay, invalidation scheduling, pointer edit sessions, shared selection, accessible list, PNG composition, and SVG overlay pass unit/E2E tests.

### Gate 5 — Production cutover

- Four dimension types work through real SnapPort and review flows.
- External MBD/BRAN dimensions are read-only.
- 10,000-loaded/2,000-visible benchmark meets ADR-0040.
- Production entry remains off until the complete acceptance checklist passes.

---

## ADR Coverage Check

- Plan 01: ADR-0001, 0022, 0038.
- Plan 02: ADR-0003, 0004, 0007, 0008, 0012, 0013, 0014, 0015, 0016, 0023, 0024, 0032, 0035, 0036, 0037, 0040. ADR-0018 is superseded.
- Plan 03: ADR-0005, 0006, 0019, 0020, 0021, 0027, 0033, 0034.
- Plan 04: ADR-0002, 0009, 0010, 0011, 0017, 0026, 0028, 0029, 0030, 0031.
- Plan 05: cross-plan integration and ADR-0039 production cutover.

Every accepted ADR appears in at least one executable plan.

---

## Execution Rule

Do not start a downstream plan because an upstream task “mostly works.” Every plan ends in a named gate, and the next plan consumes only the interfaces and artifacts listed in that gate. Any interface change requires updating this roadmap first.
