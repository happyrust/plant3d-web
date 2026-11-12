import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick } from 'vue';

import { emptyDimensionDocument } from '../domain/testFixtures';
import { ExternalDimensionRegistry } from '../services/externalDimensionRegistry';

import DimensionPanelDock from './DimensionPanelDock.vue';

import type { MbdV2Issue, MbdV2PipeData } from '../adapters/mbdV2Contract';
import type { MbdDiagnosticsSourceSnapshot } from '@/composables/useMbdDiagnosticsStore';

import { useMbdDiagnosticsStore } from '@/composables/useMbdDiagnosticsStore';
import { createMbdExternalSync } from '@/composables/useMbdExternalSync';

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

/** 求解器出口自检的原话（plant-mbd `validity.rs`）：一个图元不合契约、被拿掉。 */
function dropped(refno: string, index: number, overrides: Partial<MbdV2Issue> = {}): MbdV2Issue {
  return {
    id: `${refno}:contract.invalid_primitive:${index}`,
    severity: 'warning',
    category: 'data',
    message: `label ${refno}:name:${index} cannot be drawn and was dropped: text_dir is not a finite non-zero vector`,
    refno,
    object_refno: `${refno}-part-${index}`,
    rule_id: 'contract.invalid_primitive',
    ...overrides,
  };
}

function isolineWithoutAxis(refno: string): MbdV2Issue {
  return {
    id: `${refno}:contract.invalid_isoline:0:axis`,
    severity: 'info',
    category: 'data',
    message: 'isoline 0 has an axis whose ends coincide or are not finite; sent without an axis',
    refno,
    isoline_idx: 0,
    rule_id: 'contract.invalid_isoline',
  };
}

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

function publish(sources: readonly MbdDiagnosticsSourceSnapshot[]): void {
  useMbdDiagnosticsStore().set({
    channel: 'api',
    sourceId: sources.map(entry => entry.refno).join(','),
    issues: sources.flatMap(entry => entry.issues),
    skipped: sources.flatMap(entry => entry.skipped),
    sources,
  });
}

async function show(sources: readonly MbdDiagnosticsSourceSnapshot[]): Promise<HTMLElement> {
  apps.splice(0).forEach(app => app.unmount());
  document.body.innerHTML = '';
  publish(sources);
  const host = mountPanel();
  await nextTick();
  return host;
}

const banner = (host: HTMLElement) => host.querySelector('[data-testid="mbd-dropped-primitives"]');
const summaryOf = (host: HTMLElement) => host.querySelector('[data-testid="mbd-dropped-primitives-summary"]');
const toggleOf = (host: HTMLElement) =>
  host.querySelector('[data-testid="mbd-dropped-primitives-toggle"]') as HTMLButtonElement | null;
const detailsOf = (host: HTMLElement) => host.querySelector('[data-testid="mbd-dropped-primitives-details"]');
const entriesOf = (host: HTMLElement) => [...host.querySelectorAll('[data-testid="mbd-dropped-primitives-entry"]')];
const squeeze = (text: string | null | undefined) => (text ?? '').replace(/\s+/g, ' ').trim();

afterEach(() => {
  apps.splice(0).forEach(app => app.unmount());
  document.body.innerHTML = '';
  mocks.dimensionSystem.value = null;
  useMbdDiagnosticsStore().clear();
  window.history.replaceState({}, '', '/');
});

/**
 * 票 14（#103）：求解器的出口自检把不合契约的图元拿掉、逐处记 `contract.invalid_primitive`，其余照常下发。
 * 包是合契约的，前端照收；可这张图少了东西，只写在缺省收起的诊断里等于没说（ADR 0046：不得不声不响地显示
 * 不完整的图）。面板为此常驻一条横幅。
 */
