# Dimension Layout Kernel Implementation Plan

> **输出契约已被取代：** 数值、格式化、LFF 和已验证布局规则继续复用；屏幕空间权威 `LayoutResult` 改由 [`2026-07-23-solvespace-scene-dimension-renderer.md`](./2026-07-23-solvespace-scene-dimension-renderer.md) 的三维布局结果取代。

> **Status:** Gate 2 implemented and verified on 2026-07-19. All kernel tests, dependency scan, type-check, scoped lint, build, and the isolated ADR 0040 benchmark pass.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a framework-neutral kernel that formats and lays out linear, projected, angular, and radial dimensions into deterministic screen-space primitives with shared collision and hit-test geometry.

**Architecture:** Plain TypeScript math consumes normalized Design Space inputs and a `ViewportProjector`. Each dimension type is a pure layout function; an explicit-layout adapter produces the same `LayoutResult`. LFF glyph paths supply both metrics and rendering geometry. No Vue, Three.js, DOM, Canvas, store, or review dependency is allowed.

**Tech Stack:** TypeScript, Vitest, SolveSpace `drawconstraint.cpp` semantics, SolveSpace LFF font asset.

## Global Constraints

- Plan 01 Gate 1 must be complete.
- Runtime files live under `src/dimension/kernel/`.
- `src/dimension/kernel/**` must not import `vue`, `three`, `@/composables`, legacy annotation modules, Canvas/DOM globals, or review APIs.
- All geometry inputs are Design Space metres; angles are radians.
- All output coordinates are CSS pixels for one viewport.
- SolveSpace revision is pinned to `9aeb715efd8c274851af0fdad5b275dde1198bf5`.
- Default constants: arrow 13 px, half-angle 18°, extension overshoot 10 px, label padding 8 px, outside extension 18 px, minimum angular radius 15 px.
- Structural goldens, not screenshots, are the correctness oracle.

---

## File Structure

```text
src/dimension/kernel/
├── index.ts
├── types.ts
├── vec.ts
├── projector.ts
├── value.ts
├── format.ts
├── theme.ts
├── glyph/
│   ├── lffParser.ts
│   ├── lffParser.test.ts
│   └── glyphTrace.ts
├── geometry/
│   ├── trimLineAgainstRect.ts
│   ├── trimLineAgainstRect.test.ts
│   ├── arrow.ts
│   └── screenGeometry.ts
├── layout/
│   ├── context.ts
│   ├── linear.ts
│   ├── projected.ts
│   ├── angular.ts
│   ├── radial.ts
│   ├── explicit.ts
│   ├── layoutDimension.ts
│   └── *.test.ts
├── collision/
│   ├── resolveLabelCollisions.ts
│   └── resolveLabelCollisions.test.ts
├── hit/
│   ├── hitIndex.ts
│   ├── hitIndex.test.ts
│   └── hitTest.ts
└── viewport/
    ├── layoutViewport.ts
    └── layoutViewport.test.ts
public/fonts/unicode.lff.gz
THIRD_PARTY_NOTICES.md
```

---

### Task 1: Establish Pure Kernel Types, Vector Math, and Projector Contract

**Files:**
- Create: `src/dimension/kernel/types.ts`
- Create: `src/dimension/kernel/vec.ts`
- Create: `src/dimension/kernel/projector.ts`
- Create: `src/dimension/kernel/index.ts`
- Create: `src/dimension/kernel/vec.test.ts`

**Interfaces:**
- Consumes: plain Design Space tuples and a projector supplied later by Plan 04.
- Produces: canonical `NormalizedDimensionInput`, `LayoutResult`, and math used by every kernel task.

- [ ] **Step 1: Write vector tests**

