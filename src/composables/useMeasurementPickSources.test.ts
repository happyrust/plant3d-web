import { describe, expect, it } from 'vitest';

import { Matrix4, OrthographicCamera, Vector3 } from 'three';

import {
  buildGraphicsPickCandidates,
  buildPositionPickCandidate,
  buildTubingAxisCandidate,
  cloneMeasurementPickSourceSettings,
  measurementPickSettingsFromLegacy,
  resolveMeasurementPickCandidates,
  scenePositionFromTransform,
  type MeasurementPickCandidate,
} from './useMeasurementPickSources';

import type { RefinedTubingAxis } from '@/measurement/tubing/tubingAxis';

import { analyseMeshGraphics } from '@/measurement/graphics/meshFeatureGraphics';

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
      label: 'Item 原点 24381_145018',
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

  it('selects the nearest 4px cohort deterministically for every provider order', () => {
    const settings = cloneMeasurementPickSourceSettings({
      position: { show: true, snap: true, priority: 30, thresholdPx: 80 },
      ptset: { show: true, snap: true, priority: 20, thresholdPx: 80 },
      primitive_key_point: { show: true, snap: true, priority: 10, thresholdPx: 80 },
    });
    const candidates: MeasurementPickCandidate[] = [
      {
        id: 'A-position-1px',
        source: 'position',
        entityId: 'position:a',
        objectId: 'o:1_1:0',
        worldPos: new Vector3(0.01, 0, 0),
      },
      {
        id: 'B-ptset-5px',
        source: 'ptset',
        entityId: 'ptset:b',
        objectId: 'o:1_2:0',
        worldPos: new Vector3(0.05, 0, 0),
      },
      {
        id: 'C-primitive-9px',
        source: 'primitive_key_point',
        entityId: 'primitive:c',
        objectId: 'o:1_3:0',
        worldPos: new Vector3(0.09, 0, 0),
      },
    ];
    const orders = [
      [candidates[0], candidates[1], candidates[2]],
      [candidates[0], candidates[2], candidates[1]],
      [candidates[1], candidates[0], candidates[2]],
      [candidates[1], candidates[2], candidates[0]],
      [candidates[2], candidates[0], candidates[1]],
      [candidates[2], candidates[1], candidates[0]],
    ] as MeasurementPickCandidate[][];

    const results = orders.map(order => resolveMeasurementPickCandidates({
      cursor: { x: 100, y: 100 },
      camera: camera(),
      rect: { width: 200, height: 200 },
      settings,
      candidates: order,
    }));

    expect(results.map(result => result.hit?.id)).toEqual(
      Array(orders.length).fill('B-ptset-5px'),
    );
    expect(results.map(result => result.snapCandidates.map(candidate => candidate.id))).toEqual(
      Array(orders.length).fill(['B-ptset-5px', 'A-position-1px', 'C-primitive-9px']),
    );
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

  describe('buildGraphicsPickCandidates · E3D Graphics (pickdetail) on a mesh hit', () => {
    // Flat unit square at z=0 facing the camera (two triangles, four boundary edges).
    const square = {
      positions: [-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0],
      indices: [0, 1, 2, 0, 2, 3],
    };
    const features = analyseMeshGraphics(square);
    const rect = { width: 200, height: 200 }; // orthographic camera: 100 px per world unit
    const triangle0: [Vector3, Vector3, Vector3] = [
      new Vector3(-0.5, -0.5, 0), new Vector3(0.5, -0.5, 0), new Vector3(0.5, 0.5, 0),
    ];
    const base = (x: number, y: number) => ({
      objectId: 'o:24381_145018:0',
      entityId: 'o:24381_145018:0',
      features,
      hitPoint: new Vector3(x, y, 0),
      hitTriangle: triangle0,
      ray: { origin: new Vector3(x, y, 1), direction: new Vector3(0, 0, -1) },
      cursor: { x: 100 + x * 100, y: 100 - y * 100 },
      camera: camera(),
      rect,
      edgeThresholdPx: 12,
    });

    it('far from any drawn edge → one facet PLANE candidate at the hit point with the patch outline', () => {
      const candidates = buildGraphicsPickCandidates(base(0, 0));
      expect(candidates).toHaveLength(1);
      const facet = candidates[0]!;
      expect(facet.source).toBe('mesh_graphics');
      expect(facet.feature).toBe('graphics-plane');
      expect(facet.label).toBe('面');
      expect(facet.worldPos.toArray()).toEqual([0, 0, 0]);
      expect(facet.plane?.normal.toArray().map((v) => Number(v.toFixed(9)))).toEqual([0, 0, 1]);
      expect(facet.plane?.outline).toHaveLength(4);
      expect(facet.segment).toBeUndefined();
    });

    it('within the edge aperture → the drawn edge becomes a LINE candidate snapped nearest the cursor ray, and the facet is not offered', () => {
      // 2 px inside the right edge (x = 0.5).
      const candidates = buildGraphicsPickCandidates(base(0.48, 0.1));
      expect(candidates).toHaveLength(1);
      const edge = candidates[0]!;
      expect(edge.feature).toBe('graphics-line');
      expect(edge.label).toBe('边');
      expect(edge.worldPos.toArray().map((v) => Number(v.toFixed(9)))).toEqual([0.5, 0.1, 0]);
      const [sx, sy] = [edge.segment!.start.x, edge.segment!.end.x];
      expect(sx).toBeCloseTo(0.5, 12);
      expect(sy).toBeCloseTo(0.5, 12);
      expect(Math.abs(edge.segment!.end.y - edge.segment!.start.y)).toBeCloseTo(1, 12);
      // Infinite line through the edge is the Perpendicular-to LINE provider.
      expect(Math.abs(edge.direction!.normalize().y)).toBeCloseTo(1, 12);
    });

    it('is admitted only under the Graphics pick filter (E3D stdAny never picks detail graphics)', () => {
      const settings = cloneMeasurementPickSourceSettings();
      const candidates = buildGraphicsPickCandidates(base(0, 0));
      const resolve = (filter: 'any' | 'graphics') => resolveMeasurementPickCandidates({
        cursor: { x: 100, y: 100 },
        camera: camera(),
        rect,
        settings,
        candidates,
        pickLayer: { filter, pickType: 'snap' },
      });
      expect(resolve('any').hit).toBeNull();
      expect(resolve('any').visibleCandidates).toEqual([]);
      const graphics = resolve('graphics');
      expect(graphics.hit?.feature).toBe('graphics-plane');
      // `show` is off by default: the picked detail is highlighted instead of drawing crosses.
      expect(graphics.visibleCandidates).toEqual([]);
    });
  });

  describe('buildTubingAxisCandidate · E3D TUBING on a tube the ray hit', () => {
    const rect = { width: 200, height: 200 }; // orthographic camera: 100 px per world unit
    // Tube axis along +x at y = 0.3 (screen 70 px above centre), radius 0.3, from x = −0.8 to 0.6.
    const axis: RefinedTubingAxis = {
      start: [-0.8, 0.3, 0],
      end: [0.6, 0.3, 0],
      radius: 0.3,
      startPoint: { position: [-0.8, 0.3, 0], label: 'ELBO P-Point #2' },
      endPoint: null,
    };
    const rayAt = (x: number, y: number) => ({ origin: new Vector3(x, y, 1), direction: new Vector3(0, 0, -1) });
    const cursorAt = (x: number, y: number) => ({ x: 100 + x * 100, y: 100 - y * 100 });

    it('control point = axis point nearest the ray (EDGTUBING.exact); segment / direction carry the axis; refined end labels are echoed', () => {
      const candidate = buildTubingAxisCandidate({
        objectId: 'o:24381_145018:3',
        entityId: 'o:24381_145018:3',
        axis,
        ray: rayAt(0.1, 0.05), // on the tube surface below the axis
      })!;
      expect(candidate).not.toBeNull();
      expect(candidate.source).toBe('tubing_axis');
      expect(candidate.feature).toBe('tubing');
      expect(candidate.rayHit).toBe(true);
      expect(candidate.id).toBe('tubing:o:24381_145018:3');
      // Bare label like the Graphics '边' / '面': the command bar prefixes the noun → `TUBI 轴线（…）`.
      expect(candidate.label).toBe('轴线（ELBO P-Point #2）');
      expect(candidate.worldPos.toArray().map((v) => Number(v.toFixed(9)))).toEqual([0.1, 0.3, 0]);
      expect(candidate.segment?.start.toArray()).toEqual([-0.8, 0.3, 0]);
      expect(candidate.segment?.end.toArray()).toEqual([0.6, 0.3, 0]);
      expect(candidate.direction!.clone().normalize().toArray().map((v) => Number(v.toFixed(9)))).toEqual([1, 0, 0]);
      expect(candidate.plane).toBeUndefined();

      // Beyond the end the control point clamps to the end (GMFLINE control on the segment).
      const past = buildTubingAxisCandidate({ objectId: 'o:1', entityId: 'o:1', axis, ray: rayAt(0.9, 0.3) })!;
      expect(past.worldPos.toArray().map((v) => Number(v.toFixed(9)))).toEqual([0.6, 0.3, 0]);
      // No refined ends → plain label.
      const bare = buildTubingAxisCandidate({
        objectId: 'o:1', entityId: 'o:1', axis: { ...axis, startPoint: null, endPoint: null }, ray: rayAt(0, 0),
      })!;
      expect(bare.label).toBe('轴线');
    });

    it('rayHit admits the axis anywhere on the tube but only at the aperture edge: a P-Point inside its own aperture wins, a cursor near the axis line wins outright', () => {
      const settings = cloneMeasurementPickSourceSettings();
      const tube = buildTubingAxisCandidate({ objectId: 'o:1', entityId: 'o:1', axis, ray: rayAt(0.1, 0.05) })!;
      // Cursor 25 px below the axis line (well outside the 18 px axis aperture) but on the tube.
      const alone = resolveMeasurementPickCandidates({
        cursor: cursorAt(0.1, 0.05), camera: camera(), rect, settings, candidates: [tube], pickLayer: { filter: 'any', pickType: 'snap' },
      });
      expect(alone.hit?.id).toBe('tubing:o:1');
      expect(alone.hit?.pixelDistance).toBe(settings.tubing_axis.thresholdPx);

      // A P-Point 8 px from the cursor (inside its 12 px aperture) beats the clamped tube.
      const ppoint: MeasurementPickCandidate = {
        id: 'ptset:24381_145030#1',
        source: 'ptset',
        entityId: 'ptset:24381_145030#1',
        objectId: 'o:24381_145030:ptset',
        worldPos: new Vector3(0.18, 0.05, 0),
      };
      const withPoint = resolveMeasurementPickCandidates({
        cursor: cursorAt(0.1, 0.05), camera: camera(), rect, settings, candidates: [tube, ppoint], pickLayer: { filter: 'any', pickType: 'snap' },
      });
      expect(withPoint.snapCandidates.map((item) => item.id)).toEqual(['ptset:24381_145030#1', 'tubing:o:1']);

      // Cursor 2 px from the axis line: the real projected distance is kept and the tube wins over a farther P-Point.
      const near = buildTubingAxisCandidate({ objectId: 'o:1', entityId: 'o:1', axis, ray: rayAt(0.1, 0.28) })!;
      const nearResolved = resolveMeasurementPickCandidates({
        cursor: cursorAt(0.1, 0.28), camera: camera(), rect, settings, candidates: [near, ppoint], pickLayer: { filter: 'any', pickType: 'snap' },
      });
      expect(nearResolved.hit?.id).toBe('tubing:o:1');
      expect(nearResolved.hit?.pixelDistance).toBeCloseTo(2, 6);

      // Not a snap candidate without rayHit when the control point is outside the aperture.
      const plain = { ...tube, rayHit: false };
      expect(resolveMeasurementPickCandidates({
        cursor: cursorAt(0.1, 0.05), camera: camera(), rect, settings, candidates: [plain], pickLayer: { filter: 'any', pickType: 'snap' },
      }).hit).toBeNull();
    });

    it('is admitted under Any and Element (E3D element pick returns TUBING), never under Pline / Ppoint / Graphics / Screen', () => {
      const settings = cloneMeasurementPickSourceSettings();
      const tube = buildTubingAxisCandidate({ objectId: 'o:1', entityId: 'o:1', axis, ray: rayAt(0.1, 0.3) })!;
      const hitUnder = (filter: 'any' | 'element' | 'pline' | 'ppoint' | 'graphics' | 'screen') => resolveMeasurementPickCandidates({
        cursor: cursorAt(0.1, 0.3), camera: camera(), rect, settings, candidates: [tube], pickLayer: { filter, pickType: 'snap' },
      }).hit?.id ?? null;
      expect(hitUnder('any')).toBe('tubing:o:1');
      expect(hitUnder('element')).toBe('tubing:o:1');
      expect(hitUnder('pline')).toBeNull();
      expect(hitUnder('ppoint')).toBeNull();
      expect(hitUnder('graphics')).toBeNull();
      expect(hitUnder('screen')).toBeNull();
    });
  });
});
