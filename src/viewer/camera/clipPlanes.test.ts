import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { Matrix4, PerspectiveCamera, Vector3 } from 'three';

import {
  computeClipPlanesByDiag,
  computeSceneClipPlanes,
  MAX_CLIP_PLANE_RATIO,
} from './clipPlanes';

import {
  externalDimensionBounds,
  mbdV2ToExternalRecords,
  normalizeExternalDimension,
  parseMbdV2PipeData,
} from '@/dimension';
import {
  DEFAULT_DIMENSION_FORMAT,
  layoutViewport,
  LffFont,
  SOLVESPACE_DIMENSION_THEME,
} from '@/dimension/kernel';
import { isClippedPrimitive } from '@/dimension/kernel/geometry/sceneGeometry';
import { ThreeViewportProjector } from '@/dimension/viewport/threeViewportProjector';

describe('computeSceneClipPlanes (#139)', () => {
  it('matches computeClipPlanesByDiag verbatim when annotations are absent or stay within the model far budget', () => {
    for (const diag of [0.2, 0.8, 1, 3.5, 10, 42, 100, 450, 1000, 1800, 6000]) {
      const baseline = computeClipPlanesByDiag(diag);
      expect(computeSceneClipPlanes({ modelDiagM: diag })).toEqual(baseline);
      expect(computeSceneClipPlanes({ modelDiagM: diag, combinedDiagM: null })).toEqual(baseline);
      expect(computeSceneClipPlanes({ modelDiagM: diag, combinedDiagM: diag * 0.9 })).toEqual(baseline);
      // Slight label protrusion (e.g. +8% beyond a 6 m pipe -> 6.48 m * 10 = 65 <= far=100): zero change.
      if (diag >= 2 && diag <= 8) {
        expect(computeSceneClipPlanes({ modelDiagM: diag, combinedDiagM: diag * 1.08 })).toEqual(baseline);
      }
    }
  });

  it('extends far for small models (< 1 m) whose MBD annotations span 16–19 m while preserving near = 0.01 m and far/near <= 2e4', () => {
    // Three copied equipment packages from #139 after #121:
    // 24381_103159 (18.97 m), 24381_127703 (17.30 m), 24381_133122 (16.39 m)
    for (const combinedDiagM of [16.39, 17.3, 18.97]) {
      const planes = computeSceneClipPlanes({ modelDiagM: 0.8, combinedDiagM });
      expect(planes.near).toBe(0.01);
      expect(planes.far).toBeGreaterThanOrEqual(164);
      expect(planes.far / planes.near).toBeLessThanOrEqual(MAX_CLIP_PLANE_RATIO);
    }

    // Even larger extension (e.g. 80 m span on a 0.5 m model): smoothly lifts near to keep far/near <= 2e4.
    const wide = computeSceneClipPlanes({ modelDiagM: 0.5, combinedDiagM: 80 });
    expect(wide.far).toBe(800);
    expect(wide.far / wide.near).toBeLessThanOrEqual(MAX_CLIP_PLANE_RATIO);
  });

  it('prevents far-plane clipping on 24381_103159-shaped equipment when fitting camera to annotations', () => {
    const rawPayload = {
      version: 'v2',
      input_refno: '24381_103159',
      branch_refno: '24381_103159',
      annotation_type: 'em9_equi',
      subject: { refno: '24381_103159', noun: 'EQUI' },
      primitives: [
        {
          kind: 'label',
          id: '24381_103159:name',
          function: '设备信息',
          text: '/EQUI-103159',
          position: [2048.2, 736.7, 18850.1],
          text_height_mm: 25,
        },
        {
          kind: 'leader_line',
          id: '24381_103159:name:leader',
          function: '设备信息',
          start: [2048.2, 736.7, 18850.1],
          end: [1900, 650, 18500],
        },
        {
          kind: 'aid_line',
          id: '24381_103159:rot:axis',
          function: '偏转角度',
          start: [0, 0, 0],
          end: [300, 0, 0],
          style: 'dashed',
        },
        {
          kind: 'aid_text',
          id: '24381_103159:rot:text',
          function: '偏转角度',
          text: 'N',
          position: [320, 0, 0],
          text_height_mm: 25,
        },
      ],
      meta: {
        geometry_space: 'source_mm',
        source_to_design: [
          0.001, 0, 0, 0,
          0, 0.001, 0, 0,
          0, 0, 0.001, 0,
          0, 0, 0, 1,
        ],
        notes: [],
      },
      issues: [],
    };
    const parsed = parseMbdV2PipeData(rawPayload);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const mapped = mbdV2ToExternalRecords(parsed.data);
    const bounds = externalDimensionBounds(mapped.records)!;
    const inputs = mapped.records.map(record => normalizeExternalDimension(record));
    const font = LffFont.fromText(
      gunzipSync(readFileSync('public/fonts/unicode.lff.bin')).toString('utf8'),
    );

    const center = new Vector3(
      (bounds.min[0] + bounds.max[0]) / 2,
      (bounds.min[1] + bounds.max[1]) / 2,
      (bounds.min[2] + bounds.max[2]) / 2,
    );
    const spanDiagM = Math.hypot(
      bounds.max[0] - bounds.min[0],
      bounds.max[1] - bounds.min[1],
      bounds.max[2] - bounds.min[2],
    );
    const radius = spanDiagM / 2;
    const fovDeg = 45;
    const distance = (radius / Math.sin((fovDeg * Math.PI) / 360)) * 1.15;

    const bareInputs = inputs.map(inp => ('lod' in inp ? { ...inp, lod: undefined } : inp));

    const countVisibleInsideNearFar = (near: number, far: number) => {
      const camera = new PerspectiveCamera(fovDeg, 1920 / 1080, near, far);
      camera.up.set(0, 0, 1);
      camera.position.copy(center).add(new Vector3(1, 1, 0.8).normalize().multiplyScalar(distance));
      camera.lookAt(center);
      camera.updateMatrixWorld(true);
      camera.updateProjectionMatrix();
      const projector = new ThreeViewportProjector({
        camera,
        designToWorld: new Matrix4(),
        widthCssPx: 1920,
        heightCssPx: 1080,
        dpr: 1,
      });
      const batch = layoutViewport(
        bareInputs,
        {
          projector,
          font,
          theme: SOLVESPACE_DIMENSION_THEME,
          format: DEFAULT_DIMENSION_FORMAT,
        },
        new Map(),
      );
      return batch.layouts.filter(layout =>
        layout.primitives.some(prim => !isClippedPrimitive(prim))).length;
    };

    // Old model-only clip planes (modelDiagM = 0.8 m -> far = 20 m): camera sits ~28.5 m away,
    // so every record sits beyond NDC z = +1 and is clipped out by the far plane!
    const oldPlanes = computeClipPlanesByDiag(0.8);
    expect(oldPlanes).toEqual({ near: 0.01, far: 20 });
    expect(countVisibleInsideNearFar(oldPlanes.near, oldPlanes.far)).toBe(0);

    // New scene clip planes including MBD bounds: near stays 0.01 m, far covers 100% of records!
    const nextPlanes = computeSceneClipPlanes({ modelDiagM: 0.8, combinedDiagM: spanDiagM });
    expect(nextPlanes.near).toBe(0.01);
    expect(countVisibleInsideNearFar(nextPlanes.near, nextPlanes.far)).toBe(bareInputs.length);
  });
});
