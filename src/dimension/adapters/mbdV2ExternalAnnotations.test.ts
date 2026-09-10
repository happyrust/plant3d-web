import { describe, expect, it } from 'vitest';

import fullCoverageFixture from '../../fixtures/mbd-v2/full-coverage.json';
import cliLinearFixture from '../../fixtures/mbd-v2/rs-mbd-cli-linear.json';
import translationFixture
  from '../../fixtures/mbd-v2/source-to-design-translation.json';
import { DEFAULT_DIMENSION_FORMAT } from '../kernel/format';
import { stablePlaneBasis } from '../kernel/geometry/planeBasis';
import { createTestFont, createTestProjector, roundNumbers } from '../kernel/testUtils';
import { SOLVESPACE_DIMENSION_THEME } from '../kernel/theme';
import { layoutViewport } from '../kernel/viewport/layoutViewport';

import { parseMbdV2PipeData } from './mbdV2Contract';
import { mbdV2ToExternalRecords } from './mbdV2ExternalAnnotations';
import {
  externalDimensionCategory,
  normalizeExternalDimension,
} from './normalizeExternalDimensions';

import type { MbdV2PipeData } from './mbdV2Contract';
import type { ExplicitLayoutInput } from '../kernel/types';

function fixtureData(): MbdV2PipeData {
  // Mapper-only future-kind coverage. This hand-authored fixture is not a
  // V2 wire-contract authority; the parser contract uses the Rust fixture.
  return fullCoverageFixture as unknown as MbdV2PipeData;
}

function explicitLayout(
  result: ReturnType<typeof mbdV2ToExternalRecords>,
  id: string,
): ExplicitLayoutInput {
  const record = result.records.find(item => item.id === id);
  if (!record) throw new Error(`record ${id} not mapped`);
  return record.layout as ExplicitLayoutInput;
}

