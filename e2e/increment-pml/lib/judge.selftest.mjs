/**
 * 判定函数的自测：每个看点至少一个正例、一个反例。反例是故意弄错的数据，必须判不过；已知缺口只在条件命中时记。
 * 跑法：`node --test e2e/increment-pml/lib/judge.selftest.mjs`（不开浏览器、不连后端）。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';

import { truthGroups } from './case-runner.mjs';
import {
  diffTree,
  gapApplies,
  judgeW1,
  judgeW2,
  judgeW3,
  judgeW4,
  judgeW5,
  judgeW6,
  judgeW7,
  loadKnownGaps,
  refnoKey,
  summarize,
} from './judge.mjs';
import { sceneByRoot } from './page.mjs';
import { loadRvmSnapshot, truthBoxes } from './rvm.mjs';

const ZONE = '24384_30000';
const EQ_A = '24384_30001';
const BOX_A1 = '24384_30002';
const BOX_A3 = '24384_30003';
const EQ_B = '24384_30010';
const BOX_B1 = '24384_30011';
const PIPE_P = '24384_30020';
const BRAN_S = '24384_30021';
const ELBO = '24384_30022';
const TUBI = '24384_30023';
/** 另一个库（7998）里的那台 */
const ZONE_C = '24382_1884';
const EQ_C = '24382_1885';
const BOX_C1 = '24382_1886';
const BOX_C2 = '24382_1890';

/** 列主序矩阵：尺寸在对角线上，平移在第 12–14 个分量 */
function at(x, y, z, sx = 1, sy = 1, sz = 1) {
  return [sx, 0, 0, 0, 0, sy, 0, 0, 0, 0, sz, 0, x, y, z, 1];
}

function shifted(matrix, dx, dy = 0, dz = 0) {
  const out = [...matrix];
  out[12] += dx;
  out[13] += dy;
  out[14] += dz;
  return out;
}

function sceneAtStart() {
  return {
    [EQ_A]: {
      [BOX_A1]: [at(10000, 5000, 0, 1000, 1000, 1000)],
      [BOX_A3]: [at(10000, 5000, 1200, 500, 500, 400)],
    },
    [EQ_B]: { [BOX_B1]: [at(14000, 5000, 0, 800, 800, 800)] },
    [PIPE_P]: {
      [ELBO]: [at(20000, 0, 0)],
      [TUBI]: [at(20500, 0, 0), at(21000, 0, 0)],
    },
    [EQ_C]: { [BOX_C1]: [at(40000, 5000, 0, 1000, 1000, 1000)] },
  };
}

function moveRoot(scene, root, dx) {
  const out = structuredClone(scene);
  for (const component of Object.keys(out[root])) {
    out[root][component] = out[root][component].map((matrix) => shifted(matrix, dx));
  }
  return out;
}

/** 后端记录：根用 `a/b` 的写法（后端接口就是这样），顺带测两种写法都收 */
function backendOf(scene, roots) {
  const out = {};
  for (const root of roots) {
    out[root.replace('_', '/')] = { complete: true, components: structuredClone(scene[root]) };
  }
  return out;
}

function treeAtStart() {
  return {
    [ZONE]: { name: '/AIOS-SUITE-ZONE', type: 'ZONE', parentId: null, childrenIds: [EQ_A, EQ_B, PIPE_P] },
    [EQ_A]: { name: '/AIOS-SUITE-EQ-A', type: 'EQUI', parentId: ZONE, childrenIds: [BOX_A1, BOX_A3] },
    [BOX_A1]: { name: '/AIOS-SUITE-BOX-A1', type: 'BOX', parentId: EQ_A, childrenIds: null },
    [BOX_A3]: { name: '=24384/30003', type: 'BOX', parentId: EQ_A, childrenIds: null },
    [EQ_B]: { name: '/AIOS-SUITE-EQ-B', type: 'EQUI', parentId: ZONE, childrenIds: [BOX_B1] },
    [BOX_B1]: { name: '/AIOS-SUITE-BOX-B1', type: 'BOX', parentId: EQ_B, childrenIds: null },
    [PIPE_P]: { name: '/AIOS-SUITE-PIPE-P', type: 'PIPE', parentId: ZONE, childrenIds: [BRAN_S] },
    [BRAN_S]: { name: '/AIOS-SUITE-BRAN-S', type: 'BRAN', parentId: PIPE_P, childrenIds: null },
    [ZONE_C]: { name: '/AIOS-SUITE-7998-Z', type: 'ZONE', parentId: null, childrenIds: [EQ_C] },
    [EQ_C]: { name: '/AIOS-SUITE-7998-EQ', type: 'EQUI', parentId: ZONE_C, childrenIds: [BOX_C1] },
    [BOX_C1]: { name: '/AIOS-SUITE-7998-BOX', type: 'BOX', parentId: EQ_C, childrenIds: null },
  };
}

function receiptOf({ reloaded = [], withdrawn = [], kept = [], failed = [], added = 0, removed = 0, tree = {}, ...rest } = {}) {
  return {
    ok: true,
    error: null,
    backendRestarted: false,
    tree: { layersRequested: 4, layersRefreshed: 4, layersFailed: [], added: [], removed: [], renamed: [], moved: [], changed: false, ...tree },
    treeError: null,
    models: { rootsTotal: 4, checked: 4, reloaded, loadedNew: [], withdrawn, kept, failed, componentsAdded: added, componentsRemoved: removed },
    libraries: [],
    ...rest,
  };
}

/** 四个根都是在模型树上点眼睛装的 */
function rootsByTree() {
  const loaded = (dbnum, alone) => ({ dbnum, loadedVia: 'tree', aloneInLibraryAtLoad: alone, reloadsBefore: 0, withdrawnVia: null });
  return { [EQ_A]: loaded(8000, false), [EQ_B]: loaded(8000, false), [PIPE_P]: loaded(8000, false), [EQ_C]: loaded(7998, true) };
}

/** 7998 的那台是地址栏直装的，那一轮 7998 只装了它一个 */
function rootsWithDirectLoad(overrides = {}) {
  return {
    ...rootsByTree(),
    [EQ_C]: { dbnum: 7998, loadedVia: 'address', aloneInLibraryAtLoad: true, reloadsBefore: 0, withdrawnVia: null, ...overrides },
  };
}

const codes = (result) => result.problems.map((item) => item.code);
const gapIds = (result) => result.gaps.map((item) => item.gap);
const problemOf = (result, code) => result.problems.find((item) => item.code === code);

function assertPass(result) {
  assert.equal(result.verdict, 'pass', JSON.stringify([...result.problems, ...result.gaps], null, 2));
  assert.equal(result.label, '过');
}

function assertFail(result, code) {
  assert.equal(result.verdict, 'fail', `该判不过，实际是 ${result.verdict}`);
  assert.equal(result.label, '不过');
  assert.ok(codes(result).includes(code), `问题里该有 ${code}，实际是 ${codes(result).join(', ')}`);
}

function assertGap(result, ids) {
  assert.equal(result.verdict, 'known-gap', JSON.stringify(result.problems, null, 2));
  assert.equal(result.label, '已知缺口');
  assert.deepEqual(gapIds(result).sort(), [...ids].sort());
}

