import { describe, expect, it } from 'vitest';

import {
  deriveDimensionDirections,
  isDimensionDirections,
  refreshDerivedDirections,
  withDimensionDirections,
} from './directions';
import { reduceDimensionDocument } from './reducer';
import { emptyDimensionDocument, exactAnchor, linearRecord, projectedRecord } from './testFixtures';

describe('dimension directions（#68）', () => {
  it('线性：量轴 = 尺寸方向 = unit(b − a)；没有视向就不编尺寸平面', () => {
    expect(deriveDimensionDirections(linearRecord({ b: exactAnchor([0, 3, 4]) }))).toEqual({
      schema: 1,
      source: 'legacy-derived',
      measuredAxis: [0, 0.6, 0.8],
      dimensionDirection: [0, 0.6, 0.8],
    });
    expect(deriveDimensionDirections(linearRecord({ b: exactAnchor([0, 0, 0]) })))
      .toEqual({ schema: 1, source: 'legacy-derived' });
  });

  it('投影：尺寸方向沿轴，投影方向是跨距垂直于轴的分量，平面法向 = 轴 × 投影方向', () => {
    expect(deriveDimensionDirections(projectedRecord({ b: exactAnchor([2, 3, 0]) }))).toEqual({
      schema: 1,
      source: 'legacy-derived',
      measuredAxis: [1, 0, 0],
      dimensionDirection: [1, 0, 0],
      projectionDirection: [0, 1, 0],
      dimensionPlane: { normal: [0, 0, 1] },
    });
    // 两点已在同一条轴线上：没有投影方向，也就不给平面。
    const onAxis = deriveDimensionDirections(projectedRecord({ b: exactAnchor([2, 0, 0]) }));
    expect(onAxis).not.toHaveProperty('projectionDirection');
    expect(onAxis).not.toHaveProperty('dimensionPlane');
  });

  it('迁移只补缺的；用户定下的（explicit）原样保留，重绑也不动', () => {
    const explicit = projectedRecord({
      directions: { schema: 1, source: 'explicit', dimensionDirection: [1, 0, 0], projectionDirection: [0, 0, 1] },
    });
    expect(withDimensionDirections(explicit)).toBe(explicit);
    expect(refreshDerivedDirections({ ...explicit, b: exactAnchor([5, 5, 5]) })).toMatchObject({
      directions: explicit.directions,
    });
  });

  it('端点重绑后 legacy-derived 方向随几何重推', () => {
    const state = emptyDimensionDocument([withDimensionDirections(linearRecord({ id: 'd1' }))]);
    const result = reduceDimensionDocument(state, {
      type: 'rebind-anchor',
      commandId: 'c1',
      actorId: 'owner',
      actorRole: 'designer',
      at: 2,
      dimensionId: 'd1',
      anchorSlot: 'b',
      anchor: exactAnchor([0, 2, 0]),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.records[0]).toMatchObject({
      directions: { source: 'legacy-derived', dimensionDirection: [0, 1, 0] },
    });
  });

  it('入库形状：只收 schema 1、有限向量，拒绝把瞬态视向存进来', () => {
    expect(isDimensionDirections({ schema: 1, source: 'explicit', dimensionDirection: [1, 0, 0] })).toBe(true);
    expect(isDimensionDirections({ schema: 1, source: 'explicit', dimensionDirection: [0, 0, 0] })).toBe(true);
    expect(isDimensionDirections({ schema: 2, source: 'explicit' })).toBe(false);
    expect(isDimensionDirections({ schema: 1, source: 'camera' })).toBe(false);
    expect(isDimensionDirections({ schema: 1, source: 'explicit', dimensionDirection: [Number.NaN, 0, 0] })).toBe(false);
    expect(isDimensionDirections({ schema: 1, source: 'explicit', viewDirection: [0, 0, -1] })).toBe(false);
    expect(isDimensionDirections({ schema: 1, source: 'explicit', dimensionPlane: { normal: 'z' } })).toBe(false);
  });
});
