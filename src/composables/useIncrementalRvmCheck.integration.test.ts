/**
 * 增量 RVM 校验的端到端集成：只 mock 网络层（`/tasks` 分页、`/tasks/{id}`、`rvm-check/runs`）和 WS 任务流，
 * store、composable、图标组件都是真的。
 * 覆盖：同一根在模型树行、RVM 核对树、RVM 面板「增量待校验」、增量记录标签四处同步；按会话号判过期（同会话重跑不过期、
 * 核对开工后落地的新会话算过期）；基线轮不列待校验；`rvm_check` 挤不掉数据批次；WS 在线时不整页轮询、task_finished
 * 只拉那一条；WS 不在线时对账翻到认识的终态任务就停；自动校验关 / 开 / 未登录累计 / 登录后入队 / 刷新不丢根也不重复 /
 * 失败重试封顶 / 一轮超上限只提示；别处发起的 rvm_check 被吸收。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, type App, type Ref } from 'vue';

import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';

import type { TaskListEntryDto } from '@/api/genModelV1Api';

type PageQuery = { kind?: string; limit?: number; before?: string | null };

const net = vi.hoisted(() => ({
  tasks: [] as TaskListEntryDto[],
  runs: new Map<string, Record<string, unknown>>(),
  started: [] as string[],
  nextId: 1,
  pages: [] as PageQuery[],
  gets: [] as string[],
  /** 给了就按它决定 `startRvmCheckRun` 抛什么（返回 null 表示正常接下） */
  startError: null as null | ((refno: string) => unknown),
  /** `a_b` → 祖先链（自己在前）；没登记的只有自己 */
  ancestors: new Map<string, string[]>(),
}));

const feed = vi.hoisted(() => ({
  listeners: new Set<(envelope: unknown) => void>(),
}));

vi.mock('@/api/genModelV1Api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/genModelV1Api')>();
  return {
    ...actual,
    genModelV1TasksPage: vi.fn(async (query: PageQuery = {}) => {
      net.pages.push({ ...query });
      const limit = Math.min(query.limit ?? 50, actual.GEN_MODEL_V1_TASKS_PAGE_LIMIT);
      const rows = net.tasks
        .filter((task) => !query.kind || task.kind === query.kind)
        .filter((task) => !query.before || String(task.created_at) < query.before)
        .sort((left, right) => String(right.created_at).localeCompare(String(left.created_at)));
      return { tasks: rows.slice(0, limit), has_more: rows.length > limit };
    }),
    genModelV1TaskGet: vi.fn(async (id: string) => {
      net.gets.push(id);
      const found = net.runs.get(id) ?? net.tasks.find((task) => task.task_id === id);
      if (found) return found;
      throw new actual.GenModelV1ApiError({ code: 'not_found', status: 404, path: `/api/v1/tasks/${id}`, message: 'not found' });
    }),
    genModelV1TreeAncestors: vi.fn(async (refno: string) => {
      const key = refno.replace('/', '_');
      return { source: 'direct', refnos: net.ancestors.get(key) ?? [key] };
    }),
  };
});

vi.mock('@/api/rvmCheckApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/rvmCheckApi')>();
  return {
    ...actual,
    fetchRvmCheckDefaults: vi.fn(async () => ({ projects_dir: '', project_name: '', e3d_project: 'AMS', mdb: '/ALL' })),
    preflightRvmCheck: vi.fn(async () => ({ login_ok: true, checks: [] })),
    startRvmCheckRun: vi.fn(async (_c: unknown, refno: string) => {
      const failure = net.startError?.(refno);
      if (failure) throw failure;
      const id = `rvm-${net.nextId++}`;
      net.started.push(refno);
      net.runs.set(id, { task_id: id, state: 'running', stage: 'e3d_export', detail: { refno }, result: null, started_at: new Date().toISOString(), finished_at: null });
      return { task_id: id };
    }),
    getRvmCheckRun: vi.fn(async (id: string) => net.runs.get(id)),
  };
});

