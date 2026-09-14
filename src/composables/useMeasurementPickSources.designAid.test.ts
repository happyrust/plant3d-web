import { describe, expect, it } from 'vitest';

import { PerspectiveCamera, Vector3 } from 'three';

import {
  DEFAULT_MEASUREMENT_PICK_SOURCE_SETTINGS,
  buildDesignAidCandidates,
  measurementPickCandidateFeature,
  resolveMeasurementPickCandidates,
} from './useMeasurementPickSources';

import { createMeasurementAidSession } from '@/composables/useMeasurementAidStore';
import { measurementPickFilterAdmits } from '@/measurement/pick/pickLayerModel';

/** Design World == scene here (identity model matrix), as in the unit-test viewer. */
const toScene = (point: readonly [number, number, number]): Vector3 => new Vector3(point[0], point[1], point[2]);

function session() {
  const aids = createMeasurementAidSession();
  const line = aids.addLine({ start: [0, 0, 0], end: [10, 0, 0], description: '梁顶' });
  const plane = aids.addPlane({ position: [0, 0, 5], zDir: [0, 0, 1], xSize: 4, ySize: 2 });
  if (!line.ok || !plane.ok) throw new Error('fixture');
  return { aids, line: line.value, plane: plane.value };
}

describe('buildDesignAidCandidates · E3D stdAid → DESIGNAID picks', () => {
  it('turns a visible aid line into a line candidate at the point nearest the ray, carrying the whole line', () => {
    const { aids, line } = session();
    const out = buildDesignAidCandidates({
      aids: aids.visibleAids.value,
      ray: { origin: [4, 5, 0.3], direction: [0, -1, 0] },
      toScene,
    });
    const candidate = out.find((entry) => entry.id === `aid:${line.id}`);
    expect(candidate).toBeDefined();
    expect(candidate!.source).toBe('design_aid');
    expect(measurementPickCandidateFeature(candidate!)).toBe('aid');
    expect(candidate!.label).toBe('梁顶');
    expect(candidate!.worldPos.toArray()).toEqual([4, 0, 0]);
    expect(candidate!.segment?.start.toArray()).toEqual([0, 0, 0]);
    expect(candidate!.segment?.end.toArray()).toEqual([10, 0, 0]);
    // Perpendicular-to `getLine()` = the aid LINE itself.
    expect(candidate!.direction?.toArray()).toEqual([10, 0, 0]);
    expect(candidate!.rayHit).toBeUndefined();
  });

  it('turns an aid plane into a plane candidate only when the ray lands on the drawn rectangle', () => {
    const { aids, plane } = session();
    const inside = buildDesignAidCandidates({
      aids: aids.visibleAids.value,
      ray: { origin: [1, 0.5, 20], direction: [0, 0, -1] },
      toScene,
    }).find((entry) => entry.id === `aid:${plane.id}`);
    expect(inside).toBeDefined();
    expect(inside!.label).toBe('Plane [2]');
    expect(inside!.worldPos.toArray()).toEqual([1, 0.5, 5]);
    expect(inside!.plane?.position.toArray()).toEqual([1, 0.5, 5]);
    expect(inside!.plane?.normal.toArray()).toEqual([0, 0, 1]);
    expect(inside!.plane?.outline).toHaveLength(4);
    expect(inside!.rayHit).toBe(true);
    expect(inside!.segment).toBeUndefined();

    const outside = buildDesignAidCandidates({
      aids: aids.visibleAids.value,
      ray: { origin: [3, 0, 20], direction: [0, 0, -1] },
      toScene,
    }).find((entry) => entry.id === `aid:${plane.id}`);
    expect(outside).toBeUndefined();
  });

  it('skips hidden aids (E3D visible = false draws nothing to pick)', () => {
    const { aids, line, plane } = session();
    aids.setVisible(line.id, false);
    const out = buildDesignAidCandidates({
      aids: aids.visibleAids.value,
      ray: { origin: [4, 5, 0.3], direction: [0, -1, 0] },
      toScene,
    });
    expect(out.some((entry) => entry.id === `aid:${line.id}`)).toBe(false);
    // the plane is still there (the ray misses its rectangle here, so nothing at all)
    expect(aids.visibleAids.value.map((aid) => aid.id)).toEqual([plane.id]);
  });

  it('is admitted by the Aid filter only, and wins the pick there', () => {
    const { aids, line } = session();
    const candidates = buildDesignAidCandidates({
      aids: aids.visibleAids.value,
      ray: { origin: [4, 5, 0], direction: [0, -1, 0] },
      toScene,
    });
    expect(measurementPickFilterAdmits('aid', 'snap', 'aid')).toBe(true);
    expect(measurementPickFilterAdmits('any', 'snap', 'aid')).toBe(false);
    expect(measurementPickFilterAdmits('graphics', 'snap', 'aid')).toBe(false);

    const camera = new PerspectiveCamera(50, 1, 0.1, 1000);
    camera.position.set(4, 5, 0);
    camera.lookAt(4, 0, 0);
    camera.updateMatrixWorld();
    const rect = { width: 400, height: 400 };
    const cursor = { x: 200, y: 200 };
    const underAid = resolveMeasurementPickCandidates({
      cursor, camera, rect, candidates,
      settings: DEFAULT_MEASUREMENT_PICK_SOURCE_SETTINGS,
      pickLayer: { filter: 'aid', pickType: 'snap' },
    });
    expect(underAid.hit?.id).toBe(`aid:${line.id}`);
    const underAny = resolveMeasurementPickCandidates({
      cursor, camera, rect, candidates,
      settings: DEFAULT_MEASUREMENT_PICK_SOURCE_SETTINGS,
      pickLayer: { filter: 'any', pickType: 'snap' },
    });
    expect(underAny.hit).toBeNull();
    expect(underAny.visibleCandidates).toEqual([]);
  });
});

