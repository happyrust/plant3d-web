import { describe, expect, it, vi } from 'vitest';

import {
  createClearanceService,
  parseServerWarning,
  pipeClearanceRecordId,
  pipeClearanceToRecord,
  pointToSurfaceToRecord,
  surfaceClearanceToRecord,
} from './clearanceService';

import type { PipeClearanceResponse, PointToSurfaceResponse } from '@/api/genModelV1Api';

import {
  beyondMaxDistanceResponse,
  boxToStraightWallResponse,
  elboToCurvedWallResponse,
  intersectingResponse,
  sectionTouchingPaneResponse,
  tubePastPaneCornerResponse,
} from '@/clearance/testing/surfaceClearanceFixtures';

const AT = new Date('2026-09-17T12:00:00.000Z');

describe('surfaceClearanceToRecord', () => {
  it('converts the live ELBO × curved wall response into a design-world metre record', () => {
    const record = surfaceClearanceToRecord(
      elboToCurvedWallResponse(),
      { sourceRefno: '24384_22582', targetRefno: '17496/105912', targetKind: 'wall' },
      AT,
    );
    expect(record.id).toBe('clearance:24384_22582:17496_105912');
    expect(record.kind).toBe('component-to-wall');
    expect(record.sourceNoun).toBe('ELBO');
    expect(record.targetNoun).toBe('WALL');
    expect(record.status).toBe('current');
    expect(record.computedAt).toBe(AT.toISOString());

    expect(record.provenance.method).toBe('surface-to-surface');
    expect(record.provenance.accuracyClass).toBe('exact-surface');
    expect(record.provenance.coordinateSpace).toBe('design-world');
    expect(record.provenance.lengthUnit).toBe('m');
    expect(record.provenance.errorBoundM).toBeCloseTo(0.0005, 9);
    expect(record.provenance.sourceModelVersion).toBe('src:586;tgt:729');
    expect(record.provenance.source).toEqual({ entityId: '24384_22582', refno: '24384_22582', segmentRefno: '24384_22582' });
    expect(record.provenance.target).toEqual({ entityId: '17496_105912', refno: '17496_105912', segmentRefno: '17496_105912' });

    const snapshot = record.snapshot!;
    expect(snapshot.distanceM).toBeCloseTo(0.06443, 9);
    expect(snapshot.sourcePoint).toEqual([120, 45, 3.2]);
    expect(snapshot.targetPoint[0]).toBeCloseTo(120.0644, 6);
    expect(snapshot.vector).toEqual([0.0644, -0.0011, 0]);
    expect(snapshot.targetFace).toEqual({ kind: 'outer', normal: [-0.9998, 0.0171, 0], confidence: 'geometric' });
    expect(snapshot.perpendicular?.distanceM).toBeCloseTo(0.0645, 9);
    expect(snapshot.perpendicular?.to[0]).toBeCloseTo(120.06449, 6);
    expect(snapshot.perpendicular?.method).toBe('ray');
    expect(snapshot.witness).toBe('closest-points');
    expect(record.modelVersion).toEqual({ sourceSesno: 586, targetSesno: 729 });
  });

  it('carries perpendicular.method through (contact / edge, gen-model 7bcdd60df) and reads a missing or unknown one as ray', () => {
    const touching = surfaceClearanceToRecord(sectionTouchingPaneResponse(), { sourceRefno: '24383_68484', targetRefno: '24383_68491' }, AT);
    expect(touching.snapshot?.distanceM).toBe(0);
    expect(touching.snapshot?.intersects).toBe(false);
    expect(touching.snapshot?.perpendicular).toEqual({
      distanceM: 0,
      from: [-10.147158, 12.070674, 3.07796],
      to: [-10.147158, 12.070674, 3.07796],
      method: 'contact',
    });

    const pastCorner = surfaceClearanceToRecord(tubePastPaneCornerResponse(), { sourceRefno: '24384_24671', targetRefno: '17496_135244' }, AT);
    expect(pastCorner.snapshot?.perpendicular?.method).toBe('edge');
    expect(pastCorner.snapshot?.perpendicular?.distanceM).toBeCloseTo(0.046603077, 12);
    expect(pastCorner.snapshot?.perpendicular?.distanceM).toBe(pastCorner.snapshot?.distanceM);
    expect(pastCorner.provenance.warnings).toEqual([]);

    const legacy = elboToCurvedWallResponse();
    delete legacy.result!.perpendicular!.method;
    expect(surfaceClearanceToRecord(legacy, { sourceRefno: '24384_22582', targetRefno: '17496_105912' }, AT).snapshot?.perpendicular?.method).toBe('ray');

    const unknown = elboToCurvedWallResponse();
    unknown.result!.perpendicular!.method = 'teleport';
    expect(surfaceClearanceToRecord(unknown, { sourceRefno: '24384_22582', targetRefno: '17496_105912' }, AT).snapshot?.perpendicular?.method).toBe('ray');
  });

  it('keeps server warnings as coded provenance warnings and a missing perpendicular as null', () => {
    const record = surfaceClearanceToRecord(
      boxToStraightWallResponse(),
      { sourceRefno: '24384_24830', targetRefno: '17496_105812' },
      AT,
    );
    expect(record.snapshot?.targetFace?.kind).toBe('side');
    expect(record.snapshot?.targetFace?.confidence).toBe('pca');
    expect(record.snapshot?.perpendicular).toBeNull();
    expect(record.provenance.warnings).toEqual([
      { code: 'perpendicular_ray_missed', message: '源侧最近点沿墙面法向的射线没有落回墙面，最近点在墙的棱 / 角上，垂距置空' },
    ]);
  });

  it('maps intersecting and beyond-max-distance responses', () => {
    const hit = surfaceClearanceToRecord(intersectingResponse(), { sourceRefno: '24384_22582', targetRefno: '17496_105912' }, AT);
    expect(hit.snapshot).toMatchObject({ distanceM: 0, intersects: true, witness: 'aabb-overlap-center', targetFace: null });

    const none = surfaceClearanceToRecord(beyondMaxDistanceResponse(), { sourceRefno: '24384_22582', targetRefno: '17496_105912' }, AT);
    expect(none.snapshot).toBeNull();
    expect(none.status).toBe('current');
    expect(none.provenance.warnings[0]?.code).toBe('beyond_max_distance');
    expect(none.provenance.source).toEqual({ entityId: '24384_22582', refno: '24384_22582' });
  });

  it('uses component-to-component for target_kind=any and keeps createdAt from the previous record', () => {
    const first = surfaceClearanceToRecord(elboToCurvedWallResponse(), { sourceRefno: '24384_22582', targetRefno: '17496_105912', targetKind: 'any' }, AT);
    expect(first.kind).toBe('component-to-component');
    const later = new Date('2026-09-17T13:00:00.000Z');
    const second = surfaceClearanceToRecord(elboToCurvedWallResponse(), { sourceRefno: '24384_22582', targetRefno: '17496_105912', targetKind: 'any' }, later, first);
    expect(second.createdAt).toBe(AT.toISOString());
    expect(second.computedAt).toBe(later.toISOString());
  });

  it('refuses to label an unexpected server method as exact (D2)', () => {
    expect(() => surfaceClearanceToRecord(
      elboToCurvedWallResponse({ method: 'aabb_to_aabb', accuracy_class: 'approximate-bounds' }),
      { sourceRefno: '24384_22582', targetRefno: '17496_105912' },
      AT,
    )).toThrow(/method \/ accuracy_class/);
  });

  it('parseServerWarning splits the `code: message` convention and falls back to server', () => {
    expect(parseServerWarning('beyond_max_distance: 1000 mm 内两侧网格没有靠近到一起'))
      .toEqual({ code: 'beyond_max_distance', message: '1000 mm 内两侧网格没有靠近到一起' });
    expect(parseServerWarning('两侧模型会话不同（源 5 / 目标 6）')).toEqual({ code: 'server', message: '两侧模型会话不同（源 5 / 目标 6）' });
    expect(parseServerWarning('   ')).toEqual({ code: 'server', message: 'unknown warning' });
  });
});

