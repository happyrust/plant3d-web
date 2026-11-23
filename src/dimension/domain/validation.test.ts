import { describe, expect, it } from 'vitest';

import { angularRecord, exactAnchor, linearRecord, projectedRecord, radialRecord } from './testFixtures';
import {
  checkDirectionsAgainstView,
  DIMENSION_VALIDATION_TOLERANCES,
  validateDimensionRecord,
  type DimensionValidationResult,
} from './validation';

function codes(result: DimensionValidationResult): string[] {
  return result.ok ? [] : result.errors.map(error => error.code);
}

describe('validateDimensionRecord（DMCHEK-like 布局前校验）', () => {
  it('完整的线性 / 投影 / 径向尺寸通过', () => {
    expect(validateDimensionRecord(linearRecord())).toEqual({ ok: true });
    expect(validateDimensionRecord(projectedRecord())).toEqual({ ok: true });
    expect(validateDimensionRecord(radialRecord())).toEqual({ ok: true });
    expect(validateDimensionRecord(angularRecord())).toEqual({ ok: true });
  });

  it('UNRESOLVED_DIMENSION_POINT：端点没有快照', () => {
    const result = validateDimensionRecord(linearRecord({
      b: { snapshot: null, accuracy: 'exact' },
      validity: 'invalid',
    }));
    expect(result).toEqual({ ok: false, errors: [{ code: 'UNRESOLVED_DIMENSION_POINT', slot: 'b' }] });
  });

  it('INVALID_DIMENSION_POINT_TYPE：方向当点用、网格表面点当轴用', () => {
    expect(codes(validateDimensionRecord(linearRecord({
      a: exactAnchor([0, 0, 0], { source: 'direction', refno: 'A' }),
    })))).toEqual(['INVALID_DIMENSION_POINT_TYPE']);
    expect(codes(validateDimensionRecord(projectedRecord({
      axis: { kind: 'semantic-direction', snapshot: [1, 0, 0], semanticRef: { source: 'model-surface' } },
    })))).toEqual(['INVALID_DIMENSION_POINT_TYPE']);
  });

  it('DEGENERATE_DIMENSION_DIRECTION：两端重合，或沿轴投影重合（容差 1e-6 m）', () => {
    expect(codes(validateDimensionRecord(linearRecord({ b: exactAnchor([0, 0, 0]) }))))
      .toEqual(['DEGENERATE_DIMENSION_DIRECTION']);
    expect(codes(validateDimensionRecord(linearRecord({ b: exactAnchor([2e-6, 0, 0]) })))).toEqual([]);
    expect(codes(validateDimensionRecord(projectedRecord({ b: exactAnchor([0, 1, 0]) }))))
      .toEqual(['DEGENERATE_DIMENSION_DIRECTION']);
  });

  it('DEGENERATE_PROJECTION_DIRECTION：投影轴为零向量，或存的投影方向为零', () => {
    expect(codes(validateDimensionRecord(projectedRecord({
      axis: { kind: 'semantic-direction', snapshot: [0, 0, 0], semanticRef: { source: 'direction' } },
    })))).toEqual(['DEGENERATE_PROJECTION_DIRECTION']);
    expect(codes(validateDimensionRecord(projectedRecord({
      directions: { schema: 1, source: 'explicit', projectionDirection: [0, 0, 0] },
    })))).toEqual(['DEGENERATE_PROJECTION_DIRECTION']);
  });

  it('PROJECTION_DIRECTION_PARALLEL_DIMENSION：投影方向与尺寸方向夹角 < 1°', () => {
    const almost = Math.tan((0.5 * Math.PI) / 180);
    expect(codes(validateDimensionRecord(projectedRecord({
      directions: { schema: 1, source: 'explicit', projectionDirection: [1, almost, 0] },
    })))).toEqual(['PROJECTION_DIRECTION_PARALLEL_DIMENSION']);
    const clear = Math.tan((2 * Math.PI) / 180);
    expect(codes(validateDimensionRecord(projectedRecord({
      directions: { schema: 1, source: 'explicit', projectionDirection: [1, clear, 0] },
    })))).toEqual([]);
  });

  it('视向相关的两条只在给了视向时判，视向不写回记录', () => {
    const record = projectedRecord({
      directions: { schema: 1, source: 'legacy-derived', dimensionDirection: [1, 0, 0], projectionDirection: [0, 1, 0] },
    });
    expect(validateDimensionRecord(record)).toEqual({ ok: true });
    expect(codes(validateDimensionRecord(record, { viewDirection: [-1, 0, 0] })))
      .toEqual(['DIMENSION_DIRECTION_PARALLEL_VIEW']);
    expect(codes(validateDimensionRecord(record, { viewDirection: [0, 3, 0] })))
      .toEqual(['PROJECTION_DIRECTION_PARALLEL_VIEW']);
    expect(validateDimensionRecord(record, { viewDirection: [0, 0, -1] })).toEqual({ ok: true });
    expect(record).not.toHaveProperty('viewDirection');
    expect(record.directions).not.toHaveProperty('viewDirection');
  });

  it('角度：零长度射线和共线射线给出不同的错误码', () => {
    expect(codes(validateDimensionRecord(angularRecord({
      rayA: exactAnchor([0, 0, 0]),
    })))).toEqual(['DEGENERATE_ANGULAR_RAY']);
    expect(codes(validateDimensionRecord(angularRecord({
      rayB: exactAnchor([2, 0, 0]),
    })))).toEqual(['COLLINEAR_ANGULAR_RAYS']);
    const almost = (Math.PI / 180) * 1.5;
    expect(validateDimensionRecord(angularRecord({
      rayB: exactAnchor([Math.cos(almost), Math.sin(almost), 0]),
    }))).toEqual({ ok: true });
  });

  it('容差集中在一张表里，可整体替换（Phase 4 金样回填）', () => {
    const view = [Math.sin((3 * Math.PI) / 180), 0, -Math.cos((3 * Math.PI) / 180)] as const;
    const dimension = [0, 0, 1] as const;
    expect(checkDirectionsAgainstView({ dimensionDirection: dimension }, view)).toEqual([]);
    expect(checkDirectionsAgainstView(
      { dimensionDirection: dimension },
      view,
      { ...DIMENSION_VALIDATION_TOLERANCES, parallelViewDeg: 5 },
    ).map(error => error.code)).toEqual(['DIMENSION_DIRECTION_PARALLEL_VIEW']);
  });
});
