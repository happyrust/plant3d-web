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
    pointer: { start: vi.fn() },
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
 * #103 M7：「标注不完整」按标注类型挑期望集——管道两类与没声明类型的老后端包照旧，其它类型暂不判
 * （它们的期望集随各自求解器来，读取器到位前只有 `layout.not_implemented`，诊断里已经看得见）。
 */
describe('DimensionPanelDock per-type completeness banner', () => {
  it('flags only pipe packages and packages without a declared type', async () => {
    mocks.dimensionSystem.value = createSystem();

    const host = await show([
      source('P', { annotationType: 'em9_pipe', coverage: PIPE_KINDS.filter(kind => kind !== 'angle_dim') }),
      source('E', { annotationType: 'em4_equi', coverage: [] }),
      source('W', { annotationType: 'civil', coverage: null, layoutMode: 'isodim_main' }),
      source('L', { coverage: PIPE_KINDS.filter(kind => kind !== 'weld_mark') }),
    ]);

    const banner = host.querySelector('[data-testid="mbd-incomplete-annotation"]');
    expect(banner).not.toBeNull();
    const rows = [...banner!.querySelectorAll('[data-incomplete-refno]')];
    expect(rows.map(row => row.getAttribute('data-incomplete-refno'))).toEqual(['P', 'L']);
    expect(rows[0]!.textContent).toContain('angle_dim');
    expect(rows[1]!.textContent).toContain('weld_mark');
  });

  it('shows no banner for a lone non-pipe package, whatever coverage or layout mode it reports', async () => {
    mocks.dimensionSystem.value = createSystem();
    const banner = (host: HTMLElement) => host.querySelector('[data-testid="mbd-incomplete-annotation"]');

    expect(banner(await show([source('E', { annotationType: 'em4_equi', coverage: [] })]))).toBeNull();
    expect(banner(await show([
      source('S', { annotationType: 'em4_supp', coverage: null, layoutMode: 'isodim_main' }),
    ]))).toBeNull();
    // 同样的声明放在管道包上照旧报。
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
