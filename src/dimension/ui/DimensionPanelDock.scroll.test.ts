import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick } from 'vue';

import { emptyDimensionDocument } from '../domain/testFixtures';
import { ExternalDimensionRegistry } from '../services/externalDimensionRegistry';

import DimensionPanelDock from './DimensionPanelDock.vue';

import type { MbdV2Issue } from '../adapters/mbdV2Contract';
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

function issue(refno: string, ruleId: string, index: number): MbdV2Issue {
  return {
    id: `${refno}:${ruleId}:${index}`,
    severity: 'warning',
    category: 'data',
    message: `${ruleId} ${index}`,
    refno,
    rule_id: ruleId,
  };
}

/** 一个把面板里会出现的块全叫出来的标注包：声明没产出的类别、被拿掉的图元、普通诊断。 */
function crowdedSource(refno: string): MbdDiagnosticsSourceSnapshot {
  return {
    refno,
    issues: [
      issue(refno, 'contract.invalid_primitive', 0),
      issue(refno, 'support.nothing_to_annotate', 1),
      issue(refno, 'support.part_geometry_missing', 2),
    ],
    skipped: [],
    layoutMode: 'linear_mvp',
    notes: [],
    sourceVersion: null,
    isolines: [],
    loadError: null,
  };
}

async function showCrowdedPanel(): Promise<HTMLElement> {
  mocks.dimensionSystem.value = createSystem();
  const sources = [crowdedSource('A'), crowdedSource('B')];
  useMbdDiagnosticsStore().set({
    channel: 'api',
    sourceId: 'A,B',
    issues: sources.flatMap(entry => entry.issues),
    skipped: [],
    layoutMode: 'linear_mvp',
    sources,
  });
  const host = mountPanel();
  await nextTick();
  return host;
}

const rootOf = (host: HTMLElement) => host.firstElementChild as HTMLElement;
const classesOf = (element: Element | null | undefined) => [...(element?.classList ?? [])];

/** 面板里从上到下的每一块；工具栏之外的都得能滚到。 */
const SCROLLED_BLOCKS = [
  'pipe-information-panel',
  'mbd-refno',
  'show-refno',
  'mbd-incomplete-annotation',
  'mbd-dropped-primitives',
  'mbd-partial-display',
  'mbd-kind-filter',
  'mbd-mode',
  'mbd-diagnostics',
] as const;

afterEach(() => {
  apps.splice(0).forEach(app => app.unmount());
  document.body.innerHTML = '';
  mocks.dimensionSystem.value = null;
  useMbdDiagnosticsStore().clear();
  window.history.replaceState({}, '', '/');
});

/**
 * 尺寸面板可滚动（新票）。面板里从上到下叠着工具栏、管道信息、两个 BRAN 块、几条横幅、几块开关、诊断区，最后才是尺寸列表；
 * 加起来一超过面板高度，下面的就被根元素的 `overflow-hidden` 裁掉，鼠标滚轮够不着。2026-11-12 页面里量的（1080 高的视口）：
 * 滚轮在面板上滚 2000 px，面板滚了 0 px；空支架 `24383_80213` 展开诊断后第 2–6 行整行落在面板底边之外；四个包同屏时连
 * 「MBD 诊断」那一行都被挤出去。
 *
 * happy-dom 不排版，量不出滚动距离，这里守的是「能滚」所依赖的结构：谁是滚动容器、每一块是不是它的直接内容、工具栏靠什么
 * 留在顶上、尺寸列表为什么不会被压成 0 高、键盘靠什么够得着。真的滚到底、点得到，在真浏览器里量
 * （`docs/verification/mbd-live-sweep-2026-11-11/page-p1.md`）。
 */
