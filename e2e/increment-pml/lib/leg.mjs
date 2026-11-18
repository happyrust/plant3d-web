/**
 * 一条腿的流程：存盘之前记一遍（页面的行、场景、树，后端的记录、水位、层）→ 把要看的行摆好、开始采样 → 存盘 →
 * 不碰页面，等行上的信号 → 等后端跟上 → 按后端前后的差算回执的预期 → 点一次「取最新」→ 再记一遍 → 判 W1–W3、W5、W6
 * （还原的腿再判 W7）。
 *
 * 存盘这一步由调用方给（在 E3D 里跑宏，或者回放一个录好的会话），其余各腿走同一份代码。W4（场景 = E3D）要 E3D 的导出，不在这里。
 */
import { expectedModels, expectedTree, sleep } from './backend.mjs';
import { judgeW1, judgeW2, judgeW3, judgeW5, judgeW6, judgeW7, refnoKey, SIGNAL_WINDOW_MS, summarize } from './judge.mjs';
import {
  arrangeRows,
  cleanlinessInput,
  clickGetWork,
  fetchedLayers,
  readPageState,
  readScene,
  readSettledRows,
  readTree,
  requestSummary,
  sceneByRoot,
  startRowWatch,
  stopRowWatch,
  waitIdle,
  waitRowSignal,
} from './page.mjs';

const CATCH_UP_MS = 240_000;
const SETTLE_MS = 5000;
const NOTHING = Object.freeze({ complete: true, components: {} });

/** 页面此刻的样子：页面自己的账、场景里的对象、模型树 */
export async function observePage(ctx) {
  const dbnums = [...new Set(ctx.roots.map((root) => root.dbnum))];
  const state = await readPageState(ctx.page, ctx.roots);
  const scene = await readScene(ctx.page, dbnums, { sceneToMm: ctx.sceneToMm ?? 1000 });
  const tree = await readTree(ctx.page);
  return { at: Date.now(), state, scene, tree };
}

/** 后端此刻的样子：这几个根名下的记录、各库的水位、页面取过的那些层各有哪些成员、这几个根还在不在 */
export async function observeBackend(backend, rootIds, layerIds) {
  const snapshot = await backend.snapshot(rootIds);
  const layers = await backend.layers(layerIds);
  const exists = {};
  for (const root of rootIds) exists[root] = await backend.exists(root);
  return { at: snapshot.at, roots: snapshot.roots, libraries: snapshot.libraries, layers, exists };
}

/**
 * 场景按根分好（见 `sceneByRoot`）。没有根认领的对象、哪个库都不认的对象各算一个假根放在 `extra`：后端那边它们名下是空的，
 * W3 会把它们报成多出来的——场景里不该有说不清归谁的东西。
 */
export function sceneForJudging(pageSide, backendSide) {
  const claims = Object.fromEntries(
    Object.entries(backendSide.roots).map(([root, entry]) => [root, Object.keys(entry.components ?? {})]),
  );
  const sorted = sceneByRoot({ scene: pageSide.scene, roots: pageSide.state.roots, claims });
  const extra = {};
  for (const [dbnum, components] of Object.entries(sorted.strays)) {
    const objects = pageSide.scene.byDbnum[dbnum];
    extra[`库 ${dbnum} 里没有根认领的对象`] = Object.fromEntries(Object.keys(components).map((component) => [
      component,
      objects[component].map((object) => ({ m: object.m, visible: object.visible })),
    ]));
  }
  if (pageSide.scene.unresolved > 0) {
    extra['哪个库都不认的对象'] = {
      [`共 ${pageSide.scene.unresolved} 个`]: Array.from({ length: pageSide.scene.unresolved }, () => ({ m: null, visible: true })),
    };
  }
  return { byRoot: sorted.byRoot, boxes: sorted.boxes, strays: sorted.strays, extra };
}

