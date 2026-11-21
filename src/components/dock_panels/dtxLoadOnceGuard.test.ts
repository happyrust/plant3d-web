import { describe, expect, it } from 'vitest';

import { createDtxLoadOnceGuard } from './dtxLoadOnceGuard';

describe('createDtxLoadOnceGuard（happyrust/gen-model#324）', () => {
  it('双库同屏（先装 8000、后装 7998）再重载较早的 8000 时，不得重新触发 auto-fit 或挪动全局矩阵', () => {
    const guard = createDtxLoadOnceGuard();

    // 1. 首次加载 8000：全局归一化与首次对焦各执行一次
    expect(guard.shouldApplyGlobalTransform(0.001, true)).toBe(true);
    guard.markGlobalTransformApplied(0.001, true);
    expect(guard.shouldAutoFit(8000, 0.001, true, 5)).toBe(true);
    guard.markAutoFitApplied(8000, 0.001, true);

    // 2. 追加加载 7998：共享全局矩阵保持首个模型原点不动；7998 首次可对焦
    expect(guard.shouldApplyGlobalTransform(0.001, true)).toBe(false);
    expect(guard.shouldAutoFit(7998, 0.001, true, 2)).toBe(true);
    guard.markAutoFitApplied(7998, 0.001, true);

    // 3. 关键回归点（#324）：回到 8000 重载时，8000 已在集合中，绝不再次拉回全景
    expect(guard.shouldAutoFit(8000, 0.001, true, 5)).toBe(false);
    expect(guard.shouldAutoFit(7998, 0.001, true, 2)).toBe(false);
    expect(guard.shouldApplyGlobalTransform(0.001, true)).toBe(false);
  });

  it('取最新或 flyTo=false 抑制期间，哪怕遇到新库号也不得触发 auto-fit，且支持嵌套计数', () => {
    const guard = createDtxLoadOnceGuard();

    guard.beginSuppressAutoFit();
    guard.beginSuppressAutoFit();
    expect(guard.isAutoFitSuppressed()).toBe(true);
    expect(guard.shouldAutoFit(8001, 0.001, true, 3)).toBe(false);

    guard.endSuppressAutoFit();
    expect(guard.isAutoFitSuppressed()).toBe(true);
    expect(guard.shouldAutoFit(8001, 0.001, true, 3)).toBe(false);

    guard.endSuppressAutoFit();
    expect(guard.isAutoFitSuppressed()).toBe(false);
    // 抑制结束且未标记过，后续正常手工加载新库仍可首次对焦
    expect(guard.shouldAutoFit(8001, 0.001, true, 3)).toBe(true);
  });

  it('空批回调（撤下/清空，loadedCount=0）永不触发 auto-fit', () => {
    const guard = createDtxLoadOnceGuard();
    expect(guard.shouldAutoFit(8000, 0.001, true, 0)).toBe(false);
  });

  it('单位或重心化设置变化时重新允许全局变换；reset() 后所有记录清空', () => {
    const guard = createDtxLoadOnceGuard();
    guard.markGlobalTransformApplied(0.001, true);
    guard.markAutoFitApplied(8000, 0.001, true);

    expect(guard.shouldApplyGlobalTransform(1, true)).toBe(true);
    expect(guard.shouldApplyGlobalTransform(0.001, false)).toBe(true);

    guard.reset();
    expect(guard.shouldApplyGlobalTransform(0.001, true)).toBe(true);
    expect(guard.shouldAutoFit(8000, 0.001, true, 1)).toBe(true);
  });
});
