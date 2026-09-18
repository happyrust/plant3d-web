import { describe, expect, it, vi } from 'vitest';

import {
  createClearanceService,
  parseServerWarning,
  surfaceClearanceToRecord,
} from './clearanceService';

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
