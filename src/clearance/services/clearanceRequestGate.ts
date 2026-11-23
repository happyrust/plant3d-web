import type { SpatialClearanceModelVersion } from '@/api/genModelV1Api';

/**
 * 净距请求防竞态（#65）：同一个键（如「BRAN 净距查询」「某条候选的精算」）同时只留最新一次——新请求进来时
 * 用 `AbortController` 掐掉上一次，迟到的旧响应一律判 `superseded` 丢弃。
 *
 * 另一道闸按模型版本：同一 scope、同一库号下已接受过会话号 N 的结果后，再来 < N 的响应（旧模型的迟到结果，
 * 比如「取最新」刚切过会话）不许覆盖新结果。
 */
export type ClearanceGateOutcome<T> =
  | Readonly<{ status: 'fresh'; value: T }>
  | Readonly<{ status: 'superseded' }>;

export type ClearanceRequestGate = Readonly<{
  run<T>(key: string, task: (signal: AbortSignal) => Promise<T>): Promise<ClearanceGateOutcome<T>>;
  /** 掐掉一个键（不给就是全部）的在途请求；之后到达的响应都判 `superseded`。 */
  cancel(key?: string): void;
  /** `false` = 这一版比同 scope 同库已接受的旧，调用方应丢弃。`null` 版本（服务端答不出）不拦。 */
  acceptModelVersion(scope: string, version: SpatialClearanceModelVersion | null | undefined): boolean;
  /** 忘掉某个 scope 已接受的版本（比如用户显式切到历史版本再回来）。 */
  resetModelVersions(scope?: string): void;
}>;

function supersededReason(): Error {
  const error = new Error('superseded by a newer clearance request');
  error.name = 'AbortError';
  return error;
}

export function createClearanceRequestGate(): ClearanceRequestGate {
  const inflight = new Map<string, AbortController>();
  const generations = new Map<string, number>();
  const acceptedSesno = new Map<string, number>();

  function bump(key: string): number {
    const next = (generations.get(key) ?? 0) + 1;
    generations.set(key, next);
    return next;
  }

  async function run<T>(key: string, task: (signal: AbortSignal) => Promise<T>): Promise<ClearanceGateOutcome<T>> {
    inflight.get(key)?.abort(supersededReason());
    const controller = new AbortController();
    const generation = bump(key);
    inflight.set(key, controller);
    const current = () => generations.get(key) === generation && !controller.signal.aborted;
    try {
      const value = await task(controller.signal);
      return current() ? Object.freeze({ status: 'fresh', value }) : Object.freeze({ status: 'superseded' });
    } catch (error) {
      if (!current()) return Object.freeze({ status: 'superseded' });
      throw error;
    } finally {
      if (inflight.get(key) === controller) inflight.delete(key);
    }
  }

  function cancel(key?: string): void {
    const keys = key === undefined ? [...inflight.keys()] : [key];
    for (const item of keys) {
      inflight.get(item)?.abort(supersededReason());
      inflight.delete(item);
      bump(item);
    }
  }

  function acceptModelVersion(scope: string, version: SpatialClearanceModelVersion | null | undefined): boolean {
    if (!version) return true;
    const slot = `${scope}|${version.dbnum}`;
    const previous = acceptedSesno.get(slot);
    if (previous !== undefined && version.sesno < previous) return false;
    acceptedSesno.set(slot, version.sesno);
    return true;
  }

  function resetModelVersions(scope?: string): void {
    if (scope === undefined) {
      acceptedSesno.clear();
      return;
    }
    for (const slot of [...acceptedSesno.keys()]) {
      if (slot.startsWith(`${scope}|`)) acceptedSesno.delete(slot);
    }
  }

  return Object.freeze({ run, cancel, acceptModelVersion, resetModelVersions });
}