describe('W1 不点任何东西，页面自己知道变了', () => {
  const T0 = 1_000_000;
  const latest = { present: true, action: null, nodeStatus: 'latest', pending: false };
  const reloadable = { present: true, action: 'reload', nodeStatus: 'reloadable', pending: false };
  const checking = { present: true, action: null, nodeStatus: 'checking', pending: true };
  const lagging = { present: true, action: 'update', nodeStatus: 'lagging', pending: false };
  const wantReload = { nodeStatus: ['reloadable'], action: ['reload'] };

  /** EQ-A 东移：它的行先核对、35 秒出「重载」；另外两行一直是最新 */
  const input = (overrides = {}) => ({
    startAt: T0,
    baseline: { [EQ_A]: latest, [EQ_B]: latest, [PIPE_P]: latest },
    samples: [
      { t: T0 + 5_000, rows: { [EQ_A]: latest, [EQ_B]: latest, [PIPE_P]: latest } },
      { t: T0 + 20_000, rows: { [EQ_A]: checking, [EQ_B]: latest, [PIPE_P]: latest } },
      { t: T0 + 35_000, rows: { [EQ_A]: reloadable, [EQ_B]: latest, [PIPE_P]: latest } },
    ],
    affected: { [EQ_A]: wantReload },
    unaffected: [EQ_B, PIPE_P],
    interactions: [],
    ...overrides,
  });
  const withRow = (root, rows) => input().samples.map((sample, index) => (
    rows[index] ? { t: sample.t, rows: { ...sample.rows, [root]: rows[index] } } : sample
  ));

  test('正例：受影响的行 35 秒出「重载」，别的行不变；用时只记录', () => {
    const result = judgeW1(input());
    assertPass(result);
    assert.equal(result.facts.latencyMs[EQ_A], 35_000);
  });

  test('反例：行没变', () => {
    const result = judgeW1(input({ samples: withRow(EQ_A, [latest, latest, latest]) }));
    assertFail(result, 'no-signal');
    const problem = problemOf(result, 'no-signal');
    assert.deepEqual(problem.actual, { present: true, action: null, nodeStatus: 'latest', pending: false });
    assert.deepEqual(problem.expected, wantReload);
    assert.equal(problem.waitedMs, 35_000);
  });

  test('反例：不该变的行变了', () => {
    const result = judgeW1(input({ samples: withRow(EQ_B, [null, null, reloadable]) }));
    assertFail(result, 'unaffected-row-changed');
    const problem = problemOf(result, 'unaffected-row-changed');
    assert.equal(problem.actual.action, 'reload');
    assert.equal(problem.expected.action, null);
    assert.equal(problem.atMs, 35_000);
  });

  test('反例：过了 180 秒才出信号', () => {
    const samples = [
      { t: T0 + 60_000, rows: { [EQ_A]: latest, [EQ_B]: latest, [PIPE_P]: latest } },
      { t: T0 + 181_000, rows: { [EQ_A]: reloadable, [EQ_B]: latest, [PIPE_P]: latest } },
    ];
    const result = judgeW1(input({ samples }));
    assertFail(result, 'signal-late');
    assert.equal(problemOf(result, 'signal-late').actual, 181_000);
    assert.equal(problemOf(result, 'signal-late').expected, 180_000);
  });

  test('正好 180 秒算在时限内', () => {
    const samples = [{ t: T0 + 180_000, rows: { [EQ_A]: reloadable, [EQ_B]: latest, [PIPE_P]: latest } }];
    assertPass(judgeW1(input({ samples })));
  });

  test('反例：存盘之前行上就是「重载」，看不出是不是页面自己发现的', () => {
    const result = judgeW1(input({ baseline: { [EQ_A]: reloadable, [EQ_B]: latest, [PIPE_P]: latest } }));
    assertFail(result, 'signal-before-change');
  });

  test('反例：信号出现之前在页面上点过东西', () => {
    const result = judgeW1(input({ interactions: [{ t: T0 + 10_000, what: '点了取最新' }] }));
    assertFail(result, 'touched-before-signal');
  });

  test('信号出现之后的操作不算', () => {
    assertPass(judgeW1(input({ interactions: [{ t: T0 + 40_000, what: '点了取最新' }] })));
  });

  test('不受影响的行中途核对了一下不算变', () => {
    const result = judgeW1(input({ samples: withRow(EQ_B, [null, checking, null]) }));
    assertPass(result);
    assert.equal(result.facts.transient[EQ_B], 1);
  });

  test('库正在被写的那几秒（标记是 updating、没有「核对中」）也不算变', () => {
    const updating = { present: true, action: null, nodeStatus: 'updating', pending: false };
    const result = judgeW1(input({ samples: withRow(EQ_B, [null, updating, null]) }));
    assertPass(result);
    assert.equal(result.facts.transient[EQ_B], 1);
  });

  test('反例：不受影响的行到最后还在核对，不能算没变', () => {
    assertFail(judgeW1(input({ samples: withRow(EQ_B, [null, null, checking]) })), 'row-not-settled');
  });

  test('反例：有一次没采到不受影响的行', () => {
    const samples = input().samples.map((sample, index) => (
      index === 1 ? { t: sample.t, rows: { [EQ_A]: checking, [PIPE_P]: latest } } : sample
    ));
    assertFail(judgeW1(input({ samples })), 'row-not-sampled');
  });

  test('没有受影响的行（改名、原值重写）：所有行都不变才过', () => {
    const quiet = { affected: {}, unaffected: [EQ_A, EQ_B, PIPE_P] };
    assertPass(judgeW1(input({ ...quiet, samples: withRow(EQ_A, [latest, latest, latest]) })));
    assertFail(judgeW1(input(quiet)), 'unaffected-row-changed');
  });

  test('手动路径：后端不自动跟时，行上先出「更新」', () => {
    const affected = { [EQ_A]: { nodeStatus: ['lagging'], action: ['update', 'update-node'] } };
    assertPass(judgeW1(input({ affected, samples: withRow(EQ_A, [latest, checking, lagging]) })));
    assertFail(judgeW1(input({ affected })), 'no-signal');
  });

  test('反例：没有给要看的行、存盘之前的行状态没采到', () => {
    assertFail(judgeW1(input({ affected: {}, unaffected: [] })), 'nothing-to-judge');
    assertFail(judgeW1(input({ baseline: { [EQ_B]: latest, [PIPE_P]: latest } })), 'no-baseline');
    assertFail(judgeW1(input({ baseline: { [EQ_A]: latest, [PIPE_P]: latest } })), 'no-baseline');
  });

  test('反例：存盘之后一次都没采', () => {
    assertFail(judgeW1(input({ samples: [] })), 'no-samples');
  });
});

