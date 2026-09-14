import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  useToolStore,
  type CloudAnnotationRecord,
  type CloudLabelLayoutV1,
  type CloudPresentationV1,
  type CloudViewpointV1,
  type RegionV1,
} from './useToolStore';

/**
 * 空间范围体四字段（regionV1 / presentationV1 / viewpointV1 / labelLayoutV1）在 `normalizeCloudAnnotationRecord`
 * 单一漏斗里的补齐与无损往返——2026-09-14 方案 §6.3–6.5 的 P0 验收。
 */

const CREATED_AT = 1_700_000_000_000;

function makeLegacyCloud(id: string, overrides: Partial<CloudAnnotationRecord> = {}): CloudAnnotationRecord {
  return {
    id,
    objectIds: ['=24381/145019'],
    anchorWorldPos: [0, 0, 0],
    anchorRefno: '=24381/145018',
    refnos: ['=24381/145019'],
    selectionBbox: { min: [0, 0, 0], max: [4, 2, 6] },
    screenOffset: { x: 86, y: -54 },
    cloudSize: { width: 120, height: 72 },
    visible: true,
    title: `cloud-${id}`,
    description: 'desc',
    createdAt: CREATED_AT,
    ...overrides,
  };
}

const membersRegion: RegionV1 = {
  version: 1,
  space: 'world',
  source: {
    projectKey: null,
    modelSnapshotId: '7997:parquet:2026-09-14T10:00:00Z',
    globalModelMatrix: [0.001, 0, 0, 0, 0, 0.001, 0, 0, 0, 0, 0.001, 0, -12.5, -3.25, -0.75, 1],
    coordinateFrameId: '7997:0.001:1',
  },
  origin: 'members',
  kind: 'obb-union',
  boxes: [
    {
      id: 'o:24381_145019:0',
      memberRefno: '=24381/145019',
      center: [1.5, 0.25, 2],
      axes: [[0.6, 0.8, 0], [-0.8, 0.6, 0], [0, 0, 1]],
      halfSize: [3, 0.1, 0.1],
    },
  ],
};

const regionPresentation: CloudPresentationV1 = {
  version: 1,
  algorithm: 'region-v1',
  contour: 'convex-hull',
  paddingPx: 14,
  wavelengthPx: 52,
  amplitudePx: 4,
  phaseAnchor: { featureId: 'o:24381_145019:0:3', offsetPx: 0 },
};

const viewpoint: CloudViewpointV1 = {
  creation: {
    version: 1,
    capturedAt: CREATED_AT,
    position: [10, -20, 5],
    target: [1.5, 0.25, 2],
    up: [0, 0, 1],
    projection: { kind: 'perspective', verticalFovDeg: 45, zoom: 1, near: 0.1, far: 5000 },
    viewportCss: { width: 1600, height: 900 },
    devicePixelRatio: 2,
    capturedContext: ['camera'],
  },
};

const labelLayout: CloudLabelLayoutV1 = {
  version: 1,
  anchor: { kind: 'contour-bounds', uv: [1, 0], labelPoint: 'top-left' },
  offsetPx: { x: 18, y: 0 },
};

function makeRegionCloud(id: string): CloudAnnotationRecord {
  return makeLegacyCloud(id, {
    regionV1: membersRegion,
    presentationV1: regionPresentation,
    viewpointV1: viewpoint,
    labelLayoutV1: labelLayout,
  });
}

function wrapV7(cloudAnnotations: unknown[]): string {
  return JSON.stringify({
    version: 7,
    measurements: [],
    legacyMeasurements: [],
    annotations: [],
    obbAnnotations: [],
    cloudAnnotations,
    rectAnnotations: [],
  });
}

function wrapLegacyContainer(version: 3 | 4 | 5 | 6, cloudAnnotations: unknown[]): string {
  return JSON.stringify({
    version,
    measurements: [],
    annotations: [],
    obbAnnotations: [],
    cloudAnnotations,
    rectAnnotations: [],
    ...(version >= 5
      ? {
        xeokitDistanceMeasurements: [],
        xeokitAngleMeasurements: [],
        xeokitElevationPointMeasurements: [],
        xeokitElevationDeltaMeasurements: [],
      }
      : {}),
  });
}

function clearStorage() {
  if (typeof localStorage !== 'undefined') localStorage.clear();
  if (typeof sessionStorage !== 'undefined') sessionStorage.clear();
}