```ts
import { describe, expect, it } from 'vitest';
import { add3, cross3, dot3, length3, normalize3, scale3, sub3 } from './vec';

describe('kernel vec3', () => {
  it('normalizes and preserves perpendicular cross products', () => {
    expect(normalize3([3, 0, 0])).toEqual([1, 0, 0]);
    expect(cross3([1, 0, 0], [0, 1, 0])).toEqual([0, 0, 1]);
    expect(dot3(cross3([1, 0, 0], [0, 1, 0]), [1, 0, 0])).toBe(0);
  });

  it('supports immutable tuple arithmetic', () => {
    expect(add3([1, 2, 3], scale3(sub3([4, 2, 3], [1, 2, 3]), 0.5))).toEqual([2.5, 2, 3]);
    expect(length3([0, 3, 4])).toBe(5);
  });
});
```

- [ ] **Step 2: Run tests and verify failure**

```powershell
npx vitest run src/dimension/kernel/vec.test.ts
```

Expected: FAIL because files do not exist.

- [ ] **Step 3: Define the canonical kernel types**

`types.ts` must contain the roadmap `Vec2`, `Vec3`, primitives, hit regions, and `LayoutResult`, plus:

```ts
export type NormalizedDimensionBase = Readonly<{
  id: string;
  role: 'normal' | 'external' | 'external-reference' | 'invalid' | 'approximate';
  labelPinned: boolean;
  authoritativeText?: string;
}>;

export type NormalizedDimensionInput =
  | (NormalizedDimensionBase & Readonly<{
      kind: 'linear';
      a: Vec3;
      b: Vec3;
      placement: { offsetM: number; labelT: number; side: 1 | -1 };
    }>)
  | (NormalizedDimensionBase & Readonly<{
      kind: 'projected';
      a: Vec3;
      b: Vec3;
      axis: Vec3;
      placement: { offsetM: number; labelT: number; side: 1 | -1 };
    }>)
  | (NormalizedDimensionBase & Readonly<{
      kind: 'angular';
      vertex: Vec3;
      rayA: Vec3;
      rayB: Vec3;
      placement: { radiusM?: number; labelT: number; arcChoice: 'minor' | 'major' };
    }>)
  | (NormalizedDimensionBase & Readonly<{
      kind: 'radial';
      center: Vec3;
      rim: Vec3;
      normal: Vec3;
      display: 'radius' | 'diameter';
      placement: { leaderDirection: Vec3; labelDistanceM: number };
    }>);

export type ExplicitLayoutInput = Readonly<{
  id: string;
  role: NormalizedDimensionBase['role'];
  labelPinned: true;
  formattedLabel: string;
  lines: readonly Readonly<{ from: Vec3; to: Vec3; part: ScreenLine['part'] }>[];
  labelAnchor: Vec3;
  arrowLines: readonly Readonly<{ from: Vec3; to: Vec3 }>[];
}>;
```

- [ ] **Step 4: Implement immutable vector functions**

`vec.ts` exports:

```ts
export const EPSILON = 1e-9;
export function add3(a: Vec3, b: Vec3): Vec3;
export function sub3(a: Vec3, b: Vec3): Vec3;
export function scale3(a: Vec3, scalar: number): Vec3;
export function dot3(a: Vec3, b: Vec3): number;
export function cross3(a: Vec3, b: Vec3): Vec3;
export function length3(a: Vec3): number;
export function normalize3(a: Vec3): Vec3;
export function lerp3(a: Vec3, b: Vec3, t: number): Vec3;
export function clamp(value: number, min: number, max: number): number;
```

`normalize3` throws `RangeError('Cannot normalize a zero-length vector')` when length ≤ `EPSILON`; callers must explicitly handle degenerate dimensions.

- [ ] **Step 5: Define the projector**

```ts
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

export function alignToPixelGrid(point: Vec3, projector: ViewportProjector): Vec3 {
  const screen = projector.project(point);
  return projector.unproject({
    x: Math.round(screen.x),
    y: Math.round(screen.y),
    depth: screen.depth,
  });
}
```

- [ ] **Step 6: Run tests**

```powershell
npx vitest run src/dimension/kernel/vec.test.ts
npm run type-check
```

Expected: PASS.

---

### Task 2: Vendor and Reimplement Deterministic LFF Glyphs

