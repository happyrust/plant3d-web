/**
 * 「取最新」的协调（`modelGetWork`）：按库对账、两轮不并发、装载中排队、等后台的上限、后端重启后的护栏、
 * 不在监听范围的库的交代。端口全是假的；`/dbnums` 的行照 2026-11-12 现网的回执（8022，去掉了文件路径）。
 */
import { describe, expect, it, vi } from 'vitest';

import {
  createModelGetWork,
  decideRootAction,
  describeLibraryGap,
  GETWORK_BACKEND_WAIT_MAX_MS,
  GETWORK_BACKEND_WAIT_POLL_MS,
  GETWORK_LOAD_WAIT_MAX_MS,
  libraryWaitsForBackend,
  newSiteHasModel,
  rootNeedsCheck,
  summarizeGetWork,
  type GetWorkDbnumScope,
  type GetWorkDerivedContext,
  type GetWorkNodeStatus,
  type GetWorkPorts,
  type GetWorkReport,
  type GetWorkRoot,
} from './modelGetWork';

import type { DbnumRow } from '@/api/genModelV1Api';
import type { NodeModelStatus } from '@/composables/nodeModelStatus';
import type { TreeRefreshReport } from '@/composables/pdmsTreeRefresh';

// ---------- 现网 `/dbnums` 的四种行（2026-11-12 03:22，`.scratch/incremental-sync/dbnums-0330.json`） ----------

/** 监听范围内、三枚水位对齐 */
const ROW_8000 = {
  dbnum: 8000, db_type: 'DESI', file_latest_sesno: 1155, not_in_project: false, applied_sesno: 1155, initialized: true,
  model_sesno: 1155, model_sesno_time: '2026-11-11T04:50:07+00:00', model_verdict: 'in_sync', model_verdict_reason: null,
  excluded: false, excluded_reason: null, model_source: 'database', model_source_reason: null,
} as unknown as DbnumRow;
/** 不在监听范围、已初始化、库文件比已入库的新 10 个会话 */
const ROW_1112 = {
  dbnum: 1112, db_type: 'DESI', file_latest_sesno: 748, not_in_project: false, applied_sesno: 738, initialized: true,
  model_sesno: 738, model_sesno_time: '2026-09-23T07:19:54+00:00', model_verdict: 'in_sync', model_verdict_reason: null,
  excluded: true, excluded_reason: 'watch_dbnums', model_source: 'database', model_source_reason: null,
} as unknown as DbnumRow;
/** 不在监听范围、未初始化：模型按需生成、只在后端内存里 */
const ROW_7009 = {
  dbnum: 7009, db_type: 'DESI', file_latest_sesno: 479, not_in_project: false, applied_sesno: 0, initialized: false,
  model_sesno: 0, model_sesno_time: null, model_verdict: 'not_judged', model_verdict_reason: 'data_watermark_unestablished',
  excluded: true, excluded_reason: 'watch_dbnums', model_source: 'memory', model_source_reason: 'data_watermark_unestablished',
} as unknown as DbnumRow;
/** 不在监听范围、已初始化、水位相等 */
const ROW_7334 = {
  dbnum: 7334, db_type: 'DESI', file_latest_sesno: 312, not_in_project: false, applied_sesno: 312, initialized: true,
  model_sesno: 312, model_sesno_time: '2026-09-20T02:09:56+00:00', model_verdict: 'in_sync', model_verdict_reason: null,
  excluded: true, excluded_reason: 'watch_dbnums', model_source: 'database', model_source_reason: null,
} as unknown as DbnumRow;

function row(base: DbnumRow, patch: Record<string, unknown>): DbnumRow {
  return { ...base, ...patch } as DbnumRow;
}

/** 8000 库 2026-11-11 那几个批次的水位：1143 → 1146（新增一台设备）→ 1149（删掉） */
const ROW_8000_AT_1143 = row(ROW_8000, { file_latest_sesno: 1143, applied_sesno: 1143, model_sesno: 1143 });
const ROW_8000_FILE_1146 = row(ROW_8000, { file_latest_sesno: 1146, applied_sesno: 1143, model_sesno: 1143 });
const ROW_8000_AT_1146 = row(ROW_8000, { file_latest_sesno: 1146, applied_sesno: 1146, model_sesno: 1146 });

const SITE = '24384_26547';
const ZONE = '24384_26548';

function status(verdict: NodeModelStatus['verdict'], patch: Partial<NodeModelStatus> = {}): NodeModelStatus {
  return {
    verdict, reason: null, dbnum: 8000, source: 'model-status', modelSesno: 1146, modelSavedAt: null, fileLatestSesno: 1146,
    loadedModelSesno: 1143, laggingSessions: [], reloadableSessions: [], librarySessionsAhead: 0,
    units: { total: 1, generated: 1, missing: 0, failed: 0, lagging: 0, exact: true }, unitsToGenerate: 0,
    generated: { sesnoMin: 1146, sesnoMax: 1146, timeMin: null, basis: 'library_watermark' }, changes: null, inWatchScope: true,
    checkedAt: 0,
    ...patch,
  };
}

const RELOADABLE = status('reloadable', { reloadableSessions: [{ sesno: 1146, time: null, unitsChanged: 1 }] });

function root(refno: string, patch: Partial<GetWorkRoot> = {}): GetWorkRoot {
  return { refno, dbnum: 8000, loadedModelSesno: 1143, loadedFileLatestSesno: 1143, staleReason: null, source: 'table', ...patch };
}

function treeReport(patch: Partial<TreeRefreshReport> = {}): TreeRefreshReport {
  return {
    layersRequested: 3, layersRefreshed: 3, layersFailed: [], added: [], removed: [], removedNodeCount: 0, removedUnder: {},
    renamed: [], moved: [], droppedSelection: [], changed: false,
    ...patch,
  };
}

type World = {
  now: number;
  busy: () => boolean;
  generation: number;
  rows: DbnumRow[];
  /** 每次重拉 `/dbnums` 之前调（等后台时用它推进后台的状态） */
  beforeFetchRows: (() => void) | null;
  roots: GetWorkRoot[];
  scopes: GetWorkDbnumScope[];
  statuses: Record<string, GetWorkNodeStatus>;
  /** 场景里每个节点装着的构件 */
  loaded: Record<string, string[]>;
  /** 重载一个节点之后它装着的构件（`null` = 查空撤下了）；没写的节点重载后不变 */
  afterReload: Record<string, string[] | null>;
  reloadFails: Set<string>;
  notInScene: Set<string>;
  sites: Record<number, { refno: string; name: string }[]>;
  tree: { touched: number[]; report: () => TreeRefreshReport } | null;
  hasScene: boolean;
  selected: string | null;
  selectedIsDeleted: boolean;
  goneProbe: Record<string, boolean | null>;
  derived: { name: string; run: (context: GetWorkDerivedContext) => void }[];
  failProbe: string | null;
  failRows: string | null;
};

