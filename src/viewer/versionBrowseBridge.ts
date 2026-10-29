import type { ModelUnitCompareBrowseApi, ModelUnitCompareController } from '@/viewer/modelUnitCompareController';

/**
 * 面板 ↔ 三维的浏览接口桥（spec `model-version-timeline-scrub` design §5，tasks.md 15.4）。
 *
 * 浏览的三维实现在 `modelUnitCompareController`，它由 `ViewerPanel` 持有；而时间轴与
 * `useVersionFrames` 在 `ModelUnitVersionComparePanel` 里。两边只经 window 事件说话，
 * 所以这里加一条「把接口交出去」的通道：
 *
 * - 面板挂载时发 `attach`，带上一个 `respond` 回调；
 * - ViewerPanel 收到后把 controller 的浏览接口塞回去；
 * - 面板拿到的是一层**稳定**的转发对象，三维还没就位时调用它不会炸（浏览模式下才真的用得上）。
 */

export const MODEL_VERSION_BROWSE_EVENT = 'plant3d:model-version-browse';

/** 面板要用到的三维接口：浏览那半边 + 对比模式的 `open` */
export type VersionBrowseApi = ModelUnitCompareBrowseApi & Pick<ModelUnitCompareController, 'open'>;

export type VersionBrowseAttachDetail = {
  action: 'attach';
  respond: (api: VersionBrowseApi | null) => void;
};

export type VersionBrowseRespondDetail = {
  action: 'respond';
  api: VersionBrowseApi;
};

export type VersionBrowseEventDetail = VersionBrowseAttachDetail | VersionBrowseRespondDetail;

/** 面板侧：发一次 attach，返回拿到的接口（三维不在时等下一次 respond） */
export function requestVersionBrowseApi(): Promise<VersionBrowseApi | null> {
  return new Promise((resolve) => {
    const detail: VersionBrowseAttachDetail = { action: 'attach', respond: resolve };
    window.dispatchEvent(new CustomEvent(MODEL_VERSION_BROWSE_EVENT, { detail }));
  });
}

/**
 * 面板侧：一层转发对象。`useVersionFrames` 在 setup 里就要拿到 controller，
 * 那时三维可能还没回话，所以所有方法都写成「取当前接口再转」。
 */
export function createLazyBrowseApi(resolve: () => VersionBrowseApi | null): VersionBrowseApi {
  return {
    browseEnter: (ctx) => { resolve()?.browseEnter(ctx); },
    browseShow: async (frame, opts) => { await resolve()?.browseShow(frame, opts); },
    browsePending: (sesno) => { resolve()?.browsePending(sesno); },
    browseMissing: (sesno, reason) => { resolve()?.browseMissing(sesno, reason); },
    browseBadge: (text) => { resolve()?.browseBadge(text); },
    replaceSide: async (side, detailSide) => { await resolve()?.replaceSide(side, detailSide); },
    browseExit: () => { resolve()?.browseExit(); },
    open: async (detail, options) => { await resolve()?.open(detail, options); },
  };
}

/** ViewerPanel 侧：把 controller 的浏览接口交出去 */
export function respondVersionBrowseApi(api: VersionBrowseApi): void {
  window.dispatchEvent(new CustomEvent(MODEL_VERSION_BROWSE_EVENT, { detail: { action: 'respond', api } }));
}

export function isVersionBrowseAttach(detail: unknown): detail is VersionBrowseAttachDetail {
  return typeof detail === 'object' && detail !== null
    && (detail as { action?: unknown }).action === 'attach'
    && typeof (detail as { respond?: unknown }).respond === 'function';
}

export function isVersionBrowseRespond(detail: unknown): detail is VersionBrowseRespondDetail {
  return typeof detail === 'object' && detail !== null
    && (detail as { action?: unknown }).action === 'respond'
    && typeof (detail as { api?: unknown }).api === 'object';
}