**Files:**
- Create: `public/fonts/unicode.lff.gz`
- Create: `THIRD_PARTY_NOTICES.md`
- Create: `src/dimension/kernel/glyph/lffParser.ts`
- Create: `src/dimension/kernel/glyph/lffParser.test.ts`
- Create: `src/dimension/kernel/glyph/glyphTrace.ts`

**Interfaces:**
- Consumes: gzipped SolveSpace LFF bytes or LFF text.
- Produces: deterministic glyph contours, metrics, and transformed line segments.

- [ ] **Step 1: Vendor the pinned asset**

Run from PowerShell:

```powershell
Invoke-WebRequest `
  -Uri "https://raw.githubusercontent.com/solvespace/solvespace/9aeb715efd8c274851af0fdad5b275dde1198bf5/res/fonts/unicode.lff.gz" `
  -OutFile "public/fonts/unicode.lff.gz"
```

Record the source revision and GPLv3 provenance in `THIRD_PARTY_NOTICES.md`. Do not use an unpinned `master` URL.

- [ ] **Step 2: Write parser and metric tests**

Use a tiny inline LFF fixture containing `A`, `h`, `p`, space, digits, `R`, `E`, `F`, `°`, and `⌀`. Tests must assert:
- CRLF normalization.
- header `letterspacing` and `wordspacing`.
- lazy codepoint parsing.
- bulge arcs expand to deterministic segments.
- cap height comes from `A`, ascender from `h`, descender from `p`.
- unsupported codepoint returns the replacement glyph, not platform text.

- [ ] **Step 3: Implement the parser without legacy imports**

```ts
export type GlyphContour = Readonly<{ points: readonly Vec2[] }>;
export type Glyph = Readonly<{
  contours: readonly GlyphContour[];
  leftSideBearing: number;
  boundingWidth: number;
  advanceWidth: number;
}>;

export type GlyphSegment = Readonly<{ from: Vec2; to: Vec2 }>;

export class LffFont {
  static fromText(text: string): LffFont;
  getGlyph(codePoint: number): Glyph;
  getWidth(capHeightPx: number, text: string): number;
  getHeight(capHeightPx: number): number;
  trace(capHeightPx: number, text: string, origin: Vec2): readonly GlyphSegment[];
}
```

Port the numeric lexer and bulge expansion semantics from SolveSpace `src/resource.cpp:762-951`, using eight line subdivisions per bulge arc to match the pinned baseline. Do not import the legacy `SolveSpaceVectorFont`.

- [ ] **Step 4: Implement deterministic glyph-run tracing**

```ts
export function traceGlyphRun(
  font: LffFont,
  input: Readonly<{ text: string; capHeightPx: number; origin: Vec2 }>,
): readonly GlyphSegment[] {
  return font.trace(input.capHeightPx, input.text, input.origin);
}
```

The kernel accepts an already parsed `LffFont`. Browser fetching and gzip decoding belong to Plan 04's viewport adapter.

- [ ] **Step 5: Run glyph tests**

```powershell
npx vitest run src/dimension/kernel/glyph/lffParser.test.ts
```

Expected: PASS with no import from `src/utils/three/annotation/text`.

---

### Task 3: Derive Values, Format Labels, and Resolve Theme Roles

**Files:**
- Create: `src/dimension/kernel/value.ts`
- Create: `src/dimension/kernel/value.test.ts`
- Create: `src/dimension/kernel/format.ts`
- Create: `src/dimension/kernel/format.test.ts`
- Create: `src/dimension/kernel/theme.ts`
- Create: `src/dimension/kernel/theme.test.ts`
- Create: `src/dimension/kernel/layout/context.ts`

**Interfaces:**
- Consumes: normalized geometry, semantic role, interaction state, viewport format preference.
- Produces: canonical metres/radians and concrete style tokens.

- [ ] **Step 1: Write value tests**

Cover:
- linear Euclidean distance.
- projected absolute dot product.
- angular minor/major.
- radial radius/diameter.
- degenerate vectors return a discriminated error.

