/**
 * 模型树行上的眼睛要跟着装载走。
 *
 * 眼睛亮不亮 = 树上的勾选态（响应式）再过一道「模型装着没有」（`isModelActuallyLoaded`，查的是装载器的运行时索引，
 * 不是响应式的）。不是点这一行的眼睛装进来的构件——取最新、状态栏「重载」带进来的新构件，别的面板装的——装完之后
 * 面板这边没有任何响应式的东西变，那一行的眼睛原来要等面板因为别的事重画（增量校验那个 5 秒一次的轮询）才亮。
 * 算眼睛时读一下装载器的修订号 `dtxLoaderRevision`（每装完 / 换掉 / 撤下一批 +1）：修订号一动，眼睛当场重算。
 *
 * 「装着没有」只认节点自己。PIPE、BRAN 这类自己没有几何的中间节点是跟着上一级装进来的：有下级的节点，某个上级
 * 登记在已加载节点表里就算装着；节点自己登记在表里（别的显示流程装的）也算。叶子不认上级。
 *
 * 整库显示（`show_dbnum`）和地址栏直装（`show_refno` / `debug_refno`）装进来的不进已加载节点表，记在取最新的登记表
 * （`modelGetWorkRegistry`）里：在册的直装根和「登记在已加载节点表里」一样看待。登记发生在装载结束之后（修订号那时
 * 已经动过了），所以那张表自己也得是响应式的。这里用真的那张表。
 *
 * 最后一组不是眼睛：面板挂上时把「树上藏着的那部分名下现在有哪些构件」这句问话接到树上（`treeHiddenScope`），卸载时撤。
 * 借这里现成的面板挂载验接线；问话本身、树怎么答、装载流程怎么用各有自己的测试。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick, type App } from 'vue';

import ModelTreePanel from './ModelTreePanel.vue';

import type { CheckState, FlatRow } from '@/composables/useModelTree';

import { forgetGetWorkRoot, noteGetWorkRoot, resetGetWorkRegistry } from '@/composables/modelGetWorkRegistry';
import { queryTreeHiddenScope, type TreeHiddenScope } from '@/composables/treeHiddenScope';
import { dtxLoaderRevision } from '@/composables/useDbnoInstancesDtxLoader';

const fake = vi.hoisted(() => ({
  /** 树上有哪几行：每个用例挂面板之前填 */
  rows: [] as FlatRow[],
  /** 树的勾选态：没写的算「显示」（新节点继承父节点） */
  checkStates: new Map<string, CheckState>(),
  /** 「模型装着没有」的底：普通的 Set——真的那个查的是装载器的运行时索引，同样不是响应式的 */
  loaded: new Set<string>(),
  /** 树上的父节点（子 → 父） */
  parentOf: new Map<string, string>(),
  /** 已加载节点表：真的那张是响应式的，这里在替换那个模块时换成响应式的 Map */
  loadedNodes: new Map<string, { loaded: boolean }>(),
  /** 树对「藏着的那部分名下现在有哪些构件」的回答（`hiddenScopeUnder`）：用到的用例自己定 */
  hiddenScopeUnder: vi.fn<(id: string, signal?: AbortSignal) => Promise<TreeHiddenScope | null>>(),
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
      // 真的那个沿主位置的父链和收录它的分组往上找（usePdmsOwnerTree.ancestors.test.ts）；这里只有一条父链
      hasAncestorWhere: (id: string, test: (ancestorId: string) => boolean) => {
        for (let cur = fake.parentOf.get(id); cur; cur = fake.parentOf.get(cur)) {
          if (test(cur)) return true;
        }
        return false;
      },
      hiddenScopeUnder: (id: string, signal?: AbortSignal) => fake.hiddenScopeUnder(id, signal),
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
vi.mock('@/composables/useLoadedNodeStatus', async () => {
  const { reactive } = await import('vue');
  fake.loadedNodes = reactive(new Map<string, { loaded: boolean }>());
  return {
    loadedNodeEntry: (refno: string) => fake.loadedNodes.get(refno) ?? null,
    useLoadedNodeStatus: () => ({ view: vi.fn(() => null), recheck: vi.fn() }),
  };
});
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

