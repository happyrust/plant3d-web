import { describe, expect, it } from 'vitest';

import {
  LINE_ANGLE_ANGLE_SNAP_DEG,
  LINE_ANGLE_DIRECTION_SNAP,
  LINE_ANGLE_IN_PLANE_RADIUS_M,
  LINE_ANGLE_MIN_RADIUS_M,
  LINE_ANGLE_PARALLEL_TOLERANCE_DEG,
  buildLineAngle,
  lineAngleArmEnd,
  lineAngleOperandFromGeometry,
  snapLineAngleDegrees,
  snapLineAngleDirection,
  type LineAngleLineOperand,
  type LineAnglePlaneOperand,
} from './lineAngle';
import { buildThreePointAngle } from './threePointAngle';

import type { PickVec3 } from './pickDerivation';

function line(start: PickVec3, end: PickVec3, picked: PickVec3): LineAngleLineOperand {
  return { kind: 'line', start, end, picked };
}

function plane(position: PickVec3, normal: PickVec3, xDirection?: PickVec3): LineAnglePlaneOperand {
  return { kind: 'plane', position, normal, ...(xDirection ? { xDirection } : {}) };
}

function expectVec(actual: PickVec3, expected: PickVec3, digits = 9): void {
  expect(actual[0]).toBeCloseTo(expected[0], digits);
  expect(actual[1]).toBeCloseTo(expected[1], digits);
  expect(actual[2]).toBeCloseTo(expected[2], digits);
}

function ok(result: ReturnType<typeof buildLineAngle>) {
  if (!result.ok) throw new Error(`expected ok, got ${result.reason}`);
  return result.value;
}

const COS60 = 0.5;
const SIN60 = Math.sqrt(3) / 2;

// `radius2Lines` 802–917: base line along E through the origin, reference line along N at x = 1.
const BASE_E = line([0, 0, 0], [2, 0, 0], [1.5, 0, 0]);
const REF_N = line([1, -1, 0], [1, 1, 0], [1, 0.5, 0]);