```ts
expect(deriveDimensionValue(projectedCase)).toEqual({ ok: true, valueM: 1 });
expect(deriveDimensionValue(majorRightAngleCase)).toEqual({
  ok: true,
  valueRad: (3 * Math.PI) / 2,
});
```

- [ ] **Step 2: Implement `deriveDimensionValue`**

```ts
export type DerivedDimensionValue =
  | Readonly<{ ok: true; valueM: number; valueRad?: never }>
  | Readonly<{ ok: true; valueRad: number; valueM?: never }>
  | Readonly<{ ok: false; reason: 'degenerate' | 'invalid-axis' }>;

export function deriveDimensionValue(input: NormalizedDimensionInput): DerivedDimensionValue;
```

Projected values use `Math.abs(dot3(sub3(b, a), normalize3(axis)))`. User dimensions never generate a sign.

- [ ] **Step 3: Define format policy**

```ts
export type DimensionFormatPolicy = Readonly<{
  lengthUnit: 'm' | 'cm' | 'mm';
  lengthDecimals: number;
  angleDecimals: number;
  approximatePrefix: string;
  stalePrefix: string;
}>;

export const DEFAULT_DIMENSION_FORMAT: DimensionFormatPolicy = {
  lengthUnit: 'mm',
  lengthDecimals: 2,
  angleDecimals: 2,
  approximatePrefix: '~',
  stalePrefix: 'STALE ',
};
```

Define:

```ts
export type FormatDimensionLabelResult =
  | Readonly<{ ok: true; text: string }>
  | Readonly<{ ok: false; reason: 'authoritative-text-for-user-dimension' | 'invalid-value' }>;

export function formatDimensionLabel(
  input: NormalizedDimensionInput,
  value: DerivedDimensionValue,
  policy: DimensionFormatPolicy,
): FormatDimensionLabelResult;
```

The function applies `R`, `⌀`, `°`, external `REF`, approximate, and invalid semantics. An `authoritativeText` is accepted only when role is `external` or `external-reference`; every other combination returns `{ ok: false, reason: 'authoritative-text-for-user-dimension' }`.

- [ ] **Step 4: Define one theme**

```ts
export type DimensionTheme = Readonly<{
  textHeightPx: number;
  arrowLengthPx: number;
  arrowHalfAngleDeg: number;
  extensionOvershootPx: number;
  labelPaddingPx: number;
  outsideExtensionPx: number;
  minArcRadiusPx: number;
  lineWidthPx: number;
  colors: Readonly<Record<'normal' | 'hovered' | 'selected' | 'invalid' | 'approximate' | 'external' | 'external-reference', string>>;
}>;

export const SOLVESPACE_DIMENSION_THEME: DimensionTheme = {
  textHeightPx: 11.5,
  arrowLengthPx: 13,
  arrowHalfAngleDeg: 18,
  extensionOvershootPx: 10,
  labelPaddingPx: 8,
  outsideExtensionPx: 18,
  minArcRadiusPx: 15,
  lineWidthPx: 1,
  colors: {
    normal: '#ff1aff',
    hovered: '#ffff00',
    selected: '#ff0000',
    invalid: '#f59e0b',
    approximate: '#f472b6',
    external: '#ff1aff',
    'external-reference': '#ff1aff',
  },
};
```

- [ ] **Step 5: Define the shared layout context**

```ts
export type LayoutContext = Readonly<{
  projector: ViewportProjector;
  font: LffFont;
  theme: DimensionTheme;
  format: DimensionFormatPolicy;
  interaction: InteractionState;
}>;
```

- [ ] **Step 6: Run tests**

```powershell
npx vitest run `
  src/dimension/kernel/value.test.ts `
  src/dimension/kernel/format.test.ts `
  src/dimension/kernel/theme.test.ts