describe('createClearanceService', () => {
  it('sends targetKind=wall for computeComponentToWall and passes request options through', async () => {
    const fetchSurfaceClearance = vi.fn(async () => elboToCurvedWallResponse());
    const service = createClearanceService({
      fetchSurfaceClearance,
      requestOptions: { baseUrl: 'http://gm.test:8022' },
      now: () => AT,
    });
    const record = await service.computeComponentToWall({ sourceRefno: '24384_22582', targetRefno: '17496/105912', maxDistanceMm: 2000 });
    expect(record.kind).toBe('component-to-wall');
    expect(record.computedAt).toBe(AT.toISOString());
    expect(fetchSurfaceClearance).toHaveBeenCalledWith(
      { sourceRefno: '24384_22582', targetRefno: '17496/105912', targetKind: 'wall', perpendicular: undefined, maxDistanceMm: 2000 },
      { baseUrl: 'http://gm.test:8022' },
    );

    await service.compute({ sourceRefno: '24384_22582', targetRefno: '24384_22678', targetKind: 'any', perpendicular: false });
    expect(fetchSurfaceClearance).toHaveBeenLastCalledWith(
      expect.objectContaining({ targetKind: 'any', perpendicular: false }),
      { baseUrl: 'http://gm.test:8022' },
    );
  });

  it('propagates API errors untouched', async () => {
    const service = createClearanceService({
      fetchSurfaceClearance: vi.fn(async () => {
        throw new Error('422 precondition: target_not_wall');
      }),
    });
    await expect(service.computeComponentToWall({ sourceRefno: '1_2', targetRefno: '1_3' })).rejects.toThrow(/target_not_wall/);
  });
});