describe('W2 点一次「取最新」就到位', () => {
  /** 7998 的那台东移：只有它重载，8000 的模型水位没动 */
  const moved7998 = (overrides = {}) => ({
    clicks: 1,
    receipt: receiptOf({ reloaded: [{ refno: EQ_C, added: 0, removed: 0, total: 1 }] }),
    roots: rootsByTree(),
    expected: {
      tree: {},
      reload: { [EQ_C]: { added: 0, removed: 0, total: 1 } },
      componentsAdded: 0,
      componentsRemoved: 0,
      movedLibraries: [7998],
    },
    ...overrides,
  });

  /** 7998 的那台下面新建一个 BOX：树多一行，构件多一个 */
  const boxAdded = (overrides = {}) => ({
    clicks: 1,
    receipt: receiptOf({
      reloaded: [{ refno: EQ_C, added: 1, removed: 0, total: 2 }],
      added: 1,
      tree: { added: [{ id: BOX_C2, name: '/AIOS-SUITE-7998-BOX2', type: 'BOX', dbnum: 7998 }], changed: true },
    }),
    roots: rootsByTree(),
    expected: {
      tree: { added: ['24382/1890'] },
      reload: { [EQ_C]: { added: 1, removed: 0, total: 2 } },
      componentsAdded: 1,
      componentsRemoved: 0,
      movedLibraries: [7998],
    },
    ...overrides,
  });

  /** EQ-A 东移，同库还装着 EQ-B 和 PIPE-P：页面把三个都重载了 */
  const movedWithNeighbours = (overrides = {}) => ({
    clicks: 1,
    receipt: receiptOf({
      reloaded: [
        { refno: EQ_A, added: 0, removed: 0, total: 2 },
        { refno: EQ_B, added: 0, removed: 0, total: 1 },
        { refno: PIPE_P, added: 0, removed: 0, total: 2 },
      ],
    }),
    roots: rootsByTree(),
    expected: {
      tree: {},
      reload: { [EQ_A]: { added: 0, removed: 0, total: 2 } },
      componentsAdded: 0,
      componentsRemoved: 0,
      movedLibraries: [8000],
    },
    ...overrides,
  });

  /** 直装的单个节点头一次被重载：回执的撤下比后端的差多 1 */
  const directLoadOvercount = (overrides = {}) => moved7998({
    receipt: receiptOf({ reloaded: [{ refno: EQ_C, added: 0, removed: 1, total: 1 }], removed: 1 }),
    roots: rootsWithDirectLoad(),
    ...overrides,
  });

  test('正例：只有改到的根重载，数都对', () => {
    const result = judgeW2(moved7998());
    assertPass(result);
    assert.deepEqual(result.facts.reloaded, { actual: 1, expected: 1, accompanying: 0 });
  });

  test('正例：树多一行、构件多一个', () => {
    assertPass(judgeW2(boxAdded()));
  });

  test('反例：回执里构件的新增比预期少 1', () => {
    const input = boxAdded();
    input.expected.reload[EQ_C] = { added: 2, removed: 0, total: 3 };
    input.expected.componentsAdded = 2;
    const result = judgeW2(input);
    assertFail(result, 'root-added');
    assert.equal(problemOf(result, 'root-added').actual, 1);
    assert.equal(problemOf(result, 'root-added').expected, 2);
    assert.equal(problemOf(result, 'components-added').actual, 1);
    assert.equal(problemOf(result, 'components-added').expected, 2);
  });

  test('反例：回执里树的新增比预期少 1', () => {
    const input = boxAdded();
    input.expected.tree.added = ['24382/1890', '24382/1891'];
    const result = judgeW2(input);
    assertFail(result, 'tree-added');
    const problem = problemOf(result, 'tree-added');
    assert.equal(problem.actual.count, 1);
    assert.equal(problem.expected.count, 2);
    assert.deepEqual(problem.missing, ['24382_1891']);
  });

  test('反例：回执里树多报了一行改名', () => {
    const input = moved7998({
      receipt: receiptOf({
        reloaded: [{ refno: EQ_C, added: 0, removed: 0, total: 1 }],
        tree: { renamed: [{ id: EQ_B, name: '/X', previousName: '/AIOS-SUITE-EQ-B' }], changed: true },
      }),
    });
    const result = judgeW2(input);
    assertFail(result, 'tree-renamed');
    assert.deepEqual(problemOf(result, 'tree-renamed').extra, [EQ_B]);
  });

  test('挪到还没展开的位置算挪位置；消失了又没问到去向的判不过', () => {
    const relocated = (fate) => moved7998({
      receipt: receiptOf({
        reloaded: [{ refno: EQ_C, added: 0, removed: 0, total: 1 }],
        tree: { removed: [{ id: BOX_B1, name: '/AIOS-SUITE-BOX-B1', type: 'BOX', dbnum: 8000, fate }], changed: true },
      }),
    });
    const input = relocated('relocated');
    input.expected.tree = { moved: [BOX_B1] };
    assertPass(judgeW2(input));
    const lost = relocated('unknown');
    lost.expected.tree = { moved: [BOX_B1] };
    assertFail(judgeW2(lost), 'tree-vanished');
  });

  test('反例：点了两次', () => {
    assertFail(judgeW2(moved7998({ clicks: 2 })), 'clicks');
  });

  test('反例：该重载的根没重载', () => {
    assertFail(judgeW2(moved7998({ receipt: receiptOf() })), 'not-reloaded');
  });

  test('反例：取最新没有完成、没有回执', () => {
    assertFail(judgeW2(moved7998({ receipt: receiptOf({ ok: false, error: '后端没有答复' }) })), 'receipt-failed');
    assertFail(judgeW2(moved7998({ receipt: null })), 'no-receipt');
  });

  test('反例：有节点重载没成、有节点被列成没有动', () => {
    const failed = receiptOf({ failed: [{ refno: EQ_C, reason: '重载没有完成' }] });
    assertFail(judgeW2(moved7998({ receipt: failed })), 'reload-failed');
    const kept = receiptOf({
      reloaded: [{ refno: EQ_C, added: 0, removed: 0, total: 1 }],
      kept: [{ refno: EQ_B, reason: '这个节点落后' }],
    });
    assertFail(judgeW2(moved7998({ receipt: kept })), 'kept');
  });

  test('名下没有几何了的根：预期撤下就该撤下，不该撤的撤了判不过', () => {
    const receipt = receiptOf({ withdrawn: [{ refno: EQ_C, refnos: 1, why: 'empty' }], removed: 1 });
    const expected = { withdrawn: { [EQ_C]: { why: 'empty', refnos: 1 } }, componentsRemoved: 1, movedLibraries: [7998] };
    assertPass(judgeW2(moved7998({ receipt, expected })));
    const result = judgeW2(moved7998({ receipt }));
    assertFail(result, 'unexpected-withdraw');
    assert.ok(codes(result).includes('not-reloaded'));
  });

  test('反例：回执说后端重启过、说有库没跟到最新', () => {
    const restarted = receiptOf({ reloaded: [{ refno: EQ_C, added: 0, removed: 0, total: 1 }], backendRestarted: true });
    assertFail(judgeW2(moved7998({ receipt: restarted })), 'backend-restarted');
    const behind = receiptOf({
      reloaded: [{ refno: EQ_C, added: 0, removed: 0, total: 1 }],
      libraries: [{ dbnum: 8000, kind: 'backend_behind', text: '库 8000 后台还没跟上' }],
    });
    assertFail(judgeW2(moved7998({ receipt: behind })), 'libraries');
  });

  test('反例：回执里现有的构件数不对、撤下的个数不对、该撤下的没撤下', () => {
    const input = moved7998();
    input.expected.reload[EQ_C] = { added: 0, removed: 0, total: 2 };
    const result = judgeW2(input);
    assertFail(result, 'root-total');
    assert.equal(problemOf(result, 'root-total').actual, 1);
    assert.equal(problemOf(result, 'root-total').expected, 2);

    const expected = { withdrawn: { [EQ_C]: { why: 'empty', refnos: 1 } }, componentsRemoved: 1, movedLibraries: [7998] };
    const two = receiptOf({ withdrawn: [{ refno: EQ_C, refnos: 2, why: 'empty' }], removed: 1 });
    const differs = judgeW2(moved7998({ receipt: two, expected }));
    assertFail(differs, 'withdrawn-differs');
    assert.deepEqual(problemOf(differs, 'withdrawn-differs').actual, { why: 'empty', refnos: 2 });
    assert.deepEqual(problemOf(differs, 'withdrawn-differs').expected, { why: 'empty', refnos: 1 });
    assertFail(judgeW2(moved7998({ receipt: receiptOf({ removed: 1 }), expected })), 'not-withdrawn');
  });

  test('反例：模型树没刷新成、有层没取到、多装进来一个 SITE', () => {
    const reloaded = [{ refno: EQ_C, added: 0, removed: 0, total: 1 }];
    const noTree = receiptOf({ reloaded, treeError: '请求超时' });
    noTree.tree = null;
    assertFail(judgeW2(moved7998({ receipt: noTree })), 'tree-not-refreshed');
    const layers = receiptOf({ reloaded, tree: { layersFailed: [{ id: ZONE, name: '/AIOS-SUITE-ZONE', error: '超时' }] } });
    assertFail(judgeW2(moved7998({ receipt: layers })), 'tree-layers-failed');
    const site = receiptOf({ reloaded });
    site.models.loadedNew = [{ refno: '24384_31000', name: '/NEW-SITE', total: 5 }];
    assertFail(judgeW2(moved7998({ receipt: site })), 'loaded-new');
  });

  test('已知缺口 KG1 命中：直装的单个节点头一次重载，撤下多算 1', () => {
    const result = judgeW2(directLoadOvercount());
    assertGap(result, ['KG1']);
    assert.equal(result.gaps[0].actual, 1);
    assert.equal(result.gaps[0].expected, 0);
    assert.ok(result.gaps[0].reason.length > 0);
  });

  test('KG1 条件不命中，同样多算 1 判不过：同库还装了别的 / 不是头一次 / 不是直装 / 事实没记下来', () => {
    const variants = [
      rootsWithDirectLoad({ aloneInLibraryAtLoad: false }),
      rootsWithDirectLoad({ reloadsBefore: 1 }),
      rootsWithDirectLoad({ loadedVia: 'tree' }),
      rootsWithDirectLoad({ reloadsBefore: undefined }),
      {},
    ];
    for (const roots of variants) {
      const result = judgeW2(directLoadOvercount({ roots }));
      assertFail(result, 'root-removed');
      assert.equal(problemOf(result, 'root-removed').actual, 1);
      assert.equal(problemOf(result, 'root-removed').expected, 0);
      assert.deepEqual(gapIds(result), []);
    }
  });

  test('KG1 条件命中但多算的不是 1 个、或合计没有跟着只多 1：判不过', () => {
    const byTwo = receiptOf({ reloaded: [{ refno: EQ_C, added: 0, removed: 2, total: 1 }], removed: 2 });
    assertFail(judgeW2(directLoadOvercount({ receipt: byTwo })), 'root-removed');
    const totalOff = receiptOf({ reloaded: [{ refno: EQ_C, added: 0, removed: 1, total: 1 }], removed: 3 });
    const result = judgeW2(directLoadOvercount({ receipt: totalOff }));
    assertFail(result, 'components-removed');
    assert.equal(problemOf(result, 'components-removed').actual, 3);
    assert.equal(problemOf(result, 'components-removed').overcount, 1);
  });

  test('已知缺口 KG3 命中：同库没被改到的两个根跟着重载，构件没有增减', () => {
    const result = judgeW2(movedWithNeighbours());
    assertGap(result, ['KG3', 'KG3']);
    assert.deepEqual(result.gaps.map((hit) => hit.root).sort(), [EQ_B, PIPE_P]);
    assert.deepEqual(result.facts.reloaded, { actual: 3, expected: 1, accompanying: 2 });
  });

  test('原值重写（预期一个都不重载）：页面重载了三个，记已知缺口，不记过', () => {
    const input = movedWithNeighbours();
    input.expected.reload = {};
    const result = judgeW2(input);
    assertGap(result, ['KG3', 'KG3', 'KG3']);
    assert.deepEqual(result.facts.reloaded, { actual: 3, expected: 0, accompanying: 3 });
  });

  test('KG3 条件不命中：所在的库模型水位没动却被重载，判不过', () => {
    const receipt = receiptOf({
      reloaded: [
        { refno: EQ_C, added: 0, removed: 0, total: 1 },
        { refno: EQ_B, added: 0, removed: 0, total: 1 },
      ],
    });
    const result = judgeW2(moved7998({ receipt }));
    assertFail(result, 'unexpected-reload');
    assert.deepEqual(problemOf(result, 'unexpected-reload').actual, { added: 0, removed: 0, total: 1 });
    assert.equal(problemOf(result, 'unexpected-reload').libraryModelMoved, false);
  });

  test('KG3 条件不命中：跟着重载的根构件有增减、或它在哪个库没记下来，判不过', () => {
    const grew = movedWithNeighbours();
    grew.receipt.models.reloaded[1] = { refno: EQ_B, added: 1, removed: 0, total: 2 };
    grew.receipt.models.componentsAdded = 1;
    const result = judgeW2(grew);
    assertFail(result, 'root-added');
    assert.deepEqual(gapIds(result), ['KG3']);
    const unknown = judgeW2(movedWithNeighbours({ roots: {} }));
    assertFail(unknown, 'unexpected-reload');
    assert.deepEqual(gapIds(unknown), []);
  });

  test('KG1 和 KG3 同时命中：直装的单个节点没被改到，跟着库重载，撤下多算 1', () => {
    const input = directLoadOvercount();
    input.expected.reload = {};
    assertGap(judgeW2(input), ['KG1', 'KG3']);
  });

  test('换一张空的已知缺口表：同样的偏差全部判不过', () => {
    assertFail(judgeW2(directLoadOvercount(), { knownGaps: [] }), 'root-removed');
    assertFail(judgeW2(movedWithNeighbours(), { knownGaps: [] }), 'unexpected-reload');
  });

  test('disallowGaps 拿掉 KG3：同库无关节点被误重载，直接判不过，不记已知缺口', () => {
    const result = judgeW2(movedWithNeighbours(), { disallowGaps: ['KG3'] });
    assertFail(result, 'unexpected-reload');
    assert.deepEqual(gapIds(result), []);
  });

  test('zero_signal.w5 = strict 同样不放行 KG3；不是 strict、或没写这项时仍记已知缺口', () => {
    const strict = judgeW2(movedWithNeighbours(), { zero_signal: { changed: '/AIOS-SUITE-EQ-A', control: '/AIOS-SUITE-EQ-NBX', w5: 'strict' } });
    assertFail(strict, 'unexpected-reload');
    assert.deepEqual(gapIds(strict), []);
    assertGap(judgeW2(movedWithNeighbours(), { zero_signal: { w5: 'kg3' } }), ['KG3', 'KG3']);
    assertGap(judgeW2(movedWithNeighbours(), { disallowGaps: [] }), ['KG3', 'KG3']);
  });

  test('只禁 KG3 时，预期内重载的 KG1 仍记；点名禁 KG1 才把那一格判不过', () => {
    assertGap(judgeW2(directLoadOvercount(), { disallowGaps: ['KG3'], zero_signal: { w5: 'strict' } }), ['KG1']);
    assertFail(judgeW2(directLoadOvercount(), { disallowGaps: ['KG1'] }), 'root-removed');
  });
});

