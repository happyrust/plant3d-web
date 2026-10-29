/**
 * 版本对比取数（`ModelVersionSource`）的领域错误。运行时代码，所以不在只放类型的 `ports.ts` 里。
 */

/**
 * 参考号不是最小交付单元根。哪些类型算最小交付单元以后端项目配置为唯一口径（CONTEXT「最小交付单元」，Q6）：
 * gen-model-v1 适配器从 422 `NOT_A_DELIVERY_UNIT_ROOT` 的 `detail` 翻译出来；前端不再持类型清单。
 */
export class NotDeliveryUnitRootError extends Error {
  readonly unitRefno: string;
  readonly noun: string;
  readonly deliveryUnitTypes: readonly string[];

  constructor(unitRefno: string, noun: string, deliveryUnitTypes: readonly string[]) {
    const types = deliveryUnitTypes.length > 0 ? deliveryUnitTypes.join(' / ') : '未知';
    super(`参考号 ${unitRefno} 不是最小交付单元根：${noun || 'UNKNOWN'}（项目配置的类型集：${types}）`);
    this.name = 'NotDeliveryUnitRootError';
    this.unitRefno = unitRefno;
    this.noun = noun;
    this.deliveryUnitTypes = [...deliveryUnitTypes];
  }
}

/**
 * 服务端是旧构建、没有这条路由（axum 无信封的 404）。节点版本视图（ADR 0066）的四条新路由
 * `element/attribute-history` / `element/attribute-diff` / `node/versions` / `node/diff-summary` 都可能撞上它：
 * 面板据此回落到现有路由能给的那一半，并照实说「要新版服务端」，而不是把它当成「没有变化」。
 */
export class ModelVersionRouteUnavailableError extends Error {
  readonly route: string;

  constructor(route: string) {
    super(`服务端还没有 ${route}：这一块要带该路由的新版服务端`);
    this.name = 'ModelVersionRouteUnavailableError';
    this.route = route;
  }
}
/**
 * 历史查询类路由（`model/history/geometry`、`node/resolve-time`、`element/attributes-at`）的业务 / 传输错误
 * （spec `model-version-timeline-scrub` design §3）。路由缺失不走它，走 `ModelVersionRouteUnavailableError`。
 *
 * - `code`：服务端 `error.code`（`UNIT_NOT_PRESENT` / `HISTORY_BUSY` / `HISTORY_QUERY_TIMEOUT` / `SESSION_NOT_FOUND` …）
 *   或前端自定的 `NETWORK`（fetch 失败，不降级）/ `CLIENT_TIMEOUT`（前端超时）；
 * - `status`：HTTP 状态；`NETWORK` / `CLIENT_TIMEOUT` 没有响应，为 null；
 * - `reason`：`UNIT_NOT_PRESENT` 时单元「还没建」还是「已删除」；
 * - `retryAfterMs`：`HISTORY_BUSY` 的 `Retry-After`（毫秒，未钳位；钳位由 `retryAfterMs()` 负责）。
 */
export type HistoryQueryErrorCode =
  | 'UNIT_NOT_PRESENT'
  | 'HISTORY_BUSY'
  | 'HISTORY_QUERY_TIMEOUT'
  | 'SESSION_NOT_FOUND'
  | 'REFNO_NOT_IN_CHAIN'
  | 'NETWORK'
  | 'CLIENT_TIMEOUT'
  | (string & {});

export type HistoryQueryErrorInit = {
  status?: number | null;
  reason?: 'not-yet' | 'deleted';
  retryAfterMs?: number;
  message?: string;
};

export class HistoryQueryError extends Error {
  readonly code: HistoryQueryErrorCode;
  readonly status: number | null;
  readonly reason?: 'not-yet' | 'deleted';
  readonly retryAfterMs?: number;
  constructor(code: HistoryQueryErrorCode, init: HistoryQueryErrorInit = {}) {
    super(init.message ?? `历史查询失败：${code}${init.status != null ? `（HTTP ${init.status}）` : ''}`);
    this.name = 'HistoryQueryError';
    this.code = code;
    this.status = init.status ?? null;
    if (init.reason !== undefined) this.reason = init.reason;
    if (init.retryAfterMs !== undefined) this.retryAfterMs = init.retryAfterMs;
  }
}