function makeWorld(patch: Partial<World> = {}): World {
  return {
    now: 0, busy: () => false, generation: 1, rows: [ROW_8000_AT_1146], beforeFetchRows: null, roots: [], scopes: [], statuses: {},
    loaded: {}, afterReload: {}, reloadFails: new Set(), notInScene: new Set(), sites: {}, tree: null, hasScene: true, selected: null,
    selectedIsDeleted: false, goneProbe: {}, derived: [], failProbe: null, failRows: null,
    ...patch,
  };
}

function harness(world: World) {
  const log: string[] = [];
  const progress: string[] = [];
  const marked: string[] = [];
  const ports: GetWorkPorts = {
    now: () => world.now,
    sleep: async (ms) => {
      world.now += ms;
    },
    loadBusy: () => world.busy(),
    probeService: async () => {
      log.push('health');
      if (world.failProbe) throw new Error(world.failProbe);
      return { generation: world.generation };
    },
    fetchDbnumRows: async () => {
      world.beforeFetchRows?.();
      log.push('dbnums');
      if (world.failRows) throw new Error(world.failRows);
      return new Map(world.rows.map((item) => [item.dbnum, item]));
    },
    tree: () => world.tree && {
      touchedDbnums: () => world.tree!.touched,
      refresh: async () => {
        log.push('tree');
        return world.tree!.report();
      },
      nameOf: (refno) => (refno === SITE ? '/AIOS-INC-SITE' : null),
    },
    scene: () => (world.hasScene ? {
      reload: async (refno) => {
        log.push(`reload ${refno}`);
        if (world.reloadFails.has(refno)) return false;
        if (refno in world.afterReload) {
          const next = world.afterReload[refno];
          if (next === null) delete world.loaded[refno];
          else world.loaded[refno] = next!;
        } else if (!world.loaded[refno]) {
          // 用例没写它装着什么：重载之后算装着一个构件（不然会被当成查空撤下）
          world.loaded[refno] = [`${refno}:member`];
        }
        return true;
      },
      withdraw: (refno) => {
        log.push(`withdraw ${refno}`);
        const count = world.loaded[refno]?.length ?? 0;
        delete world.loaded[refno];
        return count;
      },
      loadedRefnos: (refno) => world.loaded[refno] ?? null,
      rootInScene: (refno) => !world.notInScene.has(refno),
    } : null),
    roots: () => world.roots,
    dbnumScopes: () => world.scopes,
    listSites: async (dbnum) => {
      log.push(`sites ${dbnum}`);
      const sites = world.sites[dbnum];
      if (!sites) throw new Error('tree/roots 不可用');
      return sites;
    },
    nodeStatus: async (item) => {
      log.push(`status ${item.refno}`);
      return world.statuses[item.refno] ?? { status: status('latest'), gone: false };
    },
    advanceRoot: (refno, at) => {
      log.push(`advance ${refno} ${at.modelSesno}/${at.fileLatestSesno}`);
    },
    forgetRoot: (refno) => {
      log.push(`forget ${refno}`);
      world.roots = world.roots.filter((item) => item.refno !== refno);
    },
    noteSiteKnown: (dbnum, site) => {
      log.push(`known ${dbnum} ${site}`);
    },
    noteScopeChecked: (dbnum, fileLatestSesno) => {
      log.push(`scope-checked ${dbnum} ${fileLatestSesno}`);
    },
    selection: {
      current: () => world.selected,
      isDeleted: () => world.selectedIsDeleted,
      markDeleted: (refno) => {
        marked.push(refno);
      },
    },
    probeNodeGone: async (refno) => {
      log.push(`probe ${refno}`);
      return world.goneProbe[refno] ?? false;
    },
    derived: () => world.derived.map((item) => ({
      name: item.name,
      run: (context) => {
        log.push(`derived ${item.name}`);
        item.run(context);
      },
    })),
    onProgress: (text) => {
      if (text) progress.push(text);
    },
  };
  return { engine: createModelGetWork(ports), log, progress, marked };
}

