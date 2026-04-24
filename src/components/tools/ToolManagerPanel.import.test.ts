import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick, ref } from 'vue';

const importJSON = vi.hoisted(() => vi.fn());
const exportJSON = vi.hoisted(() => vi.fn(() => '{"version":5}'));
const mergeFromSnapshot = vi.hoisted(() => vi.fn(() => ({ changed: false })));
const pushEvent = vi.hoisted(() => vi.fn());
const runImportPayloadShadow = vi.hoisted(() => vi.fn());
const syncFromStore = vi.hoisted(() => vi.fn());

vi.mock('@/components/review/debugUiGate', () => ({
  isReviewDebugUiEnabled: () => false,
}));

vi.mock('@/composables/useDbMetaInfo', () => ({
  ensureDbMetaInfoLoaded: vi.fn(),
  getDbnumByRefno: vi.fn(() => 1112),
}));

vi.mock('@/composables/useModelGeneration', () => ({
  useModelGeneration: () => ({
    showModelByRefno: vi.fn(async () => true),
    error: { value: null },
  }),
}));

vi.mock('@/composables/useToolStore', () => ({
  useToolStore: () => ({
    exportJSON,
    importJSON,
    measurementCount: 0,
    annotationCount: 0,
  }),
}));

vi.mock('@/composables/useUnitSettingsStore', () => ({
  useUnitSettingsStore: () => ({
    modelUnit: { value: 'm' },
    displayUnit: { value: 'm' },
    precision: { value: 2 },
    recenter: { value: false },
    clip: { value: false },
    autoFitOnLoad: { value: false },
    ptsetDisplayPolicy: { value: 'use_display_unit' },
    setModelUnit: vi.fn(),
    setDisplayUnit: vi.fn(),
    setPrecision: vi.fn(),
    setRecenter: vi.fn(),
    setClip: vi.fn(),
    setAutoFitOnLoad: vi.fn(),
    setPtsetDisplayPolicy: vi.fn(),
  }),
}));

vi.mock('@/composables/useViewerContext', () => ({
  useViewerContext: () => ({
    viewerRef: { value: null },
  }),
}));

vi.mock('@/utils/unitFormat', () => ({
  formatLengthMeters: vi.fn(() => '0m'),
  formatVec3Meters: vi.fn(() => '(0,0,0)'),
}));

vi.mock('@/review/adapters/importSnapshotAdapter', () => ({
  buildSnapshotFromImportPayload: vi.fn((payload: Record<string, unknown>) => ({
    source: 'import_package',
    annotations: [{ annotationId: 'text-1', annotationType: 'text', payload: payload.annotations?.[0] }],
    comments: [],
    measurements: [],
    attachments: [],
    models: [],
    meta: { sourceVersion: 1, createdAt: 1 },
  })),
}));

vi.mock('@/review/adapters/toolStoreAdapter', () => ({
  buildReplayPayloadFromImportSnapshot: vi.fn(() => '{"version":5,"annotations":[{"id":"text-1"}]}'),
}));

vi.mock('@/review/services/reviewSnapshotService', () => ({
  runImportPayloadShadow,
}));

vi.mock('@/review/services/sharedStores', () => ({
  getReviewCommentThreadStore: vi.fn(() => ({
    mergeFromSnapshot,
  })),
  getReviewCommentEventLog: vi.fn(() => ({
    push: pushEvent,
  })),
}));

import ToolManagerPanel from './ToolManagerPanel.vue';

describe('ToolManagerPanel import cutover', () => {
  beforeEach(() => {
    importJSON.mockReset();
    mergeFromSnapshot.mockReset();
    pushEvent.mockReset();
    runImportPayloadShadow.mockReset();
    syncFromStore.mockReset();
  });

  it('routes production import through ReviewSnapshot replay payload', async () => {
    let host: HTMLDivElement | null = document.createElement('div');
    document.body.appendChild(host);

    const app = createApp(ToolManagerPanel, {
      tools: {
        ready: ref(true),
        syncFromStore,
        clearAllInScene: vi.fn(),
      },
    });
    app.mount(host);
    await nextTick();

    const textarea = host.querySelector('textarea[placeholder="粘贴 JSON 后点击导入"]') as HTMLTextAreaElement | null;
    expect(textarea).toBeTruthy();
    if (!textarea) {
      throw new Error('import textarea not found');
    }
    textarea.value = JSON.stringify({
      version: 5,
      annotations: [{ id: 'text-1', title: 'imported' }],
    });
    textarea.dispatchEvent(new Event('input'));
    await nextTick();

    const buttons = Array.from(host.querySelectorAll('button')) as HTMLButtonElement[];
    const importButton = buttons.find((button) => button.textContent?.includes('导入并同步'));
    expect(importButton).toBeTruthy();
    importButton?.click();
    await nextTick();

    expect(runImportPayloadShadow).toHaveBeenCalledWith({
      legacyPayload: JSON.stringify({
        version: 5,
        annotations: [{ id: 'text-1', title: 'imported' }],
      }),
      payload: {
        version: 5,
        annotations: [{ id: 'text-1', title: 'imported' }],
      },
    });
    expect(importJSON).toHaveBeenCalledWith('{"version":5,"annotations":[{"id":"text-1"}]}');
    expect(syncFromStore).toHaveBeenCalledTimes(1);

    app.unmount();
    host.remove();
    host = null;
  });
});
