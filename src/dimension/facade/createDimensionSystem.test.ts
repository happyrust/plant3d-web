import { describe, expect, it, vi } from 'vitest';

import { Group, Matrix4, PerspectiveCamera } from 'three';

import { createEmptyDimensionDocument } from '../domain/document';
import { exactAnchor, linearRecord } from '../domain/testFixtures';
import { createTestFont } from '../kernel/testUtils';

import { createDimensionSystem } from './createDimensionSystem';

import type { DimensionViewerAdapter } from './createDimensionSystem';
import type { ExternalDimensionRecord } from '../adapters/normalizeExternalDimensions';
import type { DimensionCommand } from '../domain/commands';
import type { DimensionDocumentState } from '../domain/document';
import type { DimensionAnchorResolver } from '../ports/anchorResolver';
import type { DimensionDocumentRepository } from '../ports/repository';
import type {
  DimensionCommandJournal,
  DimensionCommandJournalState,
} from '../services/commandJournal';

function createInputCanvas() {
  const addEventListener = vi.fn();
  const removeEventListener = vi.fn();
  const canvas = {
    addEventListener,
    removeEventListener,
    getBoundingClientRect: () => ({
      left: 0,
      top: 0,
      width: 400,
      height: 400,
    }),
  } as unknown as HTMLCanvasElement;
  return { canvas, addEventListener, removeEventListener };
}

function createViewerAdapter(
  overrides: Partial<DimensionViewerAdapter> = {},
): DimensionViewerAdapter {
  const camera = new PerspectiveCamera(50, 1, 0.1, 100);
  const scene = new Group();
  camera.position.set(0, 0, 10);
  camera.updateMatrixWorld(true);
  return {
    getCamera: () => camera,
    getScene: () => scene,
    getDesignToWorld: () => new Matrix4(),
    getSize: () => ({ widthCssPx: 400, heightCssPx: 400, dpr: 1 }),
    requestRender: vi.fn(),
    ...overrides,
  };
}

function createMemoryJournal(initial: DimensionCommandJournalState | null = null) {
  let stored = initial;
  const journal: DimensionCommandJournal = {
    load: documentId =>
      stored && stored.documentId === documentId ? stored : null,
    append: (documentId, baseVersion, command) => {
      stored = {
        version: 1,
        documentId,
        baseVersion,
        commands: [...(stored?.commands ?? []), command],
        updatedAt: command.at,
      };
    },
    replace: (state) => {
      stored = state;
    },
    clear: () => {
      stored = null;
    },
  };
  return { journal, get: () => stored };
}

function createHarness(input: {
  repository?: DimensionDocumentRepository;
  journal?: DimensionCommandJournal;
  anchorResolver?: DimensionAnchorResolver;
  viewer?: DimensionViewerAdapter;
} = {}) {
  const inputCanvas = createInputCanvas();
  const viewer = input.viewer ?? createViewerAdapter();
  const callbacks: FrameRequestCallback[] = [];
  const flush = () => callbacks.shift()?.(performance.now());
  const promise = createDimensionSystem({
    inputCanvas: inputCanvas.canvas,
    viewer,
    journal: input.journal ?? createMemoryJournal().journal,
    context: { documentId: 'doc-1' },
    repository: input.repository,
    anchorResolver: input.anchorResolver,
    requestFrame: (callback) => {
      callbacks.push(callback);
      return callbacks.length;
    },
    cancelFrame: () => undefined,
    loadFont: async () => createTestFont(),
  });
  return { scene: viewer.getScene(), inputCanvas, flush, promise };
}

function documentWithRecords(
  records: DimensionDocumentState['records'],
  baseVersion = 0,
): DimensionDocumentState {
  return {
    ...createEmptyDimensionDocument({ documentId: 'doc-1' }),
    baseVersion,
    records,
  };
}

async function createdSystem(harness: ReturnType<typeof createHarness>) {
  const result = await harness.promise;
  if (!result.ok) {
    throw new Error(`expected system, got ${result.stage} failure`);
  }
  return result.system;
}

