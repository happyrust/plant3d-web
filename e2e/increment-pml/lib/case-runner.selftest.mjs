/**
 * 流程的自测：不开浏览器、不连后端、不开 E3D，把一条用例的流程（`runCase` → `runLeg` → 加装 `loadMore` → 判定 → 落证据）照原样整段跑一遍。
 * 假的只有三样：页面（`page.fake.mjs` 顶替 `page.mjs` 里碰浏览器的函数）、后端（同一个假的世界）、腿命令（一段只写结果文件的小脚本）。
 *
 * 现在的样例都是「加装」那一步的（运行配置的 `thenLoad`），照 K21 的样子：盒子从设备甲换到起点时空着的设备乙名下，点完「取最新」
 * 再把设备乙装上。装得上的、装不上的都有；装不上时流程不中断，W3 记「不过」，问题里写明是加装之后、哪个节点没装上。
 * 只判 W3、W6（假页面只做到这一步，见 `page.fake.mjs`）；真页面装不上时是什么样子（等多久、报不报错）不在这里验。
 *
 * 跑法：`node --test e2e/increment-pml/lib/case-runner.selftest.mjs`。要 Node 22.15 及以上：换模块用的是 `node:module` 的 `registerHooks`。
 * 流程落的证据写在 `e2e/increment-pml/.selftest-tmp-*`（工作树里、仓库不收），一个样例一个目录，跑完就删；不往系统的临时目录写。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import nodeModule from 'node:module';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { createFakeWorld } from './page.fake.mjs';

if (typeof nodeModule.registerHooks !== 'function') {
  throw new Error(`这条自测要 Node 22.15 及以上（现在是 ${process.version}）：换模块用的是 node:module 的 registerHooks`);
}

// 流程代码导入的 `./page.mjs` 换成假页面；别的文件（假页面自己也在内）导入的还是真的。要赶在流程代码头一次加载之前
const REAL_PAGE = new URL('./page.mjs', import.meta.url).href;
const FAKE_PAGE = new URL('./page.fake.mjs', import.meta.url).href;
const FLOW_MODULES = ['./case-runner.mjs', './leg.mjs'].map((name) => new URL(name, import.meta.url).href);
const swapped = new Set();
nodeModule.registerHooks({
  resolve(specifier, context, nextResolve) {
    const resolved = nextResolve(specifier, context);
    if (resolved.url !== REAL_PAGE || !FLOW_MODULES.includes(context.parentURL)) return resolved;
    swapped.add(context.parentURL);
    return { ...resolved, url: FAKE_PAGE };
  },
});
const { LEG_RESULT_SCHEMA, runCase } = await import('./case-runner.mjs');

const DBNUM = 8000;
const SITE = '24384_30000';
const ZONE = '24384_30001';
const EQ_A = '24384_30010';
const BOX_A1 = '24384_30011';
const EQ_B = '24384_30020';
const EQ_KEEP = '24384_30030';
const BOX_KEEP = '24384_30031';

// 库的三个会话：起点、换过去之后、换回之后
const AT_START = 100;
const MOVED = 101;
const MOVED_BACK = 102;

/** 这个库在一个会话里的样子：盒子挂在哪台设备下面、后端给没给它生成几何 */
function library({ boxUnder, boxHasGeometry = true }) {
  return {
    [SITE]: { name: '/SELFTEST-SITE', noun: 'SITE', owner: null },
    [ZONE]: { name: '/SELFTEST-ZONE', noun: 'ZONE', owner: SITE },
    [EQ_A]: { name: '/EQ-A', noun: 'EQUI', owner: ZONE },
    [EQ_B]: { name: '/EQ-B', noun: 'EQUI', owner: ZONE },
    [EQ_KEEP]: { name: '/EQ-KEEP', noun: 'EQUI', owner: ZONE },
    [BOX_A1]: { name: '/BOX-A1', noun: 'BOX', owner: boxUnder, ...(boxHasGeometry ? { at: [40000, 5000, 0] } : {}) },
    [BOX_KEEP]: { name: '/BOX-KEEP', noun: 'BOX', owner: EQ_KEEP, at: [0, 0, 0] },
  };
}