function pointToSurfaceResponse(overrides: Partial<PointToSurfaceResponse> = {}): PointToSurfaceResponse {
  return {
    success: true,
    unit: 'mm',
    method: 'point_to_surface',
    accuracy_class: 'exact-surface',
    error_bound_mm: 0.5,
    query_point: { x: 1000, y: 2000, z: 3500 },
    target: { refno: '24384/24830', noun: 'EQUI', leaf_count: 2, triangle_count: 24 },
    result: {
      distance_mm: 500,
      target_point: { x: 1000, y: 2000, z: 3000 },
      vector: { dx: 0, dy: 0, dz: -500 },
      normal: { x: 0, y: 0, z: 1 },
      feature: 'face',
      target_leaf_refno: '24384/24831',
      target_leaf_noun: 'BOX',
    },
    model: { source_sesno: null, target_sesno: 731 },
    timing_ms: { load: 2, query: 1, total: 4 },
    warnings: [],
    ...overrides,
  };
}

function pipeClearanceResponse(overrides: Partial<PipeClearanceResponse> = {}): PipeClearanceResponse {
  const segment = (refno: string, y: number) => ({
    refno,
    order: 1,
    start: { x: 0, y, z: 0 },
    end: { x: 4000, y, z: 0 },
    outside_diameter_mm: 114.3,
    effective_radius_mm: 57.15,
  });
  return {
    success: true,
    unit: 'mm',
    method: 'pipe_to_pipe_analytic',
    accuracy_class: 'exact-analytic',
    error_bound_mm: 0.01,
    source: { refno: '24381_145018', straight_segment_count: 3, insulation_mm: null, model_version: { dbnum: 24381, sesno: 812 } },
    target: { refno: '24381_145100', straight_segment_count: 2, insulation_mm: null, model_version: { dbnum: 24381, sesno: 812 } },
    result: {
      distance_mm: 385.7,
      intersects: false,
      penetration_mm: null,
      axis_distance_mm: 500,
      source_point: { x: 2000, y: 57.15, z: 0 },
      target_point: { x: 2000, y: 442.85, z: 0 },
      vector: { dx: 0, dy: 385.7, dz: 0 },
      source_axis_point: { x: 2000, y: 0, z: 0 },
      target_axis_point: { x: 2000, y: 500, z: 0 },
      source_segment: segment('24381_145018~24381_145019', 0),
      target_segment: segment('24381_145100~24381_145101', 500),
    },
    pairs_evaluated: 6,
    warnings: [],
    ...overrides,
  };
}

