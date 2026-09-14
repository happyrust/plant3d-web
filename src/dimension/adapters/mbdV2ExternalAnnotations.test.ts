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
});
