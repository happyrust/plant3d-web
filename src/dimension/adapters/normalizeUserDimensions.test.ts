import { describe, expect, it } from 'vitest';

import { normalizeUserDimension } from './normalizeUserDimensions';

import type {
  DimensionAccuracy,
  DimensionAnchor,
  ProjectionAxisRef,
  UserDimensionRecord,
  Vec3,
} from '../domain/types';

function anchor(snapshot: Vec3 | null, accuracy: DimensionAccuracy = 'exact'): DimensionAnchor {
  return { snapshot, accuracy };
}

const COMMON = {
  id: 'dim-1',
  labelPinned: false as boolean,
  authorId: 'u-1',
  authorRole: 'designer',
  createdAt: 1,
  updatedAt: 2,
  validity: 'valid' as 'valid' | 'invalid',
};

const LINEAR_PLACEMENT = { offsetM: 0.5, labelT: 0.5, side: 1 } as const;

function linear(
  a: DimensionAnchor,
  b: DimensionAnchor,
  validity: 'valid' | 'invalid' = 'valid',
): UserDimensionRecord {
  return { ...COMMON, validity, kind: 'linear', a, b, placement: LINEAR_PLACEMENT };
}

function projected(
  axis: ProjectionAxisRef,
  a = anchor([0, 0, 0]),
  b = anchor([1, 0, 0]),
): UserDimensionRecord {
  return { ...COMMON, kind: 'projected', a, b, axis, placement: LINEAR_PLACEMENT };
}

function angular(anchors: {
  vertex?: DimensionAnchor;
  rayA?: DimensionAnchor;
  rayB?: DimensionAnchor;
} = {}): UserDimensionRecord {
  return {
    ...COMMON,
    kind: 'angular',
    vertex: anchors.vertex ?? anchor([0, 0, 0]),
    rayA: anchors.rayA ?? anchor([1, 0, 0]),
    rayB: anchors.rayB ?? anchor([0, 1, 0]),
    placement: { labelT: 0.5, arcChoice: 'minor' },
  };
}

function radial(
  overrides: Partial<Extract<UserDimensionRecord, { kind: 'radial' }>> = {},
): UserDimensionRecord {
  return {
    ...COMMON,
    kind: 'radial',
    center: anchor([0, 0, 0]),
    rim: anchor([2, 0, 0]),
    normal: { kind: 'design-axis', axis: 'z' },
    display: 'diameter',
    placement: { leaderDirection: [0, 1, 0], labelDistanceM: 0.3 },
    ...overrides,
  };
}

describe('normalizeUserDimension', () => {
  it('linear：透传 id、labelPinned、placement 与两端快照，role 为 normal', () => {
    expect(normalizeUserDimension(linear(anchor([0, 0, 0]), anchor([3, 4, 0])))).toMatchObject({
      id: 'dim-1',
      kind: 'linear',
      role: 'normal',
      labelPinned: false,
      a: [0, 0, 0],
      b: [3, 4, 0],
      placement: LINEAR_PLACEMENT,
    });
  });

  it('linear：任一端缺快照返回 null', () => {
    expect(normalizeUserDimension(linear(anchor(null), anchor([1, 0, 0])))).toBeNull();
    expect(normalizeUserDimension(linear(anchor([0, 0, 0]), anchor(null)))).toBeNull();
  });

  it('projected：设计轴 x/y/z 归一成对应单位向量', () => {
    const cases = [
      ['x', [1, 0, 0]],
      ['y', [0, 1, 0]],
      ['z', [0, 0, 1]],
    ] as const;
    for (const [axis, expected] of cases) {
      expect(normalizeUserDimension(projected({ kind: 'design-axis', axis })))
        .toMatchObject({ kind: 'projected', axis: expected });
    }
  });

  it('projected：语义方向轴直接使用其快照向量', () => {
    const result = normalizeUserDimension(projected({
      kind: 'semantic-direction',
      snapshot: [0.6, 0.8, 0],
      semanticRef: { source: 'direction' },
    }));
    expect(result).toMatchObject({ kind: 'projected', axis: [0.6, 0.8, 0] });
  });

  it('projected：任一端缺快照返回 null', () => {
    expect(normalizeUserDimension(projected({ kind: 'design-axis', axis: 'x' }, anchor(null)))).toBeNull();
    expect(normalizeUserDimension(projected({ kind: 'design-axis', axis: 'x' }, undefined, anchor(null)))).toBeNull();
  });

  it('设计轴取联合类型之外的值时 axis 落为 undefined（现状钉住）', () => {
    const result = normalizeUserDimension(projected({ kind: 'design-axis', axis: 'w' as unknown as 'x' }));
    expect(result?.kind).toBe('projected');
    expect(result && 'axis' in result ? result.axis : 'not-projected').toBeUndefined();
  });

  it('angular：三锚点齐全时透传 vertex/rayA/rayB 与 placement', () => {
    expect(normalizeUserDimension(angular())).toMatchObject({
      kind: 'angular',
      vertex: [0, 0, 0],
      rayA: [1, 0, 0],
      rayB: [0, 1, 0],
      placement: { labelT: 0.5, arcChoice: 'minor' },
      role: 'normal',
    });
  });

  it('angular：任一锚点缺快照返回 null', () => {
    expect(normalizeUserDimension(angular({ vertex: anchor(null) }))).toBeNull();
    expect(normalizeUserDimension(angular({ rayA: anchor(null) }))).toBeNull();
    expect(normalizeUserDimension(angular({ rayB: anchor(null) }))).toBeNull();
  });

  it('radial：法向取设计轴单位向量并透传 display', () => {
    expect(normalizeUserDimension(radial())).toMatchObject({
      kind: 'radial',
      center: [0, 0, 0],
      rim: [2, 0, 0],
      normal: [0, 0, 1],
      display: 'diameter',
      role: 'normal',
    });
  });

  it('radial：center 或 rim 缺快照返回 null', () => {
    expect(normalizeUserDimension(radial({ center: anchor(null) }))).toBeNull();
    expect(normalizeUserDimension(radial({ rim: anchor(null) }))).toBeNull();
  });

  it('validity 为 invalid 时 role 记为 invalid，且优先于 approximate', () => {
    expect(normalizeUserDimension(
      linear(anchor([0, 0, 0]), anchor([1, 0, 0]), 'invalid'),
    )?.role).toBe('invalid');
    expect(normalizeUserDimension(
      linear(anchor([0, 0, 0], 'approximate'), anchor([1, 0, 0]), 'invalid'),
    )?.role).toBe('invalid');
  });

  it('任一锚点 approximate 时 role 记为 approximate', () => {
    expect(normalizeUserDimension(
      linear(anchor([0, 0, 0], 'approximate'), anchor([1, 0, 0])),
    )?.role).toBe('approximate');
    expect(normalizeUserDimension(
      angular({ rayB: anchor([0, 1, 0], 'approximate') }),
    )?.role).toBe('approximate');
    expect(normalizeUserDimension(
      radial({ rim: anchor([2, 0, 0], 'approximate') }),
    )?.role).toBe('approximate');
  });

  it('labelPinned 为 true 时原样透传', () => {
    const record = { ...linear(anchor([0, 0, 0]), anchor([1, 0, 0])), labelPinned: true };
    expect(normalizeUserDimension(record)?.labelPinned).toBe(true);
  });
});