describe('DimensionPanelDock dropped-primitives banner', () => {
  it('says the drawing is incomplete and how many places the solver took out', async () => {
    mocks.dimensionSystem.value = createSystem();

    const host = await show([
      source('24381_25804', { issues: [dropped('24381_25804', 0), dropped('24381_25804', 1)] }),
    ]);

    expect(banner(host)).not.toBeNull();
    const summary = summaryOf(host)!;
    expect(squeeze(summary.textContent)).toBe('本图不完整：求解器的出口自检拿掉了 2 处不合契约的图元。');
    expect(summary.getAttribute('role')).toBe('alert');
    // 收起时只有这一句和按钮：尺寸面板自己不能滚，横幅每高一行，下面的「MBD 诊断」就少露一行。
    expect(squeeze(banner(host)!.textContent).replace(/\s/g, ''))
      .toBe('本图不完整：求解器的出口自检拿掉了2处不合契约的图元。查看是哪2处');
    // 单包时不必再点一遍包名。
    expect(host.querySelector('[data-testid="mbd-dropped-primitives-source"]')).toBeNull();
  });

  it('shows no banner without the rule, and none for contract.invalid_isoline alone', async () => {
    mocks.dimensionSystem.value = createSystem();

    expect(banner(await show([source('A')]))).toBeNull();
    expect(banner(await show([source('24383_75665', { issues: [isolineWithoutAxis('24383_75665')] })]))).toBeNull();
    // 同一句话换个规则号也不认：只看规则号，不看文字。
    expect(banner(await show([
      source('A', { issues: [dropped('A', 0, { rule_id: 'support.part_geometry_missing' })] }),
    ]))).toBeNull();
  });

  it('is collapsed at first and expands, by a real button, to rule id, object and reason of each place', async () => {
    mocks.dimensionSystem.value = createSystem();
    const first = dropped('24381_25804', 0, { object_refno: '24381_25804' });
    const second = dropped('24381_25804', 1, { object_refno: undefined });

    const host = await show([source('24381_25804', { issues: [first, second] })]);

    const toggle = toggleOf(host)!;
    expect(toggle.tagName).toBe('BUTTON');
    expect(toggle.getAttribute('type')).toBe('button');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(squeeze(toggle.textContent)).toBe('查看是哪 2 处');
    expect(detailsOf(host)).toBeNull();

    toggle.click();
    await nextTick();

    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(squeeze(toggle.textContent)).toBe('收起');
    const details = detailsOf(host)!;
    expect(toggle.getAttribute('aria-controls')).toBe(details.id);
    expect(details.id).not.toBe('');
    const entries = entriesOf(host);
    expect(entries.map(entry => entry.getAttribute('data-issue-id'))).toEqual([first.id, second.id]);
    expect(squeeze(entries[0]!.textContent)).toBe(`contract.invalid_primitive · 对象 24381_25804 · ${first.message}`);
    expect(squeeze(entries[1]!.textContent)).toBe(`contract.invalid_primitive · 对象 未注明 · ${second.message}`);
    // 单包时清单上面不再写包名；全列出来了，也就没有「其余见诊断」那一句。
    expect(host.querySelector('[data-testid="mbd-dropped-primitives-group-title"]')).toBeNull();
    expect(host.querySelector('[data-testid="mbd-dropped-primitives-more"]')).toBeNull();
    // 展开后先交代后果和出处，再是清单。
    expect(squeeze(details.querySelector('[data-testid="mbd-dropped-primitives-note"]')?.textContent))
      .toBe('被拿掉的图元不会画出来，请勿据此判断标注已完整。下面各处的原因来自标注包的诊断：');
    // 清单自己限高、自己滚（面板不能滚，不限高的话后面几处会被裁在面板底边之外）；滚动区键盘也要够得着。
    const list = details.querySelector('[data-testid="mbd-dropped-primitives-list"]')!;
    expect(list.classList.contains('overflow-y-auto')).toBe(true);
    expect([...list.classList].some(name => name.startsWith('max-h-'))).toBe(true);
    expect(list.getAttribute('tabindex')).toBe('0');
    expect(list.getAttribute('role')).toBe('group');
    expect(list.getAttribute('aria-label')).toBe('被拿掉的 2 处');
    expect(list.querySelectorAll('[data-testid="mbd-dropped-primitives-entry"]')).toHaveLength(2);

    toggle.click();
    await nextTick();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(detailsOf(host)).toBeNull();
  });

  it('counts each package and names the packages when several share the view', async () => {
    mocks.dimensionSystem.value = createSystem();

    const host = await show([
      source('24384_108', { issues: [dropped('24384_108', 0)] }),
      source('24383_75665', { issues: [isolineWithoutAxis('24383_75665')] }),
      source('24381_25804', { issues: [dropped('24381_25804', 0), dropped('24381_25804', 1)] }),
    ]);

    const summary = summaryOf(host)!;
    // 头一句后面紧跟逐包的处数，连成一句读得通的话（都在 alert 里，一起读出来）。
    expect(squeeze(summary.textContent).replace(/\s/g, ''))
      .toBe('本图不完整：求解器的出口自检从2个标注包里拿掉了3处不合契约的图元。24384_108：1处；24381_25804：2处。');
    const rows = [...summary.querySelectorAll('[data-testid="mbd-dropped-primitives-source"]')];
    expect(rows.map(row => row.getAttribute('data-refno'))).toEqual(['24384_108', '24381_25804']);
    expect(rows.map(row => squeeze(row.textContent))).toEqual(['24384_108：1 处', '24381_25804：2 处']);
    expect(squeeze(toggleOf(host)!.textContent)).toBe('查看是哪 3 处');

    toggleOf(host)!.click();
    await nextTick();

    const groups = [...host.querySelectorAll('[data-testid="mbd-dropped-primitives-group"]')];
    expect(groups.map(group => group.getAttribute('data-refno'))).toEqual(['24384_108', '24381_25804']);
    expect(groups.map(group => squeeze(group.querySelector('[data-testid="mbd-dropped-primitives-group-title"]')?.textContent)))
      .toEqual(['标注包 24384_108（1 处）', '标注包 24381_25804（2 处）']);
    expect(groups.map(group => group.querySelectorAll('[data-testid="mbd-dropped-primitives-entry"]').length))
      .toEqual([1, 2]);
  });

  it('stands next to the partial-display banner without replacing it', async () => {
    mocks.dimensionSystem.value = createSystem();
    window.history.replaceState({}, '', '/?mbd_refno=A&mbd_partial=1');

    const host = await show([
      source('A', {
        issues: [dropped('A', 0)],
        skipped: [{ id: 'A:future:0', reason: 'unknown primitive kind future_kind' }],
      }),
    ]);

    expect(squeeze(host.querySelector('[data-testid="mbd-partial-banner"]')?.textContent))
      .toBe('已跳过 1 条，当前视图不代表完整标注。');
    expect(squeeze(summaryOf(host)?.textContent)).toBe('本图不完整：求解器的出口自检拿掉了 1 处不合契约的图元。');
  });

  it('lists at most 50 places and says where the rest are', async () => {
    mocks.dimensionSystem.value = createSystem();

    const host = await show([
      source('W', { issues: Array.from({ length: 53 }, (_, index) => dropped('W', index)) }),
    ]);

    expect(squeeze(summaryOf(host)!.textContent)).toBe('本图不完整：求解器的出口自检拿掉了 53 处不合契约的图元。');
    expect(host.querySelector('[data-testid="mbd-dropped-primitives-more"]')).toBeNull();

    toggleOf(host)!.click();
    await nextTick();

    expect(entriesOf(host)).toHaveLength(50);
    const more = host.querySelector('[data-testid="mbd-dropped-primitives-more"]');
    expect(squeeze(more?.textContent))
      .toBe('只列出前 50 处；其余 3 处见下方「MBD 诊断」里规则号为 contract.invalid_primitive 的条目。');
    // 这一句跟在清单后面、在同一个滚动区里，滚到底才看得到。
    expect(host.querySelector('[data-testid="mbd-dropped-primitives-list"]')!.contains(more)).toBe(true);
  });

  it('applies the 50-place limit across packages, not to each package', async () => {
    mocks.dimensionSystem.value = createSystem();
    const many = (refno: string) => Array.from({ length: 30 }, (_, index) => dropped(refno, index));

    const host = await show([source('A', { issues: many('A') }), source('B', { issues: many('B') })]);
    toggleOf(host)!.click();
    await nextTick();

    const groups = [...host.querySelectorAll('[data-testid="mbd-dropped-primitives-group"]')];
    expect(groups.map(group => group.querySelectorAll('[data-testid="mbd-dropped-primitives-entry"]').length))
      .toEqual([30, 20]);
    // 组头写的是这个包的全数，不是列出来的那几条。
    expect(squeeze(groups[1]!.querySelector('[data-testid="mbd-dropped-primitives-group-title"]')?.textContent))
      .toBe('标注包 B（30 处）');
    expect(squeeze(host.querySelector('[data-testid="mbd-dropped-primitives-more"]')?.textContent))
      .toContain('其余 10 处');
  });

  it('goes away with the package: another object, or no object at all', async () => {
    mocks.dimensionSystem.value = createSystem();
    const payload = (refno: string, issues: readonly MbdV2Issue[]): MbdV2PipeData => ({
      version: 'v2',
      input_refno: refno,
      branch_refno: refno,
      primitives: [{
        kind: 'linear_dim',
        id: `${refno}:dim-1`,
        start: [0, 0, 0],
        end: [1, 0, 0],
        text: '1000',
        extension_lines: [
          { from: [0, 0, 0], to: [0, 0.1, 0] },
          { from: [1, 0, 0], to: [1, 0.1, 0] },
        ],
        arrow_lines: [
          { from: [0, 0, 0], to: [0.1, 0.05, 0] },
          { from: [1, 0, 0], to: [0.9, 0.05, 0] },
        ],
        label_anchor: [0.5, 0.1, 0],
      }],
      meta: {
        geometry_space: 'source_mm',
        source_to_design: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        notes: [],
      },
      issues,
    });
    const packages: Record<string, MbdV2PipeData> = {
      WALL: payload('WALL', [dropped('WALL', 0), dropped('WALL', 1)]),
      SUPP: payload('SUPP', [dropped('SUPP', 0)]),
      CLEAN: payload('CLEAN', []),
    };
    let search = '';
    const sync = createMbdExternalSync({
      fetchPipeData: async refno => ({ ok: true as const, data: packages[refno]!, diagnostics: [] }),
      diagnostics: useMbdDiagnosticsStore(),
      getSearch: () => search,
      emitToast: vi.fn(),
    });
    const target = { replaceExternalSource: vi.fn() };
    const open = async (next: string): Promise<void> => {
      search = next;
      await sync.sync(target);
      await nextTick();
    };
    const host = mountPanel();
    await nextTick();
    expect(banner(host)).toBeNull();

    await open('?mbd_refno=WALL');
    expect(squeeze(summaryOf(host)?.textContent)).toBe('本图不完整：求解器的出口自检拿掉了 2 处不合契约的图元。');
    toggleOf(host)!.click();
    await nextTick();
    expect(entriesOf(host)).toHaveLength(2);

    // 同一个对象重新同步（地址里别的参数变了，`popstate` 很频繁）：横幅照旧，展开的清单不收。
    await open('?mbd_refno=WALL&mbd_lod=0');
    expect(squeeze(summaryOf(host)?.textContent)).toBe('本图不完整：求解器的出口自检拿掉了 2 处不合契约的图元。');
    expect(toggleOf(host)!.getAttribute('aria-expanded')).toBe('true');
    expect(entriesOf(host)).toHaveLength(2);

    // 换到另一个也被拿掉过图元的对象：横幅换成它的数，展开的清单收回去。
    await open('?mbd_refno=SUPP');
    expect(squeeze(summaryOf(host)?.textContent)).toBe('本图不完整：求解器的出口自检拿掉了 1 处不合契约的图元。');
    expect(toggleOf(host)!.getAttribute('aria-expanded')).toBe('false');
    expect(detailsOf(host)).toBeNull();

    // 换到一个干净的对象：横幅没了。
    await open('?mbd_refno=CLEAN');
    expect(banner(host)).toBeNull();

    // 两个对象同屏，再清空来源。
    await open('?mbd_refno=CLEAN,WALL');
    expect(squeeze(summaryOf(host)?.textContent))
      .toContain('本图不完整：求解器的出口自检从 1 个标注包里拿掉了 2 处不合契约的图元。');
    await open('');
    expect(banner(host)).toBeNull();
  });
});
