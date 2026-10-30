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

function subtract(a: DomainVec3, b: DomainVec3): DomainVec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
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
      this.invalidate('camera');
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
   * 批大小取 `ceil(layouts / 3)`：2k 可见下 paint 约 40 ms，3 批 ≈ 13 ms/帧，
   * 落在计划 §11.3.3 的「首帧 ≤ 16 ms、≤ 6 帧补齐」内。布局很少时退化成
   * 一次写完，不额外引入帧延迟。
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
      this.input.onFrame?.(completedAt - frameStartedAt, {
        layoutMs: layoutCompletedAt - frameStartedAt,
        paintMs: completedAt - layoutCompletedAt,
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
    const batchLayouts = Math.max(1, Math.ceil(layouts.length / 3));
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
