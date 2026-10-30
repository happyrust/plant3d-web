import { computed, ref, watch, type ComputedRef, type Ref, type WatchStopHandle } from 'vue';

import { Box3, Color, Raycaster, Vector2, Vector3 } from 'three';

import type { SelectedVersionPin } from '@/composables/useSelectionStore';
import type { DTXLayer, DTXSelectionController, PickViewport } from '@/utils/three/dtx';
import type { DtxViewer } from '@/viewer/dtx/DtxViewer';

import { modelVersionAttributesToUiAttr } from '@/model-source';
import {
  applyModelUnitRefnoVisibility,
  applyModelUnitVersionSide,
  collectModelUnitTargetObjectIds,
  countModelUnitGeometryStatuses,
  DEFAULT_MODEL_UNIT_COMPARE_SIDE,
  DEFAULT_MODEL_UNIT_COMPARE_VIEW_MODE,
  getModelUnitCompareRenderPasses,
  locateModelUnitComparePass,
  MODEL_UNIT_GEOMETRY_STATUS_COLORS,
  MODEL_UNIT_VERSION_COMPARE_STATE_EVENT,
  modelUnitCompareUnitRefnos,
  planModelUnitCompareObjectStyles,
  refnoFromCompareObjectId,
  sideFromCompareObjectId,
  type ModelUnitCompareHiddenObjectIds,
  type ModelUnitCompareRenderPass,
  type ModelUnitCompareSide,
  type ModelUnitCompareSplitOutline,
  type ModelUnitCompareViewMode,
  type ModelUnitGeometryDiff,
  type ModelUnitGeometryStatus,
  type ModelUnitVersionCompareEnvironment,
  type ModelUnitVersionCompareEventDetail,
  type ModelUnitVersionCompareOpenDetail,
  type ModelUnitVersionCompareRuntimeState,
  type ModelUnitVersionSide,
} from '@/utils/modelUnitVersionCompare';
import { readWebGLRendererInfo } from '@/utils/three/webglRendererInfo';

/**
 * 三维版本对比的视口侧控制器（ADR 0065 / 0066「三维联动」；版本对比审核计划 P2-2 从 `ViewerPanel.vue` 抽出）：
 * `open`（两侧隔离图层装几何、按四态着色、藏环境里的目标单元、相机对框）/ `clear`（还显隐、还相机、放图层）/ 单视口切 A-B /
 * 「三维只看差异」/ 分屏（每帧 `renderSplitScene` 的 scissor pass、指针落在哪一格 `splitRay`）/ 隔离图层 CPU 拾取 `pickObject` 与
 * 「钉到那一版」`selectObject` / 定位 `focus` / 运行态发布 `publishState` / 面板事件 `handleEvent`。
 *
 * 不碰视口自己的东西：图层怎么建、怎么挂进场景、工具怎么收、相机怎么飞、几何从哪儿装、选中存哪儿，都经 `ModelUnitCompareHost` 回到
 * `ViewerPanel`——所以这个模块能在没有 WebGL 的单测里用假 host 跑完整条 open / clear / 切换路。两侧几何本身由面板经模型来源端口取好、
 * 随事件带来（ADR 0065 §2），这里只往隔离图层里装。
 */

/** 隔离图层里被点到的构件 */
export type ModelUnitComparePick = {
  objectId: string;
  refno: string;
  side: ModelUnitCompareSide;
  distance: number;
};

/** 分屏下按指针落的那一格造出来的射线 */
export type SplitCompareRay = {
  raycaster: Raycaster;
  side: ModelUnitCompareSide;
  pass: ModelUnitCompareRenderPass;
  /** 指针换到 renderer 尺寸下的画布坐标（左上原点） */
  pos: Vector2;
  /** 那一格在画布坐标（左上原点）里的矩形，给主图层的 GPU 拾取当子视口 */
  viewport: PickViewport;
};

/** `loadDbnoInstancesForVisibleRefnosDtx` 这里用到的那一截 */
export type ModelUnitCompareLoadInstances = (
  layer: DTXLayer,
  dbnum: number,
  refnos: string[],
  options: {
    forceReloadRefnos?: string[];
    replaceExistingObjects?: boolean;
    includeOwnedTubings?: boolean;
    isolated?: boolean;
    expectedRootRefno?: string;
    instanceEntriesByRefno?: ModelUnitVersionSide['entries'];
    objectIdPrefix?: string;
  },
) => Promise<{ loadedObjects: number }>;

/** 控制器要视口给的那些东西：都是 `ViewerPanel` 里现成的 ref / 函数 / store，按名字接上即可 */
export type ModelUnitCompareHost = {
  viewer(): DtxViewer | null;
  primaryLayer(): DTXLayer | null;
  /** 新建一个与主图层同全局矩阵的隔离图层（`createShowDbnumDtxLayer`，会登记进视口的额外图层表） */
  createLayer(viewer: DtxViewer, primary: DTXLayer): DTXLayer;
  /** 图层编译好后挂进场景（`ensureShowDbnumExtraLayerAttached`） */
  attachLayer(layer: DTXLayer, viewer: DtxViewer): void;
  /** 从视口的额外图层表 / 已挂记录里摘掉；`dispose` 由控制器做 */
  forgetLayer(layer: DTXLayer): void;
  loadInstances: ModelUnitCompareLoadInstances;
  resolve: {
    refnoByObjectId(dbnum: number, objectId: string): string | null;
    objectIdsByRefno(dbnum: number, refno: string): string[];
    objectIdsByUnitRefno(dbnum: number, unitRefno: string): string[];
  };
  /** 任意写法的 refno → 本仓内部键 `a_b`；解不出回 '' */
  normalizeRefno(raw: unknown): string;
  requestRender(): void;
  /** 错误级 toast */
  toast(message: string): void;
  /** 切到分屏之前收工具：测量菜单 / 尺寸系统 / 工具交互 / xeokit 测量 / 工具模式归 none / pivot / 归还 OrbitControls */
  beforeSplit(): void;
  /** 相机对到两侧几何的包围盒（`fitDtxViewerToBox` + 网格适配） */
  fitToBox(viewer: DtxViewer, box: Box3): void;
  /** 分屏每格画完后叠尺寸标注（`renderDimensionOverlay`） */
  renderOverlay(viewer: DtxViewer): void;
  /** 关闭对比的第一步：视口若还持有校审恢复的那份对比（`restoredReviewComparison`），在这里放掉 */
  onClear?(): void;
  selection: {
    clearSelection(): void;
    setSelectedRefno(refno: string): void;
    /** 选中一个当前会话里已不存在的构件（`rows` 里 `deleted` 的行 / 整单元被删时的单元根）：属性面板给提示、不拉当前会话 */
    setSelectedDeletedRefno(refno: string): void;
    setSelectedRefnoAtVersion(refno: string, pin: SelectedVersionPin): void;
    hasVersionPin(): boolean;
    selectedIsDeleted(): boolean;
    selectedRefno(): string | null;
  };
  /** dev 构建才往 `window.__modelUnitVersionCompare` 上挂 e2e 读的数字 */
  isDev: boolean;
};

export type ModelUnitCompareOpenOptions = {
  /** 装到一半时问一句还要不要（校审恢复：任务 / 项目换了就不要了） */
  shouldApply?: () => boolean;
  /** false = 不重取「最新环境」，只数已加载的 refno（校审恢复） */
  refreshEnvironment?: boolean;
};

/**
 * 拖动浏览的一帧：某会话下若干单元的几何（spec `model-version-timeline-scrub` design §5）。
 * `geometryKey` 是服务端给的内容摘要，两个会话的键相等 ⇒ 几何逐条相同，不必重装。
 */