describe('buildLineAngle · two lines (gmfArc.radius2Lines, two-edge branch)', () => {
  it('coplanar crossing lines: root at the intersection, arms E / N, 90°, plane normal from arm order', () => {
    const value = ok(buildLineAngle(BASE_E, REF_N));
    expect(value.kind).toBe('line-line');
    expectVec(value.root, [1, 0, 0]);
    expectVec(value.direction1, [1, 0, 0]);
    expectVec(value.direction2, [0, 1, 0]);
    expect(value.angleDeg).toBeCloseTo(90, 9);
    expectVec(value.planeNormal!, [0, 0, 1]);
    expect(value.skew).toBe(false);
    expect(value.gapM).toBeCloseTo(0, 12);
    expect(value.inPlane).toBe(false);
    // root inside the base segment → half of the shorter line (both 2 m) = 1 m.
    expect(value.radiusM).toBeCloseTo(1, 9);
  });

  it('the picked side of the reference line decides the second arm (871–890 direction flip)', () => {
    const value = ok(buildLineAngle(BASE_E, line([1, -1, 0], [1, 1, 0], [1, -0.5, 0])));
    expectVec(value.direction2, [0, -1, 0]);
    expect(value.angleDeg).toBeCloseTo(90, 9);
    expectVec(value.planeNormal!, [0, 0, -1]);
  });

  it('oblique lines report the angle between the picked half-lines: 60° or its supplement 120°', () => {
    const d: PickVec3 = [COS60, SIN60, 0];
    const ref = (picked: PickVec3) => line([1 - d[0], -d[1], 0], [1 + d[0], d[1], 0], picked);
    const near = ok(buildLineAngle(BASE_E, ref([1 + 0.25, 0.25 * Math.sqrt(3), 0])));
    expect(near.angleDeg).toBeCloseTo(60, 9);
    expectVec(near.direction2, d);
    const far = ok(buildLineAngle(BASE_E, ref([1 - 0.25, -0.25 * Math.sqrt(3), 0])));
    expect(far.angleDeg).toBeCloseTo(120, 9);
    expectVec(far.direction2, [-COS60, -SIN60, 0]);
    // Picking the base line on the other side of the root flips Direction1 the same way.
    const baseLeft = line([0, 0, 0], [2, 0, 0], [0.5, 0, 0]);
    const left = ok(buildLineAngle(baseLeft, ref([1 + 0.25, 0.25 * Math.sqrt(3), 0])));
    expectVec(left.direction1, [-1, 0, 0]);
    expect(left.angleDeg).toBeCloseTo(120, 9);
  });

  it('skew lines: root on the base line nearest the reference, second arm moved onto the root, gap reported', () => {
    const value = ok(buildLineAngle(BASE_E, line([1, -1, 0.3], [1, 1, 0.3], [1, 0.5, 0.3])));
    expectVec(value.root, [1, 0, 0]);
    expectVec(value.direction1, [1, 0, 0]);
    expectVec(value.direction2, [0, 1, 0]);
    expect(value.angleDeg).toBeCloseTo(90, 9);
    expect(value.skew).toBe(true);
    expect(value.gapM).toBeCloseTo(0.3, 9);
  });

  it('parallel lines cannot make an arc (E3D "Unable to derive arc from given lines")', () => {
    const result = buildLineAngle(BASE_E, line([0, 1, 0], [2, 1, 0], [1, 1, 0]));
    expect(result).toEqual({ ok: false, reason: 'parallel-lines' });
    const antiParallel = buildLineAngle(BASE_E, line([2, 1, 0.5], [0, 1, 0.5], [1, 1, 0.5]));
    expect(antiParallel).toEqual({ ok: false, reason: 'parallel-lines' });
  });

  it('design-parallel mesh edges a few 1e-5 rad apart count as parallel (Web tolerance 0.01°), 0.02° apart do not', () => {
    // Live case (PANE edge vs SCTN edge, float32 vertices): directions 1e-5 rad apart, offset 5.9 m —
    // a bare cross-product test put the root 762 km away and reported 0.0004°.
    const tiny = Math.tan((0.0004 * Math.PI) / 180);
    const almostParallel = buildLineAngle(BASE_E, line([0, 5.9, 0], [2, 5.9 + 2 * tiny, 0], [1, 5.9 + tiny, 0]));
    expect(almostParallel).toEqual({ ok: false, reason: 'parallel-lines' });
    expect(LINE_ANGLE_PARALLEL_TOLERANCE_DEG).toBe(0.01);
    // Twice the tolerance is a real (if tiny) angle and still resolves, far root and all.
    const small = Math.tan((0.02 * Math.PI) / 180);
    const resolved = ok(buildLineAngle(BASE_E, line([0, 5.9, 0], [2, 5.9 + 2 * small, 0], [1, 5.9 + small, 0])));
    expect(resolved.angleDeg).toBeCloseTo(0.02, 6);
    // The same tolerance rejects a line lying 0.005° off a plane it does not touch.
    const grazing = buildLineAngle(
      line([0, 0, 1], [2, 0, 1 + 2 * Math.tan((0.005 * Math.PI) / 180)], [1, 0, 1]),
      plane([0, 0, 0], [0, 0, 1]),
    );
    expect(grazing).toEqual({ ok: false, reason: 'line-parallel-to-plane' });
  });

  it('root outside the base segment: Direction1 points back towards the pick, radius = distance to the nearer base end (892–894)', () => {
    const value = ok(buildLineAngle(line([0, 0, 0], [1, 0, 0], [0.8, 0, 0]), line([3, -1, 0], [3, 1, 0], [3, 0.5, 0])));
    expectVec(value.root, [3, 0, 0]);
    expectVec(value.direction1, [-1, 0, 0]);
    expect(value.angleDeg).toBeCloseTo(90, 9);
    expect(value.radiusM).toBeCloseTo(2, 9);
  });

  it('radius never drops below 500 mm (901–903)', () => {
    const value = ok(buildLineAngle(
      line([0, 0, 0], [0.2, 0, 0], [0.15, 0, 0]),
      line([0.1, -0.1, 0], [0.1, 0.1, 0], [0.1, 0.05, 0]),
    ));
    expect(value.radiusM).toBe(LINE_ANGLE_MIN_RADIUS_M);
  });

  it('a pick exactly at the root keeps the stored line direction (Web resolution of the 858–863 corner case)', () => {
    const value = ok(buildLineAngle(line([0, 0, 0], [2, 0, 0], [1, 0, 0]), REF_N));
    expectVec(value.direction1, [1, 0, 0]);
    expect(value.angleDeg).toBeCloseTo(90, 9);
  });

  it('arm ends at the radius reproduce the arc through the three-point kernel (same Measure Angle form)', () => {
    const value = ok(buildLineAngle(BASE_E, REF_N));
    const first = lineAngleArmEnd(value, 'first');
    const second = lineAngleArmEnd(value, 'second');
    expectVec(first, [2, 0, 0]);
    expectVec(second, [1, 1, 0]);
    const built = buildThreePointAngle(value.root, first, second);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.value.angleDeg).toBeCloseTo(value.angleDeg, 9);
    expectVec(built.value.direction1, value.direction1);
    expectVec(built.value.direction2, value.direction2);
    expect(built.value.radiusM).toBeCloseTo(value.radiusM, 9);
  });
});

