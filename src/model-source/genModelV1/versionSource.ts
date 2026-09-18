/**
 * `gen-model-v1` 的模型版本取数（ADR 0065 / gen-model-refactor ADR-081；plan 2026-09-18 §2 / §3 / §5 A3）。
 *
 * - `listVersions`：`GET /api/v1/model/versions`，`truncated` 时按最后一条的 `sesno` 作 `since_sesno` 连续拉到全表
 *   （Q17；上限 `MAX_PAGES` 页），端口永远给全表，UI 不感知截断。422 `NOT_A_DELIVERY_UNIT_ROOT` 翻成
 *   `NotDeliveryUnitRootError`（noun 与项目类型集来自 `detail`）。
 * - `loadVersion`：`POST model/history/generate` → 轮询 `tasks/{id}` 到 `succeeded`（`result.snapshot_key`）→
 *   `history/query tool=instances` + `tool=tubes` → 与生产 `model/records` 同一条映射（`projection_record_to_query`
 *   的 TS 对偶 + `groupInstanceEntriesByRefno`）→ `InstanceEntry[]`。`tombstone` 版本不打后端、回空集。
 *   `release()` = `DELETE model/history/{snapshot_key}`。
 * - `pinLatestEnvironment`：环境 = 视口里已加载的模型，重钉不带 pin（加载器按页面级开关走 records + forceRefresh，Q12）。
 *
 * 历史投影不落库、重启即丢、单次 ≤ 100 000 元素 / 300 s：这里每次 `loadVersion` 都重新 generate，不依赖上一次的快照还在。
 */
import { groupInstanceEntriesByRefno } from './instanceMapping';

import type {
  ModelVersion,
  ModelVersionEnvironmentPin,
  ModelVersionGeometry,
  ModelVersionLoadOptions,
  ModelVersionSource,
} from '../ports';

import {
  fromV1Refno,
  genModelV1ModelHistoryDelete,
  genModelV1ModelHistoryGenerate,
  genModelV1ModelHistoryQuery,
  genModelV1ModelVersions,
  genModelV1TaskGet,
  isGenModelV1ApiError,
  type GenModelV1RequestOptions,
  type GeomInstQuery,
  type HistoryInstanceRowDto,
  type HistoryTubeRowDto,
  type ModelVersionsResponse,
  type TaskEntryDto,
  type V1Transform,
} from '@/api/genModelV1Api';
import { NotDeliveryUnitRootError } from '@/model-source/modelVersionErrors';

/** `since_sesno` 连续拉的页数上限（服务端每页缺省 500）；再多说明链有问题，不无限拉。 */
export const MAX_PAGES = 20;
/** 轮询 `tasks/{id}` 的间隔与总预算（服务端历史投影预算是 300 s）。 */
export const HISTORY_POLL_INTERVAL_MS = 500;
export const HISTORY_TIMEOUT_MS = 300_000;

const IDENTITY: V1Transform = { translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] };

/** 便于测试注入的后端面；缺省全走 `genModelV1Api`。 */
export type GenModelV1VersionApi = {
  listVersions: typeof genModelV1ModelVersions;
  historyGenerate: typeof genModelV1ModelHistoryGenerate;
  taskGet: typeof genModelV1TaskGet;
  historyQuery: typeof genModelV1ModelHistoryQuery;
  historyDelete: typeof genModelV1ModelHistoryDelete;
  /** 测试里换成立即 resolve */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  now?: () => number;
};

