import { describe, expect, it } from 'vitest';

import {
  ANGULAR_ORTHOGONAL_SNAP,
  deriveAngularPlane,
  refreshAngularPlane,
  snapAngleToRightAngle,
} from './angularPlane';
import { angularRecord, exactAnchor } from './testFixtures';

describe('angular plane and orthogonal snap (#71)', () => {
  it('两条不共线的射线定出单位法向，共线或零长度定不出', () => {
    expect(deriveAngularPlane([0, 0, 0], [1, 0, 0], [0, 2, 0], 'explicit')).toEqual({
      schema: 1,
      source: 'explicit',
      normal: [0, 0, 1],
    });
    expect(deriveAngularPlane([0, 0, 0], [1, 0, 0], [3, 0, 0], 'explicit')).toBeNull();
    expect(deriveAngularPlane([0, 0, 0], [0, 0, 0], [0, 1, 0], 'legacy-derived')).toBeNull();
  });

  it('显式平面重绑后保持不变，迁移补上的平面跟着新几何走', () => {
    const explicit = angularRecord({
      anglePlane: { schema: 1, source: 'explicit', normal: [0, 0, 1] },
    });
    const rebound = refreshAngularPlane({
      ...explicit,
      rayB: exactAnchor([0, 0, 1]),
    });
    expect(rebound.kind === 'angular' && rebound.anglePlane).toEqual(explicit.anglePlane);

    const legacy = angularRecord({
      anglePlane: { schema: 1, source: 'legacy-derived', normal: [0, 0, 1] },
      rayB: exactAnchor([0, 0, 1]),
    });
    const refreshed = refreshAngularPlane(legacy);
    expect(refreshed.kind === 'angular' && refreshed.anglePlane?.source).toBe('legacy-derived');
    expect(refreshed.kind === 'angular' && refreshed.anglePlane?.normal[1]).toBeCloseTo(-1);
  });

  it('距直角倍数小于 0.01 个直角才吸附，边界两侧分开', () => {
    const right = Math.PI / 2;
    const inside = (89.2 / 90) * right;
    const outside = (89.05 / 90) * right;
    expect(snapAngleToRightAngle(inside)).toBeCloseTo(right);
    expect(snapAngleToRightAngle(outside)).toBeCloseTo(outside);
    expect(snapAngleToRightAngle(right)).toBeCloseTo(right);
    expect(ANGULAR_ORTHOGONAL_SNAP.fractionOfRightAngle).toBe(0.01);
  });
});