describe('buildLineAngle · line + facet plane (radius2Lines 826–854 projected-line branch)', () => {
  const GROUND = plane([0, 0, 0], [0, 0, 1]);

  it('general case: root where the base line pierces the plane, second arm = projection, acute angle', () => {
    const value = ok(buildLineAngle(line([0, 0, 0], [1, 0, 1], [0.8, 0, 0.8]), GROUND));
    expect(value.kind).toBe('line-plane');
    expectVec(value.root, [0, 0, 0]);
    expectVec(value.direction1, [Math.SQRT1_2, 0, Math.SQRT1_2]);
    expectVec(value.direction2, [1, 0, 0]);
    expect(value.angleDeg).toBeCloseTo(45, 9);
    expectVec(value.planeNormal!, [0, 1, 0]);
    expect(value.inPlane).toBe(false);
    // reference = projected line (1 m) → half of the shorter line = 0.5 m.
    expect(value.radiusM).toBeCloseTo(0.5, 9);
  });

  it('the projected arm follows the picked side, so the angle stays the acute line–plane angle', () => {
    const value = ok(buildLineAngle(line([-1, 0, -1], [1, 0, 1], [-0.5, 0, -0.5]), GROUND));
    expectVec(value.root, [0, 0, 0]);
    expectVec(value.direction1, [-Math.SQRT1_2, 0, -Math.SQRT1_2]);
    expectVec(value.direction2, [-1, 0, 0]);
    expect(value.angleDeg).toBeCloseTo(45, 9);
  });

  it('base line lying in the plane: E3D zero-angle arc (radius 100 mm, both arms along the line)', () => {
    const value = ok(buildLineAngle(line([0, 0, 0], [1, 0, 0], [0.5, 0, 0]), GROUND));
    expect(value.inPlane).toBe(true);
    expect(value.angleDeg).toBe(0);
    expectVec(value.root, [0, 0, 0]);
    expectVec(value.direction1, [1, 0, 0]);
    expectVec(value.direction2, [1, 0, 0]);
    expect(value.radiusM).toBe(LINE_ANGLE_IN_PLANE_RADIUS_M);
    expect(value.planeNormal).toBeNull();
    // 0.1 mm tolerance (830): a line 0.05 mm above the plane still counts as lying in it.
    expect(ok(buildLineAngle(line([0, 0, 0.00005], [1, 0, 0.00005], [0.5, 0, 0.00005]), GROUND)).inPlane).toBe(true);
    expect(buildLineAngle(line([0, 0, 0.0002], [1, 0, 0.0002], [0.5, 0, 0.0002]), GROUND)).toEqual({
      ok: false,
      reason: 'line-parallel-to-plane',
    });
  });

  it('base line perpendicular to the plane: 90° against an in-plane direction (840–843, item X or a world axis)', () => {
    const value = ok(buildLineAngle(line([0, 0, -1], [0, 0, 1], [0, 0, 0.5]), GROUND));
    expectVec(value.root, [0, 0, 0]);
    expectVec(value.direction1, [0, 0, 1]);
    expectVec(value.direction2, [1, 0, 0]);
    expect(value.angleDeg).toBeCloseTo(90, 9);
    expect(value.radiusM).toBeCloseTo(1, 9);
    const withX = ok(buildLineAngle(line([0, 0, -1], [0, 0, 1], [0, 0, -0.5]), plane([0, 0, 0], [0, 0, 1], [0, 1, 0])));
    expectVec(withX.direction1, [0, 0, -1]);
    expectVec(withX.direction2, [0, 1, 0]);
    expect(withX.angleDeg).toBeCloseTo(90, 9);
  });

  it('base line parallel to the plane but off it: its projection is parallel → no arc', () => {
    expect(buildLineAngle(line([0, 0, 1], [1, 0, 1], [0.5, 0, 1]), GROUND)).toEqual({
      ok: false,
      reason: 'line-parallel-to-plane',
    });
  });

  it('accepts a plane given with an unnormalised normal and an arbitrary position on it', () => {
    const tilted = plane([5, 5, 5], [0, 0, 3]);
    const value = ok(buildLineAngle(line([0, 0, 5], [1, 0, 6], [0.8, 0, 5.8]), tilted));
    expectVec(value.root, [0, 0, 5]);
    expect(value.angleDeg).toBeCloseTo(45, 9);
  });
});