```

Expected: PASS.

---

### Task 4: Port Shared Screen Geometry

**Files:**
- Create: `src/dimension/kernel/geometry/trimLineAgainstRect.ts`
- Create: `src/dimension/kernel/geometry/trimLineAgainstRect.test.ts`
- Create: `src/dimension/kernel/geometry/arrow.ts`
- Create: `src/dimension/kernel/geometry/arrow.test.ts`
- Create: `src/dimension/kernel/geometry/screenGeometry.ts`

**Interfaces:**
- Consumes: CSS-pixel points and rectangles.
- Produces: trimmed segments and V-arrow line pairs.

- [ ] **Step 1: Copy frozen trim cases into failing tests**

Cover:
- line crosses label rectangle → two segments.
- one endpoint under label → one segment.
- label outside segment with `extend=true` → extended segment and `outsideSide`.
- entire line inside label → no segments.

- [ ] **Step 2: Implement rectangle trimming**

```ts
export type TrimResult = Readonly<{
  segments: readonly Readonly<{ from: Vec2; to: Vec2 }>[];
  outsideSide: -1 | 0 | 1;
}>;

export function trimLineAgainstRect(
  from: Vec2,
  to: Vec2,
  rect: Readonly<{ x: number; y: number; width: number; height: number }>,
  extend: boolean,
): TrimResult;
```

Use parametric line/rectangle-plane intersections matching SolveSpace `DoLineTrimmedAgainstBox`, not Canvas clipping.

- [ ] **Step 3: Implement V arrows**

```ts
export function makeOpenArrow(
  tip: Vec2,
  inwardDirection: Vec2,
  lengthPx: number,
  halfAngleDeg: number,
  styleRole: string,
): readonly [ScreenLine, ScreenLine];
```

Normalize the direction; each leg length is `lengthPx / cos(halfAngle)`. Both returned lines use `part: 'arrow'` and the supplied `styleRole`.

- [ ] **Step 4: Run shared geometry tests**

```powershell
npx vitest run src/dimension/kernel/geometry
```

Expected: PASS.

---

### Task 5: Implement Linear and Projected Layouts

**Files:**
- Create: `src/dimension/kernel/layout/linear.ts`
- Create: `src/dimension/kernel/layout/linear.test.ts`
- Create: `src/dimension/kernel/layout/projected.ts`
- Create: `src/dimension/kernel/layout/projected.test.ts`

**Interfaces:**
- Consumes: normalized linear/projected input, projector, font, theme, format, interaction.
- Produces: complete `LayoutResult`.

- [ ] **Step 1: Write structural golden tests**

Assert exact primitives for:
- 1 m horizontal linear dimension, centered label.
- label outside endpoint reverses arrows and adds 18 px outside segment.
- projected X-axis dimension adds two projection lines and uses absolute value.
- invalid and approximate labels/styles.

- [ ] **Step 2: Implement linear layout from SolveSpace semantics**

```ts
export function layoutLinear(
  input: Extract<NormalizedDimensionInput, { kind: 'linear' }>,
  context: LayoutContext,
): LayoutResult;
```

Algorithm:
1. Project anchors.
2. Build a screen-space normal from anchor line and projected placement side.
3. Offset dimension line by `offsetM / worldPerPixelAt(midpoint)`.
4. Extend witness lines 10 px beyond arrow tips.
5. Measure LFF label and add 8 px bounds padding.
6. Trim/extend dimension line against label bounds.
7. Reverse arrows and add an 18 px outside segment when label lies outside.
8. Emit matching line/text hit regions.

- [ ] **Step 3: Implement projected layout**

```ts
export function layoutProjected(
  input: Extract<NormalizedDimensionInput, { kind: 'projected' }>,
  context: LayoutContext,
): LayoutResult;
```

Project `b - a` onto the normalized Design Space axis, draw projection helper lines with the `projection` part role, and reuse the same linear dimension-line helper.

- [ ] **Step 4: Run tests**

```powershell
npx vitest run `
  src/dimension/kernel/layout/linear.test.ts `
  src/dimension/kernel/layout/projected.test.ts
