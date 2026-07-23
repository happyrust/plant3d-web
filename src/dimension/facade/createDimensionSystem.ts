import { refreshDocumentAnchors } from '../domain/anchors';
import { createEmptyDimensionDocument } from '../domain/document';
import { layoutResultsToSvg } from '../export/svgOverlay';
import { DimensionPointerController } from '../interaction/pointerController';
import { DEFAULT_DIMENSION_FORMAT } from '../kernel/format';
import { SOLVESPACE_DIMENSION_THEME } from '../kernel/theme';
import { DimensionDocumentSession } from '../services/dimensionDocumentSession';
import { ExternalDimensionRegistry } from '../services/externalDimensionRegistry';
import { replayPendingCommands } from '../services/replayPendingCommands';
import { DimensionViewport } from '../viewport/dimensionViewport';
import { loadDimensionFont } from '../viewport/loadDimensionFont';
import { createDimensionViewerBindings } from '../viewport/viewerBindings';

import type { ExternalDimensionRecord } from '../adapters/normalizeExternalDimensions';
import type { DimensionCommand } from '../domain/commands';
import type { DimensionDocumentState } from '../domain/document';
import type { DimensionFormatPolicy } from '../kernel/format';
import type { LffFont } from '../kernel/glyph/lffParser';
import type { DimensionTheme } from '../kernel/theme';
import type { DimensionAnchorResolver } from '../ports/anchorResolver';
import type {
  DimensionDocumentRepository,
  SaveDimensionDocumentResult,
} from '../ports/repository';
import type { DimensionSnapPort } from '../ports/snapPort';
import type { DimensionCommandJournal } from '../services/commandJournal';
import type { ExternalDimensionSource } from '../services/externalDimensionRegistry';
import type { ReplayPendingCommandsResult } from '../services/replayPendingCommands';
import type { Camera, Matrix4, Object3D } from 'three';

/**
 * Everything the dimension system needs to know about the hosting viewer.
 * The adapter answers "what is the viewer state right now"; the host only
 * has to call `notifyViewerChanged()` whenever camera, container size, DPR
 * or the model matrix may have changed. What happens on a change (projector
 * construction, size/DPR diffing, frame coalescing) stays behind this seam.
 */
export type DimensionViewerAdapter = Readonly<{
  getCamera(): Camera | null;
  getScene(): Object3D | null;
  /** Design Space metres -> scene world (ADR 0008). */
  getDesignToWorld(): Matrix4;
  getSize(): Readonly<{
    widthCssPx: number;
    heightCssPx: number;
    dpr: number;
  }>;
  requestRender(): void;
}>;

export type DimensionAnchorRefreshReport = Readonly<{
  /** True when no resolver is configured or nothing had to be resolved. */
  skipped: boolean;
  records: number;
  invalidated: number;
}>;

export type DimensionSystem = Readonly<{
  document: DimensionDocumentSession;
  viewport: DimensionViewport;
  pointer: DimensionPointerController;
  /** Injected snap seam for upcoming creation commands; null until wired. */
  snapPort: DimensionSnapPort | null;
  externalRegistry: ExternalDimensionRegistry;
  /**
   * Crash-recovery commands found in the journal at composition time.
   * Detected but never auto-replayed (ADR 0034); replay is a caller decision.
   */
  pendingRecoveryCommands: readonly DimensionCommand[];
  hasPendingRecovery(): boolean;
  getRecoveryPreview(): ReplayPendingCommandsResult | null;
  stageRecovery(latest: DimensionDocumentState): ReplayPendingCommandsResult | null;
  acceptRecovery(): ReplayPendingCommandsResult | null;
  discardRecovery(): void;
  persistDocument(
    options?: Readonly<{ preserveHistory?: boolean }>,
  ): Promise<SaveDimensionDocumentResult | null>;
  notifyViewerChanged(): void;
  setExternalDimensions(records: readonly ExternalDimensionRecord[]): void;
  replaceExternalSource(
    source: ExternalDimensionSource,
    records: readonly ExternalDimensionRecord[],
  ): void;
  exportSvg(exportedAt?: number): string;
  refreshAnchors(now?: number): Promise<DimensionAnchorRefreshReport>;
  dispose(): void;
}>;

