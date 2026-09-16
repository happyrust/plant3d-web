import { describe, expect, it } from 'vitest';

import {
  EMPTY_INTERSECT_SESSION,
  INTERSECT_MESSAGES,
  advanceIntersectPick,
  intersectOperandFromGeometry,
  intersectPickOrdinal,
  type IntersectOperand,
} from './intersectPickSession';

const X_AXIS: IntersectOperand = { kind: 'line', start: [0, 0, 0], end: [10, 0, 0] };
const Y_AXIS_THROUGH_5: IntersectOperand = { kind: 'line', start: [5, -3, 0], end: [5, 8, 0] };
const X_PARALLEL: IntersectOperand = { kind: 'line', start: [0, 2, 0], end: [10, 2, 0] };
const PLANE_Z2: IntersectOperand = { kind: 'plane', position: [0, 0, 2], normal: [0, 0, 1] };
const PLANE_X3: IntersectOperand = { kind: 'plane', position: [3, 0, 0], normal: [1, 0, 0] };
const PLANE_Y4: IntersectOperand = { kind: 'plane', position: [0, 4, 0], normal: [0, 1, 0] };
const PLANE_Z7: IntersectOperand = { kind: 'plane', position: [0, 0, 7], normal: [0, 0, 1] };
const SLANTED: IntersectOperand = { kind: 'line', start: [1, 1, 0], end: [1, 1, 4] };

describe('advanceIntersectPick · EDGPICKTYPE.intersect sequencing', () => {
  it('first pick is stored and the prompt advances to Intersection[2]', () => {
    expect(intersectPickOrdinal(EMPTY_INTERSECT_SESSION)).toBe(1);
    const step = advanceIntersectPick(EMPTY_INTERSECT_SESSION, X_AXIS, 'TUBI 边');
    expect(step.status).toBe('need-more');
    if (step.status !== 'need-more') throw new Error('unreachable');
    expect(step.nextOrdinal).toBe(2);
    expect(step.session.operands).toEqual([X_AXIS]);
    expect(step.session.labels).toEqual(['TUBI 边']);
  });

  it('LINE × LINE resolves at the intersection and empties the session', () => {
    const first = advanceIntersectPick(EMPTY_INTERSECT_SESSION, X_AXIS);
    const step = advanceIntersectPick(first.session, Y_AXIS_THROUGH_5);
    expect(step.status).toBe('resolved');
    if (step.status !== 'resolved') throw new Error('unreachable');
    expect(step.position).toEqual([5, 0, 0]);
    expect(step.skew).toBe(false);
    expect(step.session).toEqual(EMPTY_INTERSECT_SESSION);
  });

  it('skew lines resolve to the point on the first line nearest the second (not an error)', () => {
    const first = advanceIntersectPick(EMPTY_INTERSECT_SESSION, X_AXIS);
    const step = advanceIntersectPick(first.session, SLANTED);
    expect(step.status).toBe('resolved');
    if (step.status !== 'resolved') throw new Error('unreachable');
    expect(step.position).toEqual([1, 0, 0]);
    expect(step.skew).toBe(true);
  });

  it('LINE × PLANE resolves in either order', () => {
    const a = advanceIntersectPick(advanceIntersectPick(EMPTY_INTERSECT_SESSION, SLANTED).session, PLANE_Z2);
    const b = advanceIntersectPick(advanceIntersectPick(EMPTY_INTERSECT_SESSION, PLANE_Z2).session, SLANTED);
    for (const step of [a, b]) {
      expect(step.status).toBe('resolved');
      if (step.status !== 'resolved') throw new Error('unreachable');
      expect(step.position).toEqual([1, 1, 2]);
    }
  });

  it('parallel second line → (2,870): only the failing pick is dropped, the first stays', () => {
    const first = advanceIntersectPick(EMPTY_INTERSECT_SESSION, X_AXIS, '边 A');
    const step = advanceIntersectPick(first.session, X_PARALLEL, '边 B');
    expect(step.status).toBe('rejected');
    if (step.status !== 'rejected') throw new Error('unreachable');
    expect(step.e3dCode).toBe('2,870');
    expect(step.message).toBe(INTERSECT_MESSAGES.parallelToFirst);
    expect(step.session.operands).toEqual([X_AXIS]);
    expect(step.session.labels).toEqual(['边 A']);
    expect(intersectPickOrdinal(step.session)).toBe(2);
  });

  it('a line lying in / parallel to the plane → (2,870) as well', () => {
    const first = advanceIntersectPick(EMPTY_INTERSECT_SESSION, PLANE_Z2);
    const step = advanceIntersectPick(first.session, X_AXIS);
    expect(step.status).toBe('rejected');
    if (step.status !== 'rejected') throw new Error('unreachable');
    expect(step.e3dCode).toBe('2,870');
    expect(step.session.operands).toEqual([PLANE_Z2]);
  });

  it('PLANE × PLANE needs a third pick (Intersection[3]); three planes resolve to their common point', () => {
    const second = advanceIntersectPick(advanceIntersectPick(EMPTY_INTERSECT_SESSION, PLANE_Z2).session, PLANE_X3);
    expect(second.status).toBe('need-more');
    if (second.status !== 'need-more') throw new Error('unreachable');
    expect(second.nextOrdinal).toBe(3);
    const third = advanceIntersectPick(second.session, PLANE_Y4);
    expect(third.status).toBe('resolved');
    if (third.status !== 'resolved') throw new Error('unreachable');
    expect(third.position).toEqual([3, 4, 2]);
  });

  it('PLANE × PLANE × LINE resolves the line against the first plane', () => {
    const second = advanceIntersectPick(advanceIntersectPick(EMPTY_INTERSECT_SESSION, PLANE_Z2).session, PLANE_X3);
    const third = advanceIntersectPick(second.session, SLANTED);
    expect(third.status).toBe('resolved');
    if (third.status !== 'resolved') throw new Error('unreachable');
    expect(third.position).toEqual([1, 1, 2]);
  });

  it('three planes without a unique point → (2,874): the whole session is cleared', () => {
    const second = advanceIntersectPick(advanceIntersectPick(EMPTY_INTERSECT_SESSION, PLANE_Z2).session, PLANE_X3);
    const third = advanceIntersectPick(second.session, PLANE_Z7);
    expect(third.status).toBe('rejected');
    if (third.status !== 'rejected') throw new Error('unreachable');
    expect(third.e3dCode).toBe('2,874');
    expect(third.message).toBe(INTERSECT_MESSAGES.planesNoPoint);
    expect(third.session).toEqual(EMPTY_INTERSECT_SESSION);
  });

  it('(2,874) wording names 面 × 面 × 第三项 — the third item may be a line ∥ the first plane, not only a plane (prompt matrix D5)', () => {
    // PLANE × PLANE, then a line lying in the second plane and parallel to the first (golden MD §35 补采「线 ∥ 第一面」).
    const planes = advanceIntersectPick(advanceIntersectPick(EMPTY_INTERSECT_SESSION, PLANE_X3).session, PLANE_Y4);
    expect(planes.status).toBe('need-more');
    const lineInSecondParallelToFirst: IntersectOperand = { kind: 'line', start: [0, 4, 0], end: [0, 4, 5] };
    const third = advanceIntersectPick(planes.session, lineInSecondParallelToFirst);
    expect(third.status).toBe('rejected');
    if (third.status !== 'rejected') throw new Error('unreachable');
    expect(third.e3dCode).toBe('2,874');
    expect(third.session).toEqual(EMPTY_INTERSECT_SESSION);
    expect(third.message).toBe('面 × 面 × 第三项没有唯一交点，求交已重置，请重新拾取（E3D 2,874）');
    expect(INTERSECT_MESSAGES.planesNoPoint).not.toContain('三个平面');
    // Same line but crossing the first plane resolves on the first plane (E3D intersects the line with plane 1 only).
    const crossing: IntersectOperand = { kind: 'line', start: [0, 4, 1], end: [6, 4, 1] };
    const ok = advanceIntersectPick(planes.session, crossing);
    expect(ok.status).toBe('resolved');
    if (ok.status !== 'resolved') throw new Error('unreachable');
    expect(ok.position).toEqual([3, 4, 1]);
  });

  it('an item that converts to nothing is refused without consuming the pick', () => {
    const first = advanceIntersectPick(EMPTY_INTERSECT_SESSION, X_AXIS);
    const step = advanceIntersectPick(first.session, null);
    expect(step.status).toBe('rejected');
    if (step.status !== 'rejected') throw new Error('unreachable');
    expect(step.reason).toBe('not-convertible');
    expect(step.e3dCode).toBeNull();
    expect(step.session).toBe(first.session);
  });
});

