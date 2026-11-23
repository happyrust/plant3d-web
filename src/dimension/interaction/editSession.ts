import { normalizeUserDimension } from '../adapters/normalizeUserDimensions';
import { deriveAngularPlane } from '../domain/angularPlane';
import { projectionAxisVector, unitVec3 } from '../domain/directions';
import { dimensionRecordHasResolvedGeometry } from '../domain/invariants';
import { validateDimensionRecord } from '../domain/validation';

import type {
  DimensionActor,
  DimensionCommand,
} from '../domain/commands';
import type {
  AngularPlacementIntent,
  AngularPlane,
  DimensionAnchor,
  DimensionDirections,
  DimensionKind,
  LinearPlacementIntent,
  ProjectionAxisRef,
  RadialPlacementIntent,
  SemanticAnchorRef,
  UserDimensionRecord,
  Vec2,
  Vec3,
} from '../domain/types';
import type {
  DimensionSnapPort,
  SnapCandidate,
  SnapCapability,
} from '../ports/snapPort';

export type DimensionEditPhase =
  | 'pick-first'
  | 'pick-second'
  | 'pick-third'
  | 'pick-axis'
  | 'place'
  | 'ready'
  | 'cancelled'
  | 'committed';

/** 工具栏显示的步骤：拾点 / 定轴（框架）/ 放置 / 待提交。 */
export type DimensionEditStep = 'pick' | 'frame' | 'place' | 'ready' | 'done';

export function dimensionEditStep(phase: DimensionEditPhase): DimensionEditStep {
  switch (phase) {
    case 'pick-first':
    case 'pick-second':
    case 'pick-third':
      return 'pick';
    case 'pick-axis':
      return 'frame';
    case 'place':
      return 'place';
    case 'ready':
      return 'ready';
    default:
      return 'done';
  }
}

export type DimensionEditSession = {
  readonly kind: DimensionKind;
  readonly phase: DimensionEditPhase;
  /** 当前草稿过不了布局前校验的错误码（`validation.ts`），按当帧视向判；没有草稿为空。 */
  readonly validationErrors: readonly string[];
  pointerMove(screen: Vec2): void;
  pointerDown(screen: Vec2): void;
  flip(): void;
  /** 近 90° 吸附。只有角度会话实现它。 */
  toggleOrthogonalSnap?(): void;
  /** 退回上一步；已在第一步（或会话结束）时返回 false。 */
  back(): boolean;
  commit(): DimensionCommand | null;
  cancel(): void;
}

export type DimensionEditSessionInput = Readonly<{
  snapPort: DimensionSnapPort;
  actor: DimensionActor;
  createDimensionId: () => string;
  createCommandId: () => string;
  now: () => number;
  onPreview: (
    input: ReturnType<typeof normalizeUserDimension>,
  ) => void;
  thresholdPx?: number;
  /**
   * place 阶段：光标 → 设计空间放置（线性 / 投影按草稿的 `dimensionPlane` 求射线交点，径向按圆心深度）。
   * 不给时用缺省放置，再点一下即就绪。
   */
  placementAt?: (
    record: UserDimensionRecord,
    screen: Vec2,
  ) => UserDimensionRecord['placement'] | null;
  /** 当帧相机视向（设计系）：只用来定尺寸平面的朝向与做视向校验，不入库。 */
  viewDirection?: () => Vec3 | null;
}>;

export type DimensionAnchorSlot =
  | 'a'
  | 'b'
  | 'vertex'
  | 'rayA'
  | 'rayB'
  | 'center'
  | 'rim';

export type DimensionPlacementEditSessionInput = Readonly<{
  record: UserDimensionRecord;
  actor: DimensionActor;
  createCommandId: () => string;
  now: () => number;
  onPreview: DimensionEditSessionInput['onPreview'];
  placementAt: (
    screen: Vec2,
  ) => UserDimensionRecord['placement'] | null;
}>;

export type DimensionRebindEditSessionInput = Readonly<{
  record: UserDimensionRecord;
  anchorSlot: DimensionAnchorSlot;
  snapPort: DimensionSnapPort;
  actor: DimensionActor;
  createCommandId: () => string;
  now: () => number;
  onPreview: DimensionEditSessionInput['onPreview'];
  thresholdPx?: number;
}>;

export type AxisSelectableDimensionEditSession = {
  selectDesignAxis(axis: 'x' | 'y' | 'z'): void;
} & DimensionEditSession

