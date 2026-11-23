import { afterEach, describe, expect, it } from 'vitest';

import {
  assertNearestClearanceResponse,
  assertPipeClearanceResponse,
  assertPointToSurfaceResponse,
  assertSurfaceClearanceResponse,
  ClearanceContractError,
  clearanceContractMode,
  enforceClearanceContract,
  mmToM,
  modelVersionKey,
  pointMmToM,
  resolveClearanceContractMode,
  setClearanceContractModeForTesting,
  summarizeClearanceWarnings,
  vectorMmToM,
} from './clearanceContract';

import { elboToCurvedWallResponse } from '@/clearance/testing/surfaceClearanceFixtures';

function nearestResponse(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    unit: 'mm',
    distance_method: 'centerline_surface_aabb_clearance_mm',
    accuracy_class: 'approximate-aabb',
    model_version: { dbnum: 24381, sesno: 812 },
    truncated_candidates: false,
    warnings: ['approximate_aabb: 目标侧按包围盒量距'],
    nearest_by_group: [{
      group: 'WALL',
      candidates: [{
        refno: '24381_1',
        distance_mm: 120,
        intersects: false,
        annotation: { start_point: { x: 0, y: 0, z: 0 }, end_point: { x: 0, y: 120, z: 0 }, label_mm: 120 },
      }],
    }],
    ...overrides,
  };
}

function pointResponse(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    unit: 'mm',
    method: 'point_to_surface',
    accuracy_class: 'exact-surface',
    error_bound_mm: 0.5,
    query_point: { x: 0, y: 0, z: 5 },
    target: { refno: '24381/2', noun: 'EQUI', leaf_count: 1, triangle_count: 12 },
    result: {
      distance_mm: 4,
      target_point: { x: 0, y: 0, z: 1 },
      vector: { dx: 0, dy: 0, dz: -4 },
      normal: { x: 0, y: 0, z: 1 },
      feature: 'face',
      target_leaf_refno: '24381/3',
      target_leaf_noun: 'BOX',
    },
    model: { source_sesno: null, target_sesno: 9 },
    timing_ms: { load: 1, query: 1, total: 2 },
    warnings: [],
    ...overrides,
  };
}

function pipeResponse(resultOverrides: Record<string, unknown> = {}, overrides: Record<string, unknown> = {}) {
  const segment = (refno: string) => ({
    refno,
    order: 0,
    start: { x: 0, y: 0, z: 0 },
    end: { x: 1000, y: 0, z: 0 },
    outside_diameter_mm: 100,
    effective_radius_mm: 50,
  });
  return {
    success: true,
    unit: 'mm',
    method: 'pipe_to_pipe_analytic',
    accuracy_class: 'exact-analytic',
    error_bound_mm: 0.01,
    source: { refno: '24381_1', straight_segment_count: 1, insulation_mm: null, model_version: { dbnum: 24381, sesno: 5 } },
    target: { refno: '24381_2', straight_segment_count: 1, insulation_mm: null, model_version: { dbnum: 24381, sesno: 5 } },
    result: {
      distance_mm: 400,
      intersects: false,
      penetration_mm: null,
      axis_distance_mm: 500,
      source_point: { x: 500, y: 50, z: 0 },
      target_point: { x: 500, y: 450, z: 0 },
      vector: { dx: 0, dy: 400, dz: 0 },
      source_axis_point: { x: 500, y: 0, z: 0 },
      target_axis_point: { x: 500, y: 500, z: 0 },
      source_segment: segment('24381_1~24381_11'),
      target_segment: segment('24381_2~24381_21'),
      ...resultOverrides,
    },
    pairs_evaluated: 1,
    warnings: [],
    ...overrides,
  };
}

afterEach(() => setClearanceContractModeForTesting(null));

describe('unit conversion', () => {
  it('converts E3D mm to design-world metres exactly once', () => {
    expect(mmToM(1250)).toBe(1.25);
    expect(pointMmToM({ x: 1000, y: -500, z: 2 })).toEqual([1, -0.5, 0.002]);
    expect(vectorMmToM({ dx: 10, dy: 0, dz: -20 })).toEqual([0.01, 0, -0.02]);
    expect(Object.isFrozen(pointMmToM({ x: 1, y: 2, z: 3 }))).toBe(true);
  });
});

describe('nearest-clearance contract', () => {
  it('accepts the labelled approximate response and old servers without the new fields', () => {
    expect(() => assertNearestClearanceResponse(nearestResponse())).not.toThrow();
    expect(() => assertNearestClearanceResponse(nearestResponse({
      accuracy_class: undefined, model_version: undefined, truncated_candidates: undefined,
    }))).not.toThrow();
    expect(() => assertNearestClearanceResponse(nearestResponse({ model_version: null }))).not.toThrow();
  });

  it('rejects an exactness claim, unknown unit and broken candidates', () => {
    expect(() => assertNearestClearanceResponse(nearestResponse({ accuracy_class: 'exact-surface' })))
      .toThrow(ClearanceContractError);
    expect(() => assertNearestClearanceResponse(nearestResponse({ unit: 'm' }))).toThrow(/unit/);
    expect(() => assertNearestClearanceResponse(nearestResponse({ model_version: { dbnum: 1, sesno: -1 } })))
      .toThrow(/model_version/);
    const broken = nearestResponse();
    broken.nearest_by_group[0]!.candidates[0]!.distance_mm = Number.NaN;
    expect(() => assertNearestClearanceResponse(broken)).toThrow(/distance_mm/);
    const intersecting = nearestResponse();
    intersecting.nearest_by_group[0]!.candidates[0]!.intersects = true;
    expect(() => assertNearestClearanceResponse(intersecting)).toThrow(/相交时必须为 0/);
  });
});

