/**
 * gen-model v1 管理面接口（「模型生成」面板用）：
 *
 * - `POST /api/v1/update/execute`（ADR-011 §12 / ADR-020）：库级「扫描 + 入队」，与服务端
 *   `setup.html` 第⑤步同一条管线——数据摄入 → 模型生成 → 发布 → 空间树 → 房间归属一次跑完。
 * - `POST /api/v1/query` 的 `e3d.element.identity`：节点名片（noun / name），给目标 chip 用。
 *
 * 单独成文件、只 import `genModelV1Api.ts` 的基座：与 `genModelV1RoomApi.ts` 同一约定，
 * 不往基座文件上加东西。
 */
import { fromV1Refno, genModelV1Fetch, toV1Refno, type GenModelV1RequestOptions } from '@/api/genModelV1Api';

/** `e3d.element.identity` 的 `result` 形状（query_service.rs::identity）。 */
export type ElementIdentity = {
  /** `a_b` */
  refno: string;
  noun: string;
  /** E3D NAME；无名构件是空串 */
  name: string;
};

type QueryResponse<T> = {
  tool: string;
  result: T;
};

type RawElementIdentity = {
  refno?: string;
  noun?: string;
  name?: string;
};

/** 点查一个节点的 noun / name。库里没有该 refno 时服务端回 `NOT_FOUND` 错误信封。 */
export async function genModelV1ElementIdentity(
  refno: string,
  options?: GenModelV1RequestOptions,
): Promise<ElementIdentity> {
  const resp = await genModelV1Fetch<QueryResponse<RawElementIdentity>>('/api/v1/query', {
    ...options,
    method: 'POST',
    body: { tool: 'e3d.element.identity', arguments: { refno: toV1Refno(refno) } },
  });
  const raw = resp?.result ?? {};
  return {
    refno: raw.refno ? fromV1Refno(raw.refno) : fromV1Refno(refno),
    noun: typeof raw.noun === 'string' ? raw.noun.trim() : '',
    name: typeof raw.name === 'string' ? raw.name.trim() : '',
  };
}

/** `update/execute` 回执 `enqueued` / `merged` 的一行（batch_scheduler.rs::EnqueuedBatchInfo）。 */
export type UpdateEnqueuedBatch = {
  task_id: string;
  dbnum: number;
  db_type?: string;
  phase?: string;
  epoch_id?: number;
  /** `apply_window` / `initialize` / `reinitialize` … */
  intent?: string;
  reinit_trigger?: string;
  model_start_sesno?: number | null;
  /** 队列位置（1 起） */
  position?: number;
  start_sesno?: number;
  end_sesno?: number;
};

export type UpdateBlockedDbnum = {
  dbnum: number;
  reason: string;
};

/**
 * `POST /api/v1/update/execute` 的 202 回执（batch_scheduler.rs::ManualEnqueueReceipt）。
 * 面板要读的就这几格：`enqueued`/`merged` 里的 `task_id` 拿去逐个 `tasks/{id}` 轮询
 * （d-195：不列表全量任务），`warnings` / `blocked` / `unselected` 原样透出。
 */
export type UpdateExecuteReceipt = {
  project?: string;
  mdb?: string;
  namespace?: string;
  /** 本次扫描到的候选 dbnum 数（含最新与被阻断的） */
  scanned?: number;
  /** 新排的行（含接在运行中批次之后的） */
  enqueued?: UpdateEnqueuedBatch[];
  /** 并入既有排队行的（目标会话号被推高） */
  merged?: UpdateEnqueuedBatch[];
  /** 已被既有排队行覆盖、无需动作的 dbnum */
  already_covered?: number[];
  /** 阻断的库（同号多文件 / 回退）——压根不入队 */
  blocked?: UpdateBlockedDbnum[];
  /** 水位已覆盖文件、无事可做的 dbnum 数 */
  up_to_date?: number;
  /** 带了 dbnums 子集而没勾选的库 */
  unselected?: number[];
  /** 服务端告警原文（典型：`dbnum=N: 在执行范围内，但本次扫描没有找到它的候选文件` = watch_dbnums 收窄） */
  warnings?: string[];
  /**
   * 读透 / kv-mem 形态（没有摄入批次可排）时回执改走另一套形状：`status` 例如
   * `model_refresh_queued`（模型刷新已排队，无 task_id）/ `up_to_date`。
   */
  status?: string;
  data_face?: string;
  applied_sesno_changed?: boolean;
  [key: string]: unknown;
};

/**
 * 库级初始化 / 增量更新：`{ dbnums: [...] }` 点名这些库走完整摄入管线。
 * 注意 `watch_dbnums` 只收窄监听扫描；被它挡在候选集外的库会原样出现在 `warnings` 里，
 * 由面板透传给用户（2026-10-15 实测：watch=[7998,8000] 时点名 7997 不入队）。
 */
export function genModelV1UpdateExecute(
  dbnums: number[],
  options?: GenModelV1RequestOptions,
): Promise<UpdateExecuteReceipt> {
  return genModelV1Fetch<UpdateExecuteReceipt>('/api/v1/update/execute', {
    ...options,
    method: 'POST',
    body: { dbnums },
  });
}