describe('pointToSurfaceToRecord', () => {
  it('converts a face hit into metres with exact-surface provenance', () => {
    const record = pointToSurfaceToRecord(pointToSurfaceResponse(), { targetRefno: '24384/24830', point: [1, 2, 3.5] }, AT);
    expect(record.targetRefno).toBe('24384_24830');
    expect(record.queryPoint).toEqual([1, 2, 3.5]);
    expect(record.snapshot?.distanceM).toBeCloseTo(0.5, 9);
    expect(record.snapshot?.targetPoint).toEqual([1, 2, 3]);
    expect(record.snapshot?.normal).toEqual([0, 0, 1]);
    expect(record.snapshot?.feature).toBe('face');
    expect(record.provenance.method).toBe('point-to-triangle-mesh');
    expect(record.provenance.accuracyClass).toBe('exact-surface');
    expect(record.provenance.sourceModelVersion).toBe('tgt:731');
    expect(record.targetSesno).toBe(731);
  });

  it('keeps an empty answer with its beyond_max_distance warning', () => {
    const record = pointToSurfaceToRecord(
      pointToSurfaceResponse({ result: null, warnings: ['beyond_max_distance: 1000 mm 内没有面'] }),
      { targetRefno: '24384_24830', point: [0, 0, 0], maxDistanceMm: 1000 },
      AT,
    );
    expect(record.snapshot).toBeNull();
    expect(record.provenance.warnings.map(w => w.code)).toEqual(['beyond_max_distance']);
  });

  it('refuses a response that claims a different method', () => {
    expect(() => pointToSurfaceToRecord(
      pointToSurfaceResponse({ method: 'surface_to_surface' }),
      { targetRefno: '1_2', point: [0, 0, 0] },
      AT,
    )).toThrow(/method/);
  });
});

describe('pipeClearanceToRecord', () => {
  it('labels the analytic answer derived-nominal (axis exact, OD nominal) under its own record id', () => {
    const record = pipeClearanceToRecord(
      pipeClearanceResponse(),
      { sourceRefno: '24381/145018', targetRefno: '24381_145100' },
      AT,
    );
    expect(record.id).toBe(pipeClearanceRecordId('24381_145018', '24381_145100'));
    expect(record.id).toBe('pipe-clearance:24381_145018:24381_145100');
    expect(record.kind).toBe('component-to-component');
    expect(record.inputs.targetKind).toBe('any');
    expect(record.provenance.method).toBe('pipe-centerline-analytic');
    expect(record.provenance.accuracyClass).toBe('derived-nominal');
    expect(record.provenance.errorBoundM).toBeCloseTo(0.00001, 9);
    expect(record.provenance.sourceModelVersion).toBe('src:24381:812;tgt:24381:812');
    expect(record.snapshot?.distanceM).toBeCloseTo(0.3857, 9);
    expect(record.snapshot?.sourcePoint).toEqual([2, 0.05715, 0]);
    expect(record.modelVersion).toEqual({ sourceSesno: 812, targetSesno: 812 });
  });

  it('labels the end-cap answer as an approximate lower bound and reports penetration', () => {
    const base = pipeClearanceResponse();
    const record = pipeClearanceToRecord(
      pipeClearanceResponse({
        accuracy_class: 'approximate-capsule',
        warnings: ['capsule_end_approximation: 最近点在管端'],
        result: { ...base.result!, distance_mm: 0, intersects: true, penetration_mm: 12.5 },
      }),
      { sourceRefno: '24381_145018', targetRefno: '24381_145100' },
      AT,
    );
    expect(record.provenance.method).toBe('pipe-capsule-bound');
    expect(record.provenance.accuracyClass).toBe('approximate-bounds');
    expect(record.snapshot?.intersects).toBe(true);
    expect(record.provenance.warnings.map(w => w.code)).toEqual(['capsule_end_approximation', 'pipe_intersection']);
  });
});

describe('createClearanceService point / pipe', () => {
  it('sends the query point back in mm and forwards the abort signal', async () => {
    const fetchPointToSurface = vi.fn(async () => pointToSurfaceResponse());
    const fetchPipeClearance = vi.fn(async () => pipeClearanceResponse());
    const service = createClearanceService({ fetchPointToSurface, fetchPipeClearance, now: () => AT });
    const controller = new AbortController();

    await service.computePointToSurface({ targetRefno: '24384_24830', point: [1, 2, 3.5], maxDistanceMm: 800 }, { signal: controller.signal });
    expect(fetchPointToSurface).toHaveBeenCalledWith(
      { targetRefno: '24384_24830', point: { x: 1000, y: 2000, z: 3500 }, maxDistanceMm: 800 },
      { signal: controller.signal },
    );

    const record = await service.computePipeToPipe({ sourceRefno: '24381_145018', targetRefno: '24381_145100', sourceInsulationMm: 50 });
    expect(record.provenance.method).toBe('pipe-centerline-analytic');
    expect(fetchPipeClearance).toHaveBeenCalledWith(
      expect.objectContaining({ sourceRefno: '24381_145018', targetRefno: '24381_145100', sourceInsulationMm: 50 }),
      undefined,
    );
  });
});