// 一条管线从上到下：ZONE › PIPE › BRAN › 构件。前三层自己没有几何；ELBO 有几何，ATTA 没有
const ZONE: FlatRow = { id: '14207_100', name: 'ZONE 1', type: 'ZONE', depth: 0, hasChildren: true, dbnum: 6015 };
const PIPE: FlatRow = { id: '14207_200', name: 'PIPE 1', type: 'PIPE', depth: 1, hasChildren: true, dbnum: 6015 };
const PIPE_2: FlatRow = { id: '14207_210', name: 'PIPE 2', type: 'PIPE', depth: 1, hasChildren: true, dbnum: 6015 };
const BRAN: FlatRow = { id: '14207_300', name: 'BRAN 1', type: 'BRAN', depth: 2, hasChildren: true, dbnum: 6015 };
const ELBO: FlatRow = { id: '14207_400', name: 'ELBO 1', type: 'ELBO', depth: 3, hasChildren: false, dbnum: 6015 };
const ATTA: FlatRow = { id: '14207_500', name: 'ATTA 1', type: 'ATTA', depth: 3, hasChildren: false, dbnum: 6015 };

/** 把这条管线画到树上（行 + 父子关系） */
function showPipeline(): void {
  fake.rows = [ZONE, PIPE, BRAN, ELBO, ATTA, PIPE_2];
  fake.parentOf.set(PIPE.id, ZONE.id);
  fake.parentOf.set(PIPE_2.id, ZONE.id);
  fake.parentOf.set(BRAN.id, PIPE.id);
  fake.parentOf.set(ELBO.id, BRAN.id);
  fake.parentOf.set(ATTA.id, BRAN.id);
}

// 整库显示是一个 SITE 一个 SITE 装的：SITE 在那条管线的最上面，自己也没有几何
const SITE: FlatRow = { id: '14207_50', name: 'SITE 1', type: 'SITE', depth: 0, hasChildren: true, dbnum: 6015 };

/** 把 SITE 和它下面那条管线画到树上 */
function showSite(): void {
  showPipeline();
  fake.rows = [SITE, ...fake.rows];
  fake.parentOf.set(ZONE.id, SITE.id);
}

/** 直装的节点登记时记的库水位（眼睛不看它） */
const AT = { modelSesno: 1143, fileLatestSesno: 1143 };

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
  fake.parentOf.clear();
  fake.loadedNodes.clear();
  resetGetWorkRegistry();
  fake.hiddenScopeUnder.mockReset();
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

describe('跟着上一级装进来的中间节点', () => {
  it('先装上一级（ZONE）：下面有下级的中间节点（PIPE、BRAN）眼睛是亮的；叶子照旧只看自己在不在场景里', async () => {
    showPipeline();
    // 点 ZONE 的眼睛装的：这个面板的显示流程记着它，已加载节点表里也登记了它
    fake.loaded.add(ZONE.id);
    fake.loadedNodes.set(ZONE.id, { loaded: true });
    // 有几何的构件装进了场景；ATTA 没有几何，场景里没有它
    fake.loaded.add(ELBO.id);
    const host = await mountPanel();

    expect(eyeOf(host, ZONE.id)).toBe('on');
    expect(eyeOf(host, PIPE.id)).toBe('on');
    expect(eyeOf(host, PIPE_2.id)).toBe('on');
    expect(eyeOf(host, BRAN.id)).toBe('on');
    expect(eyeOf(host, ELBO.id)).toBe('on');
    expect(eyeOf(host, ATTA.id)).toBe('off');
  });

  it('上一级登记进已加载节点表的那一刻当场亮，撤表当场灭（装载器的修订号没动）', async () => {
    showPipeline();
    const host = await mountPanel();
    // 谁都没装：中间节点是灭的
    expect(eyeOf(host, ZONE.id)).toBe('off');
    expect(eyeOf(host, PIPE.id)).toBe('off');
    expect(eyeOf(host, BRAN.id)).toBe('off');

    // 别的显示流程装了 ZONE（这个面板的显示流程没装过它）：表里一登记，ZONE 自己和它下面的中间节点都亮
    fake.loadedNodes.set(ZONE.id, { loaded: true });
    await nextTick();
    expect(eyeOf(host, ZONE.id)).toBe('on');
    expect(eyeOf(host, PIPE.id)).toBe('on');
    expect(eyeOf(host, BRAN.id)).toBe('on');
    // 叶子不认上级：场景里没有它就是灭的
    expect(eyeOf(host, ELBO.id)).toBe('off');

    // ZONE 从场景撤下、撤表
    fake.loadedNodes.delete(ZONE.id);
    await nextTick();
    expect(eyeOf(host, ZONE.id)).toBe('off');
    expect(eyeOf(host, PIPE.id)).toBe('off');
    expect(eyeOf(host, BRAN.id)).toBe('off');
  });

  it('上一级只是点过、没有模型可显示（表里记的是没装进场景）：它和它下面的中间节点都不亮', async () => {
    showPipeline();
    fake.loadedNodes.set(ZONE.id, { loaded: false });
    const host = await mountPanel();

    expect(eyeOf(host, ZONE.id)).toBe('off');
    expect(eyeOf(host, PIPE.id)).toBe('off');
    expect(eyeOf(host, BRAN.id)).toBe('off');
  });

  it('人藏起来的中间节点（树上的勾选态是隐藏）照旧是灭的，旁边没藏的照旧亮', async () => {
    showPipeline();
    fake.loaded.add(ZONE.id);
    fake.loadedNodes.set(ZONE.id, { loaded: true });
    // 藏 PIPE 1：树把它和它下面已经取进树里的节点都记成隐藏，ZONE 变成半选
    fake.checkStates.set(ZONE.id, 'indeterminate');
    fake.checkStates.set(PIPE.id, 'unchecked');
    fake.checkStates.set(BRAN.id, 'unchecked');
    const host = await mountPanel();

    expect(eyeOf(host, PIPE.id)).toBe('off');
    expect(eyeOf(host, BRAN.id)).toBe('off');
    expect(eyeOf(host, PIPE_2.id)).toBe('on');
    expect(eyeOf(host, ZONE.id)).toBe('on');
  });

  it('节点自己登记在表里就算装着，不要求它有下级', async () => {
    fake.rows = [NOT_LOADED];
    fake.loadedNodes.set(NOT_LOADED.id, { loaded: true });
    const host = await mountPanel();

    expect(eyeOf(host, NOT_LOADED.id)).toBe('on');
  });
});