const defaultApi: GenModelV1VersionApi = {
  listVersions: genModelV1ModelVersions,
  historyGenerate: genModelV1ModelHistoryGenerate,
  taskGet: genModelV1TaskGet,
  historyQuery: genModelV1ModelHistoryQuery,
  historyDelete: genModelV1ModelHistoryDelete,
};

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason instanceof Error ? signal.reason : new Error('cancelled'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(signal?.reason instanceof Error ? signal.reason : new Error('cancelled'));
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function releaseNothing(): Promise<void> {
  // 「已删除单元版本」没有打后端，也就没有快照要还
}

function readTypes(detail: unknown): string[] {
  const types = (detail as { delivery_unit_types?: unknown } | null | undefined)?.delivery_unit_types;
  return Array.isArray(types) ? types.map((item) => String(item)) : [];
}

function readNoun(detail: unknown): string {
  const noun = (detail as { noun?: unknown } | null | undefined)?.noun;
  return typeof noun === 'string' ? noun : '';
}

export function toModelVersion(
  response: Pick<ModelVersionsResponse, 'dbnum' | 'unit_noun'>,
  unitRefno: string,
  row: ModelVersionsResponse['versions'][number],
): ModelVersion {
  return {
    dbnum: response.dbnum,
    unitRefno,
    unitNoun: response.unit_noun,
    sesno: row.sesno,
    sessionTime: row.session_time ?? null,
    impactKind: row.impact_kind,
  };
}

/** `history/query` 的两种行 → 生产 `model/records` 的 `GeomInstQuery`（`projection_record_to_query` 的对偶）。 */
export function historyRowsToGeomInstQueries(
  unitRefno: string,
  instances: HistoryInstanceRowDto[],
  tubes: HistoryTubeRowDto[],
): GeomInstQuery[] {
  const owner = fromV1Refno(unitRefno);
  const items: GeomInstQuery[] = [];
  for (const row of instances) {
    const meshId = String(row.mesh_id ?? '').trim();
    if (!meshId) continue;
    const baked = row.booled === true;
    items.push({
      refno: fromV1Refno(String(row.source_refno ?? '')),
      old_refno: null,
      owner,
      world_aabb: row.world_bounds ?? null,
      world_trans: row.world_transform ?? IDENTITY,
      insts: [{
        geo_hash: meshId,
        transform: baked ? IDENTITY : row.local_transform ?? IDENTITY,
        is_tubi: false,
        is_invalid_tubi: false,
      }],
      has_neg: baked,
      generic: String(row.generic ?? ''),
      pts: null,
      date: null,
    });
  }
  for (const row of tubes) {
    const meshId = String(row.mesh_id ?? '').trim();
    if (!meshId) continue;
    items.push({
      refno: fromV1Refno(String(row.container_refno ?? row.source_refno ?? '')),
      old_refno: null,
      owner,
      world_aabb: row.world_bounds ?? null,
      world_trans: row.world_transform ?? IDENTITY,
      insts: [{
        geo_hash: meshId,
        transform: IDENTITY,
        is_tubi: true,
        is_invalid_tubi: row.invalid === true,
      }],
      has_neg: false,
      generic: 'TUBI',
      pts: null,
      date: null,
    });
  }
  return items;
}

function snapshotKeyOf(task: TaskEntryDto): string | null {
  const key = task.result?.snapshot_key;
  return typeof key === 'string' && key ? key : null;
}

function taskFailureMessage(task: TaskEntryDto): string {
  const result = task.result ?? {};
  const code = typeof result.code === 'string' ? result.code : task.state;
  const message = typeof result.message === 'string' ? result.message : '';
  return message ? `${code}: ${message}` : code;
}

export function createGenModelV1ModelVersionSource(api: GenModelV1VersionApi = defaultApi): ModelVersionSource {
  const wait = api.sleep ?? sleep;
  const now = api.now ?? (() => Date.now());

  async function listVersions(dbnum: number, unitRefno: string): Promise<ModelVersion[]> {
    const normalized = fromV1Refno(unitRefno);
    const versions: ModelVersion[] = [];
    let sinceSesno: number | undefined;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      let response: ModelVersionsResponse;
      try {
        response = await api.listVersions({ dbnum, refno: normalized, sinceSesno });
      } catch (error) {
        if (isGenModelV1ApiError(error) && error.code === 'NOT_A_DELIVERY_UNIT_ROOT') {
          throw new NotDeliveryUnitRootError(normalized, readNoun(error.detail), readTypes(error.detail));
        }
        throw error;
      }
      for (const row of response.versions ?? []) versions.push(toModelVersion(response, normalized, row));
      if (!response.truncated) return versions;
      const last = response.versions?.at(-1)?.sesno;
      if (last === undefined) return versions;
      sinceSesno = last;
    }
    throw new Error(`模型版本表超过 ${MAX_PAGES} 页仍未取完（dbnum ${dbnum} 单元 ${normalized}），放弃`);
  }

  async function waitForSnapshot(taskId: string, options: GenModelV1RequestOptions): Promise<string> {
    const deadline = now() + HISTORY_TIMEOUT_MS;
    for (;;) {
      const task = await api.taskGet(taskId, options);
      const state = String(task.state ?? '').toLowerCase();
      if (state === 'succeeded') {
        const key = snapshotKeyOf(task);
        if (!key) throw new Error(`历史投影任务 ${taskId} 成功但没有 snapshot_key`);
        return key;
      }
      if (state === 'failed' || state === 'partial') {
        throw new Error(`历史投影任务 ${taskId} 失败：${taskFailureMessage(task)}`);
      }
      if (now() >= deadline) {
        throw new Error(`历史投影任务 ${taskId} 超过 ${HISTORY_TIMEOUT_MS / 1000} s 仍未完成`);
      }
      await wait(HISTORY_POLL_INTERVAL_MS, options.signal);
    }
  }

  async function loadVersion(version: ModelVersion, options: ModelVersionLoadOptions = {}): Promise<ModelVersionGeometry> {
    if (version.impactKind === 'tombstone') {
      return { refnos: [], entries: new Map(), release: releaseNothing };
    }
    const requestOptions: GenModelV1RequestOptions = { signal: options.signal };
    const { task_id: taskId } = await api.historyGenerate(
      { dbnum: version.dbnum, refno: version.unitRefno, sesno: version.sesno },
      requestOptions,
    );
    const snapshotKey = await waitForSnapshot(taskId, requestOptions);
    const [instances, tubes] = await Promise.all([
      api.historyQuery<HistoryInstanceRowDto[]>(snapshotKey, 'instances', requestOptions),
      api.historyQuery<HistoryTubeRowDto[]>(snapshotKey, 'tubes', requestOptions),
    ]);
    const items = historyRowsToGeomInstQueries(
      version.unitRefno,
      Array.isArray(instances) ? instances : [],
      Array.isArray(tubes) ? tubes : [],
    );
    const entries = groupInstanceEntriesByRefno(items);
    let released = false;
    return {
      refnos: [...entries.keys()],
      entries,
      async release() {
        if (released) return;
        released = true;
        await api.historyDelete(snapshotKey);
      },
    };
  }

  async function pinLatestEnvironment(): Promise<ModelVersionEnvironmentPin> {
    return { generatedAt: null, loaderOptions: {} };
  }

  return { listVersions, loadVersion, pinLatestEnvironment };
}