/** 拼 W3 的输入：场景（连同假根）对后端记录；库里已经没有的根，后端那边算收齐、名下什么都没有 */
export function sceneTruth(sceneSide, backendSide, rootIds) {
  const backend = {};
  for (const root of rootIds) backend[root] = backendSide.exists?.[root] === false ? NOTHING : backendSide.roots[root];
  for (const name of Object.keys(sceneSide.extra)) backend[name] = NOTHING;
  return {
    roots: [...rootIds, ...Object.keys(sceneSide.extra)],
    scene: { ...sceneSide.byRoot, ...sceneSide.extra },
    backend,
  };
}

/** 采样记录压成每一行的变化过程：行 → 变了的那几笔（`atMs` 从存盘完成算起，负的是存盘之前）。给报告看的 */
export function rowTimeline(samples, startAt) {
  const out = {};
  const last = {};
  for (const sample of samples) {
    for (const [id, row] of Object.entries(sample.rows)) {
      const brief = row.present === false
        ? { present: false }
        : {
          present: true,
          action: row.action ?? null,
          nodeStatus: row.nodeStatus ?? null,
          pending: row.pending === true,
          eyeLit: row.eyeLit === true,
        };
      const key = JSON.stringify(brief);
      if (last[id] === key) continue;
      last[id] = key;
      (out[id] ??= []).push({ atMs: sample.t - startAt, ...brief });
    }
  }
  return out;
}

/**
 * 跑一条腿。
 *
 * @param {object} ctx 这一场页面会话
 * @param {import('playwright').Page} ctx.page
 * @param {object} ctx.log `createGuardedContext` 的记录
 * @param {object} ctx.backend `createBackend` 的结果
 * @param {{ refno: string, dbnum: number }[]} ctx.roots 页面上装着的根（行都盯着）
 * @param {Record<string, object>} ctx.rootFacts 各根的事实（怎么装的、重载过几次……），跑完这条腿会跟着更新
 * @param {number} [ctx.sceneToMm]
 * @param {{ pattern: string, reason: string }[]} [ctx.ignoreErrors] W6 明说不算的报错
 * @param {object[]} [ctx.knownGaps] 缺省用登记在册的那份
 * @param {object} leg
 * @param {string} leg.id
 * @param {string} [leg.title]
 * @param {() => Promise<{ savedAt?: number } | void>} leg.save 存盘；库文件写完才算完。回的 `savedAt` 是存盘完成的时刻，
 *   没给就取它返回的时刻
 * @param {{ dbnum: number, to?: number }[]} [leg.libraries] 这次存盘写到的库：等它们的后端水位跟上（`to` 是存到的会话；
 *   不知道就不写，等库文件比存盘前新、三枚水位齐平）
 * @param {Record<string, { nodeStatus?: string[], action?: string[] }>} [leg.affected] W1：受影响的根 → 行上该出现什么
 * @param {string[]} [leg.unaffected] W1：不受影响的根
 * @param {string[]} [leg.controls] W5：用例之外、装着作对照的根
 * @param {string[]} [leg.judge] 判哪几个看点，缺省 W1 W2 W3 W5 W6；不判 W1 时不等行上的信号，行的变化过程照样记
 * @param {{ base: object, mode?: 'identical' | 'rebuild', rebuiltCount?: number }} [leg.restore] 这是还原的腿：`base` 是
 *   对应的 apply 腿的结果，W7 拿它存盘之前的样子比
 * @param {object} [leg.receipt] 回执里后端的差算不出来、要用例自己说的几项：`kept`、`loadedNew`、`libraries`、`backendRestarted`
 * @param {number} [leg.from] W6 从什么时刻算起，缺省从这条腿开始
 * @param {number} [leg.windowMs] W1 的时限
 * @param {number} [leg.settleMs] 后端跟上之后再采多久才点「取最新」
 * @param {boolean} [leg.allowEmptyScene] 这条腿之后场景里本来就该什么都没有
 * @param {() => Promise<void>} [leg.beforeClick] 点「取最新」之前要做的事（比如截一张图）；行的采样这时已经停了
 */
