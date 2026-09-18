import { beforeEach, describe, expect, it, vi } from 'vitest';

import { legacyModelVersionSource } from './versionSource';

import { listModelUnitCommits } from '@/api/modelUnitVersionApi';
import { fetchLatestDbnoManifest, useDbnoInstancesParquetLoader } from '@/composables/useDbnoInstancesParquetLoader';

vi.mock('@/api/modelUnitVersionApi', () => ({ listModelUnitCommits: vi.fn() }));
vi.mock('@/composables/useDbnoInstancesParquetLoader', () => ({
  useDbnoInstancesParquetLoader: vi.fn(),
  fetchLatestDbnoManifest: vi.fn(),
}));

const commits = [
  {
    manifest_url: '/791/manifest.json',
    commit: { dbnum: 7997, unit_refno: '24381_145018', unit_noun: 'BRAN', sesno: 791, impact_kind: 'mesh', artifact_sesno: 791, generated_at: '2026-07-22T01:00:00Z' },
  },
  {
    manifest_url: '/791/manifest.json',
    commit: { dbnum: 7997, unit_refno: '24381_145018', unit_noun: 'BRAN', sesno: 800, impact_kind: 'noop', artifact_sesno: 791, generated_at: '2026-07-22T02:00:00Z' },
  },
  {
    manifest_url: null,
    commit: { dbnum: 7997, unit_refno: '24381_145018', unit_noun: 'BRAN', sesno: 897, impact_kind: 'tombstone', artifact_sesno: 897, generated_at: '2026-07-22T03:00:00Z' },
  },
];

describe('legacyModelVersionSource（零逻辑委托）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listModelUnitCommits).mockResolvedValue(commits as never);
  });

  it('listVersions 把模型提交映成 ModelVersion：artifact_sesno → assetSesno / geometryKey，manifest 进私有句柄', async () => {
    const versions = await legacyModelVersionSource.listVersions(7997, '24381_145018');

    expect(listModelUnitCommits).toHaveBeenCalledWith(7997, '24381_145018');
    expect(versions.map((v) => v.sesno)).toEqual([791, 800, 897]);
    expect(versions[0]).toMatchObject({
      dbnum: 7997,
      unitRefno: '24381_145018',
      unitNoun: 'BRAN',
      sessionTime: '2026-07-22T01:00:00Z',
      impactKind: 'mesh',
      assetSesno: 791,
      geometryKey: '7997:24381_145018:791',
    });
    // 无几何变化提交复用 791 的资产 → 与 791 同一几何键
    expect(versions[1]?.geometryKey).toBe(versions[0]?.geometryKey);
    expect(versions[1]?.assetSesno).toBe(791);
    expect(versions[2]?.geometryKey).toBe('7997:24381_145018:897');
  });

  it('loadVersion 与从前 snapshotsFor 逐句相同：先按 manifest 取子树 refno，再按同一 manifest 取实例', async () => {
    const queryAllRefnosByDbno = vi.fn().mockResolvedValue(['1_1', '1_2']);
    const entries = new Map([['1_1', [{ geo_hash: 'a' }]], ['1_2', [{ geo_hash: 'b' }]]]);
    const queryInstanceEntriesByRefnos = vi.fn().mockResolvedValue(entries);
    vi.mocked(useDbnoInstancesParquetLoader).mockReturnValue({ queryAllRefnosByDbno, queryInstanceEntriesByRefnos } as never);

    const [version] = await legacyModelVersionSource.listVersions(7997, '24381_145018');
    const geometry = await legacyModelVersionSource.loadVersion(version!);

    expect(queryAllRefnosByDbno).toHaveBeenCalledWith(7997, {
      manifestUrl: '/791/manifest.json',
      expectedRootRefno: '24381_145018',
    });
    expect(queryInstanceEntriesByRefnos).toHaveBeenCalledWith(7997, ['1_1', '1_2'], {
      manifestUrl: '/791/manifest.json',
      expectedRootRefno: '24381_145018',
      includeOwnedTubings: false,
    });
    expect(geometry.refnos).toEqual(['1_1', '1_2']);
    expect(geometry.entries).toBe(entries);
    await expect(geometry.release()).resolves.toBeUndefined();
  });

  it('tombstone 版本回空几何，不碰 parquet', async () => {
    const queryAllRefnosByDbno = vi.fn();
    vi.mocked(useDbnoInstancesParquetLoader).mockReturnValue({ queryAllRefnosByDbno } as never);

    const versions = await legacyModelVersionSource.listVersions(7997, '24381_145018');
    const geometry = await legacyModelVersionSource.loadVersion(versions[2]!);

    expect(geometry.refnos).toEqual([]);
    expect(geometry.entries.size).toBe(0);
    expect(queryAllRefnosByDbno).not.toHaveBeenCalled();
  });

  it('pinLatestEnvironment 把最新 manifest 连同已解析清单钉进加载器选项', async () => {
    const manifest = { version: 1, format: 'parquet', generated_at: '2026-09-18T00:00:00Z', dbnum: 7997, tables: {} };
    vi.mocked(fetchLatestDbnoManifest).mockResolvedValue({
      manifestUrl: '/latest/manifest.json',
      generatedAt: '2026-09-18T00:00:00Z',
      manifest,
    } as never);

    const pin = await legacyModelVersionSource.pinLatestEnvironment(7997);

    expect(fetchLatestDbnoManifest).toHaveBeenCalledWith(7997);
    expect(pin).toEqual({
      generatedAt: '2026-09-18T00:00:00Z',
      loaderOptions: { dataSource: 'parquet', parquetManifestUrl: '/latest/manifest.json', parquetManifest: manifest },
    });
  });
});