```

Expected: PASS and goldens contain no floating values outside an agreed `1e-6` normalization.

---

### Task 6: Implement Angular and Radial Layouts

**Files:**
- Create: `src/dimension/kernel/layout/angular.ts`
- Create: `src/dimension/kernel/layout/angular.test.ts`
- Create: `src/dimension/kernel/layout/radial.ts`
- Create: `src/dimension/kernel/layout/radial.test.ts`

**Interfaces:**
- Produces: `LayoutResult` for the remaining first-release types.

- [ ] **Step 1: Write angular goldens**

Cover:
- 90° minor and 270° major.
- minimum 15 px radius.
- label trimming through the arc.
- outside label extends arc and reverses arrow direction.
- degenerate rays produce no trusted numeric layout.

- [ ] **Step 2: Implement `layoutAngular`**

Port SolveSpace `DoArcForAngle` semantics from `drawconstraint.cpp:294-451`:
- intersect/project rays into the annotation plane.
- choose minor/major sweep from `arcChoice`.
- enforce minimum radius 15 px.
- extend rays 5 px beyond the arc.
- segment the arc deterministically by a maximum 4° step.
- trim each arc segment against the label rectangle.
- use 13 px / 18° open arrows.

- [ ] **Step 3: Write radial goldens**

Cover:
- identical geometry with `R` and `⌀` formatting.
- leader constrained to circle plane.
- leader trimmed against label bounds.
- external authoritative label.

- [ ] **Step 4: Implement `layoutRadial`**

Port SolveSpace `DIAMETER` semantics from `drawconstraint.cpp:715-734`. Compute radius from center/rim, project the placement direction into the supplied circle plane, and never trust a stored numeric radius.

- [ ] **Step 5: Run tests**

```powershell
npx vitest run `
  src/dimension/kernel/layout/angular.test.ts `
  src/dimension/kernel/layout/radial.test.ts
```

Expected: PASS.

---

### Task 7: Normalize Explicit Layouts and Add the Dispatcher

**Files:**
- Create: `src/dimension/kernel/layout/explicit.ts`
- Create: `src/dimension/kernel/layout/explicit.test.ts`
- Create: `src/dimension/kernel/layout/layoutDimension.ts`
- Create: `src/dimension/kernel/layout/layoutDimension.test.ts`

**Interfaces:**
- Consumes: `NormalizedDimensionInput | ExplicitLayoutInput`.
- Produces: one `LayoutResult` shape regardless of source.

- [ ] **Step 1: Write explicit-layout tests**

Assert that explicit MBD lines, arrows, and label anchors:
- are projected once.
- receive LFF bounds and hit regions.
- remain `labelPinned: true`.
- do not bypass theme or interaction colors.

- [ ] **Step 2: Implement the dispatcher**

```ts
export function layoutDimension(
  input: NormalizedDimensionInput | ExplicitLayoutInput,
  context: LayoutContext,
): LayoutResult {
  if ('lines' in input) return layoutExplicit(input, context);
  switch (input.kind) {
    case 'linear': return layoutLinear(input, context);
    case 'projected': return layoutProjected(input, context);
    case 'angular': return layoutAngular(input, context);
    case 'radial': return layoutRadial(input, context);
  }
}
```

- [ ] **Step 3: Run dispatcher tests**

```powershell
npx vitest run src/dimension/kernel/layout
```

Expected: PASS.

---

### Task 8: Add Deterministic Collision Resolution and Hit Index

**Files:**
- Create: `src/dimension/kernel/collision/resolveLabelCollisions.ts`
- Create: `src/dimension/kernel/collision/resolveLabelCollisions.test.ts`
- Create: `src/dimension/kernel/hit/hitIndex.ts`
- Create: `src/dimension/kernel/hit/hitIndex.test.ts`
- Create: `src/dimension/kernel/hit/hitTest.ts`

**Interfaces:**
- Consumes: viewport-specific `LayoutResult[]`.
- Produces: adjusted results and screen-space hit queries.

- [ ] **Step 1: Write collision tests**

Assert:
- pinned labels never move.
- automatic labels move using a stable dimension-id sort.
- candidate order is `[up, right, down, left]` in 8 px increments up to 64 px.
- the pass terminates after eight candidates per label.
- repeated calls are byte-identical.

- [ ] **Step 2: Implement the bounded pass**

```ts
export function resolveLabelCollisions(
  inputs: readonly LayoutResult[],
): readonly LayoutResult[];
```

Only move glyph runs and their connecting label segment. Do not move witness lines, arrows, or explicit/pinned labels. Return new immutable objects.

- [ ] **Step 3: Write hit-index tests**

Cover segment distance, text rectangle, z/part priority, tolerance, empty cells, and 2,000-result bulk insertion.

- [ ] **Step 4: Implement a uniform screen grid**

```ts
export type HitTarget = Readonly<{
  dimensionId: string;
  part: string;
  distancePx: number;
}>;