export type BrowseFrameDetail = {
  dbnum: number;
  sesno: number;
  sessionTime: string | null;
  units: { unitRefno: string; geometryKey: string | null; entries: ModelUnitVersionSide['entries'] }[];
};

/** 浏览模式对外的读数（角标文本由面板按 `browseBadgeText` 算好传进来） */
export type ModelUnitCompareBrowseState = {
  active: boolean;
  /** 当前视口里装着的会话；`missing` / `loading` 时也要知道是哪一版 */
  sesno: number | null;
  sessionTime: string | null;
  /** 角标文本（`browseBadgeText` 的结果） */
  badge: string;
  /** 已装入的单元与它们的 `geometryKey`：`geometryKey` 相同就只改角标 */
  installed: { unitRefno: string; geometryKey: string | null }[];
  /** 环境中被藏起来的单元根 */
  unitRefnos: string[];
  /** 当前这一版该单元不存在时的原因（`UNIT_NOT_PRESENT`）；装到了就是 null */
  missingReason: 'not-yet' | 'deleted' | null;
};

/**
 * 拖动浏览的三维接口（Requirement 3.1、3.2、3.8、3.9、3.11、3.14、5.8、9.5）：
 * 复用 A 侧隔离图层那一套，但只有一层——浏览永远只显示一个会话。
 */
export type ModelUnitCompareBrowseApi = {
  /** 进入浏览：只隐藏环境中这些单元，装一层空图层，相机等第一帧再对 */
  browseEnter(ctx: { dbnum: number; unitRefnos: string[]; focusRefno?: string | null }): void;
  /** 显示一帧；按单元比 `geometryKey`，相同只改角标（3.8）。`diffRows` = 单钉着色时的四态行 */
  browseShow(frame: BrowseFrameDetail, opts?: { diffRows?: ModelUnitGeometryDiff[] }): Promise<void>;
  /** 游标请求进行中：角标「正在加载 sesno N」，图层不动（3.3） */
  browsePending(sesno: number): void;
  /** `UNIT_NOT_PRESENT`：清图层，环境同单元保持隐藏（3.11） */
  browseMissing(sesno: number, reason: 'not-yet' | 'deleted'): void;
  /** 直接改角标文本（子树确认 / 已取消 / 最新版本无差异这些面板侧状态） */
  browseBadge(text: string): void;
  /** 对比模式里拖钉只换一侧，另一侧不重建（5.8） */
  replaceSide(side: ModelUnitCompareSide, detailSide: ModelUnitVersionSide): Promise<void>;
  /** 退出浏览：卸图层、恢复环境、清角标（3.14） */
  browseExit(): void;
  /**
   * 浏览图层是否已建好。`browseEnter` 在视口未就绪时静默返回、不建图层，
   * 这时后续 `browseShow` 也全部静默返回——几何进了缓存但一帧都不显示。
   * 性能脚本与面板的调试读数靠这条区分「几何没装上」与「图层没建」。
   */
  readonly browseLayerReady: boolean;
};

export type ModelUnitCompareController = ModelUnitCompareBrowseApi & {
  /** 视口侧运行态；面板经 `MODEL_UNIT_VERSION_COMPARE_STATE_EVENT` 收它的副本 */
  state: Ref<ModelUnitVersionCompareRuntimeState | null>;
  /** 浏览模式读数（Requirement 3.2：角标 sesno 取自实际装入的帧） */
  browse: Ref<ModelUnitCompareBrowseState>;
  /** 视口角标 / 图例用：本次对比按「模型几何差异」四态的构件数（与面板徽章同一份 `rows`） */
  statusCounts: ComputedRef<Record<ModelUnitGeometryStatus, number> | null>;
  /** 每次 open / clear 递增；校审恢复拿它判「期间有没有别的对比插进来」 */
  readonly runId: number;
  open(detail: ModelUnitVersionCompareOpenDetail, options?: ModelUnitCompareOpenOptions): Promise<void>;
  clear(restoreCamera?: boolean): void;
  focus(refno: string): void;
  setSide(side: ModelUnitCompareSide): void;
  setDiffOnly(diffOnly: boolean): void;
  setViewMode(viewMode: ModelUnitCompareViewMode): void;
  refreshEnvironment(): Promise<void>;
  publishState(): void;
  /** 面板经 `MODEL_UNIT_VERSION_COMPARE_EVENT` 发来的 open / close / focus / set-* / refresh-environment / request-state */
  handleEvent(event: Event): void;
  /** 分屏就绪：ready + split + 两层都在 */
  isSplitReady(): boolean;
  /** 分屏每帧：左 A / 右 B 两格各画一遍；没在分屏回 false，调用方照单视口画 */
  renderSplitScene(viewer: DtxViewer, selection: DTXSelectionController | null): boolean;
  pickObject(raycaster: Raycaster, side: ModelUnitCompareSide): ModelUnitComparePick | null;
  splitRay(canvasPos: Vector2, canvas: HTMLCanvasElement, viewer: DtxViewer): SplitCompareRay | null;
  selectObject(pick: ModelUnitComparePick): void;
  /** 停掉运行态的发布 watch（组件卸载时；在组件 setup 里创建的话 Vue 自己也会停） */
  dispose(): void;
};

type CameraState = { position: Vector3; target: Vector3; near: number; far: number };