describe('W3 场景 = 后端', () => {
  /** EQ-A 东移 500 之后：场景和后端记录一致 */
  const input = (mutate) => {
    const scene = moveRoot(sceneAtStart(), EQ_A, 500);
    const backend = backendOf(scene, [EQ_A]);
    if (mutate) mutate(scene, backend);
    return { roots: [EQ_A], scene, backend };
  };

  test('正例：构件集合相等，位置一致', () => {
    const result = judgeW3(input());
    assertPass(result);
    assert.equal(result.facts.components, 2);
    assert.equal(result.facts.objects, 2);
    assert.equal(result.facts.maxPositionMm, 0);
  });

  test('容差边界：差 0.5 mm、正好 1 mm 都算过', () => {
    assertPass(judgeW3(input((scene) => { scene[EQ_A][BOX_A1][0][12] += 0.5; })));
    const result = judgeW3(input((scene) => { scene[EQ_A][BOX_A1][0][12] += 1; }));
    assertPass(result);
    assert.equal(result.facts.maxPositionMm, 1);
  });

  test('反例：一个构件偏 2 mm', () => {
    const result = judgeW3(input((scene) => { scene[EQ_A][BOX_A1][0][12] += 2; }));
    assertFail(result, 'position');
    const problem = problemOf(result, 'position');
    assert.deepEqual(problem.actual, [10502, 5000, 0]);
    assert.deepEqual(problem.expected, [10500, 5000, 0]);
    assert.equal(problem.gapMm, 2);
  });

  test('反例：三个方向各偏 0.7 mm，合起来超过 1 mm', () => {
    const result = judgeW3(input((scene) => {
      scene[EQ_A][BOX_A1][0] = shifted(scene[EQ_A][BOX_A1][0], 0.7, 0.7, 0.7);
    }));
    assertFail(result, 'position');
  });

  test('反例：少一个构件', () => {
    const result = judgeW3(input((scene) => { delete scene[EQ_A][BOX_A3]; }));
    assertFail(result, 'component-missing');
    const problem = problemOf(result, 'component-missing');
    assert.deepEqual(problem.missing, [BOX_A3]);
    assert.deepEqual(problem.actual, [BOX_A1]);
    assert.deepEqual(problem.expected, [BOX_A1, BOX_A3]);
  });

  test('反例：多一个构件、多一个对象', () => {
    const extra = judgeW3(input((scene) => { scene[EQ_A]['24384_30009'] = [at(1, 2, 3)]; }));
    assertFail(extra, 'component-extra');
    assert.deepEqual(problemOf(extra, 'component-extra').extra, ['24384_30009']);
    const doubled = judgeW3(input((scene) => { scene[EQ_A][BOX_A1].push(at(10500, 5000, 0, 1000, 1000, 1000)); }));
    assertFail(doubled, 'object-count');
    assert.equal(problemOf(doubled, 'object-count').actual, 2);
    assert.equal(problemOf(doubled, 'object-count').expected, 1);
  });

  test('反例：位置对、转错了', () => {
    const result = judgeW3(input((scene) => {
      scene[EQ_A][BOX_A1][0] = [0, 1000, 0, 0, -1000, 0, 0, 0, 0, 0, 1000, 0, 10500, 5000, 0, 1];
    }));
    assertFail(result, 'orientation');
  });

  test('反例：后端记录没收齐、没取到', () => {
    assertFail(judgeW3(input((scene, backend) => { backend['24384/30001'].complete = false; })), 'backend-incomplete');
    assertFail(judgeW3(input((scene, backend) => { delete backend['24384/30001']; })), 'no-backend-records');
  });

  test('反例：对象在场景里但不可见', () => {
    const result = judgeW3(input((scene) => {
      scene[EQ_A][BOX_A1] = [{ m: scene[EQ_A][BOX_A1][0], visible: false }];
    }));
    assertFail(result, 'object-hidden');
  });

  test('反例：有对象读不出位置', () => {
    const result = judgeW3(input((scene) => { scene[EQ_A][BOX_A1] = [{ m: null, visible: true }]; }));
    assertFail(result, 'object-without-matrix');
  });

  test('一个对象都没比到不能算过，除非明说这些根名下本来就该是空的', () => {
    assertFail(judgeW3({ roots: [], scene: {}, backend: {} }), 'nothing-compared');
    const empty = { roots: [EQ_A], scene: { [EQ_A]: {} }, backend: { [EQ_A]: { complete: true, components: {} } } };
    assertFail(judgeW3(empty), 'nothing-compared');
    assertPass(judgeW3({ ...empty, allowEmpty: true }));
  });
});

describe('W4 场景 = E3D', () => {
  const boxes = () => ({
    [BOX_A1]: [10000, 4500, -500, 11000, 5500, 500],
    [BOX_A3]: [10250, 4750, 1000, 10750, 5250, 1400],
  });
  const perItem = (mutate) => {
    const scene = boxes();
    const truth = boxes();
    if (mutate) mutate(scene, truth);
    return { applicable: true, groups: [{ name: 'EQ-A', mode: 'per-item', scene, truth: { '24384/30002': truth[BOX_A1], '24384/30003': truth[BOX_A3] } }], unplaced: [] };
  };
  /** 没有名字的直管段：两边切法不同，件数和合起来的包围盒一样 */
  const tubes = (scene) => ({
    applicable: true,
    groups: [{
      name: 'BRAN-S 的直管段',
      mode: 'count-union',
      scene,
      truth: [[20000, -50, -50, 20600, 50, 50], [20600, -50, -50, 21000, 50, 50]],
    }],
  });

  test('正例：件数相等，包围盒逐个对上', () => {
    const result = judgeW4(perItem());
    assertPass(result);
    assert.equal(result.facts.compared, 2);
  });

  test('容差边界：一个分量正好差 1 mm 算过', () => {
    const result = judgeW4(perItem((scene) => { scene[BOX_A1][3] += 1; }));
    assertPass(result);
    assert.equal(result.facts.maxGapMm, 1);
  });

  test('反例：件数不等', () => {
    const result = judgeW4(perItem((scene) => { delete scene[BOX_A3]; }));
    assertFail(result, 'count');
    const problem = problemOf(result, 'count');
    assert.equal(problem.actual.count, 1);
    assert.equal(problem.expected.count, 2);
    assert.deepEqual(problem.missing, [BOX_A3]);
  });

  test('反例：一个包围盒偏 2 mm', () => {
    const result = judgeW4(perItem((scene) => { scene[BOX_A1][0] -= 2; }));
    assertFail(result, 'box');
    const problem = problemOf(result, 'box');
    assert.equal(problem.gapMm, 2);
    assert.deepEqual(problem.actual, [9998, 4500, -500, 11000, 5500, 500]);
    assert.deepEqual(problem.expected, [10000, 4500, -500, 11000, 5500, 500]);
  });

  test('认不出身份的按件数和合起来的包围盒比', () => {
    assertPass(judgeW4(tubes([[20000, -50, -50, 20400, 50, 50], [20400, -50, -50, 21000, 50, 50]])));
    const oneMore = judgeW4(tubes([[20000, -50, -50, 20400, 50, 50], [20400, -50, -50, 20700, 50, 50], [20700, -50, -50, 21000, 50, 50]]));
    assertFail(oneMore, 'count');
    assert.equal(problemOf(oneMore, 'count').actual.count, 3);
    const longer = judgeW4(tubes([[20000, -50, -50, 20400, 50, 50], [20400, -50, -50, 21002, 50, 50]]));
    assertFail(longer, 'union-box');
    assert.equal(problemOf(longer, 'union-box').gapMm, 2);
  });

  test('没有 E3D 真值的用例记不适用', () => {
    const result = judgeW4({ applicable: false, reason: '改名没有几何变化' });
    assert.equal(result.verdict, 'not-applicable');
    assert.equal(result.label, '不适用');
  });

  test('反例：导出里有成员对不上模型树、一件都没比到、包围盒读不出来', () => {
    assertFail(judgeW4({ ...perItem(), unplaced: ['TUBE 3 of BRANCH /AIOS-SUITE-BRAN-S'] }), 'truth-unplaced');
    assertFail(judgeW4({ applicable: true, groups: [] }), 'nothing-compared');
    assertFail(judgeW4(perItem((scene) => { scene[BOX_A1][0] = Number.NaN; })), 'box-invalid');
  });

  test('不认识的比法直接报错', () => {
    assert.throws(() => judgeW4({ groups: [{ name: 'x', mode: 'loose', scene: {}, truth: {} }] }), TypeError);
  });
});

