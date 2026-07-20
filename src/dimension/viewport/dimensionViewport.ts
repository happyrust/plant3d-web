import { normalizeExternalDimension } from '../adapters/normalizeExternalDimensions';
import { normalizeUserDimension } from '../adapters/normalizeUserDimensions';
import { buildHitIndex, type HitIndex, type HitTarget } from '../kernel/hit/hitIndex';
import { layoutViewport } from '../kernel/viewport/layoutViewport';

import { Canvas2DDimensionPainter } from './canvasPainter';
import {
  DimensionViewportScheduler,
  type DimensionViewportDirtyReason,
} from './invalidation';

import type { ExternalDimensionRecord } from '../adapters/normalizeExternalDimensions';
import type { DimensionDocumentState } from '../domain/document';
import type { UserDimensionRecord, Vec3 as DomainVec3 } from '../domain/types';
import type { DimensionFormatPolicy } from '../kernel/format';
import type { LffFont } from '../kernel/glyph/lffParser';
import type { ViewportProjector } from '../kernel/projector';
import type { DimensionTheme } from '../kernel/theme';
import type {
  HitRegion,
  InteractionState,
  LayoutPrimitive,
  LayoutResult,
  NormalizedDimensionInput,
  Vec2,
} from '../kernel/types';

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

const PROJECTOR_SIGNATURE_POINTS: readonly DomainVec3[] = [
  [0, 0, 0],
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

type ProjectorSignature = Readonly<{
  widthCssPx: number;
  heightCssPx: number;
  dpr: number;
  right: DomainVec3;
  up: DomainVec3;
  forward: DomainVec3;
  samples: readonly Readonly<{
    x: number;
    y: number;
    worldPerPixel: number;
  }>[];
}>;

function projectorSignature(projector: ViewportProjector): ProjectorSignature {
  return {
    widthCssPx: projector.widthCssPx,
    heightCssPx: projector.heightCssPx,
    dpr: projector.dpr,
    right: [...projector.right],
    up: [...projector.up],
    forward: [...projector.forward],
    samples: PROJECTOR_SIGNATURE_POINTS.map((point) => {
      const projected = projector.project(point);
      return {
        x: projected.x,
        y: projected.y,
        worldPerPixel: projector.worldPerPixelAt(point),
      };
    }),
  };
}

function nearlyEqual(a: number, b: number, tolerance = 1e-7): boolean {
  return Number.isFinite(a)
    && Number.isFinite(b)
    && Math.abs(a - b) <= tolerance * Math.max(1, Math.abs(a), Math.abs(b));
}

function translationFromSignature(
  signature: ProjectorSignature,
  projector: ViewportProjector,
): Vec2 | null {
  if (
    signature.widthCssPx !== projector.widthCssPx
    || signature.heightCssPx !== projector.heightCssPx
    || signature.dpr !== projector.dpr
  ) return null;

  const axes = [projector.right, projector.up, projector.forward] as const;
  const previousAxes = [signature.right, signature.up, signature.forward] as const;
  for (let axisIndex = 0; axisIndex < axes.length; axisIndex += 1) {
    for (let component = 0; component < 3; component += 1) {
      if (!nearlyEqual(
        axes[axisIndex][component],
        previousAxes[axisIndex][component],
      )) return null;
    }
  }

  const projected = PROJECTOR_SIGNATURE_POINTS.map((point) => {
    const screen = projector.project(point);
    return {
      x: screen.x,
      y: screen.y,
      worldPerPixel: projector.worldPerPixelAt(point),
    };
  });
  const offset: Vec2 = [
    projected[0].x - signature.samples[0].x,
    projected[0].y - signature.samples[0].y,
  ];
  for (let index = 0; index < projected.length; index += 1) {
    if (
      !nearlyEqual(
        projected[index].x - signature.samples[index].x,
        offset[0],
      )
      || !nearlyEqual(
        projected[index].y - signature.samples[index].y,
        offset[1],
      )
      || !nearlyEqual(
        projected[index].worldPerPixel,
        signature.samples[index].worldPerPixel,
      )
    ) return null;
  }
  return offset;
}

function translateLayout(result: LayoutResult, offset: Vec2): LayoutResult {
  const movePoint = (point: Vec2): Vec2 => [
    point[0] + offset[0],
    point[1] + offset[1],
  ];
  const primitives: LayoutPrimitive[] = result.primitives.map((primitive) => {
    switch (primitive.kind) {
      case 'line':
        return {
          ...primitive,
          from: movePoint(primitive.from),
          to: movePoint(primitive.to),
        };
      case 'path':
        return {
          ...primitive,
          points: primitive.points.map(movePoint),
        };
      case 'marker':
        return {
          ...primitive,
          at: movePoint(primitive.at),
        };
      case 'glyph-run':
        return {
          ...primitive,
          origin: movePoint(primitive.origin),
          bounds: {
            ...primitive.bounds,
            x: primitive.bounds.x + offset[0],
            y: primitive.bounds.y + offset[1],
          },
        };
    }
  });
  const hitRegions: HitRegion[] = result.hitRegions.map((region) => (
    region.kind === 'segment'
      ? {
        ...region,
        from: movePoint(region.from),
        to: movePoint(region.to),
      }
      : {
        ...region,
        rect: {
          ...region.rect,
          x: region.rect.x + offset[0],
          y: region.rect.y + offset[1],
        },
      }
  ));
  return {
    ...result,
    primitives,
    hitRegions,
    labelBounds: {
      ...result.labelBounds,
      x: result.labelBounds.x + offset[0],
      y: result.labelBounds.y + offset[1],
    },
  };
}

export class DimensionViewport {
  private readonly painter: Canvas2DDimensionPainter;
  private readonly scheduler: DimensionViewportScheduler;
  private normalizedUsers: readonly NormalizedDimensionInput[] = [];
  private normalizedExternal: readonly NormalizedDimensionInput[] = [];
  private projector: ViewportProjector | null = null;
  private preview: NormalizedDimensionInput | null = null;
  private selectionId: string | null = null;
  private hoverId: string | null = null;
  private readonly selectionListeners = new Set<
    (dimensionId: string | null) => void
  >();
  private readonly externalHidden = new Set<string>();
  private layouts: readonly LayoutResult[] = [];
  private hitIndex: HitIndex = buildHitIndex([]);
  private layoutOffset: Vec2 = [0, 0];
  private renderedProjectorSignature: ProjectorSignature | null = null;
  private theme: DimensionTheme;
  private format: DimensionFormatPolicy;
  private disposed = false;

  constructor(private readonly input: Readonly<{
    canvas: HTMLCanvasElement;
    font: LffFont;
    theme: DimensionTheme;
    format: DimensionFormatPolicy;
    requestFrame: (callback: FrameRequestCallback) => number;
    cancelFrame: (id: number) => void;
    onFrame?: (durationMs: number, breakdown: DimensionFrameBreakdown) => void;
  }>) {
    this.theme = input.theme;
    this.format = input.format;
    this.painter = new Canvas2DDimensionPainter(input.canvas, input.font);
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
    this.painter.resize(
      projector.widthCssPx,
      projector.heightCssPx,
      projector.dpr,
    );
    if (
      !previous
      || previous.widthCssPx !== projector.widthCssPx
      || previous.heightCssPx !== projector.heightCssPx
    ) {
      this.invalidate('size');
    }
    if (!previous || previous.dpr !== projector.dpr) this.invalidate('dpr');
    this.invalidate('camera');
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

  setHover(id: string | null): void {
    if (this.hoverId === id) return;
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
    return this.hitIndex.hitTest([
      point[0] - this.layoutOffset[0],
      point[1] - this.layoutOffset[1],
    ], tolerancePx);
  }

  getLayouts(): readonly LayoutResult[] {
    if (this.layoutOffset[0] === 0 && this.layoutOffset[1] === 0) {
      return this.layouts;
    }
    return this.layouts.map(layout => translateLayout(layout, this.layoutOffset));
  }

  getCanvas(): HTMLCanvasElement {
    return this.input.canvas;
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
    this.painter.dispose();
    this.layouts = [];
    this.hitIndex = buildHitIndex([]);
    this.layoutOffset = [0, 0];
    this.renderedProjectorSignature = null;
    this.normalizedUsers = [];
    this.normalizedExternal = [];
    this.selectionListeners.clear();
    this.projector = null;
    this.preview = null;
    this.externalHidden.clear();
    this.disposed = true;
  }

  private render(reasons: ReadonlySet<DimensionViewportDirtyReason>): void {
    if (!this.projector) return;
    const startedAt = performance.now();
    if (
      reasons.size === 1
      && reasons.has('camera')
      && this.renderedProjectorSignature
      && this.layouts.length > 0
    ) {
      const offset = translationFromSignature(
        this.renderedProjectorSignature,
        this.projector,
      );
      if (offset) {
        this.layoutOffset = offset;
        const layoutCompletedAt = performance.now();
        this.painter.paint(this.layouts, this.theme, offset);
        const completedAt = performance.now();
        this.input.onFrame?.(completedAt - startedAt, {
          layoutMs: layoutCompletedAt - startedAt,
          paintMs: completedAt - layoutCompletedAt,
        });
        return;
      }
    }

    this.layoutOffset = [0, 0];
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
    }, interactions);
    const layoutCompletedAt = performance.now();
    this.layouts = batch.layouts;
    this.hitIndex = batch.hitIndex;
    this.renderedProjectorSignature = projectorSignature(this.projector);
    this.painter.paint(this.layouts, this.theme);
    const completedAt = performance.now();
    this.input.onFrame?.(completedAt - startedAt, {
      layoutMs: layoutCompletedAt - startedAt,
      paintMs: completedAt - layoutCompletedAt,
    });
  }
}