// 腿命令：不开 E3D，只在 {{RESULT}} 写一份「这个库从会话 before 存到了 after」的结果。后端跟不跟得上由假的世界说了算
// （命令行参数里不带换行和双引号：各系统拼命令行的规矩不一样，这两样最容易出岔子）
const LEG_SCRIPT = `
  const [file, schema, dbnum, before, after] = process.argv.slice(1);
  const step = {
    index: 1, spec: 'selftest@' + dbnum, kind: 'write', dbs: [Number(dbnum)], verdict: 'pass', seconds: 0,
    sesno_before: { [dbnum]: Number(before) }, sesno_after: { [dbnum]: Number(after) }, quit_finished: true,
  };
  const result = {
    schema, ok: true, exit: 0, verdict: 'pass', problems: [], evidence: null, saved_at_ms: Date.now(), steps: [step],
    libraries: [{ dbnum: Number(dbnum), before: Number(before), after: Number(after), written: true }],
  };
  require('node:fs').writeFileSync(file, JSON.stringify(result));
  console.log('fake leg: library ' + dbnum + ' saved, session ' + before + ' -> ' + after);
`.replace(/\s*\n\s*/g, ' ').trim();
const legCommand = (before, after) => [process.execPath, '-e', LEG_SCRIPT, '{{RESULT}}', LEG_RESULT_SCHEMA, String(DBNUM), String(before), String(after)];

const THEN_LOAD = { refno: EQ_B, dbnum: DBNUM, name: '/EQ-B' };
const CASE = {
  id: 'SELFTEST-THEN-LOAD',
  title: '换上级：/BOX-A1 从 /EQ-A 换到 /EQ-B 名下，再换回',
  expand: [SITE, ZONE, EQ_A, EQ_B],
  // /EQ-KEEP 一直装着不动：/EQ-A 被撤下之后场景里还有东西可比
  roots: [
    { refno: EQ_A, dbnum: DBNUM, name: '/EQ-A' },
    { refno: EQ_KEEP, dbnum: DBNUM, name: '/EQ-KEEP' },
  ],
  legs: [
    { id: 'apply', title: '换过去', command: legCommand(AT_START, MOVED), judge: ['W3', 'W6'], settleMs: 0, thenLoad: { roots: [THEN_LOAD] } },
    { id: 'restore', title: '换回', command: legCommand(MOVED, MOVED_BACK), judge: ['W3', 'W6'], settleMs: 0 },
  ],
};

const WAITED_TOO_LONG = `等「节点 ${EQ_B} 装完」超过 120000 毫秒`;

// 样例的证据目录建在 `e2e/increment-pml/` 下，名字以这个开头。不用系统的临时目录：那儿常在系统盘上，这条线的东西不往系统盘写
const SCRATCH_PREFIX = fileURLToPath(new URL('../.selftest-tmp-', import.meta.url));

/**
 * 把上面那条用例跑一遍。
 *
 * @param {object} [options]
 * @param {string[]} [options.refuses] 页面点了眼睛也装不上的节点
 * @param {boolean} [options.boxHasGeometryAfterMove] 换过去之后后端有没有给盒子生成几何
 */
