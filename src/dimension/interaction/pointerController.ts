import { dimensionEditStep, type DimensionEditSession, type DimensionEditStep } from './editSession';

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

/** 进行中的编辑会话给工具栏看的状态：哪一步、预校验没过的原因。没有会话时为 null。 */
export type DimensionSessionStatus = Readonly<{
  kind: DimensionEditSession['kind'];
  phase: DimensionEditSession['phase'];
  step: DimensionEditStep;
  validationErrors: readonly string[];
}>;

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
  flushProjection?: () => void;
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
  private interactionGate: (() => boolean) | null = null;
  private hoverId: string | null = null;
  private disposed = false;
  private readonly statusListeners = new Set<(status: DimensionSessionStatus | null) => void>();
  private lastStatusKey = '';

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
    this.publishStatus();
  }

  get sessionStatus(): DimensionSessionStatus | null {
    const session = this.activeSession;
    if (!session) return null;
    return {
      kind: session.kind,
      phase: session.phase,
      step: dimensionEditStep(session.phase),
      validationErrors: session.validationErrors ?? [],
    };
  }

  subscribeSessionStatus(
    listener: (status: DimensionSessionStatus | null) => void,
  ): () => void {
    this.statusListeners.add(listener);
    listener(this.sessionStatus);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  setEditSessionFactory(factory: DimensionEditSessionFactory | null): void {
    this.editSessionFactory = factory;
  }

  /**
   * 宿主可注入的交互门控：返回 false 时暂停尺寸的悬停/左键选中
   * （例如测量草稿进行中，落点必须优先于尺寸图形）。
   * 进行中的编辑会话不受门控影响。
   */
  setInteractionGate(gate: (() => boolean) | null): void {
    this.interactionGate = gate;
    if (gate && !gate()) this.setHover(null);
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
      this.publishStatus();
      return CONSUMED;
    }
    if (this.interactionGate && !this.interactionGate()) {
      this.setHover(null);
      return NOT_CONSUMED;
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
      this.publishStatus();
      return CONSUMED;
    }
    if (this.interactionGate && !this.interactionGate()) {
      return NOT_CONSUMED;
    }

    this.input.viewport.flushProjection?.();
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
      this.publishStatus();
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
      this.publishStatus();
    }
    return CONSUMED;
  }

  pointerCancel(): PointerDispatchResult {
    if (this.disposed || !this.activeSession) return NOT_CONSUMED;
    this.activeSession.cancel();
    this.activeSession = null;
    this.input.viewport.setPreview(null);
    this.publishStatus();
    return CONSUMED;
  }

  keyDown(event: KeyboardLikeEvent): PointerDispatchResult {
    if (event.key === 'Backspace') return this.backActiveSession();
    if (event.key !== 'Escape') return NOT_CONSUMED;
    return this.pointerCancel();
  }

  /** 退回上一步；会话已在第一步时不消费（交给宿主，比如退出工具）。 */
  backActiveSession(): PointerDispatchResult {
    if (this.disposed || !this.activeSession) return NOT_CONSUMED;
    if (!this.activeSession.back()) return NOT_CONSUMED;
    this.publishStatus();
    return CONSUMED;
  }

  finishActiveSession(): PointerDispatchResult {
    if (this.disposed || !this.activeSession?.finish) return NOT_CONSUMED;
    const finished = this.activeSession.finish();
    this.publishStatus();
    return finished ? CONSUMED : NOT_CONSUMED;
  }

  flipActiveSession(): PointerDispatchResult {
    if (this.disposed || !this.activeSession) return NOT_CONSUMED;
    this.activeSession.flip();
    this.publishStatus();
    return CONSUMED;
  }

  selectDesignAxis(axis: 'x' | 'y' | 'z'): PointerDispatchResult {
    if (this.disposed || !this.activeSession) return NOT_CONSUMED;
    const session = this.activeSession as DimensionEditSession & {
      selectDesignAxis?: (axis: 'x' | 'y' | 'z') => void;
    };
    if (!session.selectDesignAxis) return NOT_CONSUMED;
    session.selectDesignAxis(axis);
    this.publishStatus();
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
    this.publishStatus();
    this.statusListeners.clear();
    this.disposed = true;
  }

  private publishStatus(): void {
    const status = this.sessionStatus;
    const key = status
      ? `${status.kind}|${status.phase}|${status.validationErrors.join(',')}`
      : '';
    if (key === this.lastStatusKey) return;
    this.lastStatusKey = key;
    for (const listener of this.statusListeners) listener(status);
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
