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

import type { ExternalDimensionRecord } from '../adapters/normalizeExternalDimensions';
import type { DimensionDocumentState } from '../domain/document';
import type { UserDimensionRecord, Vec3 as DomainVec3 } from '../domain/types';
import type { DimensionFormatPolicy } from '../kernel/format';
import type { LffFont } from '../kernel/glyph/lffParser';
import type { ViewportProjector } from '../kernel/projector';
import type { DimensionTheme } from '../kernel/theme';
import type {
  ExplicitLayoutInput,
  InteractionState,
  LayoutObstacleSource,
  LayoutPrimitive,
  LayoutResult,
  NormalizedDimensionInput,
  ScenePrimitive,
  Vec2,
} from '../kernel/types';
import type { Matrix4, Object3D } from 'three';

export type DimensionFrameBreakdown = Readonly<{
  layoutMs: number;
  paintMs: number;
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
}>;

export type DimensionViewportInput = DimensionViewportBaseInput & Readonly<{
  scene: Object3D;
  requestRender: () => void;
}>;

export class DimensionViewport {
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
  private readonly layoutListeners = new Set<
    (layouts: readonly LayoutResult[]) => void
  >();
  private readonly externalHidden = new Set<string>();
  private layouts: readonly LayoutResult[] = [];
  private hitIndex: HitIndex = buildHitIndex([]);
  private theme: DimensionTheme;
  private format: DimensionFormatPolicy;
  private cameraSettleTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly pendingStyleIds = new Set<string>();
  private disposed = false;

  constructor(private readonly input: DimensionViewportInput) {
    this.theme = input.theme;
    this.format = input.format;
    this.scenePainter = new ThreeSceneDimensionPainter(input.scene, input.font);
    this.scheduler = new DimensionViewportScheduler({
      requestFrame: input.requestFrame,
      cancelFrame: input.cancelFrame,
      onFrame: reasons => this.render(reasons),
    });
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
    this.input.requestRender?.();
    if (this.cameraSettleTimer !== null) {
      clearTimeout(this.cameraSettleTimer);
    }
    this.cameraSettleTimer = setTimeout(() => {
      this.cameraSettleTimer = null;
      this.invalidate('camera');
    }, 80);
  }

  setDesignToWorld(matrix: Matrix4): void {
    this.scenePainter.setDesignToWorld(matrix);
    this.input.requestRender?.();
  }

  setTheme(theme: DimensionTheme): void {
    this.theme = theme;
    this.invalidate('theme');
  }

  setFormat(format: DimensionFormatPolicy): void {
    this.format = format;
    this.invalidate('format');
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
    this.invalidate('interaction');
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
    return this.hitIndex.hitTest(point, tolerancePx);
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
    if (this.cameraSettleTimer !== null) {
      clearTimeout(this.cameraSettleTimer);
      this.cameraSettleTimer = null;
    }
    this.scenePainter.dispose();
    this.layouts = [];
    this.hitIndex = buildHitIndex([]);
    this.normalizedUsers = [];
    this.normalizedExternal = [];
    this.selectionListeners.clear();
    this.layoutListeners.clear();
    this.projector = null;
    this.preview = null;
    this.externalHidden.clear();
    this.pendingStyleIds.clear();
    this.disposed = true;
  }

  private render(reasons: ReadonlySet<DimensionViewportDirtyReason>): void {
    if (!this.projector) return;
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
      if (!this.scenePainter.updateStyles(this.layouts, this.theme, styleIds)) {
        this.scenePainter.paint(this.layouts, this.theme);
      }
      this.input.requestRender?.();
      const completedAt = performance.now();
      this.input.onFrame?.(completedAt - startedAt, {
        layoutMs: 0,
        paintMs: completedAt - startedAt,
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
    }, interactions, { obstacles: this.input.obstacles });
    const layoutCompletedAt = performance.now();
    this.layouts = batch.layouts;
    this.hitIndex = batch.hitIndex;
    this.pendingStyleIds.clear();
    this.scenePainter.paint(this.layouts, this.theme);
    this.input.requestRender();
    const completedAt = performance.now();
    this.input.onFrame?.(completedAt - startedAt, {
      layoutMs: layoutCompletedAt - startedAt,
      paintMs: completedAt - layoutCompletedAt,
    });
    this.layoutListeners.forEach(listener => listener(this.layouts));
  }
}