export interface HitIndex {
  hitTest(point: Vec2, tolerancePx: number): HitTarget | null;
}

export function buildHitIndex(
  layouts: readonly LayoutResult[],
  cellSizePx = 64,
): HitIndex;
```

Insert each region into every overlapping cell. Query only the pointer cell and its tolerance-expanded neighbors. Sort by text before lines, then distance, then dimension id for determinism.

- [ ] **Step 5: Run tests**

```powershell
npx vitest run `
  src/dimension/kernel/collision `
  src/dimension/kernel/hit
```

Expected: PASS.

---

### Task 9: Batch Viewport Layout, Goldens, and Kernel Benchmark

**Files:**
- Create: `src/dimension/kernel/viewport/layoutViewport.ts`
- Create: `src/dimension/kernel/viewport/layoutViewport.test.ts`
- Create: `src/dimension/kernel/goldens.test.ts`
- Create: `test/perf/dimensions/benchKernel.ts`
- Modify: `package.json`
- Modify: `vitest.config.ts`

**Interfaces:**
- Consumes: normalized/explicit inputs and interaction map.
- Produces: collision-resolved layouts and hit index.

- [ ] **Step 1: Implement batch layout**

```ts
export type ViewportLayoutBatch = Readonly<{
  layouts: readonly LayoutResult[];
  hitIndex: HitIndex;
}>;

export function layoutViewport(
  inputs: readonly (NormalizedDimensionInput | ExplicitLayoutInput)[],
  baseContext: Omit<LayoutContext, 'interaction'>,
  interactionById: ReadonlyMap<string, InteractionState>,
): ViewportLayoutBatch {
  const raw = inputs.map((input) => layoutDimension(input, {
    ...baseContext,
    interaction: interactionById.get(input.id) ?? 'normal',
  }));
  const layouts = resolveLabelCollisions(raw);
  return { layouts, hitIndex: buildHitIndex(layouts) };
}
```

- [ ] **Step 2: Parameterize structural goldens**

Load every manifest entry under `src/fixtures/dimensions/canonical` and compare a normalized result:
- round floats to six decimal places.
- sort primitives by kind/part/source order.
- never update goldens automatically in ordinary test runs.

- [ ] **Step 3: Add the kernel benchmark**

`benchKernel.ts` generates 2,000 deterministic visible inputs from seed 42 (representing a 10,000-record loaded document after viewport culling), performs 50 warmups and 200 measured runs, and exits non-zero when p95 layout+collision exceeds 16 ms.

Add:

```json
"perf:dimensions:kernel": "npx tsx test/perf/dimensions/benchKernel.ts"
```

- [ ] **Step 4: Expand coverage**

Change `vitest.config.ts`:

```ts
include: [
  'src/utils/three/annotation/**/*.ts',
  'src/dimension/**/*.ts',
],
```

- [ ] **Step 5: Close Gate 2**

Run:

```powershell
npx vitest run src/dimension/kernel
npm run perf:dimensions:kernel
npm run type-check
npm run lint
```

Expected:
- all kernel tests pass.
- p95 ≤ 16 ms on the recorded reference machine.
- `rg "from 'vue'|from 'three'|document\\.|window\\.|CanvasRenderingContext2D" src/dimension/kernel` returns no production matches.

Review checkpoint: publish the exact benchmark machine/CPU/browser-independent Node version next to the benchmark result; do not enable any production UI.
