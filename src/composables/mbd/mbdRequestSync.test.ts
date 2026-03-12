import { describe, expect, it, vi } from 'vitest';

import {
  ExternalAnnotationRegistry,
  createLatestOnlyGate,
  shouldClearMbdRequest,
  type MbdPipeAnnotationRequestLike,
} from './mbdRequestSync';

describe('createLatestOnlyGate', () => {
  it('仅最新请求被视为有效', () => {
    const gate = createLatestOnlyGate();
    const first = gate.issue();
    const second = gate.issue();

    expect(gate.isLatest(first)).toBe(false);
    expect(gate.isLatest(second)).toBe(true);
  });
});

describe('shouldClearMbdRequest', () => {
  const req = (refno: string, timestamp: number): MbdPipeAnnotationRequestLike => ({ refno, timestamp });

  it('当前请求与已处理请求一致时返回 true', () => {
    expect(shouldClearMbdRequest(req('1_2', 100), req('1_2', 100))).toBe(true);
  });

  it('当前请求被后续请求覆盖时返回 false', () => {
    expect(shouldClearMbdRequest(req('1_2', 101), req('1_2', 100))).toBe(false);
    expect(shouldClearMbdRequest(req('1_2', 100), req('9_9', 100))).toBe(false);
    expect(shouldClearMbdRequest(null, req('1_2', 100))).toBe(false);
  });
});

describe('ExternalAnnotationRegistry', () => {
  it('sync 会反注册旧 id 并注册新增 id', () => {
    const registry = new ExternalAnnotationRegistry();
    const register = vi.fn();
    const unregister = vi.fn();

    registry.sync(['a', 'b'], register, unregister);
    expect(register).toHaveBeenCalledTimes(2);
    expect(unregister).not.toHaveBeenCalled();
    expect(registry.values()).toEqual(new Set(['a', 'b']));

    registry.sync(['b', 'c'], register, unregister);
    expect(register).toHaveBeenCalledTimes(3);
    expect(unregister).toHaveBeenCalledTimes(1);
    expect(unregister).toHaveBeenCalledWith('a');
    expect(registry.values()).toEqual(new Set(['b', 'c']));
  });

  it('clear 会反注册所有已登记 id', () => {
    const registry = new ExternalAnnotationRegistry();
    const register = vi.fn();
    const unregister = vi.fn();

    registry.sync(['x', 'y'], register, unregister);
    registry.clear(unregister);

    expect(unregister).toHaveBeenCalledTimes(2);
    expect(registry.values()).toEqual(new Set());
  });
});