describe('buildLineAngle · mesh-noise snapping of the finished arc (Web resolution, golden MD §30「补采」)', () => {
  it('snapLineAngleDirection zeroes components below 1e-6 and re-normalises; real components stay', () => {
    // Live: the projected arm of the 70° tilted-box case came back as (1.2e-9, 1.7e-9, 1) → `N 35.00 E 90.00 U`.
    expect(snapLineAngleDirection([1.2101366035762613e-9, 1.7282620438027327e-9, 1])).toEqual([0, 0, 1]);
    const nearNorth = snapLineAngleDirection([-2e-7, 0.9999999999999998, 3e-9]);
    expect(nearNorth[0]).toBe(0);
    expect(nearNorth[2]).toBe(0);
    expect(nearNorth[1]).toBeCloseTo(1, 12);
    // A genuine small component (sin 0.01° ≈ 1.7e-4) is not noise and survives.
    const slightlyOff = snapLineAngleDirection([Math.cos(0.01 * Math.PI / 180), Math.sin(0.01 * Math.PI / 180), 0]);
    expect(slightlyOff[1]).toBeCloseTo(Math.sin(0.01 * Math.PI / 180), 12);
    expectVec(snapLineAngleDirection([0.6, 0.8, 0]), [0.6, 0.8, 0], 12);
    expect(LINE_ANGLE_DIRECTION_SNAP).toBe(1e-6);
  });

  it('snapLineAngleDegrees rounds to the 1e-5° grid and folds -0', () => {
    // Live: design 70° came back as 69.9999979° (mesh noise ~2e-6°) → E3D's truncating DMS showed `69° 59' 59''`.
    expect(snapLineAngleDegrees(69.99999788835548)).toBe(70);
    expect(snapLineAngleDegrees(64.5400279535944)).toBe(64.54003);
    expect(snapLineAngleDegrees(89.99956)).toBe(89.99956);
    expect(snapLineAngleDegrees(-4e-7)).toBe(0);
    expect(Object.is(snapLineAngleDegrees(-4e-7), -0)).toBe(false);
    expect(LINE_ANGLE_ANGLE_SNAP_DEG).toBe(1e-5);
  });

  it('the finished arc is measured between the snapped arms: axis-aligned projection prints as a bare axis, DMS lands on 70° 0\' 0\'\'', () => {
    // The live 70° case: a box tilted 70° about Y (its Z axis rises 20°) against a vertical side face whose normal is
    // the horizontal box's X axis — mesh-derived inputs carry ~1e-8 noise per component.
    const d = [-0.7697511183832466, 0.5389855411949357, 0.3420201779581775] as const;
    const n = [0.8191520419506295, -0.5735764396905736, 0] as const;
    const start: PickVec3 = [10.3, 14.0, 0.27];
    const end: PickVec3 = [start[0] + d[0] * 0.15, start[1] + d[1] * 0.15, start[2] + d[2] * 0.15];
    const value = ok(buildLineAngle(line(start, end, [start[0] + d[0] * 0.1, start[1] + d[1] * 0.1, start[2] + d[2] * 0.1]), plane([10.3955, 14.0269, 0.5271], [n[0], n[1], n[2]])));
    expect(value.kind).toBe('line-plane');
    // The projected arm is geometrically vertical: snapped to exactly U (it came back as (1.2e-9, 1.7e-9, 1) live).
    expect(value.direction2).toEqual([0, 0, 1]);
    expect(value.angleDeg).toBe(70);
    // DMS truncation (E3D 360–363) on the snapped angle: 70° 0' 0'' rather than 69° 59' 59''.
    const deg = Math.trunc(value.angleDeg);
    const min = Math.trunc((value.angleDeg - deg) * 60);
    const sec = Math.trunc((value.angleDeg - deg - min / 60) * 3600);
    expect([deg, min, sec]).toEqual([70, 0, 0]);
    // The first arm keeps its real (non-axis) components — only sub-1e-6 noise is removed.
    expectVec(value.direction1, [d[0], d[1], d[2]], 9);
    // Arm ends and the plane normal follow the snapped arms.
    expectVec(lineAngleArmEnd(value, 'second'), [value.root[0], value.root[1], value.root[2] + value.radiusM], 12);
    expectVec(value.planeNormal!, [0.5735764396905736, 0.8191520419506295, 0], 6);
  });

  it('exact inputs are unchanged by the snapping (grid values pass through)', () => {
    const value = ok(buildLineAngle(BASE_E, REF_N));
    expect(value.angleDeg).toBe(90);
    expect(value.direction1).toEqual([1, 0, 0]);
    expect(value.direction2).toEqual([0, 1, 0]);
  });
});

