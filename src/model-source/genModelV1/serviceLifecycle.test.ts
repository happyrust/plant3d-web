import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  __resetGenModelV1ServiceLifecycleForTests,
  createGenModelV1GenerationGuard,
  GenModelV1ServiceGenerationChangedError,
  getGenModelV1ServiceSnapshot,
  observeGenModelV1Failure,
  observeGenModelV1Health,
  subscribeGenModelV1GenerationChange,
  toGenModelV1CancelledError,
} from './serviceLifecycle';

import { GenModelV1ApiError } from '@/api/genModelV1Api';

describe('gen-model 服务代次', () => {
  beforeEach(() => {
    __resetGenModelV1ServiceLifecycleForTests();
  });

  it('以 normalized base + started_at 识别重启，并中止旧 generation 的在飞请求', () => {
    expect(observeGenModelV1Health({ status: 'ok', started_at: '2026-09-11T01:00:00Z' }, 'http://gm:8022/')).toBeNull();
    expect(getGenModelV1ServiceSnapshot()).toMatchObject({
      generation: 0,
      baseUrl: 'http://gm:8022',
      startedAt: '2026-09-11T01:00:00Z',
      token: 'http://gm:8022|2026-09-11T01:00:00Z',
    });

    const listener = vi.fn();
    const unsubscribe = subscribeGenModelV1GenerationChange(listener);
    const guard = createGenModelV1GenerationGuard();
    expect(observeGenModelV1Health({ status: 'ok', started_at: '2026-09-11T01:00:00Z' }, 'http://gm:8022')).toBeNull();
    guard.assertCurrent();

    const change = observeGenModelV1Health(
      { status: 'ok', started_at: '2026-09-11T02:00:00Z' },
      'http://gm:8022',
    );
    expect(change).toMatchObject({ generation: 1, reason: 'started_at_changed' });
    expect(listener).toHaveBeenCalledOnce();
    expect(guard.signal.aborted).toBe(true);
    expect(() => guard.assertCurrent()).toThrow(/服务实例已变化/);
    guard.dispose();
    unsubscribe();
  });

  it('现代服务短暂断线后仍是同一 started_at 不失效；legacy 断线后恢复则保守失效', () => {
    observeGenModelV1Health({ status: 'ok', started_at: 'same' }, '/gm');
    observeGenModelV1Failure('/gm');
    observeGenModelV1Health({ status: 'ok', started_at: 'same' }, '/gm');
    expect(getGenModelV1ServiceSnapshot().generation).toBe(0);

    __resetGenModelV1ServiceLifecycleForTests();
    observeGenModelV1Health({ status: 'ok' }, '/gm');
    observeGenModelV1Failure('/gm');
    const change = observeGenModelV1Health({ status: 'ok' }, '/gm/');
    expect(change).toMatchObject({ generation: 1, reason: 'legacy_reconnected' });
  });

  it('base URL 变化即使两边都没有 started_at 也失效', () => {
    observeGenModelV1Health({ status: 'ok' }, '/gm-a');
    const change = observeGenModelV1Health({ status: 'ok' }, '/gm-b');
    expect(change).toMatchObject({ generation: 1, reason: 'base_url_changed' });
  });

  it('guard 对调用方取消统一分型为 cancelled + abortSource=caller（不论 abort 的 reason 是什么），服务换代仍是独立错误类型', () => {
    const controller = new AbortController();
    const guard = createGenModelV1GenerationGuard(controller.signal);
    guard.assertCurrent();
    controller.abort(new Error('stop'));
    let thrown: unknown;
    try { guard.assertCurrent(); } catch (error) { thrown = error; }
    expect(thrown).toBeInstanceOf(GenModelV1ApiError);
    expect(thrown).toMatchObject({ code: 'cancelled', abortSource: 'caller' });
    expect((thrown as GenModelV1ApiError).cause).toMatchObject({ message: 'stop' });
    guard.dispose();

    // 已经 aborted 的 signal：guard 一建出来就是取消态
    const aborted = createGenModelV1GenerationGuard(controller.signal);
    expect(() => aborted.assertCurrent()).toThrow(GenModelV1ApiError);
    aborted.dispose();

    // 已分型的取消 / 服务换代原样保留
    const cancelled = new GenModelV1ApiError({ code: 'cancelled', status: 0, path: '/x', message: 'c', abortSource: 'caller' });
    expect(toGenModelV1CancelledError(cancelled)).toBe(cancelled);
    observeGenModelV1Health({ status: 'ok', started_at: 'a' }, '/gm');
    const stale = createGenModelV1GenerationGuard();
    observeGenModelV1Health({ status: 'ok', started_at: 'b' }, '/gm');
    expect(() => stale.assertCurrent()).toThrow(GenModelV1ServiceGenerationChangedError);
    expect(toGenModelV1CancelledError(stale.signal.reason)).toBeInstanceOf(GenModelV1ServiceGenerationChangedError);
    stale.dispose();
  });
});