describe('createMeasurementAidSession', () => {
  it('numbers aids 1, 2, 3 … in creation order, keeps ids stable and bumps the revision on every change', () => {
    const aids = createMeasurementAidSession();
    expect(aids.revision.value).toBe(0);
    const a = aids.addLine({ start: [0, 0, 0], end: [1, 0, 0] });
    const b = aids.addPlane({ position: [0, 0, 0], zDir: [0, 0, 1] });
    expect(a.ok && a.value.number).toBe(1);
    expect(b.ok && b.value.number).toBe(2);
    expect(aids.revision.value).toBe(2);
    expect(aids.lines.value).toHaveLength(1);
    expect(aids.planes.value).toHaveLength(1);

    const bad = aids.addLine({ start: [0, 0, 0], end: [0, 0, 0] });
    expect(bad.ok).toBe(false);
    expect(aids.aids.value).toHaveLength(2);
    expect(aids.revision.value).toBe(2);

    if (!a.ok) return;
    aids.setVisible(a.value.id, false);
    expect(aids.visibleAids.value.map((aid) => aid.number)).toEqual([2]);
    expect(aids.revision.value).toBe(3);
    aids.setVisible(a.value.id, false);
    expect(aids.revision.value).toBe(3);
    aids.setDescription(a.value.id, ' 顶线 ');
    expect(aids.byId(a.value.id)?.description).toBe('顶线');

    expect(aids.remove(a.value.id)).toBe(true);
    expect(aids.remove(a.value.id)).toBe(false);
    // the freed number is not reused while a higher one is in use
    const c = aids.addLine({ start: [0, 0, 0], end: [0, 1, 0] });
    expect(c.ok && c.value.number).toBe(3);
    aids.clear();
    expect(aids.aids.value).toEqual([]);
    const d = aids.addLine({ start: [0, 0, 0], end: [0, 1, 0] });
    expect(d.ok && d.value.number).toBe(1);
  });
});