describe('取最新：按库对账、按节点动手', () => {
  it('库的水位和装的时候一样：一个节点都不问，什么都不动', async () => {
    const world = makeWorld({ rows: [ROW_8000_AT_1143], roots: [root(SITE), root(ZONE)] });
    const { engine, log } = harness(world);
    const report = await engine.getLatest();
    expect(log.filter((line) => line.startsWith('status') || line.startsWith('reload'))).toEqual([]);
    expect(report.models).toMatchObject({ rootsTotal: 2, checked: 0, reloaded: [], withdrawn: [], kept: [], failed: [] });
    expect(report.ok).toBe(true);
    expect(report.summary).toContain('已是最新');
  });

  it('只核对所在库水位变了的节点；后端说有更新可重载的才重载，说最新的不动', async () => {
    const other = root('17496_1', { dbnum: 7334, loadedModelSesno: 312, loadedFileLatestSesno: 312 });
    const world = makeWorld({
      rows: [ROW_8000_AT_1146, ROW_7334],
      roots: [root(SITE), root(ZONE), other],
      statuses: { [SITE]: { status: RELOADABLE, gone: false }, [ZONE]: { status: status('latest'), gone: false } },
      loaded: { [SITE]: ['24384_26549'] },
      afterReload: { [SITE]: ['24384_26549', '24384_26716'] },
      // 树开着：细节里用得上树上的名字
      tree: { touched: [8000, 7334], report: () => treeReport() },
    });
    const { engine, log } = harness(world);
    const report = await engine.getLatest();

    // 7334 的水位没变：它的节点不问
    expect(log.filter((line) => line.startsWith('status')).sort()).toEqual([`status ${SITE}`, `status ${ZONE}`]);
    expect(log.filter((line) => line.startsWith('reload'))).toEqual([`reload ${SITE}`]);
    expect(report.models.checked).toBe(2);
    expect(report.models.reloaded).toEqual([{ refno: SITE, added: 1, removed: 0, total: 2 }]);
    expect(report.summary).toBe('已取最新：模型重载 1 个节点（新增 1 个构件）。');
    expect(report.detail).toContain('重载 /AIOS-INC-SITE（24384_26547）：现有 2 个构件，新增 1');
    expect(report.level).toBe('success');
  });

  it('一轮里的顺序：先核对后台，再刷新树，再重载模型，最后才是派生物', async () => {
    const world = makeWorld({
      roots: [root(SITE)],
      statuses: { [SITE]: { status: RELOADABLE, gone: false } },
      tree: { touched: [8000], report: () => treeReport({ changed: true }) },
      derived: [{ name: '属性', run: () => undefined }],
    });
    const { engine, log } = harness(world);
    await engine.getLatest();
    expect(log).toEqual(['health', 'dbnums', 'tree', `status ${SITE}`, `reload ${SITE}`, 'derived 属性']);
  });

  it('库里已经没有这个节点（REFNO_NOT_FOUND）：从场景撤下，不去重载', async () => {
    const world = makeWorld({
      roots: [root('24384_26716')],
      statuses: { '24384_26716': { status: status('unknown', { reason: '库文件最新会话上没有这个节点（可能已被删除）' }), gone: true } },
      loaded: { '24384_26716': ['24384_26717'] },
    });
    const { engine, log } = harness(world);
    const report = await engine.getLatest();
    expect(log).toContain('withdraw 24384_26716');
    expect(log.some((line) => line.startsWith('reload'))).toBe(false);
    expect(report.models.withdrawn).toEqual([{ refno: '24384_26716', refnos: 1, why: 'deleted' }]);
    expect(report.summary).toBe('已取最新：模型撤下 1 个已不存在的节点（撤下 1 个构件）。');
  });

  it('重载查空（节点还在、名下的成员删光了）：算撤下，数的是重载前它装着的构件', async () => {
    const world = makeWorld({
      roots: [root(ZONE)],
      statuses: { [ZONE]: { status: status('empty'), gone: false } },
      loaded: { [ZONE]: ['a', 'b', 'c'] },
      afterReload: { [ZONE]: null },
    });
    const report = await harness(world).engine.getLatest();
    expect(report.models.withdrawn).toEqual([{ refno: ZONE, refnos: 3, why: 'empty' }]);
    expect(report.models.reloaded).toEqual([]);
  });

  it('重载没做成：记进失败，场景不算换过；重载里撤下的构件数算进交代', async () => {
    const world = makeWorld({
      roots: [root(SITE), root(ZONE)],
      statuses: { [SITE]: { status: RELOADABLE, gone: false }, [ZONE]: { status: RELOADABLE, gone: false } },
      loaded: { [SITE]: ['a', 'b'], [ZONE]: ['x', 'y', 'z'] },
      afterReload: { [ZONE]: ['x'] },
      reloadFails: new Set([SITE]),
    });
    const report = await harness(world).engine.getLatest();
    expect(report.models.failed).toEqual([{ refno: SITE, reason: expect.stringContaining('重载没有完成') }]);
    expect(report.models.reloaded).toEqual([{ refno: ZONE, added: 0, removed: 2, total: 1 }]);
    expect(report.summary).toContain('模型重载 1 个节点（撤下 2 个构件）');
    expect(report.summary).toContain('1 个节点重载没成');
    expect(report.level).toBe('warning');
  });

  it('查看器没挂：不碰模型，只说在册几个', async () => {
    const world = makeWorld({ roots: [root(SITE)], hasScene: false, statuses: { [SITE]: { status: RELOADABLE, gone: false } } });
    const { engine, log } = harness(world);
    const report = await engine.getLatest();
    expect(log.some((line) => line.startsWith('status') || line.startsWith('reload'))).toBe(false);
    expect(report.models.rootsTotal).toBe(1);
  });
});

describe('取最新：两轮不并发', () => {
  it('运行中再点：排成下一轮；期间点多少下都合并成那一轮', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let refreshes = 0;
    let inflight = 0;
    let peak = 0;
    // 树的刷新卡在闸门上：第一轮停在这里
    const engineUnderTest = createModelGetWorkWithSlowTree(makeWorld(), gate, () => {
      refreshes += 1;
      inflight += 1;
      peak = Math.max(peak, inflight);
    }, () => { inflight -= 1; });

    const first = engineUnderTest.getLatest();
    await Promise.resolve();
    expect(engineUnderTest.isRunning()).toBe(true);
    const second = engineUnderTest.getLatest();
    const third = engineUnderTest.getLatest();
    expect(third).toBe(second);
    expect(second).not.toBe(first);

    release();
    const [a, b] = await Promise.all([first, second]);
    expect(a).not.toBe(b);
    expect(refreshes).toBe(2);
    expect(peak).toBe(1);
    expect(engineUnderTest.isRunning()).toBe(false);

    // 都跑完之后再点：又是新的一轮
    await engineUnderTest.getLatest();
    expect(refreshes).toBe(3);
  });
});

/** 树的刷新要等闸门放开的引擎（验「两轮不并发」用） */
function createModelGetWorkWithSlowTree(world: World, gate: Promise<void>, onStart: () => void, onEnd: () => void) {
  const ports: GetWorkPorts = {
    now: () => world.now,
    sleep: async (ms) => { world.now += ms; },
    loadBusy: () => false,
    probeService: async () => ({ generation: 1 }),
    fetchDbnumRows: async () => new Map(world.rows.map((item) => [item.dbnum, item])),
    tree: () => ({
      touchedDbnums: () => [],
      refresh: async () => {
        onStart();
        await gate;
        onEnd();
        return treeReport();
      },
      nameOf: () => null,
    }),
    scene: () => null,
    roots: () => [],
    dbnumScopes: () => [],
    listSites: async () => [],
    nodeStatus: async () => ({ status: status('latest'), gone: false }),
    advanceRoot: () => undefined,
    forgetRoot: () => undefined,
    noteSiteKnown: () => undefined,
    noteScopeChecked: () => undefined,
    selection: { current: () => null, isDeleted: () => false, markDeleted: () => undefined },
    probeNodeGone: async () => null,
    derived: () => [],
    onProgress: () => undefined,
  };
  return createModelGetWork(ports);
}