describe('W5 不该动的没动', () => {
  /** 7998 的那台东移并取最新之后：8000 的三个根是对照 */
  const input = (overrides = {}) => ({
    controlRoots: [EQ_A, EQ_B, PIPE_P],
    receipt: receiptOf({ reloaded: [{ refno: EQ_C, added: 0, removed: 0, total: 1 }] }),
    roots: rootsByTree(),
    expected: { movedLibraries: [7998], tree: {} },
    sceneBefore: sceneAtStart(),
    sceneAfter: moveRoot(sceneAtStart(), EQ_C, 500),
    treeBefore: treeAtStart(),
    treeAfter: treeAtStart(),
    ...overrides,
  });

  /** EQ-A 东移并取最新之后：同库的 EQ-B、PIPE-P 跟着重载了一次 */
  const withNeighbours = (overrides = {}) => input({
    controlRoots: [EQ_B, PIPE_P],
    receipt: receiptOf({
      reloaded: [
        { refno: EQ_A, added: 0, removed: 0, total: 2 },
        { refno: EQ_B, added: 0, removed: 0, total: 1 },
        { refno: PIPE_P, added: 0, removed: 0, total: 2 },
      ],
    }),
    expected: { movedLibraries: [8000], tree: {} },
    sceneAfter: moveRoot(sceneAtStart(), EQ_A, 500),
    ...overrides,
  });

  test('正例：对照的根没被重载，对象和树都没变', () => {
    const result = judgeW5(input());
    assertPass(result);
    assert.equal(result.facts.objects, 6);
  });

  test('反例：用例之外的根被重载（它所在的库模型水位没动）', () => {
    const receipt = receiptOf({
      reloaded: [
        { refno: EQ_C, added: 0, removed: 0, total: 1 },
        { refno: EQ_B, added: 0, removed: 0, total: 1 },
      ],
    });
    const result = judgeW5(input({ receipt }));
    assertFail(result, 'unexpected-reload');
    assert.deepEqual(problemOf(result, 'unexpected-reload').actual, { added: 0, removed: 0, total: 1 });
  });

  test('反例：别处一个对象动了（只动 0.5 mm 也算动）', () => {
    const sceneAfter = moveRoot(sceneAtStart(), EQ_C, 500);
    sceneAfter[EQ_B][BOX_B1][0][12] += 0.5;
    const result = judgeW5(input({ sceneAfter }));
    assertFail(result, 'position');
    const problem = problemOf(result, 'position');
    assert.deepEqual(problem.actual, [14000.5, 5000, 0]);
    assert.deepEqual(problem.expected, [14000, 5000, 0]);
  });

  test('反例：对照的根少了一个构件、被撤下', () => {
    const sceneAfter = moveRoot(sceneAtStart(), EQ_C, 500);
    delete sceneAfter[PIPE_P][TUBI];
    assertFail(judgeW5(input({ sceneAfter })), 'component-missing');
    const receipt = receiptOf({
      reloaded: [{ refno: EQ_C, added: 0, removed: 0, total: 1 }],
      withdrawn: [{ refno: EQ_B, refnos: 1, why: 'empty' }],
    });
    assertFail(judgeW5(input({ receipt })), 'control-withdrawn');
  });

  test('反例：模型树别处多一行、改了名、换了次序', () => {
    const more = treeAtStart();
    more['24384_30012'] = { name: '/X', type: 'BOX', parentId: EQ_B, childrenIds: null };
    more[EQ_B].childrenIds = [BOX_B1, '24384_30012'];
    const added = judgeW5(input({ treeAfter: more }));
    assertFail(added, 'tree-added');
    assert.deepEqual(problemOf(added, 'tree-added').actual, [{ id: '24384_30012', name: '/X', type: 'BOX' }]);

    const renamed = treeAtStart();
    renamed[EQ_B].name = '/AIOS-SUITE-EQ-B-X';
    assertFail(judgeW5(input({ treeAfter: renamed })), 'tree-renamed');

    const reordered = treeAtStart();
    reordered[ZONE].childrenIds = [EQ_B, EQ_A, PIPE_P];
    assertFail(judgeW5(input({ treeAfter: reordered })), 'tree-reordered');
  });

  test('用例预期的树变化不算别处；同样的变化不在预期里就判不过', () => {
    const treeAfter = treeAtStart();
    treeAfter[BOX_C2] = { name: '/AIOS-SUITE-7998-BOX2', type: 'BOX', parentId: EQ_C, childrenIds: null };
    treeAfter[EQ_C].childrenIds = [BOX_C1, BOX_C2];
    assertPass(judgeW5(input({ treeAfter, expected: { movedLibraries: [7998], tree: { added: ['24382/1890'] } } })));
    assertFail(judgeW5(input({ treeAfter })), 'tree-added');
  });

  test('整棵子树删掉：预期里只列子树的根，它下面的行跟着算有解释', () => {
    const treeAfter = treeAtStart();
    delete treeAfter[EQ_C];
    delete treeAfter[BOX_C1];
    treeAfter[ZONE_C].childrenIds = [];
    assertPass(judgeW5(input({ treeAfter, expected: { movedLibraries: [7998], tree: { deleted: [EQ_C] } } })));
    assertFail(judgeW5(input({ treeAfter })), 'tree-removed');
  });

  test('已知缺口 KG3 命中：同库的对照根跟着重载，对象和位置逐个没变', () => {
    const result = judgeW5(withNeighbours());
    assertGap(result, ['KG3', 'KG3']);
    assert.equal(result.facts.objects, 4);
  });

  test('零信号过：对照根没有重载，strict 也过', () => {
    assertPass(judgeW5(input(), { disallowGaps: ['KG3'], zero_signal: { w5: 'strict' } }));
  });

  test('disallowGaps / zero_signal strict：无关节点被误重载不再归入 KG3，直接判不过', () => {
    const byList = judgeW5(withNeighbours(), { disallowGaps: ['KG3'] });
    assertFail(byList, 'unexpected-reload');
    assert.deepEqual(gapIds(byList), []);
    const bySignal = judgeW5(withNeighbours(), { zero_signal: { w5: 'strict' } });
    assertFail(bySignal, 'unexpected-reload');
    assert.deepEqual(gapIds(bySignal), []);
    assertGap(judgeW5(withNeighbours(), { zero_signal: { w5: 'loose' } }), ['KG3', 'KG3']);
  });

  test('KG3 命中但对照根的一个对象动了：判不过', () => {
    const sceneAfter = moveRoot(sceneAtStart(), EQ_A, 500);
    sceneAfter[EQ_B][BOX_B1][0][13] += 0.5;
    const result = judgeW5(withNeighbours({ sceneAfter }));
    assertFail(result, 'position');
  });

  test('KG3 条件不命中：跟着重载的对照根撤下了一个构件，判不过', () => {
    const input5 = withNeighbours();
    input5.receipt.models.reloaded[1] = { refno: EQ_B, added: 0, removed: 1, total: 0 };
    const result = judgeW5(input5);
    assertFail(result, 'root-removed');
    assert.deepEqual(gapIds(result), ['KG3']);
  });

  test('给了行状态就顺带比：对照根的行变了判不过', () => {
    const lit = { present: true, action: null, nodeStatus: 'latest', eyeLit: true };
    const rowsBefore = { [EQ_A]: lit, [EQ_B]: lit, [PIPE_P]: lit };
    assertPass(judgeW5(input({ rowsBefore, rowsAfter: { ...rowsBefore } })));
    const rowsAfter = { ...rowsBefore, [EQ_B]: { present: true, action: 'reload', nodeStatus: 'reloadable', eyeLit: true } };
    assertFail(judgeW5(input({ rowsBefore, rowsAfter })), 'control-row-changed');
  });

  test('反例：对照的根重载没成、被列成没有动、取最新之前的场景没采到', () => {
    const reloaded = [{ refno: EQ_C, added: 0, removed: 0, total: 1 }];
    const failed = receiptOf({ reloaded, failed: [{ refno: EQ_B, reason: '重载没有完成' }] });
    assertFail(judgeW5(input({ receipt: failed })), 'control-failed');
    const kept = receiptOf({ reloaded, kept: [{ refno: PIPE_P, reason: '这个节点落后' }] });
    assertFail(judgeW5(input({ receipt: kept })), 'control-kept');
    const sceneBefore = sceneAtStart();
    delete sceneBefore[EQ_B];
    assertFail(judgeW5(input({ sceneBefore })), 'no-baseline');
  });

  test('反例：没有对照的根、没有回执、没有前后两份树', () => {
    assertFail(judgeW5(input({ controlRoots: [] })), 'no-control');
    assertFail(judgeW5(input({ receipt: null })), 'no-receipt');
    assertFail(judgeW5(input({ treeAfter: null })), 'no-tree');
  });
});

