import { GenModelV1ApiError, type HealthResponse } from '@/api/genModelV1Api';

export type GenModelV1GenerationChangeReason =
  | 'base_url_changed'
  | 'started_at_changed'
  | 'started_at_established'
  | 'started_at_unavailable'
  | 'legacy_reconnected';

export type GenModelV1GenerationChange = {
  generation: number;
  reason: GenModelV1GenerationChangeReason;
  previousToken: string | null;
  token: string | null;
  baseUrl: string;
  startedAt: string | null;
};

export type GenModelV1ServiceSnapshot = {
  generation: number;
  baseUrl: string | null;
  startedAt: string | null;
  token: string | null;
  hasSuccessfulObservation: boolean;
  failureSinceSuccess: boolean;
};

export class GenModelV1ServiceGenerationChangedError extends Error {
  readonly before: number;
  readonly after: number;
  readonly reason: GenModelV1GenerationChangeReason;

  constructor(before: number, event: GenModelV1GenerationChange) {
    super(`gen-model 服务实例已变化（${event.reason}，generation ${before} → ${event.generation}）`);
    this.name = 'GenModelV1ServiceGenerationChangedError';
    this.before = before;
    this.after = event.generation;
    this.reason = event.reason;
  }
}

export type GenModelV1GenerationGuard = {
  readonly generation: number;
  readonly signal: AbortSignal;
  /**
   * 这次逻辑读取还作数吗：服务换代 → `GenModelV1ServiceGenerationChangedError`；调用方取消 →
   * `GenModelV1ApiError { code: 'cancelled', abortSource: 'caller' }`（不论 `abort()` 时给的 reason 是什么）。
   * 成功收口前**和**出错收口时都该调它一次——后者让取消 / 换代盖过途中随便哪个请求先抛出来的错。
   */
  assertCurrent(): void;
  dispose(): void;
};

/**
 * 把调用方 `abort(reason)` 的 reason 统一成 `cancelled + abortSource=caller` 的 `GenModelV1ApiError`：
 * 一次读取从哪一步退出来（fetch 里、缓存命中前、收口检查时），分型都一样。服务换代错误与已分型的取消原样保留。
 */
export function toGenModelV1CancelledError(reason: unknown): Error {
  if (reason instanceof GenModelV1ServiceGenerationChangedError) return reason;
  if (reason instanceof GenModelV1ApiError && reason.isCancelled) return reason;
  const detail = reason instanceof Error && reason.message ? `: ${reason.message}` : '';
  return new GenModelV1ApiError({
    code: 'cancelled',
    status: 0,
    path: '(generation-guard)',
    message: `gen-model 读取已被调用方取消${detail}`,
    cause: reason,
    abortSource: 'caller',
  });
}

let generation = 0;
let observedBaseUrl: string | null = null;
let observedStartedAt: string | null = null;
let hasSuccessfulObservation = false;
let failureSinceSuccess = false;
let lastChange: GenModelV1GenerationChange | null = null;

const listeners = new Set<(event: GenModelV1GenerationChange) => void>();
const activeGuards = new Set<AbortController>();

export function normalizeGenModelV1ServiceBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function tokenOf(baseUrl: string, startedAt: string | null): string | null {
  return startedAt ? `${baseUrl}|${startedAt}` : null;
}

function notifyGenerationChange(reason: GenModelV1GenerationChangeReason, baseUrl: string, startedAt: string | null): void {
  const previousToken = tokenOf(observedBaseUrl ?? baseUrl, observedStartedAt);
  generation += 1;
  const event: GenModelV1GenerationChange = {
    generation,
    reason,
    previousToken,
    token: tokenOf(baseUrl, startedAt),
    baseUrl,
    startedAt,
  };
  lastChange = event;

  for (const controller of activeGuards) {
    controller.abort(new GenModelV1ServiceGenerationChangedError(generation - 1, event));
  }
  activeGuards.clear();
  for (const listener of listeners) {
    try {
      listener(event);
    } catch (error) {
      console.error('[gen-model-v1] 服务代次失效监听器执行失败', error);
    }
  }
}