describe('取最新：正在装载或生成时不打断', () => {
  it('装载中点了按钮：等它结束才开始对账（之前一个请求都不发）', async () => {
    let checks = 0;
    const world = makeWorld({ roots: [root(SITE)], statuses: { [SITE]: { status: RELOADABLE, gone: false } } });
    // 前三次看都还在装
    world.busy = () => ++checks <= 3;
    const { engine, log, progress } = harness(world);
    const report = await engine.getLatest();
    expect(progress[0]).toBe('等正在进行的装载结束…');
    expect(world.now).toBeGreaterThan(0);
    expect(log[0]).toBe('health');
    expect(report.models.reloaded).toHaveLength(1);
  });

  it('装载一直不结束：到上限就放弃，照实说，页面不动', async () => {
    const world = makeWorld({ busy: () => true, roots: [root(SITE)] });
    const { engine, log } = harness(world);
    const report = await engine.getLatest();
    expect(report.ok).toBe(false);
    expect(report.error).toContain('一直没结束');
    expect(report.level).toBe('error');
    expect(log).toEqual([]);
    expect(world.now).toBeGreaterThanOrEqual(GETWORK_LOAD_WAIT_MAX_MS);
    expect(world.now).toBeLessThan(GETWORK_LOAD_WAIT_MAX_MS + 2_000);
  });

  it('核对完、要动场景的时候又有装载在跑：等它完了再重载这个节点', async () => {
    const world = makeWorld({ roots: [root(SITE)], statuses: { [SITE]: { status: RELOADABLE, gone: false } } });
    let phase = 0;
    // 开头不忙；问完状态之后忙两拍
    world.busy = () => {
      phase += 1;
      return phase === 2 || phase === 3;
    };
    const { engine, log } = harness(world);
    const before = world.now;
    const report = await engine.getLatest();
    expect(world.now).toBeGreaterThan(before);
    expect(log.filter((line) => line.startsWith('reload'))).toEqual([`reload ${SITE}`]);
    expect(report.models.reloaded).toHaveLength(1);
  });
});

describe('取最新：监听范围内的库后台还没做完', () => {
  it('库文件已前进、后台那一批还没做完：等它做完再一起换（进度里说在等谁）', async () => {
    let fetches = 0;
    const world = makeWorld({
      rows: [ROW_8000_FILE_1146],
      roots: [root(SITE)],
      statuses: { [SITE]: { status: RELOADABLE, gone: false } },
    });
    // 第三次重拉时后台做完了
    world.beforeFetchRows = () => {
      fetches += 1;
      if (fetches >= 3) world.rows = [ROW_8000_AT_1146];
    };
    const { engine, log, progress } = harness(world);
    const report = await engine.getLatest();

    expect(report.waited).toEqual({ dbnums: [8000], ms: 2 * GETWORK_BACKEND_WAIT_POLL_MS, timedOut: [] });
    expect(progress.some((line) => line.startsWith('等后台把库 8000 更新完'))).toBe(true);
    // 等完才问节点、才重载
    expect(log.indexOf(`reload ${SITE}`)).toBeGreaterThan(log.lastIndexOf('dbnums'));
    expect(report.models.reloaded).toHaveLength(1);
    expect(report.libraries).toEqual([]);
  });

  it('等到上限还没做完：换能换的，交代里点名这个库', async () => {
    const world = makeWorld({ rows: [ROW_8000_FILE_1146], roots: [root(SITE)], statuses: { [SITE]: { status: status('latest'), gone: false } } });
    const { engine } = harness(world);
    const report = await engine.getLatest();

    expect(report.waited?.timedOut).toEqual([8000]);
    expect(report.waited?.ms).toBeGreaterThanOrEqual(GETWORK_BACKEND_WAIT_MAX_MS);
    expect(report.waited?.ms).toBeLessThan(GETWORK_BACKEND_WAIT_MAX_MS + GETWORK_BACKEND_WAIT_POLL_MS + 1);
    expect(report.libraries).toEqual([{
      dbnum: 8000,
      kind: 'backend_behind',
      text: '库 8000 后台还没跟上：数据入库到会话 1143，库文件已到 1146，等了 45 秒还没做完，这次先换了能换的',
    }]);
    expect(report.summary).toContain('没跟到最新：库 8000 后台还没跟上');
    expect(report.level).toBe('warning');
  });

  it('不在监听范围的库不等（后台不会去追）；等的时候某一拍库状态没取到，接着等', async () => {
    const outOfScope = makeWorld({ rows: [ROW_1112], roots: [root('17496_9', { dbnum: 1112, loadedModelSesno: 738, loadedFileLatestSesno: 748 })] });
    const first = await harness(outOfScope).engine.getLatest();
    expect(first.waited).toBeNull();
    expect(outOfScope.now).toBe(0);

    let fetches = 0;
    const flaky = makeWorld({ rows: [ROW_8000_FILE_1146], roots: [root(SITE)] });
    flaky.beforeFetchRows = () => {
      fetches += 1;
      flaky.failRows = fetches === 2 ? '超时' : null;
      if (fetches >= 3) flaky.rows = [ROW_8000_AT_1146];
    };
    const second = await harness(flaky).engine.getLatest();
    expect(second.ok).toBe(true);
    expect(second.waited?.timedOut).toEqual([]);
  });

  it('libraryWaitsForBackend：监听范围内文件领先 / 模型落后 / 正在写才等', () => {
    expect(libraryWaitsForBackend(ROW_8000)).toBe(false);
    expect(libraryWaitsForBackend(ROW_8000_FILE_1146)).toBe(true);
    expect(libraryWaitsForBackend(row(ROW_8000, { model_verdict: 'lagging' }))).toBe(true);
    expect(libraryWaitsForBackend(row(ROW_8000, { model_source_reason: 'initialization_publishing' }))).toBe(true);
    expect(libraryWaitsForBackend(ROW_1112)).toBe(false);
    expect(libraryWaitsForBackend(ROW_7009)).toBe(false);
    expect(libraryWaitsForBackend(null)).toBe(false);
  });
});

