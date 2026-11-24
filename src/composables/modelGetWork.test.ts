/**
 * 「取最新」的协调（`modelGetWork`）：按库对账、两轮不并发、装载中排队、等后台的上限、后端重启后的护栏、
 * 不在后端更新范围的库的交代。端口全是假的；`/dbnums` 的行照 2026-11-12 现网的回执（8022，去掉了文件路径）。
 */
import { describe, expect, it, vi } from 'vitest';

import {
  createModelGetWork,
  decideRootAction,
  describeLibraryGap,
  describeOutOfScopeLibrary,
  GETWORK_BACKEND_WAIT_MAX_MS,
  GETWORK_BACKEND_WAIT_POLL_MS,
  GETWORK_LOAD_WAIT_MAX_MS,
  libraryWaitsForBackend,
  newSiteHasModel,
  rootNeedsCheck,
  screenHoldsBackendModel,
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

/** 后端更新范围内、三枚水位对齐 */
const ROW_8000 = {
  dbnum: 8000, db_type: 'DESI', file_latest_sesno: 1155, not_in_project: false, applied_sesno: 1155, initialized: true,
  model_sesno: 1155, model_sesno_time: '2026-11-11T04:50:07+00:00', model_verdict: 'in_sync', model_verdict_reason: null,
  excluded: false, excluded_reason: null, model_source: 'database', model_source_reason: null,
} as unknown as DbnumRow;
/** 不在后端更新范围、已初始化、库文件比已入库的新 10 个会话 */
const ROW_1112 = {
  dbnum: 1112, db_type: 'DESI', file_latest_sesno: 748, not_in_project: false, applied_sesno: 738, initialized: true,
  model_sesno: 738, model_sesno_time: '2026-09-23T07:19:54+00:00', model_verdict: 'in_sync', model_verdict_reason: null,
  excluded: true, excluded_reason: 'watch_dbnums', model_source: 'database', model_source_reason: null,
} as unknown as DbnumRow;
/** 不在后端更新范围、未初始化：模型按需生成、只在后端内存里 */
const ROW_7009 = {
  dbnum: 7009, db_type: 'DESI', file_latest_sesno: 479, not_in_project: false, applied_sesno: 0, initialized: false,
  model_sesno: 0, model_sesno_time: null, model_verdict: 'not_judged', model_verdict_reason: 'data_watermark_unestablished',
  excluded: true, excluded_reason: 'watch_dbnums', model_source: 'memory', model_source_reason: 'data_watermark_unestablished',
} as unknown as DbnumRow;
/** 不在后端更新范围、已初始化、水位相等 */
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
  /** 页面打开时的服务代次（接线给的）；不写就是没给 */
  initialGeneration?: number;
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
  /** 撤下一个节点时场景说撤了几个构件（没写就按它装着的件数） */
  withdrawCount: Record<string, number>;
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
    loaded: {}, afterReload: {}, reloadFails: new Set(), withdrawCount: {}, notInScene: new Set(), sites: {}, tree: null, hasScene: true, selected: null,
    selectedIsDeleted: false, goneProbe: {}, derived: [], failProbe: null, failRows: null,
    ...patch,
  };
}