describe('useToolStore · 云线空间范围体字段的读取补齐', () => {
  beforeEach(clearStorage);
  afterEach(clearStorage);

  it.each([3, 4, 5, 6, 7] as const)('容器 V%i 的旧云线：selectionBbox → legacy-snapshot 范围体，呈现 legacy-v0，视点 / 标签为 null，旧字段不动', (version) => {
    const store = useToolStore();
    store.clearAll();
    const raw = version === 7 ? wrapV7([makeLegacyCloud('old')]) : wrapLegacyContainer(version, [makeLegacyCloud('old')]);
    store.importJSON(raw);

    const restored = store.cloudAnnotations.value.find((c) => c.id === 'old');
    expect(restored?.regionV1).toMatchObject({
      version: 1,
      origin: 'legacy-snapshot',
      kind: 'obb-union',
      source: { projectKey: null, modelSnapshotId: null, globalModelMatrix: null, coordinateFrameId: null },
    });
    expect(restored?.regionV1?.kind === 'obb-union' && restored.regionV1.boxes[0]).toMatchObject({
      center: [2, 1, 3],
      halfSize: [2, 1, 3],
    });
    expect(restored?.presentationV1).toMatchObject({ algorithm: 'legacy-v0', contour: 'screen-rect', paddingPx: 14, wavelengthPx: 52, amplitudePx: 4, phaseAnchor: null });
    expect(restored?.viewpointV1).toBeNull();
    expect(restored?.labelLayoutV1).toBeNull();
    // 旧字段一个不动
    expect(restored?.selectionBbox).toEqual({ min: [0, 0, 0], max: [4, 2, 6] });
    expect(restored?.screenOffset).toEqual({ x: 86, y: -54 });
    expect(restored?.cloudSize).toEqual({ width: 120, height: 72 });
    expect(restored?.anchorRefno).toBe('=24381/145018');
    expect(restored?.refnos).toEqual(['=24381/145019']);
  });

  it('没有 selectionBbox 的旧云线 regionV1 为 null，不凭像素框伪造范围', () => {
    const store = useToolStore();
    store.clearAll();
    const { selectionBbox: _dropped, ...pixelOnly } = makeLegacyCloud('pixel-only');
    store.importJSON(wrapV7([pixelOnly]));

    const restored = store.cloudAnnotations.value.find((c) => c.id === 'pixel-only');
    expect(restored?.regionV1).toBeNull();
    expect(restored?.presentationV1?.algorithm).toBe('legacy-v0');
  });

  it('显式 null 保留为 null（不重新从 selectionBbox 推导）；未知未来版本原样保留', () => {
    const store = useToolStore();
    store.clearAll();
    const future = { version: 9, kind: 'mesh', payload: [1, 2, 3] };
    store.importJSON(wrapV7([
      makeLegacyCloud('explicit-null', { regionV1: null, presentationV1: null, viewpointV1: null, labelLayoutV1: null }),
      { ...makeLegacyCloud('future'), regionV1: future },
    ]));

    const explicitNull = store.cloudAnnotations.value.find((c) => c.id === 'explicit-null');
    expect(explicitNull?.regionV1).toBeNull();
    expect(explicitNull?.presentationV1).toBeNull();
    expect(explicitNull?.viewpointV1).toBeNull();
    expect(explicitNull?.labelLayoutV1).toBeNull();

    expect(store.cloudAnnotations.value.find((c) => c.id === 'future')?.regionV1).toEqual(future);
  });

  it('addCloudAnnotation 写入时同样补齐；updateCloudAnnotation 局部 patch 不丢新字段', () => {
    const store = useToolStore();
    store.clearAll();
    store.addCloudAnnotation(makeLegacyCloud('added'));
    expect(store.cloudAnnotations.value.find((c) => c.id === 'added')?.regionV1?.origin).toBe('legacy-snapshot');

    store.addCloudAnnotation(makeRegionCloud('region'));
    store.updateCloudAnnotation('region', { title: 'renamed' });
    const updated = store.cloudAnnotations.value.find((c) => c.id === 'region');
    expect(updated?.title).toBe('renamed');
    expect(updated?.regionV1).toEqual(membersRegion);
    expect(updated?.presentationV1).toEqual(regionPresentation);
    expect(updated?.viewpointV1).toEqual(viewpoint);
    expect(updated?.labelLayoutV1).toEqual(labelLayout);
  });
});

describe('useToolStore · 云线空间范围体字段的无损往返', () => {
  beforeEach(clearStorage);
  afterEach(clearStorage);

  it('完整新版记录 export → import 四字段深相等，旧字段仍双写在场', () => {
    const store = useToolStore();
    store.clearAll();
    store.addCloudAnnotation(makeRegionCloud('rt'));

    const exported = store.exportJSON();
    store.clearAll();
    store.importJSON(exported);

    const restored = store.cloudAnnotations.value.find((c) => c.id === 'rt');
    expect(restored?.regionV1).toEqual(membersRegion);
    expect(restored?.presentationV1).toEqual(regionPresentation);
    expect(restored?.viewpointV1).toEqual(viewpoint);
    expect(restored?.labelLayoutV1).toEqual(labelLayout);
    expect(restored?.selectionBbox).toEqual({ min: [0, 0, 0], max: [4, 2, 6] });
    expect(restored?.screenOffset).toEqual({ x: 86, y: -54 });
    expect(restored?.cloudSize).toEqual({ width: 120, height: 72 });
  });

  it('幂等：import → export 再 import → export 字节相等（N(N(x)) = N(x)）', () => {
    const store = useToolStore();
    store.clearAll();
    store.importJSON(wrapLegacyContainer(6, [makeLegacyCloud('idem-old'), makeRegionCloud('idem-new')]));
    const first = store.exportJSON();

    store.clearAll();
    store.importJSON(first);
    const second = store.exportJSON();

    expect(second).toBe(first);
  });
});
