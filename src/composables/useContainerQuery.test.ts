import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick, ref } from 'vue';

import { useContainerQuery } from './useContainerQuery';

type Observer = {
  callback: ResizeObserverCallback;
  elements: Element[];
};

let activeObservers: Observer[] = [];

function fireObservers(target: Element, width: number) {
  for (const o of activeObservers) {
    if (!o.elements.includes(target)) continue;
    o.callback(
      [{
        target,
        contentRect: { width, height: 100, x: 0, y: 0, top: 0, left: 0, right: width, bottom: 100, toJSON() { return {}; } },
        borderBoxSize: [],
        contentBoxSize: [],
        devicePixelContentBoxSize: [],
      } as unknown as ResizeObserverEntry],
      {} as ResizeObserver,
    );
  }
}

class MockResizeObserver {
  private record: Observer;

  constructor(callback: ResizeObserverCallback) {
    this.record = { callback, elements: [] };
    activeObservers.push(this.record);
  }

  observe(el: Element): void {
    this.record.elements.push(el);
    // 模拟真实 ResizeObserver：observe 后同步触发一次
    const width = (el as HTMLElement).clientWidth;
    if (width > 0) {
      fireObservers(el, width);
    }
  }

  disconnect(): void {
    this.record.elements = [];
    activeObservers = activeObservers.filter((o) => o !== this.record);
  }

  unobserve(el: Element): void {
    this.record.elements = this.record.elements.filter((x) => x !== el);
  }

  /** 测试辅助：手动触发一次 callback，模拟尺寸变化 */
  static fire(target: Element, width: number) {
    fireObservers(target, width);
  }
}

function mountProbe(options?: Parameters<typeof useContainerQuery>[1]) {
  const host = document.createElement('div');
  document.body.appendChild(host);

  const captured = {
    mode: ref<'compact' | 'medium' | 'wide'>('wide'),
    width: ref(0),
    targetEl: null as HTMLElement | null,
  };

  const Probe = defineComponent({
    setup() {
      const target = ref<HTMLElement | null>(null);
      const q = useContainerQuery(target, options);
      captured.mode = q.mode;
      captured.width = q.width;
      return () => h('div', {
        ref: (el: Element | null) => {
          target.value = el as HTMLElement | null;
          captured.targetEl = el as HTMLElement | null;
        },
      });
    },
  });

  const app = createApp(Probe);
  app.mount(host);

  return {
    captured,
    host,
    unmount: () => {
      app.unmount();
      host.remove();
    },
  };
}

describe('useContainerQuery', () => {
  beforeEach(() => {
    activeObservers = [];
    vi.stubGlobal('ResizeObserver', MockResizeObserver);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('1. 初始化 mode 默认为 wide（RO 未触发时）', async () => {
    const probe = mountProbe();
    await nextTick();
    await nextTick();

    expect(probe.captured.mode.value).toBe('wide');
    expect(probe.captured.width.value).toBe(0);

    probe.unmount();
  });

  it('2. 断点自动切换：1200 wide → 800 medium → 400 compact', async () => {
    const probe = mountProbe();
    await nextTick();

    MockResizeObserver.fire(probe.captured.targetEl!, 1200);
    await nextTick();
    expect(probe.captured.mode.value).toBe('wide');
    expect(probe.captured.width.value).toBe(1200);

    MockResizeObserver.fire(probe.captured.targetEl!, 800);
    await nextTick();
    expect(probe.captured.mode.value).toBe('medium');
    expect(probe.captured.width.value).toBe(800);

    MockResizeObserver.fire(probe.captured.targetEl!, 400);
    await nextTick();
    expect(probe.captured.mode.value).toBe('compact');
    expect(probe.captured.width.value).toBe(400);

    probe.unmount();
  });

  it('3. 自定义 compactMax / mediumMax 生效', async () => {
    const probe = mountProbe({ compactMax: 400, mediumMax: 700 });
    await nextTick();

    MockResizeObserver.fire(probe.captured.targetEl!, 900);
    await nextTick();
    expect(probe.captured.mode.value).toBe('wide');

    MockResizeObserver.fire(probe.captured.targetEl!, 500);
    await nextTick();
    expect(probe.captured.mode.value).toBe('medium');

    MockResizeObserver.fire(probe.captured.targetEl!, 300);
    await nextTick();
    expect(probe.captured.mode.value).toBe('compact');

    probe.unmount();
  });

  it('4. initialMode 选项影响首帧默认断点', async () => {
    const probe = mountProbe({ initialMode: 'compact' });
    await nextTick();
    await nextTick();
    // RO 未触发时，mode 保持 initial
    expect(probe.captured.mode.value).toBe('compact');
    expect(probe.captured.width.value).toBe(0);

    probe.unmount();
  });

  it('5. 组件卸载后 disconnect ResizeObserver · 不抛错', async () => {
    const probe = mountProbe();
    await nextTick();
    MockResizeObserver.fire(probe.captured.targetEl!, 1200);
    await nextTick();
    const el = probe.captured.targetEl!;

    probe.unmount();

    // 卸载后 observer 应该全部断开
    expect(activeObservers).toHaveLength(0);
    // 再次 fire 也不会抛（因为没有 active observer 接收了）
    expect(() => MockResizeObserver.fire(el, 300)).not.toThrow();
  });
});
