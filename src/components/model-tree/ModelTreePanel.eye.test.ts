/**
 * 模型树行上的眼睛要跟着装载走。
 *
 * 眼睛亮不亮 = 树上的勾选态（响应式）再过一道「模型装着没有」（`isModelActuallyLoaded`，查的是装载器的运行时索引，
 * 不是响应式的）。不是点这一行的眼睛装进来的构件——取最新、状态栏「重载」带进来的新构件，别的面板装的——装完之后
 * 面板这边没有任何响应式的东西变，那一行的眼睛原来要等面板因为别的事重画（增量校验那个 5 秒一次的轮询）才亮。
 * 算眼睛时读一下装载器的修订号 `dtxLoaderRevision`（每装完 / 换掉 / 撤下一批 +1）：修订号一动，眼睛当场重算。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick, type App } from 'vue';

import ModelTreePanel from './ModelTreePanel.vue';

import type { CheckState, FlatRow } from '@/composables/useModelTree';

import { dtxLoaderRevision } from '@/composables/useDbnoInstancesDtxLoader';

const fake = vi.hoisted(() => ({
  /** 树上有哪几行：每个用例挂面板之前填 */
  rows: [] as FlatRow[],
  /** 树的勾选态：没写的算「显示」（新节点继承父节点） */
  checkStates: new Map<string, CheckState>(),
  /** 「模型装着没有」的底：普通的 Set——真的那个查的是装载器的运行时索引，同样不是响应式的 */
  loaded: new Set<string>(),
}));

// happy-dom 没有布局，滚动容器高度是 0，真的虚拟列表一行都不画：换成「有几行画几行」
vi.mock('@tanstack/vue-virtual', async () => {
  const { reactive, shallowRef } = await import('vue');
  return {
    useVirtualizer: (initial: { count: number }) => {
      const state = reactive({ count: initial.count });
      return shallowRef({
        get options() { return { ...initial, count: state.count }; },
        setOptions(next: { count: number }) { state.count = next.count; },
        getVirtualItems: () => Array.from({ length: state.count }, (_, index) => ({ index, key: index, start: index * 32, size: 32 })),
        getTotalSize: () => state.count * 32,
        measure: () => undefined,
        scrollToIndex: () => undefined,
      });
    },
  };
});
vi.mock('@/composables/useDbnoInstancesDtxLoader', async () => {
  const { ref } = await import('vue');
  return { dtxLoaderRevision: ref(0) };
});
vi.mock('@/composables/usePdmsOwnerTree', async () => {
  const { ref } = await import('vue');
  return {
    NOUN_TYPES: ['PIPE', 'FTUB'],
    usePdmsOwnerTree: () => ({
      nodesById: ref({}),
      rootIds: ref([]),
      expandedIds: ref(new Set()),
      flatRows: ref(fake.rows),
      filterText: ref(''),
      typeQuery: ref(''),
      filteredTypes: ref([]),
      searchLoading: ref(false),
      searchError: ref(null),
      searchItems: ref([]),
      selectedIds: ref(new Set()),
      selectedTypes: ref(new Set()),
      customTypes: ref(new Set()),
      getCheckState: (id: string) => fake.checkStates.get(id) ?? 'checked',
      setVisible: vi.fn(async () => undefined),
      expandPathToNode: vi.fn(async () => true),
      focusNodeById: vi.fn(async () => undefined),
      loadedLayerDbnums: () => [],
      refreshLoadedLayers: vi.fn(async () => undefined),
    }),
  };
});
vi.mock('@/composables/useModelGeneration', async () => {
  const { ref } = await import('vue');
  return {
    useModelGeneration: () => ({
      isModelActuallyLoaded: (refno: string) => fake.loaded.has(refno),
      showModelByRefno: vi.fn(async () => true),
      isGenerating: ref(false),
      showProgressModal: ref(false),
      progress: ref(0),
      statusMessage: ref(''),
      error: ref(null),
      totalCount: ref(0),
      currentIndex: ref(0),
      currentRefno: ref(''),
    }),
  };
});
vi.mock('@/composables/useSelectionStore', async () => {
  const { ref } = await import('vue');
  return {
    useSelectionStore: () => ({
      selectedRefno: ref(null), selectedIsDeleted: ref(false),
      clearSelection: vi.fn(), setSelectedRefno: vi.fn(), setSelectedRefnos: vi.fn(), setSelectedDeletedRefno: vi.fn(),
    }),
  };
});
vi.mock('@/composables/useToolStore', async () => {
  const { ref } = await import('vue');
  return { useToolStore: () => ({ toolMode: ref('none'), requestPtsetVisualization: vi.fn() }) };
});
vi.mock('@/composables/useRoomInfo', async () => {
  const { ref } = await import('vue');
  return { openRoomInfo: vi.fn(), useRoomInfo: () => ({ roomRevealRequest: ref(null) }) };
});
vi.mock('@/composables/useRvmCheckStore', async () => {
  const { ref } = await import('vue');
  return {
    useRvmCheckStore: () => ({
      statusByRefno: ref({}), restoreFromHistory: vi.fn(async () => undefined),
      ensureLogin: vi.fn(async () => false), enqueue: vi.fn(() => 0), openRun: vi.fn(),
    }),
  };
});
// 真的那个每 5 秒轮询一次 `/tasks`、顺带让面板重画（眼睛原来就是靠它才亮的）：这里不要它
vi.mock('@/composables/useIncrementalRvmCheck', () => ({
  useIncrementalRvmCheck: vi.fn(),
  rvmNodeBadge: () => ({ root: null, outdated: false }),
}));
vi.mock('@/composables/useGenModelV1DbnumStatus', () => ({
  useGenModelV1DbnumStatus: () => ({
    view: vi.fn(() => null), acquire: vi.fn(() => vi.fn()), refresh: vi.fn(),
    invalidate: vi.fn(), scheduleReprobe: vi.fn(), noteGenerated: vi.fn(), reconcile: vi.fn(),
  }),
}));
vi.mock('@/composables/useLoadedNodeStatus', () => ({
  loadedNodeEntry: vi.fn(() => null),
  useLoadedNodeStatus: () => ({ view: vi.fn(() => null), recheck: vi.fn() }),
}));
vi.mock('@/composables/useModelGetWork', () => ({ registerGetWorkTree: vi.fn(() => vi.fn()) }));
vi.mock('@/composables/useModelTreeStore', () => ({ setModelTreeInstance: vi.fn() }));
vi.mock('@/composables/useDockApi', () => ({ ensurePanelAndActivate: vi.fn() }));
vi.mock('@/composables/useUpdateToLatest', () => ({ requestUpdateToLatest: vi.fn() }));
vi.mock('@/components/model-tree/RoomTreePanel.vue', async () => {
  const { defineComponent, h } = await import('vue');
  return { default: defineComponent({ name: 'RoomTreePanelStub', setup: () => () => h('div') }) };
});