/**
 * Observe one successful `/health`. A modern server is identified by
 * `normalize(base URL) + started_at`; a legacy server without `started_at`
 * invalidates only after a failed-then-successful reconnect.
 */
export function observeGenModelV1Health(health: HealthResponse, baseUrl: string): GenModelV1GenerationChange | null {
  const normalizedBase = normalizeGenModelV1ServiceBaseUrl(baseUrl);
  const startedAt = nonEmptyString(health.started_at);
  let reason: GenModelV1GenerationChangeReason | null = null;

  if (hasSuccessfulObservation) {
    if (observedBaseUrl !== normalizedBase) reason = 'base_url_changed';
    else if (observedStartedAt && startedAt && observedStartedAt !== startedAt) reason = 'started_at_changed';
    else if (!observedStartedAt && startedAt) reason = 'started_at_established';
    else if (observedStartedAt && !startedAt) reason = 'started_at_unavailable';
    else if (!startedAt && failureSinceSuccess) reason = 'legacy_reconnected';
  }

  if (reason) notifyGenerationChange(reason, normalizedBase, startedAt);
  observedBaseUrl = normalizedBase;
  observedStartedAt = startedAt;
  hasSuccessfulObservation = true;
  failureSinceSuccess = false;
  return reason ? lastChange : null;
}

export function observeGenModelV1Failure(baseUrl: string): void {
  const normalizedBase = normalizeGenModelV1ServiceBaseUrl(baseUrl);
  if (!hasSuccessfulObservation || observedBaseUrl === normalizedBase) {
    failureSinceSuccess = true;
  }
}

export function getGenModelV1ServiceSnapshot(): GenModelV1ServiceSnapshot {
  return {
    generation,
    baseUrl: observedBaseUrl,
    startedAt: observedStartedAt,
    token: tokenOf(observedBaseUrl ?? '', observedStartedAt),
    hasSuccessfulObservation,
    failureSinceSuccess,
  };
}

export function getGenModelV1ServiceGeneration(): number {
  return generation;
}

export function assertGenModelV1ServiceGeneration(captured: number): void {
  if (generation === captured) return;
  const event = lastChange ?? {
    generation,
    reason: 'started_at_changed' as const,
    previousToken: null,
    token: null,
    baseUrl: observedBaseUrl ?? '',
    startedAt: observedStartedAt,
  };
  throw new GenModelV1ServiceGenerationChangedError(captured, event);
}

export function subscribeGenModelV1GenerationChange(
  listener: (event: GenModelV1GenerationChange) => void,
): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Abortable fence for one logical read. Generation changes abort transport and reject late responses. */
export function createGenModelV1GenerationGuard(outerSignal?: AbortSignal): GenModelV1GenerationGuard {
  const captured = generation;
  const controller = new AbortController();
  let disposed = false;
  const onOuterAbort = () => controller.abort(outerSignal?.reason);
  if (outerSignal?.aborted) onOuterAbort();
  else outerSignal?.addEventListener('abort', onOuterAbort, { once: true });
  activeGuards.add(controller);

  return {
    generation: captured,
    signal: controller.signal,
    assertCurrent(): void {
      assertGenModelV1ServiceGeneration(captured);
      if (controller.signal.aborted) throw toGenModelV1CancelledError(controller.signal.reason);
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      activeGuards.delete(controller);
      outerSignal?.removeEventListener('abort', onOuterAbort);
    },
  };
}

export function __resetGenModelV1ServiceLifecycleForTests(): void {
  for (const controller of activeGuards) controller.abort(new Error('test reset'));
  activeGuards.clear();
  generation = 0;
  observedBaseUrl = null;
  observedStartedAt = null;
  hasSuccessfulObservation = false;
  failureSinceSuccess = false;
  lastChange = null;
}