describe('W6 干净', () => {
  const PAGE = 'http://127.0.0.1:3104';
  const BACKEND = 'http://127.0.0.1:9199';
  const input = (overrides = {}) => ({
    allowedOrigins: [PAGE, BACKEND],
    requests: [
      { method: 'GET', url: `${PAGE}/src/main.ts` },
      { method: 'GET', url: `${BACKEND}/api/v1/dbnums` },
      { method: 'POST', url: `${BACKEND}/api/v1/model/records` },
      { method: 'GET', url: 'data:image/png;base64,AAAA' },
    ],
    toLive: [],
    blocked: [],
    consoleErrors: [],
    pageErrors: [],
    ...overrides,
  });
  const plus = (...more) => [...input().requests, ...more];

  test('正例：请求只到页面服务和隔离后端，没有报错', () => {
    const result = judgeW6(input());
    assertPass(result);
    assert.equal(result.facts.requests, 4);
    assert.equal(result.facts.toLive, 0);
  });

  test('反例：有一条发往 8022 的请求', () => {
    const result = judgeW6(input({ requests: plus({ method: 'GET', url: 'http://127.0.0.1:8022/api/v1/dbnums' }) }));
    assertFail(result, 'request-to-live');
    assert.deepEqual(problemOf(result, 'request-to-live').actual, [{ request: 'GET http://127.0.0.1:8022/api/v1/dbnums', count: 1 }]);
    assert.deepEqual(problemOf(result, 'request-to-live').expected, []);
    assert.ok(!codes(result).includes('request-elsewhere'));
  });

  test('反例：守卫记下一条发往 8009 的 WebSocket；换成 localhost 也一样', () => {
    assertFail(judgeW6(input({ toLive: [{ method: 'WS', url: 'ws://127.0.0.1:8009/rpc' }] })), 'request-to-live');
    assertFail(judgeW6(input({ requests: plus('http://localhost:8009/health') })), 'request-to-live');
  });

  test('守卫记的和请求清单里的是同一条时只算一次', () => {
    const live = { method: 'GET', url: 'http://127.0.0.1:8022/api/v1/dbnums' };
    const result = judgeW6(input({ requests: plus(live), toLive: [live] }));
    assert.equal(result.facts.toLive, 1);
  });

  test('反例：有一条页面报错', () => {
    const result = judgeW6(input({ consoleErrors: ['TypeError: Cannot read properties of undefined'] }));
    assertFail(result, 'page-error');
    assert.deepEqual(problemOf(result, 'page-error').actual, [{ kind: 'console', text: 'TypeError: Cannot read properties of undefined' }]);
    assertFail(judgeW6(input({ pageErrors: [{ message: 'boom' }] })), 'page-error');
  });

  test('反例：请求发到了别处、守卫拦下了请求、一条请求都没采到', () => {
    const elsewhere = judgeW6(input({ requests: plus('https://fonts.googleapis.com/css2?family=Inter') }));
    assertFail(elsewhere, 'request-elsewhere');
    assert.equal(elsewhere.facts.elsewhere, 1);
    assertFail(judgeW6(input({ blocked: [{ method: 'POST', url: `${BACKEND}/api/v1/model/generate` }] })), 'request-blocked');
    assertFail(judgeW6(input({ requests: [] })), 'no-requests');
  });

  test('明说不算的报错放过但逐条记下；别的报错照样判不过；不写缘由不让放', () => {
    const ignoreErrors = [{ pattern: 'favicon\\.ico', reason: '页面服务没有图标文件' }];
    const favicon = 'Failed to load resource: http://127.0.0.1:3104/favicon.ico 404';
    const quiet = judgeW6(input({ consoleErrors: [favicon], ignoreErrors }));
    assertPass(quiet);
    assert.deepEqual(quiet.facts.ignoredErrors, [{ kind: 'console', text: favicon, reason: '页面服务没有图标文件' }]);
    const mixed = judgeW6(input({ consoleErrors: [favicon, 'TypeError: x'], ignoreErrors }));
    assertFail(mixed, 'page-error');
    assert.equal(mixed.facts.errors, 1);
    assert.throws(() => judgeW6(input({ ignoreErrors: [{ pattern: 'x' }] })), TypeError);
  });

  test('反例：有请求的地址读不出来', () => {
    assertFail(judgeW6(input({ requests: plus('not a url') })), 'request-unreadable');
  });

  test('没给页面服务和隔离后端的地址直接报错', () => {
    assert.throws(() => judgeW6(input({ allowedOrigins: [] })), TypeError);
  });
});

describe('W7 还原之后回到原样', () => {
  const NEW_BOX = '24384_39001';
  const input = (overrides = {}) => ({
    mode: 'identical',
    roots: [EQ_A, EQ_B, PIPE_P],
    treeBefore: treeAtStart(),
    treeAfter: treeAtStart(),
    sceneBefore: sceneAtStart(),
    sceneAfter: sceneAtStart(),
    ...overrides,
  });

  /** BOX-A1 删了再建：同一个名字、同一个位置，参考号是新的 */
  const rebuilt = (overrides = {}) => {
    const treeAfter = treeAtStart();
    delete treeAfter[BOX_A1];
    treeAfter[NEW_BOX] = { name: '/AIOS-SUITE-BOX-A1', type: 'BOX', parentId: EQ_A, childrenIds: null };
    treeAfter[EQ_A].childrenIds = [NEW_BOX, BOX_A3];
    const sceneAfter = sceneAtStart();
    sceneAfter[EQ_A][NEW_BOX] = sceneAfter[EQ_A][BOX_A1];
    delete sceneAfter[EQ_A][BOX_A1];
    return input({ mode: 'rebuild', treeAfter, sceneAfter, rebuiltCount: 1, ...overrides });
  };

  test('正例：树和场景都回到原样', () => {
    const result = judgeW7(input());
    assertPass(result);
    assert.equal(result.facts.objects, 6);
    assert.equal(result.facts.maxPositionMm, 0);
  });

  test('反例：树多一行', () => {
    const treeAfter = treeAtStart();
    treeAfter['24384_30004'] = { name: '/AIOS-SUITE-BOX-A2', type: 'BOX', parentId: EQ_A, childrenIds: null };
    treeAfter[EQ_A].childrenIds = [BOX_A1, BOX_A3, '24384_30004'];
    const result = judgeW7(input({ treeAfter }));
    assertFail(result, 'tree-added');
    assert.deepEqual(problemOf(result, 'tree-added').actual, [{ id: '24384_30004', name: '/AIOS-SUITE-BOX-A2', type: 'BOX' }]);
    assert.deepEqual(problemOf(result, 'tree-added').expected, []);
  });

  test('反例：一个构件没回到原位（差 2 mm）；差 1 mm 以内算回到了', () => {
    const off = sceneAtStart();
    off[EQ_A][BOX_A1][0][12] += 2;
    const result = judgeW7(input({ sceneAfter: off }));
    assertFail(result, 'position');
    assert.deepEqual(problemOf(result, 'position').actual, [10002, 5000, 0]);
    assert.deepEqual(problemOf(result, 'position').expected, [10000, 5000, 0]);
    const near = sceneAtStart();
    near[EQ_A][BOX_A1][0][12] += 1;
    const close = judgeW7(input({ sceneAfter: near }));
    assertPass(close);
    assert.equal(close.facts.maxPositionMm, 1);
  });

  test('反例：名字没改回来、成员次序变了、少了一个构件', () => {
    const renamed = treeAtStart();
    renamed[EQ_B].name = '/AIOS-SUITE-EQ-B-RENAMED';
    assertFail(judgeW7(input({ treeAfter: renamed })), 'tree-renamed');
    const reordered = treeAtStart();
    reordered[EQ_A].childrenIds = [BOX_A3, BOX_A1];
    assertFail(judgeW7(input({ treeAfter: reordered })), 'tree-reordered');
    const fewer = sceneAtStart();
    delete fewer[EQ_A][BOX_A3];
    assertFail(judgeW7(input({ sceneAfter: fewer })), 'component-missing');
  });

  test('重建类的还原：参考号换了、名字类型次序和几何都一样，算回到原样，换了的参考号记下来', () => {
    const result = judgeW7(rebuilt());
    assertPass(result);
    assert.deepEqual(result.facts.refnoChanges.scene, [{ root: EQ_A, before: BOX_A1, after: NEW_BOX }]);
    assert.equal(result.facts.refnoChanges.tree.length, 1);
    assert.equal(result.facts.refnoChanges.tree[0].before, BOX_A1);
    assert.equal(result.facts.refnoChanges.tree[0].after, NEW_BOX);
  });

  test('同一份重建的数据按「逐项相同」比：判不过', () => {
    const result = judgeW7(rebuilt({ mode: 'identical' }));
    assertFail(result, 'tree-added');
    assert.ok(codes(result).includes('tree-removed'));
    assert.ok(codes(result).includes('component-missing'));
  });

  test('重建类的反例：建回来的构件偏了 2 mm、排到了别的次序、换了参考号的个数不对', () => {
    const off = rebuilt();
    off.sceneAfter[EQ_A][NEW_BOX] = [shifted(off.sceneAfter[EQ_A][NEW_BOX][0], 2)];
    const moved = judgeW7(off);
    assertFail(moved, 'component-not-restored');
    assert.ok(codes(moved).includes('component-extra'));

    const swapped = rebuilt();
    swapped.treeAfter[EQ_A].childrenIds = [BOX_A3, NEW_BOX];
    assertFail(judgeW7(swapped), 'tree-renamed');

    assertFail(judgeW7(rebuilt({ rebuiltCount: 2 })), 'rebuilt-count');
  });

  test('重建类：没起名的元素名字里带着参考号，参考号换了不算改名；多一行照样判不过', () => {
    const NEW_UNNAMED = '24384_39002';
    const treeAfter = treeAtStart();
    delete treeAfter[BOX_A3];
    treeAfter[NEW_UNNAMED] = { name: '=24384/39002', type: 'BOX', parentId: EQ_A, childrenIds: null };
    treeAfter[EQ_A].childrenIds = [BOX_A1, NEW_UNNAMED];
    const sceneAfter = sceneAtStart();
    sceneAfter[EQ_A][NEW_UNNAMED] = sceneAfter[EQ_A][BOX_A3];
    delete sceneAfter[EQ_A][BOX_A3];
    assertPass(judgeW7(input({ mode: 'rebuild', treeAfter, sceneAfter })));

    const more = structuredClone(treeAfter);
    more['24384_39003'] = { name: '/EXTRA', type: 'BOX', parentId: EQ_A, childrenIds: null };
    more[EQ_A].childrenIds = [BOX_A1, NEW_UNNAMED, '24384_39003'];
    const result = judgeW7(input({ mode: 'rebuild', treeAfter: more, sceneAfter }));
    assertFail(result, 'tree-children');
    assert.equal(problemOf(result, 'tree-children').actual.length, 3);
    assert.equal(problemOf(result, 'tree-children').expected.length, 2);
  });

  describe('行、眼睛和场景', () => {
    /** 撤下的那个根：场景里已经没有它的对象 */
    const GONE = '24384_30050';
    const lit = { present: true, action: null, nodeStatus: 'latest', eyeLit: true };
    const withdrawnDirect = { dbnum: 8000, loadedVia: 'address', aloneInLibraryAtLoad: true, reloadsBefore: 1, withdrawnVia: 'address' };
    const withGone = (info, row = lit, more = {}) => input({
      rowsBefore: { [EQ_A]: lit },
      rowsAfter: { [EQ_A]: lit, [GONE]: row },
      rootsInfo: info ? { [GONE]: info } : {},
      ...more,
    });

    test('已知缺口 KG2 命中：重载过的直装节点从地址栏撤下，名下没有对象，眼睛还亮', () => {
      const result = judgeW7(withGone(withdrawnDirect));
      assertGap(result, ['KG2']);
      assert.deepEqual(result.gaps[0].actual, { objects: 0, eyeLit: true, inLoadedTable: null });
    });

    test('KG2 命中：眼睛灭了但已加载节点表里还有它', () => {
      const row = { ...lit, eyeLit: false };
      const result = judgeW7(withGone(withdrawnDirect, row, { rowsBefore: {}, loadedTableAfter: [GONE] }));
      assertGap(result, ['KG2']);
      assert.deepEqual(result.gaps[0].actual, { objects: 0, eyeLit: false, inLoadedTable: true });
    });

    test('KG2 条件不命中，同样的样子判不过：没被重载过 / 不是从地址栏撤的 / 不是直装 / 事实没记下来', () => {
      const variants = [
        { ...withdrawnDirect, reloadsBefore: 0 },
        { ...withdrawnDirect, withdrawnVia: 'getwork' },
        { ...withdrawnDirect, loadedVia: 'tree' },
        null,
      ];
      for (const info of variants) {
        const result = judgeW7(withGone(info));
        assertFail(result, 'eye-lit-without-objects');
        assert.deepEqual(problemOf(result, 'eye-lit-without-objects').actual, { objects: 0, eyeLit: true, inLoadedTable: null });
        assert.deepEqual(problemOf(result, 'eye-lit-without-objects').expected, { objects: 0, eyeLit: false, inLoadedTable: null });
      }
    });

    test('名下没有对象、眼睛也灭了：没有问题', () => {
      assertPass(judgeW7(withGone(null, { ...lit, eyeLit: false })));
    });

    test('反例：行没有回到原样', () => {
      const rowsAfter = { [EQ_A]: { present: true, action: 'reload', nodeStatus: 'reloadable', eyeLit: true } };
      const result = judgeW7(input({ rowsBefore: { [EQ_A]: lit }, rowsAfter }));
      assertFail(result, 'row-not-restored');
      assert.equal(problemOf(result, 'row-not-restored').actual.action, 'reload');
      assert.equal(problemOf(result, 'row-not-restored').expected.action, null);
    });
  });

  test('反例：apply 之前的树是空的、场景没采到、类型变了、顶层不一样、还原之后有行没采到', () => {
    assertFail(judgeW7(input({ treeBefore: {} })), 'no-tree');
    const sceneBefore = sceneAtStart();
    delete sceneBefore[EQ_B];
    assertFail(judgeW7(input({ sceneBefore })), 'no-baseline');
    const retyped = treeAtStart();
    retyped[BOX_B1].type = 'CYLI';
    assertFail(judgeW7(input({ treeAfter: retyped })), 'tree-retyped');
    assertFail(judgeW7(input({ mode: 'rebuild', treeAfter: retyped })), 'tree-retyped');
    const topless = treeAtStart();
    delete topless[ZONE_C];
    delete topless[EQ_C];
    delete topless[BOX_C1];
    assertFail(judgeW7(input({ mode: 'rebuild', treeAfter: topless })), 'tree-top');
    const lit = { present: true, action: null, nodeStatus: 'latest', eyeLit: true };
    assertFail(judgeW7(input({ rowsBefore: { [EQ_A]: lit, [EQ_B]: lit }, rowsAfter: { [EQ_A]: lit } })), 'row-not-sampled');
  });

  test('反例：没有前后两份树、一个对象都没比到；不认识的比法直接报错', () => {
    assertFail(judgeW7(input({ treeBefore: null })), 'no-tree');
    assertFail(judgeW7(input({ roots: [] })), 'nothing-compared');
    assert.throws(() => judgeW7(input({ mode: 'loose' })), TypeError);
  });
});