describe('buildLineAngle · degenerate input', () => {
  it('rejects zero-length lines, degenerate planes and non-finite coordinates', () => {
    expect(buildLineAngle(line([0, 0, 0], [0, 0, 0], [0, 0, 0]), REF_N)).toEqual({ ok: false, reason: 'zero-length-line' });
    expect(buildLineAngle(BASE_E, line([1, 1, 0], [1, 1, 0], [1, 1, 0]))).toEqual({ ok: false, reason: 'zero-length-line' });
    expect(buildLineAngle(BASE_E, plane([0, 0, 0], [0, 0, 0]))).toEqual({ ok: false, reason: 'degenerate-plane' });
    expect(buildLineAngle(line([Number.NaN, 0, 0], [1, 0, 0], [0.5, 0, 0]), REF_N)).toEqual({ ok: false, reason: 'non-finite-input' });
    expect(buildLineAngle(BASE_E, line([1, -1, 0], [1, 1, 0], [1, Number.POSITIVE_INFINITY, 0]))).toEqual({
      ok: false,
      reason: 'non-finite-input',
    });
    expect(buildLineAngle(BASE_E, plane([0, 0, 0], [0, Number.NaN, 1]))).toEqual({ ok: false, reason: 'non-finite-input' });
  });
});

/**
 * `gmfAngle.betweenLines(base, reference)` 照 PML 源独立实现一遍（`gmfangle.pmlobj` 81–103），
 * 只用来和本文件实现的 `radius2Lines` 对数：
 * root = `baseLine.intersection(referenceLine)`；plane = 过 root、Z = base ⊥ reference 的平面；
 * 角 = `root.angle(baseLine ∩ base.pointVector, plane.near(referenceLine ∩ reference.pointVector))`；
 * 两线平行时 `LINE.intersection` 抛错被 `handle any` 吞掉，角置 0 并返回 0。
 */
function betweenLinesDeg(base: LineAngleLineOperand, reference: LineAngleLineOperand): number {
  const sub = (a: PickVec3, b: PickVec3): PickVec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const dot = (a: PickVec3, b: PickVec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a: PickVec3, b: PickVec3): PickVec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const len = (a: PickVec3): number => Math.sqrt(dot(a, a));
  const unit = (a: PickVec3): PickVec3 => { const l = len(a); return [a[0] / l, a[1] / l, a[2] / l]; };
  const along = (from: PickVec3, direction: PickVec3, t: number): PickVec3 => [from[0] + direction[0] * t, from[1] + direction[1] * t, from[2] + direction[2] * t];
  /** `LINE.intersection(POINTVECTOR)`：拾取落到线上的那一点。 */
  const onLine = (point: PickVec3, from: PickVec3, direction: PickVec3): PickVec3 => along(from, direction, dot(sub(point, from), direction));

  const baseDirection = unit(sub(base.end, base.start));
  const referenceDirection = unit(sub(reference.end, reference.start));
  const orthogonal = cross(baseDirection, referenceDirection);
  if (len(orthogonal) <= 1e-12) return 0;
  // 89：共面取交点，异面取第一条线上离第二条最近的点（与 radius2Lines 同一条 LINE.intersection 读法）。
  const w = sub(reference.start, base.start);
  const root = along(base.start, baseDirection, dot(cross(w, referenceDirection), orthogonal) / dot(orthogonal, orthogonal));
  // 101：基线上的拾中点，与参照线上的拾中点在那张平面上的投影（plane.near）。
  const normal = unit(orthogonal);
  const first = onLine(base.picked, base.start, baseDirection);
  const pickedOnReference = onLine(reference.picked, reference.start, referenceDirection);
  const second = along(pickedOnReference, normal, -dot(sub(pickedOnReference, root), normal));
  const arm1 = unit(sub(first, root));
  const arm2 = unit(sub(second, root));
  return (Math.atan2(len(cross(arm1, arm2)), dot(arm1, arm2)) * 180) / Math.PI;
}