describe('取最新：后端重启之后的护栏', () => {
  it('重启后按需生成的库里模型没了（未生成）：屏幕上的不动、不当成已删除，交代里说明', async () => {
    const onDemand = root('7009_100', { dbnum: 7009, loadedModelSesno: 0, loadedFileLatestSesno: 479 });
    const world = makeWorld({
      rows: [ROW_7009],
      roots: [onDemand],
      loaded: { '7009_100': ['7009_101', '7009_102'] },
      statuses: { '7009_100': { status: status('not_generated', { dbnum: 7009, generated: null, units: { total: 2, generated: 0, missing: 2, failed: 0, lagging: 0, exact: true } }), gone: false } },
    });
    const { engine, log } = harness(world);
    // 第一轮：没重启、水位没变——不问
    const first = await engine.getLatest();
    expect(first.backendRestarted).toBe(false);
    expect(log.some((line) => line.startsWith('status'))).toBe(false);

    // 后端重启了（服务代次变了），水位还是那样
    world.generation = 2;
    const second = await engine.getLatest();
    expect(second.backendRestarted).toBe(true);
    expect(log).toContain('status 7009_100');
    expect(log.some((line) => line.startsWith('reload') || line.startsWith('withdraw'))).toBe(false);
    expect(world.loaded['7009_100']).toEqual(['7009_101', '7009_102']);
    expect(second.models.kept).toEqual([{
      refno: '7009_100',
      reason: '后端重启过，后端现在没有这个节点的模型，屏幕上的保持原样（不当成已删除）；行上的「生成」可重新生成',
    }]);
    expect(second.summary).toContain('1 个节点的模型没有动');
    expect(second.detail).toContain('上一次取最新以来后端重启过');
  });

  it('重启后库里有成套模型的库（已初始化）不用重问：模型还在库里', async () => {
    const world = makeWorld({ rows: [ROW_8000_AT_1143], roots: [root(SITE)] });
    const { engine, log } = harness(world);
    await engine.getLatest();
    world.generation = 2;
    const second = await engine.getLatest();
    expect(second.backendRestarted).toBe(true);
    expect(log.some((line) => line.startsWith('status'))).toBe(false);
  });

  it('rootNeedsCheck：水位一样不问；变了、没记下、有过期标记、重启且库里没有成套模型时要问', () => {
    const at1143 = root(SITE);
    expect(rootNeedsCheck(at1143, ROW_8000_AT_1143, false)).toBe(false);
    expect(rootNeedsCheck(at1143, ROW_8000_AT_1146, false)).toBe(true);
    // 只有库文件前进（模型水位没动）也要问：按需生成的库、被删的节点都只动这一格
    expect(rootNeedsCheck(at1143, ROW_8000_FILE_1146, false)).toBe(true);
    expect(rootNeedsCheck(root(SITE, { loadedModelSesno: null, loadedFileLatestSesno: null }), ROW_8000_AT_1143, false)).toBe(true);
    expect(rootNeedsCheck(root(SITE, { staleReason: '后端已经重新生成，屏幕上还没换上' }), ROW_8000_AT_1143, false)).toBe(true);
    expect(rootNeedsCheck(at1143, null, false)).toBe(true);
    expect(rootNeedsCheck(at1143, ROW_8000_AT_1143, true)).toBe(false);
    const onDemand = root('7009_100', { dbnum: 7009, loadedModelSesno: 0, loadedFileLatestSesno: 479 });
    expect(rootNeedsCheck(onDemand, ROW_7009, false)).toBe(false);
    expect(rootNeedsCheck(onDemand, ROW_7009, true)).toBe(true);
  });

  it('decideRootAction：后端没有（完整）模型、库在更新、判不了——都不动场景', () => {
    const node = root(SITE);
    const decide = (item: NodeModelStatus, gone = false, restarted = false) => decideRootAction(node, { status: item, gone }, { restarted });
    expect(decide(status('not_generated')).kind).toBe('keep');
    expect(decide(status('partial')).kind).toBe('keep');
    expect(decide(status('updating')).kind).toBe('keep');
    expect(decide(status('unknown', { reason: '水位读不到' })).kind).toBe('keep');
    expect(decide(status('untracked')).kind).toBe('keep');
    expect((decide(status('partial'), false, true) as { reason: string }).reason).toContain('后端重启过，后端现在只有一部分');
    expect((decide(status('not_generated')) as { reason: string }).reason).not.toContain('重启');
    // 库里没有它了：撤下，哪怕状态说的是判不了
    expect(decide(status('unknown'), true)).toEqual({ kind: 'withdraw' });
    expect(decide(RELOADABLE)).toEqual({ kind: 'reload', note: null });
    expect(decide(status('latest'))).toEqual({ kind: 'none' });
    expect(decide(status('empty'))).toEqual({ kind: 'reload', note: null });
  });

  it('decideRootAction：落后的节点——有可换的新版才重载（并说明还落后），没有就不动', () => {
    const node = root(SITE);
    const lagging = status('lagging');
    expect(decideRootAction(node, { status: lagging, gone: false }, { restarted: false })).toEqual({
      kind: 'keep', reason: expect.stringContaining('没有可换的新版'),
    });
    const withReloadable = status('lagging', { reloadableSessions: [{ sesno: 1146, time: null, unitsChanged: 1 }] });
    expect(decideRootAction(node, { status: withReloadable, gone: false }, { restarted: false })).toEqual({
      kind: 'reload', note: expect.stringContaining('落后于库文件'),
    });
  });

  it('decideRootAction：最新但本页装的不是那一版（过期标记 / 按需生成的比本页新 / 装时的水位没记下）→ 重载', () => {
    const latest = status('latest');
    expect(decideRootAction(root(SITE, { staleReason: '更新到一半停了' }), { status: latest, gone: false }, { restarted: false }).kind).toBe('reload');
    expect(decideRootAction(root(SITE, { loadedModelSesno: null, loadedFileLatestSesno: null }), { status: latest, gone: false }, { restarted: false }).kind).toBe('reload');
    // 按需生成的库：后端在会话 485 上重新生成过，本页装的时候库文件在 479
    const onDemand = root('7009_100', { dbnum: 7009, loadedModelSesno: 0, loadedFileLatestSesno: 479 });
    const regenerated = status('latest', { dbnum: 7009, generated: { sesnoMin: 485, sesnoMax: 485, timeMin: null, basis: 'own_generation' } });
    expect(decideRootAction(onDemand, { status: regenerated, gone: false }, { restarted: false }).kind).toBe('reload');
    const sameGeneration = status('latest', { dbnum: 7009, generated: { sesnoMin: 479, sesnoMax: 479, timeMin: null, basis: 'own_generation' } });
    expect(decideRootAction(onDemand, { status: sameGeneration, gone: false }, { restarted: false }).kind).toBe('none');
    // 靠库水位担保的不看这一条（库里比本页新不新由「有更新可重载」判）
    const byWatermark = status('latest', { generated: { sesnoMin: 1146, sesnoMax: 1146, timeMin: null, basis: 'library_watermark' } });
    expect(decideRootAction(root(SITE), { status: byWatermark, gone: false }, { restarted: false }).kind).toBe('none');
  });
});

