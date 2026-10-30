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

/**
 * 面板侧：要接口。
 *
 * 两种挂载顺序都要能接上，所以这里既发 `attach` 也听 `respond`：
 * - 视口先挂载：`ViewerPanel` 手里已有接口，`attach` 当场回话；
 * - 面板先挂载（直达链接 `unit_refno` + `compare_autorun=1` 就是这个顺序）：`attach`
 *   发出去时还没人听，之后 `ViewerPanel` 挂载会主动广播一次 `respond`，这里接住。
 *
 * 早先只发 `attach` 等回调，面板先挂载时拿到的永远是 `null`，`browseEnter` / `browseShow`
 * 全部空转——浏览模式看着进去了，视口一帧都不装。
 */
export function requestVersionBrowseApi(): Promise<VersionBrowseApi | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (api: VersionBrowseApi | null) => {
      if (settled) return;
      settled = true;
      window.removeEventListener(MODEL_VERSION_BROWSE_EVENT, onRespond);
      resolve(api);
    };
    function onRespond(event: Event): void {
      const detail = (event as CustomEvent<VersionBrowseEventDetail>).detail;
      if (isVersionBrowseRespond(detail)) finish(detail.api);
    }
    window.addEventListener(MODEL_VERSION_BROWSE_EVENT, onRespond);
    const detail: VersionBrowseAttachDetail = { action: 'attach', respond: finish };
    window.dispatchEvent(new CustomEvent(MODEL_VERSION_BROWSE_EVENT, { detail }));
  });
}

/**
 * 面板侧：接口到手后再接一次。视口在面板之后才挂载时，`ViewerPanel` 会广播 `respond`，
 * 这里把它接住；已经拿到过接口的话 `apply` 只被调一次。
 */
export function watchVersionBrowseApi(apply: (api: VersionBrowseApi) => void): () => void {
  const onRespond = (event: Event): void => {
    const detail = (event as CustomEvent<VersionBrowseEventDetail>).detail;
    if (isVersionBrowseRespond(detail)) apply(detail.api);
  };
  window.addEventListener(MODEL_VERSION_BROWSE_EVENT, onRespond);
  return () => window.removeEventListener(MODEL_VERSION_BROWSE_EVENT, onRespond);
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