/**
 * E3D 的另一条两线角命令 `EDGPICKPACKET.measureLineAngle`（`edgpickpacket.pmlobj` 667–683，提示矩阵 D6）：
 * 两击都只拾 `EDGE`，action 是 `gmfAngle.betweenLines(...)`，出来的是一个 REAL 而不是 ARC——不画弧，
 * 也进不了 Measure Angle 窗体（`gphAngleMeasure.setMeasure` 只收 `ARC`）。`defineMeasure('LINEANGLE')` 的调用方
 * 是三张设计表单的「Angle between two lines」菜单项（`dbeelementangle.pmlfrm` 799 / `dbesrevolution.pmlfrm` 658 /
 * `dbeloopedit.pmlfrm` 1716），量到的角度直接填进表单的角度输入框；Measure 功能区那颗 `Angle 2 Lines` 走的是
 * `gphViews.measure('LINEANGLE')` → `GPHANGLEDIMENSION.edit('LINEANGLEARC')` → `measureLineAngleArc`，也就是本文件实现的画弧那条。
 * Web 没有「把量到的角填进设计表单」这种入口，所以不另做一个模式；这一组钉的是数值口径：同一对线上
 * `betweenLines` 与 `radius2Lines` 的 `endAngle` 相等，差别只在平行那一档。
 */