describe('取最新：登记表里的节点（整库显示 / 地址栏直装）', () => {
  it('别处已经撤掉的：从登记表拿掉，不问、更不装回来', async () => {
    const world = makeWorld({
      roots: [root(SITE, { source: 'registry' })],
      notInScene: new Set([SITE]),
      statuses: { [SITE]: { status: RELOADABLE, gone: false } },
    });
    const { engine, log } = harness(world);
    const report = await engine.getLatest();
    expect(log).toContain(`forget ${SITE}`);
    expect(log.some((line) => line.startsWith('status') || line.startsWith('reload'))).toBe(false);
    expect(report.models.rootsTotal).toBe(0);
  });

  it('已加载节点表里的节点不看「还在不在场景」（照旧信它）', async () => {
    const world = makeWorld({ roots: [root(SITE)], notInScene: new Set([SITE]), statuses: { [SITE]: { status: RELOADABLE, gone: false } } });
    const { engine, log } = harness(world);
    await engine.getLatest();
    expect(log).toContain(`reload ${SITE}`);
    expect(log).not.toContain(`forget ${SITE}`);
  });

  it('核对过、不用动：把它记的水位推进到现在；重载做成了就交给已加载节点表（从登记表拿掉）', async () => {
    const world = makeWorld({
      roots: [root(SITE, { source: 'registry' }), root(ZONE, { source: 'registry' }), root('24384_1', { source: 'table' })],
      statuses: { [SITE]: { status: status('latest'), gone: false }, [ZONE]: { status: RELOADABLE, gone: false } },
      loaded: { [ZONE]: ['a'] },
    });
    const { engine, log } = harness(world);
    await engine.getLatest();
    expect(log).toContain(`advance ${SITE} 1146/1146`);
    expect(log).toContain(`forget ${ZONE}`);
    // 已加载节点表里的不推进（那张表自己管）
    expect(log.some((line) => line.startsWith('advance 24384_1'))).toBe(false);
  });

  it('重载没做成的登记表节点留在登记表里（下次还归取最新管）', async () => {
    const world = makeWorld({
      roots: [root(ZONE, { source: 'registry' })],
      statuses: { [ZONE]: { status: RELOADABLE, gone: false } },
      reloadFails: new Set([ZONE]),
    });
    const { engine, log } = harness(world);
    await engine.getLatest();
    expect(log).not.toContain(`forget ${ZONE}`);
  });
});

describe('取最新：整库显示里新出现的顶层 SITE', () => {
  const scope = (patch: Partial<GetWorkDbnumScope> = {}): GetWorkDbnumScope => (
    { dbnum: 8000, knownSites: new Set([SITE]), discover: true, checkedFileLatestSesno: 1143, ...patch }
  );
  const NEW_SITE = { refno: '24384_30000', name: '/NEW-SITE' };

  it('库文件前进了：查 SITE 名单，后端有模型的新 SITE 装进来、记成已在管，记下找过了', async () => {
    const world = makeWorld({
      scopes: [scope()],
      sites: { 8000: [{ refno: SITE, name: '/AIOS-INC-SITE' }, NEW_SITE] },
      statuses: { [NEW_SITE.refno]: { status: status('latest'), gone: false } },
      afterReload: { [NEW_SITE.refno]: ['24384_30001', '24384_30002'] },
    });
    const { engine, log } = harness(world);
    const report = await engine.getLatest();
    expect(log).toContain('sites 8000');
    expect(log).toContain(`reload ${NEW_SITE.refno}`);
    expect(log).toContain(`known 8000 ${NEW_SITE.refno}`);
    expect(log).toContain('scope-checked 8000 1146');
    // 已经在管的 SITE 不在这里重问
    expect(log).not.toContain(`status ${SITE}`);
    expect(report.models.loadedNew).toEqual([{ refno: NEW_SITE.refno, name: '/NEW-SITE', total: 2 }]);
    expect(report.summary).toBe('已取最新：模型新装入 1 个 SITE。');
  });

  it('库文件没有新会话：不查 SITE 名单', async () => {
    const world = makeWorld({ rows: [ROW_8000_AT_1143], scopes: [scope()], sites: { 8000: [NEW_SITE] } });
    const { engine, log } = harness(world);
    await engine.getLatest();
    expect(log).not.toContain('sites 8000');
  });

  it('按预算只显示了一部分的库：不找新 SITE（没轮到的不是新增的）', async () => {
    const world = makeWorld({ scopes: [scope({ discover: false })], sites: { 8000: [NEW_SITE] } });
    const { engine, log } = harness(world);
    await engine.getLatest();
    expect(log).not.toContain('sites 8000');
  });

  it('新 SITE 后端还没有模型：不装、说明，也不记「找过了」——下一轮还要再看', async () => {
    const world = makeWorld({
      scopes: [scope()],
      sites: { 8000: [NEW_SITE] },
      statuses: { [NEW_SITE.refno]: { status: status('not_generated'), gone: false } },
    });
    const { engine, log } = harness(world);
    const report = await engine.getLatest();
    expect(log).not.toContain(`reload ${NEW_SITE.refno}`);
    expect(log.some((line) => line.startsWith('scope-checked'))).toBe(false);
    expect(log.some((line) => line.startsWith('known'))).toBe(false);
    expect(report.models.kept).toEqual([{ refno: NEW_SITE.refno, reason: expect.stringContaining('后端还没有它的模型') }]);
  });

  it('名下没有生成单元的新 SITE：没有可装的，不装也不说；记下找过了', async () => {
    const world = makeWorld({
      scopes: [scope()],
      sites: { 8000: [NEW_SITE] },
      statuses: { [NEW_SITE.refno]: { status: status('empty'), gone: false } },
    });
    const { engine, log } = harness(world);
    const report = await engine.getLatest();
    expect(log).not.toContain(`reload ${NEW_SITE.refno}`);
    expect(log.some((line) => line.startsWith('known'))).toBe(false);
    expect(log).toContain('scope-checked 8000 1146');
    expect(report.models.kept).toEqual([]);
  });

  it('SITE 名单没查到：记一笔失败，别的照常', async () => {
    const world = makeWorld({ scopes: [scope()], sites: {} });
    const report = await harness(world).engine.getLatest();
    expect(report.models.failed).toEqual([{ refno: 'dbnum 8000', reason: expect.stringContaining('没查到这个库的 SITE 名单') }]);
    expect(report.ok).toBe(true);
  });

  it('newSiteHasModel：最新 / 落后 / 可重载算有；部分生成要真有生成过的单元；未生成、空、判不了不算', () => {
    expect(newSiteHasModel(status('latest'))).toBe(true);
    expect(newSiteHasModel(status('lagging'))).toBe(true);
    expect(newSiteHasModel(status('partial', { units: { total: 3, generated: 1, missing: 2, failed: 0, lagging: 0, exact: true } }))).toBe(true);
    expect(newSiteHasModel(status('partial', { units: { total: 3, generated: 0, missing: 2, failed: 1, lagging: 0, exact: true } }))).toBe(false);
    expect(newSiteHasModel(status('not_generated'))).toBe(false);
    expect(newSiteHasModel(status('empty'))).toBe(false);
    expect(newSiteHasModel(status('unknown'))).toBe(false);
  });
});

