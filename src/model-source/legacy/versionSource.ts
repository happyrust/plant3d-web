/**
 * `legacy` 的模型版本取数：零逻辑委托（ADR 0065，plan 2026-09-18 §2 / §5 A1）。
 *
 * 三个方法逐句对应 2026-09-18 之前散在 `ModelUnitVersionComparePanel.snapshotsFor` 与
 * `ViewerPanel.refreshModelUnitCompareEnvironment` 里的调用——参数不动、顺序不动、不加缓存、不吞错误，
 * 这样 `model_source=legacy` 下的行为与从前逐字节相同；legacy 退役时删掉这个文件就完。
 */
import type {
  ModelVersion,
  ModelVersionEnvironmentPin,
  ModelVersionGeometry,
  ModelVersionSource,
} from '../ports';

import { listModelUnitCommits, type ModelUnitCommitData } from '@/api/modelUnitVersionApi';
import { fetchLatestDbnoManifest, useDbnoInstancesParquetLoader } from '@/composables/useDbnoInstancesParquetLoader';

/** `ModelVersion.handle` 在 legacy 下的形状：不可变模型提交的 manifest URL（tombstone 为 null）。 */
type LegacyVersionHandle = {
  manifestUrl: string | null;
};

function toModelVersion(unitRefno: string, data: ModelUnitCommitData): ModelVersion {
  const commit = data.commit;
  const handle: LegacyVersionHandle = { manifestUrl: data.manifest_url };
  return {
    dbnum: commit.dbnum,
    unitRefno,
    unitNoun: commit.unit_noun,
    sesno: commit.sesno,
    sessionTime: commit.generated_at ?? null,
    impactKind: commit.impact_kind,
    assetSesno: commit.artifact_sesno,
    geometryKey: `${commit.dbnum}:${unitRefno}:${commit.artifact_sesno}`,
    handle,
  };
}

function manifestUrlOf(version: ModelVersion): string | null {
  const handle = version.handle as LegacyVersionHandle | undefined;
  return typeof handle?.manifestUrl === 'string' ? handle.manifestUrl : null;
}

async function releaseNothing(): Promise<void> {
  // legacy 的版本几何是不可变 parquet，没有服务端资源要还
}

export const legacyModelVersionSource: ModelVersionSource = {
  async listVersions(dbnum, unitRefno): Promise<ModelVersion[]> {
    const commits = await listModelUnitCommits(dbnum, unitRefno);
    return commits.map((data) => toModelVersion(unitRefno, data));
  },

  /** 与从前 `snapshotsFor` 逐句相同：先按 manifest 取子树 refno，再按同一 manifest 取实例。 */
  async loadVersion(version): Promise<ModelVersionGeometry> {
    const manifestUrl = manifestUrlOf(version);
    if (manifestUrl === null) return { refnos: [], entries: new Map(), release: releaseNothing };
    const parquet = useDbnoInstancesParquetLoader();
    const refnos = await parquet.queryAllRefnosByDbno(version.dbnum, {
      manifestUrl,
      expectedRootRefno: version.unitRefno,
    });
    const entries = await parquet.queryInstanceEntriesByRefnos(version.dbnum, refnos, {
      manifestUrl,
      expectedRootRefno: version.unitRefno,
      includeOwnedTubings: false,
    });
    return { refnos, entries, release: releaseNothing };
  },

  /** 与从前 `refreshModelUnitCompareEnvironment` 逐句相同：最新 manifest 连同已解析的清单一起钉住。 */
  async pinLatestEnvironment(dbnum): Promise<ModelVersionEnvironmentPin> {
    const latest = await fetchLatestDbnoManifest(dbnum);
    return {
      generatedAt: latest.generatedAt,
      loaderOptions: {
        dataSource: 'parquet',
        parquetManifestUrl: latest.manifestUrl,
        parquetManifest: latest.manifest,
      },
    };
  },
};
