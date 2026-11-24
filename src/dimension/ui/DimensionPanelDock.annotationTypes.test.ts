import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick } from 'vue';

import { emptyDimensionDocument } from '../domain/testFixtures';
import { ExternalDimensionRegistry } from '../services/externalDimensionRegistry';

import DimensionPanelDock from './DimensionPanelDock.vue';

import type { MbdDiagnosticsSourceSnapshot } from '@/composables/useMbdDiagnosticsStore';

import { useMbdDiagnosticsStore } from '@/composables/useMbdDiagnosticsStore';

const mocks = vi.hoisted(() => ({
  currentUser: { value: { id: 'designer-1', role: 'designer' } },
  dimensionSystem: { value: null as any },
}));

vi.mock('@/composables/useUserStore', () => ({
  useUserStore: () => ({ currentUser: mocks.currentUser }),
}));
vi.mock('@/composables/useViewerContext', () => ({
  useViewerContext: () => ({ dimensionSystem: mocks.dimensionSystem }),
}));
vi.mock('@/ribbon/toastBus', () => ({
  emitToast: vi.fn(),
}));

const apps: ReturnType<typeof createApp>[] = [];

function mountPanel(): HTMLElement {
  const host = document.createElement('div');
  document.body.append(host);
  const app = createApp(DimensionPanelDock);
  apps.push(app);
  app.mount(host);
  return host;
}

function createSystem() {
  const state = emptyDimensionDocument();
  return {
    externalRegistry: new ExternalDimensionRegistry(),
    document: {
      state,
      canUndo: false,
      canRedo: false,
      subscribe(listener: (next: typeof state) => void) {
        listener(state);
        return vi.fn();
      },
    },
    viewport: {
      getSelection: () => null,
      setSelection: vi.fn(),
      setDisplayMode: vi.fn(),
      subscribeSelection: () => vi.fn(),
      getLayouts: () => [] as readonly unknown[],
      subscribeLayouts: () => vi.fn(),
    },
    pointer: { start: vi.fn(), subscribeSessionStatus: vi.fn(() => () => undefined) },
    snapPort: null,
    getRecoveryPreview: () => null,
    acceptRecovery: vi.fn(),
    discardRecovery: vi.fn(),
    exportSvg: vi.fn(() => '<svg/>'),
  };
}

const PIPE_KINDS = ['linear_dim', 'angle_dim', 'label', 'leader_line', 'aid_line', 'aid_text', 'weld_mark', 'slope_mark'];

function source(
  refno: string,
  overrides: Partial<MbdDiagnosticsSourceSnapshot> = {},
): MbdDiagnosticsSourceSnapshot {
  return {
    refno,
    issues: [],
    skipped: [],
    layoutMode: null,
    notes: [],
    sourceVersion: null,
    isolines: [],
    loadError: null,
    ...overrides,
  };
}

function notImplemented(refno: string): MbdDiagnosticsSourceSnapshot['issues'][number] {
  return {
    id: `${refno}:layout.not_implemented`,
    severity: 'warning',
    category: 'other',
    message: '该标注类型的求解器还没有实现',
  };
}

async function show(sources: readonly MbdDiagnosticsSourceSnapshot[]): Promise<HTMLElement> {
  apps.splice(0).forEach(app => app.unmount());
  document.body.innerHTML = '';
  useMbdDiagnosticsStore().set({
    channel: 'api',
    sourceId: sources.map(entry => entry.refno).join(','),
    issues: sources.flatMap(entry => entry.issues),
    skipped: [],
    sources,
  });
  const host = mountPanel();
  await nextTick();
  return host;
}

afterEach(() => {
  apps.splice(0).forEach(app => app.unmount());
  document.body.innerHTML = '';
  mocks.dimensionSystem.value = null;
  useMbdDiagnosticsStore().clear();
});

/**
 * #103 M7 + 全九类覆盖声明对齐：「标注不完整」按九种标注类型各自挑期望集；
 * 不带覆盖声明（`coverage: null`）的包照旧不报。
 */