describe('gmfAngle.betweenLines（E3D measureLineAngle，提示矩阵 D6）：角与 radius2Lines 相等，平行时它返回 0', () => {
  it('共面 / 异面、拾中哪一侧，两条包给的角一样——非弧包把参照线的拾中点投到弧面上，画弧那条把参照线平移到弧心，同一个操作', () => {
    const oblique = (pickFar: boolean) => line(
      [1 - COS60, -SIN60, 0],
      [1 + COS60, SIN60, 0],
      pickFar ? [1 - 0.25, -0.25 * Math.sqrt(3), 0] : [1 + 0.25, 0.25 * Math.sqrt(3), 0],
    );
    const cos64 = Math.cos((64.54 * Math.PI) / 180);
    const sin64 = Math.sin((64.54 * Math.PI) / 180);
    const cases: readonly (readonly [string, LineAngleLineOperand, LineAngleLineOperand])[] = [
      ['共面正交 90°', BASE_E, REF_N],
      ['共面斜交 60°', BASE_E, oblique(false)],
      ['共面斜交 · 拾参照线另一侧 → 补角 120°', BASE_E, oblique(true)],
      ['共面斜交 · 拾基线另一侧 → 补角', line([0, 0, 0], [2, 0, 0], [0.5, 0, 0]), oblique(false)],
      ['异面正交（gap 0.3 m）', BASE_E, line([1, -1, 0.3], [1, 1, 0.3], [1, 0.5, 0.3])],
      ['异面斜交 64.54°（gap 0.42 m）', BASE_E, line([1 - cos64, -sin64, 0.42], [1 + cos64, sin64, 0.42], [1 + 0.3 * cos64, 0.3 * sin64, 0.42])],
      ['弧心落在基线段外', line([0, 0, 0], [1, 0, 0], [0.8, 0, 0]), line([3, -1, 0], [3, 1, 0], [3, 0.5, 0])],
    ];
    for (const [name, base, reference] of cases) {
      expect(ok(buildLineAngle(base, reference)).angleDeg, name).toBeCloseTo(betweenLinesDeg(base, reference), 5);
    }
    // 补角那两组确实是补角，不是同一个数碰巧相等。
    expect(betweenLinesDeg(BASE_E, oblique(false))).toBeCloseTo(60, 9);
    expect(betweenLinesDeg(BASE_E, oblique(true))).toBeCloseTo(120, 9);
  });

  it('平行：非弧包 handle any 吞掉交点错误、返回 0（91–94）；画弧那条报 E3D 那句话，Web 照画弧那条拒收', () => {
    const parallel = line([0, 1, 0], [2, 1, 0], [1, 1, 0]);
    expect(betweenLinesDeg(BASE_E, parallel)).toBe(0);
    expect(buildLineAngle(BASE_E, parallel)).toEqual({ ok: false, reason: 'parallel-lines' });
  });

  it('随机化对数：固定种子 200 对随机线（偶数共面 / 奇数异面，拾中点落段内 / 段外、根点两侧），两条包的角逐对相等到 1e-4°', () => {
    // mulberry32：固定种子，跑多少次都是同一批线对，失败时按序号就能复现。
    let seed = 0x5eed06d6;
    const rand = (): number => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const span = (lo: number, hi: number): number => lo + (hi - lo) * rand();
    const cross = (a: PickVec3, b: PickVec3): PickVec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const len = (a: PickVec3): number => Math.hypot(a[0], a[1], a[2]);
    const at = (from: PickVec3, direction: PickVec3, t: number): PickVec3 => [from[0] + direction[0] * t, from[1] + direction[1] * t, from[2] + direction[2] * t];
    /** 球面均匀的单位向量：z 均匀取 [-1, 1]，方位角均匀取 [0, 2π)。 */
    const unitVector = (): PickVec3 => {
      const z = span(-1, 1);
      const r = Math.sqrt(1 - z * z);
      const phi = span(0, 2 * Math.PI);
      return [r * Math.cos(phi), r * Math.sin(phi), z];
    };

    let compared = 0;
    let obtuse = 0;
    for (let i = 0; i < 200; i += 1) {
      const baseStart: PickVec3 = [span(-5, 5), span(-5, 5), span(-5, 5)];
      const baseDirection = unitVector();
      const baseLength = span(0.5, 6);
      const referenceDirection = unitVector();
      const orthogonal = cross(baseDirection, referenceDirection);
      // ≈1.1° 以内的近平行对不进这一组：根点跑到几百米外，两边都病态，它的口径由上面的平行用例与 Web 0.01° 容差钉。
      if (len(orthogonal) < 0.02) continue;
      // 参照线要经过的点：偶数序号落在基线上（共面，t ∈ [-1, 2] 让根点既可在段内也可在段外），
      // 奇数序号再沿两线的公垂线抬 0.05–1 m（异面）。
      const anchor = at(baseStart, baseDirection, span(-1, 2) * baseLength);
      const normal = at([0, 0, 0], orthogonal, 1 / len(orthogonal));
      const referenceAnchor = i % 2 === 0 ? anchor : at(anchor, normal, (rand() < 0.5 ? 1 : -1) * span(0.05, 1));
      const referenceLength = span(0.5, 6);
      const referenceStart = at(referenceAnchor, referenceDirection, -span(0, 1) * referenceLength);
      // 两个拾中点各自沿线取 t ∈ [-1, 2]：段内、段外、根点两侧（补角）都会出现。
      const base = line(baseStart, at(baseStart, baseDirection, baseLength), at(baseStart, baseDirection, span(-1, 2) * baseLength));
      const reference = line(referenceStart, at(referenceStart, referenceDirection, referenceLength), at(referenceStart, referenceDirection, span(-1, 2) * referenceLength));

      const web = ok(buildLineAngle(base, reference));
      const e3d = betweenLinesDeg(base, reference);
      // Web 的 angleDeg 落在 1e-5° 网格上（snapLineAngleDegrees），所以对到 1e-4°。
      expect(web.angleDeg, `#${i} ${i % 2 === 0 ? '共面' : '异面'}`).toBeCloseTo(e3d, 4);
      expect(web.skew, `#${i} skew`).toBe(i % 2 === 1);
      compared += 1;
      if (e3d > 90) obtuse += 1;
    }
    // 这一批种子实际全部 200 对都进了比对（角 8.5°–172.8°，最大差 4.98e-6° = 网格半格）；钝角那一半就是「拾中点落在根点另一侧 → 补角」。
    expect(compared).toBeGreaterThanOrEqual(195);
    expect(obtuse).toBeGreaterThanOrEqual(50);
    expect(compared - obtuse).toBeGreaterThanOrEqual(50);
  });
});