describe('intersectOperandFromGeometry · per-type conversion', () => {
  it('segment → LINE, plane → PLANE, point + direction → POINTVECTOR line, bare point → null', () => {
    expect(intersectOperandFromGeometry({ segment: { start: [0, 0, 0], end: [1, 0, 0] } })).toEqual({
      kind: 'line', start: [0, 0, 0], end: [1, 0, 0],
    });
    expect(intersectOperandFromGeometry({ plane: { position: [0, 0, 2], normal: [0, 0, 1] } })).toEqual({
      kind: 'plane', position: [0, 0, 2], normal: [0, 0, 1],
    });
    expect(intersectOperandFromGeometry({ position: [1, 2, 3], direction: [0, 0, 2] })).toEqual({
      kind: 'line', start: [1, 2, 3], end: [1, 2, 5],
    });
    expect(intersectOperandFromGeometry({ position: [1, 2, 3] })).toBeNull();
    expect(intersectOperandFromGeometry({ segment: { start: [1, 1, 1], end: [1, 1, 1] }, position: [1, 1, 1] })).toBeNull();
    expect(intersectOperandFromGeometry({ plane: { position: [0, 0, 0], normal: [0, 0, 0] } })).toBeNull();
  });

  it('a segment wins over a plane / direction when several are present (line-bearing items are lines in E3D)', () => {
    expect(intersectOperandFromGeometry({
      segment: { start: [0, 0, 0], end: [1, 0, 0] },
      plane: { position: [0, 0, 0], normal: [0, 0, 1] },
      position: [0, 0, 0],
      direction: [0, 1, 0],
    })?.kind).toBe('line');
  });
});