/** 「三维只看差异」开着才把 `unchanged` 对象交给 `applyModelUnitVersionSide` 去藏 */
export function createModelUnitCompareController(host: ModelUnitCompareHost): ModelUnitCompareController {
  const state = ref<ModelUnitVersionCompareRuntimeState | null>(null);
  const statusCounts = computed(() => (state.value ? countModelUnitGeometryStatuses(state.value.detail.rows) : null));

  let layers: DTXLayer[] = [];
  /** 两侧隔离图层里 `unchanged` 的对象 id，「三维只看差异」时藏它们；随对比打开时算一次、关闭清空 */
  let hiddenObjectIds: ModelUnitCompareHiddenObjectIds | null = null;
  let originalVisibility = new Map<string, boolean>();
  let targetRefnos: string[] = [];
  /** 本次对比装的单元根（多单元一次装载时一串）：环境里按整单元藏的按它 */
  let targetUnitRefnos: string[] = [];
  let cameraState: CameraState | null = null;
  let runId = 0;
  let splitOutlineCache: ModelUnitCompareSplitOutline | null = null;

  // -------------------------------------------------------------------------
  // 拖动浏览（spec `model-version-timeline-scrub`）：一层隔离图层、一次一个会话
  // -------------------------------------------------------------------------

  /** 浏览模式的读数；面板经它出角标、e2e 经 dev hook 读它 */
  const browse = ref<ModelUnitCompareBrowseState>({
    active: false,
    sesno: null,
    sessionTime: null,
    badge: '',
    installed: [],
    unitRefnos: [],
    missingReason: null,
  });
  /** 浏览用的那一层（复用 A 侧的做法，但只有一层） */
  let browseLayer: DTXLayer | null = null;
  /** 浏览装着的单元 → `geometryKey`：相同就不重装（Requirement 3.8） */
  let browseInstalled = new Map<string, string | null>();
  /** 浏览进入时的相机与「还没对过框」标记：只在第一帧 fit 一次（Requirement 3.9） */
  let browseCameraState: CameraState | null = null;
  let browseFitted = false;
  /** 浏览藏掉的环境对象（退出时按进入前的显隐还回去） */
  let browseHiddenObjectIds: string[] = [];
  let browseOriginalVisibility = new Map<string, boolean>();
  let browseDbnum = 0;
  let browseFocusRefno: string | null = null;
  /** 每次 browseShow 递增：装到一半被新的一帧顶掉就丢掉这一帧的结果 */
  let browseRun = 0;
  /** 单钉着色：当前帧的四态行 */
  let browseDiffRows: ModelUnitGeometryDiff[] | null = null;

  function browsePublish(patch: Partial<ModelUnitCompareBrowseState>): void {
    browse.value = { ...browse.value, ...patch };
    // 角标 / 读数变化单独打一个 mark（tasks.md 17.1）：性能脚本据此算「游标变了到角标更新」的耗时。
    // 打点同步，量到的是状态改好的时刻；Vue 把这段文本刷进 DOM 是紧随其后的同一个微任务批次，
    // 所以脚本以 `frame-shown` 作主指标，这个 mark 只做辅助定位（角标是不是拖后腿）。
    if (patch.sesno !== undefined || patch.badge !== undefined) {
      markScrub('version-scrub:badge-updated', { sesno: browse.value.sesno, badge: browse.value.badge });
    }
  }

  /** 性能埋点：只打点、不改行为；不支持 `detail` 的环境退一步只打点 */
  function markScrub(name: string, detail?: Record<string, unknown>): void {
    if (typeof performance === 'undefined' || typeof performance.mark !== 'function') return;
    try {
      performance.mark(name, detail ? { detail } : undefined);
    } catch {
      try {
        performance.mark(name);
      } catch {
        // 打点失败不影响浏览
      }
    }
  }

  function browseEnter(ctx: { dbnum: number; unitRefnos: string[]; focusRefno?: string | null }): void {
    // 已经在一轮浏览里：只换焦点，不重藏环境、不动相机
    if (browse.value.active) {
      browseFocusRefno = ctx.focusRefno ?? null;
      browsePublish({ unitRefnos: ctx.unitRefnos.map(host.normalizeRefno).filter(Boolean) });
      return;
    }
    const viewer = host.viewer();
    const primaryLayer = host.primaryLayer();
    if (!viewer || !primaryLayer) return;

    browseDbnum = ctx.dbnum;
    browseFocusRefno = ctx.focusRefno ?? null;
    browseFitted = false;
    browseDiffRows = null;
    browseRun += 1;
    browseInstalled = new Map();
    browseCameraState = {
      position: viewer.camera.position.clone(),
      target: viewer.controls.target.clone(),
      near: viewer.camera.near,
      far: viewer.camera.far,
    };
    const unitRefnos = ctx.unitRefnos.map(host.normalizeRefno).filter(Boolean);
    // 只藏环境里这些单元（Requirement 3.1）：按整单元藏，构件级的 refno 这一层还列不出来
    const targetObjectIds = collectModelUnitTargetObjectIds(
      unitRefnos,
      [],
      (refno) => host.resolve.objectIdsByRefno(browseDbnum, refno),
      (refno) => host.resolve.objectIdsByUnitRefno(browseDbnum, refno),
    );
    browseOriginalVisibility = new Map(
      targetObjectIds.map((objectId) => [objectId, primaryLayer.isObjectVisible(objectId)] as const),
    );
    browseHiddenObjectIds = targetObjectIds;
    primaryLayer.setObjectsVisible(targetObjectIds, false);

    const layer = host.createLayer(viewer, primaryLayer);
    host.attachLayer(layer, viewer);
    layers = [layer];
    browseLayer = layer;

    browsePublish({
      active: true,
      sesno: null,
      sessionTime: null,
      badge: '',
      installed: [],
      unitRefnos,
      missingReason: null,
    });
    host.requestRender();
  }

  /**
   * 显示一帧。按单元比 `geometryKey`：相同就跳过重装（Requirement 3.8、Property 14），只改角标；
   * 不同的单元用 `replaceExistingObjects` 重装它自己那一批，别的单元不动。
   */
  async function browseShow(frame: BrowseFrameDetail, opts: { diffRows?: ModelUnitGeometryDiff[] } = {}): Promise<void> {
    const layer = browseLayer;
    const viewer = host.viewer();
    if (!browse.value.active || !layer || !viewer) return;
    const run = ++browseRun;
    browseDiffRows = opts.diffRows ?? null;

    const changed: BrowseFrameDetail['units'] = [];
    for (const unit of frame.units) {
      const unitRefno = host.normalizeRefno(unit.unitRefno);
      if (!unitRefno) continue;
      const previous = browseInstalled.get(unitRefno);
      // 键相同 = 几何逐条相同：这一单元一个对象都不重装
      if (previous !== undefined && previous !== null && unit.geometryKey !== null && previous === unit.geometryKey) continue;
      changed.push({ ...unit, unitRefno });
    }

    for (const unit of changed) {
      if (run !== browseRun) return;
      const refnos = [...unit.entries.keys()];
      if (refnos.length === 0) {
        browseInstalled.set(unit.unitRefno, unit.geometryKey);
        continue;
      }
      await host.loadInstances(layer, frame.dbnum, refnos, {
        includeOwnedTubings: false,
        isolated: true,
        expectedRootRefno: unit.unitRefno,
        instanceEntriesByRefno: unit.entries,
        replaceExistingObjects: true,
        objectIdPrefix: `unit-browse:${unit.unitRefno}`,
      });
      if (run !== browseRun) return;
      browseInstalled.set(unit.unitRefno, unit.geometryKey);
    }

    // 四态着色（单钉对照）：没给 diffRows 就把整层还原成不透明底色
    const statusColors = Object.fromEntries(
      Object.entries(MODEL_UNIT_GEOMETRY_STATUS_COLORS).map(([status, hex]) => [status, new Color(hex)]),
    ) as Record<ModelUnitGeometryStatus, Color>;
    if (browseDiffRows) {
      for (const { objectId, status } of planModelUnitCompareObjectStyles(layer.getAllObjectIds(), browseDiffRows)) {
        layer.setObjectMaterial(objectId, { color: statusColors[status] });
      }
    }

    // 相机：进入后第一帧对一次框，之后不动（Requirement 3.9）
    if (!browseFitted) {
      const box = layer.getBoundingBox();
      if (box && !box.isEmpty()) {
        host.fitToBox(viewer, box);
        browseFitted = true;
      }
    }
    // 叶子构件「仅自身」时只高亮 focusRefno（Requirement 9.5）：按隔离图层自己的对象 id 取 refno，
    // 不走 `host.resolve.objectIdsByRefno`——那是主图层（环境）的索引，浏览图层里的 id 不在里面
    const focus = browseFocusRefno ? host.normalizeRefno(browseFocusRefno) : null;
    if (focus) {
      for (const objectId of layer.getAllObjectIds()) {
        const refno = refnoFromCompareObjectId(objectId);
        layer.setObjectVisible(objectId, !refno || host.normalizeRefno(refno) === focus);
      }
    } else {
      // 上一帧可能为了只高亮一个构件把别的藏了：没有焦点就整层恢复可见（同键帧不重装，显隐得自己还）
      for (const objectId of layer.getAllObjectIds()) layer.setObjectVisible(objectId, true);
    }

    browsePublish({
      sesno: frame.sesno,
      sessionTime: frame.sessionTime,
      installed: [...browseInstalled].map(([unitRefno, geometryKey]) => ({ unitRefno, geometryKey })),
      missingReason: null,
    });
    host.requestRender();
    markScrubFrameShown(frame.sesno);
  }

  /**
   * 性能埋点（tasks.md 17.1，Requirement 12.1–12.4）：首帧渲染完成且角标更新之后打一个 mark。
   * `requestRender()` 只是提交，真正的首帧在下一个动画帧里画完，所以这里等两帧再打点：
   * 第一帧是 Three.js 的绘制，第二帧才是「画面上已经看到」。只打点、不改行为，生产构建保留。
   */
  function markScrubFrameShown(sesno: number): void {
    const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : null;
    if (!raf) {
      markScrub('version-scrub:frame-shown', { sesno });
      return;
    }
    raf(() => {
      raf(() => markScrub('version-scrub:frame-shown', { sesno }));
    });
  }

  function browsePending(sesno: number): void {
    if (!browse.value.active) return;
    // 图层不动：上一次装好的几何留在视口里，只有角标说「正在加载」
    browsePublish({ sesno });
  }

  function browseMissing(sesno: number, reason: 'not-yet' | 'deleted'): void {
    const layer = browseLayer;
    if (!browse.value.active || !layer) return;
    browseRun += 1;
    for (const objectId of layer.getAllObjectIds()) layer.setObjectVisible(objectId, false);
    browseInstalled = new Map();
    // 环境里那些单元保持隐藏：这一版它们不存在，露出环境里的「当前」几何会骗人
    browsePublish({ sesno, sessionTime: null, installed: [], missingReason: reason });
    host.requestRender();
  }

  function browseBadge(text: string): void {
    if (!browse.value.active) return;
    browsePublish({ badge: text });
  }

  /**
   * 对比模式里拖钉只换一侧（Requirement 5.8）：卸掉该侧图层、只重装那一侧，另一侧不动。
   * 复用 `open` 的两层结构——这里只做「该侧对象全撤再装」的最小动作。
   */
  async function replaceSide(side: ModelUnitCompareSide, detailSide: ModelUnitVersionSide): Promise<void> {
    const current = state.value;
    if (!current || current.status !== 'ready') return;
    const layer = side === 'before' ? layers[0] : layers[1];
    if (!layer) return;
    const refnos = detailSide.refnos;
    if (refnos.length === 0) {
      for (const objectId of layer.getAllObjectIds()) layer.setObjectVisible(objectId, false);
      host.requestRender();
      return;
    }
    await host.loadInstances(layer, current.detail.dbnum, refnos, {
      includeOwnedTubings: false,
      isolated: true,
      expectedRootRefno: current.detail.unitRefno,
      instanceEntriesByRefno: detailSide.entries,
      replaceExistingObjects: true,
      objectIdPrefix: side === 'before' ? 'unit-compare:a' : 'unit-compare:b',
    });
    // 换的是「哪一版」，两侧的四态行由面板重算后随 `set-diff-only` 之类进来；这里只保证几何与着色对得上
    const statusColors = Object.fromEntries(
      Object.entries(MODEL_UNIT_GEOMETRY_STATUS_COLORS).map(([status, hex]) => [status, new Color(hex)]),
    ) as Record<ModelUnitGeometryStatus, Color>;
    for (const { objectId, status } of planModelUnitCompareObjectStyles(layer.getAllObjectIds(), current.detail.rows)) {
      layer.setObjectMaterial(objectId, { color: statusColors[status] });
    }
    host.requestRender();
  }

  /** 退出浏览：卸图层、恢复环境显隐、相机回原位、清角标（Requirement 3.14） */
  function browseExit(): void {
    if (!browse.value.active) return;
    browseRun += 1;
    if (browseLayer) {
      disposeLayer(browseLayer);
      browseLayer = null;
    }
    layers = [];
    const primaryLayer = host.primaryLayer();
    if (primaryLayer) {
      for (const objectId of browseHiddenObjectIds) {
        const visible = browseOriginalVisibility.get(objectId);
        if (visible !== undefined) primaryLayer.setObjectVisible(objectId, visible);
      }
    }
    browseHiddenObjectIds = [];
    browseOriginalVisibility = new Map();
    browseInstalled = new Map();
    browseDiffRows = null;
    browseFocusRefno = null;
    const viewer = host.viewer();
    if (viewer && browseCameraState) {
      viewer.camera.position.copy(browseCameraState.position);
      viewer.controls.target.copy(browseCameraState.target);
      viewer.camera.near = browseCameraState.near;
      viewer.camera.far = browseCameraState.far;
      viewer.camera.updateProjectionMatrix();
      viewer.controls.update();
    }
    browseCameraState = null;
    browseFitted = false;
    if (host.selection.hasVersionPin()) host.selection.clearSelection();
    browse.value = {
      active: false,
      sesno: null,
      sessionTime: null,
      badge: '',
      installed: [],
      unitRefnos: [],
      missingReason: null,
    };
    host.requestRender();
  }

  function devHook(): Record<string, unknown> | null {
    if (!host.isDev || typeof window === 'undefined') return null;
    const hook = (window as unknown as { __modelUnitVersionCompare?: Record<string, unknown> }).__modelUnitVersionCompare;
    return hook ?? null;
  }

  function publishState(): void {
    const current = state.value;
    const detail: ModelUnitVersionCompareRuntimeState | null = current
      ? {
        ...current,
        environment: current.environment ? { ...current.environment } : undefined,
      }
      : null;
    window.dispatchEvent(new CustomEvent(MODEL_UNIT_VERSION_COMPARE_STATE_EVENT, { detail }));
  }
  const stopPublish: WatchStopHandle = watch(state, publishState, { deep: true });

  function disposeLayer(layer: DTXLayer): void {
    host.forgetLayer(layer);
    try {
      layer.dispose();
    } catch {
      // ignore
    }
  }

  function disposeRunLayers(runLayers: DTXLayer[]): void {
    for (const layer of runLayers) {
      const index = layers.indexOf(layer);
      if (index < 0) continue;
      layers.splice(index, 1);
      disposeLayer(layer);
    }
  }

  function collectLoadedRefnoVisibility(primaryLayer: DTXLayer, dbnum: number): Map<string, boolean> {
    const refnos = new Set<string>();
    for (const objectId of primaryLayer.getAllObjectIds()) {
      const refno = host.resolve.refnoByObjectId(dbnum, objectId);
      if (refno) refnos.add(refno);
    }
    const visibility = new Map<string, boolean>();
    for (const refno of refnos) {
      visibility.set(
        refno,
        host.resolve.objectIdsByRefno(dbnum, refno).some((objectId) => primaryLayer.isObjectVisible(objectId)),
      );
    }
    return visibility;
  }

  /**
   * 「最新环境模型」= 打开对比时视口里**已加载**的该 dbnum 模型（CONTEXT「模型版本查看」，Q12）：把已加载的 refno 按页面级开关
   * 重取一遍（gen-model-v1 = records + forceRefresh），保持各自的显隐，不整库加载。
   */
  async function refreshEnvironmentFor(
    detail: ModelUnitVersionCompareOpenDetail,
    run: number,
  ): Promise<{ loadedRefnos: number; refreshing: false }> {
    const primaryLayer = host.primaryLayer();
    if (!primaryLayer) throw new Error('三维环境图层尚未就绪');

    const visibilityByRefno = collectLoadedRefnoVisibility(primaryLayer, detail.dbnum);
    const loadedRefnos = [...visibilityByRefno.keys()];
    if (loadedRefnos.length > 0) {
      await host.loadInstances(primaryLayer, detail.dbnum, loadedRefnos, {
        forceReloadRefnos: loadedRefnos,
        replaceExistingObjects: true,
      });
      if (run !== runId) throw new Error('版本对比已取消');
      applyModelUnitRefnoVisibility(
        primaryLayer,
        visibilityByRefno,
        (refno) => host.resolve.objectIdsByRefno(detail.dbnum, refno),
      );
    }

    return { loadedRefnos: loadedRefnos.length, refreshing: false };
  }

  function hideTarget(primaryLayer: DTXLayer, dbnum: number): void {
    const unitRefnos = targetUnitRefnos.length ? targetUnitRefnos : [targetRefnos[0] || ''];
    primaryLayer.setObjectsVisible(collectModelUnitTargetObjectIds(
      unitRefnos,
      targetRefnos,
      (refno) => host.resolve.objectIdsByRefno(dbnum, refno),
      (refno) => host.resolve.objectIdsByUnitRefno(dbnum, refno),
    ), false);
  }

  function hiddenForState(): ModelUnitCompareHiddenObjectIds | null {
    return state.value?.diffOnly ? hiddenObjectIds : null;
  }

  function setSide(side: ModelUnitCompareSide): void {
    const current = state.value;
    if (!current || current.status !== 'ready') return;
    const [beforeLayer, afterLayer] = layers;
    applyModelUnitVersionSide(beforeLayer, afterLayer, side, hiddenForState());
    current.activeSide = side;
    const hook = devHook();
    if (hook) hook.activeSide = side;
    host.requestRender();
  }

  /**
   * 「三维只看差异」：隔离图层里藏掉两版都没变的构件，只剩新增 / 删除 / 修改的（与面板列表「包含未变化」反义、同一口径）。
   * 只改显隐，不重装几何；分屏每帧的 pass 也照它走（`renderSplitScene`）。
   */
  function setDiffOnly(diffOnly: boolean): void {
    const current = state.value;
    if (!current || current.status !== 'ready' || (current.diffOnly ?? false) === diffOnly) return;
    current.diffOnly = diffOnly;
    const [beforeLayer, afterLayer] = layers;
    applyModelUnitVersionSide(beforeLayer, afterLayer, current.activeSide, hiddenForState());
    const hook = devHook();
    if (hook) hook.diffOnly = diffOnly;
    host.requestRender();
  }

  function setViewMode(viewMode: ModelUnitCompareViewMode): void {
    const current = state.value;
    if (!current || current.status !== 'ready' || current.viewMode === viewMode) return;
    if (viewMode === 'split') host.beforeSplit();
    current.viewMode = viewMode;
    const hook = devHook();
    if (hook) hook.viewMode = viewMode;
    host.requestRender();
  }

  function isSplitReady(): boolean {
    return state.value?.status === 'ready'
      && state.value.viewMode === 'split'
      && layers.length === 2;
  }

  /**
   * 分屏每格走不走描边合成器（收口计划 P3-c，D6「留，但软渲染自动退回」）：按这块 WebGL 上下文的显卡串定一次、缓存——
   * 认出 SwiftShader / llvmpipe / Microsoft Basic Render Driver 一类软渲染就退回直接 `renderer.render`（README §8.3：软渲染下合成器分屏 11 fps、
   * 直接 render 60 fps）；读不到显卡串按真显卡处理。`localStorage['plant3d-web.viewer.splitOutline']` = `compositor` / `direct` 可强制（排障用）。
   */
  function resolveSplitOutline(viewer: DtxViewer): ModelUnitCompareSplitOutline {
    if (splitOutlineCache) return splitOutlineCache;
    const info = readWebGLRendererInfo(viewer.renderer.getContext());
    let compositor = !info.software;
    try {
      const forced = window.localStorage?.getItem('plant3d-web.viewer.splitOutline');
      if (forced === 'compositor') compositor = true;
      else if (forced === 'direct') compositor = false;
    } catch {
      // localStorage 不可用就按探测结果
    }
    splitOutlineCache = { compositor, renderer: info.renderer };
    return splitOutlineCache;
  }

  /**
   * 分屏：同一相机改 aspect、scissor 左右两格各画一遍。有描边合成器（且不是软渲染）就每格走 `selection.renderOutline()`（与单视口同一条渲染路——
   * 分屏里选中的环境构件两格都有描边，色彩空间 / 后处理也和单视口一致），没有 / 软渲染才直接 `renderer.render`（选中的环境构件仍按选中色显示，只是没描边）。
   */
  function renderSplitScene(viewer: DtxViewer, selection: DTXSelectionController | null): boolean {
    const current = state.value;
    const [beforeLayer, afterLayer] = layers;
    if (!current || !beforeLayer || !afterLayer || !isSplitReady()) return false;

    const renderer = viewer.renderer;
    const camera = viewer.camera;
    const viewportSize = renderer.getSize(new Vector2());
    const passes = getModelUnitCompareRenderPasses(
      'split',
      current.activeSide,
      viewportSize.x,
      viewportSize.y,
    );
    const originalAspect = camera.aspect;
    const hidden = hiddenForState();
    const useCompositor = !!selection?.hasOutline() && resolveSplitOutline(viewer).compositor;
    let splitRenderError: unknown = null;
    try {
      renderer.setScissorTest(true);
      for (const pass of passes) {
        applyModelUnitVersionSide(beforeLayer, afterLayer, pass.side, hidden);
        renderer.setViewport(pass.x, pass.y, pass.width, pass.height);
        renderer.setScissor(pass.x, pass.y, pass.width, pass.height);
        camera.aspect = pass.width / Math.max(1, pass.height);
        camera.updateProjectionMatrix();
        if (useCompositor) selection!.renderOutline();
        else renderer.render(viewer.scene, camera);
        host.renderOverlay(viewer);
      }
    } catch (error) {
      splitRenderError = error;
    } finally {
      applyModelUnitVersionSide(beforeLayer, afterLayer, current.activeSide, hidden);
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, viewportSize.x, viewportSize.y);
      camera.aspect = originalAspect;
      camera.updateProjectionMatrix();
    }
    if (splitRenderError) {
      current.viewMode = 'single';
      host.toast(`双视口渲染失败，已回退单视口：${splitRenderError instanceof Error ? splitRenderError.message : String(splitRenderError)}`);
      return false;
    }
    return true;
  }

  async function refreshEnvironment(): Promise<void> {
    const current = state.value;
    const primaryLayer = host.primaryLayer();
    if (!current || current.status !== 'ready' || !current.environment || !primaryLayer || current.environment.refreshing) return;
    const run = runId;
    current.environment = { ...current.environment, refreshing: true, error: undefined };
    try {
      const environment = await refreshEnvironmentFor(current.detail, run);
      if (run !== runId || !state.value) return;
      hideTarget(primaryLayer, current.detail.dbnum);
      state.value.environment = environment;
      host.requestRender();
    } catch (error) {
      if (run !== runId || !state.value) return;
      const message = error instanceof Error ? error.message : String(error);
      state.value.environment = {
        ...current.environment,
        refreshing: false,
        error: message,
      };
      host.toast(`最新环境刷新失败，已保留当前环境：${message}`);
    }
  }

  function clear(restoreCamera = true): void {
    runId += 1;
    // 浏览与对比共用 `layers`：浏览中打开 / 关闭对比时先把浏览收掉，否则那一层会被这里 dispose 两次、
    // 环境显隐也还错一份
    if (browse.value.active) browseExit();
    host.onClear?.();
    for (const layer of layers.splice(0)) {
      disposeLayer(layer);
    }
    hiddenObjectIds = null;
    const primaryLayer = host.primaryLayer();
    const detail = state.value?.detail;
    if (primaryLayer && detail) {
      applyModelUnitRefnoVisibility(
        primaryLayer,
        originalVisibility,
        (refno) => host.resolve.objectIdsByRefno(detail.dbnum, refno),
      );
    }
    originalVisibility = new Map();
    targetRefnos = [];
    targetUnitRefnos = [];
    const viewer = host.viewer();
    if (restoreCamera && viewer && cameraState) {
      viewer.camera.position.copy(cameraState.position);
      viewer.controls.target.copy(cameraState.target);
      viewer.camera.near = cameraState.near;
      viewer.camera.far = cameraState.far;
      viewer.camera.updateProjectionMatrix();
      viewer.controls.update();
    }
    cameraState = null;
    state.value = null;
    // 钉在某一版上的选中随对比一起退：那一版的快照马上被面板 DELETE，留着只会是一份取不回来的旧属性
    if (host.selection.hasVersionPin()) host.selection.clearSelection();
    if (host.isDev && typeof window !== 'undefined') {
      delete (window as unknown as { __modelUnitVersionCompare?: unknown }).__modelUnitVersionCompare;
    }
    host.requestRender();
  }

  /**
   * 本次对比装着的单元根 `unitRefno`（已归一化）→ 它两侧几何列到的成员 refno（已归一化）；不是装着的单元根回 null。
   * 单单元就是 `detail.before / after`；多单元一次装载按 `detail.units` 里它自己那一组取（`detail.before / after` 是全部单元并起来的）。
   */
  function compareUnitMemberRefnos(unitRefno: string): Set<string> | null {
    const detail = state.value?.detail;
    if (!detail || !targetUnitRefnos.includes(unitRefno)) return null;
    const unit = detail.units?.length
      ? detail.units.find((item) => host.normalizeRefno(item.unitRefno) === unitRefno)
      : detail;
    if (!unit) return null;
    const members = new Set<string>();
    for (const raw of [...unit.before.refnos, ...unit.after.refnos]) {
      const member = host.normalizeRefno(raw);
      if (member) members.add(member);
    }
    return members;
  }

  /**
   * 这个 refno（已归一化）在本次对比里是不是「B 版已删、当前会话里没有它」：`rows` 里它那一行是 `deleted`，或它是装着的单元根而那个单元
   * 的 B 侧是「已删除单元版本」（tombstone——单元根自己没有几何、不进 `rows`，与 `buildTreeDiffModels` 给树补单元根幽灵行同一口径）。
   * 多单元一次装载按 `detail.units` 里它自己那一组的 B 侧看。
   */
  function compareRefnoIsDeleted(normalized: string): boolean {
    const detail = state.value?.detail;
    if (!detail) return false;
    if (detail.rows.some((row) => row.status === 'deleted' && host.normalizeRefno(row.refno) === normalized)) return true;
    if (!targetUnitRefnos.includes(normalized)) return false;
    const unit = detail.units?.length
      ? detail.units.find((item) => host.normalizeRefno(item.unitRefno) === normalized)
      : detail;
    return unit?.after.version.impactKind === 'tombstone';
  }

  /**
   * 版本对比事件的 `focus`：先在 A / B 隔离图层里找它自己的几何（两层都找，被删的构件在 A 层也找得到）；它是本次对比装着的单元根而自己
   * 没有几何对象（BRAN / EQUI 一类单元根的几何都在成员上，整单元被删时单元根那一行也是 deleted）就退一步飞到那个单元在 A / B 层的整体包围盒；
   * 没装 A / B 或这个 refno 不在装着的那个单元里（容器差异摘要 / 属性对比 tab 里别的单元的构件，设计稿 S3「定位」）就回落到主图层（环境模型）
   * 里的同一 refno；哪儿都没有就不动相机（e2e 拿「相机动没动」当信号）。
   *
   * 选中：在 A / B 里找到、且它在本次对比里是被删的（`compareRefnoIsDeleted`）就按「已删除」登记（属性面板给提示、不去拉当前会话——
   * 拉了只是 404 红条）；树差异模式已按「已删除」登记过的（含 B 版之后才被删的新增 / 修改，只有树知道）不覆盖；其余普通选中。
   * 单视口下几何只在一侧有（被删的只在 A、新增的只在 B）而当前显示的是另一侧，顺手切到那一侧——不然飞过去看到的是空的；分屏两侧都在，不切。
   */
  function focus(refno: string): void {
    const viewer = host.viewer();
    const normalized = host.normalizeRefno(refno);
    if (!viewer || !normalized) return;

    const box = new Box3();
    const objectBox = new Box3();
    const hitSides = new Set<ModelUnitCompareSide>();
    const unionCompareObjects = (matches: (objectId: string) => boolean): void => {
      for (const layer of layers) {
        for (const objectId of layer.getAllObjectIds()) {
          if (!matches(objectId)) continue;
          const found = layer.getObjectBoundingBoxInto(objectId, objectBox);
          if (!found || found.isEmpty()) continue;
          box.union(found);
          const hitSide = sideFromCompareObjectId(objectId);
          if (hitSide) hitSides.add(hitSide);
        }
      }
    };
    unionCompareObjects((objectId) => objectId.includes(`:${normalized}:`));
    if (box.isEmpty()) {
      // 单元根自己没有几何对象（成员才有）：退一步并起它的成员在 A / B 层的包围盒
      const members = compareUnitMemberRefnos(normalized);
      if (members) {
        unionCompareObjects((objectId) => {
          const memberRefno = refnoFromCompareObjectId(objectId);
          return !!memberRefno && members.has(host.normalizeRefno(memberRefno) || memberRefno);
        });
      }
    }
    const inCompareLayers = !box.isEmpty();
    if (!inCompareLayers) {
      const primary = host.primaryLayer();
      const prefix = `o:${normalized}:`;
      for (const objectId of primary?.getAllObjectIds() ?? []) {
        if (!objectId.startsWith(prefix)) continue;
        const found = primary!.getObjectBoundingBoxInto(objectId, objectBox);
        if (found && !found.isEmpty()) box.union(found);
      }
    }
    if (box.isEmpty()) return;

    // 已按「已删除」登记过的（树差异模式的幽灵行，含 B 版之后才被删的新增 / 修改）不覆盖；本次对比里被删的按「已删除」登记——
    // 两种都是当前会话里没有它，普通选中会让属性面板去拉当前会话、换回 404 红条。回落到主图层找到的一定是当前会话里有的，普通选中即可。
    const alreadyDeletedRegistered = inCompareLayers
      && host.selection.selectedIsDeleted()
      && host.selection.selectedRefno() === normalized;
    if (!alreadyDeletedRegistered) {
      if (inCompareLayers && compareRefnoIsDeleted(normalized)) host.selection.setSelectedDeletedRefno(normalized);
      else host.selection.setSelectedRefno(normalized);
    }
    // 单视口里几何只在一侧有、当前显示的却是另一侧：切过去，不然飞到的是空的（分屏两侧都画着，不动）
    const current = state.value;
    if (inCompareLayers && hitSides.size === 1 && current?.status === 'ready' && current.viewMode === 'single') {
      const [onlySide] = hitSides;
      if (onlySide && onlySide !== current.activeSide) setSide(onlySide);
    }
    viewer.fitClipPlanesToBox(box);
    const center = new Vector3();
    const size = new Vector3();
    box.getCenter(center);
    box.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z, 1);
    viewer.flyTo(
      new Vector3(center.x + maxDim * 1.15, center.y - maxDim * 1.45, center.z + maxDim * 0.95),
      center,
      { duration: 500 },
    );
    host.requestRender();
  }

  async function open(detail: ModelUnitVersionCompareOpenDetail, options: ModelUnitCompareOpenOptions = {}): Promise<void> {
    const shouldApply = options.shouldApply ?? (() => true);
    if (!shouldApply()) return;
    clear();
    const viewer = host.viewer();
    const primaryLayer = host.primaryLayer();
    if (!viewer || !primaryLayer) {
      state.value = {
        detail,
        status: 'error',
        activeSide: 'after',
        viewMode: DEFAULT_MODEL_UNIT_COMPARE_VIEW_MODE,
        error: '三维查看器尚未就绪',
      };
      return;
    }

    const run = ++runId;
    state.value = {
      detail,
      status: 'loading',
      activeSide: 'after',
      viewMode: DEFAULT_MODEL_UNIT_COMPARE_VIEW_MODE,
    };
    cameraState = {
      position: viewer.camera.position.clone(),
      target: viewer.controls.target.clone(),
      near: viewer.camera.near,
      far: viewer.camera.far,
    };
    const runLayers: DTXLayer[] = [];

    try {
      const environmentResult = await (options.refreshEnvironment === false
        ? Promise.resolve({ loadedRefnos: collectLoadedRefnoVisibility(primaryLayer, detail.dbnum).size, refreshing: false as const })
        : refreshEnvironmentFor(detail, run))
        .then((environment) => ({ environment, error: undefined }))
        .catch((error: unknown) => ({
          environment: undefined,
          error: error instanceof Error ? error.message : String(error),
        }));
      if (run !== runId) return;
      if (!shouldApply()) { clear(false); return; }
      const environment: ModelUnitVersionCompareEnvironment = environmentResult.environment ?? {
        loadedRefnos: collectLoadedRefnoVisibility(primaryLayer, detail.dbnum).size,
        refreshing: false as const,
        error: environmentResult.error,
      };
      // 多单元一次装载（detail.units）：每个单元根都算目标，环境里整单元藏掉；unitRefno 那时是容器、没几何，列进来无害
      targetUnitRefnos = modelUnitCompareUnitRefnos(detail).map(host.normalizeRefno).filter(Boolean);
      targetRefnos = Array.from(new Set([
        detail.unitRefno,
        ...targetUnitRefnos,
        ...detail.before.refnos.map(host.normalizeRefno).filter(Boolean),
        ...detail.after.refnos.map(host.normalizeRefno).filter(Boolean),
      ]));
      const currentVisibility = collectLoadedRefnoVisibility(primaryLayer, detail.dbnum);
      originalVisibility = new Map(
        targetRefnos
          .map((refno) => [refno, currentVisibility.get(refno)] as const)
          .filter((entry): entry is readonly [string, boolean] => typeof entry[1] === 'boolean'),
      );
      hideTarget(primaryLayer, detail.dbnum);

      const beforeLayer = host.createLayer(viewer, primaryLayer);
      const afterLayer = host.createLayer(viewer, primaryLayer);
      runLayers.push(beforeLayer, afterLayer);
      layers = [beforeLayer, afterLayer];
      // 两侧几何由版本对比面板经模型来源端口取好、随事件带来（ADR 0065 §2）；这里只往隔离图层里装，
      // 网格 URL 仍按页面级数据源走 `MeshSource`。「已删除单元版本」（tombstone）那一侧不装、显示删除空态。
      const sideHasGeometry = (side: ModelUnitVersionSide): boolean => side.version.impactKind !== 'tombstone';
      const commonOptions = {
        includeOwnedTubings: false,
        isolated: true,
        expectedRootRefno: detail.unitRefno,
      };
      const [beforeResult, afterResult] = await Promise.all([
        sideHasGeometry(detail.before) ? host.loadInstances(beforeLayer, detail.dbnum, detail.before.refnos, {
          ...commonOptions,
          instanceEntriesByRefno: detail.before.entries,
          objectIdPrefix: 'unit-compare:a',
        }) : Promise.resolve(null),
        sideHasGeometry(detail.after) ? host.loadInstances(afterLayer, detail.dbnum, detail.after.refnos, {
          ...commonOptions,
          instanceEntriesByRefno: detail.after.entries,
          objectIdPrefix: 'unit-compare:b',
        }) : Promise.resolve(null),
      ]);
      if (run !== runId) {
        disposeRunLayers(runLayers);
        return;
      }
      if (!shouldApply()) { clear(false); return; }
      const beforeObjects = beforeResult?.loadedObjects ?? 0;
      const afterObjects = afterResult?.loadedObjects ?? 0;
      if (sideHasGeometry(detail.before) && beforeObjects === 0) {
        throw new Error(`版本 A（sesno ${detail.before.sesno}）没有可显示的几何对象`);
      }
      if (sideHasGeometry(detail.after) && afterObjects === 0) {
        throw new Error(`版本 B（sesno ${detail.after.sesno}）没有可显示的几何对象`);
      }
      // 三维里按「模型几何差异」着色（ADR 0066「三维联动」的落地）：每侧内部按 `rows` 的四态上色——修改琥珀 / 新增翠绿（只在 B）/
      // 删除玫红（只在 A）/ 未变石板灰，与面板徽章、模型树差异模式同一套色；版本身份（A / B）由视口角标说明，不再整侧一色。
      // 比较层使用基础材质调色板着色；DTX 的颜色覆盖通道主要服务于选择态，
      // 在多 DTXLayer 并存时可能被共享的 shader program 复用为前一层纹理。
      const statusColors = Object.fromEntries(
        Object.entries(MODEL_UNIT_GEOMETRY_STATUS_COLORS).map(([status, hex]) => [status, new Color(hex)]),
      ) as Record<ModelUnitGeometryStatus, Color>;
      const hidden: ModelUnitCompareHiddenObjectIds = { before: [], after: [] };
      const paintCompareLayer = (layer: DTXLayer, hiddenBucket: string[]): void => {
        for (const { objectId, status } of planModelUnitCompareObjectStyles(layer.getAllObjectIds(), detail.rows)) {
          layer.setObjectMaterial(objectId, { color: statusColors[status] });
          if (status === 'unchanged') hiddenBucket.push(objectId);
        }
      };
      paintCompareLayer(beforeLayer, hidden.before);
      paintCompareLayer(afterLayer, hidden.after);
      hiddenObjectIds = hidden;

      host.attachLayer(beforeLayer, viewer);
      host.attachLayer(afterLayer, viewer);
      applyModelUnitVersionSide(beforeLayer, afterLayer, DEFAULT_MODEL_UNIT_COMPARE_SIDE);
      const compareBox = computeLayersBoundingBox([beforeLayer, afterLayer]);
      if (compareBox) host.fitToBox(viewer, compareBox);

      const splitOutline = resolveSplitOutline(viewer);
      state.value = {
        detail,
        status: 'ready',
        activeSide: DEFAULT_MODEL_UNIT_COMPARE_SIDE,
        viewMode: DEFAULT_MODEL_UNIT_COMPARE_VIEW_MODE,
        diffOnly: false,
        environment,
        splitOutline,
      };
      if (host.isDev && typeof window !== 'undefined') {
        (window as unknown as { __modelUnitVersionCompare?: unknown }).__modelUnitVersionCompare = {
          unitRefno: detail.unitRefno,
          units: modelUnitCompareUnitRefnos(detail),
          splitOutline,
          beforeSesno: detail.before.sesno,
          afterSesno: detail.after.sesno,
          beforeObjects,
          afterObjects,
          environmentLoadedRefnos: environment.loadedRefnos,
          activeSide: 'after',
          viewMode: DEFAULT_MODEL_UNIT_COMPARE_VIEW_MODE,
          diffOnly: false,
          statusCounts: countModelUnitGeometryStatuses(detail.rows),
          hiddenWhenDiffOnly: { before: hidden.before.length, after: hidden.after.length },
        };
      }
      // 面板换单元 / 换版本重开时带来的上一轮视图模式（容器逐组看不用每组再点分屏）：走同一条切换路，测量工具等照样收
      if (detail.viewMode && detail.viewMode !== DEFAULT_MODEL_UNIT_COMPARE_VIEW_MODE) setViewMode(detail.viewMode);
      host.requestRender();
    } catch (error) {
      if (run !== runId) {
        disposeRunLayers(runLayers);
        return;
      }
      if (!shouldApply()) { clear(false); return; }
      const message = error instanceof Error ? error.message : String(error);
      clear();
      state.value = {
        detail,
        status: 'error',
        activeSide: 'after',
        viewMode: DEFAULT_MODEL_UNIT_COMPARE_VIEW_MODE,
        error: message,
      };
      host.toast(`最小交付单元版本加载失败：${message}`);
    }
  }

  function handleEvent(event: Event): void {
    const detail = (event as CustomEvent<ModelUnitVersionCompareEventDetail>).detail;
    if (!detail) return;
    if (detail.action === 'close') {
      clear();
      return;
    }
    if (detail.action === 'focus') {
      focus(detail.refno);
      return;
    }
    if (detail.action === 'set-side') {
      setSide(detail.side);
      return;
    }
    if (detail.action === 'set-view-mode') {
      setViewMode(detail.viewMode);
      return;
    }
    if (detail.action === 'set-diff-only') {
      setDiffOnly(detail.diffOnly);
      return;
    }
    if (detail.action === 'refresh-environment') {
      void refreshEnvironment();
      return;
    }
    if (detail.action === 'request-state') {
      publishState();
      return;
    }
    void open(detail);
  }

  /**
   * 版本对比里在三维点构件：GPU 拾取只认主图层的 picking mesh，A / B 隔离图层里的构件点不到。这里对 `side` 那一侧的隔离图层做一次
   * CPU 射线拾取（包围盒粗筛 → 三角面精测，单元只有几十到几百件），回最近命中。单视口 `side` 就是当前显示那一侧；分屏按指针落的
   * 那一格传（`splitRay`）——帧尾两层已复位成 `activeSide` 的显隐、另一侧整层关着（`raycastObject` 对不可见对象直接回 null），
   * 所以拾非当前侧前照 `renderSplitScene` 每个 pass 的做法临时开那一侧，测完复位。
   */
  function pickObject(raycaster: Raycaster, side: ModelUnitCompareSide): ModelUnitComparePick | null {
    const current = state.value;
    if (!current || current.status !== 'ready') return null;
    const [beforeLayer, afterLayer] = layers;
    const layer = side === 'before' ? beforeLayer : afterLayer;
    if (!layer) return null;
    const swapSide = side !== current.activeSide;
    const hidden = hiddenForState();
    if (swapSide) applyModelUnitVersionSide(beforeLayer, afterLayer, side, hidden);
    try {
      const { origin, direction } = raycaster.ray;
      const box = new Box3();
      let best: { objectId: string; distance: number } | null = null;
      for (const objectId of layer.getVisibleObjectIds()) {
        const bounds = layer.getObjectBoundingBoxInto(objectId, box);
        if (!bounds || bounds.isEmpty() || !raycaster.ray.intersectsBox(bounds)) continue;
        const hit = layer.raycastObject(objectId, origin, direction);
        if (hit && (!best || hit.distance < best.distance)) best = { objectId, distance: hit.distance };
      }
      if (!best) return null;
      const rawRefno = refnoFromCompareObjectId(best.objectId);
      const pickedSide = sideFromCompareObjectId(best.objectId);
      if (!rawRefno || !pickedSide) return null;
      return { objectId: best.objectId, refno: host.normalizeRefno(rawRefno) || rawRefno, side: pickedSide, distance: best.distance };
    } finally {
      if (swapSide) applyModelUnitVersionSide(beforeLayer, afterLayer, current.activeSide, hidden);
    }
  }

  /**
   * 分屏：指针落在左 A / 右 B 哪一格，就按那一格的视口与宽高比造射线——`renderSplitScene` 每个 pass 正是这样改相机画的，
   * 整幅相机算出的 NDC 在分屏里对不上画面。指针是 CSS px、pass 按 renderer 尺寸算，二者通常相等，按比例换一下防 canvas 被 CSS 缩放。
   * 回 null = 点在两格之外（理论上不会）。
   */
  function splitRay(canvasPos: Vector2, canvas: HTMLCanvasElement, viewer: DtxViewer): SplitCompareRay | null {
    const current = state.value;
    if (!current || current.status !== 'ready') return null;
    const rect = canvas.getBoundingClientRect();
    const size = viewer.renderer.getSize(new Vector2());
    const x = canvasPos.x * (size.x / Math.max(1, rect.width));
    const y = canvasPos.y * (size.y / Math.max(1, rect.height));
    const passes = getModelUnitCompareRenderPasses(current.viewMode, current.activeSide, size.x, size.y);
    const located = locateModelUnitComparePass(passes, x, y, size.y);
    if (!located) return null;
    const camera = viewer.camera;
    const originalAspect = camera.aspect;
    try {
      camera.aspect = located.pass.width / Math.max(1, located.pass.height);
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld(true);
      const raycaster = new Raycaster();
      raycaster.setFromCamera(new Vector2(located.ndcX, located.ndcY), camera);
      return {
        raycaster,
        side: located.pass.side,
        pass: located.pass,
        pos: new Vector2(x, y),
        // pass 的 y 是 WebGL 左下原点，子视口要左上原点
        viewport: { x: located.pass.x, y: size.y - located.pass.y - located.pass.height, width: located.pass.width, height: located.pass.height },
      };
    } finally {
      camera.aspect = originalAspect;
      camera.updateProjectionMatrix();
    }
  }

  /**
   * 点到了 A / B 隔离图层的构件：属性面板钉到**那一版**（`setSelectedRefnoAtVersion`，属性经面板带来的 `attributesAt` 取自那一侧的
   * 版本几何句柄），不查当前会话——当前会话里它可能已经改了、甚至没了。派发方没带 `attributesAt`（旧夹具）就退回普通选中。
   */
  function selectObject(pick: ModelUnitComparePick): void {
    const current = state.value;
    if (!current) return;
    const detail = current.detail;
    const attributesAt = detail.attributesAt;
    if (!attributesAt) {
      host.selection.setSelectedRefno(pick.refno);
      return;
    }
    const sesno = pick.side === 'before' ? detail.before.sesno : detail.after.sesno;
    const label = pick.side === 'before' ? 'A' : 'B';
    host.selection.setSelectedRefnoAtVersion(pick.refno, {
      sesno,
      label,
      load: async () => modelVersionAttributesToUiAttr(pick.refno, await attributesAt(pick.side, pick.refno)),
    });
    const hook = devHook();
    if (hook) {
      hook.lastPick = {
        objectId: pick.objectId, refno: pick.refno, side: pick.side, sesno, label, viewMode: current.viewMode,
      };
    }
  }

  return {
    state,
    statusCounts,
    browse,
    /**
     * 浏览图层是否已建好（`browseEnter` 建图层、`browseExit` 清掉）。
     *
     * `browseEnter` 在视口还没就绪时是**静默返回**的（`host.viewer()` / `host.primaryLayer()`
     * 为 null），这时 `browse.value.active` 仍是 false，后续 `browseShow` 也会因 `!layer` 静默
     * 返回——几何装进了缓存、`frame-shown` 一条都不打。性能脚本靠这条读数区分「几何没装上」
     * 与「图层没建」。
     */
    get browseLayerReady() { return browseLayer !== null; },
    get runId() { return runId; },
    open,
    clear,
    focus,
    setSide,
    setDiffOnly,
    setViewMode,
    refreshEnvironment,
    publishState,
    handleEvent,
    isSplitReady,
    renderSplitScene,
    pickObject,
    splitRay,
    selectObject,
    browseEnter,
    browseShow,
    browsePending,
    browseMissing,
    browseBadge,
    replaceSide,
    browseExit,
    dispose: stopPublish,
  };
}

function computeLayersBoundingBox(layers: DTXLayer[]): Box3 | null {
  const combined = new Box3();
  let hasBox = false;
  for (const layer of layers) {
    const box = layer.getBoundingBox();
    if (!box || box.isEmpty()) continue;
    combined.union(box);
    hasBox = true;
  }
  return hasBox ? combined : null;
}