async function runSample({ refuses = [], boxHasGeometryAfterMove = true } = {}) {
  const world = createFakeWorld({
    dbnum: DBNUM,
    start: AT_START,
    sessions: {
      [AT_START]: library({ boxUnder: EQ_A }),
      [MOVED]: library({ boxUnder: EQ_B, boxHasGeometry: boxHasGeometryAfterMove }),
      [MOVED_BACK]: library({ boxUnder: EQ_A }),
    },
    refuses,
  });
  const env = {
    browser: world.browser,
    backend: world.backend,
    // 哪儿也不连：地址只用来分辨请求记录里的去向
    pageOrigin: 'http://127.0.0.1:39001',
    backendOrigin: 'http://127.0.0.1:39002',
    project: 'SelfTest',
  };
  const caseDir = fs.mkdtempSync(SCRATCH_PREFIX);
  try {
    const record = await runCase(env, CASE, caseDir);
    const files = fs.readdirSync(caseDir).sort();
    const applyRecord = files.includes('apply.record.json') ? JSON.parse(fs.readFileSync(path.join(caseDir, 'apply.record.json'), 'utf8')) : null;
    return { record, world, files, applyRecord, requests: world.pages[0]?.log.requests ?? [] };
  } finally {
    fs.rmSync(caseDir, { recursive: true, force: true });
  }
}

/** 流程照常走完：没有中途出错，前提都过，两条腿都跑完、都落了证据，该截的图都截了（加装之后那一张也在） */
function assertWalkedThrough({ record, world, files }) {
  assert.equal(record.error, null);
  assert.equal(record.completed, true);
  assert.deepEqual(record.checks.filter((item) => !item.pass), []);
  assert.deepEqual(record.legs.map((leg) => [leg.id, leg.completed]), [['apply', true], ['restore', true]]);
  for (const name of ['apply.record.json', 'apply.judgements.json', 'restore.record.json', 'restore.judgements.json', 'case.json']) {
    assert.ok(files.includes(name), `证据目录里没有 ${name}`);
  }
  assert.deepEqual(world.shots, [
    '00-baseline.png',
    'apply-1-before-click.png',
    'apply-2-after.png',
    'apply-3-after-load.png',
    'restore-1-before-click.png',
    'restore-2-after.png',
  ]);
  assert.equal(world.closed, 1);
}

/** 点过眼睛的节点从这以后算装着的（装没装上另记）：用例记录里有它，后一条腿看的节点里也有它 */
function assertCountedAsLoaded({ record }) {
  assert.deepEqual(record.thenLoaded, [{ ...THEN_LOAD, afterLeg: 'apply' }]);
  const restore = record.legs[1];
  assert.equal(restore.rootFacts[EQ_B].loadedVia, 'tree');
  assert.equal(restore.judgements.W3.facts.roots, 3);
}

describe('换模块', () => {
  test('流程代码（case-runner.mjs、leg.mjs）导入的页面模块都换成了假页面', () => {
    assert.deepEqual([...swapped].sort(), [...FLOW_MODULES].sort());
  });
});

