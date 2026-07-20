import { describe, expect, it } from 'vitest';

import { Matrix4, OrthographicCamera, Vector3 } from 'three';

import {
  buildPositionPickCandidate,
  cloneMeasurementPickSourceSettings,
  measurementPickSettingsFromLegacy,
  resolveMeasurementPickCandidates,
  scenePositionFromTransform,
  type MeasurementPickCandidate,
} from './useMeasurementPickSources';

describe('useMeasurementPickSources', () => {
  function camera() {
    const cam = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    cam.position.set(0, 0, 1);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld();
    cam.updateProjectionMatrix();
    return cam;
  }

  it('enables item origin snapping and keeps model surface snap opt-in by default', () => {
    const settings = cloneMeasurementPickSourceSettings();

    expect(settings.position.show).toBe(true);
    expect(settings.position.snap).toBe(true);
    expect(settings.position.thresholdPx).toBe(18);
    expect(settings.mesh_pick_point.show).toBe(true);
    expect(settings.mesh_pick_point.snap).toBe(false);
  });

  it('filters display and snap independently, then sorts by priority, distance, and id', () => {
    const settings = cloneMeasurementPickSourceSettings({
      ptset: { show: true, snap: true, priority: 20, thresholdPx: 40 },
      mesh_pick_point: { show: false, snap: true, priority: 40, thresholdPx: 40 },
      position: { show: true, snap: true, priority: 20, thresholdPx: 40 },
    });
    const candidates: MeasurementPickCandidate[] = [
      {
        id: 'ptset:b',
        source: 'ptset',
        entityId: 'ptset:b',
        objectId: 'o:24381_2:0',
        worldPos: new Vector3(0.1, 0, 0),
      },
      {
        id: 'position:a',
        source: 'position',
        entityId: 'position:a',
        objectId: 'o:24381_1:0',
        worldPos: new Vector3(0, 0, 0),
      },
      {
        id: 'mesh:c',
        source: 'mesh_pick_point',
        entityId: '24381_3',
        objectId: 'o:24381_3:0',
        worldPos: new Vector3(0, 0, 0),
      },
    ];

    const resolved = resolveMeasurementPickCandidates({
      cursor: { x: 100, y: 100 },
      camera: camera(),
      rect: { width: 200, height: 200 },
      settings,
      candidates,
    });

    expect(resolved.visibleCandidates.map((item) => item.id)).toEqual(['position:a', 'ptset:b']);
    expect(resolved.snapCandidates.map((item) => item.id)).toEqual(['position:a', 'mesh:c', 'ptset:b']);
    expect(resolved.hit?.id).toBe('position:a');
  });

  it('keeps PTSET display independent when migrating legacy snap settings', () => {
    const enabled = measurementPickSettingsFromLegacy({
      keypointSnapEnabled: true,
      keypointSnapPx: 9,
    });
    const disabled = measurementPickSettingsFromLegacy({
      keypointSnapEnabled: false,
      keypointSnapPx: 99,
    });

    expect(enabled.ptset).toMatchObject({ show: true, snap: true, thresholdPx: 9 });
    expect(disabled.ptset).toMatchObject({ show: true, snap: false, thresholdPx: 40 });
    expect(enabled.mesh_pick_point.snap).toBe(false);
  });

  it('normalizes invalid and boundary threshold inputs deterministically', async () => {
    const { DEFAULT_PTSET_SNAP_PX } = await import('./usePtsetSnap');
    const { clampMeasurementPickThreshold } = await import('./useMeasurementPickSources');

    expect(clampMeasurementPickThreshold('')).toBe(DEFAULT_PTSET_SNAP_PX);
    expect(clampMeasurementPickThreshold('not-a-number')).toBe(DEFAULT_PTSET_SNAP_PX);
    expect(clampMeasurementPickThreshold(0)).toBe(4);
    expect(clampMeasurementPickThreshold(-1)).toBe(4);
    expect(clampMeasurementPickThreshold(4)).toBe(4);
    expect(clampMeasurementPickThreshold(40)).toBe(40);
    expect(clampMeasurementPickThreshold(41)).toBe(40);
  });

  it('builds position candidates from object transforms and global model matrix', () => {
    const transform = [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      1, 2, 3, 1,
    ];
    const globalModelMatrix = new Matrix4().makeTranslation(10, 0, 0);

    expect(scenePositionFromTransform({ transform, globalModelMatrix })?.toArray()).toEqual([11, 2, 3]);
    expect(buildPositionPickCandidate({
      refno: '24381_145018',
      objectId: 'o:24381_145018:0',
      transform,
      globalModelMatrix,
    })).toMatchObject({
      id: 'position:24381_145018',
      source: 'position',
      entityId: 'position:24381_145018',
      label: '实例原点 24381_145018',
    });
  });

  it('selects a clearly closer mesh pick before a higher-priority P-Point', () => {
    const settings = cloneMeasurementPickSourceSettings({
      ptset: { show: true, snap: true, priority: 20, thresholdPx: 80 },
      mesh_pick_point: { show: true, snap: true, priority: 40, thresholdPx: 80 },
    });
    const candidates: MeasurementPickCandidate[] = [
      {
        id: 'mesh:o:24381_145018:0',
        source: 'mesh_pick_point',
        entityId: 'o:24381_145018:0',
        objectId: 'o:24381_145018:0',
        worldPos: new Vector3(0, 0, 0),
      },
      {
        id: 'ptset:24381_145018#1',
        source: 'ptset',
        entityId: 'ptset:24381_145018#1',
        objectId: 'o:24381_145018:0',
        worldPos: new Vector3(0.1, 0, 0),
      },
    ];

    const resolved = resolveMeasurementPickCandidates({
      cursor: { x: 100, y: 100 },
      camera: camera(),
      rect: { width: 200, height: 200 },
      settings,
      candidates,
    });

    expect(resolved.snapCandidates.map((item) => item.id)).toEqual([
      'mesh:o:24381_145018:0',
      'ptset:24381_145018#1',
    ]);
    expect(resolved.snapCandidates[0]?.pixelDistance).toBe(0);
    expect(resolved.snapCandidates[1]?.pixelDistance).toBeCloseTo(10);
    expect(resolved.hit?.id).toBe('mesh:o:24381_145018:0');
    expect(resolved.hit?.source).toBe('mesh_pick_point');
  });

  it('uses source priority as the tie-breaker for near-overlapping candidates', () => {
    const settings = cloneMeasurementPickSourceSettings({
      ptset: { show: true, snap: true, priority: 20, thresholdPx: 80 },
      mesh_pick_point: { show: true, snap: true, priority: 40, thresholdPx: 80 },
    });
    const candidates: MeasurementPickCandidate[] = [
      {
        id: 'mesh:o:24381_145018:0',
        source: 'mesh_pick_point',
        entityId: 'o:24381_145018:0',
        objectId: 'o:24381_145018:0',
        worldPos: new Vector3(0, 0, 0),
      },
      {
        id: 'ptset:24381_145018#1',
        source: 'ptset',
        entityId: 'ptset:24381_145018#1',
        objectId: 'o:24381_145018:0',
        worldPos: new Vector3(0.02, 0, 0),
      },
    ];

    const resolved = resolveMeasurementPickCandidates({
      cursor: { x: 100, y: 100 },
      camera: camera(),
      rect: { width: 200, height: 200 },
      settings,
      candidates,
    });

    expect(resolved.snapCandidates.map((item) => item.id)).toEqual([
      'ptset:24381_145018#1',
      'mesh:o:24381_145018:0',
    ]);
    expect(resolved.snapCandidates[0]?.pixelDistance).toBeCloseTo(2);
    expect(resolved.snapCandidates[1]?.pixelDistance).toBe(0);
    expect(resolved.hit?.source).toBe('ptset');
  });

  it('falls back to mesh when PTSET is outside threshold', () => {
    const settings = cloneMeasurementPickSourceSettings({
      ptset: { show: true, snap: true, priority: 20, thresholdPx: 4 },
      mesh_pick_point: { show: true, snap: true, priority: 40, thresholdPx: 80 },
    });
    const candidates: MeasurementPickCandidate[] = [
      {
        id: 'ptset:24381_145018#1',
        source: 'ptset',
        entityId: 'ptset:24381_145018#1',
        objectId: 'o:24381_145018:0',
        worldPos: new Vector3(0.1, 0, 0),
      },
      {
        id: 'mesh:o:24381_145018:0',
        source: 'mesh_pick_point',
        entityId: 'o:24381_145018:0',
        objectId: 'o:24381_145018:0',
        worldPos: new Vector3(0, 0, 0),
      },
    ];

    const resolved = resolveMeasurementPickCandidates({
      cursor: { x: 100, y: 100 },
      camera: camera(),
      rect: { width: 200, height: 200 },
      settings,
      candidates,
    });

    expect(resolved.snapCandidates.map((item) => item.id)).toEqual(['mesh:o:24381_145018:0']);
    expect(resolved.hit?.source).toBe('mesh_pick_point');
  });
});
