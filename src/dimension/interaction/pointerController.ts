import type { DimensionEditSession } from './editSession';
import type { DimensionCommand } from '../domain/commands';
import type { Vec2 } from '../domain/types';
import type { HitTarget } from '../kernel/hit/hitIndex';
import type { Vec2 as KernelVec2 } from '../kernel/types';

export type PointerDispatchResult =
  | Readonly<{ consumed: false }>
  | Readonly<{ consumed: true; requestRender: true }>;

export type DimensionCommandApplyResult =
  | Readonly<{ ok: true }>
  | Readonly<{
      ok: false;
      reason:
        | 'duplicate-id'
        | 'not-found'
        | 'forbidden'
        | 'kind-mismatch'
        | 'invalid-command';
    }>;

export type DimensionCommitOutcome =
  | DimensionCommandApplyResult
  | Readonly<{ ok: false; reason: 'exception'; error: unknown }>;

export type DimensionEditSessionFactory = (
  target: HitTarget,
  screen: Vec2,
) => DimensionEditSession | null;

type PointerLikeEvent = Readonly<{
  clientX: number;
  clientY: number;
}>;

type KeyboardLikeEvent = Readonly<{
  key: string;
}>;

type DimensionPointerViewport = Readonly<{
  hitTest(point: KernelVec2, tolerancePx: number): HitTarget | null;
  setHover(id: string | null): void;
  setSelection(id: string | null): void;
  setPreview(input: null): void;
}>;

const NOT_CONSUMED: PointerDispatchResult = { consumed: false };
const CONSUMED: PointerDispatchResult = {
  consumed: true,
  requestRender: true,
};

export class DimensionPointerController {
  private activeSession: DimensionEditSession | null = null;
  private lastCommitResult: DimensionCommitOutcome | null = null;
  private editSessionFactory: DimensionEditSessionFactory | null = null;
  private commitResultHandler:
    | ((outcome: DimensionCommitOutcome) => void)
    | null = null;
  private hoverId: string | null = null;
  private disposed = false;

  constructor(private readonly input: Readonly<{
    canvas: HTMLCanvasElement;
    viewport: DimensionPointerViewport;
    applyCommand: (command: DimensionCommand) => DimensionCommandApplyResult;
    hitTolerancePx?: number;
  }>) {}

  get hasActiveSession(): boolean {
    return this.activeSession !== null;
  }

  start(session: DimensionEditSession): void {
    if (this.disposed) return;
    this.activeSession?.cancel();
    this.activeSession = session;
    this.lastCommitResult = null;
    this.setHover(null);
  }

  setEditSessionFactory(factory: DimensionEditSessionFactory | null): void {
    this.editSessionFactory = factory;
  }

  setCommitResultHandler(
    handler: ((outcome: DimensionCommitOutcome) => void) | null,
  ): void {
    this.commitResultHandler = handler;
  }

  pointerMove(event: PointerLikeEvent): PointerDispatchResult {
    if (this.disposed) return NOT_CONSUMED;
    const screen = this.toScreen(event);
    if (this.activeSession) {
      this.activeSession.pointerMove(screen);
      return CONSUMED;
    }

    const hit = this.input.viewport.hitTest(
      [screen.x, screen.y],
      this.input.hitTolerancePx ?? 6,
    );
    this.setHover(hit?.dimensionId ?? null);
    return hit ? CONSUMED : NOT_CONSUMED;
  }

  pointerDown(event: PointerLikeEvent): PointerDispatchResult {
    if (this.disposed) return NOT_CONSUMED;
    const screen = this.toScreen(event);
    if (this.activeSession) {
      this.activeSession.pointerDown(screen);
      return CONSUMED;
    }

    const hit = this.input.viewport.hitTest(
      [screen.x, screen.y],
      this.input.hitTolerancePx ?? 6,
    );
    if (!hit) return NOT_CONSUMED;
    this.input.viewport.setSelection(hit.dimensionId);
    const editSession = this.editSessionFactory?.(hit, screen) ?? null;
    if (editSession) this.start(editSession);
    return CONSUMED;
  }

  pointerUp(event: PointerLikeEvent): PointerDispatchResult {
    if (this.disposed || !this.activeSession) return NOT_CONSUMED;
    const screen = this.toScreen(event);
    if (this.activeSession.phase !== 'ready') {
      this.activeSession.pointerMove(screen);
      return CONSUMED;
    }

    try {
      const command = this.activeSession.commit();
      if (command) {
        const outcome = this.input.applyCommand(command);
        this.lastCommitResult = outcome;
        this.commitResultHandler?.(outcome);
      }
    } catch (error) {
      const outcome: DimensionCommitOutcome = {
        ok: false,
        reason: 'exception',
        error,
      };
      this.lastCommitResult = outcome;
      this.commitResultHandler?.(outcome);
    } finally {
      this.activeSession = null;
      this.input.viewport.setPreview(null);
    }
    return CONSUMED;
  }

  pointerCancel(): PointerDispatchResult {
    if (this.disposed || !this.activeSession) return NOT_CONSUMED;
    this.activeSession.cancel();
    this.activeSession = null;
    this.input.viewport.setPreview(null);
    return CONSUMED;
  }

  keyDown(event: KeyboardLikeEvent): PointerDispatchResult {
    if (event.key !== 'Escape') return NOT_CONSUMED;
    return this.pointerCancel();
  }

  flipActiveSession(): PointerDispatchResult {
    if (this.disposed || !this.activeSession) return NOT_CONSUMED;
    this.activeSession.flip();
    return CONSUMED;
  }

  selectDesignAxis(axis: 'x' | 'y' | 'z'): PointerDispatchResult {
    if (this.disposed || !this.activeSession) return NOT_CONSUMED;
    const session = this.activeSession as DimensionEditSession & {
      selectDesignAxis?: (axis: 'x' | 'y' | 'z') => void;
    };
    if (!session.selectDesignAxis) return NOT_CONSUMED;
    session.selectDesignAxis(axis);
    return CONSUMED;
  }

  getLastCommitResult(): DimensionCommitOutcome | null {
    return this.lastCommitResult;
  }

  dispose(): void {
    if (this.disposed) return;
    this.activeSession?.cancel();
    this.activeSession = null;
    this.input.viewport.setPreview(null);
    this.setHover(null);
    this.disposed = true;
  }

  private toScreen(event: PointerLikeEvent): Vec2 {
    const rect = this.input.canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  }

  private setHover(id: string | null): void {
    if (this.hoverId === id) return;
    this.hoverId = id;
    this.input.viewport.setHover(id);
  }
}