describe('取最新：选中的构件与派生物', () => {
  const removedTree = (fate: 'deleted' | 'relocated' | 'unknown') => treeReport({
    changed: true,
    removed: [{ id: '24384_26716', name: '/AIOS-INC-ADD', type: 'EQUI', dbnum: 8000, fate }],
    removedNodeCount: 2,
    removedUnder: { '24384_26716': '24384_26716', '24384_26717': '24384_26716' },
  });

  it('选中的构件随被删的祖先一起从树上消失：登记成「已删除」，不用再去问', async () => {
    const world = makeWorld({ selected: '24384_26717', tree: { touched: [8000], report: () => removedTree('deleted') } });
    const { engine, log, marked } = harness(world);
    const report = await engine.getLatest();
    expect(marked).toEqual(['24384_26717']);
    expect(report.selectionDeleted).toBe('24384_26717');
    expect(log.some((line) => line.startsWith('probe'))).toBe(false);
    expect(report.summary).toContain('选中的构件已被删除');
  });

  it('祖先只是挪到了没展开的位置：选中的不算删除，也不去问', async () => {
    const world = makeWorld({ selected: '24384_26717', tree: { touched: [8000], report: () => removedTree('relocated') } });
    const { engine, log, marked } = harness(world);
    await engine.getLatest();
    expect(marked).toEqual([]);
    expect(log.some((line) => line.startsWith('probe'))).toBe(false);
  });

  it('树上看不出来（树没开、或选中的不在树上）：问一次库里还有没有；没有了才登记，还在或没问到都不动', async () => {
    const gone = makeWorld({ selected: '24384_26717', goneProbe: { '24384_26717': true } });
    const a = harness(gone);
    await a.engine.getLatest();
    expect(a.log).toContain('probe 24384_26717');
    expect(a.marked).toEqual(['24384_26717']);

    const still = makeWorld({ selected: '24384_26549', goneProbe: { '24384_26549': false } });
    const b = harness(still);
    await b.engine.getLatest();
    expect(b.marked).toEqual([]);

    const unknown = makeWorld({ selected: '24384_26549', goneProbe: { '24384_26549': null }, tree: { touched: [8000], report: () => removedTree('unknown') } });
    const c = harness(unknown);
    await c.engine.getLatest();
    expect(c.marked).toEqual([]);
  });

  it('选中的正是这一轮撤下的节点：登记成已删除；已经登记过的不重复处理', async () => {
    const world = makeWorld({
      selected: '24384_26716',
      roots: [root('24384_26716')],
      statuses: { '24384_26716': { status: status('unknown'), gone: true } },
    });
    const first = harness(world);
    await first.engine.getLatest();
    expect(first.marked).toEqual(['24384_26716']);
    expect(first.log.some((line) => line.startsWith('probe'))).toBe(false);

    const already = makeWorld({ selected: '24384_26716', selectedIsDeleted: true, goneProbe: { '24384_26716': true } });
    const second = harness(already);
    await second.engine.getLatest();
    expect(second.marked).toEqual([]);
    expect(second.log.some((line) => line.startsWith('probe'))).toBe(false);
  });

  it('派生物：每轮都叫到，带着「这一轮有没有变化」；一个出错不影响别的，回执里记下', async () => {
    const seen: GetWorkDerivedContext[] = [];
    const world = makeWorld({
      roots: [root(SITE)],
      statuses: { [SITE]: { status: RELOADABLE, gone: false } },
      derived: [
        { name: '属性', run: (context) => { seen.push(context); } },
        { name: 'MBD 标注', run: () => { throw new Error('取不到'); } },
        { name: '房间树', run: (context) => { seen.push(context); } },
      ],
    });
    const { engine } = harness(world);
    const report = await engine.getLatest();
    expect(seen).toEqual([
      { changed: true, treeChanged: false, modelsChanged: true },
      { changed: true, treeChanged: false, modelsChanged: true },
    ]);
    expect(report.derived).toEqual([{ name: '属性', ok: true }, { name: 'MBD 标注', ok: false }, { name: '房间树', ok: true }]);
    expect(report.detail).toContain('没刷新成：MBD 标注');
    expect(report.level).toBe('warning');
  });

  it('什么都没变的一轮：派生物拿到「没变化」；碰过的库水位比上一轮动了就算有变化', async () => {
    const seen: GetWorkDerivedContext[] = [];
    const world = makeWorld({
      rows: [ROW_8000_AT_1143],
      tree: { touched: [8000], report: () => treeReport() },
      derived: [{ name: '房间树', run: (context) => { seen.push(context); } }],
    });
    const { engine } = harness(world);
    await engine.getLatest();
    world.rows = [ROW_8000_AT_1146];
    await engine.getLatest();
    await engine.getLatest();
    expect(seen.map((item) => item.changed)).toEqual([false, true, false]);
  });
});

describe('取最新：哪些库没能跟到最新', () => {
  it('不在监听范围的库（1112：模型停在 738、库文件已到 748）：交代里点明，不算警告', async () => {
    const world = makeWorld({
      rows: [ROW_1112, ROW_7009, ROW_7334, ROW_8000],
      tree: { touched: [1112, 7009, 7334, 8000], report: () => treeReport() },
    });
    const report = await harness(world).engine.getLatest();
    expect(report.libraries).toEqual([{
      dbnum: 1112,
      kind: 'out_of_scope',
      text: '库 1112 不在后台的监听范围里：模型停在会话 738，库文件已到 748（树已是最新，模型不会自动跟上）',
    }]);
    expect(report.summary).toBe(
      '已是最新：模型树和已装的模型都没有变化（核对了 3 层树）。没跟到最新：库 1112 不在后台的监听范围里：模型停在会话 738，库文件已到 748（树已是最新，模型不会自动跟上）。',
    );
    expect(report.level).toBe('info');
  });

  it('只交代这个页面碰过的库：没碰过 1112 就不提它', async () => {
    const world = makeWorld({ rows: [ROW_1112, ROW_8000], tree: { touched: [8000], report: () => treeReport() } });
    const report = await harness(world).engine.getLatest();
    expect(report.libraries).toEqual([]);
  });

  it('describeLibraryGap：各种库状态', () => {
    expect(describeLibraryGap(8000, ROW_8000)).toBeNull();
    expect(describeLibraryGap(7334, ROW_7334)).toBeNull();
    // 未初始化、按需生成：没有库一级的模型水位，落不落后在节点那里说
    expect(describeLibraryGap(7009, ROW_7009)).toBeNull();
    expect(describeLibraryGap(1112, ROW_1112)?.kind).toBe('out_of_scope');
    expect(describeLibraryGap(8000, ROW_8000_FILE_1146)).toEqual({
      dbnum: 8000, kind: 'backend_behind', text: '库 8000 后台还没跟上：数据入库到会话 1143，库文件已到 1146',
    });
    expect(describeLibraryGap(8000, row(ROW_8000, { model_verdict: 'lagging', model_sesno: 1150 }))).toEqual({
      dbnum: 8000, kind: 'backend_behind', text: '库 8000 后台的模型还没跟上：模型在会话 1150，数据已到 1155',
    });
    expect(describeLibraryGap(8000, row(ROW_8000, { model_source_reason: 'initialization_publishing' }))?.kind).toBe('updating');
    expect(describeLibraryGap(8000, row(ROW_8000, { blocked: true }))?.kind).toBe('blocked');
    expect(describeLibraryGap(8000, row(ROW_8000, { model_verdict: 'not_judged', model_sesno: 1160 }))?.kind).toBe('unknown');
    expect(describeLibraryGap(9999, null)).toEqual({ dbnum: 9999, kind: 'unknown', text: '库 9999 的状态没取到，新旧不知道' });
  });
});