describe('已知缺口表', () => {
  test('三条都写了条件、原因和出处', () => {
    const gaps = loadKnownGaps();
    assert.deepEqual(gaps.map((gap) => gap.id), ['KG1', 'KG2', 'KG3']);
    for (const gap of gaps) {
      for (const field of ['title', 'condition', 'reason', 'source', 'since']) {
        assert.ok(typeof gap[field] === 'string' && gap[field].length > 0, `${gap.id} 缺 ${field}`);
      }
      assert.ok(Object.keys(gap.when).length > 0, `${gap.id} 没有条件`);
      assert.ok(gap.deviation.kind, `${gap.id} 没写是哪一种偏差`);
      assert.ok(gap.seen_by.length > 0, `${gap.id} 没写哪个看点会照出它`);
    }
  });

  test('条件逐项对上才算命中；事实缺一项不算', () => {
    const gap = { when: { loadedVia: 'address', reloadsBefore: { min: 1 }, aloneInLibraryAtLoad: true } };
    assert.equal(gapApplies(gap, { loadedVia: 'address', reloadsBefore: 2, aloneInLibraryAtLoad: true }), true);
    assert.equal(gapApplies(gap, { loadedVia: 'address', reloadsBefore: 0, aloneInLibraryAtLoad: true }), false);
    assert.equal(gapApplies(gap, { loadedVia: 'tree', reloadsBefore: 2, aloneInLibraryAtLoad: true }), false);
    assert.equal(gapApplies(gap, { loadedVia: 'address', reloadsBefore: 2 }), false);
    assert.equal(gapApplies(gap, { loadedVia: 'address', aloneInLibraryAtLoad: true }), false);
    assert.equal(gapApplies(gap, undefined), false);
    assert.equal(gapApplies(null, { loadedVia: 'address', reloadsBefore: 2, aloneInLibraryAtLoad: true }), false);
    assert.equal(gapApplies({ when: { reloadsBefore: { max: 0 } } }, { reloadsBefore: 0 }), true);
    assert.equal(gapApplies({ when: { reloadsBefore: { max: 0 } } }, { reloadsBefore: 1 }), false);
  });
});

describe('合成一条腿的结论', () => {
  const verdictOf = (verdict, gaps = []) => ({ id: 'W', verdict, problems: verdict === 'fail' ? [{ code: 'x' }] : [], gaps: gaps.map((gap) => ({ gap })) });

  test('有一个不过就是不过；没有不过、有已知缺口就是已知缺口；不适用的不参加', () => {
    assert.equal(summarize([verdictOf('pass'), verdictOf('not-applicable')]).verdict, 'pass');
    const gap = summarize([verdictOf('pass'), verdictOf('known-gap', ['KG3', 'KG3']), verdictOf('known-gap', ['KG1'])]);
    assert.equal(gap.verdict, 'known-gap');
    assert.equal(gap.label, '已知缺口');
    assert.deepEqual(gap.gaps, ['KG1', 'KG3']);
    const fail = summarize([verdictOf('known-gap', ['KG3']), verdictOf('fail')]);
    assert.equal(fail.verdict, 'fail');
    assert.equal(fail.problems, 1);
    assert.equal(summarize([verdictOf('not-applicable')]).verdict, 'not-applicable');
  });

  test('缺省装三个同库节点时，一条只改 EQ-A 的 apply 腿：W2、W5 是已知缺口，整条腿是已知缺口', () => {
    const before = sceneAtStart();
    const after = moveRoot(before, EQ_A, 500);
    const receipt = receiptOf({
      reloaded: [
        { refno: EQ_A, added: 0, removed: 0, total: 2 },
        { refno: EQ_B, added: 0, removed: 0, total: 1 },
        { refno: PIPE_P, added: 0, removed: 0, total: 2 },
      ],
    });
    const expected = {
      tree: {},
      reload: { [EQ_A]: { added: 0, removed: 0, total: 2 } },
      componentsAdded: 0,
      componentsRemoved: 0,
      movedLibraries: [8000],
    };
    const leg = [
      judgeW2({ receipt, expected, roots: rootsByTree() }),
      judgeW3({ roots: [EQ_A], scene: after, backend: backendOf(after, [EQ_A]) }),
      judgeW4({ groups: [{ name: 'EQ-A', mode: 'per-item', scene: { [BOX_A1]: [10000, 4500, -500, 11000, 5500, 500] }, truth: { [BOX_A1]: [10000, 4500, -500, 11000, 5500, 500] } }] }),
      judgeW5({
        controlRoots: [EQ_B, PIPE_P],
        receipt,
        expected,
        roots: rootsByTree(),
        sceneBefore: before,
        sceneAfter: after,
        treeBefore: treeAtStart(),
        treeAfter: treeAtStart(),
      }),
    ];
    const summary = summarize(leg);
    assert.deepEqual(summary.checkpoints, { W2: 'known-gap', W3: 'pass', W4: 'pass', W5: 'known-gap' });
    assert.equal(summary.verdict, 'known-gap');
    assert.deepEqual(summary.gaps, ['KG3']);
  });
});