describe('DimensionPanelDock：内容超出面板高度时能滚', () => {
  it('makes the panel root the scroll container instead of clipping what does not fit', async () => {
    const root = rootOf(await showCrowdedPanel());

    // 高度由 dock 给（h-full），内容竖排；超出的部分由它自己滚，不再裁掉。
    expect(classesOf(root)).toEqual(expect.arrayContaining(['flex', 'h-full', 'flex-col', 'overflow-y-auto']));
    expect(classesOf(root)).not.toContain('overflow-hidden');
    expect(classesOf(root)).not.toContain('overflow-y-hidden');
    // 横向照旧不出滚动条：长的参考号、长句子在各块里自己折行。
    expect(classesOf(root)).toContain('overflow-x-hidden');
  });

  it('keeps every block below the toolbar as direct content of that scroll container', async () => {
    const host = await showCrowdedPanel();
    const root = rootOf(host);

    for (const testId of SCROLLED_BLOCKS) {
      const block = host.querySelector(`[data-testid="${testId}"]`);
      expect(block, testId).not.toBeNull();
      // 从这一块往上走到根：中间不许有把它裁掉的祖先（管道信息那一块外面有一层自己限高、自己滚的包装，算它自己的）。
      let step = block!.parentElement;
      while (step && step !== root) {
        expect(classesOf(step), `${testId} 的祖先`).not.toContain('overflow-hidden');
        step = step.parentElement;
      }
      expect(step, `${testId} 不在滚动容器里`).toBe(root);
    }
    // 竖排的弹性容器里，孩子缺省不会被压到比内容矮（min-height: auto），所以内容超出时是容器滚、不是这些块被压扁；
    // 谁也不许带把它压没的 min-h-0 / basis-0。
    for (const child of [...root.children]) {
      expect(classesOf(child), child.getAttribute('data-testid') ?? child.tagName).not.toContain('min-h-0');
      expect(classesOf(child)).not.toContain('flex-1');
      expect(classesOf(child)).not.toContain('basis-0');
    }
  });

  it('pins the toolbar to the top of the scroll container', async () => {
    const host = await showCrowdedPanel();
    const root = rootOf(host);
    const toolbar = host.querySelector('[aria-label="尺寸创建工具"]');

    expect(toolbar).not.toBeNull();
    // 工具栏是滚动容器的第一个孩子、粘在顶边：下面的内容从它底下滚过去，它不跟着走。
    expect(root.firstElementChild).toBe(toolbar);
    expect(classesOf(toolbar)).toEqual(expect.arrayContaining(['sticky', 'top-0', 'z-10', 'shrink-0']));
    // 它得盖得住从底下滚过去的内容。
    expect(classesOf(toolbar)).toContain('bg-white');
    // 键盘把焦点移到上面的控件时，浏览器按滚动内边距留出工具栏的高度，焦点不会落在工具栏背后。
    expect(classesOf(root).some(name => /^scroll-pt-/.test(name))).toBe(true);
  });

  it('lets the dimension list keep its own height so the panel scrolls instead of squeezing the list to nothing', async () => {
    const host = await showCrowdedPanel();
    const root = rootOf(host);
    const list = host.querySelector('.dimension-semantic-list');

    expect(list).not.toBeNull();
    const wrapper = list!.parentElement!;
    expect(wrapper.parentElement).toBe(root);
    // 以前是 `min-h-0 flex-1`：上面的块一多，它被分到 0 高。现在不许收缩（内容多高就多高，面板来滚），有富余时照旧撑满。
    expect(classesOf(wrapper)).toEqual(expect.arrayContaining(['shrink-0', 'grow']));
    // 列表排在最后：滚到底看到的是它。
    expect(root.lastElementChild).toBe(wrapper);
  });

  it('is reachable from the keyboard: the scroll container takes focus and has a name', async () => {
    const root = rootOf(await showCrowdedPanel());

    expect(root.getAttribute('tabindex')).toBe('0');
    expect(root.getAttribute('role')).toBe('region');
    expect(root.getAttribute('aria-label')).toBe('尺寸面板');
    // 键盘聚焦时看得见焦点在哪（轮廓画在里面，不会被 dock 的边裁掉）。
    expect(classesOf(root)).toEqual(expect.arrayContaining(['focus-visible:outline', 'focus-visible:-outline-offset-2']));
  });
});
