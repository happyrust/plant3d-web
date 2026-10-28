import { describe, expect, it, vi } from 'vitest';

import {
  __resetCameraIntentForTests,
  beginCameraIntent,
  currentCameraIntent,
  isCameraIntentCurrent,
  supersedeCameraIntents,
} from './cameraIntent';

describe('cameraIntent', () => {
  it('beginCameraIntent 作废更早的意图', () => {
    __resetCameraIntentForTests();
    const first = beginCameraIntent();
    expect(isCameraIntentCurrent(first)).toBe(true);

    const second = beginCameraIntent();
    expect(isCameraIntentCurrent(first)).toBe(false);
    expect(isCameraIntentCurrent(second)).toBe(true);
  });

  it('supersedeCameraIntents 让在途意图全部失效，且自己不留下「当前」', () => {
    __resetCameraIntentForTests();
    const stamp = beginCameraIntent();
    supersedeCameraIntents();
    expect(isCameraIntentCurrent(stamp)).toBe(false);
    // 撤销之后任何更早的戳都不算当前；新登记的才重新开始
    const fresh = beginCameraIntent();
    expect(isCameraIntentCurrent(fresh)).toBe(true);
  });

  it('currentCameraIntent 不推进序号', () => {
    __resetCameraIntentForTests();
    const stamp = beginCameraIntent();
    const before = currentCameraIntent();
    expect(currentCameraIntent()).toBe(before);
    expect(isCameraIntentCurrent(stamp)).toBe(true);
  });

  it('并发两次取景只有后者有效（模拟晚落地抢相机）', async () => {
    __resetCameraIntentForTests();
    const slow = beginCameraIntent();
    // 慢路径还在等加载；用户这时点了别处
    const fast = beginCameraIntent();

    // 慢路径落地：不该动相机
    expect(isCameraIntentCurrent(slow)).toBe(false);
    // 快路径落地：该动
    expect(isCameraIntentCurrent(fast)).toBe(true);
  });
});

describe('cameraIntent 与 flyTo 的组合约束', () => {
  it('beginCameraIntent 返回严格递增的序号', () => {
    __resetCameraIntentForTests();
    const a = beginCameraIntent();
    const b = beginCameraIntent();
    const c = beginCameraIntent();
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
  });

  it('复位只影响测试', () => {
    __resetCameraIntentForTests();
    expect(currentCameraIntent()).toBe(0);
    beginCameraIntent();
    expect(currentCameraIntent()).toBe(1);
    __resetCameraIntentForTests();
    expect(currentCameraIntent()).toBe(0);
    vi.restoreAllMocks();
  });
});
