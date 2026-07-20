export type DimensionViewportDirtyReason =
  | 'document'
  | 'external'
  | 'camera'
  | 'size'
  | 'dpr'
  | 'theme'
  | 'format'
  | 'interaction'
  | 'preview';

export class InvalidationSet {
  private reasons = new Set<DimensionViewportDirtyReason>();

  add(reason: DimensionViewportDirtyReason): void {
    this.reasons.add(reason);
  }

  consume(): ReadonlySet<DimensionViewportDirtyReason> {
    const consumed = this.reasons;
    this.reasons = new Set();
    return consumed;
  }

  get dirty(): boolean {
    return this.reasons.size > 0;
  }
}

export class DimensionViewportScheduler {
  private readonly invalidations = new InvalidationSet();
  private frameId: number | null = null;
  private disposed = false;

  constructor(private readonly input: Readonly<{
    requestFrame: (callback: FrameRequestCallback) => number;
    cancelFrame: (id: number) => void;
    onFrame: (
      reasons: ReadonlySet<DimensionViewportDirtyReason>,
      timestamp: number,
    ) => void;
  }>) {}

  invalidate(reason: DimensionViewportDirtyReason): void {
    if (this.disposed) return;
    this.invalidations.add(reason);
    this.schedule();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.frameId !== null) {
      this.input.cancelFrame(this.frameId);
      this.frameId = null;
    }
    this.invalidations.consume();
  }

  private schedule(): void {
    if (this.disposed || this.frameId !== null) return;
    this.frameId = this.input.requestFrame(timestamp => {
      this.frameId = null;
      if (this.disposed) return;
      const reasons = this.invalidations.consume();
      if (reasons.size > 0) this.input.onFrame(reasons, timestamp);
      if (this.invalidations.dirty) this.schedule();
    });
  }
}
