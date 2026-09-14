import { describe, expect, it } from 'vitest';

import {
  CLOUD_PRESENTATION_DEFAULTS,
  createLegacyCloudPresentationV1,
  deriveLegacySnapshotRegion,
  fillCloudRegionFieldDefaults,
  isValidSelectionBbox,
  type CloudRegionFields,
  type RegionV1,
} from './cloudRegion';

describe('deriveLegacySnapshotRegion', () => {
  it('合法 selectionBbox → legacy-snapshot 单位轴 OBB，来源身份全 null', () => {
    const region = deriveLegacySnapshotRegion({ min: [0, -2, 10], max: [4, 2, 16] });

    expect(region).toEqual({
      version: 1,
      space: 'world',
      source: { projectKey: null, modelSnapshotId: null, globalModelMatrix: null, coordinateFrameId: null },
      origin: 'legacy-snapshot',
      kind: 'obb-union',
      boxes: [{
        id: 'legacy-snapshot:0',
        memberRefno: null,
        center: [2, 0, 13],
        axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
        halfSize: [2, 2, 3],
      }],
    });
  });

  it('零厚度盒合法（平面 / 点目标），min > max、非有限数、缺字段都不合法', () => {
    expect(isValidSelectionBbox({ min: [0, 0, 0], max: [0, 0, 0] })).toBe(true);
    expect(isValidSelectionBbox({ min: [1, 0, 0], max: [0, 0, 0] })).toBe(false);
    expect(isValidSelectionBbox({ min: [0, 0, Number.NaN], max: [1, 1, 1] })).toBe(false);
    expect(isValidSelectionBbox({ min: [0, 0], max: [1, 1, 1] })).toBe(false);
    expect(isValidSelectionBbox({ min: [0, 0, 0] })).toBe(false);
    expect(isValidSelectionBbox(undefined)).toBe(false);
    expect(isValidSelectionBbox(null)).toBe(false);

    expect(deriveLegacySnapshotRegion(undefined)).toBeNull();
    expect(deriveLegacySnapshotRegion({ min: [1, 0, 0], max: [0, 0, 0] })).toBeNull();
  });
});

describe('fillCloudRegionFieldDefaults', () => {
  const legacyRecord = {
    id: 'c-legacy',
    title: 'old',
    selectionBbox: { min: [0, 0, 0], max: [2, 2, 2] },
    futureUnknownField: { keep: 'me' },
  };

  it('旧记录：四个字段全部补齐，presentation 为 legacy-v0，未知字段原样保留', () => {
    const filled = fillCloudRegionFieldDefaults(legacyRecord);

    expect(filled.regionV1?.origin).toBe('legacy-snapshot');
    expect(filled.presentationV1).toEqual(createLegacyCloudPresentationV1());
    expect(filled.presentationV1).toMatchObject({ algorithm: 'legacy-v0', phaseAnchor: null, ...CLOUD_PRESENTATION_DEFAULTS });
    expect(filled.viewpointV1).toBeNull();
    expect(filled.labelLayoutV1).toBeNull();
    expect(filled.futureUnknownField).toEqual({ keep: 'me' });
  });

  it('没有合法 selectionBbox 的旧记录 regionV1 为 null——只有像素框不能无证据升级', () => {
    const { selectionBbox: _dropped, ...withoutBbox } = legacyRecord;
    expect(fillCloudRegionFieldDefaults(withoutBbox).regionV1).toBeNull();
  });

  it('不改输入对象', () => {
    const input = { ...legacyRecord };
    const before = JSON.stringify(input);
    fillCloudRegionFieldDefaults(input);
    expect(JSON.stringify(input)).toBe(before);
    expect(Object.prototype.hasOwnProperty.call(input, 'regionV1')).toBe(false);
  });

  it('幂等：fill(fill(x)) 与 fill(x) 深相等', () => {
    const once = fillCloudRegionFieldDefaults(legacyRecord);
    const twice = fillCloudRegionFieldDefaults(once);
    expect(twice).toEqual(once);
  });

  it('显式 null 是真实状态，不重新推导；已有字段原样保留', () => {
    const membersRegion: RegionV1 = {
      version: 1,
      space: 'world',
      source: { projectKey: null, modelSnapshotId: '7997:parquet:2026-09-14T00:00:00Z', globalModelMatrix: null, coordinateFrameId: '7997:0.001:0' },
      origin: 'members',
      kind: 'obb-union',
      boxes: [{ id: 'o:24381_145018:0', memberRefno: '=24381/145018', center: [1, 1, 1], axes: [[0, 1, 0], [-1, 0, 0], [0, 0, 1]], halfSize: [3, 1, 1] }],
    };
    const explicit: CloudRegionFields & { selectionBbox: unknown } = {
      selectionBbox: { min: [0, 0, 0], max: [2, 2, 2] },
      regionV1: null,
      presentationV1: null,
      viewpointV1: null,
      labelLayoutV1: null,
    };

    expect(fillCloudRegionFieldDefaults(explicit)).toEqual(explicit);

    const withRegion = { ...explicit, regionV1: membersRegion };
    expect(fillCloudRegionFieldDefaults(withRegion).regionV1).toBe(membersRegion);
  });

  it('未知未来版本的扩展原样保留（校验与渲染解释分开，不在读取漏斗里裁）', () => {
    const future = { regionV1: { version: 2, kind: 'mesh', payload: [1, 2, 3] } } as unknown as CloudRegionFields;
    expect(fillCloudRegionFieldDefaults(future).regionV1).toBe(future.regionV1);
  });
});