vi.mock('@/composables/useGenModelV1TaskFeed', async () => {
  const { ref } = await import('vue');
  const feedStatus = ref<'idle' | 'connecting' | 'live' | 'down'>('live');
  const missedEvents = ref(0);
  const subscribeGenModelV1TaskEvents = (listener: (envelope: unknown) => void) => {
    feed.listeners.add(listener);
    return () => {
      feed.listeners.delete(listener);
    };
  };
  return {
    subscribeGenModelV1TaskEvents,
    connectGenModelV1TaskFeed: () => {},
    useGenModelV1TaskFeed: () => ({ feedStatus, missedEvents, subscribeGenModelV1TaskEvents, connectGenModelV1TaskFeed: () => {} }),
  };
});

vi.mock('@/ribbon/toastBus', () => ({ emitToast: vi.fn() }));

const BRAN = '24381/145018';
const KEY = '24381_145018';
const PASSED_AT = '2026-11-05T06:20:00Z';
const LANDED_AT = '2026-11-05T06:32:00Z';

function batch(id: string, finishedAt: string, refnos: string[], sesno = 1416): TaskListEntryDto {
  return {
    task_id: id, kind: 'data_batch', state: 'succeeded', created_at: finishedAt, started_at: finishedAt, finished_at: finishedAt,
    dbnum: 7999, start_sesno: sesno, end_sesno: sesno, detail: { intent: 'apply_window', model_start_sesno: null },
    result: { units: refnos.map((root_refno) => ({ root_refno, noun: 'BRAN', status: 'generated', kind: 'regen' })) },
  } as TaskListEntryDto;
}

/** 后端重启后的初始化：模型从会话 0 起整库重算 */
function baselineBatch(id: string, finishedAt: string, refnos: string[], sesno = 1416): TaskListEntryDto {
  return { ...batch(id, finishedAt, refnos, sesno), start_sesno: 1, detail: { intent: 'model_only', model_start_sesno: 0 } } as TaskListEntryDto;
}

function passReport(refno: string, sesno = 1416) {
  const zero = { both: 3, exact: 3, chord: 0, reference_artifact: 0, film: 0, off: 0, only_baseline: 0, only_generated: 0, kind_match: 0, kind_differ: 0, container_off: 0, container_only_baseline: 0, container_only_generated: 0, centreline_only_baseline: 0, unkeyable_baseline: 0, unkeyable_generated: 0 };
  return { verdict: 'pass', message: '通过', stage: 'compare', refno, name: '/C-1/B1', noun: 'BRAN', dbnum: 7999, db_type: 'DESI', sesno, db_file: null, e3d_export_by: 'refno', counts: zero, mismatches: [], mismatches_truncated: false, centreline_only_baseline: [], timings_ms: {}, files: [], warnings: [] };
}

function rvmTask(id: string, refno: string, at: string, state = 'succeeded', sesno = 1416): TaskListEntryDto {
  return { task_id: id, kind: 'rvm_check', state, created_at: at, started_at: at, finished_at: state === 'running' ? null : at, detail: { refno }, result: state === 'running' ? null : passReport(refno, sesno) } as TaskListEntryDto;
}

function emit(envelope: Record<string, unknown>) {
  for (const listener of [...feed.listeners]) listener(envelope);
}

type Mods = Awaited<ReturnType<typeof load>>;

async function load() {
  // 上一份模块的定时器和 WS 订阅一并作废，免得两份状态互相串；clearAllTimers 会把假时钟拨回安装时刻，拨回来
  const now = Date.now();
  vi.clearAllTimers();
  vi.setSystemTime(now);
  feed.listeners.clear();
  vi.resetModules();
  const store = await import('@/composables/useRvmCheckStore');
  const inc = await import('@/composables/useIncrementalRvmCheck');
  const feedModule = await import('@/composables/useGenModelV1TaskFeed');
  const ModelTreeRow = (await import('@/components/model-tree/ModelTreeRow.vue')).default;
  const RvmCheckTreeNode = (await import('@/components/rvm-check/RvmCheckTreeNode.vue')).default;
  const RvmCheckPanel = (await import('@/components/rvm-check/RvmCheckPanel.vue')).default;
  const IncrementRecordsPanel = (await import('@/components/increment/IncrementRecordsPanel.vue')).default;
  const feedStatus = feedModule.useGenModelV1TaskFeed().feedStatus as Ref<string>;
  feedStatus.value = 'live';
  return { store, inc, feedStatus, ModelTreeRow, RvmCheckTreeNode, RvmCheckPanel, IncrementRecordsPanel };
}

const mounted: { app: App; host: HTMLElement }[] = [];