describe('lineAngleOperandFromGeometry · 两击各自的 E3D 转换（EDGPOSITIONDATA.line() / .plane()）', () => {
  it('线 / 面两种角色都照原样：边 / p-line / 轴线 → LINE（带拾中位置），facet / Aid 面 → PLANE；退化线段落到下一档', () => {
    const seg = { start: [0, 0, 0] as PickVec3, end: [2, 0, 0] as PickVec3 };
    for (const role of ['first', 'second'] as const) {
      expect(lineAngleOperandFromGeometry({ segment: seg, picked: [1, 0, 0] }, role)).toEqual({ kind: 'line', start: seg.start, end: seg.end, picked: [1, 0, 0] });
      // 没给拾中位置就用线的 start（E3D `position` 缺省）。
      expect(lineAngleOperandFromGeometry({ segment: seg }, role)).toEqual({ kind: 'line', start: seg.start, end: seg.end, picked: seg.start });
      expect(lineAngleOperandFromGeometry({ plane: { position: [0, 0, 1], normal: [0, 0, 2] } }, role)).toEqual({ kind: 'plane', position: [0, 0, 1], normal: [0, 0, 2] });
      // 零长线段不成线，退到面 / 点那一档。
      expect(lineAngleOperandFromGeometry({ segment: { start: [1, 1, 1], end: [1, 1, 1] }, plane: { position: [0, 0, 0], normal: [1, 0, 0] } }, role)?.kind).toBe('plane');
      expect(lineAngleOperandFromGeometry({ position: [1, 2, 3] }, role)).toBeNull();
      expect(lineAngleOperandFromGeometry({ position: [1, 2, 3], direction: [0, 0, 0] }, role)).toBeNull();
      expect(lineAngleOperandFromGeometry({ position: [Number.NaN, 2, 3], direction: [0, 0, 1] }, role)).toBeNull();
    }
  });

  it('带方向的点（P-Point / DPOINT）：第一击 getLine() = 过该点的轴线；第二击 getPlane() = 过该点、Z 沿其方向的面（edgpositiondata.pmlobj PPOINT / DPOINT 分支）', () => {
    const point = { position: [7.84985, 11.78749, 16.892524] as PickVec3, direction: [0, 0, 1] as PickVec3 };
    expect(lineAngleOperandFromGeometry(point, 'first')).toEqual({
      kind: 'line', start: point.position, end: [7.84985, 11.78749, 17.892524], picked: point.position,
    });
    expect(lineAngleOperandFromGeometry(point, 'second')).toEqual({ kind: 'plane', position: point.position, normal: [0, 0, 1] });
  });

  it('§30 管件路那两组换成 P-Point 当面：30° 下倾的管身轴线 × VALV P-Point（方向 U）→ 30.0004°，× ELBO P-Point（方向 N）→ 59.9996°——与 Graphics 面那两行同值', () => {
    // 斜管的设计管线 = ELBO 24383/66672 P-Point #1 → FLAN 24383/66671 P-Point #2（mm，golden MD §30「补采（23:57 / 23:58）」）。
    const base = line([17.8997, 0.2328, 17.8204], [17.8997, -0.2359, 18.0910], [17.8997, -0.0016, 17.9557]);
    // VALV P-Point #100：方向 U，位置随便落在管线下方——面是无限的，只有法向进角度。
    const valv = lineAngleOperandFromGeometry({ position: [17.8997, -0.5, 17.6], direction: [0, 0, 1] }, 'second')!;
    expect(valv.kind).toBe('plane');
    const horizontal = ok(buildLineAngle(base, valv));
    expect(horizontal.kind).toBe('line-plane');
    expect(horizontal.angleDeg).toBeCloseTo(Math.atan2(0.2706, 0.4687) * 180 / Math.PI, 4); // 30.00042°
    // ELBO P-Point #2：方向 N（法兰端面的法向）。
    const elbo = lineAngleOperandFromGeometry({ position: [17.8997, 0.3088, 17.7], direction: [0, 1, 0] }, 'second')!;
    const vertical = ok(buildLineAngle(base, elbo));
    expect(vertical.kind).toBe('line-plane');
    expect(vertical.angleDeg).toBeCloseTo(90 - Math.atan2(0.2706, 0.4687) * 180 / Math.PI, 4); // 59.99958°
    // 同一枚 P-Point 若当第一击，是它的轴线（线 × 线）。
    expect(lineAngleOperandFromGeometry({ position: [17.8997, -0.5, 17.6], direction: [0, 0, 1] }, 'first')?.kind).toBe('line');
  });
});