export type CreateDimensionSystemInput = Readonly<{
  /** Viewer canvas that receives pointer events. */
  inputCanvas: HTMLCanvasElement;
  viewer: DimensionViewerAdapter;
  journal: DimensionCommandJournal;
  context: Readonly<{
    documentId: string;
    taskId?: string;
    formId?: string;
  }>;
  repository?: DimensionDocumentRepository;
  snapPort?: DimensionSnapPort;
  anchorResolver?: DimensionAnchorResolver;
  requestFrame: (callback: FrameRequestCallback) => number;
  cancelFrame: (id: number) => void;
  theme?: DimensionTheme;
  format?: DimensionFormatPolicy;
  /** Test seam: font loading needs fetch + DecompressionStream in browsers. */
  loadFont?: () => Promise<LffFont>;
}>;

export type CreateDimensionSystemResult =
  | Readonly<{ ok: true; system: DimensionSystem }>
  | Readonly<{
      ok: false;
      stage: 'font' | 'document' | 'viewer';
      error: unknown;
    }>;

/**
 * Composition root for the dimension system (ADR 0006, plan 05 Task 1):
 * hydrates the document, loads the glyph font, wires session -> viewport ->
 * pointer -> viewer bindings, and returns one disposable facade. On font or
 * document failure no half-working canvas is mounted.
 */
