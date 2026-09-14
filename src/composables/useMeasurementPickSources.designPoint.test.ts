import { describe, expect, it } from 'vitest';

import { PerspectiveCamera, Vector3 } from 'three';

import {
  DEFAULT_MEASUREMENT_PICK_SOURCE_SETTINGS,
  buildDesignPointCandidates,
  measurementPickCandidateFeature,
  resolveMeasurementPickCandidates,
} from './useMeasurementPickSources';

import type { LoadedDesignPoint } from '@/measurement/dpoint/designPointLoader';

import { resolvePerpendicularTarget } from '@/measurement/kernel/perpendicularTargetProvider';
import { measurementPickFilterAdmits } from '@/measurement/pick/pickLayerModel';

/** World mm → "scene" metres (identity model matrix apart from the unit change). */
const toScene = (worldMm: readonly [number, number, number]): Vector3 => (
  new Vector3(worldMm[0] / 1000, worldMm[1] / 1000, worldMm[2] / 1000)
);

const points: LoadedDesignPoint[] = [
  {
    hostRefno: '23714_1111', hostNoun: 'STRU', setRefno: '23714_1126', pointRefno: '23714_1127', pointNoun: 'DPCA',
    number: 1, worldMm: [0, 0, -86], direction: [0, 0, 1], purpose: 'CATT',
  },
  {
    hostRefno: '23714_1111', hostNoun: 'STRU', setRefno: '23714_1126', pointRefno: '23714_1128', pointNoun: 'DPCY',
    number: 2, worldMm: [500, 0, 0], direction: null, purpose: null,
  },
];

describe('buildDesignPointCandidates · E3D DPOINT', () => {
  it('makes point candidates at DPPS[n] carrying DPDI[n] as direction, labelled by number / purpose', () => {
    const out = buildDesignPointCandidates({ points, toScene });
    expect(out).toHaveLength(2);
    const [p1, p2] = out;
    expect(p1!.id).toBe('dpoint:23714_1111#1');
    expect(p1!.source).toBe('design_point');
    expect(measurementPickCandidateFeature(p1!)).toBe('dpoint');
    expect(p1!.objectId).toBe('o:23714_1111:dpoint');
    expect(p1!.label).toBe('设计点 #1（CATT）');
    expect(p1!.worldPos.toArray()).toEqual([0, 0, -0.086]);
    expect(p1!.direction?.toArray().map((v) => Number(v.toFixed(9)))).toEqual([0, 0, 0.001]);
    expect(p1!.segment).toBeUndefined();
    expect(p1!.plane).toBeUndefined();
    expect(p2!.label).toBe('设计点 #2');
    expect(p2!.direction).toBeUndefined();
  });

  it('is admitted with the P-points (Any / Ppoint) and never under Element / Pline / Graphics / Aid', () => {
    expect(measurementPickFilterAdmits('any', 'snap', 'dpoint')).toBe(true);
    expect(measurementPickFilterAdmits('ppoint', 'snap', 'dpoint')).toBe(true);
    for (const filter of ['element', 'pline', 'graphics', 'screen', 'aid', 'external'] as const) {
      expect(measurementPickFilterAdmits(filter, 'snap', 'dpoint')).toBe(false);
    }
    const candidates = buildDesignPointCandidates({ points, toScene });
    const camera = new PerspectiveCamera(50, 1, 0.01, 100);
    camera.position.set(0, -2, -0.086);
    camera.lookAt(0, 0, -0.086);
    camera.updateMatrixWorld();
    const rect = { width: 400, height: 400 };
    const cursor = { x: 200, y: 200 };
    const underPpoint = resolveMeasurementPickCandidates({
      cursor, camera, rect, candidates,
      settings: DEFAULT_MEASUREMENT_PICK_SOURCE_SETTINGS,
      pickLayer: { filter: 'ppoint', pickType: 'snap' },
    });
    expect(underPpoint.hit?.id).toBe('dpoint:23714_1111#1');
    const underElement = resolveMeasurementPickCandidates({
      cursor, camera, rect, candidates,
      settings: DEFAULT_MEASUREMENT_PICK_SOURCE_SETTINGS,
      pickLayer: { filter: 'element', pickType: 'snap' },
    });
    expect(underElement.hit).toBeNull();
  });

  it('as a Perpendicular-to target is the plane through the point with Z is DPDI (E3D getPlane, no getLine branch)', () => {
    // The tool hands a design point over as `plane` (position = DPPS, normal = DPDI) and no `direction`.
    const resolved = resolvePerpendicularTarget({ point: [0, 0, -0.086], plane: { position: [0, 0, -0.086], normal: [0, 0, 1] } });
    expect(resolved.provider).toBe('facet-plane');
    expect(resolved.target).toEqual({ kind: 'plane', position: [0, 0, -0.086], normal: [0, 0, 1] });
  });
});