// Node 22 自带的 localStorage（无 --localstorage-file 时为 undefined）会盖掉 happy-dom 的，自己备一个跨 resetModules 存活的
const memoryStore = new Map<string, string>();
const memoryStorage = {
  getItem: (key: string) => memoryStore.get(key) ?? null,
  setItem: (key: string, value: string) => { memoryStore.set(key, String(value)); },
  removeItem: (key: string) => { memoryStore.delete(key); },
  clear: () => { memoryStore.clear(); },
  key: (index: number) => [...memoryStore.keys()][index] ?? null,
  get length() { return memoryStore.size; },
};

function mount(render: () => ReturnType<typeof h>) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const app = createApp({ render });
  app.use(VueQueryPlugin, { queryClient: new QueryClient() });
  app.mount(host);
  mounted.push({ app, host });
  return host;
}

async function flush(ms = 0) {
  if (ms) await vi.advanceTimersByTimeAsync(ms);
  for (let i = 0; i < 12; i += 1) {
    await Promise.resolve();
    await nextTick();
  }
}

/** 四个位置同时挂上，返回各自读状态的函数 */
function mountAll(m: Mods) {
  const { store, inc } = m;
  const rvm = store.useRvmCheckStore();
  const treeHost = mount(() => h(m.ModelTreeRow, {
    row: { id: KEY, refno: KEY, name: '/C-1/B1', type: 'BRAN', depth: 3, hasChildren: false },
    index: 0, expanded: false, selected: false, checkState: 'checked',
    rvmStatus: rvm.statusByRefno.value[KEY] ?? null,
    rvmIncremental: inc.rvmNodeBadge(KEY).root,
  }));
  const rvmTreeHost = mount(() => h('ul', [h(m.RvmCheckTreeNode, {
    rows: [{ refnoSlash: BRAN, noun: 'BRAN', name: '/C-1/B1', shortName: '/C-1/B1', depth: 0, expanded: false, loading: false, childrenCount: 0, children: [] }],
    selected: '',
  })]));
  const panelHost = mount(() => h(m.RvmCheckPanel, { locatable: false }));
  const recordsHost = mount(() => h(m.IncrementRecordsPanel));
  return {
    tree: () => {
      const b = treeHost.querySelector('[data-testid="model-tree-status"]');
      return { verdict: b?.getAttribute('data-rvm-status') ?? null, outdated: b?.getAttribute('data-rvm-outdated') === 'true', title: b?.getAttribute('title') ?? '' };
    },
    rvmTree: () => {
      const s = rvmTreeHost.querySelector('[data-testid="rvm-check-tree-status"]');
      return { verdict: s?.getAttribute('data-rvm-status') ?? null, outdated: !!s?.querySelector('[data-rvm-outdated="true"]') };
    },
    panel: async () => {
      (panelHost.querySelector('[data-testid="rvm-check-tab-incremental"]') as HTMLElement | null)?.click();
      await flush();
      return {
        tab: panelHost.querySelector('[data-testid="rvm-check-tab-incremental"]')?.textContent?.trim() ?? '',
        listed: !!panelHost.querySelector('[data-testid="rvm-check-incremental"]'),
        outdated: !!panelHost.querySelector('[data-testid="rvm-check-incremental"] [data-rvm-outdated="true"]'),
        spinning: !!panelHost.querySelector('[data-testid="rvm-check-incremental"] .animate-spin'),
      };
    },
    records: () => [...(recordsHost.querySelector('[data-testid="increment-rvm-summary"]')?.children ?? [])]
      .map((chip) => chip.textContent?.replace(/\s+/g, ' ').trim() ?? '')
      .join(' '),
    checkButton: () => recordsHost.querySelector('[data-testid="increment-rvm-check"]')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
    recordsHost,
  };
}

function loginReady(m: Mods) {
  const rvm = m.store.useRvmCheckStore();
  rvm.loggedIn.value = true;
  rvm.password.value = 'test-only';
  return rvm;
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: false });
  vi.setSystemTime(new Date('2026-11-05T06:40:00Z'));
  vi.stubGlobal('localStorage', memoryStorage);
  memoryStorage.clear();
  feed.listeners.clear();
  net.tasks = [];
  net.runs.clear();
  net.started = [];
  net.nextId = 1;
  net.pages = [];
  net.gets = [];
  net.startError = null;
  net.ancestors.clear();
});

