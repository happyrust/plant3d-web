import { describe, expect, it } from 'vitest';

import envelopeFieldsFixture from '../../fixtures/mbd-v2/envelope-fields.json';
import fullCoverageFixture from '../../fixtures/mbd-v2/full-coverage.json';
import liveIsodimFixture from '../../fixtures/mbd-v2/live-isodim-24381-145018.json';
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
  externalLayoutAuthority,
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

    // `leader-1` starts on `label-1` and travels inside that record (see
    // "pairs a label with the leader that starts on it").
    expect(result.records.map(record => record.id)).toEqual([
      'dim-segment-1',
      'dim-ref-2',
      'angle-1',
      'label-1',
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

  it('declares solver layout authority on every record (S1: the solver placed the labels)', () => {
    const result = mbdV2ToExternalRecords(fixtureData());

    expect(result.records.every(record => record.layoutAuthority === 'solver')).toBe(true);
    expect(result.records.every(record => externalLayoutAuthority(record) === 'solver')).toBe(true);
    // The kernel still receives the decision as `labelPinned`.
    expect(result.records.every(record => normalizeExternalDimension(record).labelPinned)).toBe(true);
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

    // `dim-ref-2` has `arrow_lines: []` (older payload rows and hand-authored
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

  it('keeps tag, aid and slope text viewport-horizontal when no text_dir is declared', () => {
    const result = mbdV2ToExternalRecords(fixtureData());

    // Every producer before T4.3 omits `text_dir`: no baseline reaches the
    // kernel, neither on the primary label nor on the stacked lines.
    for (const id of ['label-1', 'aid-text-1', 'slope-1']) {
      const layout = explicitLayout(result, id);
      expect(layout.labelAlong).toBeUndefined();
      for (const text of layout.texts ?? []) expect(text.along).toBeUndefined();
    }
  });

  it('runs tag, aid and slope text along a declared text_dir, rotated by source_to_design (T4.3)', () => {
    const parsed = parseMbdV2PipeData(translationFixture);
    if (!parsed.ok) throw new Error(parsed.error);
    const expectVec3Close = (
      actual: readonly [number, number, number] | undefined,
      expected: readonly [number, number, number],
    ): void => {
      expect(actual).toBeDefined();
      expect(actual![0]).toBeCloseTo(expected[0], 9);
      expect(actual![1]).toBeCloseTo(expected[1], 9);
      expect(actual![2]).toBeCloseTo(expected[2], 9);
    };

    // T(10,20,30)·Rz(90°)·S(0.001): a direction is rotated only — E → N — and
    // comes out unit length whatever its source length; translation and the
    // 0.001 scale never reach it.
    const result = mbdV2ToExternalRecords({
      ...parsed.data,
      primitives: [
        { kind: 'label', id: 'tag', text: 'X 1\nY 2', position: [0, 0, 0], text_dir: [1, 0, 0] },
        { kind: 'aid_text', id: 'aid', text: 'A:0\nB:1', position: [0, 0, 0], text_dir: [0, 0, 2000] },
        {
          kind: 'slope_mark',
          id: 'slope',
          text: '1:100',
          start: [0, 0, 0],
          end: [1000, 0, 0],
          text_dir: [0, 1, 0],
        },
      ],
    });
    expect(result.skipped).toEqual([]);

    const tag = explicitLayout(result, 'tag');
    expectVec3Close(tag.labelAlong, [0, 1, 0]);
    // The stacked lines read the same way as the first one.
    expect(tag.texts).toHaveLength(1);
    expectVec3Close(tag.texts![0]!.along, [0, 1, 0]);
    // The billboard spec is untouched: a tag body is always screen-facing.
    expect(tag.tag).toMatchObject({ style: 'card', lines: [{ text: 'X 1' }, { text: 'Y 2' }] });

    const aid = explicitLayout(result, 'aid');
    expectVec3Close(aid.labelAlong, [0, 0, 1]);
    expectVec3Close(aid.texts![0]!.along, [0, 0, 1]);

    const slope = explicitLayout(result, 'slope');
    expectVec3Close(slope.labelAlong, [-1, 0, 0]);
    // The slope line itself keeps following the geometry, not the text.
    expectVec3Close(slope.lines[0]!.from, [10, 20, 30]);
    expectVec3Close(slope.lines[0]!.to, [10, 21, 30]);

    // A `design_m` payload takes the direction as is, normalised.
    const designSpace = mbdV2ToExternalRecords({
      ...fixtureData(),
      meta: { geometry_space: 'design_m', notes: [] },
      primitives: [
        { kind: 'aid_text', id: 'aid', text: 'EL +1', position: [0, 0, 0], text_dir: [3, 4, 0] },
      ],
    });
    expectVec3Close(explicitLayout(designSpace, 'aid').labelAlong, [0.6, 0.8, 0]);

    // A transform that flattens the direction (zero Z scale) loses the
    // baseline, not the primitive: that text falls back to viewport-horizontal.
    const flattened = mbdV2ToExternalRecords({
      ...parsed.data,
      meta: {
        ...parsed.data.meta,
        source_to_design: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
      },
      primitives: [
        { kind: 'aid_text', id: 'aid', text: 'EL +1', position: [0, 0, 0], text_dir: [0, 0, 1] },
      ],
    });
    expect(flattened.skipped).toEqual([]);
    expect(explicitLayout(flattened, 'aid').labelAlong).toBeUndefined();
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

  it('pairs a label with the leader that starts on it and presents the pair as a billboard tag', () => {
    const data = fixtureData();
    const result = mbdV2ToExternalRecords(data);

    // `leader-1` starts at `label-1`'s position (ids follow no convention
    // here, so the pairing is geometric): one record carries the text, the
    // solver's leader as its flat presentation and the billboard spec.
    const label = explicitLayout(result, 'label-1');
    expect(result.records.some(record => record.id === 'leader-1')).toBe(false);
    expect(label.lines).toEqual([{ from: [1.4, 0.3, 0], to: [1.25, 0, 0], part: 'leader' }]);
    expect(label.formattedLabel).toBe('BRAN /24381-145712');
    expect(label.tag).toEqual({
      // Not a coordinate block → a framed name.
      style: 'frame',
      lines: [{ text: 'BRAN /24381-145712' }, { text: 'DN100 PSPEC A1A' }],
      target: [1.25, 0, 0],
    });
    expect(label.lod).toBeUndefined();

    // A leader that starts nowhere near a label stays its own record; a
    // leader is spent on one label only.
    const loose = mbdV2ToExternalRecords({
      ...data,
      primitives: [
        { kind: 'label', id: 'tag-a', text: 'A', position: [0, 0, 0] },
        { kind: 'label', id: 'tag-b', text: 'B', position: [0, 0, 0] },
        { kind: 'leader_line', id: 'shared', start: [0, 0, 0], end: [0, -1, 0] },
        { kind: 'leader_line', id: 'loose', start: [5, 5, 5], end: [6, 5, 5] },
      ],
    });
    expect(loose.records.map(record => record.id)).toEqual(['tag-a', 'tag-b', 'loose']);
    expect(explicitLayout(loose, 'tag-a').tag?.target).toEqual([0, -1, 0]);
    expect(explicitLayout(loose, 'tag-b').tag?.target).toBeUndefined();
    expect(explicitLayout(loose, 'tag-b').lines).toEqual([]);
    expect(explicitLayout(loose, 'loose').lines).toEqual([
      { from: [5, 5, 5], to: [6, 5, 5], part: 'leader' },
    ]);
    expect(loose.skipped).toEqual([]);
  });

  it('classifies plant-mbd tags into cards, frames and pills with the drawing LOD', () => {
    const data = fixtureData();
    // One running dimension rooted at the open end P = (0,0,0) and at Q = (1,0,0);
    // a second one shares Q with a third, so Q is an inner connection.
    const dimension = (id: string, from: readonly [number, number, number], to: readonly [number, number, number]) => ({
      kind: 'linear_dim' as const,
      id,
      start: [from[0], from[1] + 0.1, from[2]] as const,
      end: [to[0], to[1] + 0.1, to[2]] as const,
      text: '1000',
      sub_kind: 'main',
      extension_lines: [
        { from, to: [from[0], from[1] + 0.1, from[2]] as const },
        { from: to, to: [to[0], to[1] + 0.1, to[2]] as const },
      ],
      arrow_lines: [],
      label_anchor: [(from[0] + to[0]) / 2, from[1] + 0.1, from[2]] as const,
    });
    const result = mbdV2ToExternalRecords({
      ...data,
      primitives: [
        dimension('d-1', [0, 0, 0], [1, 0, 0]),
        dimension('d-2', [1, 0, 0], [1, 1, 0]),
        { kind: 'label', id: 'b:isoline:0:tag:connection:Head', text: 'X 1516\nY 8157\nPE 13293', position: [-0.1, 0.2, 0] },
        { kind: 'leader_line', id: 'b:isoline:0:tag:connection:Head:leader', start: [-0.1, 0.2, 0], end: [0, 0, 0] },
        { kind: 'label', id: 'b:isoline:1:tag:connection:mid', text: 'X 1\nY 2\nPE 3', position: [1.1, 0.2, 0] },
        { kind: 'leader_line', id: 'b:isoline:1:tag:connection:mid:leader', start: [1.1, 0.2, 0], end: [1, 0, 0] },
        { kind: 'label', id: 'b:isoline:0:tag:elbo:r1', text: '89.75°\nPE +13301', position: [0.5, 0.3, 0] },
        { kind: 'leader_line', id: 'b:isoline:0:tag:elbo:r1:leader', start: [0.5, 0.3, 0], end: [0.5, 0, 0] },
        { kind: 'label', id: 'b:isoline:2:tag:bend:r3', text: '10°\n弯曲半径:51.50\nPE -6250', position: [0.8, 0.3, 0] },
        { kind: 'leader_line', id: 'b:isoline:2:tag:bend:r3:leader', start: [0.8, 0.3, 0], end: [0.8, 0, 0] },
        { kind: 'label', id: 'b:isoline:1:tag:name:r2', text: 'Copy-of-1RCS002VP', position: [1.2, 0.5, 0] },
        { kind: 'leader_line', id: 'b:isoline:1:tag:name:r2:leader', start: [1.2, 0.5, 0], end: [1, 0.5, 0] },
        { kind: 'label', id: 'b:tag:branch-name', text: 'Copy', position: [0.5, -0.3, 0] },
        { kind: 'leader_line', id: 'b:tag:branch-name:leader', start: [0.5, -0.3, 0], end: [0.5, 0, 0] },
      ],
    });
    expect(result.skipped).toEqual([]);
    expect(result.records.filter(record => record.id.endsWith(':leader'))).toEqual([]);

    // End-point coordinate block: a card with a dot, standing off along the
    // pipe out of its open end (P is rooted by exactly one dimension: away = P − Q).
    const head = explicitLayout(result, 'b:isoline:0:tag:connection:Head');
    expect(head.tag).toEqual({
      style: 'card',
      lines: [{ text: 'X 1516' }, { text: 'Y 8157' }, { text: 'PE 13293' }],
      target: [0, 0, 0],
      away: [-1, 0, 0],
      dot: true,
    });
    expect(head.lod).toBeUndefined();
    // A connection inside the branch (rooted by two dimensions) has no single
    // outward direction; the component it sits at is the tag's subject (a
    // branch end has none — see `head.tag` above).
    const mid = explicitLayout(result, 'b:isoline:1:tag:connection:mid');
    expect(mid.tag?.away).toBeUndefined();
    expect(mid.tag?.subject).toBe('mid');

    // Elbow tag: a pill from mid range on, the angle only on a close-up.
    const elbow = explicitLayout(result, 'b:isoline:0:tag:elbo:r1');
    expect(elbow.tag).toEqual({
      style: 'pill',
      lines: [{ text: '89.75°', detail: true }, { text: 'PE +13301' }],
      target: [0.5, 0, 0],
      subject: 'r1',
    });
    expect(elbow.lod).toEqual({ tier: 'secondary' });

    // Bend tag: the same note about a direction change, presented the same
    // way — a pill from mid range on, the angle and the bend radius only on a
    // close-up (2026-09-14; it used to read as a coordinate-block card with
    // no LOD because of its `PE` line).
    const bend = explicitLayout(result, 'b:isoline:2:tag:bend:r3');
    expect(bend.tag).toEqual({
      style: 'pill',
      lines: [{ text: '10°', detail: true }, { text: '弯曲半径:51.50', detail: true }, { text: 'PE -6250' }],
      target: [0.8, 0, 0],
      subject: 'r3',
    });
    expect(bend.lod).toEqual({ tier: 'secondary' });

    // Component name: framed, always shown, naming the component.
    const name = explicitLayout(result, 'b:isoline:1:tag:name:r2');
    expect(name.tag).toMatchObject({ style: 'frame', lines: [{ text: 'Copy-of-1RCS002VP' }], subject: 'r2' });
    expect(name.tag?.dot).toBeUndefined();
    expect(name.lod).toBeUndefined();

    // Branch name: close-up detail, names no component.
    const branch = explicitLayout(result, 'b:tag:branch-name');
    expect(branch.tag?.style).toBe('pill');
    expect(branch.tag?.subject).toBeUndefined();
    expect(branch.lod).toEqual({ tier: 'detail' });
  });

  it('names the component of every plant-mbd tag kind that ends in a refno as the tag\'s subject', () => {
    // bend / atta / elevation / tee tags were classified by text only and
    // probed like refno-less cards until 2026-09-14 (BRAN 24381_105520:
    // `PE +3980` behind a tube run stayed bright; a support name tag faded
    // because of the support's own geometry).
    const data = fixtureData();
    const result = mbdV2ToExternalRecords({
      ...data,
      primitives: [
        { kind: 'label', id: 'b:isoline:0:tag:bend:24381_105522', text: '90°\n弯曲半径:28.50\nPE +5820', position: [0, 0, 0] },
        { kind: 'label', id: 'b:isoline:0:tag:atta:24383_75127', text: 'R520.067-BV', position: [1, 0, 0] },
        { kind: 'label', id: 'b:isoline:17:tag:elevation:24381_105538', text: 'PE +4065', position: [2, 0, 0] },
        { kind: 'label', id: 'b:isoline:18:tag:tee:24381_105541', text: 'PE +3795', position: [3, 0, 0] },
        { kind: 'label', id: 'b:isoline:0:tag:connection:Head', text: 'X 1\nY 2\nPE 3', position: [4, 0, 0] },
        { kind: 'label', id: 'b:tag:branch-name', text: 'Copy', position: [5, 0, 0] },
      ],
    });

    expect(explicitLayout(result, 'b:isoline:0:tag:bend:24381_105522').tag).toMatchObject({ style: 'pill', subject: '24381_105522' });
    expect(explicitLayout(result, 'b:isoline:0:tag:atta:24383_75127').tag).toMatchObject({ style: 'frame', subject: '24383_75127' });
    // A level change along the run and the elevation at a tee are the same
    // elevation note as an elbow's `PE` line: a pill from mid range on, its
    // one line primary (2026-09-14; they used to read as coordinate cards).
    const elevation = explicitLayout(result, 'b:isoline:17:tag:elevation:24381_105538');
    expect(elevation.tag).toEqual({ style: 'pill', lines: [{ text: 'PE +4065' }], subject: '24381_105538' });
    expect(elevation.lod).toEqual({ tier: 'secondary' });
    const tee = explicitLayout(result, 'b:isoline:18:tag:tee:24381_105541');
    expect(tee.tag).toEqual({ style: 'pill', lines: [{ text: 'PE +3795' }], subject: '24381_105541' });
    expect(tee.lod).toEqual({ tier: 'secondary' });
    expect(explicitLayout(result, 'b:isoline:0:tag:connection:Head').tag?.subject).toBeUndefined();
    expect(explicitLayout(result, 'b:tag:branch-name').tag?.subject).toBeUndefined();
  });

  it('names the WELD component of a plant-mbd weld mark as the record\'s subject', () => {
    // The mark sits at the WELD's origin on the bore axis, inside the bead
    // the model draws for it and inside the pipe wall; without the refno
    // every weld mark fades in inspection (27 / 27, BRAN 24381_146979).
    const data = fixtureData();
    const result = mbdV2ToExternalRecords({
      ...data,
      primitives: [
        { kind: 'weld_mark', id: '24381_146979:isoline:0:weld:mark:24381_146980', position: [0, 0, 0], weld_type: 'field' },
        { kind: 'weld_mark', id: '24381_146979:isoline:1:weld:mark:24381_146984', position: [1, 0, 0], weld_type: 'shop' },
        { kind: 'weld_mark', id: 'other-producer-weld', position: [2, 0, 0], weld_type: 'shop' },
      ],
    });

    expect(explicitLayout(result, '24381_146979:isoline:0:weld:mark:24381_146980').subject).toBe('24381_146980');
    expect(explicitLayout(result, '24381_146979:isoline:1:weld:mark:24381_146984').subject).toBe('24381_146984');
    expect(explicitLayout(result, 'other-producer-weld').subject).toBeUndefined();
  });

  it('takes a declared object_refno as the subject before reading the id (T4.4)', () => {
    const result = mbdV2ToExternalRecords({
      ...fixtureData(),
      primitives: [
        // Declared: wins over the id convention …
        { kind: 'label', id: 'b:isoline:0:tag:elbo:r1', text: '90°\nPE +1', position: [0, 0, 0], object_refno: '24381_105522' },
        { kind: 'weld_mark', id: 'b:isoline:0:weld:mark:24381_146980', position: [1, 0, 0], object_refno: '24381_146999' },
        // … names an object the id does not carry (another producer's ids, a
        // branch end, the branch name) …
        { kind: 'label', id: 'other-producer-tag', text: 'V-101', position: [2, 0, 0], object_refno: '24381_105530' },
        { kind: 'weld_mark', id: 'other-producer-weld', position: [3, 0, 0], object_refno: '24381_147000' },
        { kind: 'label', id: 'b:isoline:0:tag:connection:Head', text: 'X 1\nY 2\nPE 3', position: [4, 0, 0], object_refno: '24381_105540' },
        { kind: 'label', id: 'b:tag:branch-name', text: 'Copy', position: [5, 0, 0], object_refno: '24381_105500' },
        // … and not declared keeps the plant-mbd id convention (regression).
        { kind: 'label', id: 'b:isoline:1:tag:name:r2', text: 'N', position: [6, 0, 0] },
        { kind: 'weld_mark', id: 'b:isoline:1:weld:mark:24381_146984', position: [7, 0, 0] },
        // A dimension's object is not an occlusion subject: its value text
        // stands in free space and is probed plainly, whatever the producer
        // declares (the jump-to-component consumer is a separate carrier).
        {
          kind: 'linear_dim', id: 'dim-with-object', start: [0, 0, 0], end: [1, 0, 0], text: '1000',
          extension_lines: [], arrow_lines: [], label_anchor: [0.5, 0, 0], object_refno: '24381_105522',
        },
      ],
    });

    expect(explicitLayout(result, 'b:isoline:0:tag:elbo:r1').tag?.subject).toBe('24381_105522');
    expect(explicitLayout(result, 'b:isoline:0:weld:mark:24381_146980').subject).toBe('24381_146999');
    expect(explicitLayout(result, 'other-producer-tag').tag?.subject).toBe('24381_105530');
    expect(explicitLayout(result, 'other-producer-weld').subject).toBe('24381_147000');
    expect(explicitLayout(result, 'b:isoline:0:tag:connection:Head').tag?.subject).toBe('24381_105540');
    expect(explicitLayout(result, 'b:tag:branch-name').tag).toMatchObject({ style: 'pill', subject: '24381_105500' });
    expect(explicitLayout(result, 'b:isoline:1:tag:name:r2').tag?.subject).toBe('r2');
    expect(explicitLayout(result, 'b:isoline:1:weld:mark:24381_146984').subject).toBe('24381_146984');
    expect(explicitLayout(result, 'dim-with-object').subject).toBeUndefined();
  });

  it('marks slopes and skew aids as close-up detail', () => {
    const data = fixtureData();
    const result = mbdV2ToExternalRecords({
      ...data,
      primitives: [
        { kind: 'slope_mark', id: 'b:isoline:0:slope:mark:a~b', text: 'slope 0.4%', start: [0, 0, 0], end: [1, 0.004, 0] },
        { kind: 'aid_line', id: 'b:isoline:0:slope:rise:a~b', start: [0, 0, 0], end: [0, 0.1, 0] },
        { kind: 'aid_text', id: 'b:isoline:4:skew:x-text', text: 'X:2002', position: [0, 0, 0] },
        { kind: 'aid_line', id: 'b:isoline:4:skew:x', start: [0, 0, 0], end: [1, 0, 0] },
        { kind: 'aid_line', id: 'plain-aid', start: [0, 0, 0], end: [1, 0, 0] },
        { kind: 'aid_text', id: 'plain-text', text: 'EL +1', position: [0, 0, 0] },
      ],
    });
    for (const id of ['b:isoline:0:slope:mark:a~b', 'b:isoline:0:slope:rise:a~b', 'b:isoline:4:skew:x-text', 'b:isoline:4:skew:x']) {
      expect(explicitLayout(result, id).lod).toEqual({ tier: 'detail' });
    }
    for (const id of ['plain-aid', 'plain-text']) {
      expect(explicitLayout(result, id).lod).toBeUndefined();
    }
  });

  it('declutters an installation angle and its two direction notes as one group', () => {
    const data = fixtureData();
    const angle = data.primitives.find(primitive => primitive.kind === 'angle_dim')!;
    const result = mbdV2ToExternalRecords({
      ...data,
      primitives: [
        { ...angle, id: 'b:isoline:0:angle:m:0' },
        { kind: 'aid_text', id: 'b:isoline:0:angle:m:0:dirtext1', text: '-X', position: [0, 0, 0] },
        { kind: 'aid_text', id: 'b:isoline:0:angle:m:0:dirtext2', text: '-X 44.5° Y', position: [0, 0, 0] },
        { kind: 'aid_text', id: 'plain-text', text: 'EL +1', position: [0, 0, 0] },
      ],
    });
    for (const id of ['b:isoline:0:angle:m:0', 'b:isoline:0:angle:m:0:dirtext1', 'b:isoline:0:angle:m:0:dirtext2']) {
      expect(explicitLayout(result, id).declutter).toEqual({ rank: 500, group: 'b:isoline:0:angle:m:0' });
    }
    expect(explicitLayout(result, 'plain-text').declutter).toBeUndefined();
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
    // Fixture ids carry no WELD refno: probed plainly by the inspection pass.
    expect(shop.subject).toBeUndefined();
    expect(field.subject).toBeUndefined();

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

  it('carries the group cheight into every record as a Design Space text height', () => {
    const parsed = parseMbdV2PipeData(cliLinearFixture);
    if (!parsed.ok) throw new Error(parsed.error);
    // source_mm payload with S(0.001): 27 mm → 0.027 m on every record (S2).
    const withCheight = mbdV2ToExternalRecords({
      ...parsed.data,
      meta: { ...parsed.data.meta, cheight_mm: 27 },
    });
    expect(withCheight.records).not.toHaveLength(0);
    for (const record of withCheight.records) {
      expect((record.layout as ExplicitLayoutInput).textHeightM).toBeCloseTo(0.027, 12);
    }

    // No cheight (or null): the kernel keeps its fixed text height.
    const withoutCheight = mbdV2ToExternalRecords({
      ...parsed.data,
      meta: { ...parsed.data.meta, cheight_mm: null },
    });
    for (const record of withoutCheight.records) {
      expect((record.layout as ExplicitLayoutInput).textHeightM).toBeUndefined();
    }

    // design_m payload still declares the height in millimetres.
    const designSpace = mbdV2ToExternalRecords({
      ...fixtureData(),
      meta: { geometry_space: 'design_m', notes: [], cheight_mm: 27 },
    });
    expect((designSpace.records[0]!.layout as ExplicitLayoutInput).textHeightM)
      .toBeCloseTo(0.027, 12);
  });

  it('lets a single aid_text override the group text height with its own', () => {
    const parsed = parseMbdV2PipeData(cliLinearFixture);
    if (!parsed.ok) throw new Error(parsed.error);
    // source_mm payload with S(0.001): 12.5 mm → 0.0125 m, 27 mm → 0.027 m.
    const result = mbdV2ToExternalRecords({
      ...parsed.data,
      primitives: [
        { kind: 'aid_text', id: 'dir-text', text: 'A:0', position: [0, 0, 0], text_height_mm: 12.5 },
        { kind: 'aid_text', id: 'plain-text', text: 'EL +1', position: [0, 0, 0] },
      ],
      meta: { ...parsed.data.meta, cheight_mm: 27 },
    });

    // The declared height wins over the group height, per record.
    expect(explicitLayout(result, 'dir-text').textHeightM).toBeCloseTo(0.0125, 12);
    // A record without its own height keeps following the group (regression).
    expect(explicitLayout(result, 'plain-text').textHeightM).toBeCloseTo(0.027, 12);
    // Different heights in one payload prove the override is per record.
    expect(explicitLayout(result, 'dir-text').textHeightM)
      .not.toBe(explicitLayout(result, 'plain-text').textHeightM);
  });

  it('keeps the group text height when no aid_text declares its own', () => {
    const parsed = parseMbdV2PipeData(cliLinearFixture);
    if (!parsed.ok) throw new Error(parsed.error);
    const result = mbdV2ToExternalRecords({
      ...parsed.data,
      primitives: [
        { kind: 'aid_text', id: 'plain-text', text: 'EL +1', position: [0, 0, 0] },
      ],
      meta: { ...parsed.data.meta, cheight_mm: 27 },
    });

    expect(explicitLayout(result, 'plain-text').textHeightM).toBeCloseTo(0.027, 12);

    // Without a group height there is still nothing to hang (unchanged).
    const withoutGroup = mbdV2ToExternalRecords({
      ...parsed.data,
      primitives: [
        { kind: 'aid_text', id: 'plain-text', text: 'EL +1', position: [0, 0, 0] },
      ],
      meta: { ...parsed.data.meta, cheight_mm: null },
    });
    expect(explicitLayout(withoutGroup, 'plain-text').textHeightM).toBeUndefined();
  });

  describe('envelope fields (#103 M1-3)', () => {
    function envelopeData(): MbdV2PipeData {
      const parsed = parseMbdV2PipeData(envelopeFieldsFixture, { strict: true });
      if (!parsed.ok) throw new Error(parsed.error);
      return parsed.data;
    }
    const SEG_0 = '24383_91813:chain:0:seg:0';
    const SEG_1 = '24383_91813:chain:0:seg:1';
    const PIPE_TAG = '24383_91813:tag:pipe:24383_91816';
    const PLATE_TEXT = '24383_91813:plate:24383_91817:thickness';
    const ANGLE = '24383_91813:angle:24383_91818';
    const SLOPE = '24383_91813:slope:24383_91816';

    it('carries function and chain_id onto the record as mbdFunction / chainId', () => {
      const result = mbdV2ToExternalRecords(envelopeData());

      // The leader travels inside its label's record, as on pipe payloads.
      expect(result.records.map(record => record.id)).toEqual([SEG_0, SEG_1, PIPE_TAG, PLATE_TEXT, ANGLE, SLOPE]);
      expect(result.skipped).toEqual([]);
      const record = (id: string) => result.records.find(item => item.id === id)!;
      expect(record(SEG_0)).toMatchObject({ mbdFunction: '一级尺寸', chainId: '24383_91813:chain:0' });
      expect(record(PIPE_TAG)).toMatchObject({ mbdFunction: '管道信息' });
      expect(record(ANGLE)).toMatchObject({ mbdFunction: '二级尺寸' });
      // Both segments of the chain share its id; the second declares no category.
      expect(record(SEG_1).chainId).toBe('24383_91813:chain:0');
      // Nothing undeclared shows up, not even as an `undefined` key.
      for (const id of [SEG_1, PLATE_TEXT, SLOPE]) expect(record(id)).not.toHaveProperty('mbdFunction');
      for (const id of [PIPE_TAG, PLATE_TEXT, ANGLE, SLOPE]) expect(record(id)).not.toHaveProperty('chainId');
    });

    it('takes a declared text_height_mm before the payload-wide group height', () => {
      // source_mm with S(0.001); meta.cheight_mm 25 → 0.025 m for every record without its own height.
      const result = mbdV2ToExternalRecords(envelopeData());
      const height = (id: string) => explicitLayout(result, id).textHeightM;

      expect(height(SEG_0)).toBeCloseTo(0.02, 12);
      expect(height(PIPE_TAG)).toBeCloseTo(0.018, 12);
      expect(height(ANGLE)).toBeCloseTo(0.015, 12);
      expect(height(SLOPE)).toBeCloseTo(0.0125, 12);
      expect(height(SEG_1)).toBeCloseTo(0.025, 12);
      expect(height(PLATE_TEXT)).toBeCloseTo(0.025, 12);
    });

    it('puts a declared text_height_mm above the isoline height without moving the 3D rows', () => {
      const parsed = parseMbdV2PipeData(cliLinearFixture);
      if (!parsed.ok) throw new Error(parsed.error);
      const source = parsed.data.primitives[0]!;
      if (source.kind !== 'linear_dim') throw new Error('linear_dim fixture missing');
      // 532.4 mm extension lines over isoline 0's 500 mm surface: two 1.2·13.5 mm
      // row steps out (the T4.2 / T4.6 case above). Read with a 40 mm step it
      // would round to row 1.
      const outerRow = {
        ...source,
        sub_kind: 'main',
        isoline_idx: 0,
        start: [0, -532.4, 0] as const,
        end: [80, -532.4, 0] as const,
        label_anchor: [40, -532.4, 0] as const,
        extension_lines: [
          { from: [0, 0, 0] as const, to: [0, -532.4, 0] as const },
          { from: [80, 0, 0] as const, to: [80, -532.4, 0] as const },
        ],
      };
      const tag = { kind: 'label' as const, text: 'X 1', position: [40, -500, 0] as const, isoline_idx: 0 };
      const result = mbdV2ToExternalRecords({
        ...parsed.data,
        meta: {
          ...parsed.data.meta,
          cheight_mm: 27,
          isolines: [{ index: 0, members: ['24381_145018'], cheight_mm: 13.5, od_mm: 500 }],
        },
        primitives: [
          { ...source, isoline_idx: 0 },
          { ...outerRow, id: 'outer-group' },
          { ...outerRow, id: 'outer-own', text_height_mm: 40 },
          { ...tag, id: 'tag-group' },
          { ...tag, id: 'tag-own', text_height_mm: 40 },
        ],
      });

      expect(explicitLayout(result, 'outer-group').textHeightM).toBeCloseTo(0.0135, 12);
      expect(explicitLayout(result, 'outer-own').textHeightM).toBeCloseTo(0.04, 12);
      // The rows are the solver's group spacing, whatever the text declares.
      expect(explicitLayout(result, 'outer-group').dimension3d!.row).toBe(2);
      expect(explicitLayout(result, 'outer-own').dimension3d!.row).toBe(2);
      expect(explicitLayout(result, 'tag-group').textHeightM).toBeCloseTo(0.0135, 12);
      expect(explicitLayout(result, 'tag-own').textHeightM).toBeCloseTo(0.04, 12);
      // Polar placement makes room for the label at the height it is drawn with.
      expect(explicitLayout(result, 'tag-group').polar!.textHeightM).toBeCloseTo(0.0135, 12);
      expect(explicitLayout(result, 'tag-own').polar!.textHeightM).toBeCloseTo(0.04, 12);
    });

    it('leaves a live pipe payload without the new record fields and on its group height', () => {
      const parsed = parseMbdV2PipeData(liveIsodimFixture);
      if (!parsed.ok) throw new Error(parsed.error);
      const result = mbdV2ToExternalRecords(parsed.data);

      expect(result.skipped).toEqual([]);
      expect(result.records).toHaveLength(63);
      for (const record of result.records) {
        expect(record).not.toHaveProperty('mbdFunction');
        expect(record).not.toHaveProperty('chainId');
        // meta.cheight_mm 27 through S(0.001); no primitive declares its own height.
        expect((record.layout as ExplicitLayoutInput).textHeightM).toBeCloseTo(0.027, 12);
      }
    });
  });

  it('tags linear dimensions with level-of-detail hints from sub_kind', () => {
    const parsed = parseMbdV2PipeData(cliLinearFixture);
    if (!parsed.ok) throw new Error(parsed.error);
    const source = parsed.data.primitives[0]!;
    if (source.kind !== 'linear_dim') throw new Error('linear_dim fixture missing');
    const result = mbdV2ToExternalRecords({
      ...parsed.data,
      primitives: [
        { ...source, id: 'main-1', sub_kind: 'main' },
        { ...source, id: 'atta-1', sub_kind: 'atta' },
        { ...source, id: 'small-1', sub_kind: 'small' },
        { kind: 'label', id: 'tag-1', text: 'PIPE', position: [0, 0, 0] },
      ],
    });

    // Main running dimensions: primary, hidden only when too short to read.
    expect(explicitLayout(result, 'main-1').lod).toEqual({ tier: 'primary', hideShort: true });
    // ATTA sub-dimensions drop out on a plant-wide view.
    expect(explicitLayout(result, 'atta-1').lod).toEqual({ tier: 'secondary', hideShort: true });
    // Small dims already carry their text outside the line: never hide them for length.
    expect(explicitLayout(result, 'small-1').lod).toEqual({ tier: 'primary', hideShort: false });
    // Non-dimension primitives carry no LOD hint (the kind filter handles them).
    expect(explicitLayout(result, 'tag-1').lod).toBeUndefined();
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
    // Every MBD record is solver-placed, dimensions included (QW1, 2026-09-12).
    expect(
      batch.layouts.find(layout => layout.dimensionId === 'dim-segment-1')
        ?.labelPinned,
    ).toBe(true);
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

  it('keeps overlapping MBD dimension labels on their solver anchors instead of decluttering them', () => {
    const data = fixtureData();
    const source = data.primitives.find(
      primitive => primitive.kind === 'linear_dim',
    );
    if (!source) throw new Error('linear_dim fixture missing');
    const context = {
      projector: createTestProjector(),
      font: createTestFont(),
      theme: SOLVESPACE_DIMENSION_THEME,
      format: DEFAULT_DIMENSION_FORMAT,
    };
    const layoutsOf = (payload: MbdV2PipeData) => layoutViewport(
      mbdV2ToExternalRecords(payload).records.map(normalizeExternalDimension),
      context,
      new Map(),
    ).layouts;

    // Flat presentation (no group cheight): same `label_anchor` → same label
    // box. The Web kernel must not push either copy away from the solver's
    // placement …
    const flat = layoutsOf({
      ...data,
      meta: { ...data.meta, cheight_mm: null },
      primitives: [source, { ...source, id: `${source.id}-copy` }],
    });
    expect(flat.every(layout => layout.labelPinned)).toBe(true);
    expect(flat[1]!.labelBounds).toEqual(flat[0]!.labelBounds);
    // … nor invent a leader line to a relocated label.
    for (const layout of flat) {
      expect(layout.primitives.some(
        primitive => primitive.kind === 'line' && primitive.part === 'leader',
      )).toBe(false);
    }

    // 3D presentation: the pairwise declutter (S1) elides the lower-ranked
    // copy for this view instead of moving it; the survivor is laid out
    // exactly as it would be alone.
    const alone = layoutsOf({ ...data, primitives: [source] });
    const pair = layoutsOf({
      ...data,
      primitives: [source, { ...source, id: `${source.id}-copy` }],
    });
    expect(pair[0]!.labelBounds).toEqual(alone[0]!.labelBounds);
    expect(pair[0]!.derived.lodHidden).toBeUndefined();
    expect(pair[1]!.derived.lodHidden).toBe('overlap');
    expect(pair[1]!.primitives).toEqual([]);
    expect(pair.every(layout => layout.labelPinned)).toBe(true);
  });

  it('derives the 3D presentation from the extension lines when the group declares cheight', () => {
    const parsed = parseMbdV2PipeData(cliLinearFixture);
    if (!parsed.ok) throw new Error(parsed.error);
    const source = parsed.data.primitives[0]!;
    if (source.kind !== 'linear_dim') throw new Error('linear_dim fixture missing');
    // Solver rows are 1.2·cheight apart: a second dimension one row further
    // out shares the same pipe points.
    const outerRow = {
      ...source,
      id: 'main-row-1',
      sub_kind: 'main',
      start: [0, -532.4, 0] as const,
      end: [80, -532.4, 0] as const,
      label_anchor: [40, -532.4, 0] as const,
      extension_lines: [
        { from: [0, 0, 0] as const, to: [0, -532.4, 0] as const },
        { from: [80, 0, 0] as const, to: [80, -532.4, 0] as const },
      ],
    };
    const result = mbdV2ToExternalRecords({
      ...parsed.data,
      meta: { ...parsed.data.meta, cheight_mm: 27 },
      primitives: [source, outerRow],
    });

    // Pipe points are the extension lines' `from`, the standoff direction
    // their direction (solver `dim_dir`), the surface distance the group's
    // innermost row (500 mm → 0.5 m), all in Design Space.
    const small = explicitLayout(result, source.id).dimension3d!;
    expect(roundNumbers(small)).toEqual({
      from: [0, 0, 0],
      to: [0.08, 0, 0],
      direction: [0, -1, 0],
      surfaceM: 0.5,
      row: 0,
      // `small`: the solver put the text past the end (label_anchor x = 116 > 80).
      outside: 'end',
    });
    const outer = explicitLayout(result, 'main-row-1').dimension3d!;
    expect(outer.row).toBe(1);
    expect(outer.outside).toBeUndefined();
    expect(roundNumbers(outer.direction)).toEqual([0, -1, 0]);

    // The flat geometry is still there for the `mbd_3d=0` fallback.
    expect(explicitLayout(result, source.id).lines).toHaveLength(3);
    expect(explicitLayout(result, source.id).arrowLines).toHaveLength(4);

    // No group cheight → no 3D presentation; likewise without two extension lines.
    const withoutCheight = mbdV2ToExternalRecords(parsed.data);
    expect(explicitLayout(withoutCheight, source.id).dimension3d).toBeUndefined();
    const bare = mbdV2ToExternalRecords({
      ...parsed.data,
      meta: { ...parsed.data.meta, cheight_mm: 27 },
      primitives: [source, { ...source, id: 'no-extensions', extension_lines: [] }],
    });
    expect(explicitLayout(bare, source.id).dimension3d).toBeDefined();
    expect(explicitLayout(bare, 'no-extensions').dimension3d).toBeUndefined();
  });

  it('takes the isoline cheight before the payload-wide one for text height and 3D row spacing (T4.2 / T4.6)', () => {
    const parsed = parseMbdV2PipeData(cliLinearFixture);
    if (!parsed.ok) throw new Error(parsed.error);
    const source = parsed.data.primitives[0]!;
    if (source.kind !== 'linear_dim') throw new Error('linear_dim fixture missing');
    // One row further out than `source` (500 mm extension lines): 532.4 mm is
    // one 1.2·27 step past the surface under the payload-wide cheight, two
    // 1.2·13.5 steps under isoline 0's.
    const outerRow = {
      ...source,
      id: 'outer',
      sub_kind: 'main',
      start: [0, -532.4, 0] as const,
      end: [80, -532.4, 0] as const,
      label_anchor: [40, -532.4, 0] as const,
      extension_lines: [
        { from: [0, 0, 0] as const, to: [0, -532.4, 0] as const },
        { from: [80, 0, 0] as const, to: [80, -532.4, 0] as const },
      ],
    };
    // source_mm payload with S(0.001): 27 mm → 0.027 m, 13.5 mm → 0.0135 m,
    // 54 mm → 0.054 m. Isoline 3 is tabled without members; 1 / 2 are not
    // tabled at all (plant-mbd skips bags without a direction).
    const meta = {
      ...parsed.data.meta,
      cheight_mm: 27,
      isolines: [
        { index: 0, members: ['24381_145018'], cheight_mm: 13.5, od_mm: 500 },
        { index: 3, members: [], cheight_mm: 54, od_mm: 500 },
      ],
    };
    const result = mbdV2ToExternalRecords({
      ...parsed.data,
      meta,
      primitives: [
        { ...source, id: 'dim-isoline-0', isoline_idx: 0 },
        { ...source, id: 'dim-isoline-3', isoline_idx: 3 },
        { ...source, id: 'dim-dangling', isoline_idx: 9 },
        { ...source, id: 'dim-unplaced' },
        { ...outerRow, id: 'outer-isoline-0', isoline_idx: 0 },
        { ...outerRow, id: 'outer-unplaced' },
        { kind: 'weld_mark', id: 'weld-isoline-0', position: [0, 0, 0], isoline_idx: 0 },
        { kind: 'aid_text', id: 'text-isoline-0', text: 'EL +1', position: [0, 0, 0], isoline_idx: 0 },
        {
          kind: 'aid_text', id: 'own-height', text: 'A:0', position: [0, 0, 0],
          text_height_mm: 12.5, isoline_idx: 3,
        },
      ],
    });

    // Isoline layer: every kind in a tabled isoline takes that isoline's height.
    expect(explicitLayout(result, 'dim-isoline-0').textHeightM).toBeCloseTo(0.0135, 12);
    expect(explicitLayout(result, 'dim-isoline-3').textHeightM).toBeCloseTo(0.054, 12);
    expect(explicitLayout(result, 'weld-isoline-0').textHeightM).toBeCloseTo(0.0135, 12);
    expect(explicitLayout(result, 'text-isoline-0').textHeightM).toBeCloseTo(0.0135, 12);
    // Payload layer: no isoline_idx, or one the table does not know (not an error).
    expect(explicitLayout(result, 'dim-unplaced').textHeightM).toBeCloseTo(0.027, 12);
    expect(explicitLayout(result, 'dim-dangling').textHeightM).toBeCloseTo(0.027, 12);
    // Primitive layer still wins over the isoline's.
    expect(explicitLayout(result, 'own-height').textHeightM).toBeCloseTo(0.0125, 12);

    // The record carries its isoline for the panel's grouping (W3-6): the
    // declared index as is (a dangling one included), no field without one.
    const isolineIndexOf = (id: string) => result.records.find(item => item.id === id)?.isolineIndex;
    expect(isolineIndexOf('dim-isoline-0')).toBe(0);
    expect(isolineIndexOf('weld-isoline-0')).toBe(0);
    expect(isolineIndexOf('own-height')).toBe(3);
    expect(isolineIndexOf('dim-dangling')).toBe(9);
    expect(result.records.find(item => item.id === 'dim-unplaced')).not.toHaveProperty('isolineIndex');

    // The 3D row is read back with the same height: 32.4 mm past the surface
    // is row 1 at the payload-wide step, row 2 at isoline 0's; the surface
    // itself stays the branch-wide lower quartile (500 mm → 0.5 m).
    expect(explicitLayout(result, 'outer-unplaced').dimension3d!.row).toBe(1);
    expect(explicitLayout(result, 'outer-isoline-0').dimension3d!.row).toBe(2);
    expect(explicitLayout(result, 'dim-isoline-0').dimension3d!.row).toBe(0);
    expect(explicitLayout(result, 'outer-isoline-0').dimension3d!.surfaceM).toBeCloseTo(0.5, 12);

    // The table alone is enough for a tabled record (height and 3D
    // presentation); an untabled one still has nothing to hang.
    const tableOnly = mbdV2ToExternalRecords({
      ...parsed.data,
      meta: { ...meta, cheight_mm: null },
      primitives: [
        { ...source, id: 'dim-isoline-0', isoline_idx: 0 },
        { ...source, id: 'dim-unplaced' },
        { ...outerRow, id: 'outer-isoline-0', isoline_idx: 0 },
        { ...outerRow, id: 'outer-unplaced' },
      ],
    });
    expect(explicitLayout(tableOnly, 'outer-isoline-0').textHeightM).toBeCloseTo(0.0135, 12);
    expect(explicitLayout(tableOnly, 'outer-isoline-0').dimension3d!.row).toBe(2);
    expect(explicitLayout(tableOnly, 'outer-unplaced').textHeightM).toBeUndefined();
    expect(explicitLayout(tableOnly, 'outer-unplaced').dimension3d).toBeUndefined();

    // The table's od_mm is the solver's own innermost-row offset for that
    // isoline, so its records read the surface from it (467.6 mm → 0.4676 m)
    // while untabled ones keep the branch-wide quartile (0.5 m).
    const ownSurface = mbdV2ToExternalRecords({
      ...parsed.data,
      meta: {
        ...meta,
        isolines: [{ index: 0, members: ['24381_145018'], cheight_mm: 13.5, od_mm: 467.6 }],
      },
      primitives: [
        { ...source, id: 'dim-isoline-0', isoline_idx: 0 },
        { ...source, id: 'dim-unplaced' },
        { ...outerRow, id: 'outer-isoline-0', isoline_idx: 0 },
        { ...outerRow, id: 'outer-unplaced' },
      ],
    });
    expect(explicitLayout(ownSurface, 'outer-isoline-0').dimension3d!.surfaceM).toBeCloseTo(0.4676, 12);
    expect(explicitLayout(ownSurface, 'outer-isoline-0').dimension3d!.row).toBe(4);
    expect(explicitLayout(ownSurface, 'dim-isoline-0').dimension3d!.row).toBe(2);
    expect(explicitLayout(ownSurface, 'outer-unplaced').dimension3d!.surfaceM).toBeCloseTo(0.5, 12);
    expect(explicitLayout(ownSurface, 'outer-unplaced').dimension3d!.row).toBe(1);
  });

  describe('polar placement opt-in (T3.6a)', () => {
    // `cliLinearFixture`: source_mm, S(0.001). The one `linear_dim` runs
    // start=[0,-500,0] end=[80,-500,0] mm -> Design [0,-0.5,0]..[0.08,-0.5,0],
    // a 0.08 m axis along +X.
    function fixture() {
      const parsed = parseMbdV2PipeData(cliLinearFixture);
      if (!parsed.ok) throw new Error(parsed.error);
      const source = parsed.data.primitives[0]!;
      if (source.kind !== 'linear_dim') throw new Error('linear_dim fixture missing');
      return { data: parsed.data, source };
    }

    it('attaches polar when the label shares an isoline with a linear_dim and the table has od_mm', () => {
      const { data, source } = fixture();
      const meta = {
        ...data.meta,
        isolines: [{ index: 0, members: ['m'], cheight_mm: 13.5, od_mm: 500 }],
      };
      const result = mbdV2ToExternalRecords({
        ...data,
        meta,
        primitives: [
          { ...source, isoline_idx: 0 },
          {
            kind: 'label', id: 'tag-on-isoline', text: 'X 1',
            position: [40, -500, 0], isoline_idx: 0,
          },
        ],
      });

      const polar = explicitLayout(result, 'tag-on-isoline').polar;
      expect(polar).toBeDefined();
      // Axis through Design Space start/end (×0.001), basicRadius = od/2 = 0.25 m.
      expect(polar!.origin).toEqual([0, -0.5, 0]);
      expect(polar!.axis).toEqual([1, 0, 0]);
      expect(polar!.basicRadiusM).toBeCloseTo(0.25, 12);
      // The label sits at the axis midpoint (x=40mm -> 0.04m of the 0.08m span).
      expect(polar!.disRange[0]).toBeLessThan(0.04);
      expect(polar!.disRange[1]).toBeGreaterThan(0.04);
      expect(polar!.textHeightM).toBeCloseTo(0.0135, 12);
      // T3.6b: the group key names the isoline, matching the `linear_dim`'s
      // own `polarObstacle.groupKey` below (same isoline -> same group).
      expect(polar!.groupKey).toBe('isoline:0');
    });

    it('omits polar when the label has no isoline_idx', () => {
      const { data, source } = fixture();
      const meta = {
        ...data.meta,
        isolines: [{ index: 0, members: ['m'], cheight_mm: 13.5, od_mm: 500 }],
      };
      const result = mbdV2ToExternalRecords({
        ...data,
        meta,
        primitives: [
          { ...source, isoline_idx: 0 },
          { kind: 'label', id: 'tag-unplaced', text: 'X 1', position: [40, -500, 0] },
        ],
      });
      expect(explicitLayout(result, 'tag-unplaced').polar).toBeUndefined();
    });

    it('omits polar when no linear_dim shares the label\'s isoline', () => {
      const { data, source } = fixture();
      const meta = {
        ...data.meta,
        isolines: [{ index: 0, members: ['m'], cheight_mm: 13.5, od_mm: 500 }],
      };
      const result = mbdV2ToExternalRecords({
        ...data,
        meta,
        primitives: [
          { ...source, isoline_idx: 1 },
          {
            kind: 'label', id: 'tag-no-axis', text: 'X 1',
            position: [40, -500, 0], isoline_idx: 0,
          },
        ],
      });
      expect(explicitLayout(result, 'tag-no-axis').polar).toBeUndefined();
    });

    it('reads the pipe axis from meta.isolines[].axis in preference to the linear_dim line', () => {
      const { data, source } = fixture();
      // The pipe runs along +X at y=0; the dimension row (y=-500mm) sits one
      // outer diameter off it, which is what the linear_dim fallback used to
      // hand over as the axis.
      const meta = {
        ...data.meta,
        isolines: [{
          index: 0, members: ['m'], cheight_mm: 13.5, od_mm: 500,
          axis: { from: [0, 0, 0] as const, to: [80, 0, 0] as const },
        }],
      };
      const result = mbdV2ToExternalRecords({
        ...data,
        meta,
        primitives: [
          { ...source, isoline_idx: 0 },
          {
            kind: 'label', id: 'tag-on-axis', text: 'X 1',
            position: [40, -500, 0], isoline_idx: 0,
          },
        ],
      });

      const polar = explicitLayout(result, 'tag-on-axis').polar;
      expect(polar).toBeDefined();
      expect(polar!.origin).toEqual([0, 0, 0]);
      expect(polar!.axis).toEqual([1, 0, 0]);
      expect(polar!.basicRadiusM).toBeCloseTo(0.25, 12);
      expect(polar!.disRange[0]).toBeLessThan(0.04);
      expect(polar!.disRange[1]).toBeGreaterThan(0.04);
    });

    it('attaches polar from a declared axis even when no linear_dim shares the isoline', () => {
      const { data, source } = fixture();
      const meta = {
        ...data.meta,
        isolines: [{
          index: 0, members: ['m'], cheight_mm: 13.5, od_mm: 500,
          axis: { from: [0, 0, 0] as const, to: [80, 0, 0] as const },
        }],
      };
      const result = mbdV2ToExternalRecords({
        ...data,
        meta,
        primitives: [
          { ...source, isoline_idx: 1 },
          {
            kind: 'label', id: 'tag-axis-only', text: 'X 1',
            position: [40, -500, 0], isoline_idx: 0,
          },
        ],
      });

      const polar = explicitLayout(result, 'tag-axis-only').polar;
      expect(polar?.origin).toEqual([0, 0, 0]);
      expect(polar?.axis).toEqual([1, 0, 0]);
      expect(polar?.groupKey).toBe('isoline:0');
    });

    it('omits polar when the isoline table has no od_mm for that index', () => {
      const { data, source } = fixture();
      const result = mbdV2ToExternalRecords({
        ...data,
        meta: { ...data.meta, isolines: [] },
        primitives: [
          { ...source, isoline_idx: 0 },
          {
            kind: 'label', id: 'tag-no-od', text: 'X 1',
            position: [40, -500, 0], isoline_idx: 0,
          },
        ],
      });
      expect(explicitLayout(result, 'tag-no-od').polar).toBeUndefined();
    });
  });

  describe('same-pipe polar obstacles (T3.6b)', () => {
    function fixture() {
      const parsed = parseMbdV2PipeData(cliLinearFixture);
      if (!parsed.ok) throw new Error(parsed.error);
      const source = parsed.data.primitives[0]!;
      if (source.kind !== 'linear_dim') throw new Error('linear_dim fixture missing');
      return { data: parsed.data, source };
    }

    it('a linear_dim with an isoline_idx carries polarObstacle naming that isoline', () => {
      const { data, source } = fixture();
      const result = mbdV2ToExternalRecords({
        ...data,
        primitives: [{ ...source, isoline_idx: 0 }],
      });
      expect(explicitLayout(result, source.id).polarObstacle).toEqual({ groupKey: 'isoline:0' });
    });

    it('a linear_dim without an isoline_idx carries no polarObstacle (v1 behaviour)', () => {
      const { data, source } = fixture();
      const result = mbdV2ToExternalRecords({ ...data, primitives: [source] });
      expect(explicitLayout(result, source.id).polarObstacle).toBeUndefined();
    });

    it('a label\'s polar.groupKey and its same-isoline linear_dim\'s '
      + 'polarObstacle.groupKey agree, so layoutViewport treats them as one group', () => {
      const { data, source } = fixture();
      const meta = {
        ...data.meta,
        isolines: [{ index: 0, members: ['m'], cheight_mm: 13.5, od_mm: 500 }],
      };
      const result = mbdV2ToExternalRecords({
        ...data,
        meta,
        primitives: [
          { ...source, isoline_idx: 0 },
          {
            kind: 'label', id: 'tag-on-isoline', text: 'X 1',
            position: [40, -500, 0], isoline_idx: 0,
          },
        ],
      });
      const label = explicitLayout(result, 'tag-on-isoline');
      const dim = explicitLayout(result, source.id);
      expect(label.polar?.groupKey).toBe(dim.polarObstacle?.groupKey);
    });
  });

  describe('aid_text never opts into polar (T3.6b ruling)', () => {
    // PML: every producer call site either builds a throwaway leg-frame
    // `polarsystem` that explicitly skips `this.polarsystem.add` (skew-leg
    // X:/Y:/Z: text, `isoline.pmlobj:2480-2521`, call sites `:2388`/`:2431`)
    // or places the text at a fixed offset with no polar call at all
    // (`drawslope`, `:2568-2591`; weld-length adjustment, `:2141-2147`).
    // plant-mbd mirrors this: every `AidText` the Rust producer emits sets
    // `isoline_idx: None` (`slope.rs:295-303`, `angle.rs:524-532`,
    // `adjust_weld.rs:205-211`).
    function fixture() {
      const parsed = parseMbdV2PipeData(cliLinearFixture);
      if (!parsed.ok) throw new Error(parsed.error);
      const source = parsed.data.primitives[0]!;
      if (source.kind !== 'linear_dim') throw new Error('linear_dim fixture missing');
      return { data: parsed.data, source };
    }

    it('an aid_text with no isoline_idx (the real-world shape) gets no polar', () => {
      const { data, source } = fixture();
      const result = mbdV2ToExternalRecords({
        ...data,
        primitives: [
          source,
          { kind: 'aid_text', id: 'aid-no-isoline', text: 'X: 12', position: [40, -500, 0] },
        ],
      });
      const layout = explicitLayout(result, 'aid-no-isoline');
      expect(layout.polar).toBeUndefined();
      expect(layout.polarObstacle).toBeUndefined();
    });

    it('an aid_text with an isoline_idx that does share a linear_dim + od_mm '
      + 'still gets no polar — the ruling holds even when every other fact '
      + 'a `label` would need is present', () => {
      const { data, source } = fixture();
      const meta = {
        ...data.meta,
        isolines: [{ index: 0, members: ['m'], cheight_mm: 13.5, od_mm: 500 }],
      };
      const result = mbdV2ToExternalRecords({
        ...data,
        meta,
        primitives: [
          { ...source, isoline_idx: 0 },
          {
            kind: 'aid_text', id: 'aid-on-isoline', text: 'X: 12',
            position: [40, -500, 0], isoline_idx: 0,
          },
        ],
      });
      const layout = explicitLayout(result, 'aid-on-isoline');
      expect(layout.polar).toBeUndefined();
      expect(layout.polarObstacle).toBeUndefined();
    });
  });
});
