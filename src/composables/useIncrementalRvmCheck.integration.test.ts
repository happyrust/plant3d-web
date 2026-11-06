/**
 * 增量 RVM 校验的端到端集成：只 mock 网络层（`/tasks`、`rvm-check/runs`），store、composable、图标组件都是真的。
 * 覆盖：同一根在模型树行、RVM 核对树、RVM 面板「增量待校验」、增量记录标签四处同步；自动校验关 / 开 / 未登录累计 / 登录后入队；
 * 刷新（重新加载模块）后已处理批次不重复入队；别处发起的 rvm_check 被吸收。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, type App } from 'vue';

import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';

import type { TaskListEntryDto } from '@/api/genModelV1Api';

const net = vi.hoisted(() => ({
  tasks: [] as TaskListEntryDto[],
  runs: new Map<string, Record<string, unknown>>(),
  started: [] as string[],
  nextId: 1,
}));

vi.mock('@/api/genModelV1Api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/genModelV1Api')>();
  return {
    ...actual,
    genModelV1Tasks: vi.fn(async () => ({ tasks: net.tasks })),
    genModelV1Fetch: vi.fn(async () => ({ tasks: net.tasks })),
    genModelV1TaskGet: vi.fn(async (id: string) => net.runs.get(id)),
  };
});

vi.mock('@/api/rvmCheckApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/rvmCheckApi')>();
  return {
    ...actual,
    fetchRvmCheckDefaults: vi.fn(async () => ({ projects_dir: '', project_name: '', e3d_project: 'AMS', mdb: '/ALL' })),
    preflightRvmCheck: vi.fn(async () => ({ login_ok: true, checks: [] })),
    startRvmCheckRun: vi.fn(async (_c: unknown, refno: string) => {
      const id = `rvm-${net.nextId++}`;
      net.started.push(refno);
      net.runs.set(id, { task_id: id, state: 'running', stage: 'e3d_export', detail: { refno }, result: null, started_at: new Date().toISOString(), finished_at: null });
      return { task_id: id };
    }),
    getRvmCheckRun: vi.fn(async (id: string) => net.runs.get(id)),
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
    dbnum: 7999, end_sesno: sesno,
    result: { units: refnos.map((root_refno) => ({ root_refno, noun: 'BRAN', status: 'generated', kind: 'regen' })) },
  } as TaskListEntryDto;
}

function passReport(refno: string) {
  const zero = { both: 3, exact: 3, chord: 0, reference_artifact: 0, film: 0, off: 0, only_baseline: 0, only_generated: 0, kind_match: 0, kind_differ: 0, container_off: 0, container_only_baseline: 0, container_only_generated: 0, centreline_only_baseline: 0, unkeyable_baseline: 0, unkeyable_generated: 0 };
  return { verdict: 'pass', message: '通过', stage: 'compare', refno, name: '/C-1/B1', noun: 'BRAN', dbnum: 7999, db_type: 'DESI', sesno: 1416, db_file: null, e3d_export_by: 'refno', counts: zero, mismatches: [], mismatches_truncated: false, centreline_only_baseline: [], timings_ms: {}, files: [], warnings: [] };
}

function rvmTask(id: string, refno: string, at: string, state = 'succeeded'): TaskListEntryDto {
  return { task_id: id, kind: 'rvm_check', state, created_at: at, started_at: at, finished_at: state === 'running' ? null : at, detail: { refno }, result: state === 'running' ? null : passReport(refno) } as TaskListEntryDto;
}

type Mods = Awaited<ReturnType<typeof load>>;

async function load() {
  vi.resetModules();
  const store = await import('@/composables/useRvmCheckStore');
  const inc = await import('@/composables/useIncrementalRvmCheck');
  const ModelTreeRow = (await import('@/components/model-tree/ModelTreeRow.vue')).default;
  const RvmCheckTreeNode = (await import('@/components/rvm-check/RvmCheckTreeNode.vue')).default;
  const RvmCheckPanel = (await import('@/components/rvm-check/RvmCheckPanel.vue')).default;
  const IncrementRecordsPanel = (await import('@/components/increment/IncrementRecordsPanel.vue')).default;
  return { store, inc, ModelTreeRow, RvmCheckTreeNode, RvmCheckPanel, IncrementRecordsPanel };
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
  for (let i = 0; i < 6; i += 1) {
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
    records: () => recordsHost.querySelector('[data-testid="increment-rvm-summary"]')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
    recordsHost,
  };
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: false });
  vi.setSystemTime(new Date('2026-11-05T06:40:00Z'));
  vi.stubGlobal('localStorage', memoryStorage);
  memoryStorage.clear();
  net.tasks = [];
  net.runs.clear();
  net.started = [];
  net.nextId = 1;
});

afterEach(() => {
  for (const { app, host } of mounted.splice(0)) {
    app.unmount();
    host.remove();
  }
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('增量 RVM 校验 · 四处同步', () => {
  it('过期 → 排队 → 运行 → 通过，四个位置同一时刻看到同一状态', async () => {
    net.tasks = [batch('b-1416', LANDED_AT, [BRAN]), rvmTask('rvm-old', BRAN, PASSED_AT)];
    const m = await load();
    const view = mountAll(m);
    await flush();
    await flush(10);

    // 过期：上次通过，之后被第 1416 轮重算
    expect(view.tree()).toMatchObject({ verdict: 'pass', outdated: true });
    expect(view.tree().title).toContain('之后第 1416 轮增量重算过，待重新校验');
    expect(view.rvmTree()).toEqual({ verdict: 'pass', outdated: true });
    expect(await view.panel()).toMatchObject({ tab: '增量待校验 (1)', listed: true, outdated: true });
    expect(view.records()).toBe('待校验 1');

    // 手动校验：登录已就绪，入队
    const rvm = m.store.useRvmCheckStore();
    rvm.loggedIn.value = true;
    rvm.password.value = 'test-only';
    (view.recordsHost.querySelector('[data-testid="increment-rvm-check"]') as HTMLElement).click();
    await flush();
    expect(net.started).toEqual(['24381/145018']);
    expect(view.tree()).toMatchObject({ verdict: 'running', outdated: false });
    expect(view.rvmTree()).toEqual({ verdict: 'running', outdated: false });
    expect(await view.panel()).toMatchObject({ tab: '增量待校验 (0)', spinning: true });
    expect(view.records()).toBe('运行中 1');

    // 后端出结论
    const run = net.runs.get('rvm-1')!;
    net.runs.set('rvm-1', { ...run, state: 'succeeded', stage: 'compare', result: passReport(BRAN), finished_at: '2026-11-05T06:41:00Z' });
    await flush(2_100);
    expect(view.tree()).toMatchObject({ verdict: 'pass', outdated: false });
    expect(view.tree().title).not.toContain('待重新校验');
    expect(view.rvmTree()).toEqual({ verdict: 'pass', outdated: false });
    expect(await view.panel()).toMatchObject({ tab: '增量待校验 (0)', listed: false });
    expect(view.records()).toBe('通过 1');
  });

  it('别处发起的核对：下一次 5s 轮询吸收进来，四处同步出结论', async () => {
    net.tasks = [batch('b-1416', LANDED_AT, [BRAN])];
    const m = await load();
    const view = mountAll(m);
    await flush();
    expect(view.tree()).toMatchObject({ verdict: null, outdated: true });
    expect(view.records()).toBe('待校验 1');

    // 另一个标签页：先在跑，再出结论
    net.tasks = [...net.tasks, rvmTask('rvm-remote', BRAN, '2026-11-05T06:41:00Z', 'running')];
    await flush(5_000);
    expect(view.tree().verdict).toBe('running');
    expect(view.rvmTree().verdict).toBe('running');
    expect(view.records()).toBe('运行中 1');

    net.tasks = [batch('b-1416', LANDED_AT, [BRAN]), rvmTask('rvm-remote', BRAN, '2026-11-05T06:42:00Z')];
    net.runs.set('rvm-remote', { ...rvmTask('rvm-remote', BRAN, '2026-11-05T06:42:00Z'), stage: 'compare' });
    await flush(5_000);
    expect(view.tree()).toMatchObject({ verdict: 'pass', outdated: false });
    expect(view.rvmTree()).toEqual({ verdict: 'pass', outdated: false });
    expect(view.records()).toBe('通过 1');
    expect(net.started).toEqual([]);
  });
});

describe('增量 RVM 校验 · 自动校验', () => {
  it('默认关：新批次落地也不入队', async () => {
    const m = await load();
    const inc = m.inc.useIncrementalRvmCheck();
    m.store.useRvmCheckStore().loggedIn.value = true;
    m.store.useRvmCheckStore().password.value = 'test-only';
    net.tasks = [batch('b-new', '2026-11-05T06:45:00Z', [BRAN])];
    await inc.refresh();
    expect(inc.autoEnabled.value).toBe(false);
    expect(m.store.useRvmCheckStore().queue.value).toHaveLength(0);
  });

  it('打开：开关之前落地的不动，之后落地的入队；关掉后停', async () => {
    net.tasks = [batch('b-before', LANDED_AT, ['1/1'])];
    const m = await load();
    const inc = m.inc.useIncrementalRvmCheck();
    const rvm = m.store.useRvmCheckStore();
    rvm.loggedIn.value = true;
    rvm.password.value = 'test-only';
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

  it('刷新页面（重新加载模块）后，已处理的批次不重复入队；开关保持打开', async () => {
    let m = await load();
    let inc = m.inc.useIncrementalRvmCheck();
    let rvm = m.store.useRvmCheckStore();
    rvm.loggedIn.value = true;
    rvm.password.value = 'test-only';
    inc.autoEnabled.value = true;
    await inc.refresh();
    net.tasks = [batch('b-after', '2026-11-05T06:45:00Z', [BRAN])];
    await inc.refresh();
    expect(rvm.queue.value).toHaveLength(1);
    expect(JSON.parse(memoryStorage.getItem('rvm-check-incremental-auto-done') ?? '[]')).toEqual(['b-after']);

    m = await load();
    inc = m.inc.useIncrementalRvmCheck();
    rvm = m.store.useRvmCheckStore();
    rvm.loggedIn.value = true;
    rvm.password.value = 'test-only';
    expect(inc.autoEnabled.value).toBe(true);
    await inc.refresh();
    expect(rvm.queue.value).toHaveLength(0);

    net.tasks = [...net.tasks, batch('b-next', '2026-11-05T06:50:00Z', ['1/9'])];
    await inc.refresh();
    expect(rvm.queue.value.map((item) => item.refno)).toEqual(['1_9']);
  });
});
