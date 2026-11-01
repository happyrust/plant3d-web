import { Scene } from 'three';

import { normalizeExternalDimension } from '../adapters/normalizeExternalDimensions';
import { normalizeUserDimension } from '../adapters/normalizeUserDimensions';
import { buildHitIndex, type HitIndex, type HitTarget } from '../kernel/hit/hitIndex';
import { resolveDimensionStyleRole } from '../kernel/theme';
import { layoutViewport } from '../kernel/viewport/layoutViewport';

import {
  DimensionViewportScheduler,
  type DimensionViewportDirtyReason,
} from './invalidation';
import { ThreeSceneDimensionPainter } from './scenePainter';

import type { SceneDimensionPaintJob } from './scenePainter';
import type { ExternalDimensionRecord } from '../adapters/normalizeExternalDimensions';
import type { DimensionDocumentState } from '../domain/document';
import type { UserDimensionRecord, Vec3 as DomainVec3 } from '../domain/types';
import type { DimensionFormatPolicy } from '../kernel/format';
import type { LffFont } from '../kernel/glyph/lffParser';
import type { ViewportProjector } from '../kernel/projector';
import type { DimensionTheme } from '../kernel/theme';
import type {
  DimensionDisplayMode,
  ExplicitLayoutInput,
  InteractionState,
  LayoutObstacleSource,
  LayoutPrimitive,
  LayoutResult,
  NormalizedDimensionInput,
  OcclusionSource,
  ScenePrimitive,
  Vec2,
} from '../kernel/types';
import type { Camera, Matrix4, WebGLRenderer } from 'three';

/**
 * 一帧的来源（W4-1 口径）：`layout` = 跑了全量 `layoutViewport` + `scenePainter.paint`；
 * `style` = 只改交互样式的增量帧（`updateStyles`，必要时退回整幅 paint）；`camera` = 仅相机
 * 失效且 projector 未换，布局与画面都没动，只补一次 `requestRender()`。
 */
export type DimensionFrameKind = 'layout' | 'style' | 'camera';

/**
 * `onFrame` 的分解。三种 `kind` 都满足 `layoutMs + paintMs === 整帧`，但 `paintMs` 的含义
 * 随 `kind` 变：`layout` 帧是 `scenePainter.paint` 本身；`style` / `camera` 帧是整帧（后者
 * 根本没画）。要比画家成本只看 `kind === 'layout'`；要数全量布局帧按 `kind` 判，不要按
 * `layoutMs > 0`（极快的全量帧会测得 0）。`kind` 可选只为兑容只传两个耗时的调用方；
 * 视口自己总是写。
 */
export type DimensionFrameBreakdown = Readonly<{
  layoutMs: number;
  paintMs: number;
  kind?: DimensionFrameKind;
}>;

/**
 * 相机连续运动时的重排节流下限（W4-1）。绕轨脚本每帧都调
 * `notifyViewerChanged()`，若每次相机变化都全量重排，一帧都排不完；若只等
 * 静止 80 ms，运动中一次都不重排，标签就按旧投影摆放、帧耗时也完全不可观测。
 */
const CAMERA_MOTION_LAYOUT_INTERVAL_MS = 100;

function subtract(a: DomainVec3, b: DomainVec3): DomainVec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

/**
 * 每帧愿意花在线顶点写入上的段数预算（§11.17）。
 *
 * 实测（热缓存、1920×1080 dpr2、Ryzen 9 7950X）单段约 **0.34 µs**，所以
 * 47 000 段 ≈ 16 ms，正好一个 60 fps 帧。取 40 000 留出余量给同帧的布局、
 * 三角与填充通道。
 *
 * 这是**算法结构**而不是可调参数：它由「一帧 16 ms」与「单段 0.34 µs」两个
 * 事实决定，换机器会变的是那个 µs 数，不是这里的分母。真要按机器自适应，
 * 得在运行时量 `advance()` 的实测耗时做闭环，那是另一条活（§11.17 末尾）。
 */
const SEGMENT_BUDGET_PER_FRAME = 40_000;

/**
 * 按段数预算决定每帧写多少条布局（§11.17）。
 *
 * 为什么不用记录数：19 206 条记录里每条段数从 0 到 371 不等，98 % 的段来自
 * 字形 run。按记录数切批会让「一批」的成本相差三个数量级——`ceil(n/3)` 在
 * 310 BRAN 上量到单批 153 ms，按段预算切则是 15 ms。
 *
 * 一条记录都不写会让 `advance` 永远推进不了，所以至少 1 条。总段数在预算内
 * 时一次写完（`layouts.length`），不额外引入帧延迟。
 */