describe('加装：一条腿点完「取最新」之后再装节点', () => {
  test('装得上：W3 过，加装之后按装着的全部节点又比了一回', async () => {
    const sample = await runSample();
    assertWalkedThrough(sample);
    const [apply, restore] = sample.record.legs;

    assert.deepEqual(apply.thenLoad.roots, [THEN_LOAD]);
    assert.equal(apply.thenLoad.error, null);
    assert.deepEqual(apply.thenLoad.notInScene, []);
    assert.deepEqual(apply.thenLoad.sceneComponents, { [EQ_B]: 1 });
    assert.deepEqual(apply.thenLoad.backendComponents, { [EQ_B]: 1 });

    assert.equal(apply.judgements.W3.verdict, 'pass');
    assert.deepEqual(apply.judgements.W3.problems, []);
    // 点完「取最新」那一回比的是开头装的两个节点（/EQ-A 已经空了），加装之后那一回是三个节点、两个对象
    assert.equal(apply.judgements.W3.facts.roots, 2);
    assert.equal(apply.judgements.W3.facts.objects, 1);
    assert.equal(apply.judgements.W3.facts.afterLoad.roots, 3);
    assert.equal(apply.judgements.W3.facts.afterLoad.objects, 2);
    assert.equal(apply.summary.verdict, 'pass');

    assertCountedAsLoaded(sample);
    assert.equal(restore.summary.verdict, 'pass');
    assert.equal(sample.record.verdict, 'pass');
  });

  test('装不上（后端名下有几何，页面没装上）：不中断，W3 不过，写明是加装之后、哪个节点', async () => {
    const sample = await runSample({ refuses: [EQ_B] });
    assertWalkedThrough(sample);
    const [apply, restore] = sample.record.legs;

    assert.equal(apply.thenLoad.error, WAITED_TOO_LONG);
    assert.deepEqual(apply.thenLoad.notInScene, [EQ_B]);
    assert.deepEqual(apply.thenLoad.sceneComponents, { [EQ_B]: 0 });
    assert.deepEqual(apply.thenLoad.backendComponents, { [EQ_B]: 1 });

    assert.equal(apply.judgements.W3.verdict, 'fail');
    assert.deepEqual(apply.judgements.W3.problems, [
      { code: 'then-load-failed', message: `加装 /EQ-B 没走完：${WAITED_TOO_LONG}` },
      { code: 'then-load-not-in-scene', message: '加装的 /EQ-B 没有装进场景' },
      { code: 'component-missing', message: `加装 /EQ-B 之后：${EQ_B} 名下少 1 个构件` },
    ]);
    assert.equal(apply.judgements.W6.verdict, 'pass');
    assert.equal(apply.summary.verdict, 'fail');

    // 照常往下走：后一条腿照样跑、照样判
    assertCountedAsLoaded(sample);
    assert.equal(restore.summary.verdict, 'pass');
    assert.equal(sample.record.verdict, 'fail');
  });

  test('装不上（后端名下也是空的）：场景和后端对得上也不算过，W3 不过全靠另外记的那两条', async () => {
    const sample = await runSample({ boxHasGeometryAfterMove: false });
    assertWalkedThrough(sample);
    const [apply, restore] = sample.record.legs;

    assert.equal(apply.thenLoad.error, WAITED_TOO_LONG);
    assert.deepEqual(apply.thenLoad.notInScene, [EQ_B]);
    assert.deepEqual(apply.thenLoad.sceneComponents, { [EQ_B]: 0 });
    assert.deepEqual(apply.thenLoad.backendComponents, { [EQ_B]: 0 });

    // 加装之后「场景 = 后端」那一回自己是过的（两边都是空的）
    assert.equal(sample.applyRecord.thenLoad.w3.verdict, 'pass');
    assert.equal(apply.judgements.W3.verdict, 'fail');
    assert.deepEqual(apply.judgements.W3.problems, [
      { code: 'then-load-failed', message: `加装 /EQ-B 没走完：${WAITED_TOO_LONG}` },
      { code: 'then-load-not-in-scene', message: '加装的 /EQ-B 没有装进场景' },
    ]);
    assert.equal(apply.summary.verdict, 'fail');

    assertCountedAsLoaded(sample);
    assert.equal(restore.summary.verdict, 'pass');
    assert.equal(sample.record.verdict, 'fail');
  });

  test('加装算在这条腿的时段里：W6 管到装完，后一条腿从装完那一刻接着算', async () => {
    const { record, requests } = await runSample();
    const [apply, restore] = record.legs;
    const loadFrom = apply.thenLoad.startedAt;
    const loadTo = loadFrom + apply.thenLoad.ms;
    assert.equal(apply.times.to, loadTo);
    assert.equal(restore.times.from, loadTo);

    const inLeg = requests.filter((item) => item.t >= apply.times.from && item.t < apply.times.to);
    // 加装时假页面发一条请求（点眼睛取模型记录）
    assert.equal(inLeg.filter((item) => item.t >= loadFrom).length, 1);
    assert.equal(apply.judgements.W6.verdict, 'pass');
    assert.equal(apply.judgements.W6.facts.requests, inLeg.length);
    assert.equal(apply.requests.total, inLeg.length);
  });
});
