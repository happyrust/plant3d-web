/**
 * 一条腿的流程：存盘之前记一遍（页面的行、场景、树，后端的记录、水位、层）→ 把要看的行摆好、开始采样 → 存盘 →
 * 不碰页面，等行上的信号 → 等后端跟上 → 按后端前后的差算回执的预期 → 点一次「取最新」→ 再记一遍 → 判 W1–W3、W5、W6
 * （还原的腿再判 W7；重建类的还原在判 W7 之前先把建回来的行展开，见 `openRebuiltLayers`）。
 *
 * 存盘这一步由调用方给（在 E3D 里跑宏，或者回放一个录好的会话），其余各腿走同一份代码。W4（场景 = E3D）要 E3D 的导出，不在这里。
 *
 * 手动路径（`leg.manual`，后端不自动跟库）中间多一段：行上出的是「更新」→ 点它，让后端去跟库 → 后端追上、行上出「重载」→
 * 再照常点一次「取最新」。见 `runManualUpdate`。
 */
import { expectedModels, expectedTree, sleep } from './backend.mjs';
import {
  judgeW1,
  judgeW2,
  judgeW3,
  judgeW5,
  judgeW6,
  judgeW7,
  rebuiltLayersToOpen,
  refnoKey,
  SIGNAL_WINDOW_MS,
  summarize,
} from './judge.mjs';
import {
  arrangeRows,
  cleanlinessInput,
  clickGetWork,
  clickRowUpdate,
  expandTree,
  fetchedLayers,
  layerCounts,
  readPageState,
  readScene,
  readSettledRows,
  readTree,
  readUpdateState,
  requestSummary,
  sceneByRoot,
  startRowWatch,
  stopRowWatch,
  waitIdle,
  waitRowSignal,
} from './page.mjs';

const CATCH_UP_MS = 240_000;
const SETTLE_MS = 5000;
/** 重建类还原比树之前最多往下展开几层 */
const REBUILT_OPEN_ROUNDS = 8;
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

/**
 * 重建类的还原比树之前：删了再建出来的节点在页面的树上是新的一行，成员那一层页面还没取过。apply 之前展开着的那几行
 * 对应到现在的新行，由脚本逐层展开（一层展开了才看得到下一层），回来的是展开之后的树和展开过的行。
 * 展开了还是取不到成员的行不再重试，留给 W7 照实判。
 */