function batchLayoutsFor(
  painter: Readonly<{ segmentCounts: (layouts: readonly LayoutResult[]) => readonly number[] }>,
  layouts: readonly LayoutResult[],
  segmentBudget: number,
): number {
  if (layouts.length <= 1) return Math.max(1, layouts.length);
  const counts = painter.segmentCounts(layouts);
  let budget = 0;
  let used = 0;
  for (const count of counts) {
    if (budget > 0 && used + count > segmentBudget) break;
    used += count;
    budget += 1;
  }
  // 单条记录的段数就可能超过整帧预算（371 段/条的上限还远低于 4 万，但
  // 极端合成场景可以更大）：那种情况也要写它，否则永远推进不了。
  return Math.max(1, budget);
}

function addScaled(
  origin: DomainVec3,
  direction: DomainVec3,
  scale: number,
): DomainVec3 {
  return [
    origin[0] + direction[0] * scale,
    origin[1] + direction[1] * scale,
    origin[2] + direction[2] * scale,
  ];
}

function dot(a: DomainVec3, b: DomainVec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function length(vector: DomainVec3): number {
  return Math.sqrt(dot(vector, vector));
}

function axisVector(record: Extract<
  UserDimensionRecord,
  { kind: 'projected' }
>): DomainVec3 {
  if (record.axis.kind === 'semantic-direction') return record.axis.snapshot;
  if (record.axis.axis === 'x') return [1, 0, 0];
  if (record.axis.axis === 'y') return [0, 1, 0];
  return [0, 0, 1];
}

function restyleLayout(
  result: LayoutResult,
  styleRole: string,
): LayoutResult {
  const restyle = <T extends Readonly<{ styleRole: string }>>(
    primitive: T,
  ): T => ({ ...primitive, styleRole }) as T;
  return {
    ...result,
    scenePrimitives: result.scenePrimitives.map(
      primitive => restyle(primitive) as ScenePrimitive,
    ),
    primitives: result.primitives.map(
      primitive => restyle(primitive) as LayoutPrimitive,
    ),
  };
}

type DimensionViewportBaseInput = Readonly<{
  font: LffFont;
  theme: DimensionTheme;
  format: DimensionFormatPolicy;
  requestFrame: (callback: FrameRequestCallback) => number;
  cancelFrame: (id: number) => void;
  onFrame?: (durationMs: number, breakdown: DimensionFrameBreakdown) => void;
  /** Model component boxes billboard tags keep clear of; omitted = none known. */
  obstacles?: LayoutObstacleSource;
  /**
   * Ray-cast seam for the inspection display mode; omitted = inspection
   * fades nothing (every record paints at its visible alpha).
   */
  occlusion?: OcclusionSource;
  /**
   * 每帧写多少段的预算（§11.17）。缺省 `SEGMENT_BUDGET_PER_FRAME`。
   *
   * 生产上不该改：它由「一帧 16 ms」与「单段 0.34 µs」两个事实决定。留这个
   * 口子是给测试显式钉住分帧契约——测试构造的文档只有十几条记录、总段数远
   * 小于真实预算，按真实预算会一批写完，那三条「必须跨帧」的用例就测不到
   * 它们要测的东西了。
   */
  segmentBudgetPerFrame?: number;
  /**
   * 相机连续运动时两次**全量重排**之间的最小间隔（W4-1）。缺省
   * `CAMERA_MOTION_LAYOUT_INTERVAL_MS`。
   *
   * 真实间隔取 `max(本值, 上次全量布局成本 × 2)`：固定间隔在重场景下会让每
   * 次重排都被下一次相机变化顶掉，分帧永远写不完、画面停在旧内容上。留这个
   * 口子是给测试显式钉住节流契约，生产上不该改。
   */
  cameraMotionLayoutIntervalMs?: number;
}>;

export type DimensionViewportInput = DimensionViewportBaseInput & Readonly<{
  requestRender: () => void;
}>;

export class DimensionViewport {
  /**
   * The overlay's own scene. It is not part of the host scene graph: the
   * host draws it with `renderOverlay` after its frame (ADR 0064).
   */
  readonly overlayScene = new Scene();
  private readonly scenePainter: ThreeSceneDimensionPainter;
  private readonly scheduler: DimensionViewportScheduler;
  private normalizedUsers: readonly NormalizedDimensionInput[] = [];
  private normalizedExternal: readonly (
    | NormalizedDimensionInput
    | ExplicitLayoutInput
  )[] = [];
  private projector: ViewportProjector | null = null;
  private preview: NormalizedDimensionInput | null = null;
  private selectionId: string | null = null;
  private hoverId: string | null = null;
  private readonly selectionListeners = new Set<
    (dimensionId: string | null) => void
  >();
  private readonly hoverListeners = new Set<
    (dimensionId: string | null) => void
  >();
  private readonly layoutListeners = new Set<
    (layouts: readonly LayoutResult[]) => void
  >();
  private readonly externalHidden = new Set<string>();
  private layouts: readonly LayoutResult[] = [];
  /**
   * 命中索引必须跟**已画出的那一帧**同步（W5-5）。分帧期间 `layouts` 已经是
   * 新布局，像素却还是上一次的；此时按新索引回答命中，用户点到的是屏幕上
   * 根本还没出现的图元。所以新索引先放 `pendingHitIndex`，等 `job.finish()`
   * 发布几何时才提升为 `paintedHitIndex`。
   */
  private paintedHitIndex: HitIndex = buildHitIndex([]);
  private pendingHitIndex: HitIndex = buildHitIndex([]);
  // 上一次真正跑 layoutViewport 时使用的 projector；projector 在构造时
  // 快照了相机与 designToWorld，实例相同即投影未变，纯 camera 失效可复用布局。
  private lastLayoutProjector: ViewportProjector | null = null;
  private theme: DimensionTheme;
  private format: DimensionFormatPolicy;
  private displayMode: DimensionDisplayMode = 'engineering';
  private cameraSettleTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * 上一次全量布局的完成时刻与实测成本（W4-1）。`setProjector` 用它们决定
   * 这次相机变化是「重排」还是「只重绘」，成本取 `layoutMs + paintMs`（分帧
   * 时是全部批次的总耗时，见 `startBatchedPaint` 的 `report`）。
   */
  private lastFullLayoutAtMs = 0;
  private lastFullLayoutCostMs = 0;
  /**
   * 上一次**放行**全量布局的时刻（W4-1）。节流判据必须用它，不能用
   * `lastFullLayoutAtMs`：后者要等布局真正跑完（一帧 rAF + 布局 + 绘制，真实
   * 房间 20～30 ms）才更新，而这段时间里 `setProjector` 会被再调一次——那时
   * 「距上次完成」已超过间隔，判据重复放行，实际重排频率比下限高约 20 %
   * （实测 600 帧放行 120 次，而 100 ms 下限只允许约 100 次）。
   *
   * 记录**放行**时刻就没有这个窗口：放行即占位，下一次必须等满间隔。
   */
  private lastCameraLayoutGrantedAtMs = 0;
  private readonly pendingStyleIds = new Set<string>();
  /**
   * 分帧 paint 进行中（W5-5）。为真时几何只写了一半，**任何一帧都不能渲染**
   * ——否则会画出只画了一部分的尺寸线。见 `render()` 入口的早退与计划 §11.3.5。
   */
  private painting = false;
  private paintFrameId: number | null = null;
  /**
   * 在飞的分帧作业（W5-5）。留着它是为了让宿主提前要求渲染时能把剩余批次
   * 一次写完（`finishBatchedPaintNow`），而不是画出写了一半的几何。
   */
  private pendingPaint: Readonly<{
    job: SceneDimensionPaintJob;
    batchLayouts: number;
    finish: () => void;
  }> | null = null;
  /**
   * 分帧期间到达的失效原因（W5-5）。scheduler 已经把原因 `consume()` 掉了，
   * `render()` 早退时若不收下就永久丢失，分帧结束后会停在旧内容上。收尾时
   * 逐个 `invalidate()` 放回，让它们真正生效。
   */
  private readonly deferredReasons = new Set<DimensionViewportDirtyReason>();
  private disposed = false;

  constructor(private readonly input: DimensionViewportInput) {
    this.theme = input.theme;
    this.format = input.format;
    this.overlayScene.name = 'dimension-overlay-scene';
    this.scenePainter = new ThreeSceneDimensionPainter(this.overlayScene, input.font);
    this.scheduler = new DimensionViewportScheduler({
      requestFrame: input.requestFrame,
      cancelFrame: input.cancelFrame,
      onFrame: reasons => this.render(reasons),
    });
  }

  /**
   * Draws the dimension overlay over the frame the host has just rendered
   * — after its post-processing (outline, FXAA, tone mapping, sRGB output)
   * — with the same camera (ADR 0064). Nothing of the frame is cleared;
   * only the depth buffer is, which the stroke passes use to paint every
   * pixel once (ADR 0062) and which no model depth must reach. The renderer
   * is left as it was found.
   */
  renderOverlay(renderer: WebGLRenderer, camera: Camera): void {
    if (this.disposed) return;
    // 分帧写入中，宿主却要渲染这一帧（`ViewerPanel.vue:3301/3304` 与 `:3394/3397`
    // 四处都无条件调本方法）——多半是相机在动。此时几何只写了一半：`paintAsync`
    // 起手无条件把线缓冲的 `drawRange` 归零（容量增长时换上的新 `BufferGeometry`
    // 本来就是空的；容量不变时若不清零，`drawRange` 仍指向上一次 `finish()`
    // 发布的索引数，而顶点缓冲已被本批从头部覆写——那样画出的是「新前缀 +
    // 旧尾巴」的混合顶点，归零正是为了杜绝它），三角形/填充缓冲在 `finish()`
    // 之前则仍发布着上一帧。两种情况都不能上屏：一个整层空白，一个是错的。
    //
    // 直接 `return` 不行：宿主这帧已经重绘了主场景，尺寸层这个 pass 不执行就是
    // **整层消失**（空白闪烁），比半成品更刺眼。所以把剩下的批次一次写完再画，
    // 代价只是这一次分帧退化成同步（只有用户在分帧窗口内动了相机才会走到）。
    if (this.painting) this.finishBatchedPaintNow();
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    try {
      renderer.clearDepth();
      renderer.render(this.overlayScene, camera);
    } finally {
      renderer.autoClear = autoClear;
    }
  }

  setDocument(state: DimensionDocumentState): void {
    this.normalizedUsers = state.records
      .map(normalizeUserDimension)
      .filter((record): record is NormalizedDimensionInput => record !== null);
    this.invalidate('document');
  }

  setExternalDimensions(records: readonly ExternalDimensionRecord[]): void {
    this.normalizedExternal = records.map(normalizeExternalDimension);
    this.invalidate('external');
  }

  setProjector(projector: ViewportProjector): void {
    const previous = this.projector;
    this.projector = projector;
    this.scenePainter.resize(
      projector.widthCssPx,
      projector.heightCssPx,
      projector.dpr,
    );
    const sizeChanged = (
      !previous
      || previous.widthCssPx !== projector.widthCssPx
      || previous.heightCssPx !== projector.heightCssPx
    );
    if (sizeChanged) this.invalidate('size');
    if (!previous || previous.dpr !== projector.dpr) this.invalidate('dpr');

    if (
      !previous
      || sizeChanged
      || this.layouts.length === 0
    ) {
      this.grantCameraLayout();
      return;
    }
    // 相机连续运动（绕轨、拖拽、飞行动画）时，不是每次变化都值得全量重排：
    // 重排一次的成本在真实房间里能到几百毫秒，每帧都排就一帧也排不完，画面
    // 反而停在旧内容上。但也不能像旧实现那样只等静止——那样运动中标签一直
    // 按旧投影摆放，帧耗时也完全不可观测。折中：按实测成本降频。
    //
    // 间隔取 `max(下限, 上次成本 × 2)`：保证一次重排至少占有它自己耗时两倍
    // 的时间窗口，成本高的场景自动降到接近「只在静止时重排」。分帧进行中不
    // 打断——`render()` 会把这条 `camera` 收进 `deferredReasons`，收尾时重放。
    const intervalMs = Math.max(
      this.input.cameraMotionLayoutIntervalMs ?? CAMERA_MOTION_LAYOUT_INTERVAL_MS,
      this.lastFullLayoutCostMs * 2,
    );
    if (performance.now() - this.lastCameraLayoutGrantedAtMs >= intervalMs) {
      this.grantCameraLayout();
      return;
    }
    this.requestRenderWhenPainted();
    if (this.cameraSettleTimer !== null) {
      clearTimeout(this.cameraSettleTimer);
    }
    this.cameraSettleTimer = setTimeout(() => {
      this.cameraSettleTimer = null;
      this.invalidate('camera');
    }, 80);
  }

  /**
   * 放行一次全量布局：记下放行时刻（节流判据的基准，见
   * `lastCameraLayoutGrantedAtMs`）、清掉静止兜底定时器，然后失效。
   */
  private grantCameraLayout(): void {
    this.lastCameraLayoutGrantedAtMs = performance.now();
    if (this.cameraSettleTimer !== null) {
      clearTimeout(this.cameraSettleTimer);
      this.cameraSettleTimer = null;
    }
    this.invalidate('camera');
  }

  /**
   * 请求重绘，但**分帧写入期间一律不发**（W5-5）：那时几何只写了一半，
   * 任何一帧都会画出半成品。分帧收尾时会自己发一次，所以这里丢掉不会
   * 造成画面停在旧内容上。
   */
  private requestRenderWhenPainted(): void {
    if (this.painting) return;
    this.input.requestRender?.();
  }

  setDesignToWorld(matrix: Matrix4): void {
    this.scenePainter.setDesignToWorld(matrix);
    this.requestRenderWhenPainted();
  }

  setTheme(theme: DimensionTheme): void {
    this.theme = theme;
    this.invalidate('theme');
  }

  setFormat(format: DimensionFormatPolicy): void {
    this.format = format;
    this.invalidate('format');
  }

  /**
   * Engineering (default) paints every dimension in full; inspection runs
   * the occlusion pass on the next full layout and fades the records that
   * sit behind model geometry (S4, 2026-09-13). Switching re-lays out, so
   * the flags always belong to the current camera.
   */
  setDisplayMode(mode: DimensionDisplayMode): void {
    if (this.displayMode === mode) return;
    this.displayMode = mode;
    this.invalidate('display-mode');
  }

  getDisplayMode(): DimensionDisplayMode {
    return this.displayMode;
  }

  setSelection(id: string | null): void {
    if (this.selectionId === id) return;
    if (this.selectionId) this.pendingStyleIds.add(this.selectionId);
    if (id) this.pendingStyleIds.add(id);
    this.selectionId = id;
    this.selectionListeners.forEach(listener => listener(id));
    this.invalidate('interaction');
  }

  getSelection(): string | null {
    return this.selectionId;
  }

  subscribeSelection(
    listener: (dimensionId: string | null) => void,
  ): () => void {
    this.selectionListeners.add(listener);
    return () => this.selectionListeners.delete(listener);
  }

  /**
   * Fires after every full re-layout (camera, document, external source,
   * theme…) with the new `getLayouts()` batch — the seam UI uses to read
   * per-frame outcomes such as `derived.lodHidden`. Style-only restyles do
   * not fire; they never change what a layout contains.
   */
  subscribeLayouts(
    listener: (layouts: readonly LayoutResult[]) => void,
  ): () => void {
    this.layoutListeners.add(listener);
    return () => this.layoutListeners.delete(listener);
  }

  setHover(id: string | null): void {
    if (this.hoverId === id) return;
    if (this.hoverId) this.pendingStyleIds.add(this.hoverId);
    if (id) this.pendingStyleIds.add(id);
    this.hoverId = id;
    this.hoverListeners.forEach(listener => listener(id));
    this.invalidate('interaction');
  }

  getHover(): string | null {
    return this.hoverId;
  }

  subscribeHover(
    listener: (dimensionId: string | null) => void,
  ): () => void {
    this.hoverListeners.add(listener);
    return () => this.hoverListeners.delete(listener);
  }

  setPreview(input: NormalizedDimensionInput | null): void {
    this.preview = input;
    this.invalidate('preview');
  }

  setExternalHidden(id: string, hidden: boolean): void {
    const changed = hidden
      ? !this.externalHidden.has(id)
      : this.externalHidden.has(id);
    if (!changed) return;
    if (hidden) this.externalHidden.add(id);
    else this.externalHidden.delete(id);
    this.invalidate('external');
  }

  isExternalHidden(id: string): boolean {
    return this.externalHidden.has(id);
  }

  invalidate(reason: DimensionViewportDirtyReason): void {
    if (this.disposed) return;
    this.scheduler.invalidate(reason);
  }

  hitTest(point: Vec2, tolerancePx: number): HitTarget | null {
    return this.paintedHitIndex.hitTest(point, tolerancePx);
  }

  getLayouts(): readonly LayoutResult[] {
    return this.layouts;
  }

  getCanvas(): HTMLCanvasElement | null {
    return null;
  }

  flushProjection(): void {
    if (!this.projector || this.disposed) return;
    if (this.cameraSettleTimer !== null) {
      clearTimeout(this.cameraSettleTimer);
      this.cameraSettleTimer = null;
    }
    // 强制通道也算一次放行（W4-1）：调用方（指针按下、基线采集）要的是「就按
    // 当前投影同步一次」，紧接着的相机变化不该立刻再排一次。
    this.lastCameraLayoutGrantedAtMs = performance.now();
    this.render(new Set(['camera']));
  }

  placementAtScreen(
    record: UserDimensionRecord,
    screen: Readonly<{ x: number; y: number }>,
  ): UserDimensionRecord['placement'] | null {
    const projector = this.projector;
    if (!projector) return null;

    if (record.kind === 'linear' || record.kind === 'projected') {
      const a = record.a.snapshot;
      const b = record.b.snapshot;
      if (!a || !b) return null;
      const baselineA = a;
      let baselineB = b;
      if (record.kind === 'projected') {
        const rawAxis = axisVector(record);
        const axisLength = length(rawAxis);
        if (axisLength <= 1e-12) return null;
        const axis: DomainVec3 = [
          rawAxis[0] / axisLength,
          rawAxis[1] / axisLength,
          rawAxis[2] / axisLength,
        ];
        baselineB = addScaled(a, axis, dot(subtract(b, a), axis));
      }
      const projectedA = projector.project(baselineA);
      const projectedB = projector.project(baselineB);
      const dx = projectedB.x - projectedA.x;
      const dy = projectedB.y - projectedA.y;
      const lineLengthSq = dx * dx + dy * dy;
      if (lineLengthSq <= 1e-9) return null;
      const cursorX = screen.x - projectedA.x;
      const cursorY = screen.y - projectedA.y;
      const labelT = (cursorX * dx + cursorY * dy) / lineLengthSq;
      const signedDistancePx =
        (dx * cursorY - dy * cursorX) / Math.sqrt(lineLengthSq);
      const midpoint: DomainVec3 = [
        (baselineA[0] + baselineB[0]) / 2,
        (baselineA[1] + baselineB[1]) / 2,
        (baselineA[2] + baselineB[2]) / 2,
      ];
      return {
        offsetM: Math.abs(signedDistancePx)
          * projector.worldPerPixelAt(midpoint),
        labelT,
        side: signedDistancePx >= 0 ? 1 : -1,
      };
    }

    if (record.kind === 'angular') {
      const vertex = record.vertex.snapshot;
      if (!vertex) return null;
      const projected = projector.project(vertex);
      const distancePx = Math.hypot(
        screen.x - projected.x,
        screen.y - projected.y,
      );
      return {
        ...record.placement,
        radiusM: distancePx * projector.worldPerPixelAt(vertex),
      };
    }

    const center = record.center.snapshot;
    const rim = record.rim.snapshot;
    if (!center || !rim) return null;
    const centerScreen = projector.project(center);
    const label = projector.unproject({
      x: screen.x,
      y: screen.y,
      depth: centerScreen.depth,
    });
    const leaderDirection = subtract(label, center);
    const leaderLength = length(leaderDirection);
    if (leaderLength <= 1e-12) return null;
    return {
      leaderDirection,
      labelDistanceM: Math.max(0, leaderLength - length(subtract(rim, center))),
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.scheduler.dispose();
    if (this.paintFrameId !== null) {
      this.input.cancelFrame(this.paintFrameId);
      this.paintFrameId = null;
    }
    this.painting = false;
    this.pendingPaint = null;
    this.deferredReasons.clear();
    if (this.cameraSettleTimer !== null) {
      clearTimeout(this.cameraSettleTimer);
      this.cameraSettleTimer = null;
    }
    this.scenePainter.dispose();
    this.layouts = [];
    this.paintedHitIndex = buildHitIndex([]);
    this.pendingHitIndex = buildHitIndex([]);
    this.normalizedUsers = [];
    this.normalizedExternal = [];
    this.selectionListeners.clear();
    this.hoverListeners.clear();
    this.layoutListeners.clear();
    this.projector = null;
    this.lastLayoutProjector = null;
    this.lastFullLayoutAtMs = 0;
    this.lastFullLayoutCostMs = 0;
    this.lastCameraLayoutGrantedAtMs = 0;
    this.preview = null;
    this.externalHidden.clear();
    this.pendingStyleIds.clear();
    this.disposed = true;
  }

  private render(reasons: ReadonlySet<DimensionViewportDirtyReason>): void {
    if (!this.projector) return;
    // 分帧写入中：几何只写了一半，这一帧不能动（W5-5）。但 scheduler 已经把
    // 这批失效原因 `consume()` 掉了，直接返回就等于丢掉它们——分帧结束后
    // 画面会停在旧内容上。所以先把原因存下来，收尾时重新放回队列。
    if (this.painting) {
      for (const reason of reasons) this.deferredReasons.add(reason);
      return;
    }
    const startedAt = performance.now();
    if (
      this.scenePainter
      && reasons.size === 1
      && reasons.has('interaction')
      && this.pendingStyleIds.size > 0
      && this.layouts.length > 0
    ) {
      const inputById = new Map(
        [
          ...this.normalizedUsers,
          ...this.normalizedExternal,
          ...(this.preview ? [this.preview] : []),
        ].map(input => [input.id, input] as const),
      );
      this.layouts = this.layouts.map((layout) => {
        if (!this.pendingStyleIds.has(layout.dimensionId)) return layout;
        const source = inputById.get(layout.dimensionId);
        if (!source) return layout;
        const interaction: InteractionState =
          layout.dimensionId === this.selectionId
            ? 'selected'
            : layout.dimensionId === this.hoverId
              ? 'hovered'
              : 'normal';
        return restyleLayout(
          layout,
          resolveDimensionStyleRole(source.role, interaction),
        );
      });
      const styleIds = new Set(this.pendingStyleIds);
      this.pendingStyleIds.clear();
      if (!this.scenePainter.updateStyles(
        this.layouts,
        this.theme,
        styleIds,
        this.displayMode,
      )) {
        this.scenePainter.paint(this.layouts, this.theme, this.displayMode);
      }
      this.input.requestRender?.();
      const completedAt = performance.now();
      this.input.onFrame?.(completedAt - startedAt, {
        layoutMs: 0,
        paintMs: completedAt - startedAt,
        kind: 'style',
      });
      return;
    }
    // 仅 'camera' 失效且 projector 实例未变（如纯指针按下触发的
    // flushProjection）时，布局结果必然与上次全量一致：跳过 layoutViewport，
    // 已绘制内容与当前 layouts/theme/displayMode 也保持一致，无需重绘，
    // 只补一次重绘请求并按增量分支同样的方式上报帧耗（`kind: 'camera'` 标明这帧没画）。
    if (
      reasons.size === 1
      && reasons.has('camera')
      && this.lastLayoutProjector === this.projector
      && this.layouts.length > 0
    ) {
      this.input.requestRender?.();
      const completedAt = performance.now();
      this.input.onFrame?.(completedAt - startedAt, {
        layoutMs: 0,
        paintMs: completedAt - startedAt,
        kind: 'camera',
      });
      return;
    }
    const inputs = [
      ...this.normalizedUsers,
      ...this.normalizedExternal.filter(
        record => !this.externalHidden.has(record.id),
      ),
      ...(this.preview ? [this.preview] : []),
    ];
    const interactions = new Map<string, InteractionState>();
    if (this.hoverId) interactions.set(this.hoverId, 'hovered');
    if (this.selectionId) interactions.set(this.selectionId, 'selected');

    const batch = layoutViewport(inputs, {
      projector: this.projector,
      font: this.input.font,
      theme: this.theme,
      format: this.format,
    }, interactions, {
      obstacles: this.input.obstacles,
      occlusion: this.input.occlusion,
      displayMode: this.displayMode,
    });
    const layoutCompletedAt = performance.now();
    this.layouts = batch.layouts;
    this.lastLayoutProjector = this.projector;
    this.pendingHitIndex = batch.hitIndex;
    this.pendingStyleIds.clear();
    this.startBatchedPaint(startedAt, layoutCompletedAt);
    this.layoutListeners.forEach(listener => listener(this.layouts));
  }

  /**
   * 把这一批布局的绘制拆到若干帧（W5-5）。每帧写一批线顶点，写完才
   * `finish()` 发布几何并 `requestRender()`；期间 `painting` 为真，`render()`
   * 直接早退，所以不会有半成品上屏。
   *
   * 批大小按**段数预算**算，不按记录数（§11.17）。旧实现取 `ceil(layouts / 3)`，
   * 那个常数是在「2k 记录」口径下试出来的；真实房间里有 MBD 的 BRAN 数中位数
   * 19、p90 66、最大 310，310 个 BRAN 展开成 19 206 条记录 / 133 万段，按
   * `ceil(n/3)` 切是每批 6 402 条 / 单批 153 ms——三帧不但没摊平，反而每帧都
   * 卡 10 个刷新周期。
   *
   * 记录数不是成本单位：同一批 19 206 条记录里，每条段数从 0 到 371 不等，
   * 98 % 的段来自字形 run。实测（热缓存、1920×1080 dpr2、Ryzen 9 7950X）单批
   * 耗时与段数成正比，约 0.34 µs/段，所以按 `SEGMENT_BUDGET_PER_FRAME` 切能把
   * 单批压在 16 ms 内，与记录数无关。
   *
   * 布局很少时退化成一次写完，不额外引入帧延迟。
   *
   * `onFrame` 在**最后一批写完后**才上报，`paintMs` 是首帧起点到最后一批的
   * 总耗时——不是第一批的耗时。分帧把成本摊到多帧，但 W4-1 的 recorder 要的
   * 是「这次全量绘制总共花了多少」，报第一批会让基线低估数倍。
   */
  private startBatchedPaint(frameStartedAt: number, layoutCompletedAt: number): void {
    // 上一次分帧还没写完就又来了新布局：旧作业必须作废，否则两批会交错
    // 写同一块缓冲，顶点顺序就乱了。取消不动已发布几何，所以安全。
    if (this.paintFrameId !== null) {
      this.input.cancelFrame(this.paintFrameId);
      this.paintFrameId = null;
    }
    // cancelFrame 未必拦得住已入队的旧回调（宿主可能是 rAF + 已入队）；
    // 把旧作业本身作废，它的 advance/finish 从此是 no-op，跑进来也写不
    // 进新作业的缓冲。必须在 pendingPaint 置空前拿到旧作业。
    this.pendingPaint?.job.cancel();
    this.painting = false;
    this.pendingPaint = null;
    // 旧作业作废时它攒下的失效原因不必重放：本次调用本身就是一次新的全量
    // 布局，那些原因已被满足。
    this.deferredReasons.clear();
    const layouts = this.layouts;
    const job = this.scenePainter.paintAsync(
      layouts,
      this.theme,
      this.displayMode,
    );
    const report = (): void => {
      const completedAt = performance.now();
      const layoutMs = layoutCompletedAt - frameStartedAt;
      const paintMs = completedAt - layoutCompletedAt;
      // 节流判据（W4-1）的输入：这次全量布局真正花了多少。分帧时 `paintMs`
      // 是全部批次的总耗时，所以 19 206 条记录的场景报的是 ≈540 ms 而不是
      // 第一批的 16 ms——间隔才会按真实成本放大。
      this.lastFullLayoutAtMs = completedAt;
      this.lastFullLayoutCostMs = layoutMs + paintMs;
      this.input.onFrame?.(completedAt - frameStartedAt, {
        layoutMs,
        paintMs,
        kind: 'layout',
      });
    };
    if (job.remaining() === 0) {
      job.finish();
      this.paintedHitIndex = this.pendingHitIndex;
      this.input.requestRender();
      report();
      return;
    }
    const batchLayouts = batchLayoutsFor(
      this.scenePainter,
      layouts,
      this.input.segmentBudgetPerFrame ?? SEGMENT_BUDGET_PER_FRAME,
    );
    this.painting = true;
    const finish = (): void => {
      job.finish();
      this.painting = false;
      this.pendingPaint = null;
      // 几何已经全部发布，命中索引此刻才跟上——分帧中途 hitTest 仍按旧索引
      // 回答，和屏幕上的像素一致。
      this.paintedHitIndex = this.pendingHitIndex;
      this.replayDeferredReasons();
      this.input.requestRender();
      report();
    };
    this.pendingPaint = { job, batchLayouts, finish };
    const step = (): void => {
      // 旧作业被顶替后，它已入队的回调仍可能跑到：那种回调不得把新作业
      // 刚登记的帧 id 抹掉，也不得继续推进旧作业的写入进度。
      if (this.pendingPaint?.job !== job) return;
      this.paintFrameId = null;
      if (this.disposed) return;
      let done = false;
      try {
        done = job.advance(batchLayouts);
      } catch (error) {
        // advance 抛出时若什么都不做，paintFrameId 已空而 painting 停在
        // true：render() 永远早退、renderOverlay 每帧重抛，尺寸层永久冻结。
        // 作废作业、复位状态机、重放攒下的失效原因并请求重绘；异常本身不
        // 吞（留一条带上下文的日志），也不向上抛——宿主的 rAF 回调每帧
        // 抛一次会让整个 viewer 停摆。
        console.error(
          `[DimensionViewport] batched paint advance() threw; abandoning job (${layouts.length} layouts)`,
          error,
        );
        job.cancel();
        this.painting = false;
        this.pendingPaint = null;
        this.replayDeferredReasons();
        this.input.requestRender();
        return;
      }
      if (!done) {
        this.paintFrameId = this.input.requestFrame(step);
        return;
      }
      finish();
    };
    this.paintFrameId = this.input.requestFrame(step);
  }

  /**
   * 宿主在分帧窗口内要求渲染：把剩下的批次一次写完再画（W5-5）。
   *
   * 触发路径是相机在动——`ViewerPanel.vue:3301/3304` 与 `:3394/3397` 的四处
   * `renderDimensionOverlay` 都在宿主帧之后无条件执行。若此时直接跳过尺寸层，
   * 那一帧就是整层消失；若照旧画，画出的是写了一半的顶点（`paintAsync` 起手
   * 已把 `drawRange` 归零）。两个都不能接受，所以退化成同步：这一次多花一帧的
   * 时间，画面与几何始终一致。
   *
   * 只影响「用户在分帧的 1～2 帧窗口里动了相机」这一种情况；正常浏览时
   * `advance()` 早已把队列排空，走不到这里。
   */
  private finishBatchedPaintNow(): void {
    const pending = this.pendingPaint;
    if (!pending) {
      // 没有作业却在 painting：作业刚被新布局取消，几何已归新布局管，不必
      // 补救；但攒下的失效原因不能跟着丢，也没人替这一帧请求重绘。
      this.painting = false;
      this.replayDeferredReasons();
      this.input.requestRender();
      return;
    }
    if (this.paintFrameId !== null) {
      this.input.cancelFrame(this.paintFrameId);
      this.paintFrameId = null;
    }
    while (!pending.job.advance(pending.batchLayouts)) {
      // 一次写完，不再让出帧。
    }
    pending.finish();
  }

  /**
   * 分帧收尾：把期间到达的失效原因放回 scheduler，让它们真正重跑一次布局
   * （W5-5）。没有它们，分帧期间改主题 / 换文档 / 动相机都会静默丢失。
   */
  private replayDeferredReasons(): void {
    if (this.deferredReasons.size === 0) return;
    const reasons = [...this.deferredReasons];
    this.deferredReasons.clear();
    for (const reason of reasons) this.invalidate(reason);
  }
}