describe('小工具', () => {
  test('refno 的几种写法统一成 a_b', () => {
    assert.equal(refnoKey('24384/30001'), '24384_30001');
    assert.equal(refnoKey('=24384/30001'), '24384_30001');
    assert.equal(refnoKey(' 24384_30001 '), '24384_30001');
  });

  test('两份树的差', () => {
    const after = treeAtStart();
    delete after[BOX_B1];
    after[EQ_B].childrenIds = [];
    after[BOX_A1].parentId = EQ_B;
    after[EQ_A].name = '/RENAMED';
    const diff = diffTree(treeAtStart(), after);
    assert.deepEqual(diff.removed, [BOX_B1]);
    assert.deepEqual(diff.added, []);
    assert.deepEqual(diff.renamed, [{ id: EQ_A, before: '/AIOS-SUITE-EQ-A', after: '/RENAMED' }]);
    assert.deepEqual(diff.moved, [{ id: BOX_A1, before: EQ_A, after: EQ_B }]);
    assert.deepEqual(diff.childrenChanged.map((item) => item.id), [EQ_B]);
  });
});

describe('管道 compare_key 逐件比对', () => {
  const TUBE_1 = [0, 0, 0, 10, 1, 1];
  const TUBE_2 = [10, 0, 0, 20, 1, 1];
  const FIT = [20, 0, 0, 21, 1, 1];
  const KEY_1 = 'tube:24384/9#1';
  const KEY_2 = 'tube:24384/9#2';
  const PATH_KEY = 'path:/P/FTUBE 1 of BRANCH /X#1';

  function writeSnapshot(members) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'incr-tube-'));
    const file = path.join(dir, 'sample.snapshot.json');
    fs.writeFileSync(file, JSON.stringify({ meta: {}, members }));
    return { dir, file };
  }

  test('有 compare_key 的隐式管段按原键建盒，tube: 与 path: 都不过 refnoKey；旧快照仍进 anonymous', () => {
    const saved = writeSnapshot([
      { path: '/P', name: '/AIOS-SUITE-PIPE-P', noun: 'PIPE', refno: '24384/20', resolved: true, aabb_world_mm: [0, 0, 0, 21, 1, 1], compare_key: '24384/20' },
      { path: '/P/BRAN', name: '/AIOS-SUITE-BRAN-S', noun: 'BRAN', refno: '24384/9', resolved: true, aabb_world_mm: null, compare_key: '24384/9' },
      {
        path: '/P/BRAN/FTUBE 2 of BRANCH /AIOS-SUITE-BRAN-S',
        name: 'FTUBE 2 of BRANCH /AIOS-SUITE-BRAN-S',
        noun: 'FTUB',
        refno: null,
        resolved: false,
        ordinal: 2,
        aabb_world_mm: TUBE_2,
        compare_key: KEY_2,
      },
      {
        path: '/P/BRAN/FTUBE 1 of BRANCH /AIOS-SUITE-BRAN-S',
        name: 'FTUBE 1 of BRANCH /AIOS-SUITE-BRAN-S',
        noun: 'FTUB',
        refno: null,
        resolved: false,
        ordinal: 1,
        aabb_world_mm: TUBE_1,
        compare_key: KEY_1,
      },
      {
        path: '/P/FTUBE 1 of BRANCH /X',
        name: 'FTUBE 1 of BRANCH /X',
        noun: 'TUBE',
        refno: null,
        resolved: false,
        ordinal: 1,
        aabb_world_mm: [30, 0, 0, 40, 1, 1],
        compare_key: PATH_KEY,
      },
      {
        path: '/P/BRAN/TUBE 9 of BRANCH /OLD',
        name: 'TUBE 9 of BRANCH /OLD',
        noun: 'TUBE',
        refno: null,
        resolved: false,
        ordinal: 9,
        aabb_world_mm: [40, 0, 0, 50, 1, 1],
      },
    ]);
    try {
      const snapshot = loadRvmSnapshot(saved.file);
      const tube = snapshot.members.find((member) => member.ordinal === 2);
      assert.equal(tube.compareKey, KEY_2);
      assert.equal(tube.refno, null);
      const boxes = truthBoxes(snapshot.members);
      assert.deepEqual(boxes.byRefno[refnoKey('24384/20')], [0, 0, 0, 21, 1, 1]);
      assert.deepEqual(boxes.byRefno[KEY_1], TUBE_1);
      assert.deepEqual(boxes.byRefno[KEY_2], TUBE_2);
      assert.deepEqual(boxes.byRefno[PATH_KEY], [30, 0, 0, 40, 1, 1]);
      assert.equal(boxes.byRefno['tube:24384_9#1'], undefined);
      assert.equal(boxes.byRefno['path:_P/FTUBE 1 of BRANCH /X#1'], undefined);
      assert.deepEqual(boxes.anonymous.map((item) => item.path), ['/P/BRAN/TUBE 9 of BRANCH /OLD']);
      const built = truthGroups(snapshot, [{ root: '24384/20', mode: 'per-item' }], {});
      assert.equal(built.unplaced.length, 1);
      assert.match(built.unplaced[0], /TUBE 9 of BRANCH \/OLD/);
      assert.deepEqual(built.groups[0].truth[KEY_1], TUBE_1);
      assert.equal(built.groups[0].truth['tube:24384_9#2'], undefined);
    } finally {
      fs.rmSync(saved.dir, { recursive: true, force: true });
    }
  });

  test('per-item：tube:<属主>#<FTUBE n> 对上就过；件数和总包围盒不变但某段换键或挪到合盒里面，判不过', () => {
    const truth = { [KEY_1]: TUBE_1, [KEY_2]: TUBE_2, '24384/10': FIT };
    const matched = {
      applicable: true,
      groups: [{ name: 'PIPE-P', mode: 'per-item', scene: { [KEY_1]: TUBE_1, [KEY_2]: TUBE_2, '24384_10': FIT }, truth }],
    };
    assertPass(judgeW4(matched));
    const swapped = {
      applicable: true,
      groups: [{ name: 'PIPE-P', mode: 'per-item', scene: { [KEY_1]: TUBE_2, [KEY_2]: TUBE_1, '24384_10': FIT }, truth }],
    };
    assertFail(judgeW4(swapped), 'box');
    assert.equal(problemOf(judgeW4(swapped), 'box').message.includes(KEY_1), true);
    const shifted = {
      applicable: true,
      groups: [{
        name: 'PIPE-P',
        mode: 'per-item',
        scene: { [KEY_1]: [0, 0, 0, 8, 1, 1], [KEY_2]: [8, 0, 0, 20, 1, 1], '24384_10': FIT },
        truth,
      }],
    };
    assertFail(judgeW4(shifted), 'box');
    assertPass(judgeW4({
      groups: [{
        name: 'PIPE-P',
        mode: 'count-union',
        scene: [[0, 0, 0, 8, 1, 1], [8, 0, 0, 20, 1, 1], FIT],
        truth: [TUBE_1, TUBE_2, FIT],
      }],
    }));
  });

  test('场景逐件盒：纯管段属主不再留合盒，改成 tube: 键；构件合盒保持原样', () => {
    const scene = {
      byDbnum: {
        8000: {
          '24384_9': [
            { id: 'a', m: null, visible: true, box: TUBE_1, implicitTube: true },
            { id: 'b', m: null, visible: true, box: TUBE_2, implicitTube: true },
          ],
          '24384_10': [
            { id: 'e', m: null, visible: true, box: FIT, implicitTube: false },
          ],
        },
      },
      tubeBoxes: {
        8000: { [KEY_1]: TUBE_1, [KEY_2]: TUBE_2 },
      },
    };
    const sorted = sceneByRoot({
      scene,
      roots: [{ refno: '24384/20', dbnum: 8000, members: ['24384/9', '24384_10'] }],
    });
    const root = '24384_20';
    assert.deepEqual(sorted.boxes[root]['24384_9'], [0, 0, 0, 20, 1, 1]);
    assert.deepEqual(sorted.boxes[root]['24384_10'], FIT);
    assert.equal(sorted.perItemBoxes[root]['24384_9'], undefined);
    assert.deepEqual(sorted.perItemBoxes[root][KEY_1], TUBE_1);
    assert.deepEqual(sorted.perItemBoxes[root][KEY_2], TUBE_2);
    assert.deepEqual(sorted.perItemBoxes[root]['24384_10'], FIT);
    assert.deepEqual(sorted.byRoot[root]['24384_9'].map((object) => object.visible), [true, true]);
  });
});