function harness(world: World) {
  const log: string[] = [];
  /** 场景端口被问到时带的库号（登记时就知道的那个，不靠现查） */
  const sceneCalls: string[] = [];
  const progress: string[] = [];
  const marked: string[] = [];
  const ports: GetWorkPorts = {
    now: () => world.now,
    sleep: async (ms) => {
      world.now += ms;
    },
    loadBusy: () => world.busy(),
    ...(world.initialGeneration !== undefined ? { initialGeneration: world.initialGeneration } : {}),
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
      withdraw: (refno, dbnum) => {
        sceneCalls.push(`withdraw ${refno} ${dbnum}`);
        log.push(`withdraw ${refno}`);
        const count = world.withdrawCount[refno] ?? world.loaded[refno]?.length ?? 0;
        delete world.loaded[refno];
        return count;
      },
      loadedRefnos: (refno, dbnum) => {
        sceneCalls.push(`loaded ${refno} ${dbnum}`);
        return world.loaded[refno] ?? null;
      },
      rootInScene: (refno, dbnum) => {
        sceneCalls.push(`in-scene ${refno} ${dbnum}`);
        return !world.notInScene.has(refno);
      },
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
  return { engine: createModelGetWork(ports), log, progress, marked, sceneCalls };
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

    // 排过一次下一轮之后，再来一遍照样排得上（上一次排的那一轮不会被当成还没跑）
    const fourth = engineUnderTest.getLatest();
    const fifth = engineUnderTest.getLatest();
    expect(fifth).not.toBe(second);
    expect(fifth).not.toBe(fourth);
    await Promise.all([fourth, fifth]);
    expect(refreshes).toBe(5);
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

describe('取最新：后端更新范围内的库后台还没做完', () => {
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

  it('不在后端更新范围的库不等（后台不会去追）；等的时候某一拍库状态没取到，接着等', async () => {
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

  it('libraryWaitsForBackend：后端更新范围内库文件领先 / 模型没跟上数据 / 正在写才等', () => {
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
      statuses: { '7009_100': { status: status('not_generated', { dbnum: 7009, generated: null, unitsToGenerate: 2, units: { total: 2, generated: 0, missing: 2, failed: 0, lagging: 0, exact: true } }), gone: false } },
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
    expect(second.detail).toContain('这次取最新之前后端重启过');
    // 有节点没跟上：这一句是警告的颜色
    expect(second.level).toBe('warning');
  });

  it('头一轮就认得出重启：页面打开时的服务代次给了、现在比它大——按需生成的库里的节点照问、不重载、不当成已删除', async () => {
    // 2026-11-12 真实后端上撞到的：装了 7998 的一个 ZONE（按需生成）→ 后端重启 → 头一次点取最新，原来说的是「已是最新」
    const world = makeWorld({
      initialGeneration: 0,
      generation: 1,
      rows: [ROW_7009],
      roots: [root('7009_100', { dbnum: 7009, loadedModelSesno: 0, loadedFileLatestSesno: 479 })],
      statuses: { '7009_100': { status: status('not_generated', { dbnum: 7009, generated: null, unitsToGenerate: 1 }), gone: false } },
      loaded: { '7009_100': ['7009_101', '7009_102'] },
    });
    const { engine, log } = harness(world);

    const first = await engine.getLatest();

    expect(first.backendRestarted).toBe(true);
    expect(log).toContain('status 7009_100');
    expect(log.some((line) => line.startsWith('reload') || line.startsWith('withdraw'))).toBe(false);
    expect(world.loaded['7009_100']).toEqual(['7009_101', '7009_102']);
    expect(first.models.kept).toEqual([{
      refno: '7009_100',
      reason: '后端重启过，后端现在没有这个节点的模型，屏幕上的保持原样（不当成已删除）；行上的「生成」可重新生成',
    }]);
    expect(first.summary).toBe('已取最新：1 个节点的模型没有动。');
    expect(first.detail).toContain('这次取最新之前后端重启过');
    expect(first.level).toBe('warning');

    // 第二轮：后端没再重启——不再算重启，核对过的节点也不再问
    log.length = 0;
    const second = await engine.getLatest();
    expect(second.backendRestarted).toBe(false);
  });

  it('头一轮：服务代次还是页面打开时的那个——不算重启，水位没变的节点不问', async () => {
    const world = makeWorld({
      initialGeneration: 0,
      generation: 0,
      rows: [ROW_7009],
      roots: [root('7009_100', { dbnum: 7009, loadedModelSesno: 0, loadedFileLatestSesno: 479 })],
      loaded: { '7009_100': ['7009_101'] },
    });
    const { engine, log } = harness(world);

    const first = await engine.getLatest();

    expect(first.backendRestarted).toBe(false);
    expect(log.some((line) => line.startsWith('status'))).toBe(false);
    expect(first.detail).not.toContain('这次取最新之前后端重启过');
  });

  it('没给页面打开时的服务代次：头一轮没有可比的，不算重启（第二轮起照旧认得出）', async () => {
    const world = makeWorld({
      generation: 5,
      rows: [ROW_7009],
      roots: [root('7009_100', { dbnum: 7009, loadedModelSesno: 0, loadedFileLatestSesno: 479 })],
      loaded: { '7009_100': ['7009_101'] },
    });
    const { engine } = harness(world);

    expect((await engine.getLatest()).backendRestarted).toBe(false);
    world.generation = 6;
    expect((await engine.getLatest()).backendRestarted).toBe(true);
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
    // 两边都没有水位可比（装的时候没记下，库这一行也没带）：比不出「一样」，要问
    expect(rootNeedsCheck(root(SITE, { loadedModelSesno: null, loadedFileLatestSesno: null }), { dbnum: 8000 } as DbnumRow, false)).toBe(true);
    // 只有模型水位变了（装的时候后台还没跟上库文件，现在跟上了）也要问
    expect(rootNeedsCheck(root(SITE, { loadedModelSesno: 1143, loadedFileLatestSesno: 1146 }), ROW_8000_AT_1146, false)).toBe(true);
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

  it('decideRootAction：后端没有（完整）模型时，让人去点的是行上真给的那一颗按钮', () => {
    const node = root(SITE);
    const reasonOf = (item: NodeModelStatus, restarted = false): string => (
      (decideRootAction(node, { status: item, gone: false }, { restarted }) as { reason: string }).reason
    );
    const oneMissing = { total: 2, generated: 1, missing: 1, failed: 0, lagging: 0, exact: true };
    // 库在后端更新范围里、库文件比模型水位新：缺的单元靠库一级的更新补，行上给的是「更新」（不是「生成」）
    const libraryBehind = { modelSesno: 1652, fileLatestSesno: 1657, inWatchScope: true, unitsToGenerate: 1, units: oneMissing };
    expect(reasonOf(status('partial', libraryBehind))).toBe(
      '后端现在只有一部分这个节点的模型，屏幕上的保持原样（不当成已删除）；行上的「更新」可让后端把这个库更新到最新',
    );
    expect(reasonOf(status('not_generated', { ...libraryBehind, generated: null }), true)).toBe(
      '后端重启过，后端现在没有这个节点的模型，屏幕上的保持原样（不当成已删除）；行上的「更新」可让后端把这个库更新到最新',
    );
    // 库已经跟上、或不在更新范围里（按需生成）：行上给的是「生成」
    expect(reasonOf(status('partial', { ...libraryBehind, modelSesno: 1657 }))).toBe(
      '后端现在只有一部分这个节点的模型，屏幕上的保持原样（不当成已删除）；行上的「生成」可重新生成',
    );
    expect(reasonOf(status('not_generated', { ...libraryBehind, inWatchScope: false, generated: null }))).toBe(
      '后端现在没有这个节点的模型，屏幕上的保持原样（不当成已删除）；行上的「生成」可重新生成',
    );
    // 没有要生成的单元、或说不出要生成几个：行上没有按钮，不指一颗不存在的
    expect(reasonOf(status('partial', { ...libraryBehind, unitsToGenerate: 0 }))).toBe('后端现在只有一部分这个节点的模型，屏幕上的保持原样（不当成已删除）');
    expect(reasonOf(status('not_generated', { unitsToGenerate: null, generated: null }))).toBe('后端现在没有这个节点的模型，屏幕上的保持原样（不当成已删除）');
  });

  it('库在后端更新范围里、后台还没跟上，节点下新建的单元还没有模型：一整轮下来细节里让人点的是「更新」，不提「生成」', async () => {
    // 2026-11-17 沙箱：8000 库文件 1652 → 1657（新建了一条分支），后台故意不跟；ZONE 成了「部分生成」，行上给的是库一级的「更新」，
    // 取最新的细节却写「行上的『生成』可重新生成」
    const behind = row(ROW_8000, { file_latest_sesno: 1657, applied_sesno: 1652, model_sesno: 1652 });
    const partial = status('partial', {
      modelSesno: 1652, fileLatestSesno: 1657, loadedModelSesno: 1652, unitsToGenerate: 1,
      units: { total: 2, generated: 1, missing: 1, failed: 0, lagging: 0, exact: true },
    });
    const world = makeWorld({
      rows: [behind],
      roots: [root(ZONE, { loadedModelSesno: 1652, loadedFileLatestSesno: 1652 })],
      statuses: { [ZONE]: { status: partial, gone: false } },
      loaded: { [ZONE]: ['24384_47481'] },
    });
    const report = await harness(world).engine.getLatest();
    expect(report.models.kept).toEqual([{
      refno: ZONE,
      reason: '后端现在只有一部分这个节点的模型，屏幕上的保持原样（不当成已删除）；行上的「更新」可让后端把这个库更新到最新',
    }]);
    expect(report.detail.join('\n')).not.toContain('「生成」');
  });

  it('decideRootAction：落后的节点——有可换的新版才重载（并说明还落后），没有就不动', () => {
    const node = root(SITE);
    const lagging = status('lagging');
    expect(decideRootAction(node, { status: lagging, gone: false }, { restarted: false })).toEqual({
      kind: 'keep', reason: '这个节点落后（模型生成之后又有会话改到了它），屏幕上的没有可换的新版；行上的「更新」可让后端追上',
    });
    const withReloadable = status('lagging', { reloadableSessions: [{ sesno: 1146, time: null, unitsChanged: 1 }] });
    expect(decideRootAction(node, { status: withReloadable, gone: false }, { restarted: false })).toEqual({
      kind: 'reload', note: '这个节点落后（模型生成之后又有会话改到了它）：这次换上的是后台现有的那一版；行上的「更新」可让后端追上',
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
    // 会话回退（targetModelSesno < loadedModelSesno）→ 保守重载
    const rolledBack = status('latest', { modelSesno: 1140, generated: { sesnoMin: 1140, sesnoMax: 1140, timeMin: null, basis: 'library_watermark' } });
    expect(decideRootAction(root(SITE, { loadedModelSesno: 1146, loadedFileLatestSesno: 1146 }), { status: rolledBack, gone: false }, { restarted: false }).kind).toBe('reload');
    // 靠库水位担保但缺少有效模型水位基线（loadedModelSesno 为 null 或 0）→ 保守重载
    expect(decideRootAction(root(SITE, { loadedModelSesno: null, loadedFileLatestSesno: 1143 }), { status: byWatermark, gone: false }, { restarted: false }).kind).toBe('reload');
    expect(decideRootAction(root(SITE, { loadedModelSesno: 0, loadedFileLatestSesno: 1143 }), { status: byWatermark, gone: false }, { restarted: false }).kind).toBe('reload');
    // 已有 reloadHint → 保守重载
    expect(decideRootAction(root(SITE, { reloadHint: true }), { status: byWatermark, gone: false }, { restarted: false }).kind).toBe('reload');
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
    expect(report.summary).toBe('已取最新：模型新装入 1 个 SITE（新增 2 个构件）。');
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

  it('被删的节点树上已经查不到名字：细节里用它消失前的名字', async () => {
    const world = makeWorld({
      roots: [root('24384_26716')],
      statuses: { '24384_26716': { status: status('unknown'), gone: true } },
      loaded: { '24384_26716': ['24384_26717'] },
      selected: '24384_26716',
      tree: { touched: [8000], report: () => removedTree('deleted') },
    });
    const report = await harness(world).engine.getLatest();
    expect(report.detail).toContain('撤下 /AIOS-INC-ADD（24384_26716）（库里已经没有它）：1 个构件');
    expect(report.detail).toContain('选中的 /AIOS-INC-ADD（24384_26716） 在库里已经没有了');
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
  it('不在后端更新范围的库（1112：模型停在 738、库文件已到 748）：交代里点明，不算警告', async () => {
    const world = makeWorld({
      rows: [ROW_1112, ROW_7009, ROW_7334, ROW_8000],
      tree: { touched: [1112, 7009, 7334, 8000], report: () => treeReport() },
    });
    const report = await harness(world).engine.getLatest();
    expect(report.libraries).toEqual([{
      dbnum: 1112,
      kind: 'out_of_scope',
      text: '库 1112 不在后端更新范围里：模型停在会话 738，库文件已到 748（树已是最新，模型不会自动跟上）',
    }]);
    expect(report.summary).toBe(
      '已是最新：模型树和已装的模型都没有变化（核对了 3 层树）。没跟到最新：库 1112 不在后端更新范围里：模型停在会话 738，库文件已到 748（树已是最新，模型不会自动跟上）。',
    );
    expect(report.level).toBe('info');
  });

  it('三枚水位对不上的库（后端判不了新旧）：一整轮下来那一句里写明是哪三枚，不单说「水位」', async () => {
    const world = makeWorld({
      rows: [row(ROW_8000, { model_verdict: 'not_judged', model_sesno: 1160 })],
      tree: { touched: [8000], report: () => treeReport() },
    });
    const report = await harness(world).engine.getLatest();
    expect(report.libraries).toEqual([{
      dbnum: 8000,
      kind: 'unknown',
      text: '库 8000 的三枚水位（库文件最新会话、数据入库到的会话、模型生成所按的会话）对不上，新旧判不了',
    }]);
    expect(report.summary).toContain('库 8000 的三枚水位（库文件最新会话、数据入库到的会话、模型生成所按的会话）对不上，新旧判不了');
    expect(report.summary).not.toMatch(/库 8000 的水位/);
  });

  it('只交代这个页面碰过的库：没碰过 1112 就不提它', async () => {
    const world = makeWorld({ rows: [ROW_1112, ROW_8000], tree: { touched: [8000], report: () => treeReport() } });
    const report = await harness(world).engine.getLatest();
    expect(report.libraries).toEqual([]);
  });

  // ---- 2026-11-17 沙箱里撞到的：7998 初始化过、不在后端更新范围里，库一级的模型停在 677、库文件到了 679 ----
  const ROW_7998 = row(ROW_1112, { dbnum: 7998, file_latest_sesno: 679, applied_sesno: 677, model_sesno: 677 });
  const NOTE_7998 = '库 7998 不在后端更新范围里：模型停在会话 677，库文件已到 679（树已是最新，模型不会自动跟上）';
  const FACT_7998 = '库 7998 不在后端更新范围里（库一级的模型停在会话 677，库文件已到 679）；页面上装着的 1 个节点已是最新';
  const EQUI_A = '24382_1911';
  const EQUI_B = '24382_1920';
  const EQUI_C = '24382_1930';
  /** 装上的时候库就是现在这个水位（装上之后库没再变过） */
  const in7998 = (refno: string, patch: Partial<GetWorkRoot> = {}): GetWorkRoot => (
    root(refno, { dbnum: 7998, loadedModelSesno: 677, loadedFileLatestSesno: 679, ...patch })
  );
  const status7998 = (verdict: NodeModelStatus['verdict'], patch: Partial<NodeModelStatus> = {}): NodeModelStatus => status(verdict, {
    dbnum: 7998, modelSesno: 677, fileLatestSesno: 679, loadedModelSesno: 677, inWatchScope: false,
    generated: { sesnoMin: 677, sesnoMax: 677, timeMin: null, basis: 'library_watermark' },
    ...patch,
  });
  /** 库一级的模型（677）生成之后有会话改到了它 */
  const LAGGING_7998 = status7998('lagging', { units: { total: 1, generated: 1, missing: 0, failed: 0, lagging: 1, exact: true } });
  /** 做过节点一级的更新：后端按库文件最新会话（679）重新生成了它 */
  const UPDATED_7998 = status7998('latest', { generated: { sesnoMin: 679, sesnoMax: 679, timeMin: null, basis: 'own_generation' } });
  const KEPT_LAGGING = '这个节点落后（模型生成之后又有会话改到了它），屏幕上的没有可换的新版；行上的「更新」可让后端追上';
  const POINT_TO_UPDATE = '点行上的「更新」可让后端追上';
  /** 装上之后头一次问到的后端那一版：装上时就落后（库一级那一版）/ 做过节点一级的更新之后重新登记的 */
  const LOADED_WHILE_LAGGING = { sesnoMin: 677, sesnoMax: 677, laggingUnits: 1 };
  const LOADED_AFTER_UPDATE = { sesnoMin: 679, sesnoMax: 679, laggingUnits: 0 };
  const askedOf = (log: string[], refno: string): number => log.filter((line) => line === `status ${refno}`).length;

  it('不在后端更新范围的库、节点装上的时候就已经落后（库的水位和装的时候一样）：照样问它，点明有节点落后、去点行上的「更新」', async () => {
    const world = makeWorld({
      rows: [ROW_7998, ROW_8000_AT_1146],
      roots: [in7998(EQUI_A), root(SITE, { loadedModelSesno: 1146, loadedFileLatestSesno: 1146 })],
      statuses: { [EQUI_A]: { status: LAGGING_7998, gone: false } },
      loaded: { [EQUI_A]: ['24382_1912'] },
    });
    const { engine, log } = harness(world);
    const report = await engine.getLatest();

    // 8000 在后端更新范围里、水位没变：它的节点照旧不问；7998 的要问
    expect(log.filter((line) => line.startsWith('status'))).toEqual([`status ${EQUI_A}`]);
    expect(log.some((line) => line.startsWith('reload') || line.startsWith('withdraw'))).toBe(false);
    expect(report.models).toMatchObject({ rootsTotal: 2, checked: 1, kept: [{ refno: EQUI_A, reason: KEPT_LAGGING }] });
    expect(report.libraries).toEqual([{
      dbnum: 7998,
      kind: 'out_of_scope',
      text: `${NOTE_7998}；页面上装着的 1 个节点落后，${POINT_TO_UPDATE}`,
    }]);
    expect(report.libraryFacts).toEqual([]);
    expect(report.summary).toBe(`已取最新：1 个节点的模型没有动。没跟到最新：${NOTE_7998}；页面上装着的 1 个节点落后，${POINT_TO_UPDATE}。`);
    expect(report.detail).toContain(`${EQUI_A}：${KEPT_LAGGING}`);
    expect(report.level).toBe('warning');

    // 没人去点「更新」：下一轮照问、照说
    const again = await engine.getLatest();
    expect(askedOf(log, EQUI_A)).toBe(2);
    expect(again.summary).toBe(report.summary);
  });

  it('节点一级的更新做完之后（后端说它是最新）：不再说这个库没跟到最新，只在细节里留一句；库没再变就不再问', async () => {
    const world = makeWorld({
      rows: [ROW_7998],
      // 本页自己做的更新：做完重新登记过，装上之后头一次问到的就是更新之后那一版
      roots: [in7998(EQUI_A, { loadedGenerated: LOADED_AFTER_UPDATE })],
      statuses: { [EQUI_A]: { status: UPDATED_7998, gone: false } },
      loaded: { [EQUI_A]: ['24382_1912'] },
      tree: { touched: [7998], report: () => treeReport() },
    });
    const { engine, log } = harness(world);
    const report = await engine.getLatest();

    expect(askedOf(log, EQUI_A)).toBe(1);
    expect(log.some((line) => line.startsWith('reload'))).toBe(false);
    expect(report.libraries).toEqual([]);
    expect(report.libraryFacts).toEqual([FACT_7998]);
    expect(report.summary).toBe('已是最新：模型树和已装的模型都没有变化（核对了 3 层树、1 个已装的节点）。');
    expect(report.detail).toEqual([FACT_7998]);
    expect(report.level).toBe('info');

    // 库没再变：不再为它发请求，说法不变
    const again = await engine.getLatest();
    expect(askedOf(log, EQUI_A)).toBe(1);
    expect(again.models.checked).toBe(0);
    expect(again.libraries).toEqual([]);
    expect(again.summary).toBe(report.summary);
    expect(again.detail).toEqual([FACT_7998]);

    // 库文件又往前走了、又改到了它：再问，重新点名
    world.rows = [row(ROW_7998, { file_latest_sesno: 681 })];
    world.statuses[EQUI_A] = {
      status: status7998('lagging', { fileLatestSesno: 681, generated: { sesnoMin: 679, sesnoMax: 679, timeMin: null, basis: 'own_generation' } }),
      gone: false,
    };
    const third = await engine.getLatest();
    expect(askedOf(log, EQUI_A)).toBe(2);
    expect(third.libraries.map((item) => item.text)).toEqual([
      `库 7998 不在后端更新范围里：模型停在会话 677，库文件已到 681（树已是最新，模型不会自动跟上）；页面上装着的 1 个节点落后，${POINT_TO_UPDATE}`,
    ]);
    expect(third.libraryFacts).toEqual([]);
  });

  it('装着的几个节点只有一部分落后：说清几个里有几个；都落后就说都落后', async () => {
    const world = makeWorld({
      rows: [ROW_7998],
      roots: [in7998(EQUI_A), in7998(EQUI_B), in7998(EQUI_C)],
      statuses: {
        [EQUI_A]: { status: LAGGING_7998, gone: false },
        // 677 之后的会话没改到它：库一级的模型对它来说就是最新的
        [EQUI_B]: { status: status7998('latest'), gone: false },
        [EQUI_C]: { status: LAGGING_7998, gone: false },
      },
    });
    const report = await harness(world).engine.getLatest();
    expect(report.libraries.map((item) => item.text)).toEqual([`${NOTE_7998}；页面上装着的 3 个节点里有 2 个落后，${POINT_TO_UPDATE}`]);
    expect(report.models.kept.map((item) => item.refno)).toEqual([EQUI_A, EQUI_C]);

    const allBehind = makeWorld({
      rows: [ROW_7998],
      roots: [in7998(EQUI_A), in7998(EQUI_C)],
      statuses: { [EQUI_A]: { status: LAGGING_7998, gone: false }, [EQUI_C]: { status: LAGGING_7998, gone: false } },
    });
    const second = await harness(allBehind).engine.getLatest();
    expect(second.libraries.map((item) => item.text)).toEqual([`${NOTE_7998}；页面上装着的 2 个节点都落后，${POINT_TO_UPDATE}`]);
  });

  it('有节点说不出新旧（旧后端的过渡办法、后端判不了）：不敢说「都已是最新」，照库一级的原话', async () => {
    // 旧后端没有节点模型状态接口：过渡办法不问节点版本表，它说的「最新」不作数
    const fallback = makeWorld({
      rows: [ROW_7998],
      roots: [in7998(EQUI_A)],
      statuses: { [EQUI_A]: { status: status7998('latest', { source: 'versions' }), gone: false } },
    });
    const old = harness(fallback);
    const first = await old.engine.getLatest();
    expect(first.libraries).toEqual([{ dbnum: 7998, kind: 'out_of_scope', text: NOTE_7998 }]);
    expect(first.libraryFacts).toEqual([]);
    // 下一轮库没再变：没敢说它最新的照问，话不变（不会因为「上一轮核对过」就改口说最新）
    const firstAgain = await old.engine.getLatest();
    expect(askedOf(old.log, EQUI_A)).toBe(2);
    expect(firstAgain.libraries).toEqual(first.libraries);
    expect(firstAgain.libraryFacts).toEqual([]);

    const unsure = makeWorld({
      rows: [ROW_7998],
      roots: [in7998(EQUI_A, { loadedGenerated: LOADED_AFTER_UPDATE }), in7998(EQUI_B)],
      statuses: {
        [EQUI_A]: { status: UPDATED_7998, gone: false },
        [EQUI_B]: { status: status7998('unknown', { reason: '后端判不了' }), gone: false },
      },
    });
    const second = await harness(unsure).engine.getLatest();
    expect(second.libraries).toEqual([{ dbnum: 7998, kind: 'out_of_scope', text: NOTE_7998 }]);
    expect(second.libraryFacts).toEqual([]);
    expect(second.models.kept.map((item) => item.refno)).toEqual([EQUI_B]);
  });

  it('查看器没挂、或这个库在页面上的节点这一轮都撤下了：没有节点可说，照库一级的原话', async () => {
    const noScene = makeWorld({ rows: [ROW_7998], roots: [in7998(EQUI_A)], hasScene: false, statuses: { [EQUI_A]: { status: UPDATED_7998, gone: false } } });
    const first = await harness(noScene).engine.getLatest();
    expect(first.libraries).toEqual([{ dbnum: 7998, kind: 'out_of_scope', text: NOTE_7998 }]);
    expect(first.libraryFacts).toEqual([]);

    // 库里已经没有这个节点：撤下之后这个库在页面上没有节点了
    const gone = makeWorld({
      rows: [ROW_7998],
      roots: [in7998(EQUI_A)],
      statuses: { [EQUI_A]: { status: status7998('unknown'), gone: true } },
      loaded: { [EQUI_A]: ['24382_1912'] },
      tree: { touched: [7998], report: () => treeReport() },
    });
    const second = await harness(gone).engine.getLatest();
    expect(second.models.withdrawn.map((item) => item.refno)).toEqual([EQUI_A]);
    expect(second.libraries).toEqual([{ dbnum: 7998, kind: 'out_of_scope', text: NOTE_7998 }]);
    expect(second.libraryFacts).toEqual([]);
  });

  it('整库显示 / 地址栏直装登记的节点也一样：核对到最新之后把水位推进，下一轮不再问', async () => {
    const world = makeWorld({
      rows: [ROW_7998],
      roots: [in7998(EQUI_A, { source: 'registry' })],
      statuses: { [EQUI_A]: { status: status7998('latest'), gone: false } },
      loaded: { [EQUI_A]: ['24382_1912'] },
    });
    const { engine, log } = harness(world);
    const first = await engine.getLatest();
    expect(askedOf(log, EQUI_A)).toBe(1);
    expect(log).toContain(`advance ${EQUI_A} 677/679`);
    expect(first.libraries).toEqual([]);
    expect(first.libraryFacts).toEqual([FACT_7998]);

    const second = await engine.getLatest();
    expect(askedOf(log, EQUI_A)).toBe(1);
    expect(second.libraries).toEqual([]);
    expect(second.libraryFacts).toEqual([FACT_7998]);
  });

  it('别人对它做过节点一级的更新（后端按需生成的比本页装的新）：重载换上，换上之后算最新；重载没做成就不算', async () => {
    // 本页装的时候库文件在 678，后端后来在 679 上重新生成过
    const make = (reloadFails: boolean) => makeWorld({
      rows: [ROW_7998],
      roots: [in7998(EQUI_A, { loadedFileLatestSesno: 678 })],
      statuses: { [EQUI_A]: { status: UPDATED_7998, gone: false } },
      loaded: { [EQUI_A]: ['24382_1912'] },
      reloadFails: new Set(reloadFails ? [EQUI_A] : []),
    });
    const done = harness(make(false));
    const report = await done.engine.getLatest();
    expect(done.log).toContain(`reload ${EQUI_A}`);
    expect(report.libraries).toEqual([]);
    expect(report.libraryFacts).toEqual([FACT_7998]);

    const failed = await harness(make(true)).engine.getLatest();
    expect(failed.models.failed.map((item) => item.refno)).toEqual([EQUI_A]);
    expect(failed.libraries).toEqual([{ dbnum: 7998, kind: 'out_of_scope', text: NOTE_7998 }]);
    expect(failed.libraryFacts).toEqual([]);
  });

  it('整库显示的库这一轮新装入的 SITE 也算页面上装着的节点：它是最新就一起算最新，它落后就点名', async () => {
    const NEW_7998 = { refno: '24382_3000', name: '/NEW-7998' };
    const make = (siteStatus: NodeModelStatus) => makeWorld({
      rows: [ROW_7998],
      roots: [in7998(EQUI_A, { source: 'registry' })],
      scopes: [{ dbnum: 7998, knownSites: new Set([EQUI_A]), discover: true, checkedFileLatestSesno: 677 }],
      sites: { 7998: [{ refno: EQUI_A, name: '/OLD-7998' }, NEW_7998] },
      // 原有的那个：677 之后的会话没改到它，库一级的模型对它来说就是最新的
      statuses: { [EQUI_A]: { status: status7998('latest'), gone: false }, [NEW_7998.refno]: { status: siteStatus, gone: false } },
      loaded: { [EQUI_A]: ['24382_1912'] },
    });
    const fresh = await harness(make(UPDATED_7998)).engine.getLatest();
    expect(fresh.models.loadedNew.map((item) => item.refno)).toEqual([NEW_7998.refno]);
    expect(fresh.libraries).toEqual([]);
    expect(fresh.libraryFacts).toEqual(['库 7998 不在后端更新范围里（库一级的模型停在会话 677，库文件已到 679）；页面上装着的 2 个节点都已是最新']);

    const behind = await harness(make(LAGGING_7998)).engine.getLatest();
    expect(behind.models.loadedNew.map((item) => item.refno)).toEqual([NEW_7998.refno]);
    expect(behind.libraries.map((item) => item.text)).toEqual([`${NOTE_7998}；页面上装着的 2 个节点里有 1 个落后，${POINT_TO_UPDATE}`]);
    expect(behind.libraryFacts).toEqual([]);
  });

  it('换上之后名下的构件又被别的节点的重载撤掉、补装没成：这个节点不算最新', async () => {
    // 装的时候库一级的模型在 675，到 677 之间改到了它（可重载），678、679 没改到它（后端说最新）
    const older = { loadedModelSesno: 675, loadedFileLatestSesno: 675 };
    const reloadable = status7998('reloadable', { loadedModelSesno: 675, reloadableSessions: [{ sesno: 677, time: null, unitsChanged: 1 }] });
    // 构件 m1 从 EQUI_B 挪到了 EQUI_A 名下：EQUI_A 先重载装上了它，EQUI_B 重载时又把它从场景拿掉，要给 EQUI_A 补重载一次
    const moved = () => makeWorld({
      rows: [ROW_7998],
      roots: [in7998(EQUI_A, older), in7998(EQUI_B, older)],
      statuses: { [EQUI_A]: { status: reloadable, gone: false }, [EQUI_B]: { status: reloadable, gone: false } },
      loaded: { [EQUI_A]: ['a1'], [EQUI_B]: ['b1', 'm1'] },
      afterReload: { [EQUI_A]: ['a1', 'm1'] },
    });

    const fine = moved();
    fine.afterReload[EQUI_B] = ['b1'];
    const done = await harness(fine).engine.getLatest();
    expect(done.models.failed).toEqual([]);
    expect(done.libraries).toEqual([]);
    expect(done.libraryFacts).toEqual(['库 7998 不在后端更新范围里（库一级的模型停在会话 677，库文件已到 679）；页面上装着的 2 个节点都已是最新']);

    // EQUI_B 重载的时候顺手把 EQUI_A 标成「重载不成」，于是只有补的那一次不成
    const refused = moved();
    Object.defineProperty(refused.afterReload, EQUI_B, { get: () => { refused.reloadFails.add(EQUI_A); return ['b1']; }, enumerable: true });
    const report = await harness(refused).engine.getLatest();
    expect(report.models.failed).toEqual([{ refno: EQUI_A, reason: '它名下有构件被别的节点的重载撤掉了，补装没有完成' }]);
    expect(report.libraries).toEqual([{ dbnum: 7998, kind: 'out_of_scope', text: NOTE_7998 }]);
    expect(report.libraryFacts).toEqual([]);
  });

  it('装上之后别的页面让后端重新生成过它（和本页装上时记下的那一版不一样）：后端说最新也不算，照库一级的原话，每轮照问', async () => {
    const world = makeWorld({
      rows: [ROW_7998],
      // 装上的时候它落后（库一级那一版）；之后别的页面对它做了节点一级的更新，本页屏幕上还是原来那一版
      roots: [in7998(EQUI_A, { loadedGenerated: LOADED_WHILE_LAGGING })],
      statuses: { [EQUI_A]: { status: UPDATED_7998, gone: false } },
      loaded: { [EQUI_A]: ['24382_1912'] },
    });
    const { engine, log } = harness(world);
    const first = await engine.getLatest();
    // 换不换不归这条规则管：不重载，只是不改口
    expect(log.some((line) => line.startsWith('reload'))).toBe(false);
    expect(first.libraries).toEqual([{ dbnum: 7998, kind: 'out_of_scope', text: NOTE_7998 }]);
    expect(first.libraryFacts).toEqual([]);

    const again = await engine.getLatest();
    expect(askedOf(log, EQUI_A)).toBe(2);
    expect(again.libraries).toEqual(first.libraries);

    // 本页把它重新登记了（重载过 / 自己点了「更新」）：记下的就是现在这一版，这才改口；之后库没再变就不再问
    world.roots = [in7998(EQUI_A, { loadedGenerated: LOADED_AFTER_UPDATE })];
    const third = await engine.getLatest();
    expect(askedOf(log, EQUI_A)).toBe(3);
    expect(third.libraries).toEqual([]);
    expect(third.libraryFacts).toEqual([FACT_7998]);
    const fourth = await engine.getLatest();
    expect(askedOf(log, EQUI_A)).toBe(3);
    expect(fourth.libraryFacts).toEqual([FACT_7998]);
  });

  it('装上时那一版没记下（状态还没问回来；整库显示 / 地址栏直装登记的不记）：后端按需生成的那一版不敢算，记下之后才算', async () => {
    const world = makeWorld({
      rows: [ROW_7998],
      roots: [in7998(EQUI_A)],
      statuses: { [EQUI_A]: { status: UPDATED_7998, gone: false } },
    });
    const { engine, log } = harness(world);
    const first = await engine.getLatest();
    expect(first.libraries).toEqual([{ dbnum: 7998, kind: 'out_of_scope', text: NOTE_7998 }]);
    expect(first.libraryFacts).toEqual([]);

    // 已加载节点表问回来了：记下的和现在的一样
    world.roots = [in7998(EQUI_A, { loadedGenerated: LOADED_AFTER_UPDATE })];
    const second = await engine.getLatest();
    expect(askedOf(log, EQUI_A)).toBe(2);
    expect(second.libraries).toEqual([]);
    expect(second.libraryFacts).toEqual([FACT_7998]);

    // 登记表里的节点不记装上时那一版：后端按需生成的一直不敢算，每轮照问（水位照旧推进）
    const registry = makeWorld({
      rows: [ROW_7998],
      roots: [in7998(EQUI_A, { source: 'registry' })],
      statuses: { [EQUI_A]: { status: UPDATED_7998, gone: false } },
    });
    const viaRegistry = harness(registry);
    const third = await viaRegistry.engine.getLatest();
    expect(viaRegistry.log).toContain(`advance ${EQUI_A} 677/679`);
    expect(third.libraries).toEqual([{ dbnum: 7998, kind: 'out_of_scope', text: NOTE_7998 }]);
    expect(third.libraryFacts).toEqual([]);
    await viaRegistry.engine.getLatest();
    expect(askedOf(viaRegistry.log, EQUI_A)).toBe(2);
  });

  it('旧后端的过渡办法说可重载：照样换上，换上之后也不算核对过是最新（它不问节点版本表），照库一级的原话', async () => {
    const world = makeWorld({
      rows: [ROW_7998],
      // 装的时候库一级的模型在 675，后来到了 677
      roots: [in7998(EQUI_A, { loadedModelSesno: 675, loadedFileLatestSesno: 675 })],
      statuses: {
        [EQUI_A]: {
          status: status7998('reloadable', { source: 'versions', loadedModelSesno: 675, reloadableSessions: [{ sesno: 677, time: null, unitsChanged: 1 }] }),
          gone: false,
        },
      },
      loaded: { [EQUI_A]: ['24382_1912'] },
    });
    const { engine, log } = harness(world);
    const report = await engine.getLatest();
    expect(log).toContain(`reload ${EQUI_A}`);
    expect(report.models.reloaded.map((item) => item.refno)).toEqual([EQUI_A]);
    expect(report.models.failed).toEqual([]);
    expect(report.libraries).toEqual([{ dbnum: 7998, kind: 'out_of_scope', text: NOTE_7998 }]);
    expect(report.libraryFacts).toEqual([]);
  });

  it('这一轮撤下的节点（库里已删 / 重载后查空）不算页面上装着的：按剩下的节点说', async () => {
    // 库里已删的撤下了，剩下的那个核对过是最新：说「1 个节点已是最新」
    const deleted = makeWorld({
      rows: [ROW_7998],
      roots: [in7998(EQUI_A, { loadedGenerated: LOADED_AFTER_UPDATE }), in7998(EQUI_B)],
      statuses: { [EQUI_A]: { status: UPDATED_7998, gone: false }, [EQUI_B]: { status: status7998('unknown'), gone: true } },
      loaded: { [EQUI_A]: ['24382_1912'], [EQUI_B]: ['24382_1921'] },
    });
    const first = await harness(deleted).engine.getLatest();
    expect(first.models.withdrawn).toEqual([{ refno: EQUI_B, refnos: 1, why: 'deleted' }]);
    expect(first.libraries).toEqual([]);
    expect(first.libraryFacts).toEqual([FACT_7998]);

    // 重载后查空（名下的成员删光了）撤下的也一样，剩下的那个落后：说「1 个节点落后」，不是「2 个里有 1 个」
    const emptied = makeWorld({
      rows: [ROW_7998],
      roots: [in7998(EQUI_A), in7998(EQUI_C, { loadedModelSesno: 675, loadedFileLatestSesno: 675 })],
      statuses: {
        [EQUI_A]: { status: LAGGING_7998, gone: false },
        [EQUI_C]: {
          status: status7998('reloadable', { loadedModelSesno: 675, reloadableSessions: [{ sesno: 677, time: null, unitsChanged: 1 }] }),
          gone: false,
        },
      },
      loaded: { [EQUI_A]: ['24382_1912'], [EQUI_C]: ['24382_1931'] },
      afterReload: { [EQUI_C]: null },
    });
    const second = await harness(emptied).engine.getLatest();
    expect(second.models.withdrawn).toEqual([{ refno: EQUI_C, refnos: 1, why: 'empty' }]);
    expect(second.libraries.map((item) => item.text)).toEqual([`${NOTE_7998}；页面上装着的 1 个节点落后，${POINT_TO_UPDATE}`]);
    expect(second.libraryFacts).toEqual([]);
  });

  it('重载没做成的节点仍算页面上装着的：另一个核对过是最新，也不说「都已是最新」', async () => {
    const world = makeWorld({
      rows: [ROW_7998],
      // EQUI_B 装的时候库文件在 678，后端后来在 679 上重新生成过：要换，这次没换成
      roots: [in7998(EQUI_A, { loadedGenerated: LOADED_AFTER_UPDATE }), in7998(EQUI_B, { loadedFileLatestSesno: 678 })],
      statuses: { [EQUI_A]: { status: UPDATED_7998, gone: false }, [EQUI_B]: { status: UPDATED_7998, gone: false } },
      loaded: { [EQUI_A]: ['24382_1912'], [EQUI_B]: ['24382_1921'] },
      reloadFails: new Set([EQUI_B]),
    });
    const report = await harness(world).engine.getLatest();
    expect(report.models.failed.map((item) => item.refno)).toEqual([EQUI_B]);
    expect(report.libraries).toEqual([{ dbnum: 7998, kind: 'out_of_scope', text: NOTE_7998 }]);
    expect(report.libraryFacts).toEqual([]);
  });

  it('在后端更新范围里、只是后台还没跟上的库不按这一套：水位和装的时候一样的节点照旧不问（后台追上来水位会变，那时再问）', async () => {
    const world = makeWorld({
      rows: [ROW_8000_FILE_1146],
      // 装上的时候库就是现在这个水位：数据入库到 1143、库文件已到 1146
      roots: [root(SITE, { loadedModelSesno: 1143, loadedFileLatestSesno: 1146 })],
    });
    const { engine, log } = harness(world);
    const report = await engine.getLatest();
    expect(report.waited?.timedOut).toEqual([8000]);
    expect(log.filter((line) => line.startsWith('status'))).toEqual([]);
    expect(report.models).toMatchObject({ rootsTotal: 1, checked: 0 });
    expect(report.libraries.map((item) => item.kind)).toEqual(['backend_behind']);
    expect(report.libraryFacts).toEqual([]);
  });

  it('screenHoldsBackendModel：屏幕上装的是不是后端现在的这一版', () => {
    const reRegistered = in7998(EQUI_A, { loadedGenerated: LOADED_AFTER_UPDATE });
    // 靠库的水位担保的那一版：变没变归水位那一路管，这里算
    expect(screenHoldsBackendModel(in7998(EQUI_A), status7998('latest'))).toBe(true);
    // 后端按需生成的：装上时记下的和现在的一样才算；没记下、当时后端说不出、记下的是另一版都不算
    expect(screenHoldsBackendModel(reRegistered, UPDATED_7998)).toBe(true);
    expect(screenHoldsBackendModel(in7998(EQUI_A), UPDATED_7998)).toBe(false);
    expect(screenHoldsBackendModel(in7998(EQUI_A, { loadedGenerated: null }), UPDATED_7998)).toBe(false);
    expect(screenHoldsBackendModel(in7998(EQUI_A, { loadedGenerated: LOADED_WHILE_LAGGING }), UPDATED_7998)).toBe(false);
    // 一部分单元是按需生成的（mixed）也按按需生成的算：最早、最晚的会话都要一样
    const mixed = status7998('latest', { generated: { sesnoMin: 677, sesnoMax: 679, timeMin: null, basis: 'mixed' } });
    const loadedAt = (sesnoMin: number, sesnoMax: number, laggingUnits: number | null) => in7998(EQUI_A, { loadedGenerated: { sesnoMin, sesnoMax, laggingUnits } });
    expect(screenHoldsBackendModel(loadedAt(677, 679, 0), mixed)).toBe(true);
    expect(screenHoldsBackendModel(loadedAt(677, 677, 0), mixed)).toBe(false);
    expect(screenHoldsBackendModel(loadedAt(675, 679, 0), mixed)).toBe(false);
    // 对应的会话没变、落后的单元比装上时少了：少掉的是装上之后重新生成的；现在有几个落后后端没说就比不出来，不算
    expect(screenHoldsBackendModel(loadedAt(677, 679, 2), mixed)).toBe(false);
    expect(screenHoldsBackendModel(loadedAt(677, 679, 2), { ...mixed, units: null })).toBe(false);
    expect(screenHoldsBackendModel(loadedAt(677, 679, 2), { ...mixed, units: { total: 3, generated: 3, missing: 0, failed: 0, lagging: 2, exact: true } })).toBe(true);
    // 装上时后端没说有几个落后：只比会话
    expect(screenHoldsBackendModel(loadedAt(677, 679, null), mixed)).toBe(true);
    // 过渡办法给的状态、后端没说模型对应到哪些会话：说不准，不算
    expect(screenHoldsBackendModel(reRegistered, status7998('latest', { source: 'versions' }))).toBe(false);
    expect(screenHoldsBackendModel(reRegistered, status7998('latest', { generated: null }))).toBe(false);
  });

  it('describeOutOfScopeLibrary：按页面上装着的节点说', () => {
    const note = describeLibraryGap(7998, ROW_7998)!;
    expect(note.text).toBe(NOTE_7998);
    // 这个库在页面上没装节点、或有节点说不出新旧：原话
    expect(describeOutOfScopeLibrary(note, ROW_7998, null)).toEqual({ note, fact: null });
    expect(describeOutOfScopeLibrary(note, ROW_7998, { total: 0, latest: 0, lagging: 0 })).toEqual({ note, fact: null });
    expect(describeOutOfScopeLibrary(note, ROW_7998, { total: 2, latest: 1, lagging: 0 })).toEqual({ note, fact: null });
    // 装着的都核对过是最新：不算没跟上，只留一句事实
    expect(describeOutOfScopeLibrary(note, ROW_7998, { total: 1, latest: 1, lagging: 0 })).toEqual({ note: null, fact: FACT_7998 });
    expect(describeOutOfScopeLibrary(note, ROW_7998, { total: 3, latest: 3, lagging: 0 })).toEqual({
      note: null,
      fact: '库 7998 不在后端更新范围里（库一级的模型停在会话 677，库文件已到 679）；页面上装着的 3 个节点都已是最新',
    });
    // 有落后的：仍算没跟到最新，点明几个
    expect(describeOutOfScopeLibrary(note, ROW_7998, { total: 3, latest: 1, lagging: 1 })).toEqual({
      note: { dbnum: 7998, kind: 'out_of_scope', text: `${NOTE_7998}；页面上装着的 3 个节点里有 1 个落后，${POINT_TO_UPDATE}` },
      fact: null,
    });
  });

  it('describeLibraryGap：各种库状态', () => {
    expect(describeLibraryGap(8000, ROW_8000)).toBeNull();
    expect(describeLibraryGap(7334, ROW_7334)).toBeNull();
    // 未初始化、按需生成：没有库一级的模型水位，落不落后在节点那里说
    expect(describeLibraryGap(7009, ROW_7009)).toBeNull();
    expect(describeLibraryGap(1112, ROW_1112)).toEqual({
      dbnum: 1112, kind: 'out_of_scope', text: '库 1112 不在后端更新范围里：模型停在会话 738，库文件已到 748（树已是最新，模型不会自动跟上）',
    });
    expect(describeLibraryGap(8000, ROW_8000_FILE_1146)).toEqual({
      dbnum: 8000, kind: 'backend_behind', text: '库 8000 后台还没跟上：数据入库到会话 1143，库文件已到 1146',
    });
    expect(describeLibraryGap(8000, row(ROW_8000, { model_verdict: 'lagging', model_sesno: 1150 }))).toEqual({
      dbnum: 8000, kind: 'backend_behind', text: '库 8000 后台的模型还没跟上：模型在会话 1150，数据已到 1155',
    });
    expect(describeLibraryGap(8000, row(ROW_8000, { model_source_reason: 'initialization_publishing' }))).toEqual({
      dbnum: 8000, kind: 'updating', text: '库 8000 后台还在更新（模型在会话 1155，库文件已到 1155）',
    });
    expect(describeLibraryGap(8000, row(ROW_8000, { blocked: true }))).toEqual({
      dbnum: 8000, kind: 'blocked', text: '库 8000 被后台阻断，不会更新（模型在会话 1155，库文件已到 1155）',
    });
    // 「水位」不单说：是哪三枚写出来
    expect(describeLibraryGap(8000, row(ROW_8000, { model_verdict: 'not_judged', model_sesno: 1160 }))).toEqual({
      dbnum: 8000, kind: 'unknown', text: '库 8000 的三枚水位（库文件最新会话、数据入库到的会话、模型生成所按的会话）对不上，新旧判不了',
    });
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
      models: { rootsTotal: 0, checked: 0, reloaded: [], loadedNew: [], withdrawn: [], kept: [], failed: [], componentsAdded: 0, componentsRemoved: 0 },
      libraries: [], libraryFacts: [], waited: null, selectionDeleted: null, derived: [], level: 'info', summary: '', detail: [],
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
        kept: [], failed: [], componentsAdded: 2, componentsRemoved: 5,
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
      models: { rootsTotal: 3, checked: 0, reloaded: [], loadedNew: [], withdrawn: [], kept: [], failed: [], componentsAdded: 0, componentsRemoved: 0 },
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

describe('取最新：补几处边角', () => {
  const NEW_SITE = { refno: '24384_30000', name: '/NEW-SITE' };
  const scopeOf = (patch: Partial<GetWorkDbnumScope> = {}): GetWorkDbnumScope => (
    { dbnum: 8000, knownSites: new Set([SITE]), discover: true, checkedFileLatestSesno: 1143, ...patch }
  );

  it('只有整库显示碰过的库也算碰过：后台没做完同样要等、要交代', async () => {
    const world = makeWorld({ rows: [ROW_8000_FILE_1146], scopes: [scopeOf({ discover: false })] });
    const report = await harness(world).engine.getLatest();
    expect(report.waited?.dbnums).toEqual([8000]);
    expect(report.libraries.map((item) => item.dbnum)).toEqual([8000]);
  });

  it('撤下已删除的节点之后，登记表里不再留它', async () => {
    const world = makeWorld({
      roots: [root('24384_26716', { source: 'registry' })],
      statuses: { '24384_26716': { status: status('unknown'), gone: true } },
      loaded: { '24384_26716': ['24384_26717'] },
    });
    const { engine, log } = harness(world);
    await engine.getLatest();
    expect(log.indexOf('forget 24384_26716')).toBeGreaterThan(log.indexOf('withdraw 24384_26716'));
  });

  it('重载抛错：记进失败（带原因），后面的节点照常做', async () => {
    // 让第一个节点的重载抛错
    const throwing = makeWorld({
      roots: [root(SITE), root(ZONE)],
      statuses: { [SITE]: { status: RELOADABLE, gone: false }, [ZONE]: { status: RELOADABLE, gone: false } },
    });
    Object.defineProperty(throwing.afterReload, SITE, { get: () => { throw new Error('DTX 图层没了'); }, enumerable: true });
    const report = await harness(throwing).engine.getLatest();
    expect(report.models.failed).toEqual([{ refno: SITE, reason: '重载出错：DTX 图层没了' }]);
    expect(report.models.reloaded.map((item) => item.refno)).toEqual([ZONE]);
  });

  it('落后但有可换的新版：重载，同时把「还落后」说出来', async () => {
    const lagging = status('lagging', { reloadableSessions: [{ sesno: 1146, time: null, unitsChanged: 1 }] });
    const world = makeWorld({ roots: [root(SITE)], statuses: { [SITE]: { status: lagging, gone: false } } });
    const report = await harness(world).engine.getLatest();
    expect(report.models.reloaded.map((item) => item.refno)).toEqual([SITE]);
    expect(report.models.kept).toEqual([{ refno: SITE, reason: '这个节点落后（模型生成之后又有会话改到了它）：这次换上的是后台现有的那一版；行上的「更新」可让后端追上' }]);
  });

  it('整库显示的库从没找过新 SITE（当时没读到库文件的会话）：库文件没变也要找一次', async () => {
    const world = makeWorld({ rows: [ROW_8000_AT_1143], scopes: [scopeOf({ checkedFileLatestSesno: null })], sites: { 8000: [] } });
    const { engine, log } = harness(world);
    await engine.getLatest();
    expect(log).toContain('sites 8000');
    expect(log).toContain('scope-checked 8000 1143');
  });

  it('新 SITE 查到名单之后库里又没有它了：不装、不说，照常记「找过了」', async () => {
    const world = makeWorld({
      scopes: [scopeOf()],
      sites: { 8000: [NEW_SITE] },
      statuses: { [NEW_SITE.refno]: { status: status('unknown'), gone: true } },
    });
    const { engine, log } = harness(world);
    const report = await engine.getLatest();
    expect(log).not.toContain(`reload ${NEW_SITE.refno}`);
    expect(report.models.kept).toEqual([]);
    expect(log).toContain('scope-checked 8000 1146');
  });

  it('新 SITE 没装成（重载回 false / 抛错）：记失败，不算已在管，也不记「找过了」', async () => {
    const failing = makeWorld({ scopes: [scopeOf()], sites: { 8000: [NEW_SITE] }, reloadFails: new Set([NEW_SITE.refno]) });
    const a = harness(failing);
    const first = await a.engine.getLatest();
    expect(first.models.failed).toEqual([{ refno: NEW_SITE.refno, reason: '新出现的 SITE /NEW-SITE 没装成' }]);
    expect(a.log.some((line) => line.startsWith('known') || line.startsWith('scope-checked'))).toBe(false);

    const throwing = makeWorld({ scopes: [scopeOf()], sites: { 8000: [NEW_SITE] } });
    Object.defineProperty(throwing.afterReload, NEW_SITE.refno, { get: () => { throw new Error('炸了'); }, enumerable: true });
    const b = harness(throwing);
    const second = await b.engine.getLatest();
    expect(second.models.failed).toEqual([{ refno: NEW_SITE.refno, reason: '装入出错：炸了' }]);
    expect(b.log.some((line) => line.startsWith('known') || line.startsWith('scope-checked'))).toBe(false);
  });

  it('新 SITE 装了但一个构件都没装上：算已在管，不计入「新装入」', async () => {
    const world = makeWorld({ scopes: [scopeOf()], sites: { 8000: [NEW_SITE] }, afterReload: { [NEW_SITE.refno]: null } });
    const { engine, log } = harness(world);
    const report = await engine.getLatest();
    expect(log).toContain(`known 8000 ${NEW_SITE.refno}`);
    expect(report.models.loadedNew).toEqual([]);
    expect(report.ok).toBe(true);
    expect(log).toContain('scope-checked 8000 1146');

    // 场景说它装着的是一张空表（不是「不知道」）：一样不计入
    const emptyList = makeWorld({ scopes: [scopeOf()], sites: { 8000: [NEW_SITE] }, afterReload: { [NEW_SITE.refno]: [] } });
    const second = await harness(emptyList).engine.getLatest();
    expect(second.models.loadedNew).toEqual([]);
    expect(second.summary).toContain('已是最新');
  });

  it('要装新 SITE 的时候有别的装载在跑：等它完了再装；一直不完就记失败', async () => {
    const world = makeWorld({ scopes: [scopeOf()], sites: { 8000: [NEW_SITE] } });
    let asked = 0;
    // 开头不忙；问完新 SITE 的状态之后忙两拍
    world.busy = () => {
      asked += 1;
      return asked === 2 || asked === 3;
    };
    const { engine, log } = harness(world);
    const report = await engine.getLatest();
    expect(world.now).toBeGreaterThan(0);
    expect(log).toContain(`reload ${NEW_SITE.refno}`);
    expect(report.models.loadedNew).toHaveLength(1);

    const stuck = makeWorld({ scopes: [scopeOf()], sites: { 8000: [NEW_SITE] } });
    let calls = 0;
    stuck.busy = () => ++calls > 1;
    const b = harness(stuck);
    const second = await b.engine.getLatest();
    expect(second.models.failed).toEqual([{ refno: NEW_SITE.refno, reason: '有别的装载一直没结束，新出现的 SITE 这次没装' }]);
    expect(b.log).not.toContain(`reload ${NEW_SITE.refno}`);
    expect(b.log.some((line) => line.startsWith('scope-checked'))).toBe(false);
  });

  it('要重载节点的时候别的装载一直不完：这个节点记失败、不动它', async () => {
    const world = makeWorld({ roots: [root(SITE)], statuses: { [SITE]: { status: RELOADABLE, gone: false } } });
    let calls = 0;
    world.busy = () => ++calls > 1;
    const { engine, log } = harness(world);
    const report = await engine.getLatest();
    expect(report.models.failed).toEqual([{ refno: SITE, reason: '有别的装载一直没结束，这个节点这次没换' }]);
    expect(log).not.toContain(`reload ${SITE}`);
  });

  it('选中的节点这一轮查空撤下了（它还在库里，只是名下没有几何了）：不算被删', async () => {
    const world = makeWorld({
      selected: ZONE,
      roots: [root(ZONE)],
      statuses: { [ZONE]: { status: status('empty'), gone: false } },
      loaded: { [ZONE]: ['a'] },
      afterReload: { [ZONE]: null },
      goneProbe: { [ZONE]: false },
    });
    const { engine, marked, log } = harness(world);
    const report = await engine.getLatest();
    expect(report.models.withdrawn).toEqual([{ refno: ZONE, refnos: 1, why: 'empty' }]);
    expect(log).toContain(`probe ${ZONE}`);
    expect(marked).toEqual([]);
    expect(report.selectionDeleted).toBeNull();
  });

  it('问选中的构件还在不在时出错：不动选中，这一轮照常做完', async () => {
    const world = makeWorld({ selected: '24384_26549' });
    Object.defineProperty(world.goneProbe, '24384_26549', { get: () => { throw new Error('断了'); }, enumerable: true });
    const { engine, marked } = harness(world);
    const report = await engine.getLatest();
    expect(report.ok).toBe(true);
    expect(marked).toEqual([]);
  });

  it('只有树变了：派生物拿到的也是「有变化」', async () => {
    const seen: GetWorkDerivedContext[] = [];
    const world = makeWorld({
      rows: [ROW_8000_AT_1143],
      tree: { touched: [8000], report: () => treeReport({ changed: true }) },
      derived: [{ name: '房间树', run: (context) => { seen.push(context); } }],
    });
    await harness(world).engine.getLatest();
    expect(seen).toEqual([{ changed: true, treeChanged: true, modelsChanged: false }]);
  });
});
describe('取最新：场景里一共多了 / 少了多少个构件，不重复计', () => {
  it('一个节点既单独装过、又在装过的 ZONE 名下：它的构件被撤只算一次', async () => {
    const equi = '24384_25587';
    const world = makeWorld({
      roots: [root(equi), root(ZONE)],
      statuses: { [equi]: { status: status('unknown'), gone: true }, [ZONE]: { status: RELOADABLE, gone: false } },
      loaded: { [equi]: ['a1', 'a2'], [ZONE]: ['a1', 'a2', 'b1'] },
      afterReload: { [ZONE]: ['b1', 'c1'] },
    });
    const report = await harness(world).engine.getLatest();
    // 逐个节点的回执各说各的
    expect(report.models.withdrawn).toEqual([{ refno: equi, refnos: 2, why: 'deleted' }]);
    expect(report.models.reloaded).toEqual([{ refno: ZONE, added: 1, removed: 2, total: 2 }]);
    // 合计只算一次：少了 a1、a2 两件，多了 c1 一件
    expect(report.models).toMatchObject({ componentsAdded: 1, componentsRemoved: 2 });
    expect(report.summary).toBe('已取最新：模型重载 1 个节点、撤下 1 个已不存在的节点（新增 1 个构件、撤下 2 个构件）。');
  });

  it('嵌套的两个节点都重载：同一批新构件只算一次', async () => {
    const world = makeWorld({
      roots: [root(SITE), root(ZONE)],
      statuses: { [SITE]: { status: RELOADABLE, gone: false }, [ZONE]: { status: RELOADABLE, gone: false } },
      loaded: { [SITE]: ['b1', 'x1'], [ZONE]: ['b1'] },
      afterReload: { [SITE]: ['b1', 'x1', 'c1', 'c2'], [ZONE]: ['b1', 'c1', 'c2'] },
    });
    const report = await harness(world).engine.getLatest();
    expect(report.models.reloaded.map((item) => item.added)).toEqual([2, 2]);
    expect(report.models.componentsAdded).toBe(2);
    expect(report.models.componentsRemoved).toBe(0);
  });

  it('撤下的节点说不出它装了哪些构件：按场景报的件数算；查空撤下的、新装入的 SITE 也都算进合计', async () => {
    const gone = '24384_26716';
    const world = makeWorld({
      roots: [root(gone), root(ZONE)],
      statuses: { [gone]: { status: status('unknown'), gone: true }, [ZONE]: { status: status('empty'), gone: false } },
      loaded: { [ZONE]: ['z1', 'z2', 'z3'] },
      withdrawCount: { [gone]: 5 },
      afterReload: { [ZONE]: null, '24384_30000': ['n1', 'n2'] },
      scopes: [{ dbnum: 8000, knownSites: new Set([SITE]), discover: true, checkedFileLatestSesno: 1143 }],
      sites: { 8000: [{ refno: '24384_30000', name: '/NEW-SITE' }] },
    });
    const report = await harness(world).engine.getLatest();
    expect(report.models.withdrawn).toEqual([{ refno: gone, refnos: 5, why: 'deleted' }, { refno: ZONE, refnos: 3, why: 'empty' }]);
    expect(report.models.loadedNew).toEqual([{ refno: '24384_30000', name: '/NEW-SITE', total: 2 }]);
    expect(report.models).toMatchObject({ componentsAdded: 2, componentsRemoved: 8 });
    // 撤下分两种说：库里已经没有的，和还在库里、名下没有几何了的（不能把后一种说成「已不存在」）
    expect(report.summary).toBe('已取最新：模型新装入 1 个 SITE、撤下 1 个已不存在的节点、撤下 1 个名下已没有几何的节点（新增 2 个构件、撤下 8 个构件）。');
  });

  it('只有查空撤下的：那一句不说「已不存在」', async () => {
    const world = makeWorld({
      roots: [root(ZONE)],
      statuses: { [ZONE]: { status: status('empty'), gone: false } },
      loaded: { [ZONE]: ['z1'] },
      afterReload: { [ZONE]: null },
    });
    const report = await harness(world).engine.getLatest();
    expect(report.summary).toBe('已取最新：模型撤下 1 个名下已没有几何的节点（撤下 1 个构件）。');
  });
});
describe('取最新：问场景时带着节点登记时的库号（不靠现查映射）', () => {
  it('登记表里的节点在别的库：在不在场景、装着什么、撤下，都按它自己的库号问', async () => {
    const onDemand = root('7009_100', { dbnum: 7009, loadedModelSesno: 0, loadedFileLatestSesno: 470, source: 'registry' });
    const gone = root('7009_200', { dbnum: 7009, loadedModelSesno: 0, loadedFileLatestSesno: 470, source: 'registry' });
    const world = makeWorld({
      rows: [ROW_7009],
      roots: [onDemand, gone],
      statuses: {
        '7009_100': { status: status('latest', { dbnum: 7009, generated: { sesnoMin: 479, sesnoMax: 479, timeMin: null, basis: 'own_generation' } }), gone: false },
        '7009_200': { status: status('unknown'), gone: true },
      },
      loaded: { '7009_100': ['7009_101'], '7009_200': ['7009_201'] },
      scopes: [{ dbnum: 7009, knownSites: new Set<string>(), discover: true, checkedFileLatestSesno: 470 }],
      sites: { 7009: [{ refno: '7009_300', name: '/NEW' }] },
    });
    const { engine, sceneCalls } = harness(world);
    const report = await engine.getLatest();
    expect(report.models.reloaded.map((item) => item.refno)).toEqual(['7009_100']);
    expect(report.models.withdrawn.map((item) => item.refno)).toEqual(['7009_200']);
    expect(report.models.loadedNew.map((item) => item.refno)).toEqual(['7009_300']);
    // 每一问都带着 7009
    expect(sceneCalls.length).toBeGreaterThan(6);
    expect(sceneCalls.every((call) => call.endsWith(' 7009'))).toBe(true);
    expect(sceneCalls).toContain('in-scene 7009_100 7009');
    expect(sceneCalls).toContain('withdraw 7009_200 7009');
    expect(sceneCalls).toContain('loaded 7009_300 7009');
  });
});
describe('取最新：已加载节点表里核对过、不用动的节点', () => {
  it('库没再变：下一轮不再为它发请求；库又变了才再问；它自己重新装过（装时的水位变了）也再问', async () => {
    const world = makeWorld({ rows: [ROW_8000_AT_1146], roots: [root(SITE)], statuses: { [SITE]: { status: status('latest'), gone: false } } });
    const { engine, log } = harness(world);
    const asked = () => log.filter((line) => line === `status ${SITE}`).length;

    const first = await engine.getLatest();
    expect(asked()).toBe(1);
    expect(first.models.checked).toBe(1);

    // 库没再变：不问
    const second = await engine.getLatest();
    expect(asked()).toBe(1);
    expect(second.models).toMatchObject({ rootsTotal: 1, checked: 0 });

    // 库又往前了：再问
    world.rows = [row(ROW_8000, { file_latest_sesno: 1149, applied_sesno: 1149, model_sesno: 1149 })];
    await engine.getLatest();
    expect(asked()).toBe(2);
    await engine.getLatest();
    expect(asked()).toBe(2);

    // 它自己被重新装过（行上的「重载」之类）：装时的水位变了，要再核对一次
    world.roots = [root(SITE, { loadedModelSesno: 1146, loadedFileLatestSesno: 1146 })];
    await engine.getLatest();
    expect(asked()).toBe(3);
  });

  it('后端重启过、或它带着「本页装的不是后端现在的那一版」的标记：照问', async () => {
    const onDemand = root('7009_100', { dbnum: 7009, loadedModelSesno: 0, loadedFileLatestSesno: 470 });
    const world = makeWorld({
      rows: [ROW_7009],
      roots: [onDemand],
      statuses: { '7009_100': { status: status('latest', { dbnum: 7009, generated: { sesnoMin: 470, sesnoMax: 470, timeMin: null, basis: 'own_generation' } }), gone: false } },
    });
    const { engine, log } = harness(world);
    const asked = () => log.filter((line) => line === 'status 7009_100').length;
    await engine.getLatest();
    await engine.getLatest();
    expect(asked()).toBe(1);

    world.generation = 2;
    await engine.getLatest();
    expect(asked()).toBe(2);

    // 之后没再重启、库没变：又不问了
    await engine.getLatest();
    expect(asked()).toBe(2);

    world.roots = [{ ...onDemand, staleReason: '更新到一半停了' }];
    await engine.getLatest();
    expect(asked()).toBe(3);
  });

  it('只有库的模型水位变了（库文件没动，后台追上来了）：也要再问', async () => {
    // 装的时候和上一轮：后台还没跟上库文件（模型 1143、库文件 1146）；等了 45 秒没等到，核对这个节点：不用动
    const world = makeWorld({ rows: [ROW_8000_FILE_1146], roots: [root(SITE)], statuses: { [SITE]: { status: status('latest'), gone: false } } });
    const { engine, log } = harness(world);
    const asked = () => log.filter((line) => line === `status ${SITE}`).length;
    await engine.getLatest();
    expect(asked()).toBe(1);
    await engine.getLatest();
    expect(asked()).toBe(1);
    // 后台追上来了：模型水位 1143 → 1146，库文件还是 1146
    world.rows = [ROW_8000_AT_1146];
    await engine.getLatest();
    expect(asked()).toBe(2);
  });

  it('只有库文件又前进了（模型水位没动）：也要再问', async () => {
    const world = makeWorld({ rows: [ROW_8000_FILE_1146], roots: [root(SITE)], statuses: { [SITE]: { status: status('latest'), gone: false } } });
    const { engine, log } = harness(world);
    const asked = () => log.filter((line) => line === `status ${SITE}`).length;
    await engine.getLatest();
    expect(asked()).toBe(1);
    // 又有人保存了：库文件 1146 → 1149，后台还停在 1143
    world.rows = [row(ROW_8000, { file_latest_sesno: 1149, applied_sesno: 1143, model_sesno: 1143 })];
    await engine.getLatest();
    expect(asked()).toBe(2);
  });

  it('核对过不用动之后，某一轮它又成了「没动、要说明」的（比如重启后后端没有它的模型了）：之后每轮都照问', async () => {
    const onDemand = root('7009_100', { dbnum: 7009, loadedModelSesno: 0, loadedFileLatestSesno: 470 });
    const generated = status('latest', { dbnum: 7009, generated: { sesnoMin: 470, sesnoMax: 470, timeMin: null, basis: 'own_generation' } });
    const world = makeWorld({ rows: [ROW_7009], roots: [onDemand], statuses: { '7009_100': { status: generated, gone: false } } });
    const { engine, log } = harness(world);
    const asked = () => log.filter((line) => line === 'status 7009_100').length;
    await engine.getLatest();
    expect(asked()).toBe(1);
    // 后端重启：它的模型没了
    world.generation = 2;
    world.statuses['7009_100'] = { status: status('not_generated', { dbnum: 7009, generated: null }), gone: false };
    const restarted = await engine.getLatest();
    expect(asked()).toBe(2);
    expect(restarted.models.kept).toHaveLength(1);
    // 没再重启、库没变：它上一轮不是「不用动」，这一轮还要问（不然那句说明就不见了）
    const next = await engine.getLatest();
    expect(asked()).toBe(3);
    expect(next.models.kept).toHaveLength(1);
  });

  it('上一轮没动成、或只是说明了一句的节点（落后 / 后端没有模型 / 判不了）：下一轮照问', async () => {
    const world = makeWorld({ rows: [ROW_8000_AT_1146], roots: [root(SITE)], statuses: { [SITE]: { status: status('lagging'), gone: false } } });
    const { engine, log } = harness(world);
    await engine.getLatest();
    await engine.getLatest();
    expect(log.filter((line) => line === `status ${SITE}`)).toHaveLength(2);
  });

  it('上一轮不用动、这一轮库变了它要重载：重载完再点（库没再变）仍然先问一次，问到不用动之后才不问', async () => {
    const world = makeWorld({ rows: [ROW_8000_AT_1146], roots: [root(SITE)], statuses: { [SITE]: { status: status('latest'), gone: false } } });
    const { engine, log } = harness(world);
    const asked = () => log.filter((line) => line === `status ${SITE}`).length;
    await engine.getLatest();
    world.rows = [row(ROW_8000, { file_latest_sesno: 1149, applied_sesno: 1149, model_sesno: 1149 })];
    world.statuses[SITE] = { status: RELOADABLE, gone: false };
    await engine.getLatest();
    expect(asked()).toBe(2);
    expect(log).toContain(`reload ${SITE}`);
    // 假场景里重载不改它记的水位（真的会重新登记）：库和它都没变，但上一轮动过它，不算「核对过不用动」
    world.statuses[SITE] = { status: status('latest'), gone: false };
    await engine.getLatest();
    expect(asked()).toBe(3);
    await engine.getLatest();
    expect(asked()).toBe(3);
  });
});

/**
 * 2026-11-12 真实回放撞到的：8000 库里 PIPE /AIOS-SUITE-T3-PIPE 从 ZONE …-Z2 挪回 ZONE …-Z（E3D 会话 1688–1689），
 * 两个 ZONE 都在页面上装着。先重载 Z（管道的 9 个构件装到它名下），再重载 Z2——Z2 按「我名下已经没有它们了」把这 9 个
 * 构件从场景拿掉。场景里的对象是按构件共用的，结果树上有、场景里没有。
 */
describe('取最新：构件在两个在册节点之间挪了位置', () => {
  const Z = '24384_47463';
  const Z2 = '24384_47500';
  const reloads = (log: string[]) => log.filter((line) => line.startsWith('reload'));

  it('先重载的节点装上了它们、后重载的节点又把它们从场景拿掉：给先重载的那个补重载一次；合计不算多也不算少', async () => {
    const world = makeWorld({
      roots: [root(Z), root(Z2)],
      statuses: { [Z]: { status: RELOADABLE, gone: false }, [Z2]: { status: RELOADABLE, gone: false } },
      loaded: { [Z]: ['24384_47465'], [Z2]: ['24384_47502', '24384_47595', '24384_47596'] },
      afterReload: { [Z]: ['24384_47465', '24384_47595', '24384_47596'], [Z2]: ['24384_47502'] },
    });
    const { engine, log, progress } = harness(world);
    const report = await engine.getLatest();
    expect(reloads(log)).toEqual([`reload ${Z}`, `reload ${Z2}`, `reload ${Z}`]);
    expect(progress).toContain('补装挪了位置的构件 1/1…');
    expect(report.models.reloaded).toEqual([
      { refno: Z, added: 2, removed: 0, total: 3 },
      { refno: Z2, added: 0, removed: 2, total: 1 },
    ]);
    expect(report.models).toMatchObject({ componentsAdded: 0, componentsRemoved: 0, failed: [] });
    expect(report.summary).toBe('已取最新：模型重载 2 个节点。');
  });

  it('次序反过来（先处理的是丢构件的那个）：后装的那个自己就装上了，不用补', async () => {
    const world = makeWorld({
      roots: [root(Z2), root(Z)],
      statuses: { [Z]: { status: RELOADABLE, gone: false }, [Z2]: { status: RELOADABLE, gone: false } },
      loaded: { [Z]: ['24384_47465'], [Z2]: ['24384_47502', '24384_47595'] },
      afterReload: { [Z]: ['24384_47465', '24384_47595'], [Z2]: ['24384_47502'] },
    });
    const { engine, log } = harness(world);
    await engine.getLatest();
    expect(reloads(log)).toEqual([`reload ${Z2}`, `reload ${Z}`]);
  });

  it('各换各的、谁也没拿掉谁名下的构件：不补', async () => {
    const world = makeWorld({
      roots: [root(Z), root(Z2)],
      statuses: { [Z]: { status: RELOADABLE, gone: false }, [Z2]: { status: RELOADABLE, gone: false } },
      loaded: { [Z]: ['a1', 'a2'], [Z2]: ['b1', 'b2'] },
      afterReload: { [Z]: ['a1', 'a3'], [Z2]: ['b1'] },
    });
    const { engine, log } = harness(world);
    const report = await engine.getLatest();
    expect(reloads(log)).toEqual([`reload ${Z}`, `reload ${Z2}`]);
    expect(report.models).toMatchObject({ componentsAdded: 1, componentsRemoved: 2 });
  });

  it('嵌套的两个节点：构件只是挪出了里面那个、还在外面那个名下——外面的先重载就补一次；它还在场景里，不算撤下', async () => {
    const equi = '24384_47470';
    const world = makeWorld({
      roots: [root(Z), root(equi)],
      statuses: { [Z]: { status: RELOADABLE, gone: false }, [equi]: { status: RELOADABLE, gone: false } },
      // BOX 24384_47471 从这台 EQUI 挪到了同一个 ZONE 下的另一台 EQUI：ZONE 名下的构件没变
      loaded: { [Z]: ['24384_47469', '24384_47471', '24384_47472'], [equi]: ['24384_47471', '24384_47472'] },
      afterReload: { [equi]: ['24384_47472'] },
    });
    const { engine, log } = harness(world);
    const report = await engine.getLatest();
    expect(reloads(log)).toEqual([`reload ${Z}`, `reload ${equi}`, `reload ${Z}`]);
    expect(report.models.reloaded).toEqual([
      { refno: Z, added: 0, removed: 0, total: 3 },
      { refno: equi, added: 0, removed: 1, total: 1 },
    ]);
    expect(report.models).toMatchObject({ componentsAdded: 0, componentsRemoved: 0 });
  });

  it('后面撤下的是个已删除的节点，它的一个构件早先挪到了先重载的节点名下：同样补一次；真删掉的才算少了', async () => {
    const gone = '24384_26716';
    const world = makeWorld({
      roots: [root(Z), root(gone)],
      statuses: { [Z]: { status: RELOADABLE, gone: false }, [gone]: { status: status('unknown'), gone: true } },
      loaded: { [Z]: ['a1'], [gone]: ['g1', 'm1'] },
      afterReload: { [Z]: ['a1', 'm1'] },
    });
    const { engine, log } = harness(world);
    const report = await engine.getLatest();
    expect(log.filter((line) => line.startsWith('reload') || line.startsWith('withdraw'))).toEqual([`reload ${Z}`, `withdraw ${gone}`, `reload ${Z}`]);
    expect(report.models).toMatchObject({ componentsAdded: 0, componentsRemoved: 1 });
  });

  it('后面那个是查空撤下的（名下的几何都没了），拿掉的构件里有先重载的节点名下的：也补', async () => {
    const world = makeWorld({
      roots: [root(Z), root(Z2)],
      statuses: { [Z]: { status: RELOADABLE, gone: false }, [Z2]: { status: status('empty'), gone: false } },
      loaded: { [Z]: ['a1'], [Z2]: ['m1'] },
      afterReload: { [Z]: ['a1', 'm1'], [Z2]: null },
    });
    const { engine, log } = harness(world);
    const report = await engine.getLatest();
    expect(reloads(log)).toEqual([`reload ${Z}`, `reload ${Z2}`, `reload ${Z}`]);
    expect(report.models.withdrawn).toEqual([{ refno: Z2, refnos: 1, why: 'empty' }]);
    expect(report.models).toMatchObject({ componentsAdded: 0, componentsRemoved: 0 });
  });

  it('补重载没做成、抛错、或别的装载一直不完：各记一笔失败，说清是补装没成', async () => {
    const moved = () => makeWorld({
      roots: [root(Z), root(Z2)],
      statuses: { [Z]: { status: RELOADABLE, gone: false }, [Z2]: { status: RELOADABLE, gone: false } },
      loaded: { [Z]: ['a1'], [Z2]: ['b1', 'm1'] },
      afterReload: { [Z]: ['a1', 'm1'] },
    });

    // 回 false：Z2 重载的时候顺手把 Z 标成「重载不成」，于是只有补的那一次不成
    const refused = moved();
    Object.defineProperty(refused.afterReload, Z2, { get: () => { refused.reloadFails.add(Z); return ['b1']; }, enumerable: true });
    const first = await harness(refused).engine.getLatest();
    expect(first.models.failed).toEqual([{ refno: Z, reason: '它名下有构件被别的节点的重载撤掉了，补装没有完成' }]);
    expect(first.models.reloaded.map((item) => item.refno)).toEqual([Z, Z2]);

    // 抛错：Z 第二次重载时抛
    const throwing = moved();
    let calls = 0;
    Object.defineProperty(throwing.afterReload, Z, {
      get: () => {
        calls += 1;
        if (calls > 1) throw new Error('DTX 图层没了');
        return ['a1', 'm1'];
      },
      enumerable: true,
    });
    throwing.afterReload[Z2] = ['b1'];
    const second = await harness(throwing).engine.getLatest();
    expect(second.models.failed).toEqual([{ refno: Z, reason: '补装出错：DTX 图层没了' }]);

    // 要补的时候别的装载一直不完
    const busy = moved();
    let blocked = false;
    busy.busy = () => blocked;
    Object.defineProperty(busy.afterReload, Z2, { get: () => { blocked = true; return ['b1']; }, enumerable: true });
    const third = await harness(busy).engine.getLatest();
    expect(third.models.failed).toEqual([{ refno: Z, reason: '有别的装载一直没结束，它名下被别的节点撤掉的构件这次没补装' }]);
  });

  it('补完之后那个节点的现有构件数按补完的算', async () => {
    const world = makeWorld({
      roots: [root(Z), root(Z2)],
      statuses: { [Z]: { status: RELOADABLE, gone: false }, [Z2]: { status: RELOADABLE, gone: false } },
      loaded: { [Z]: ['a1'], [Z2]: ['b1', 'm1'] },
    });
    // Z 第一次重载装成 [a1, m1]；补的那一次后端又多给了一件（期间又有一批落地）
    let calls = 0;
    Object.defineProperty(world.afterReload, Z, { get: () => { calls += 1; return calls > 1 ? ['a1', 'm1', 'n1'] : ['a1', 'm1']; }, enumerable: true });
    world.afterReload[Z2] = ['b1'];
    const report = await harness(world).engine.getLatest();
    expect(report.models.reloaded[0]).toEqual({ refno: Z, added: 1, removed: 0, total: 3 });
  });
});

describe('取最新：因查空暂时撤下的节点在几何恢复后能装回（#322，K20 / K21）', () => {
  const EQ_A = '24384_30010';
  const EQ_B = '24384_30020';
  const BOX_A1 = '24384_30011';
  const BOX_REBUILT = '24384_30099';

  it('K20 形态：节点因 empty 被撤下后保留追踪（withdrawnEmpty）；空着再点不重复撤；几何恢复后点取最新重新装回', async () => {
    const world = makeWorld({
      rows: [row(ROW_8000, { model_sesno: 1144, applied_sesno: 1144, file_latest_sesno: 1144 })],
      roots: [root(EQ_A, { loadedModelSesno: 1143, loadedFileLatestSesno: 1143 })],
      statuses: { [EQ_A]: { status: status('empty'), gone: false } },
      loaded: { [EQ_A]: [BOX_A1] },
      afterReload: { [EQ_A]: null },
    });
    const { engine } = harness(world);

    // 第一轮（apply）：EQ_A 查空被撤下，模拟显示流程把它记为 withdrawnEmpty（保留在追踪表里）
    const first = await engine.getLatest();
    expect(first.models.withdrawn).toEqual([{ refno: EQ_A, refnos: 1, why: 'empty' }]);
    expect(first.models.componentsRemoved).toBe(1);

    world.roots = [root(EQ_A, { loadedModelSesno: 1144, loadedFileLatestSesno: 1144, withdrawnEmpty: true })];
    // 仍然为空时再点一次「取最新」：不重复重载、不重复报撤下
    const idle = await engine.getLatest();
    expect(idle.models.reloaded).toEqual([]);
    expect(idle.models.withdrawn).toEqual([]);

    // 第二轮（restore）：后端重建了盒子，库水位推进到 1145，后端返回 latest
    world.rows = [row(ROW_8000, { model_sesno: 1145, applied_sesno: 1145, file_latest_sesno: 1145 })];
    world.statuses = { [EQ_A]: { status: status('latest'), gone: false } };
    world.afterReload = { [EQ_A]: [BOX_REBUILT] };

    const restored = await engine.getLatest();
    expect(restored.models.withdrawn).toEqual([]);
    expect(restored.models.reloaded).toEqual([{ refno: EQ_A, added: 1, removed: 0, total: 1 }]);
    expect(restored.models.componentsAdded).toBe(1);
    expect(restored.models.componentsRemoved).toBe(0);
    expect(world.loaded[EQ_A]).toEqual([BOX_REBUILT]);
  });

  it('K21 形态：BOX 从 A 移到 B（A 查空撤下、随后加装 B），再移回 A 并点取最新：A 装回、B 撤下，构件不丢失且净增减为 0', async () => {
    const world = makeWorld({
      rows: [row(ROW_8000, { model_sesno: 1144, applied_sesno: 1144, file_latest_sesno: 1144 })],
      roots: [root(EQ_A, { loadedModelSesno: 1143, loadedFileLatestSesno: 1143 })],
      statuses: { [EQ_A]: { status: status('empty'), gone: false } },
      loaded: { [EQ_A]: [BOX_A1] },
      afterReload: { [EQ_A]: null },
    });
    const { engine, log } = harness(world);

    // apply：BOX 从 A 移到 B，A 查空撤下
    const apply = await engine.getLatest();
    expect(apply.models.withdrawn).toEqual([{ refno: EQ_A, refnos: 1, why: 'empty' }]);
    expect(apply.models.componentsRemoved).toBe(1);

    // 加装 B（页面上现在同时追踪着 withdrawnEmpty 的 A 和已装的 B）
    world.loaded[EQ_B] = [BOX_A1];
    world.roots = [
      root(EQ_A, { loadedModelSesno: 1144, loadedFileLatestSesno: 1144, withdrawnEmpty: true }),
      root(EQ_B, { loadedModelSesno: 1144, loadedFileLatestSesno: 1144 }),
    ];

    // restore：BOX 移回 A，库水位推进到 1145；先重载 A（装回 BOX_A1）、后重载 B（查空撤下 BOX_A1），引擎自动补装 A
    world.rows = [row(ROW_8000, { model_sesno: 1145, applied_sesno: 1145, file_latest_sesno: 1145 })];
    world.statuses = {
      [EQ_A]: { status: status('latest'), gone: false },
      [EQ_B]: { status: status('empty'), gone: false },
    };
    world.afterReload = { [EQ_A]: [BOX_A1], [EQ_B]: null };
    log.length = 0;

    const restore = await engine.getLatest();
    expect(restore.models.reloaded).toEqual([{ refno: EQ_A, added: 1, removed: 0, total: 1 }]);
    expect(restore.models.withdrawn).toEqual([{ refno: EQ_B, refnos: 1, why: 'empty' }]);
    // BOX_A1 只是从 B 挪回 A：页面净增 0、净撤 0
    expect(restore.models.componentsAdded).toBe(0);
    expect(restore.models.componentsRemoved).toBe(0);
    expect(world.loaded[EQ_A]).toEqual([BOX_A1]);
    // 先装 A、后撤 B 时会补装一次 A，防止共用对象被 B 撤掉
    expect(log.filter((line) => line.startsWith('reload '))).toEqual([`reload ${EQ_A}`, `reload ${EQ_B}`, `reload ${EQ_A}`]);
  });
});