afterEach(() => {
  for (const { app, host } of mounted.splice(0)) {
    app.unmount();
    host.remove();
  }
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('增量 RVM 校验 · 四处同步', () => {
  it('过期 → 排队 → 运行 → 通过，四个位置同一时刻看到同一状态', async () => {
    net.tasks = [batch('b-1416', LANDED_AT, [BRAN]), rvmTask('rvm-old', BRAN, PASSED_AT, 'succeeded', 1415)];
    const m = await load();
    const view = mountAll(m);
    await flush();

    // 过期：上次通过（会话 1415），之后被第 1416 轮重算
    expect(view.tree()).toMatchObject({ verdict: 'pass', outdated: true });
    expect(view.tree().title).toContain('之后第 1416 轮增量重算过，待重新校验');
    expect(view.rvmTree()).toEqual({ verdict: 'pass', outdated: true });
    expect(await view.panel()).toMatchObject({ tab: '增量待校验 (1)', listed: true, outdated: true });
    expect(view.records()).toBe('待校验 1');

    // 手动校验：登录已就绪，入队
    loginReady(m);
    (view.recordsHost.querySelector('[data-testid="increment-rvm-check"]') as HTMLElement).click();
    await flush();
    expect(net.started).toEqual(['24381/145018']);
    expect(view.tree()).toMatchObject({ verdict: 'running', outdated: false });
    expect(view.rvmTree()).toEqual({ verdict: 'running', outdated: false });
    expect(await view.panel()).toMatchObject({ tab: '增量待校验 (0)', spinning: true });
    expect(view.records()).toBe('运行中 1');

    // 后端出结论（核对的是会话 1416）
    const run = net.runs.get('rvm-1')!;
    net.runs.set('rvm-1', { ...run, state: 'succeeded', stage: 'compare', result: passReport(BRAN), finished_at: '2026-11-05T06:41:00Z' });
    await flush(2_100);
    expect(view.tree()).toMatchObject({ verdict: 'pass', outdated: false });
    expect(view.tree().title).not.toContain('待重新校验');
    expect(view.rvmTree()).toEqual({ verdict: 'pass', outdated: false });
    expect(await view.panel()).toMatchObject({ tab: '增量待校验 (0)', listed: false });
    expect(view.records()).toBe('通过 1');
  });

  it('别处发起的核对：下一拍（10s）轮询吸收进来，四处同步出结论', async () => {
    net.tasks = [batch('b-1416', LANDED_AT, [BRAN])];
    const m = await load();
    const view = mountAll(m);
    await flush();
    expect(view.tree()).toMatchObject({ verdict: null, outdated: true });
    expect(view.records()).toBe('待校验 1');

    // 另一个标签页：先在跑，再出结论
    net.tasks = [...net.tasks, rvmTask('rvm-remote', BRAN, '2026-11-05T06:41:00Z', 'running')];
    await flush(10_000);
    expect(view.tree().verdict).toBe('running');
    expect(view.rvmTree().verdict).toBe('running');
    expect(view.records()).toBe('运行中 1');

    net.tasks = [batch('b-1416', LANDED_AT, [BRAN]), rvmTask('rvm-remote', BRAN, '2026-11-05T06:42:00Z')];
    net.runs.set('rvm-remote', { ...rvmTask('rvm-remote', BRAN, '2026-11-05T06:42:00Z'), stage: 'compare' });
    await flush(10_000);
    expect(view.tree()).toMatchObject({ verdict: 'pass', outdated: false });
    expect(view.rvmTree()).toEqual({ verdict: 'pass', outdated: false });
    expect(view.records()).toBe('通过 1');
    expect(net.started).toEqual([]);
  });
});

describe('增量 RVM 校验 · 判定口径', () => {
  it('同一会话的批次重跑（后端重启重新初始化）：已核对的根不过期，也不自动重新入队', async () => {
    net.tasks = [batch('b-1416', LANDED_AT, [BRAN]), rvmTask('rvm-done', BRAN, '2026-11-05T06:35:00Z', 'succeeded', 1416)];
    const m = await load();
    const view = mountAll(m);
    loginReady(m);
    m.inc.useIncrementalRvmCheck().autoEnabled.value = true;
    await flush();
    expect(view.tree()).toMatchObject({ verdict: 'pass', outdated: false });

    vi.setSystemTime(new Date('2026-11-05T06:50:00Z'));
    const again = baselineBatch('b-1416-again', '2026-11-05T06:50:00Z', [BRAN], 1416);
    net.tasks = [...net.tasks, again];
    emit({ type: 'task_started', task_id: again.task_id, payload: { task_id: again.task_id, kind: 'data_batch', dbnum: 7999 } });
    emit({ type: 'task_finished', task_id: again.task_id, payload: { task_id: again.task_id, state: 'succeeded', result: again.result } });
    await flush();
    expect(net.gets).toContain('b-1416-again');
    expect(view.tree()).toMatchObject({ verdict: 'pass', outdated: false });
    expect(await view.panel()).toMatchObject({ tab: '增量待校验 (0)' });
    expect(m.store.useRvmCheckStore().queue.value).toHaveLength(0);
  });

  it('核对开工之后才落地的新会话：结论时刻更晚也算过期', async () => {
    net.tasks = [
      batch('b-1416', LANDED_AT, [BRAN]),
      batch('b-1417', '2026-11-05T06:45:00Z', [BRAN], 1417),
      rvmTask('rvm-mid', BRAN, '2026-11-05T06:50:00Z', 'succeeded', 1416),
    ];
    vi.setSystemTime(new Date('2026-11-05T06:55:00Z'));
    const m = await load();
    const view = mountAll(m);
    await flush();
    expect(view.tree()).toMatchObject({ verdict: 'pass', outdated: true });
    expect(view.tree().title).toContain('之后第 1417 轮增量重算过，待重新校验');
  });

  it('整库从头生成的一轮：没核对过的根不列待校验，记录上标「整库生成」「未核对」', async () => {
    net.tasks = [baselineBatch('b-init', LANDED_AT, [BRAN, '1/1'], 435)];
    const m = await load();
    const view = mountAll(m);
    await flush();
    expect(view.tree()).toEqual({ verdict: null, outdated: false, title: '' });
    expect(view.rvmTree().outdated).toBe(false);
    expect(await view.panel()).toMatchObject({ tab: '增量待校验 (0)', listed: false });
    expect(view.records()).toBe('未核对 2');
    expect(view.checkButton()).toBe('整库生成');
    expect(view.recordsHost.querySelector('[data-testid="increment-rvm-baseline"]')).not.toBeNull();
  });

  it('SITE 核对通过且会话不早于这一轮：子树里的增量根四处都不再列待校验，记录里记作通过', async () => {
    net.ancestors.set(KEY, [KEY, '24381_100001', '24381_100000', '16192_0']);
    net.tasks = [batch('b-1416', LANDED_AT, [BRAN, '1/2']), rvmTask('rvm-site', '24381/100000', '2026-11-05T06:35:00Z', 'succeeded', 1416)];
    const m = await load();
    const view = mountAll(m);
    await flush();
    expect(view.tree()).toEqual({ verdict: null, outdated: false, title: '' });
    expect(view.rvmTree().outdated).toBe(false);
    expect(await view.panel()).toMatchObject({ tab: '增量待校验 (1)' });
    expect(view.records()).toBe('待校验 1 通过 1');
    expect(view.checkButton()).toBe('RVM 校验 1 根');
  });

  it('SITE 核对会话早于这一轮：子树里的增量根照旧待校验', async () => {
    net.ancestors.set(KEY, [KEY, '24381_100001', '24381_100000', '16192_0']);
    net.tasks = [batch('b-1416', LANDED_AT, [BRAN]), rvmTask('rvm-site', '24381/100000', '2026-11-05T06:35:00Z', 'succeeded', 1415)];
    const m = await load();
    const view = mountAll(m);
    await flush();
    expect(view.tree()).toMatchObject({ verdict: null, outdated: true });
    expect(view.records()).toBe('待校验 1');
  });

  it('rvm_check 再多也挤不掉数据批次：账本按种类拉', async () => {
    net.tasks = [
      batch('b-1416', LANDED_AT, [BRAN]),
      ...Array.from({ length: 200 }, (_, index) => rvmTask(`rvm-${index}`, `1/${index + 10}`, `2026-11-05T06:3${3 + Math.floor(index / 60)}:${String(index % 60).padStart(2, '0')}Z`)),
    ];
    const m = await load();
    const view = mountAll(m);
    await flush();
    expect(view.tree()).toMatchObject({ verdict: null, outdated: true });
    expect(net.pages.some((page) => page.kind === 'data_batch')).toBe(true);
    expect(net.pages.every((page) => !!page.kind)).toBe(true);
  });
});

describe('增量 RVM 校验 · 任务来源', () => {
  it('WS 在线：不再定时整页拉数据批次；task_finished 只按 task_id 拉那一条', async () => {
    net.tasks = [batch('b-1416', LANDED_AT, [BRAN]), rvmTask('rvm-done', BRAN, '2026-11-05T06:35:00Z', 'succeeded', 1416)];
    const m = await load();
    const view = mountAll(m);
    await flush();
    net.pages = [];
    await flush(60_000);
    expect(net.pages.filter((page) => page.kind === 'data_batch')).toEqual([]);
    expect(net.pages.filter((page) => page.kind === 'rvm_check').length).toBeGreaterThanOrEqual(5);

    const next = batch('b-1417', '2026-11-05T06:45:00Z', [BRAN, '1/2'], 1417);
    net.tasks = [...net.tasks, next];
    emit({ type: 'task_finished', task_id: next.task_id, payload: { task_id: next.task_id, state: 'succeeded', result: next.result } });
    await flush();
    expect(net.gets).toEqual(['b-1417']);
    expect(view.tree()).toMatchObject({ verdict: 'pass', outdated: true });
  });

  it('WS 不在线：30s 对账一次，从最新一条翻起，翻到认识的终态任务就停', async () => {
    net.tasks = [batch('b-1416', LANDED_AT, [BRAN])];
    const m = await load();
    m.feedStatus.value = 'down';
    const view = mountAll(m);
    await flush();
    net.pages = [];

    const next = batch('b-new', '2026-11-05T06:45:00Z', ['1/2'], 1417);
    net.tasks = [...net.tasks, next];
    await flush(30_000);
    const batchPages = net.pages.filter((page) => page.kind === 'data_batch');
    expect(batchPages).toEqual([
      { kind: 'data_batch', limit: 1, before: null },
      { kind: 'data_batch', limit: 10, before: next.created_at },
    ]);
    expect(await view.panel()).toMatchObject({ tab: '增量待校验 (2)' });
  });
});

describe('增量 RVM 校验 · 自动校验', () => {
  it('默认关：新批次落地也不入队', async () => {
    const m = await load();
    const inc = m.inc.useIncrementalRvmCheck();
    loginReady(m);
    net.tasks = [batch('b-new', '2026-11-05T06:45:00Z', [BRAN])];
    await inc.refresh();
    expect(inc.autoEnabled.value).toBe(false);
    expect(m.store.useRvmCheckStore().queue.value).toHaveLength(0);
  });

  it('打开：开关之前落地的不动，之后落地的入队；关掉后停', async () => {
    net.tasks = [batch('b-before', LANDED_AT, ['1/1'])];
    const m = await load();
    const inc = m.inc.useIncrementalRvmCheck();
    const rvm = loginReady(m);
    inc.autoEnabled.value = true;
    await inc.refresh();
    await inc.refresh();
    expect(rvm.queue.value).toHaveLength(0);

    net.tasks = [...net.tasks, batch('b-after', '2026-11-05T06:45:00Z', [BRAN, '1/2'])];
    await inc.refresh();
    expect(rvm.queue.value.map((item) => item.refno)).toEqual([KEY, '1_2']);
    expect(inc.autoQueued.value).toBe(2);

    inc.autoEnabled.value = false;
    rvm.cancelQueue();
    net.tasks = [...net.tasks, batch('b-later', '2026-11-05T06:50:00Z', ['1/3'])];
    await inc.refresh();
    expect(rvm.queue.value.some((item) => item.refno === '1_3')).toBe(false);
  });

  it('未登录：不弹登录窗，只累计；登录后接着入队', async () => {
    const m = await load();
    const inc = m.inc.useIncrementalRvmCheck();
    const rvm = m.store.useRvmCheckStore();
    inc.autoEnabled.value = true;
    await inc.refresh();
    net.tasks = [batch('b-after', '2026-11-05T06:45:00Z', [BRAN, '1/2'])];
    await inc.refresh();
    expect(rvm.loginDialogOpen.value).toBe(false);
    expect(rvm.queue.value).toHaveLength(0);
    expect(inc.waitingLogin.value).toBe(2);

    rvm.password.value = 'test-only';
    rvm.loggedIn.value = true;
    await flush();
    expect(rvm.queue.value.map((item) => item.refno)).toEqual([KEY, '1_2']);
    expect(inc.waitingLogin.value).toBe(0);
  });

  it('首个订阅者是组件且已卸载：登录监听仍在，登录后照样入队', async () => {
    const m = await load();
    const first = mount(() => h({ setup() { m.inc.useIncrementalRvmCheck(); return () => h('i'); } }));
    await flush();
    const entry = mounted.find((item) => item.host === first)!;
    entry.app.unmount();
    mounted.splice(mounted.indexOf(entry), 1);

    const inc = m.inc.useIncrementalRvmCheck();
    const rvm = m.store.useRvmCheckStore();
    inc.autoEnabled.value = true;
    await inc.refresh();
    net.tasks = [batch('b-after', '2026-11-05T06:45:00Z', [BRAN])];
    await inc.refresh();
    expect(inc.waitingLogin.value).toBe(1);

    rvm.password.value = 'test-only';
    rvm.loggedIn.value = true;
    await flush();
    expect(rvm.queue.value.map((item) => item.refno)).toEqual([KEY]);
  });

  it('刷新页面后：后端接下过的根不重复入队，开关保持打开，新批次照常入队', async () => {
    let m = await load();
    let inc = m.inc.useIncrementalRvmCheck();
    let rvm = loginReady(m);
    inc.autoEnabled.value = true;
    await inc.refresh();
    net.tasks = [batch('b-after', '2026-11-05T06:45:00Z', [BRAN])];
    await inc.refresh();
    await flush();
    expect(net.started).toEqual([BRAN]);
    expect(JSON.parse(memoryStorage.getItem('rvm-check-incremental-auto-attempts') ?? '{}')[KEY])
      .toEqual({ round: '7999:1416', started: 1, failed: 0, cancelled: false });

    m = await load();
    inc = m.inc.useIncrementalRvmCheck();
    rvm = loginReady(m);
    expect(inc.autoEnabled.value).toBe(true);
    await inc.refresh();
    expect(rvm.queue.value).toHaveLength(0);

    net.tasks = [...net.tasks, batch('b-next', '2026-11-05T06:50:00Z', ['1/9'])];
    await inc.refresh();
    expect(rvm.queue.value.map((item) => item.refno)).toEqual(['1_9']);
  });

  it('排着队还没开跑就刷新了页面：刷新后接着入队', async () => {
    const { GenModelV1ApiError } = await import('@/api/genModelV1Api');
    net.startError = () => new GenModelV1ApiError({ code: 'conflict', status: 409, path: '/api/v1/rvm-check/runs', message: '已有一次 RVM 比对在进行' });
    let m = await load();
    let inc = m.inc.useIncrementalRvmCheck();
    loginReady(m);
    inc.autoEnabled.value = true;
    await inc.refresh();
    net.tasks = [batch('b-after', '2026-11-05T06:45:00Z', [BRAN])];
    await inc.refresh();
    await flush();
    expect(net.started).toEqual([]);
    expect(JSON.parse(memoryStorage.getItem('rvm-check-incremental-auto-attempts') ?? '{}')[KEY]).toMatchObject({ started: 0 });

    net.startError = null;
    m = await load();
    inc = m.inc.useIncrementalRvmCheck();
    const rvm = loginReady(m);
    await inc.refresh();
    expect(rvm.queue.value.map((item) => item.refno)).toEqual([KEY]);
    await flush();
    expect(net.started).toEqual([BRAN]);
  });

  it('请求失败的根最多自动重试 3 次', async () => {
    const { GenModelV1ApiError } = await import('@/api/genModelV1Api');
    net.startError = (refno) => {
      net.started.push(`failed:${refno}`);
      return new GenModelV1ApiError({ code: 'internal', status: 500, path: '/api/v1/rvm-check/runs', message: 'boom' });
    };
    const m = await load();
    const inc = m.inc.useIncrementalRvmCheck();
    loginReady(m);
    inc.autoEnabled.value = true;
    await inc.refresh();
    net.tasks = [batch('b-after', '2026-11-05T06:45:00Z', [BRAN])];
    await inc.refresh();
    await flush();
    for (let i = 0; i < 6; i += 1) await flush(10_000);
    expect(net.started).toEqual([`failed:${BRAN}`, `failed:${BRAN}`, `failed:${BRAN}`]);
    expect(inc.pendingSet.value.has(KEY)).toBe(true);
  });

  it('已被 SITE 核对通过覆盖的根不自动入队，其余照常', async () => {
    net.ancestors.set(KEY, [KEY, '24381_100001', '24381_100000', '16192_0']);
    const m = await load();
    const inc = m.inc.useIncrementalRvmCheck();
    const rvm = loginReady(m);
    inc.autoEnabled.value = true;
    await inc.refresh();
    net.tasks = [
      rvmTask('rvm-site', '24381/100000', '2026-11-05T06:44:00Z', 'succeeded', 1417),
      batch('b-1417', '2026-11-05T06:45:00Z', [BRAN, '1/2'], 1417),
    ];
    await inc.refresh();
    expect(rvm.queue.value.map((item) => item.refno)).toEqual(['1_2']);
  });

  it('一轮待校验超过上限不自动入队，只在增量记录里提示', async () => {
    const m = await load();
    const inc = m.inc.useIncrementalRvmCheck();
    const rvm = loginReady(m);
    const recordsHost = mount(() => h(m.IncrementRecordsPanel));
    inc.autoEnabled.value = true;
    await inc.refresh();
    const many = Array.from({ length: m.inc.AUTO_ROUND_LIMIT + 1 }, (_, index) => `2/${index + 1}`);
    net.tasks = [batch('b-big', '2026-11-05T06:45:00Z', many, 1417)];
    await inc.refresh();
    await flush();
    expect(rvm.queue.value).toHaveLength(0);
    expect(inc.autoSkipped.value).toEqual([{ taskId: 'b-big', label: '第 1417 轮增量', count: m.inc.AUTO_ROUND_LIMIT + 1 }]);
    expect(recordsHost.querySelector('[data-testid="increment-rvm-auto-skipped"]')?.textContent).toContain(`${m.inc.AUTO_ROUND_LIMIT + 1} 根待校验`);
  });

  it('增量记录支持按库号筛选、关键字搜构件号并展示批次耗时与变更统计汇总', async () => {
    const m = await load();
    const inc = m.inc.useIncrementalRvmCheck();
    loginReady(m);
    const recordsHost = mount(() => h(m.IncrementRecordsPanel));
    net.tasks = [
      {
        ...batch('b-7352', '2026-11-05T06:40:10Z', ['24381/145018'], 1418),
        dbnum: 7352,
        started_at: '2026-11-05T06:40:00Z',
        result: {
          batch: { status: 'applied', added_elements: 2, modified_elements: 3, deleted_elements: 1 },
          units: [{ root_refno: '24381/145018', noun: 'BRAN', status: 'generated', kind: 'regen' }],
        },
      } as TaskListEntryDto,
      {
        ...batch('b-1112', '2026-11-05T06:35:30Z', ['17496/100'], 1417),
        dbnum: 1112,
        started_at: '2026-11-05T06:35:00Z',
        result: {
          batch: { status: 'applied', added_elements: 5, modified_elements: 0, deleted_elements: 0 },
          units: [{ root_refno: '17496/100', noun: 'EQUI', status: 'generated', kind: 'regen' }],
        },
      } as TaskListEntryDto,
    ];
    await inc.refresh();
    await nextTick();

    const summaryEl = recordsHost.querySelector('[data-testid="increment-overview-summary"]');
    expect(summaryEl?.textContent).toContain('完成 2');
    expect(summaryEl?.textContent).toContain('累计 增 7 · 改 3 · 删 1');
    expect(summaryEl?.textContent).toContain('生成 2 根');
    expect(summaryEl?.textContent).toContain('最慢 00:30（库 1112）');

    const dbnumSelect = recordsHost.querySelector('[data-testid="increment-dbnum-filter"]') as HTMLSelectElement | null;
    expect(dbnumSelect).not.toBeNull();

    const searchInput = recordsHost.querySelector('[data-testid="increment-search-input"]') as HTMLInputElement;
    searchInput.value = '17496/100';
    searchInput.dispatchEvent(new Event('input'));
    await nextTick();
    expect(recordsHost.textContent).toContain('1 条记录');
    expect(recordsHost.textContent).toContain('会话 1417 → 1417');
    expect(recordsHost.textContent).not.toContain('会话 1418 → 1418');
  });
});
