/**
 * useContainerQuery · 基于容器宽度的响应式断点 hook
 *
 * - 使用 ResizeObserver 监听目标容器尺寸变化
 * - 返回当前断点 `mode` 和精确宽度 `width` 两个响应式 ref
 * - 首帧同步计算一次（不必等 observer 第一次触发）
 * - 组件卸载时自动断开 observer
 *
 * 为什么不用 CSS @container：
 *   · 兼容性（Safari 旧版）
 *   · Vue template 里需要 mode 判断驱动 v-if / v-else 分支
 *   · 单测中易于 mock
 */

import { onBeforeUnmount, ref, watchEffect, type Ref } from 'vue';

export type ContainerQueryBreakpoint = 'compact' | 'medium' | 'wide';

export type ContainerQueryOptions = {
  /** 严格小于此值为 compact · 默认 640 */
  compactMax?: number;
  /** 严格小于此值但 ≥ compactMax 为 medium · 默认 960 */
  mediumMax?: number;
  /** 首屏 / SSR / 测试环境下的默认断点 · 默认 wide */
  initialMode?: ContainerQueryBreakpoint;
};

export type UseContainerQueryReturn = {
  mode: Ref<ContainerQueryBreakpoint>;
  width: Ref<number>;
};

function resolveMode(
  width: number,
  compactMax: number,
  mediumMax: number,
): ContainerQueryBreakpoint {
  if (width < compactMax) return 'compact';
  if (width < mediumMax) return 'medium';
  return 'wide';
}

export function useContainerQuery(
  target: Ref<HTMLElement | null>,
  options: ContainerQueryOptions = {},
): UseContainerQueryReturn {
  const compactMax = options.compactMax ?? 640;
  const mediumMax = options.mediumMax ?? 960;

  const mode = ref<ContainerQueryBreakpoint>(options.initialMode ?? 'wide');
  const width = ref<number>(0);

  let observer: ResizeObserver | null = null;

  function sync(w: number) {
    width.value = w;
    mode.value = resolveMode(w, compactMax, mediumMax);
  }

  watchEffect((onCleanup) => {
    const el = target.value;
    if (!el) return;

    /**
     * 立刻计算一次 · 避免首帧出现 wide default 抖动
     * 注意 happy-dom 里 clientWidth 可能为 0，此时 mode 退回 initialMode
     */
    const initialWidth = el.clientWidth;
    if (initialWidth > 0) {
      sync(initialWidth);
    }

    if (typeof ResizeObserver === 'undefined') return;

    observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      sync(entry.contentRect.width);
    });
    observer.observe(el);

    onCleanup(() => {
      observer?.disconnect();
      observer = null;
    });
  });

  onBeforeUnmount(() => {
    observer?.disconnect();
    observer = null;
  });

  return { mode, width };
}
