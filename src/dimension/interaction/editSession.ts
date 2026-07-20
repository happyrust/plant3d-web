import { normalizeUserDimension } from '../adapters/normalizeUserDimensions';
import { dimensionRecordHasResolvedGeometry } from '../domain/invariants';

import type {
  DimensionActor,
  DimensionCommand,
} from '../domain/commands';
import type {
  DimensionAnchor,
  DimensionKind,
  ProjectionAxisRef,
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

export type DimensionEditSession = {
  readonly kind: DimensionKind;
  readonly phase: DimensionEditPhase;
  pointerMove(screen: Vec2): void;
  pointerDown(screen: Vec2): void;
  flip(): void;
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

function nonZero(vector: Vec3 | undefined): vector is Vec3 {
  return !!vector
    && vector[0] * vector[0] + vector[1] * vector[1] + vector[2] * vector[2]
      > 1e-18;
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

  flip(): void {
    // Most edit sessions have no reversible orientation.
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

  protected emitPreview(record: UserDimensionRecord | null): void {
    this.input.onPreview(record ? normalizeUserDimension(record) : null);
  }

  protected common(at: number) {
    return {
      id: this.dimensionId,
      authorId: this.input.actor.actorId,
      authorRole: this.input.actor.actorRole,
      createdAt: at,
      updatedAt: at,
      validity: 'valid' as const,
    };
  }
}

class LinearEditSession extends BaseEditSession {
  readonly kind = 'linear' as const;
  private a: DimensionAnchor | null = null;
  private b: DimensionAnchor | null = null;
  private side: 1 | -1 = 1;

  pointerMove(screen: Vec2): void {
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
    const candidate = selectedCandidate(this.input, screen, ['point']);
    if (!candidate?.anchor.snapshot) return;
    if (this.currentPhase === 'pick-first') {
      this.a = candidate.anchor;
      this.currentPhase = 'pick-second';
      this.emitPreview(null);
      return;
    }
    if (this.currentPhase === 'pick-second' && this.a) {
      this.b = candidate.anchor;
      this.currentPhase = 'ready';
      this.emitPreview(this.recordFrom(this.a, this.b, this.input.now()));
    }
  }

  flip(): void {
    this.side = this.side === 1 ? -1 : 1;
    if (this.a && this.b) {
      this.emitPreview(this.recordFrom(this.a, this.b, this.input.now()));
    }
  }

  buildRecord(at: number): UserDimensionRecord | null {
    return this.a && this.b ? this.recordFrom(this.a, this.b, at) : null;
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
      placement: {
        offsetM: 0.15,
        labelT: 0.5,
        side: this.side,
      },
    };
  }
}

class ProjectedEditSession extends BaseEditSession
  implements AxisSelectableDimensionEditSession {
  readonly kind = 'projected' as const;
  private a: DimensionAnchor | null = null;
  private b: DimensionAnchor | null = null;
  private axis: ProjectionAxisRef | null = null;
  private side: 1 | -1 = 1;

  pointerMove(screen: Vec2): void {
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
      this.axis = axis;
      this.currentPhase = 'ready';
      this.emitPreview(this.recordFrom(this.a, this.b, axis, this.input.now()));
    }
  }

  selectDesignAxis(axis: 'x' | 'y' | 'z'): void {
    if (this.currentPhase !== 'pick-axis' || !this.a || !this.b) return;
    this.axis = { kind: 'design-axis', axis };
    this.currentPhase = 'ready';
    this.emitPreview(this.recordFrom(this.a, this.b, this.axis, this.input.now()));
  }

  flip(): void {
    this.side = this.side === 1 ? -1 : 1;
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
      placement: {
        offsetM: 0.15,
        labelT: 0.5,
        side: this.side,
      },
    };
  }
}

class AngularEditSession extends BaseEditSession {
  readonly kind = 'angular' as const;
  private vertex: DimensionAnchor | null = null;
  private rayA: DimensionAnchor | null = null;
  private rayB: DimensionAnchor | null = null;
  private arcChoice: 'minor' | 'major' = 'minor';

  pointerMove(screen: Vec2): void {
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
      this.currentPhase = 'ready';
      this.emitPreview(
        this.recordFrom(this.vertex, this.rayA, this.rayB, this.input.now()),
      );
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
        labelT: 0.5,
        arcChoice: this.arcChoice,
      },
    };
  }
}

class RadialEditSession extends BaseEditSession
  implements AxisSelectableDimensionEditSession {
  readonly kind = 'radial' as const;
  private center: DimensionAnchor | null = null;
  private rim: DimensionAnchor | null = null;
  private normal: ProjectionAxisRef | null = null;
  private display: 'radius' | 'diameter' = 'radius';

  pointerMove(screen: Vec2): void {
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
    if (this.currentPhase === 'pick-first') {
      const candidates = this.input.snapPort.query({
        screen,
        capabilities: ['circle', 'arc', 'point'],
        thresholdPx: this.input.thresholdPx ?? 18,
      });
      const circular = candidates.find(candidate =>
        (candidate.capability === 'circle' || candidate.capability === 'arc')
        && candidate.anchor.snapshot !== null
        && nonZero(candidate.direction)
        && nonZero(candidate.normal));
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
        this.currentPhase = 'ready';
        this.emitPreview(
          this.recordFrom(
            this.center,
            this.rim,
            this.normal,
            this.input.now(),
          ),
        );
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
      this.currentPhase = 'ready';
      this.emitPreview(
        this.recordFrom(this.center, this.rim, normal, this.input.now()),
      );
    }
  }

  selectDesignAxis(axis: 'x' | 'y' | 'z'): void {
    if (this.currentPhase !== 'pick-axis' || !this.center || !this.rim) return;
    this.normal = { kind: 'design-axis', axis };
    this.currentPhase = 'ready';
    this.emitPreview(
      this.recordFrom(this.center, this.rim, this.normal, this.input.now()),
    );
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
      placement: {
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

  constructor(private readonly input: DimensionPlacementEditSessionInput) {
    this.kind = input.record.kind;
    this.placement = input.record.placement;
  }

  get phase(): DimensionEditPhase {
    return this.currentPhase;
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

  constructor(private readonly input: DimensionRebindEditSessionInput) {
    this.kind = input.record.kind;
  }

  get phase(): DimensionEditPhase {
    return this.currentPhase;
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