describe('整库显示、地址栏直接装进来的模型（不进已加载节点表，记在取最新的登记表里）', () => {
  it('整库显示装进来的 SITE：它自己和下面有下级的中间节点（ZONE、PIPE、BRAN）眼睛是亮的；叶子照旧只看自己在不在场景里', async () => {
    showSite();
    // 整库显示不经这个面板的显示流程、也不进已加载节点表：只在取最新的登记表里记了这个 SITE
    noteGetWorkRoot(SITE.id, 6015, AT, 'show_dbnum');
    // 有几何的构件装进了场景；SITE、ZONE、PIPE、BRAN 自己没有几何，ATTA 也没有
    fake.loaded.add(ELBO.id);
    const host = await mountPanel();

    expect(eyeOf(host, SITE.id)).toBe('on');
    expect(eyeOf(host, ZONE.id)).toBe('on');
    expect(eyeOf(host, PIPE.id)).toBe('on');
    expect(eyeOf(host, PIPE_2.id)).toBe('on');
    expect(eyeOf(host, BRAN.id)).toBe('on');
    expect(eyeOf(host, ELBO.id)).toBe('on');
    expect(eyeOf(host, ATTA.id)).toBe('off');
  });

  it('登记的那一刻当场亮，撤掉、清表当场灭（登记在装载结束之后，装载器的修订号这时不动）', async () => {
    showSite();
    const host = await mountPanel();
    // 谁都没装：都是灭的
    expect(eyeOf(host, SITE.id)).toBe('off');
    expect(eyeOf(host, PIPE.id)).toBe('off');
    expect(eyeOf(host, BRAN.id)).toBe('off');

    noteGetWorkRoot(SITE.id, 6015, AT, 'show_dbnum');
    await nextTick();
    expect(eyeOf(host, SITE.id)).toBe('on');
    expect(eyeOf(host, ZONE.id)).toBe('on');
    expect(eyeOf(host, PIPE.id)).toBe('on');
    expect(eyeOf(host, BRAN.id)).toBe('on');
    // 叶子不认上级：场景里没有它就是灭的
    expect(eyeOf(host, ELBO.id)).toBe('off');

    // 从地址栏的列表里撤掉它（或取最新发现它已经不在场景里）
    forgetGetWorkRoot(SITE.id);
    await nextTick();
    expect(eyeOf(host, SITE.id)).toBe('off');
    expect(eyeOf(host, PIPE.id)).toBe('off');
    expect(eyeOf(host, BRAN.id)).toBe('off');

    // 再装上，然后场景清空
    noteGetWorkRoot(SITE.id, 6015, AT, 'show_dbnum');
    await nextTick();
    expect(eyeOf(host, PIPE.id)).toBe('on');
    resetGetWorkRegistry();
    await nextTick();
    expect(eyeOf(host, SITE.id)).toBe('off');
    expect(eyeOf(host, PIPE.id)).toBe('off');
  });

  it('地址栏直接装进来的中间节点（BRAN）：它自己亮；它上面的、旁边的不跟着亮', async () => {
    showSite();
    noteGetWorkRoot(BRAN.id, 6015, AT, 'show_refno');
    fake.loaded.add(ELBO.id);
    const host = await mountPanel();

    expect(eyeOf(host, BRAN.id)).toBe('on');
    expect(eyeOf(host, ELBO.id)).toBe('on');
    // 上面几级只装了这一根 BRAN，不算装着；旁边的 PIPE 2 没装；没有几何的叶子不认上级
    expect(eyeOf(host, PIPE.id)).toBe('off');
    expect(eyeOf(host, ZONE.id)).toBe('off');
    expect(eyeOf(host, SITE.id)).toBe('off');
    expect(eyeOf(host, PIPE_2.id)).toBe('off');
    expect(eyeOf(host, ATTA.id)).toBe('off');
  });

  it('直装的节点自己在册就算装着，不要求它有下级', async () => {
    fake.rows = [NOT_LOADED];
    noteGetWorkRoot(NOT_LOADED.id, 6015, AT, 'debug_refno');
    const host = await mountPanel();

    expect(eyeOf(host, NOT_LOADED.id)).toBe('on');
  });

  it('人藏起来的行（树上的勾选态是隐藏）照旧是灭的，旁边没藏的照旧亮', async () => {
    showSite();
    noteGetWorkRoot(SITE.id, 6015, AT, 'show_dbnum');
    // 藏 PIPE 1：树把它和它下面已经取进树里的节点都记成隐藏，上面两级变成半选
    fake.checkStates.set(SITE.id, 'indeterminate');
    fake.checkStates.set(ZONE.id, 'indeterminate');
    fake.checkStates.set(PIPE.id, 'unchecked');
    fake.checkStates.set(BRAN.id, 'unchecked');
    const host = await mountPanel();

    expect(eyeOf(host, PIPE.id)).toBe('off');
    expect(eyeOf(host, BRAN.id)).toBe('off');
    expect(eyeOf(host, PIPE_2.id)).toBe('on');
    expect(eyeOf(host, ZONE.id)).toBe('on');
    expect(eyeOf(host, SITE.id)).toBe('on');
  });

  it('取最新重载之后改由已加载节点表接管（那边登记、这边撤掉）：眼睛一直亮着', async () => {
    showSite();
    noteGetWorkRoot(SITE.id, 6015, AT, 'show_dbnum');
    const host = await mountPanel();
    expect(eyeOf(host, PIPE.id)).toBe('on');

    // 重载走的是显示流程：已加载节点表先登记，取最新随后把它从自己的登记表撤掉
    fake.loadedNodes.set(SITE.id, { loaded: true });
    forgetGetWorkRoot(SITE.id);
    await nextTick();
    expect(eyeOf(host, SITE.id)).toBe('on');
    expect(eyeOf(host, PIPE.id)).toBe('on');
    expect(eyeOf(host, BRAN.id)).toBe('on');
  });
});

describe('重载定新增的构件显不显示时，装载流程问的那句「树上藏着的那部分名下现在有哪些构件」（treeHiddenScope）', () => {
  it('面板挂着：问话原样交给这棵树（节点、叫停信号），树的回答原样带回；面板卸载之后问不到', async () => {
    const answer: TreeHiddenScope = { refnos: new Set([PIPE.id, ELBO.id]), failed: [] };
    fake.hiddenScopeUnder.mockResolvedValue(answer);
    // 没有面板：没有树可问
    expect(await queryTreeHiddenScope(ZONE.id)).toBeNull();

    await mountPanel();
    const controller = new AbortController();
    expect(await queryTreeHiddenScope(ZONE.id, controller.signal)).toBe(answer);
    expect(fake.hiddenScopeUnder).toHaveBeenCalledTimes(1);
    expect(fake.hiddenScopeUnder).toHaveBeenCalledWith(ZONE.id, controller.signal);

    mounted?.app.unmount();
    mounted?.host.remove();
    mounted = null;
    expect(await queryTreeHiddenScope(ZONE.id)).toBeNull();
    expect(fake.hiddenScopeUnder).toHaveBeenCalledTimes(1);
  });
});
