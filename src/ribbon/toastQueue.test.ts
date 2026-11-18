import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createToastQueueController,
  type ActiveToastState,
} from './toastQueue';

describe('createToastQueueController (#133)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps an active error toast on screen for the full 6000 ms while a subsequent info toast queues behind it', () => {
    const history: ActiveToastState[] = [];
    const ctrl = createToastQueueController({
      onChange(next) {
        history.push({ ...next });
      },
    });

    ctrl.push({ message: 'MBD 标注装载失败：17496_73858', level: 'error' });
    expect(ctrl.getState()).toMatchObject({
      open: true,
      level: 'error',
      message: 'MBD 标注装载失败：17496_73858',
      timeout: 6000,
    });

    // 100 ms 后模型装载发出普通 info，不得顶掉错误提示
    vi.advanceTimersByTime(100);
    ctrl.push({ message: '已装载 42 个构件', level: 'info' });
    expect(ctrl.getState().message).toBe('MBD 标注装载失败：17496_73858');
    expect(ctrl.getQueuedCount()).toBe(1);

    // 5999 ms 时错误提示仍在
    vi.advanceTimersByTime(5899);
    expect(ctrl.getState()).toMatchObject({
      open: true,
      message: 'MBD 标注装载失败：17496_73858',
    });

    // 满 6000 ms 后才切换到排队中的模型装载提示，并停满自己的 2200 ms
    vi.advanceTimersByTime(1);
    expect(ctrl.getState()).toMatchObject({
      open: true,
      level: 'info',
      message: '已装载 42 个构件',
      timeout: 2200,
    });

    vi.advanceTimersByTime(2199);
    expect(ctrl.getState().open).toBe(true);
    vi.advanceTimersByTime(1);
    expect(ctrl.getState().open).toBe(false);
    expect(history.length).toBeGreaterThanOrEqual(3);
  });

  it('keeps an active warning toast (4500 ms) from being clobbered by a subsequent success/info toast', () => {
    const ctrl = createToastQueueController({ onChange() {} });

    ctrl.push({ message: 'MBD 标注：24381_37090 没有可显示的标注', level: 'warning' });
    vi.advanceTimersByTime(80);
    ctrl.push({ message: '模型加载完成', level: 'success' });

    expect(ctrl.getState().message).toBe('MBD 标注：24381_37090 没有可显示的标注');
    vi.advanceTimersByTime(4419);
    expect(ctrl.getState().message).toBe('MBD 标注：24381_37090 没有可显示的标注');

    vi.advanceTimersByTime(1);
    expect(ctrl.getState()).toMatchObject({
      open: true,
      level: 'success',
      message: '模型加载完成',
    });
  });

  it('displays both warning and error sequentially for their full durations when emitted in the same tick', () => {
    const seen: string[] = [];
    const ctrl = createToastQueueController({
      onChange(next) {
        if (next.open) seen.push(`${next.level}:${next.message}`);
      },
    });

    // 空支管同拍发出 warning + error
    ctrl.push({ message: 'MBD 标注：24383_101287 没有可显示的标注，原因见尺寸面板', level: 'warning' });
    ctrl.push({ message: 'MBD 标注存在 1 条 error 诊断，详见尺寸面板', level: 'error' });

    expect(ctrl.getState().level).toBe('warning');
    vi.advanceTimersByTime(4499);
    expect(ctrl.getState().level).toBe('warning');

    vi.advanceTimersByTime(1);
    expect(ctrl.getState()).toMatchObject({
      open: true,
      level: 'error',
      message: 'MBD 标注存在 1 条 error 诊断，详见尺寸面板',
    });

    vi.advanceTimersByTime(5999);
    expect(ctrl.getState().open).toBe(true);
    vi.advanceTimersByTime(1);
    expect(ctrl.getState().open).toBe(false);
    expect(seen).toEqual([
      'warning:MBD 标注：24383_101287 没有可显示的标注，原因见尺寸面板',
      'error:MBD 标注存在 1 条 error 诊断，详见尺寸面板',
    ]);
  });

  it('preempts an active info toast immediately when an error arrives first-after-geometry and replays the info toast afterwards', () => {
    const ctrl = createToastQueueController({ onChange() {} });

    ctrl.push({ message: '已装载模型', level: 'info' });
    vi.advanceTimersByTime(50);
    ctrl.push({ message: 'MBD 标注装载失败：32573_1', level: 'error' });

    expect(ctrl.getState()).toMatchObject({
      open: true,
      level: 'error',
      message: 'MBD 标注装载失败：32573_1',
    });

    vi.advanceTimersByTime(6000);
    expect(ctrl.getState()).toMatchObject({
      open: true,
      level: 'info',
      message: '已装载模型',
    });
  });

  it('gives consecutive same-level toasts independent full timers instead of reusing leftover milliseconds', () => {
    const ctrl = createToastQueueController({ onChange() {} });

    // 两条 error 接连到来：各停满 6000 ms
    ctrl.push({ message: '错误 A', level: 'error' });
    vi.advanceTimersByTime(5000);
    ctrl.push({ message: '错误 B', level: 'error' });

    vi.advanceTimersByTime(1000);
    expect(ctrl.getState().message).toBe('错误 B');
    vi.advanceTimersByTime(5999);
    expect(ctrl.getState()).toMatchObject({ open: true, message: '错误 B' });
    vi.advanceTimersByTime(1);
    expect(ctrl.getState().open).toBe(false);

    // 两条普通 info 接连到来且无告警：立即更新且后一条重新计满 2200 ms
    ctrl.push({ message: '普通 1', level: 'info' });
    vi.advanceTimersByTime(2000);
    ctrl.push({ message: '普通 2', level: 'info' });
    expect(ctrl.getState().message).toBe('普通 2');
    vi.advanceTimersByTime(2199);
    expect(ctrl.getState().open).toBe(true);
    vi.advanceTimersByTime(1);
    expect(ctrl.getState().open).toBe(false);
  });
});