describe('DimensionPanelDock per-type completeness banner', () => {
  it('flags pipe, non-pipe, and untyped packages whenever declared coverage misses expected kinds', async () => {
    mocks.dimensionSystem.value = createSystem();

    const host = await show([
      source('P', { annotationType: 'em9_pipe', coverage: PIPE_KINDS.filter(kind => kind !== 'angle_dim') }),
      source('E', { annotationType: 'em4_equi', coverage: ['linear_dim', 'label', 'leader_line', 'aid_line', 'aid_text'] }),
      source('W', { annotationType: 'civil', coverage: null, layoutMode: 'isodim_main' }),
      source('L', { coverage: PIPE_KINDS.filter(kind => kind !== 'weld_mark') }),
    ]);

    const banner = host.querySelector('[data-testid="mbd-incomplete-annotation"]');
    expect(banner).not.toBeNull();
    const rows = [...banner!.querySelectorAll('[data-incomplete-refno]')];
    expect(rows.map(row => row.getAttribute('data-incomplete-refno'))).toEqual(['P', 'E', 'L']);
    expect(rows[0]!.textContent).toContain('angle_dim');
    expect(rows[1]!.textContent).toContain('angle_dim');
    expect(rows[2]!.textContent).toContain('weld_mark');
  });

  it('shows no banner when a non-pipe package declares its full expected coverage or omits coverage', async () => {
    mocks.dimensionSystem.value = createSystem();
    const banner = (host: HTMLElement) => host.querySelector('[data-testid="mbd-incomplete-annotation"]');

    expect(banner(await show([source('E', {
      annotationType: 'em4_equi',
      coverage: ['linear_dim', 'angle_dim', 'label', 'leader_line', 'aid_line', 'aid_text'],
    })]))).toBeNull();
    expect(banner(await show([
      source('S', { annotationType: 'em4_supp', coverage: null, layoutMode: 'isodim_main' }),
    ]))).toBeNull();
    expect(banner(await show([source('E2', { annotationType: 'em4_equi', coverage: [] })]))).not.toBeNull();
    expect(banner(await show([source('P', { annotationType: 'em4_pipe', coverage: [] })]))).not.toBeNull();
  });
});

describe('DimensionPanelDock annotation type labels', () => {
  it('labels a single source in the diagnostics summary', async () => {
    mocks.dimensionSystem.value = createSystem();

    const typed = await show([source('E', { annotationType: 'em4_equi', issues: [notImplemented('E')] })]);
    const summary = typed.querySelector('[data-testid="mbd-diagnostics"] > summary');
    expect(summary?.querySelector('[data-testid="mbd-annotation-type"]')?.textContent).toContain('EM4 设备');
    expect(summary?.textContent).toContain('E · EM4 设备');

    const untyped = await show([source('P', { issues: [notImplemented('P')] })]);
    expect(untyped.querySelector('[data-testid="mbd-diagnostics"]')).not.toBeNull();
    expect(untyped.querySelector('[data-testid="mbd-annotation-type"]')).toBeNull();
  });

  it('labels each source group when several packages share the view', async () => {
    mocks.dimensionSystem.value = createSystem();

    const host = await show([
      source('P', { annotationType: 'em4_pipe', issues: [notImplemented('P')] }),
      source('W', { annotationType: 'civil', issues: [notImplemented('W')] }),
      source('L', { issues: [notImplemented('L')] }),
    ]);

    const summaries = [...host.querySelectorAll('[data-testid="mbd-diagnostics-source"]')]
      .map(group => group.querySelector('summary')!);
    expect(summaries.map(summary => summary.querySelector('[data-testid="mbd-annotation-type"]')?.textContent?.trim() ?? null))
      .toEqual(['· EM4 管道', '· 土建结构', null]);
    expect(summaries[0]!.textContent).toContain('P · EM4 管道 · 1 条诊断');
    expect(summaries[2]!.textContent).toContain('L · 1 条诊断');
  });
});