export async function runLeg(ctx, leg) {
  const { page, log, backend } = ctx;
  const judged = new Set(leg.judge ?? ['W1', 'W2', 'W3', 'W5', 'W6']);
  const options = ctx.knownGaps ? { knownGaps: ctx.knownGaps } : {};
  const windowMs = leg.windowMs ?? SIGNAL_WINDOW_MS;
  const catchUpMs = leg.catchUpMs ?? CATCH_UP_MS;
  const rootIds = ctx.roots.map((root) => refnoKey(root.refno));
  const rootFacts = structuredClone(ctx.rootFacts ?? {});
  const times = { from: leg.from ?? Date.now() };
  const notes = [];

  // 存盘之前
  await waitIdle(page);
  const arrangedBefore = await arrangeRows(page, log, rootIds);
  const pageBefore = await observePage(ctx);
  const layerIds = fetchedLayers(pageBefore.tree);
  const backendBefore = await observeBackend(backend, rootIds, layerIds);
  const sceneBefore = sceneForJudging(pageBefore, backendBefore);
  const settledBefore = await readSettledRows(page, rootIds);
  if (!settledBefore.settled) notes.push(`存盘之前这几行还没定下来：${settledBefore.unsettled.join('、')}`);
  const rowsBefore = settledBefore.rows;
  await startRowWatch(page, rootIds, { intervalMs: leg.sampleMs ?? 250 });

  // 存盘
  times.saveStartedAt = Date.now();
  const saved = (await leg.save()) ?? {};
  const startAt = saved.savedAt ?? Date.now();
  times.startAt = startAt;

  // 不碰页面，等行上的信号
  let signal = null;
  if (judged.has('W1')) {
    signal = await waitRowSignal(page, { affected: leg.affected ?? {}, startAt, windowMs, settleMs: 0, quietMs: leg.quietMs ?? 30_000 });
  }

  // 等后端跟上（只问后端，不碰页面）
  const caughtUp = {};
  for (const library of leg.libraries ?? []) {
    const target = library.to === undefined ? { above: backendBefore.libraries[library.dbnum]?.file ?? 0 } : { to: library.to };
    const result = await backend.waitCaughtUp(library.dbnum, { ...target, since: startAt, timeoutMs: catchUpMs });
    caughtUp[library.dbnum] = result;
    if (!result.ok) {
      await stopRowWatch(page);
      throw new Error(`库 ${library.dbnum} 的后端 ${Math.round(catchUpMs / 1000)} 秒没跟上：${JSON.stringify(result.library)}`);
    }
  }
  await sleep(leg.settleMs ?? SETTLE_MS);
  const watch = await stopRowWatch(page);
  if (!watch) throw new Error('行的采样在页面里断了（页面重新载入过？）');
  times.watchStoppedAt = watch.stoppedAt;

  // 按后端在存盘前后的差算回执的预期
  const backendAfter = await observeBackend(backend, rootIds, layerIds);
  const models = expectedModels({ roots: rootIds, before: backendBefore.roots, after: backendAfter.roots, exists: backendAfter.exists });
  const tree = await expectedTree({ before: backendBefore.layers, after: backendAfter.layers, existsAfter: (id) => backend.exists(id) });
  const libraryIds = [...new Set([...Object.keys(backendBefore.libraries), ...Object.keys(backendAfter.libraries)])].map(Number);
  const movedLibraries = libraryIds.filter((dbnum) => (
    (backendBefore.libraries[dbnum]?.model ?? null) !== (backendAfter.libraries[dbnum]?.model ?? null)
  ));
  const extras = leg.receipt ?? {};
  const expected = {
    tree,
    reload: models.reload,
    withdrawn: models.withdrawn,
    kept: extras.kept ?? [],
    loadedNew: extras.loadedNew ?? [],
    componentsAdded: models.componentsAdded,
    componentsRemoved: models.componentsRemoved,
    movedLibraries,
    libraries: extras.libraries ?? [],
    backendRestarted: extras.backendRestarted === true,
  };

  // 点一次「取最新」
  if (leg.beforeClick) await leg.beforeClick();
  const click = await clickGetWork(page, log, leg.getWorkMs);
  times.clickedAt = click.clickedAt;
  const receipt = click.receipt;

  // 取最新之后
  const withdrawn = new Set((receipt?.models?.withdrawn ?? []).map((item) => refnoKey(item.refno)));
  const arrangedAfter = await arrangeRows(page, log, rootIds, { allowMissing: true });
  const settledAfter = await readSettledRows(page, rootIds, { loaded: rootIds.filter((id) => !withdrawn.has(id)) });
  if (!settledAfter.settled) notes.push(`取最新之后这几行还没定下来：${settledAfter.unsettled.join('、')}`);
  const rowsAfter = settledAfter.rows;
  const pageAfter = await observePage(ctx);
  const sceneAfter = sceneForJudging(pageAfter, backendAfter);
  const librariesAtEnd = await backend.libraries();
  if (JSON.stringify(librariesAtEnd) !== JSON.stringify(backendAfter.libraries)) {
    notes.push('点取最新的这一会儿后端的库水位又动了：预期是按点之前的样子算的');
  }
  times.to = Date.now();

  // 判
  const judgements = {};
  if (judged.has('W1')) {
    judgements.W1 = judgeW1({
      startAt,
      windowMs,
      baseline: rowsBefore,
      samples: watch.samples,
      affected: leg.affected ?? {},
      unaffected: leg.unaffected ?? [],
      interactions: log.interactions,
    });
  }
  if (judged.has('W2')) judgements.W2 = judgeW2({ receipt, clicks: 1, roots: rootFacts, expected }, options);
  if (judged.has('W3')) {
    judgements.W3 = judgeW3({ ...sceneTruth(sceneAfter, backendAfter, rootIds), allowEmpty: leg.allowEmptyScene === true });
  }
  if (judged.has('W5')) {
    judgements.W5 = judgeW5({
      controlRoots: leg.controls ?? [],
      receipt,
      roots: rootFacts,
      expected: { movedLibraries, tree },
      sceneBefore: sceneBefore.byRoot,
      sceneAfter: sceneAfter.byRoot,
      treeBefore: pageBefore.tree,
      treeAfter: pageAfter.tree,
      rowsBefore,
      rowsAfter,
    }, options);
  }
  if (judged.has('W6')) {
    judgements.W6 = judgeW6(cleanlinessInput(log, { from: times.from, to: times.to, ignoreErrors: ctx.ignoreErrors ?? [] }));
  }
  if (leg.restore) {
    const base = leg.restore.base;
    judgements.W7 = judgeW7({
      mode: leg.restore.mode ?? 'identical',
      roots: base.rootIds,
      treeBefore: base.before.page.tree,
      treeAfter: pageAfter.tree,
      sceneBefore: base.before.scene.byRoot,
      sceneAfter: sceneAfter.byRoot,
      rebuiltCount: leg.restore.rebuiltCount,
      rowsBefore: base.before.rows,
      rowsAfter,
      loadedTableAfter: pageAfter.state.loadedTable.filter((entry) => entry.loaded).map((entry) => entry.refno),
      rootsInfo: rootFacts,
    }, options);
  }

  // 各根的事实跟着这条腿往前走（上面判的时候用的是这条腿之前的）
  for (const item of receipt?.models?.reloaded ?? []) {
    const facts = ctx.rootFacts?.[refnoKey(item.refno)];
    if (facts) facts.reloadsBefore = (facts.reloadsBefore ?? 0) + 1;
  }
  for (const id of withdrawn) {
    const facts = ctx.rootFacts?.[id];
    if (facts) facts.withdrawnVia = 'getwork';
  }

  return {
    id: leg.id,
    title: leg.title ?? '',
    rootIds,
    rootFacts,
    times,
    saved,
    arranged: { before: arrangedBefore, after: arrangedAfter },
    signal,
    caughtUp,
    watch,
    timeline: rowTimeline(watch.samples, startAt),
    before: { rows: rowsBefore, page: pageBefore, backend: backendBefore, scene: sceneBefore },
    expected: { ...expected, unchanged: models.unchanged, detail: models.detail },
    click: { clickedAt: click.clickedAt, ms: click.ms },
    receipt,
    after: { rows: rowsAfter, page: pageAfter, backend: backendAfter, scene: sceneAfter, librariesAtEnd },
    judgements,
    summary: summarize(Object.values(judgements)),
    requests: requestSummary(log, { from: times.from, to: times.to }),
    notes,
  };
}