describe('createDimensionSystem', () => {
  it('hydrates the document from the repository before any paint', async () => {
    let resolveLoad!: (state: DimensionDocumentState) => void;
    const repository: DimensionDocumentRepository = {
      load: () => new Promise((resolve) => {
        resolveLoad = resolve;
      }),
      save: async state => ({ ok: true, state }),
    };
    const harness = createHarness({ repository });

    await Promise.resolve();
    expect(harness.scene?.children).toHaveLength(0);

    resolveLoad(documentWithRecords([linearRecord()], 3));
    const system = await createdSystem(harness);

    expect(system.document.state.records.map(record => record.id))
      .toEqual(['linear-1']);
    expect(system.document.state.baseVersion).toBe(3);

    system.notifyViewerChanged();
    harness.flush();
    expect(harness.scene?.children).toHaveLength(1);
    expect(harness.scene?.children[0]?.children).toHaveLength(2);
  });

  it('reports a typed document failure without mounting a canvas', async () => {
    const repository: DimensionDocumentRepository = {
      load: () => Promise.reject(new Error('backend down')),
      save: async state => ({ ok: true, state }),
    };
    const harness = createHarness({ repository });
    const result = await harness.promise;

    expect(result).toMatchObject({ ok: false, stage: 'document' });
    expect(harness.inputCanvas.addEventListener).not.toHaveBeenCalled();
    expect(harness.scene?.children).toHaveLength(0);
  });

  it('detects journal commands without replaying them', async () => {
    const command: DimensionCommand = {
      type: 'create',
      commandId: 'cmd-recovered',
      actorId: 'owner',
      actorRole: 'designer',
      at: 5,
      record: linearRecord(),
    };
    const { journal } = createMemoryJournal({
      version: 1,
      documentId: 'doc-1',
      baseVersion: 0,
      commands: [command],
      updatedAt: 5,
    });
    const system = await createdSystem(createHarness({ journal }));

    expect(system.pendingRecoveryCommands).toHaveLength(1);
    expect(system.document.state.records).toHaveLength(0);
    expect(system.document.dirty).toBe(true);
    expect(system.hasPendingRecovery()).toBe(true);
    expect(system.getRecoveryPreview()?.state.records).toHaveLength(1);

    const preview = system.acceptRecovery();

    expect(preview?.rejected).toEqual([]);
    expect(system.document.state.records).toHaveLength(1);
    expect(system.hasPendingRecovery()).toBe(false);
  });

  it('can discard journal recovery without changing the loaded document', async () => {
    const command: DimensionCommand = {
      type: 'create',
      commandId: 'cmd-discarded',
      actorId: 'owner',
      actorRole: 'designer',
      at: 5,
      record: linearRecord(),
    };
    const memory = createMemoryJournal({
      version: 1,
      documentId: 'doc-1',
      baseVersion: 0,
      commands: [command],
      updatedAt: 5,
    });
    const system = await createdSystem(createHarness({ journal: memory.journal }));

    system.discardRecovery();

    expect(system.document.state.records).toEqual([]);
    expect(system.document.dirty).toBe(false);
    expect(memory.get()).toBeNull();
    expect(system.hasPendingRecovery()).toBe(false);
  });

  it('persists a local document while preserving undo history', async () => {
    const repository: DimensionDocumentRepository = {
      load: async () => documentWithRecords([]),
      save: async state => ({
        ok: true,
        state: { ...state, baseVersion: state.baseVersion + 1 },
      }),
    };
    const system = await createdSystem(createHarness({ repository }));
    const applied = system.document.apply({
      type: 'create',
      commandId: 'cmd-local-save',
      actorId: 'owner',
      actorRole: 'designer',
      at: 10,
      record: linearRecord({ id: 'local-save' }),
    });
    expect(applied.ok).toBe(true);

    const saved = await system.persistDocument({ preserveHistory: true });

    expect(saved).toMatchObject({ ok: true, state: { baseVersion: 1 } });
    expect(system.document.dirty).toBe(false);
    expect(system.document.canUndo).toBe(true);
    expect(system.document.state.records.map(record => record.id))
      .toEqual(['local-save']);
  });

  it('exports the current overlay as deterministic SVG geometry', async () => {
    const harness = createHarness({
      repository: {
        load: async () => documentWithRecords([linearRecord()]),
        save: async state => ({ ok: true, state }),
      },
    });
    const system = await createdSystem(harness);
    system.notifyViewerChanged();
    harness.flush();

    const svg = system.exportSvg(123);

    expect(svg).toContain('<svg');
    expect(svg).toContain('data-dimension-id="linear-1"');
    expect(svg).toContain('&quot;exportedAt&quot;:123');
    expect(svg).not.toContain('<text');
  });

  it('tears down pointer and viewport exactly once', async () => {
    const harness = createHarness();
    const system = await createdSystem(harness);

    expect(harness.inputCanvas.addEventListener).toHaveBeenCalledTimes(4);
    expect(harness.scene?.children).toHaveLength(1);
    system.dispose();
    system.dispose();

    expect(harness.inputCanvas.removeEventListener).toHaveBeenCalledTimes(4);
    expect(harness.scene?.children).toHaveLength(0);
    system.notifyViewerChanged();
    harness.flush();
    expect(harness.scene?.children).toHaveLength(0);
  });

  it('never lets external records touch the document', async () => {
    const harness = createHarness();
    const system = await createdSystem(harness);
    const before = system.document.state;
    const external: ExternalDimensionRecord = {
      id: 'external-1',
      source: 'mbd',
      sourceLabel: 'MBD',
      role: 'external',
      layout: {
        id: 'external-1',
        kind: 'linear',
        role: 'external',
        labelPinned: false,
        a: [0, 0, 0],
        b: [1, 0, 0],
        placement: { offsetM: 0.2, labelT: 0.5, side: 1 },
      },
    };

    system.setExternalDimensions([external]);

    expect(system.document.state).toBe(before);
  });

  it('skips anchor refresh when no resolver is configured', async () => {
    const system = await createdSystem(createHarness());
    await expect(system.refreshAnchors()).resolves.toEqual({
      skipped: true,
      records: 0,
      invalidated: 0,
    });
  });

  it('refreshes semantic anchors while preserving journal and undo', async () => {
    const repository: DimensionDocumentRepository = {
      load: async () => documentWithRecords([
        linearRecord({
          a: exactAnchor([0, 0, 0], {
            source: 'p-point',
            candidateId: 'candidate-1',
          }),
        }),
      ]),
      save: async state => ({ ok: true, state }),
    };
    const resolver: DimensionAnchorResolver = {
      resolveMany: async refs => refs.map(() => ({
        ok: true as const,
        anchor: { snapshot: [5, 0, 0] as const, accuracy: 'exact' as const },
      })),
    };
    const memory = createMemoryJournal();
    const system = await createdSystem(createHarness({
      repository,
      journal: memory.journal,
      anchorResolver: resolver,
    }));

    const applied = system.document.apply({
      type: 'create',
      commandId: 'cmd-user',
      actorId: 'owner',
      actorRole: 'designer',
      at: 10,
      record: linearRecord({ id: 'linear-2' }),
    });
    expect(applied.ok).toBe(true);

    const report = await system.refreshAnchors(123);

    expect(report).toEqual({ skipped: false, records: 2, invalidated: 0 });
    const refreshed = system.document.state.records
      .find(record => record.id === 'linear-1');
    expect(refreshed?.kind === 'linear' && refreshed.a.snapshot)
      .toEqual([5, 0, 0]);
    expect(system.document.canUndo).toBe(true);
    expect(memory.get()?.commands.map(command => command.commandId))
      .toEqual(['cmd-user']);
  });

  it('ignores viewer notifications while the camera is unavailable', async () => {
    const harness = createHarness({
      viewer: createViewerAdapter({ getCamera: () => null }),
    });
    const system = await createdSystem(harness);

    system.notifyViewerChanged();
    harness.flush();

    expect(system.viewport.getLayouts()).toHaveLength(0);
  });
});