export async function openRebuiltLayers(ctx, treeBefore, treeAfter) {
  const opened = [];
  let tree = treeAfter;
  for (let round = 0; round < REBUILT_OPEN_ROUNDS; round++) {
    const ids = rebuiltLayersToOpen(treeBefore, tree).filter((id) => !opened.includes(id));
    if (ids.length === 0) break;
    await expandTree(ctx.page, ctx.log, ids);
    opened.push(...ids);
    tree = await readTree(ctx.page);
  }
  return { tree, opened };
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
          // 按钮忙着（手动路径里点了「更新」之后的「更新中」）：只在忙的时候多这一格
          ...(row.busy === true ? { busy: true } : {}),
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

const levelsOf = (row) => (row ? { file: row.file, applied: row.applied, model: row.model } : null);

/**
 * 手动路径（后端不自动跟库）里，行上的信号等完之后、点「取最新」之前的那一段：记下后端这时的水位（该还停在存盘之前）→
 * 点行上的「更新」→ 等后端追上 → 等受影响的行出「重载」。这一段另开一段行的采样（存盘之后的那一段调用方已经停了，W1 只看那一段）。
 * 哪一步没走通就停在哪一步、照实记下来，不抛错：这条腿接着往下走（照样点「取最新」、照样判），没走通的那一步由 W2 报出来。
 */
async function runManualUpdate(ctx, leg, { rootIds, backendBefore, windowMs, catchUpMs }) {
  const { page, log, backend } = ctx;
  const spec = leg.manual;
  const dbnum = Number(spec.dbnum);
  const out = {
    dbnum,
    row: refnoKey(spec.row),
    wantAfter: Object.fromEntries(Object.keys(leg.affected ?? {}).map((root) => [refnoKey(root), spec.then])),
    libraryBefore: levelsOf(backendBefore.libraries[dbnum]),
    libraryAtClick: levelsOf((await backend.libraries())[dbnum]),
    update: null,
    caughtUp: null,
    signal: null,
    pageState: null,
    rowsAfter: {},
    watch: null,
  };
  if (spec.beforeUpdate) await spec.beforeUpdate();
  await startRowWatch(page, rootIds, { intervalMs: leg.sampleMs ?? 250 });
  out.update = await clickRowUpdate(page, log, spec.row, { dbnum });
  if (out.update.request?.accepted === true) {
    const clickedAt = out.update.clickedAt;
    const target = (leg.libraries ?? []).find((library) => Number(library.dbnum) === dbnum);
    const goal = target?.to === undefined ? { above: out.libraryBefore?.file ?? 0 } : { to: target.to };
    const caught = await backend.waitCaughtUp(dbnum, { ...goal, since: clickedAt, timeoutMs: catchUpMs });
    out.caughtUp = { ...caught, waitedMs: Date.now() - clickedAt };
    if (caught.ok) {
      out.signal = await waitRowSignal(page, { affected: out.wantAfter, startAt: clickedAt, windowMs: Date.now() - clickedAt + windowMs, settleMs: 0 });
    }
    await sleep(leg.settleMs ?? SETTLE_MS);
  }
  out.pageState = await readUpdateState(page, dbnum).catch(() => null);
  out.watch = await stopRowWatch(page);
  if (!out.watch) throw new Error('行的采样在页面里断了（页面重新载入过？）');
  out.rowsAfter = out.watch.samples.at(-1)?.rows ?? {};
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
 * @param {object} [leg.manual] 手动路径：后端不自动跟库，点「取最新」之前先点行上的「更新」。这时 `leg.affected` 写的是存盘之后
 *   行上该出的信号（「更新」），W1 只看到点「更新」之前；不判 W1 也照样等这个信号
 * @param {number} leg.manual.dbnum 点的是哪个库的「更新」
 * @param {string} leg.manual.row 点哪一行上的
 * @param {{ nodeStatus?: string[], action?: string[] }} leg.manual.then 后端追上之后，受影响的行上该出什么（「重载」）
 * @param {() => Promise<void>} [leg.manual.beforeUpdate] 点「更新」之前要做的事（比如截一张图）
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
  // 树的预期是按这几层在后端前后的差算的：脚本认出的层要是比页面取过的少，预期就会漏（页面照样重取那几层），这时不存盘
  const layersBefore = await layerCounts(page, pageBefore.tree);
  if (!layersBefore.ok) {
    throw new Error(`存盘之前页面记的取过成员的层 ${layersBefore.pageLoadedLayers}，脚本认出的参考号层 ${layersBefore.refnoLayers}，`
      + `最上面不是参考号的层 ${layersBefore.topLayers}：对不上，树的预期算不准`);
  }
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
  if (judged.has('W1') || leg.manual) {
    signal = await waitRowSignal(page, { affected: leg.affected ?? {}, startAt, windowMs, settleMs: 0, quietMs: leg.quietMs ?? 30_000 });
  }

  const caughtUp = {};
  let watch;
  let manual = null;
  let sceneAtGetWork = null;
  if (leg.manual) {
    // 手动路径：后端不会自己跟。存盘之后的这一段采样到此为止（W1 看的就是它），然后点行上的「更新」、等后端追上
    await sleep(leg.settleMs ?? SETTLE_MS);
    watch = await stopRowWatch(page);
    if (!watch) throw new Error('行的采样在页面里断了（页面重新载入过？）');
    times.watchStoppedAt = watch.stoppedAt;
    manual = await runManualUpdate(ctx, leg, { rootIds, backendBefore, windowMs, catchUpMs });
    times.updateClickedAt = manual.update.clickedAt;
    times.updateWatchStoppedAt = manual.watch.stoppedAt;
    if (manual.caughtUp) caughtUp[manual.dbnum] = manual.caughtUp;
    // 还没点「取最新」：场景该和存盘之前一样（按存盘之前后端的记录分根，和存盘之前那一份同一个分法）
    sceneAtGetWork = sceneForJudging(await observePage(ctx), backendBefore).byRoot;
  } else {
    // 等后端跟上（只问后端，不碰页面）
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
    watch = await stopRowWatch(page);
    if (!watch) throw new Error('行的采样在页面里断了（页面重新载入过？）');
    times.watchStoppedAt = watch.stoppedAt;
  }

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
  // 重建类的还原：比树之前先把建回来的行展开。展开之后的树只给 W7 用——W2、W5 看的是点完取最新那一刻的树，
  // 这里新取的行不算进去；W6 的时段把这几次展开也盖住
  let restoreTree = null;
  if (leg.restore?.mode === 'rebuild') {
    restoreTree = await openRebuiltLayers(ctx, leg.restore.base.before.page.tree, pageAfter.tree);
    if (restoreTree.opened.length > 0) {
      notes.push(`重建类的还原：建回来的节点在树上是新的一行、收着，比树之前由脚本展开了 ${restoreTree.opened.length} 行（${restoreTree.opened.join('、')}）`);
    }
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
  if (judged.has('W2')) {
    const first = manual ? {
      dbnum: manual.dbnum,
      row: manual.row,
      libraryBefore: manual.libraryBefore,
      libraryAtClick: manual.libraryAtClick,
      offered: manual.update.offered,
      rowAtClick: manual.update.rowAtClick,
      clicked: manual.update.clicked,
      clickError: manual.update.error ?? undefined,
      confirmed: manual.update.confirmed,
      request: manual.update.request,
      caughtUp: manual.caughtUp ? { ok: manual.caughtUp.ok, waitedMs: manual.caughtUp.waitedMs, library: levelsOf(manual.caughtUp.library) } : null,
      rowsAfter: manual.rowsAfter,
      wantAfter: manual.wantAfter,
      signalSeen: manual.signal?.seen === true,
      sceneRoots: rootIds,
      sceneBefore: sceneBefore.byRoot,
      sceneAtGetWork,
    } : undefined;
    judgements.W2 = judgeW2({ receipt, clicks: 1, roots: rootFacts, expected, manual: first }, options);
  }
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
      treeAfter: restoreTree ? restoreTree.tree : pageAfter.tree,
      sceneBefore: base.before.scene.byRoot,
      sceneAfter: sceneAfter.byRoot,
      rebuiltCount: leg.restore.rebuiltCount,
      openedForCompare: restoreTree ? restoreTree.opened : undefined,
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
    // 手动路径：点「更新」之后的那一段采样接在后面，行的变化过程是连着的一条
    timeline: rowTimeline(manual ? [...watch.samples, ...manual.watch.samples] : watch.samples, startAt),
    ...(manual ? { manual } : {}),
    before: { rows: rowsBefore, page: pageBefore, backend: backendBefore, scene: sceneBefore, layers: layersBefore },
    expected: { ...expected, unchanged: models.unchanged, detail: models.detail },
    click: { clickedAt: click.clickedAt, ms: click.ms },
    receipt,
    after: {
      rows: rowsAfter,
      page: pageAfter,
      backend: backendAfter,
      scene: sceneAfter,
      librariesAtEnd,
      // 重建类的还原：W7 比的是这份展开之后的树（`page.tree` 是展开之前的）
      ...(restoreTree ? { restoreTree } : {}),
    },
    judgements,
    summary: summarize(Object.values(judgements)),
    requests: requestSummary(log, { from: times.from, to: times.to }),
    notes,
  };
}