describe('mbdV2ToExternalRecords', () => {
  it('maps every primitive kind of the V2 contract', () => {
    const result = mbdV2ToExternalRecords(fixtureData());

    expect(result.records.map(record => record.id)).toEqual([
      'dim-segment-1',
      'dim-ref-2',
      'angle-1',
      'label-1',
      'leader-1',
      'aid-line-1',
      'aid-arc-1',
      'aid-circle-1',
      'aid-point-1',
      'aid-text-1',
      'weld-shop-1',
      'weld-field-2',
      'slope-1',
    ]);
    expect(result.skipped).toEqual([]);
    expect(result.records.every(record => record.source === 'mbd')).toBe(true);
  });

  it('categorises dimensions vs annotation primitives (ADR 0041)', () => {
    const result = mbdV2ToExternalRecords(fixtureData());
    const byCategory = new Map(
      result.records.map(record => [
        record.id,
        externalDimensionCategory(record),
      ]),
    );

    expect(byCategory.get('dim-segment-1')).toBe('dimension');
    expect(byCategory.get('dim-ref-2')).toBe('dimension');
    expect(byCategory.get('angle-1')).toBe('dimension');
    for (const id of [
      'label-1',
      'leader-1',
      'aid-line-1',
      'aid-arc-1',
      'aid-circle-1',
      'aid-point-1',
      'aid-text-1',
      'weld-shop-1',
      'weld-field-2',
      'slope-1',
    ]) {
      expect(byCategory.get(id)).toBe('annotation');
    }
  });

  it('maps arc frames onto the kernel arc, re-basing the start angle (ADR 0055)', () => {
    const result = mbdV2ToExternalRecords(fixtureData());
    const expectVec3Close = (
      actual: readonly [number, number, number] | undefined,
      expected: readonly [number, number, number],
    ): void => {
      expect(actual).toBeDefined();
      expect(actual![0]).toBeCloseTo(expected[0], 9);
      expect(actual![1]).toBeCloseTo(expected[1], 9);
      expect(actual![2]).toBeCloseTo(expected[2], 9);
    };
    // Kernel basis for normal +Z: u = -Y, v = +X (planeBasis.referenceAxis → X).
    const basis = stablePlaneBasis([0, 0, 1])!;
    const pointAt = (center: readonly number[], r: number, angle: number) => [
      center[0]! + basis.u[0] * Math.cos(angle) * r + basis.v[0] * Math.sin(angle) * r,
      center[1]! + basis.u[1] * Math.cos(angle) * r + basis.v[1] * Math.sin(angle) * r,
      center[2]! + basis.u[2] * Math.cos(angle) * r + basis.v[2] * Math.sin(angle) * r,
    ] as const;

    // angle_dim: arc from x_axis (+X) sweeping 90° towards +Y, two legs, value text along the arc.
    const angle = explicitLayout(result, 'angle-1');
    expect(angle.formattedLabel).toBe('90°');
    expect(angle.labelAnchor).toEqual([1.4, 0.15, 0]);
    expect(angle.lines.map(line => line.part)).toEqual(['extension', 'extension']);
    expect(angle.arcs).toHaveLength(1);
    const arc = angle.arcs![0]!;
    expect(arc.part).toBe('dimension');
    expect(arc.radiusM).toBeCloseTo(0.2, 12);
    expectVec3Close(arc.normal, [0, 0, 1]);
    expectVec3Close(pointAt(arc.center, arc.radiusM, arc.startAngle!), [1.45, 0, 0]);
    expectVec3Close(pointAt(arc.center, arc.radiusM, arc.endAngle!), [1.25, 0.2, 0]);
    expect(arc.endAngle! - arc.startAngle!).toBeCloseTo(Math.PI / 2, 12);
    // Counter-clockwise tangent at the 45° midpoint.
    expectVec3Close(angle.labelAlong, [-Math.SQRT1_2, Math.SQRT1_2, 0]);

    // aid_arc: x_axis +Y is not the kernel's u, so the start angle is re-based; style survives.
    const aidArc = explicitLayout(result, 'aid-arc-1');
    const half = aidArc.arcs![0]!;
    expect(half.part).toBe('arc');
    expect(half.style).toBe('dashed');
    expectVec3Close(pointAt(half.center, half.radiusM, half.startAngle!), [0.5, 0.6, 0]);
    expectVec3Close(pointAt(half.center, half.radiusM, half.endAngle!), [0.5, 0.4, 0]);
    // Sweeping 180° from +Y about +Z passes through -X.
    expectVec3Close(
      pointAt(half.center, half.radiusM, (half.startAngle! + half.endAngle!) / 2),
      [0.4, 0.5, 0],
    );
    expectVec3Close(aidArc.labelAnchor, [0.5, 0.6, 0]);
    expect(aidArc.formattedLabel).toBe('');

    // aid_circle: no angles → closed, anchored at its centre.
    const circle = explicitLayout(result, 'aid-circle-1');
    expect(circle.arcs).toHaveLength(1);
    const full = circle.arcs![0]!;
    expect(full).toMatchObject({ center: [0.9, 0.3, 0], normal: [0, 0, 1], part: 'arc' });
    expect(full.radiusM).toBeCloseTo(0.05, 12);
    expect(full.startAngle).toBeUndefined();
    expect(full.endAngle).toBeUndefined();
    expect(circle.labelAnchor).toEqual([0.9, 0.3, 0]);
  });

  it('diagnoses arc frames whose axes collapse instead of dropping them', () => {
    const data = fixtureData();
    const arc = data.primitives.find(primitive => primitive.kind === 'aid_arc');
    if (!arc || arc.kind !== 'aid_arc') throw new Error('aid_arc fixture missing');
    const result = mbdV2ToExternalRecords({
      ...data,
      primitives: [{ ...arc, id: 'arc-parallel', x_axis: arc.normal }],
    });

    expect(result.records).toEqual([]);
    expect(result.skipped).toEqual([{
      id: 'arc-parallel',
      reason: 'degenerate arc frame: normal or x_axis collapses or they are '
        + 'parallel after source_to_design',
    }]);
  });

  it('maps linear dims with superset geometry and reference role', () => {
    const result = mbdV2ToExternalRecords(fixtureData());

    const rich = explicitLayout(result, 'dim-segment-1');
    expect(rich.formattedLabel).toBe('1250');
    expect(rich.labelAnchor).toEqual([0.625, 0.2, 0]);
    expect(rich.lines.map(line => line.part)).toEqual([
      'dimension',
      'extension',
      'extension',
    ]);
    // The dimension value runs along its own dimension line.
    expect(rich.labelAlong).toEqual([1.25, 0, 0]);
    // The contract's arrow strokes are source geometry and enter the layout
    // 1:1 (ADR 0048 / 0056); no filled heads are generated beside them.
    expect(rich.arrowLines).toEqual([
      { from: [0, 0.15, 0], to: [0.05, 0.13, 0] },
      { from: [1.25, 0.15, 0], to: [1.2, 0.17, 0] },
    ]);
    expect(rich.arrows).toBeUndefined();

    const reference = result.records.find(record => record.id === 'dim-ref-2')!;
    expect(reference.role).toBe('external-reference');
    const referenceLayout = reference.layout as ExplicitLayoutInput;
    expect(referenceLayout.labelAnchor).toEqual([0, 0.4, 0]);
  });

  it('falls back to screen-scaled filled heads when the source carries no arrow strokes', () => {
    const result = mbdV2ToExternalRecords(fixtureData());

    // `dim-ref-2` has `arrow_lines: []` (older parquet rows and hand-authored
    // data look the same), so the kernel draws its own heads at both ends.
    const layout = explicitLayout(result, 'dim-ref-2');
    expect(layout.arrowLines).toEqual([]);
    expect(layout.arrows).toEqual([
      { tip: [0, 0, 0], towards: [0, 0.8, 0] },
      { tip: [0, 0.8, 0], towards: [0, 0, 0] },
    ]);
  });

  it('normalizes rs-mbd source millimetres before entering the registry', () => {
    const parsed = parseMbdV2PipeData(cliLinearFixture);
    if (!parsed.ok) throw new Error(parsed.error);

    const layout = explicitLayout(
      mbdV2ToExternalRecords(parsed.data),
      'linear-small-dimension:isoline:0:member:T-SMALL',
    );

    expect(layout.lines[0]).toMatchObject({
      from: [0, -0.5, 0],
      to: [0.08, -0.5, 0],
    });
    expect(layout.labelAnchor).toEqual([0.116, -0.5, 0]);
    // sub_kind "small": the solver's own strokes already point both wings
    // outwards (24 mm wings at cheight 25), so no `outside` flag is derived.
    expect(layout.arrows).toBeUndefined();
    expect(roundNumbers(layout.arrowLines)).toEqual([
      { from: [0, -0.5, 0], to: [-0.024, -0.507, 0] },
      { from: [0, -0.5, 0], to: [-0.024, -0.493, 0] },
      { from: [0.08, -0.5, 0], to: [0.104, -0.507, 0] },
      { from: [0.08, -0.5, 0], to: [0.104, -0.493, 0] },
    ]);
  });

  it('applies source_to_design as a column-major matrix (translation pin)', () => {
    // T(10,20,30)·Rz(90°)·S(0.001) serialized column-major (THREE
    // Matrix4.fromArray layout: translation in elements 12-14). A row-major
    // producer would effectively send the transpose and land every point
    // elsewhere, so these assertions pin the cross-repo convention.
    const parsed = parseMbdV2PipeData(translationFixture);
    if (!parsed.ok) throw new Error(parsed.error);

    const layout = explicitLayout(
      mbdV2ToExternalRecords(parsed.data),
      'trans-1',
    );
    const expectVec3Close = (
      actual: readonly [number, number, number],
      expected: readonly [number, number, number],
    ): void => {
      expect(actual[0]).toBeCloseTo(expected[0], 9);
      expect(actual[1]).toBeCloseTo(expected[1], 9);
      expect(actual[2]).toBeCloseTo(expected[2], 9);
    };

    const [dimension, extension] = layout.lines;
    expectVec3Close(dimension!.from, [8, 21, 33]);
    expectVec3Close(dimension!.to, [8, 22, 33]);
    expectVec3Close(extension!.from, [9, 21, 33]);
    expectVec3Close(extension!.to, [8, 21, 33]);
    expectVec3Close(layout.labelAnchor, [8, 21.5, 33]);

    // Arc frames: the centre is a point (translated), the axes are directions
    // (rotated only: x_axis E → N), the radius picks up the 0.001 scale.
    const arcLayout = explicitLayout(mbdV2ToExternalRecords(parsed.data), 'trans-arc');
    const arc = arcLayout.arcs![0]!;
    expectVec3Close(arc.center, [8, 21, 33]);
    expectVec3Close(arc.normal, [0, 0, 1]);
    expect(arc.radiusM).toBeCloseTo(0.5, 9);
    expect(arc.endAngle! - arc.startAngle!).toBeCloseTo(Math.PI / 2, 9);
    // Start point = centre + rotated x_axis · radius; the anchor sits there too.
    expectVec3Close(arcLayout.labelAnchor, [8, 21.5, 33]);
    const basis = stablePlaneBasis(arc.normal)!;
    const start = arc.startAngle!;
    expectVec3Close([
      arc.center[0] + basis.u[0] * Math.cos(start) * arc.radiusM + basis.v[0] * Math.sin(start) * arc.radiusM,
      arc.center[1] + basis.u[1] * Math.cos(start) * arc.radiusM + basis.v[1] * Math.sin(start) * arc.radiusM,
      arc.center[2] + basis.u[2] * Math.cos(start) * arc.radiusM + basis.v[2] * Math.sin(start) * arc.radiusM,
    ], [8, 21.5, 33]);
  });

  it('keeps tag and aid text viewport-horizontal until the contract has ori', () => {
    const result = mbdV2ToExternalRecords(fixtureData());

    for (const id of ['label-1', 'aid-text-1', 'slope-1']) {
      expect(explicitLayout(result, id).labelAlong).toBeUndefined();
    }
  });

  it('splits multi-line labels into stacked texts', () => {
    const layout = explicitLayout(mbdV2ToExternalRecords(fixtureData()), 'label-1');

    expect(layout.formattedLabel).toBe('BRAN /24381-145712');
    expect(layout.texts).toEqual([
      {
        text: 'DN100 PSPEC A1A',
        anchor: [1.4, 0.3, 0],
        stackIndex: 1,
      },
    ]);
  });

  it('assembles weld and slope symbols from kernel primitives (ADR 0042)', () => {
    const result = mbdV2ToExternalRecords(fixtureData());

    const shop = explicitLayout(result, 'weld-shop-1');
    expect(shop.markers).toEqual([
      { at: [0.3, 0, 0], shape: 'circle', radiusPx: 5 },
    ]);

    const field = explicitLayout(result, 'weld-field-2');
    expect(field.markers).toEqual([
      { at: [0.9, 0, 0], shape: 'circle', radiusPx: 5 },
      { at: [0.9, 0, 0], shape: 'cross', radiusPx: 5 },
    ]);

    const slope = explicitLayout(result, 'slope-1');
    expect(slope.formattedLabel).toBe('i=1.0%');
    expect(slope.lines).toHaveLength(1);
    expect(slope.arrowLines).toHaveLength(2);

    const aidLine = explicitLayout(result, 'aid-line-1');
    expect(aidLine.lines[0]).toMatchObject({ style: 'dash-dot' });

    const aidPoint = explicitLayout(result, 'aid-point-1');
    expect(aidPoint.markers).toEqual([
      { at: [0.5, 0, 0], shape: 'cross' },
    ]);
  });

  it('skips duplicate primitive ids instead of throwing downstream', () => {
    const data = fixtureData();
    const duplicated: MbdV2PipeData = {
      ...data,
      primitives: [
        data.primitives[0]!,
        data.primitives[0]!,
      ],
    };

    const result = mbdV2ToExternalRecords(duplicated);

    expect(result.records).toHaveLength(1);
    expect(result.skipped).toEqual([
      {
        id: 'dim-segment-1',
        reason: 'Duplicate primitive id within MBD payload',
      },
    ]);
  });

  it('produces records the shared kernel can lay out end to end', () => {
    const result = mbdV2ToExternalRecords(fixtureData());
    const batch = layoutViewport(
      result.records.map(normalizeExternalDimension),
      {
        projector: createTestProjector(),
        font: createTestFont(),
        theme: SOLVESPACE_DIMENSION_THEME,
        format: DEFAULT_DIMENSION_FORMAT,
      },
      new Map(),
    );

    expect(batch.layouts).toHaveLength(result.records.length);
    const weldLayout = batch.layouts.find(
      layout => layout.dimensionId === 'weld-field-2',
    )!;
    expect(
      batch.layouts.find(layout => layout.dimensionId === 'dim-segment-1')
        ?.labelPinned,
    ).toBe(false);
    expect(weldLayout.labelPinned).toBe(true);
    expect(
      weldLayout.primitives.filter(primitive => primitive.kind === 'marker'),
    ).toHaveLength(2);
  });

  it('carries rs-mbd arrow strokes to the viewport as arrow lines at the legibility floor', () => {
    const parsed = parseMbdV2PipeData(cliLinearFixture);
    if (!parsed.ok) throw new Error(parsed.error);
    const result = mbdV2ToExternalRecords(parsed.data);
    const layout = layoutViewport(
      result.records.map(normalizeExternalDimension),
      {
        // 24 mm wings project to 2.5 px at 100 px/m: well under the floor.
        projector: createTestProjector(),
        font: createTestFont(),
        theme: SOLVESPACE_DIMENSION_THEME,
        format: DEFAULT_DIMENSION_FORMAT,
      },
      new Map(),
    ).layouts.find(
      item => item.dimensionId === 'linear-small-dimension:isoline:0:member:T-SMALL',
    )!;

    const wings = layout.primitives.filter(
      primitive => primitive.kind === 'line' && primitive.part === 'arrow',
    );
    expect(wings).toHaveLength(4);
    for (const wing of wings) {
      if (wing.kind !== 'line') throw new Error('unreachable');
      expect(Math.hypot(wing.to[0] - wing.from[0], wing.to[1] - wing.from[1]))
        .toBeCloseTo(SOLVESPACE_DIMENSION_THEME.arrowLineMinLengthPx, 9);
    }
    // Small dimension: wings open away from the dimension line on both ends
    // (tip x = 200 / 208 px; wing bases lie outside that span).
    expect(wings.filter(wing => wing.kind === 'line' && wing.to[0] < 200)).toHaveLength(2);
    expect(wings.filter(wing => wing.kind === 'line' && wing.to[0] > 208)).toHaveLength(2);
    expect(layout.scenePrimitives.some(primitive => primitive.kind === 'scene-triangle')).toBe(false);
  });

  it('lets the shared kernel separate overlapping MBD dimension labels', () => {
    const data = fixtureData();
    const source = data.primitives.find(
      primitive => primitive.kind === 'linear_dim',
    );
    if (!source) throw new Error('linear_dim fixture missing');
    const result = mbdV2ToExternalRecords({
      ...data,
      primitives: [source, { ...source, id: `${source.id}-copy` }],
    });
    const layouts = layoutViewport(
      result.records.map(normalizeExternalDimension),
      {
        projector: createTestProjector(),
        font: createTestFont(),
        theme: SOLVESPACE_DIMENSION_THEME,
        format: DEFAULT_DIMENSION_FORMAT,
      },
      new Map(),
    ).layouts;
    const [a, b] = layouts.map(layout => layout.labelBounds);

    expect(layouts.every(layout => !layout.labelPinned)).toBe(true);
    expect(
      a.x + a.width <= b.x
      || b.x + b.width <= a.x
      || a.y + a.height <= b.y
      || b.y + b.height <= a.y,
    ).toBe(true);
  });
});