const OLD: FlatRow = { id: '14207_6209', name: 'FTUB 1', type: 'FTUB', depth: 2, hasChildren: false, dbnum: 6015 };
const NEW: FlatRow = { id: '14207_6210', name: 'FTUB 2', type: 'FTUB', depth: 2, hasChildren: false, dbnum: 6015 };
const NOT_LOADED: FlatRow = { id: '14207_6300', name: 'FTUB 3', type: 'FTUB', depth: 2, hasChildren: false, dbnum: 6015 };

let mounted: { app: App; host: HTMLElement } | null = null;

async function mountPanel(): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const app = createApp(ModelTreePanel, { viewer: {} });
  app.mount(host);
  mounted = { app, host };
  await nextTick();
  await nextTick();
  return host;
}

/** 这一行的眼睛：亮 = 眼睛图标（平时不显眼，鼠标移上去才看得见），灭 = 划掉的眼睛（一直显示，红的） */
function eyeOf(host: HTMLElement, id: string): 'on' | 'off' {
  const eye = host.querySelector(`[data-testid="model-tree-row"][data-refno="${id}"] [data-testid="model-tree-eye"]`);
  if (!eye) throw new Error(`树上没画 ${id} 这一行`);
  const on = eye.querySelector('svg.lucide-eye') !== null;
  const off = eye.querySelector('svg.lucide-eye-off') !== null;
  if (on === off) throw new Error(`${id} 这一行的眼睛既不是亮也不是灭`);
  return on ? 'on' : 'off';
}

beforeEach(() => {
  fake.rows = [];
  fake.checkStates.clear();
  fake.loaded.clear();
  // 面板挂上时有两句调试输出
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  mounted?.app.unmount();
  mounted?.host.remove();
  mounted = null;
  vi.restoreAllMocks();
});

describe('模型树行上的眼睛跟着装载走', () => {
  it('不是点这一行装进来的构件（取最新带进来的新构件）：装载器的修订号一动，它那一行的眼睛当场亮', async () => {
    fake.rows = [OLD, NEW, NOT_LOADED];
    fake.loaded.add(OLD.id);
    const host = await mountPanel();
    // 取最新先刷新了树：新构件的行已经在了、勾选态继承父节点是「显示」，但模型还没重载——这一行的眼睛是灭的
    expect(eyeOf(host, OLD.id)).toBe('on');
    expect(eyeOf(host, NEW.id)).toBe('off');
    expect(eyeOf(host, NOT_LOADED.id)).toBe('off');

    // 模型装上了。装没装查的是装载器的索引，不是响应式的：光它变，面板不会重画（前提：下一步亮起来靠的是修订号）
    fake.loaded.add(NEW.id);
    await nextTick();
    expect(eyeOf(host, NEW.id)).toBe('off');

    // 装载器每装完一批修订号 +1：眼睛跟着重算——装上的亮，没装的照旧灭，原来亮着的不动
    dtxLoaderRevision.value += 1;
    await nextTick();
    expect(eyeOf(host, NEW.id)).toBe('on');
    expect(eyeOf(host, OLD.id)).toBe('on');
    expect(eyeOf(host, NOT_LOADED.id)).toBe('off');
  });

  it('构件从场景里撤下也一样：修订号一动，眼睛当场灭', async () => {
    fake.rows = [OLD, NEW];
    fake.loaded.add(OLD.id);
    fake.loaded.add(NEW.id);
    const host = await mountPanel();
    expect(eyeOf(host, OLD.id)).toBe('on');
    expect(eyeOf(host, NEW.id)).toBe('on');

    fake.loaded.delete(NEW.id);
    dtxLoaderRevision.value += 1;
    await nextTick();
    expect(eyeOf(host, NEW.id)).toBe('off');
    expect(eyeOf(host, OLD.id)).toBe('on');
  });

  it('人藏起来的行（树上的勾选态是隐藏）不看装没装：装着也是灭的，修订号动了还是灭的', async () => {
    fake.rows = [NEW];
    fake.checkStates.set(NEW.id, 'unchecked');
    fake.loaded.add(NEW.id);
    const host = await mountPanel();
    expect(eyeOf(host, NEW.id)).toBe('off');

    dtxLoaderRevision.value += 1;
    await nextTick();
    expect(eyeOf(host, NEW.id)).toBe('off');
  });
});