function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function subtract(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/**
 * 尺寸平面（#75）：含尺寸方向、且最正对相机的那张——法向取视向垂直于尺寸方向的分量。视向与尺寸方向平行
 * （或没有视向）时退到与尺寸方向夹角最大的设计轴。定下后作为 `explicit` 方向入库，之后转相机不再改它。
 */
export function dimensionPlaneNormal(dimensionDirection: Vec3, view: Vec3 | null): Vec3 | null {
  const along = unitVec3(dimensionDirection);
  if (!along) return null;
  const perpendicularTo = (vector: Vec3): Vec3 | null => {
    const unit = unitVec3(vector);
    if (!unit) return null;
    const k = dot(unit, along);
    return unitVec3([unit[0] - along[0] * k, unit[1] - along[1] * k, unit[2] - along[2] * k]);
  };
  const fromView = view ? perpendicularTo(view) : null;
  if (fromView) return fromView;
  const axes: Vec3[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  axes.sort((p, q) => Math.abs(dot(p, along)) - Math.abs(dot(q, along)));
  return perpendicularTo(axes[0]!);
}

function explicitDirections(
  dimensionDirection: Vec3 | null,
  view: Vec3 | null,
  projectionDirection?: Vec3 | null,
): DimensionDirections | undefined {
  const along = dimensionDirection ? unitVec3(dimensionDirection) : null;
  if (!along) return undefined;
  const normal = dimensionPlaneNormal(along, view);
  return {
    schema: 1,
    source: 'explicit',
    measuredAxis: along,
    dimensionDirection: along,
    ...(projectionDirection ? { projectionDirection } : {}),
    ...(normal ? { dimensionPlane: { normal } } : {}),
  };
}

function nonZero(vector: Vec3 | undefined): vector is Vec3 {
  return !!vector
    && vector[0] * vector[0] + vector[1] * vector[1] + vector[2] * vector[2]
      > 1e-18;
}

/**
 * Same test the radial picker used inline, spelled as a type predicate so the
 * narrowed `capability` reaches `SemanticAnchorRef['source']`.
 */
function isCircularCandidate(
  candidate: SnapCandidate,
): candidate is SnapCandidate & Readonly<{ capability: 'circle' | 'arc' }> {
  return (
    (candidate.capability === 'circle' || candidate.capability === 'arc')
    && candidate.anchor.snapshot !== null
    && nonZero(candidate.direction)
    && nonZero(candidate.normal)
  );
}

function selectedCandidate(
  input: DimensionEditSessionInput,
  screen: Vec2,
  capabilities: readonly SnapCapability[],
): SnapCandidate | null {
  return input.snapPort.query({
    screen,
    capabilities,
    thresholdPx: input.thresholdPx ?? 18,
  })[0] ?? null;
}

function semanticAxis(candidate: SnapCandidate): ProjectionAxisRef | null {
  if (!nonZero(candidate.direction)) return null;
  return {
    kind: 'semantic-direction',
    snapshot: candidate.direction,
    semanticRef: {
      source: 'direction',
      ...(candidate.anchor.semanticRef?.refno
        ? { refno: candidate.anchor.semanticRef.refno }
        : {}),
      candidateId: candidate.anchor.semanticRef?.candidateId ?? candidate.id,
    },
  };
}

export function dimensionAnchorSlots(
  record: UserDimensionRecord,
): readonly DimensionAnchorSlot[] {
  switch (record.kind) {
    case 'linear':
    case 'projected':
      return ['a', 'b'];
    case 'angular':
      return ['vertex', 'rayA', 'rayB'];
    case 'radial':
      return ['center', 'rim'];
  }
}

function replacePreviewAnchor(
  record: UserDimensionRecord,
  slot: DimensionAnchorSlot,
  anchor: DimensionAnchor,
): UserDimensionRecord | null {
  if (
    (record.kind === 'linear' || record.kind === 'projected')
    && (slot === 'a' || slot === 'b')
  ) {
    const next = { ...record, [slot]: anchor };
    return {
      ...next,
      validity: dimensionRecordHasResolvedGeometry(next) ? 'valid' : 'invalid',
    };
  }
  if (
    record.kind === 'angular'
    && (slot === 'vertex' || slot === 'rayA' || slot === 'rayB')
  ) {
    const next = { ...record, [slot]: anchor };
    return {
      ...next,
      validity: dimensionRecordHasResolvedGeometry(next) ? 'valid' : 'invalid',
    };
  }
  if (
    record.kind === 'radial'
    && (slot === 'center' || slot === 'rim')
  ) {
    const next = { ...record, [slot]: anchor };
    return {
      ...next,
      validity: dimensionRecordHasResolvedGeometry(next) ? 'valid' : 'invalid',
    };
  }
  return null;
}

abstract class BaseEditSession implements DimensionEditSession {
  abstract readonly kind: DimensionKind;
  protected currentPhase: DimensionEditPhase = 'pick-first';
  protected readonly dimensionId: string;

  constructor(protected readonly input: DimensionEditSessionInput) {
    this.dimensionId = input.createDimensionId();
  }

  get phase(): DimensionEditPhase {
    return this.currentPhase;
  }

  abstract pointerMove(screen: Vec2): void;
  abstract pointerDown(screen: Vec2): void;
  abstract buildRecord(at: number): UserDimensionRecord | null;
  abstract back(): boolean;

  flip(): void {
    // Most edit sessions have no reversible orientation.
  }

  toggleOrthogonalSnap(): void {
    // Only the angular session opts into near-right-angle snapping.
  }

  get validationErrors(): readonly string[] {
    if (this.currentPhase !== 'place' && this.currentPhase !== 'ready') return [];
    const record = this.buildRecord(this.input.now());
    if (!record) return [];
    const result = validateDimensionRecord(record, { viewDirection: this.view() ?? undefined });
    return result.ok ? [] : result.errors.map(error => error.code);
  }

  protected view(): Vec3 | null {
    return this.input.viewDirection?.() ?? null;
  }

  /** place 阶段跟光标：交给宿主按设计平面算放置；算不出就保持上一次的。 */
  protected placementFromScreen<P extends UserDimensionRecord['placement']>(
    record: UserDimensionRecord | null,
    screen: Vec2,
  ): P | null {
    if (!record || !this.input.placementAt) return null;
    return this.input.placementAt(record, screen) as P | null;
  }

  commit(): DimensionCommand | null {
    if (this.currentPhase !== 'ready') return null;
    const at = this.input.now();
    const record = this.buildRecord(at);
    if (!record) return null;
    this.currentPhase = 'committed';
    this.input.onPreview(null);
    return {
      commandId: this.input.createCommandId(),
      actorId: this.input.actor.actorId,
      actorRole: this.input.actor.actorRole,
      at,
      type: 'create',
      record,
    };
  }

  cancel(): void {
    if (this.currentPhase === 'committed') return;
    this.currentPhase = 'cancelled';
    this.input.onPreview(null);
  }

  protected isFinished(): boolean {
    return this.currentPhase === 'committed' || this.currentPhase === 'cancelled';
  }

  protected emitPreview(record: UserDimensionRecord | null): void {
    this.input.onPreview(record ? normalizeUserDimension(record) : null);
  }

  protected common(at: number) {
    return {
      id: this.dimensionId,
      labelPinned: false,
      authorId: this.input.actor.actorId,
      authorRole: this.input.actor.actorRole,
      createdAt: at,
      updatedAt: at,
      validity: 'valid' as const,
    };
  }
}

const DEFAULT_LINEAR_PLACEMENT: LinearPlacementIntent = {
  offsetM: 0.15,
  labelT: 0.5,
  side: 1,
};

class LinearEditSession extends BaseEditSession {
  readonly kind = 'linear' as const;
  private a: DimensionAnchor | null = null;
  private b: DimensionAnchor | null = null;
  private directions: DimensionDirections | undefined;
  private placement: LinearPlacementIntent = DEFAULT_LINEAR_PLACEMENT;

  pointerMove(screen: Vec2): void {
    if (this.currentPhase === 'place') {
      this.followCursor(screen);
      return;
    }
    if (this.currentPhase !== 'pick-first' && this.currentPhase !== 'pick-second') {
      return;
    }
    const candidate = selectedCandidate(this.input, screen, ['point']);
    if (this.currentPhase === 'pick-second' && this.a && candidate?.anchor.snapshot) {
      this.emitPreview(this.recordFrom(this.a, candidate.anchor, this.input.now()));
    } else {
      this.emitPreview(null);
    }
  }

  pointerDown(screen: Vec2): void {
    if (this.currentPhase === 'place') {
      this.followCursor(screen);
      this.currentPhase = 'ready';
      return;
    }
    const candidate = selectedCandidate(this.input, screen, ['point']);
    if (!candidate?.anchor.snapshot) return;
    if (this.currentPhase === 'pick-first') {
      this.a = candidate.anchor;
      this.currentPhase = 'pick-second';
      this.emitPreview(null);
      return;
    }
    if (this.currentPhase === 'pick-second' && this.a?.snapshot) {
      this.b = candidate.anchor;
      this.directions = explicitDirections(
        subtract(candidate.anchor.snapshot, this.a.snapshot),
        this.view(),
      );
      this.currentPhase = 'place';
      this.emitPreview(this.recordFrom(this.a, this.b, this.input.now()));
    }
  }

  back(): boolean {
    switch (this.currentPhase) {
      case 'ready':
        this.currentPhase = 'place';
        return true;
      case 'place':
        this.b = null;
        this.directions = undefined;
        this.placement = { ...DEFAULT_LINEAR_PLACEMENT, side: this.placement.side };
        this.currentPhase = 'pick-second';
        this.emitPreview(null);
        return true;
      case 'pick-second':
        this.a = null;
        this.currentPhase = 'pick-first';
        this.emitPreview(null);
        return true;
      default:
        return false;
    }
  }

  flip(): void {
    this.placement = { ...this.placement, side: this.placement.side === 1 ? -1 : 1 };
    if (this.a && this.b) {
      this.emitPreview(this.recordFrom(this.a, this.b, this.input.now()));
    }
  }

  buildRecord(at: number): UserDimensionRecord | null {
    return this.a && this.b ? this.recordFrom(this.a, this.b, at) : null;
  }

  private followCursor(screen: Vec2): void {
    const placement = this.placementFromScreen<LinearPlacementIntent>(
      this.buildRecord(this.input.now()),
      screen,
    );
    if (placement) this.placement = placement;
    this.emitPreview(this.buildRecord(this.input.now()));
  }

  private recordFrom(
    a: DimensionAnchor,
    b: DimensionAnchor,
    at: number,
  ): Extract<UserDimensionRecord, { kind: 'linear' }> {
    return {
      ...this.common(at),
      kind: 'linear',
      a,
      b,
      placement: this.placement,
      ...(this.directions && b === this.b ? { directions: this.directions } : {}),
    };
  }
}

class ProjectedEditSession extends BaseEditSession
  implements AxisSelectableDimensionEditSession {
  readonly kind = 'projected' as const;
  private a: DimensionAnchor | null = null;
  private b: DimensionAnchor | null = null;
  private axis: ProjectionAxisRef | null = null;
  private directions: DimensionDirections | undefined;
  private placement: LinearPlacementIntent = DEFAULT_LINEAR_PLACEMENT;

  pointerMove(screen: Vec2): void {
    if (this.currentPhase === 'place') {
      this.followCursor(screen);
      return;
    }
    if (this.currentPhase === 'pick-second' && this.a) {
      const candidate = selectedCandidate(this.input, screen, ['point']);
      if (candidate?.anchor.snapshot) {
        this.emitPreview(null);
      }
      return;
    }
    if (this.currentPhase === 'pick-axis' && this.a && this.b) {
      const candidate = selectedCandidate(this.input, screen, ['direction']);
      const axis = candidate ? semanticAxis(candidate) : null;
      this.emitPreview(
        axis ? this.recordFrom(this.a, this.b, axis, this.input.now()) : null,
      );
    }
  }

  pointerDown(screen: Vec2): void {
    if (this.currentPhase === 'place') {
      this.followCursor(screen);
      this.currentPhase = 'ready';
      return;
    }
    if (this.currentPhase === 'pick-first' || this.currentPhase === 'pick-second') {
      const candidate = selectedCandidate(this.input, screen, ['point']);
      if (!candidate?.anchor.snapshot) return;
      if (this.currentPhase === 'pick-first') {
        this.a = candidate.anchor;
        this.currentPhase = 'pick-second';
      } else {
        this.b = candidate.anchor;
        this.currentPhase = 'pick-axis';
      }
      this.emitPreview(null);
      return;
    }
    if (this.currentPhase === 'pick-axis' && this.a && this.b) {
      const candidate = selectedCandidate(this.input, screen, ['direction']);
      const axis = candidate ? semanticAxis(candidate) : null;
      if (!axis) return;
      this.enterPlace(axis);
    }
  }

  selectDesignAxis(axis: 'x' | 'y' | 'z'): void {
    if (this.currentPhase !== 'pick-axis' || !this.a || !this.b) return;
    this.enterPlace({ kind: 'design-axis', axis });
  }

  back(): boolean {
    switch (this.currentPhase) {
      case 'ready':
        this.currentPhase = 'place';
        return true;
      case 'place':
        this.axis = null;
        this.directions = undefined;
        this.placement = { ...DEFAULT_LINEAR_PLACEMENT, side: this.placement.side };
        this.currentPhase = 'pick-axis';
        this.emitPreview(null);
        return true;
      case 'pick-axis':
        this.b = null;
        this.currentPhase = 'pick-second';
        this.emitPreview(null);
        return true;
      case 'pick-second':
        this.a = null;
        this.currentPhase = 'pick-first';
        this.emitPreview(null);
        return true;
      default:
        return false;
    }
  }

  flip(): void {
    this.placement = { ...this.placement, side: this.placement.side === 1 ? -1 : 1 };
    if (this.a && this.b && this.axis) {
      this.emitPreview(
        this.recordFrom(this.a, this.b, this.axis, this.input.now()),
      );
    }
  }

  buildRecord(at: number): UserDimensionRecord | null {
    return this.a && this.b && this.axis
      ? this.recordFrom(this.a, this.b, this.axis, at)
      : null;
  }

  private enterPlace(axis: ProjectionAxisRef): void {
    if (!this.a || !this.b) return;
    this.axis = axis;
    const along = unitVec3(projectionAxisVector(axis));
    const a = this.a.snapshot;
    const b = this.b.snapshot;
    let projectionDirection: Vec3 | null = null;
    if (along && a && b) {
      const span = subtract(b, a);
      const k = dot(span, along);
      projectionDirection = unitVec3([span[0] - along[0] * k, span[1] - along[1] * k, span[2] - along[2] * k]);
    }
    this.directions = explicitDirections(along, this.view(), projectionDirection);
    this.currentPhase = 'place';
    this.emitPreview(this.recordFrom(this.a, this.b, axis, this.input.now()));
  }

  private followCursor(screen: Vec2): void {
    const placement = this.placementFromScreen<LinearPlacementIntent>(
      this.buildRecord(this.input.now()),
      screen,
    );
    if (placement) this.placement = placement;
    this.emitPreview(this.buildRecord(this.input.now()));
  }

  private recordFrom(
    a: DimensionAnchor,
    b: DimensionAnchor,
    axis: ProjectionAxisRef,
    at: number,
  ): Extract<UserDimensionRecord, { kind: 'projected' }> {
    return {
      ...this.common(at),
      kind: 'projected',
      a,
      b,
      axis,
      placement: this.placement,
      ...(this.directions && axis === this.axis ? { directions: this.directions } : {}),
    };
  }
}

class AngularEditSession extends BaseEditSession {
  readonly kind = 'angular' as const;
  private vertex: DimensionAnchor | null = null;
  private rayA: DimensionAnchor | null = null;
  private rayB: DimensionAnchor | null = null;
  private arcChoice: 'minor' | 'major' = 'minor';
  private orthogonalSnap = false;
  private radiusM: number | undefined;
  private anglePlane: AngularPlane | undefined;

  pointerMove(screen: Vec2): void {
    if (this.currentPhase === 'place') {
      this.followCursor(screen);
      return;
    }
    if (
      this.currentPhase !== 'pick-first'
      && this.currentPhase !== 'pick-second'
      && this.currentPhase !== 'pick-third'
    ) {
      return;
    }
    const candidate = selectedCandidate(this.input, screen, ['point']);
    if (
      this.currentPhase === 'pick-third'
      && this.vertex
      && this.rayA
      && candidate?.anchor.snapshot
    ) {
      this.emitPreview(
        this.recordFrom(
          this.vertex,
          this.rayA,
          candidate.anchor,
          this.input.now(),
        ),
      );
    } else {
      this.emitPreview(null);
    }
  }

  pointerDown(screen: Vec2): void {
    if (this.currentPhase === 'place') {
      this.followCursor(screen);
      if (this.validationErrors.length === 0) this.currentPhase = 'ready';
      return;
    }
    const candidate = selectedCandidate(this.input, screen, ['point']);
    if (!candidate?.anchor.snapshot) return;
    if (this.currentPhase === 'pick-first') {
      this.vertex = candidate.anchor;
      this.currentPhase = 'pick-second';
      this.emitPreview(null);
      return;
    }
    if (this.currentPhase === 'pick-second') {
      this.rayA = candidate.anchor;
      this.currentPhase = 'pick-third';
      this.emitPreview(null);
      return;
    }
    if (this.currentPhase === 'pick-third' && this.vertex && this.rayA) {
      this.rayB = candidate.anchor;
      const vertex = this.vertex.snapshot;
      const rayA = this.rayA.snapshot;
      const rayB = candidate.anchor.snapshot;
      this.anglePlane = vertex && rayA && rayB
        ? deriveAngularPlane(vertex, rayA, rayB, 'explicit') ?? undefined
        : undefined;
      this.currentPhase = 'place';
      this.emitPreview(
        this.recordFrom(this.vertex, this.rayA, this.rayB, this.input.now()),
      );
    }
  }

  /** 近 90° 吸附是显式开关：默认关，创建过程中打开后写进记录。 */
  override toggleOrthogonalSnap(): void {
    this.orthogonalSnap = !this.orthogonalSnap;
    if (this.vertex && this.rayA && this.rayB) {
      this.emitPreview(this.recordFrom(this.vertex, this.rayA, this.rayB, this.input.now()));
    }
  }

  override commit(): DimensionCommand | null {
    if (this.validationErrors.length > 0) return null;
    return super.commit();
  }

  back(): boolean {
    switch (this.currentPhase) {
      case 'ready':
        this.currentPhase = 'place';
        return true;
      case 'place':
        this.rayB = null;
        this.anglePlane = undefined;
        this.radiusM = undefined;
        this.currentPhase = 'pick-third';
        this.emitPreview(null);
        return true;
      case 'pick-third':
        this.rayA = null;
        this.currentPhase = 'pick-second';
        this.emitPreview(null);
        return true;
      case 'pick-second':
        this.vertex = null;
        this.currentPhase = 'pick-first';
        this.emitPreview(null);
        return true;
      default:
        return false;
    }
  }

  flip(): void {
    this.arcChoice = this.arcChoice === 'minor' ? 'major' : 'minor';
    if (this.vertex && this.rayA && this.rayB) {
      this.emitPreview(
        this.recordFrom(this.vertex, this.rayA, this.rayB, this.input.now()),
      );
    }
  }

  buildRecord(at: number): UserDimensionRecord | null {
    return this.vertex && this.rayA && this.rayB
      ? this.recordFrom(this.vertex, this.rayA, this.rayB, at)
      : null;
  }

  private recordFrom(
    vertex: DimensionAnchor,
    rayA: DimensionAnchor,
    rayB: DimensionAnchor,
    at: number,
  ): Extract<UserDimensionRecord, { kind: 'angular' }> {
    return {
      ...this.common(at),
      kind: 'angular',
      vertex,
      rayA,
      rayB,
      placement: {
        ...(this.radiusM === undefined ? {} : { radiusM: this.radiusM }),
        labelT: 0.5,
        arcChoice: this.arcChoice,
        orthogonalSnap: this.orthogonalSnap,
      },
      ...(this.anglePlane ? { anglePlane: this.anglePlane } : {}),
    };
  }

  private followCursor(screen: Vec2): void {
    const placement = this.placementFromScreen<AngularPlacementIntent>(
      this.buildRecord(this.input.now()),
      screen,
    );
    if (placement?.radiusM !== undefined) this.radiusM = placement.radiusM;
    this.emitPreview(this.buildRecord(this.input.now()));
  }
}

class RadialEditSession extends BaseEditSession
  implements AxisSelectableDimensionEditSession {
  readonly kind = 'radial' as const;
  private center: DimensionAnchor | null = null;
  private rim: DimensionAnchor | null = null;
  private normal: ProjectionAxisRef | null = null;
  private display: 'radius' | 'diameter' = 'radius';
  private placement: RadialPlacementIntent | null = null;
  /** 圆 / 弧一次拾全了圆心、圆周、法向：退回时直接回到拾取第一步。 */
  private pickedCircular = false;

  pointerMove(screen: Vec2): void {
    if (this.currentPhase === 'place') {
      this.followCursor(screen);
      return;
    }
    if (this.currentPhase === 'pick-first') {
      this.emitPreview(null);
      return;
    }
    if (this.currentPhase === 'pick-second' && this.center) {
      const candidate = selectedCandidate(this.input, screen, ['point']);
      if (candidate?.anchor.snapshot) this.emitPreview(null);
      return;
    }
    if (this.currentPhase === 'pick-axis' && this.center && this.rim) {
      const candidate = selectedCandidate(this.input, screen, ['direction']);
      const normal = candidate ? semanticAxis(candidate) : null;
      this.emitPreview(
        normal
          ? this.recordFrom(this.center, this.rim, normal, this.input.now())
          : null,
      );
    }
  }

  pointerDown(screen: Vec2): void {
    if (this.currentPhase === 'place') {
      this.followCursor(screen);
      this.currentPhase = 'ready';
      return;
    }
    if (this.currentPhase === 'pick-first') {
      const candidates = this.input.snapPort.query({
        screen,
        capabilities: ['circle', 'arc', 'point'],
        thresholdPx: this.input.thresholdPx ?? 18,
      });
      const circular = candidates.find(isCircularCandidate);
      if (
        circular?.anchor.snapshot
        && circular.direction
        && circular.normal
      ) {
        const baseCandidateId = (
          circular.anchor.semanticRef?.candidateId
          ?? circular.id.replace(/:(?:circle|arc)$/, '')
        ).replace(/:(?:center|rim|normal)$/, '');
        const semanticRef = (
          part: 'center' | 'rim' | 'normal',
        ): SemanticAnchorRef => ({
          source: circular.capability,
          ...(circular.anchor.semanticRef?.refno
            ? { refno: circular.anchor.semanticRef.refno }
            : {}),
          candidateId: `${baseCandidateId}:${part}`,
        });
        this.center = {
          ...circular.anchor,
          semanticRef: semanticRef('center'),
        };
        this.rim = {
          snapshot: add(circular.anchor.snapshot, circular.direction),
          accuracy: circular.anchor.accuracy,
          semanticRef: semanticRef('rim'),
        };
        this.normal = {
          kind: 'semantic-direction',
          snapshot: circular.normal,
          semanticRef: semanticRef('normal'),
        };
        this.pickedCircular = true;
        this.enterPlace();
        return;
      }

      const point = candidates.find(candidate =>
        candidate.capability === 'point' && candidate.anchor.snapshot !== null);
      if (!point?.anchor.snapshot) return;
      this.center = point.anchor;
      this.currentPhase = 'pick-second';
      this.emitPreview(null);
      return;
    }

    if (this.currentPhase === 'pick-second') {
      const candidate = selectedCandidate(this.input, screen, ['point']);
      if (!candidate?.anchor.snapshot) return;
      this.rim = candidate.anchor;
      this.currentPhase = 'pick-axis';
      this.emitPreview(null);
      return;
    }

    if (this.currentPhase === 'pick-axis' && this.center && this.rim) {
      const candidate = selectedCandidate(this.input, screen, ['direction']);
      const normal = candidate ? semanticAxis(candidate) : null;
      if (!normal) return;
      this.normal = normal;
      this.enterPlace();
    }
  }

  back(): boolean {
    switch (this.currentPhase) {
      case 'ready':
        this.currentPhase = 'place';
        return true;
      case 'place':
        this.placement = null;
        this.normal = null;
        if (this.pickedCircular) {
          this.center = null;
          this.rim = null;
          this.pickedCircular = false;
          this.currentPhase = 'pick-first';
        } else {
          this.currentPhase = 'pick-axis';
        }
        this.emitPreview(null);
        return true;
      case 'pick-axis':
        this.rim = null;
        this.currentPhase = 'pick-second';
        this.emitPreview(null);
        return true;
      case 'pick-second':
        this.center = null;
        this.currentPhase = 'pick-first';
        this.emitPreview(null);
        return true;
      default:
        return false;
    }
  }

  private enterPlace(): void {
    this.currentPhase = 'place';
    this.emitPreview(this.buildRecord(this.input.now()));
  }

  private followCursor(screen: Vec2): void {
    const placement = this.placementFromScreen<RadialPlacementIntent>(
      this.buildRecord(this.input.now()),
      screen,
    );
    if (placement) this.placement = placement;
    this.emitPreview(this.buildRecord(this.input.now()));
  }

  selectDesignAxis(axis: 'x' | 'y' | 'z'): void {
    if (this.currentPhase !== 'pick-axis' || !this.center || !this.rim) return;
    this.normal = { kind: 'design-axis', axis };
    this.enterPlace();
  }

  flip(): void {
    this.display = this.display === 'radius' ? 'diameter' : 'radius';
    if (this.center && this.rim && this.normal) {
      this.emitPreview(
        this.recordFrom(this.center, this.rim, this.normal, this.input.now()),
      );
    }
  }

  buildRecord(at: number): UserDimensionRecord | null {
    return this.center && this.rim && this.normal
      ? this.recordFrom(this.center, this.rim, this.normal, at)
      : null;
  }

  private recordFrom(
    center: DimensionAnchor,
    rim: DimensionAnchor,
    normal: ProjectionAxisRef,
    at: number,
  ): Extract<UserDimensionRecord, { kind: 'radial' }> {
    const centerSnapshot = center.snapshot!;
    const rimSnapshot = rim.snapshot!;
    const leaderDirection = subtract(rimSnapshot, centerSnapshot);
    return {
      ...this.common(at),
      kind: 'radial',
      center,
      rim,
      normal,
      display: this.display,
      placement: this.placement ?? {
        leaderDirection,
        labelDistanceM: 0.25,
      },
    };
  }
}

class PlacementEditSession implements DimensionEditSession {
  readonly kind: DimensionKind;
  private currentPhase: DimensionEditPhase = 'ready';
  private placement: UserDimensionRecord['placement'];
  private moved = false;

  readonly validationErrors: readonly string[] = [];

  constructor(private readonly input: DimensionPlacementEditSessionInput) {
    this.kind = input.record.kind;
    this.placement = input.record.placement;
  }

  get phase(): DimensionEditPhase {
    return this.currentPhase;
  }

  /** 拖放置只有一步；退回 = 恢复编辑前的放置（取消前的那一份），会话仍在。 */
  back(): boolean {
    if (this.currentPhase !== 'ready' || !this.moved) return false;
    this.placement = this.input.record.placement;
    this.moved = false;
    this.input.onPreview(null);
    return true;
  }

  pointerMove(screen: Vec2): void {
    if (this.currentPhase !== 'ready') return;
    const placement = this.input.placementAt(screen);
    if (!placement) return;
    this.placement = placement;
    this.moved = true;
    this.input.onPreview(normalizeUserDimension({
      ...this.input.record,
      placement,
      labelPinned: true,
      updatedAt: this.input.now(),
    } as UserDimensionRecord));
  }

  pointerDown(screen: Vec2): void {
    this.pointerMove(screen);
  }

  flip(): void {
    // Placement dragging has no discrete orientation to flip.
  }

  commit(): DimensionCommand | null {
    if (this.currentPhase !== 'ready' || !this.moved) return null;
    this.currentPhase = 'committed';
    this.input.onPreview(null);
    return {
      type: 'replace-placement',
      commandId: this.input.createCommandId(),
      actorId: this.input.actor.actorId,
      actorRole: this.input.actor.actorRole,
      at: this.input.now(),
      dimensionId: this.input.record.id,
      placement: this.placement,
      labelPinned: true,
    };
  }

  cancel(): void {
    if (this.currentPhase === 'committed') return;
    this.currentPhase = 'cancelled';
    this.input.onPreview(null);
  }
}

class RebindEditSession implements DimensionEditSession {
  readonly kind: DimensionKind;
  private currentPhase: DimensionEditPhase = 'pick-first';
  private anchor: DimensionAnchor | null = null;

  readonly validationErrors: readonly string[] = [];

  constructor(private readonly input: DimensionRebindEditSessionInput) {
    this.kind = input.record.kind;
  }

  get phase(): DimensionEditPhase {
    return this.currentPhase;
  }

  back(): boolean {
    if (this.currentPhase !== 'ready') return false;
    this.anchor = null;
    this.currentPhase = 'pick-first';
    this.input.onPreview(null);
    return true;
  }

  pointerMove(screen: Vec2): void {
    if (this.currentPhase !== 'pick-first') return;
    const candidate = this.selectedCandidate(screen);
    const preview = candidate?.anchor.snapshot
      ? replacePreviewAnchor(
        this.input.record,
        this.input.anchorSlot,
        candidate.anchor,
      )
      : null;
    this.input.onPreview(preview ? normalizeUserDimension(preview) : null);
  }

  pointerDown(screen: Vec2): void {
    if (this.currentPhase !== 'pick-first') return;
    const candidate = this.selectedCandidate(screen);
    if (!candidate?.anchor.snapshot) return;
    this.anchor = candidate.anchor;
    this.currentPhase = 'ready';
    const preview = replacePreviewAnchor(
      this.input.record,
      this.input.anchorSlot,
      candidate.anchor,
    );
    this.input.onPreview(preview ? normalizeUserDimension(preview) : null);
  }

  flip(): void {
    // Rebinding changes one anchor and has no orientation state.
  }

  commit(): DimensionCommand | null {
    if (this.currentPhase !== 'ready' || !this.anchor) return null;
    this.currentPhase = 'committed';
    this.input.onPreview(null);
    return {
      type: 'rebind-anchor',
      commandId: this.input.createCommandId(),
      actorId: this.input.actor.actorId,
      actorRole: this.input.actor.actorRole,
      at: this.input.now(),
      dimensionId: this.input.record.id,
      anchorSlot: this.input.anchorSlot,
      anchor: this.anchor,
    };
  }

  cancel(): void {
    if (this.currentPhase === 'committed') return;
    this.currentPhase = 'cancelled';
    this.input.onPreview(null);
  }

  private selectedCandidate(screen: Vec2): SnapCandidate | null {
    return this.input.snapPort.query({
      screen,
      capabilities: ['point'],
      thresholdPx: this.input.thresholdPx ?? 18,
    })[0] ?? null;
  }
}

export function createLinearEditSession(
  input: DimensionEditSessionInput,
): DimensionEditSession {
  return new LinearEditSession(input);
}

export function createProjectedEditSession(
  input: DimensionEditSessionInput,
): AxisSelectableDimensionEditSession {
  return new ProjectedEditSession(input);
}

export function createAngularEditSession(
  input: DimensionEditSessionInput,
): DimensionEditSession {
  return new AngularEditSession(input);
}

export function createRadialEditSession(
  input: DimensionEditSessionInput,
): AxisSelectableDimensionEditSession {
  return new RadialEditSession(input);
}

export function createPlacementEditSession(
  input: DimensionPlacementEditSessionInput,
): DimensionEditSession {
  return new PlacementEditSession(input);
}

export function createRebindEditSession(
  input: DimensionRebindEditSessionInput,
): DimensionEditSession | null {
  return dimensionAnchorSlots(input.record).includes(input.anchorSlot)
    ? new RebindEditSession(input)
    : null;
}