describe('取最新：没做成的时候', () => {
  it('后台连不上：页面不动，照实说', async () => {
    const world = makeWorld({ failProbe: 'Failed to fetch', roots: [root(SITE)], tree: { touched: [8000], report: () => treeReport() } });
    const { engine, log } = harness(world);
    const report = await engine.getLatest();
    expect(report.ok).toBe(false);
    expect(report.summary).toBe('取最新没有完成：后台连不上（Failed to fetch），页面没有动');
    expect(log).toEqual(['health']);
  });

  it('库状态没取到：页面不动', async () => {
    const world = makeWorld({ failRows: 'timeout', roots: [root(SITE)], tree: { touched: [8000], report: () => treeReport() } });
    const { engine, log } = harness(world);
    const report = await engine.getLatest();
    expect(report.ok).toBe(false);
    expect(report.error).toContain('库状态没取到');
    expect(log).toEqual(['health', 'dbnums']);
  });

  it('树刷新出错：记下来，模型照常核对', async () => {
    const world = makeWorld({
      roots: [root(SITE)],
      statuses: { [SITE]: { status: RELOADABLE, gone: false } },
      tree: { touched: [8000], report: () => { throw new Error('树炸了'); } },
    });
    const report = await harness(world).engine.getLatest();
    expect(report.treeError).toBe('树炸了');
    expect(report.models.reloaded).toHaveLength(1);
    expect(report.summary).toContain('模型树没刷新成');
    expect(report.level).toBe('warning');
  });
});

describe('summarizeGetWork', () => {
  function base(patch: Partial<GetWorkReport>): GetWorkReport {
    return {
      startedAt: 0, finishedAt: 0, ok: true, error: null, backendRestarted: false, tree: null, treeError: null,
      models: { rootsTotal: 0, checked: 0, reloaded: [], loadedNew: [], withdrawn: [], kept: [], failed: [] },
      libraries: [], waited: null, selectionDeleted: null, derived: [], level: 'info', summary: '', detail: [],
      ...patch,
    };
  }

  it('树上增删改挪各几处、模型换了多少，一句说完', () => {
    const change = (id: string, name: string) => ({ id, name, type: 'EQUI', dbnum: 8000 });
    const out = summarizeGetWork(base({
      tree: treeReport({
        changed: true,
        added: [change('1_5', '/ADDED')],
        removed: [{ ...change('1_4', '/GONE'), fate: 'deleted' }, { ...change('1_8', '/MOVED-AWAY'), fate: 'relocated' }, { ...change('1_9', '/LOST'), fate: 'unknown' }],
        renamed: [{ ...change('1_3', '/NEW'), previousName: '/OLD', previousType: 'EQUI' }],
        moved: [{ ...change('1_7', '/MOVED'), from: '1_2', to: '1_6' }],
        layersFailed: [{ id: '1_2', name: '/ZONE-A', error: 'network: 断了' }],
      }),
      models: {
        rootsTotal: 3, checked: 3,
        reloaded: [{ refno: 'a', added: 2, removed: 1, total: 9 }],
        loadedNew: [],
        withdrawn: [{ refno: 'b', refnos: 4, why: 'deleted' }],
        kept: [], failed: [],
      },
    }));
    expect(out.summary).toBe(
      '已取最新：模型树新增 1、删除 1、改名 1、挪位置 2、从树上消失 1（没问到是删了还是挪了）；有 1 层没取到（保持原样）；'
      + '模型重载 1 个节点、撤下 1 个已不存在的节点（新增 2 个构件、撤下 5 个构件）。',
    );
    expect(out.detail).toEqual([
      '树上新增：/ADDED',
      '树上删除：/GONE',
      '树上改名：/OLD → /NEW',
      '树上挪位置：/MOVED',
      '挪到了树上还没展开的位置：/MOVED-AWAY',
      '没取到的层：/ZONE-A（network: 断了）',
      '重载 a：现有 9 个构件，新增 2，撤下 1',
      '撤下 b（库里已经没有它）：4 个构件',
    ]);
    expect(out.level).toBe('warning');
  });

  it('什么都没变：说已是最新、核对了多少', () => {
    const out = summarizeGetWork(base({
      tree: treeReport({ layersRequested: 12 }),
      models: { rootsTotal: 3, checked: 0, reloaded: [], loadedNew: [], withdrawn: [], kept: [], failed: [] },
    }));
    expect(out).toEqual({ summary: '已是最新：模型树和已装的模型都没有变化（核对了 12 层树、3 个已装的节点）。', detail: [], level: 'info' });
  });

  it('名字多了只点前三个；树上只有顺序变了也算做了事', () => {
    const many = Array.from({ length: 5 }, (_, index) => ({ id: `1_${index}`, name: `/N${index}`, type: 'EQUI', dbnum: 8000 }));
    const out = summarizeGetWork(base({ tree: treeReport({ changed: true, added: many }) }));
    expect(out.detail).toEqual(['树上新增：/N0、/N1、/N2 等 5 个']);
    expect(out.level).toBe('success');
    expect(summarizeGetWork(base({ tree: treeReport({ changed: true }) })).level).toBe('success');
  });
});

it('时间常量：等后台最多 45 秒、3 秒看一次（任务书定的上限要有）', () => {
  expect(GETWORK_BACKEND_WAIT_MAX_MS).toBe(45_000);
  expect(GETWORK_BACKEND_WAIT_POLL_MS).toBe(3_000);
  expect(vi.isFakeTimers()).toBe(false);
});