export async function createDimensionSystem(
  input: CreateDimensionSystemInput,
): Promise<CreateDimensionSystemResult> {
  const [fontResult, documentResult] = await Promise.allSettled([
    (input.loadFont ?? loadDimensionFont)(),
    input.repository
      ? input.repository.load({
        taskId: input.context.taskId,
        formId: input.context.formId,
      })
      : Promise.resolve(createEmptyDimensionDocument(input.context)),
  ]);
  if (fontResult.status === 'rejected') {
    return { ok: false, stage: 'font', error: fontResult.reason };
  }
  if (documentResult.status === 'rejected') {
    return { ok: false, stage: 'document', error: documentResult.reason };
  }
  const font = fontResult.value;
  const initialState = documentResult.value;
  const scene = input.viewer.getScene();
  if (!scene) {
    return {
      ok: false,
      stage: 'viewer',
      error: new Error('Dimension viewer scene is unavailable'),
    };
  }

  const session = new DimensionDocumentSession({
    initialState,
    journal: input.journal,
  });
  const pendingRecoveryCommands: readonly DimensionCommand[] =
    session.pendingCommands;

  const theme = input.theme ?? SOLVESPACE_DIMENSION_THEME;
  const format = input.format ?? DEFAULT_DIMENSION_FORMAT;
  const viewport = new DimensionViewport({
    scene,
    font,
    theme,
    format,
    requestFrame: input.requestFrame,
    cancelFrame: input.cancelFrame,
    requestRender: () => input.viewer.requestRender(),
  });
  viewport.setDocument(session.state);
  const externalRegistry = new ExternalDimensionRegistry();
  const unsubscribeExternalRegistry = externalRegistry.subscribe(
    snapshot => viewport.setExternalDimensions(snapshot.visibleRecords),
  );
  const unsubscribe = session.subscribe(state => viewport.setDocument(state));

  const pointer = new DimensionPointerController({
    canvas: input.inputCanvas,
    viewport,
    applyCommand: command => session.apply(command),
  });

  const bindings = createDimensionViewerBindings({
    enabled: true,
    mainCanvas: input.inputCanvas,
    viewport,
    pointer,
    getCamera: () => input.viewer.getCamera(),
    getDesignToWorld: () => input.viewer.getDesignToWorld(),
    getSize: () => input.viewer.getSize(),
  })!;

  let disposed = false;
  let recoveryBase = initialState;
  let recoveryCommands: readonly DimensionCommand[] | null =
    pendingRecoveryCommands.length > 0 ? pendingRecoveryCommands : null;

  const getRecoveryPreview = (): ReplayPendingCommandsResult | null => {
    if (!recoveryCommands || disposed) return null;
    return replayPendingCommands(recoveryBase, recoveryCommands);
  };

  const refreshAnchors = async (
    now = Date.now(),
  ): Promise<DimensionAnchorRefreshReport> => {
    const resolver = input.anchorResolver;
    const before = session.state;
    if (!resolver || disposed) {
      return { skipped: true, records: before.records.length, invalidated: 0 };
    }
    const after = await refreshDocumentAnchors(before, resolver, now);
    if (after === before || disposed) {
      return { skipped: true, records: before.records.length, invalidated: 0 };
    }
    session.acceptRefreshedState(after);
    const invalidated = after.records.filter(
      (record, index) =>
        record.validity === 'invalid'
        && before.records[index]?.validity !== 'invalid',
    ).length;
    return { skipped: false, records: after.records.length, invalidated };
  };

  return {
    ok: true,
    system: {
      document: session,
      viewport,
      pointer,
      snapPort: input.snapPort ?? null,
      externalRegistry,
      pendingRecoveryCommands,
      hasPendingRecovery(): boolean {
        return recoveryCommands !== null;
      },
      getRecoveryPreview,
      stageRecovery(latest): ReplayPendingCommandsResult | null {
        if (disposed) return null;
        recoveryBase = latest;
        recoveryCommands = session.pendingCommands;
        return getRecoveryPreview();
      },
      acceptRecovery(): ReplayPendingCommandsResult | null {
        const preview = getRecoveryPreview();
        if (!preview) return null;
        session.acceptReplayedState(preview);
        recoveryCommands = null;
        return preview;
      },
      discardRecovery(): void {
        if (!recoveryCommands || disposed) return;
        session.discardPendingCommands(recoveryBase);
        recoveryCommands = null;
      },
      async persistDocument(options = {}): Promise<SaveDimensionDocumentResult | null> {
        if (!input.repository || disposed) return null;
        const stateToSave = session.state;
        const commandsAtStart = session.pendingCommands;
        const result = await input.repository.save(stateToSave);
        if (!result.ok || disposed) return result;

        const persistedIds = new Set(
          commandsAtStart.map(command => command.commandId),
        );
        const laterCommands = session.pendingCommands.filter(
          command => !persistedIds.has(command.commandId),
        );
        if (session.state === stateToSave && laterCommands.length === 0) {
          session.acceptPersistedState(result.state, options);
          return result;
        }

        const replay = replayPendingCommands(result.state, laterCommands);
        if (replay.rejected.length > 0) {
          return {
            ok: false,
            reason: 'invalid',
            message: 'Commands created during dimension save could not be replayed',
          };
        }
        session.acceptReplayedState(replay, options);
        return result;
      },
      notifyViewerChanged(): void {
        if (disposed) return;
        bindings.syncProjector();
      },
      setExternalDimensions(records): void {
        if (disposed) return;
        externalRegistry.clear();
        const sources = new Set<ExternalDimensionSource>(
          records.map(record => record.source),
        );
        sources.forEach((source) => {
          const sourceRecords = records.filter(record => record.source === source);
          if (sourceRecords.length > 0) {
            externalRegistry.replaceSource(source, sourceRecords);
          }
        });
      },
      replaceExternalSource(source, records): void {
        if (disposed) return;
        externalRegistry.replaceSource(source, records);
      },
      exportSvg(exportedAt = Date.now()): string {
        if (disposed) throw new Error('Dimension system is disposed');
        const size = input.viewer.getSize();
        return layoutResultsToSvg(
          viewport.getLayouts(),
          font,
          theme,
          {
            formatPolicy: format,
            viewport: size,
            exportedAt,
          },
        );
      },
      refreshAnchors,
      dispose(): void {
        if (disposed) return;
        disposed = true;
        bindings.dispose();
        unsubscribe();
        unsubscribeExternalRegistry();
        viewport.dispose();
      },
    },
  };
}