describe('surface-clearance contract', () => {
  it('accepts exact-surface responses and a null result unless one is required', () => {
    expect(() => assertSurfaceClearanceResponse(elboToCurvedWallResponse())).not.toThrow();
    expect(() => assertSurfaceClearanceResponse(elboToCurvedWallResponse({ result: null }))).not.toThrow();
    expect(() => assertSurfaceClearanceResponse(elboToCurvedWallResponse({ result: null }), { requireResult: true }))
      .toThrow(/result/);
  });

  it('only accepts vertical witnesses for vertical requests', () => {
    const base = elboToCurvedWallResponse();
    const vertical = elboToCurvedWallResponse({ result: { ...base.result!, vertical: true, witness: 'vertical-ray' } });
    expect(() => assertSurfaceClearanceResponse(vertical, { vertical: true })).not.toThrow();
    expect(() => assertSurfaceClearanceResponse(base, { vertical: true })).toThrow(/vertical/);
    expect(() => assertSurfaceClearanceResponse(vertical)).toThrow(/witness/);
  });

  it('rejects an approximate label or an out-of-range error bound', () => {
    expect(() => assertSurfaceClearanceResponse(elboToCurvedWallResponse({ accuracy_class: 'approximate-aabb' })))
      .toThrow(/accuracy_class/);
    expect(() => assertSurfaceClearanceResponse(elboToCurvedWallResponse({ error_bound_mm: 50 })))
      .toThrow(/error_bound_mm/);
  });
});

describe('point-to-surface contract', () => {
  it('accepts face / edge hits and the empty answer', () => {
    expect(() => assertPointToSurfaceResponse(pointResponse())).not.toThrow();
    expect(() => assertPointToSurfaceResponse(pointResponse({ result: null }))).not.toThrow();
    expect(() => assertPointToSurfaceResponse(pointResponse({ method: 'surface_to_surface' }))).toThrow(/method/);
    expect(() => assertPointToSurfaceResponse(pointResponse({ query_point: { x: 0, y: 0 } }))).toThrow(/query_point/);
  });
});

describe('pipe-clearance contract', () => {
  it('accepts exact and capsule answers', () => {
    expect(() => assertPipeClearanceResponse(pipeResponse())).not.toThrow();
    expect(() => assertPipeClearanceResponse(pipeResponse({}, { accuracy_class: 'approximate-capsule' }))).not.toThrow();
    expect(() => assertPipeClearanceResponse(pipeResponse({}, { accuracy_class: 'exact-surface' }))).toThrow(/accuracy_class/);
  });

  it('requires intersection to be reported as zero distance plus penetration, never a negative distance', () => {
    expect(() => assertPipeClearanceResponse(pipeResponse({ intersects: true, distance_mm: 0, penetration_mm: 12 })))
      .not.toThrow();
    expect(() => assertPipeClearanceResponse(pipeResponse({ intersects: true, distance_mm: -12, penetration_mm: 12 })))
      .toThrow(/distance_mm/);
    expect(() => assertPipeClearanceResponse(pipeResponse({ intersects: true, distance_mm: 0, penetration_mm: null })))
      .toThrow(/penetration_mm/);
    expect(() => assertPipeClearanceResponse(pipeResponse({ penetration_mm: 3 }))).toThrow(/penetration_mm/);
  });
});

describe('contract mode', () => {
  it('defaults to strict and only reads lenient when asked', () => {
    expect(resolveClearanceContractMode(undefined)).toBe('strict');
    expect(resolveClearanceContractMode('LENIENT ')).toBe('lenient');
    expect(resolveClearanceContractMode('off')).toBe('strict');
    expect(clearanceContractMode()).toBe('strict');
  });

  it('turns violations into contract_violation warnings in lenient mode and rethrows other errors', () => {
    const violate = () => assertPointToSurfaceResponse(pointResponse({ unit: 'm' }));
    expect(() => enforceClearanceContract(violate, 'strict')).toThrow(ClearanceContractError);
    const warnings = enforceClearanceContract(violate, 'lenient');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.code).toBe('contract_violation');
    expect(() => enforceClearanceContract(() => { throw new TypeError('bug'); }, 'lenient')).toThrow(TypeError);
    setClearanceContractModeForTesting('lenient');
    expect(enforceClearanceContract(violate)).toHaveLength(1);
  });
});

describe('warning summary', () => {
  it('separates degraded warnings into readable labels and keeps the rest verbatim', () => {
    const summary = summarizeClearanceWarnings([
      'approximate_aabb: 目标侧按包围盒量距（centerline_aabb_clearance_mm）',
      'approximate_aabb: duplicate',
      'truncated_candidates: 超过 MAX_PER_PAGE',
      'model_version_unavailable: 读不到会话号',
      'perpendicular_ray_missed: 落在棱上',
    ]);
    expect(summary.degraded).toHaveLength(3);
    expect(summary.degraded[0]).toMatch(/包围盒/);
    expect(summary.degraded[1]).toMatch(/截断/);
    expect(summary.degraded[2]).toMatch(/版本/);
    expect(summary.other).toEqual(['perpendicular_ray_missed: 落在棱上']);
  });

  it('keys model versions by dbnum:sesno', () => {
    expect(modelVersionKey({ dbnum: 24381, sesno: 812 })).toBe('24381:812');
    expect(modelVersionKey(null)).toBeNull();
  });
});
