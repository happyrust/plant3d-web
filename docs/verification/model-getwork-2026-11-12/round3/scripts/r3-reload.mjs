/**
 * 第三轮：原有的「重载」在真实后端上的三件事 + 给模型加载那条线的慢查询数据。
 *
 * 沙箱这一轮的摆法：后端**只监听 8000**（空库起）；7998 从没初始化过、不在后端更新范围里，模型只能按需生成、只在后端内存里。
 * 8000 从会话 1684 起，脚本往后推到 1698。
 *
 *   node r3-reload.mjs --phase=before|after     （两次跑的是同一份脚本；before 是改之前的代码，after 是最终代码）
 *
 * 甲（页面一，装着 ZONE Z 和 Z2）——一次重载几个节点时的次序：
 *   A1  会话 1685–1686（PIPE 从 Z 挪到 Z2）之后，派发「重新部署后的重装 / 状态栏重载」用的那个事件，次序 [Z2, Z]：得到管道的先重载。
 *   A2  会话 1687–1689（PIPE 挪回 Z）之后，次序 [Z, Z2]。
 *   A3  会话 1690–1692（设备 EQ-CP 从 Z 挪到 Z2）之后，等两行都出「重载」，先点 Z2 那一行、再点 Z 那一行；然后点一次「取最新」。
 *   A4  会话 1693–1695（EQ-CP 挪回 Z）之后，次序反过来当对照：先点失去设备的 Z2，再点 Z。
 * 乙（三个页面，各自单独装着两台设备 EQ-RN、EQ-CASE）——会话 1696–1698（BOX 从 EQ-CASE 挪到 EQ-RN）之后：
 *   B1  真的去点状态栏提示上的「重载」（次序由批次的回执定）；点之前量底部提示条盖不盖得住「重载」「忽略」。
 *   B2  派发同一个事件，次序 [EQ-RN, EQ-CASE]（得到 BOX 的先重载）。
 *   B3  次序 [EQ-CASE, EQ-RN]（对照）。
 * 丙  直接向沙箱后端量 node/versions（已加载节点表在后台问的那条查询）的耗时。
 * 丁（页面，7998 的 ZONE）——后端重启后的「重载」：
 *   D0  点眼睛装 7998 的 ZONE（沙箱后端按需生成 1 个单元）。
 *   D1  重起沙箱后端（按需生成的模型没了，记录查空且收齐），派发原有「重载」的那个事件。
 *   D2  再点一次「取最新」。
 *
 * 护栏照旧：页面发往 8022 / 8009 的一律拦下并记账；发往沙箱后端的只放行 GET 和三种只读 POST——
 * 只有 D0 那一步临时多放行 `POST /api/v1/model/generate`（发给沙箱后端，生成的是沙箱里的一个小节点）。
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { chromium } from '@playwright/test';

import {
  BACKEND, BOX_CASE, EQ_CASE, EQ_CP, EQ_RN, HERE, OUT, PIPE, SITE, TMP, X_BOX, X_EQUI, X_ZONE, Z, Z2,
  backendFetch, backendNodeStatus, backendRecords, backendRow, clickEye, clickGetWork, compareScene, createGuardedContext, dispatchReload,
  expandTree, locateRow, makeChecks, newPage, openApp, overlayVersusStatusBar, readPage, replayStep, resizeAndSettle, rowBrief, saveJson, showProbeToast,
  sleep, snapshotBackend, stamp, takeReplayLock, taskFor, v1, waitCaughtUp, waitIdle, waitRootLoaded,
} from './r3-lib.mjs';

const args = process.argv.slice(2);
const phase = args.find((arg) => arg.startsWith('--phase='))?.slice('--phase='.length) ?? 'after';
const only = args.find((arg) => arg.startsWith('--only='))?.slice('--only='.length).split(',') ?? null;
const wants = (part) => !only || only.includes(part);

takeReplayLock();
const { checks, check } = makeChecks();
const results = { phase, startedAt: new Date().toISOString(), parts: {} };

const browser = await chromium.launch({
  channel: 'chrome',
  headless: process.env.PAGE_HEADED !== '1',
  args: ['--disable-renderer-backgrounding', '--disable-background-timer-throttling', `--disk-cache-dir=${path.join(TMP, 'chrome-cache')}`],
});
const guards = [];

async function openGuarded(name, options) {
  const { context, log } = await createGuardedContext(browser, options);
  const { page, events } = await newPage(context, log);
  guards.push({ name, log, events });
  return { context, page, log, events };
}

const toastsSince = (state, at) => state.toasts.filter((item) => item.at >= at).map((item) => `[${item.level}] ${item.message}`);

async function waitNotice(page, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const text = await page.evaluate(() => document.querySelector('[data-testid="gen-model-v1-update-notice-text"]')?.textContent?.replace(/\s+/g, ' ').trim() ?? null);
    if (text) return text;
    await sleep(250);
  }
  return null;
}

/** 推一步、等后端三枚水位齐、再让推送和提示有时间到 */
async function pushAndSettle(id, dbnum, to) {
  const replay = replayStep(dbnum, to);
  const caughtUp = await waitCaughtUp(dbnum, to, replay.at, 300_000);
  check(id, `后端批次追上：库 ${dbnum} 三枚水位都到 ${to}`, caughtUp.ok, `数据 ${caughtUp.appliedMs} ms，模型 ${caughtUp.modelMs} ms`);
  await sleep(1_500);
  return { replay, caughtUp, task: await taskFor(dbnum, to) };
}

function compareAndCheck(id, name, state, backend, roots) {
  const scene = compareScene(state, backend, roots);
  check(id, `${name}（${scene.matricesCompared} 个实例矩阵逐个对；场景里不许缺、不许多）`, scene.mismatches.length === 0, scene.mismatches.slice(0, 4).join('；'));
  return scene;
}

try {
  const health = (await backendFetch('/api/v1/health')).body;
  results.backendHealth = { build_id: health.build_id, started_at: health.started_at, watch_dbnums: health.watch_dbnums, sul_db: health.sul_db?.endpoint };
  if (health.sul_db?.endpoint !== '127.0.0.1:8199') throw new Error(`这台后端连的不是沙箱库：${health.sul_db?.endpoint}`);
  const rows0 = { 8000: rowBrief(await backendRow(8000)), 7998: rowBrief(await backendRow(7998)) };
  results.rowsAtStart = rows0;
  console.log(`[${stamp()}] 沙箱后端 ${health.build_id}，监听 ${JSON.stringify(health.watch_dbnums)}；8000 ${JSON.stringify(rows0[8000])}；7998 ${JSON.stringify(rows0[7998])}`);
  check('摆法', '后端只监听 8000；7998 没初始化过、不在后端更新范围里', JSON.stringify(health.watch_dbnums) === '[8000]' && rows0[7998]?.initialized !== true && rows0[7998]?.excluded === true, JSON.stringify(rows0[7998]));

  // ================================================================ 甲：一次重载几个节点时的次序
  if (wants('A')) {
    const roots = [{ refno: Z, dbnum: 8000 }, { refno: Z2, dbnum: 8000 }];
    const part = (results.parts.A = { steps: {} });
    const { context, page, log } = await openGuarded('甲', {});
    try {
      await openApp(page);
      await expandTree(page, [SITE]);
      await clickEye(page, Z);
      await waitRootLoaded(page, roots[0]);
      await clickEye(page, Z2);
      await waitRootLoaded(page, roots[1]);
      await sleep(800);
      compareAndCheck('甲·基线', '装着 Z、Z2：三维和后端对上', await readPage(page, roots), await snapshotBackend(roots), roots);

      // ---- A1 / A2：一次事件重载两个节点
      for (const step of [
        { id: 'A1', to: 1686, order: [Z2, Z], what: 'PIPE 从 Z 挪到 Z2；次序 [Z2, Z]（得到管道的先重载）' },
        { id: 'A2', to: 1689, order: [Z, Z2], what: 'PIPE 挪回 Z；次序 [Z, Z2]（得到管道的先重载）' },
      ]) {
        console.log(`[${stamp()}] ${step.id}：${step.what}`);
        const pushed = await pushAndSettle(step.id, 8000, step.to);
        const before = await readPage(page, roots);
        const at = Date.now();
        const done = await dispatchReload(page, step.order);
        await waitIdle(page);
        await sleep(600);
        const after = await readPage(page, roots);
        const scene = compareAndCheck(step.id, `一次重载两个节点（${step.what}）之后三维和后端对上`, after, await snapshotBackend(roots), roots);
        part.steps[step.id] = {
          what: step.what, caughtUp: pushed.caughtUp, noticeBefore: before.dom.updateNotice, done,
          membersAfter: after.roots.map((item) => `${item.refno}:${item.members?.length ?? '—'}`), sceneObjectsBefore: before.sceneObjects, sceneObjectsAfter: after.sceneObjects,
          toasts: toastsSince(after, at), mismatches: scene.mismatches,
        };
      }

      // ---- A3 / A4：行上逐个点「重载」
      const waitRowsReload = async (since) => {
        const startedAt = Date.now();
        for (;;) {
          const state = await readPage(page, roots);
          if (roots.every((root) => state.rowButtons[root.refno]?.action === 'reload')) return { ms: Date.now() - since, state };
          if (Date.now() - startedAt > 360_000) return { ms: null, state };
          await sleep(1_000);
        }
      };
      const clickRowReload = async (refno) => {
        const row = await locateRow(page, refno);
        await row.locator('[data-testid="model-tree-node-action"][data-action="reload"]').click();
        await sleep(300);
        await waitIdle(page);
        await sleep(500);
      };
      for (const step of [
        { id: 'A3', to: 1692, order: [Z2, Z], what: '设备 EQ-CP 从 Z 挪到 Z2；先点 Z2 那一行的「重载」（得到设备的），再点 Z 那一行', getWorkAfter: true },
        { id: 'A4', to: 1695, order: [Z2, Z], what: 'EQ-CP 挪回 Z；先点 Z2 那一行（这回是失去设备的），再点 Z 那一行——次序反过来的对照' },
      ]) {
        console.log(`[${stamp()}] ${step.id}：${step.what}`);
        const pushed = await pushAndSettle(step.id, 8000, step.to);
        await expandTree(page, [SITE]);
        const waited = await waitRowsReload(pushed.replay.at);
        const versions = log.timings.filter((item) => item.at >= pushed.replay.at && item.path === '/api/v1/node/versions');
        check(step.id, '两行都出了「重载」', waited.ms !== null, `文件写完后 ${waited.ms} ms；行上：${JSON.stringify(waited.state.rowButtons)}`);
        const record = (part.steps[step.id] = {
          what: step.what, caughtUp: pushed.caughtUp, rowsShowedReloadAfterMs: waited.ms, noticeBefore: waited.state.dom.updateNotice,
          nodeVersions: versions.map((item) => ({ ms: item.ms, outcome: item.outcome, query: item.query })),
        });
        if (waited.ms === null) continue;
        const at = Date.now();
        for (const refno of step.order) await clickRowReload(refno);
        await sleep(1_500);
        const after = await readPage(page, roots);
        const scene = compareScene(after, await snapshotBackend(roots), roots);
        Object.assign(record, {
          toasts: toastsSince(after, at), mismatchesAfterRowClicks: scene.mismatches, rowButtonsAfter: after.rowButtons,
          loadedTableAfter: after.loadedTable.map((entry) => `${entry.refno}@${entry.modelSesno}${entry.staleReason ? `（记了一笔：${entry.staleReason}）` : ''}`),
          sceneObjectsAfter: after.sceneObjects,
        });
        if (step.getWorkAfter) {
          // 两次各自独立的重载：后点的那个不知道先点的刚装过什么，它照旧撤。要看的是——屏幕上要是因此缺了构件，
          // 缺的那个节点有没有被记一笔（行上又给「重载」），再点一次「取最新」能不能补回来
          const flagged = after.loadedTable.filter((entry) => entry.staleReason);
          const holes = scene.mismatches.length;
          check(step.id, '两行点完：屏幕上没缺构件；或者缺了、而缺构件的那个节点被记了一笔，行上又给了「重载」',
            holes === 0 || (flagged.some((entry) => entry.refno === step.order[0]) && after.rowButtons[step.order[0]]?.action === 'reload'),
            `和后端对不上的 ${holes} 处：${scene.mismatches.slice(0, 2).join('；') || '无'}｜记了一笔的：${flagged.map((entry) => `${entry.refno}（${entry.staleReason}）`).join('；') || '无'}｜行上：${JSON.stringify(after.rowButtons)}`);
        } else {
          check(step.id, `行上逐个点「重载」（${step.what}）之后三维和后端对上（${scene.matricesCompared} 个实例矩阵逐个对）`, scene.mismatches.length === 0, scene.mismatches.slice(0, 4).join('；'));
        }
        if (step.getWorkAfter) {
          const run = await clickGetWork(page);
          await waitIdle(page);
          await sleep(600);
          const healed = await readPage(page, roots);
          const sceneAfterGetWork = compareAndCheck(step.id, '再点一次「取最新」之后三维和后端对上', healed, await snapshotBackend(roots), roots);
          const during = healed.toasts.filter((item) => item.at >= run.clickedAt);
          record.getWork = { ms: run.ms, summary: healed.getWork.last?.summary ?? null, toasts: during.map((item) => item.message), mismatches: sceneAfterGetWork.mismatches };
          check(step.id, '取最新期间只弹了一条提示，就是最后那句交代', during.length === 1 && during[0].message === healed.getWork.last?.summary, JSON.stringify(during.map((item) => item.message.slice(0, 60))));
        }
      }
    } finally {
      await context.close();
    }
  }

  // ================================================================ 乙：状态栏提示上的「重载」，单元根之间挪构件
  if (wants('B')) {
    const roots = [{ refno: EQ_RN, dbnum: 8000 }, { refno: EQ_CASE, dbnum: 8000 }];
    const part = (results.parts.B = {});
    const pages = [];
    for (const name of ['B1', 'B2', 'B3']) {
      const opened = await openGuarded(`乙·${name}`, {});
      await openApp(opened.page);
      await expandTree(opened.page, [EQ_RN, EQ_CASE]);
      await clickEye(opened.page, EQ_RN);
      await waitRootLoaded(opened.page, roots[0]);
      await clickEye(opened.page, EQ_CASE);
      await waitRootLoaded(opened.page, roots[1]);
      await sleep(600);
      compareAndCheck(`${name}·基线`, '单独装着 EQ-RN、EQ-CASE：三维和后端对上', await readPage(opened.page, roots), await snapshotBackend(roots), roots);
      pages.push({ name, ...opened });
    }
    console.log(`[${stamp()}] 乙：会话 1696–1698，BOX /AIOS-SUITE-T3-BOX-CASE 从 EQ-CASE 挪到 EQ-RN`);
    const pushed = await pushAndSettle('乙', 8000, 1698);
    part.task = pushed.task;
    const backend = await snapshotBackend(roots);
    part.backendAfter = Object.fromEntries(roots.map((root) => [root.refno, backend.roots[root.refno].count]));

    // ---- B1：真的点提示上的「重载」
    {
      const { page } = pages[0];
      // 三个页面开在同一个浏览器里：不在前台的页面不排版（改了窗口宽度，停靠布局不跟着变），量之前先切到前台
      await page.bringToFront();
      const text = await waitNotice(page);
      const before = await readPage(page, roots);
      check('B1', '状态栏出了「数据已更新」的提示，带「重载」和「忽略」', !!text && before.dom.noticeHasReload && before.dom.noticeHasDismiss, `${text}｜重载名单 ${JSON.stringify(before.notice?.loadedRoots)}`);
      const overlay = {};
      const measure = async (label, shot) => {
        await showProbeToast(page);
        const o = (overlay[label] = await overlayVersusStatusBar(page));
        check('B1', `${label}：底部提示条正显示着，「重载」「忽略」「取最新」都点得到，提示条没有压在状态栏上`,
          o.snackbars.length > 0 && !o.snackbarOverStatusBar && o.reload.clickable === true && o.dismiss.clickable === true && o.getWork.clickable === true,
          `提示条 ${JSON.stringify(o.snackbars)} 状态栏 ${JSON.stringify(o.statusBar)} 重载 ${JSON.stringify(o.reload)} 忽略 ${JSON.stringify(o.dismiss)} 取最新 ${JSON.stringify(o.getWork)}`);
        if (shot) await page.screenshot({ path: path.join(OUT, shot) });
      };
      await measure('窗口宽 1600（普通菜单）', `r3-${phase}-toast-vs-status-bar-1600.png`);
      await resizeAndSettle(page, 1280, 800);
      await measure('窗口宽 1280（普通菜单）', `r3-${phase}-toast-vs-status-bar-1280.png`);
      await resizeAndSettle(page, 1600, 1000);
      // 另一种菜单栏（Ribbon）里的提示条是另一个组件实例：切过去再量一次，量完切回来
      const toRibbon = page.locator('button[title="切换到 Ribbon 菜单"]');
      if (await toRibbon.count()) {
        await toRibbon.first().click();
        await sleep(800);
        await measure('窗口宽 1600（Ribbon 菜单）', null);
        const back = page.locator('button[title="切换到普通菜单"]');
        if (await back.count()) { await back.first().click(); await sleep(800); }
      } else {
        check('B1', '切到 Ribbon 菜单再量一次', false, '页面上没找到「切换到 Ribbon 菜单」的按钮');
      }
      // 等验证用的提示条自己收起来（鼠标挪开，不停在它上面），再去点「重载」
      await page.mouse.move(800, 300);
      await page.waitForSelector('.v-snackbar__wrapper', { state: 'hidden', timeout: 20_000 }).catch(() => undefined);
      const at = Date.now();
      await page.click('[data-testid="gen-model-v1-update-notice-reload"]', { timeout: 15_000 });
      await sleep(400);
      await waitIdle(page);
      await sleep(700);
      const after = await readPage(page, roots);
      const scene = compareAndCheck('B1', `点提示上的「重载」（重载名单的次序 ${JSON.stringify(before.notice?.loadedRoots)}）之后三维和后端对上`, after, backend, roots);
      check('B1', 'BOX-CASE 在场景里（它现在在 EQ-RN 名下）', (after.scene[8000]?.[BOX_CASE]?.length ?? 0) === 1, `场景里 BOX-CASE 的对象 ${after.scene[8000]?.[BOX_CASE]?.length ?? 0} 个`);
      part.B1 = {
        notice: text, noticeTitle: before.dom.updateNoticeTitle, loadedRoots: before.notice?.loadedRoots ?? null, overlay,
        toasts: toastsSince(after, at), mismatches: scene.mismatches, registered: scene.registered, rowButtonsAfter: after.rowButtons,
      };
    }
    // ---- B2 / B3：同一个事件，次序由脚本给
    for (const [index, order, what] of [[1, [EQ_RN, EQ_CASE], '得到 BOX 的 EQ-RN 先重载'], [2, [EQ_CASE, EQ_RN], '失去 BOX 的 EQ-CASE 先重载（对照）']]) {
      const { name, page } = pages[index];
      await page.bringToFront();
      const at = Date.now();
      const done = await dispatchReload(page, order);
      await waitIdle(page);
      await sleep(700);
      const after = await readPage(page, roots);
      const scene = compareAndCheck(name, `一次重载两台设备（${what}）之后三维和后端对上`, after, backend, roots);
      check(name, 'BOX-CASE 在场景里（它现在在 EQ-RN 名下）', (after.scene[8000]?.[BOX_CASE]?.length ?? 0) === 1, `场景里 BOX-CASE 的对象 ${after.scene[8000]?.[BOX_CASE]?.length ?? 0} 个`);
      part[name] = { order, what, done, toasts: toastsSince(after, at), mismatches: scene.mismatches, registered: scene.registered };
    }
    for (const opened of pages) await opened.context.close();
  }

  // ================================================================ 丙：node/versions 的耗时（直接问沙箱后端）
  if (wants('C')) {
    const part = (results.parts.C = { library: rowBrief(await backendRow(8000)), calls: [] });
    const since = 1695;
    const timed = async (label, refno, scope, options = {}) => {
      const startedAt = Date.now();
      const controller = new AbortController();
      const timer = options.abortAfterMs ? setTimeout(() => controller.abort(), options.abortAfterMs) : null;
      let outcome;
      try {
        const response = await fetch(`${BACKEND}/api/v1/node/versions?dbnum=8000&refno=${encodeURIComponent(v1(refno))}&scope=${scope}&since_sesno=${since}`, { signal: controller.signal });
        const body = await response.json().catch(() => null);
        // 回执里除了版本表本身之外的格子（后端自己报的各段耗时就在这里面）原样留着
        const { versions, ...rest } = body && typeof body === 'object' ? body : {};
        const metaText = JSON.stringify(rest);
        outcome = { status: response.status, versions: Array.isArray(versions) ? versions.length : null, sesnos: Array.isArray(versions) ? versions.map((item) => item.sesno).slice(0, 12) : null, meta: metaText.length <= 4000 ? rest : `${metaText.slice(0, 4000)}…` };
      } catch (error) {
        outcome = { aborted: controller.signal.aborted, error: String(error?.message ?? error).slice(0, 120) };
      } finally {
        if (timer) clearTimeout(timer);
      }
      const record = { label, refno, scope, since, ms: Date.now() - startedAt, ...outcome };
      part.calls.push(record);
      console.log(`    ${label}：${record.ms} ms ${JSON.stringify(outcome).slice(0, 220)}`);
      return record;
    };
    // 沙箱后端这个进程累计用了多少处理器时间（毫秒）：看它在客户端取消之后是不是还在算
    const serverPid = JSON.parse(readFileSync(path.join(HERE, 'run', 'stack.json'), 'utf8')).server_pid;
    const cpuMs = () => {
      const run = spawnSync('pwsh', ['-NoProfile', '-Command', `[math]::Round((Get-Process -Id ${serverPid}).TotalProcessorTime.TotalMilliseconds)`], { encoding: 'utf8' });
      return Number(String(run.stdout).trim());
    };
    /** 等后端闲下来（刚关掉的页面留在后端的那几问算完）：连着两次、隔 3 秒，处理器时间几乎不涨 */
    const waitBackendIdle = async (label) => {
      const startedAt = Date.now();
      let last = cpuMs();
      let quiet = 0;
      while (Date.now() - startedAt < 180_000) {
        await sleep(3_000);
        const now = cpuMs();
        quiet = now - last < 200 ? quiet + 1 : 0;
        last = now;
        if (quiet >= 2) break;
      }
      const waited = Date.now() - startedAt;
      part.calls.push({ label: `（${label}：等后端闲下来 ${waited} ms）` });
      console.log(`    ${label}：等后端闲下来 ${waited} ms`);
    };
    console.log(`[${stamp()}] 丙：node/versions（8000 库此刻在会话 ${part.library?.model}；since_sesno=${since}；沙箱后端进程 ${serverPid}）`);
    part.serverPid = serverPid;
    await waitBackendIdle('开始之前');
    // ① 后端闲着的时候单独问一个节点
    {
      const cpu0 = cpuMs();
      const first = await timed('ZONE Z，库前进之后头一次问（scope=subtree），后端此刻没有别的事', Z, 'subtree');
      first.serverCpuMs = cpuMs() - cpu0;
      await timed('ZONE Z，紧接着再问一次', Z, 'subtree');
    }
    // ② 两个节点同时问（已加载节点表就是这么问的：同时最多两个）
    {
      const cpu0 = cpuMs();
      const pair = await Promise.all([
        timed('ZONE Z2 与 PIPE 同时问——ZONE Z2（scope=subtree）', Z2, 'subtree'),
        timed('ZONE Z2 与 PIPE 同时问——PIPE（scope=subtree）', PIPE, 'subtree'),
      ]);
      pair[0].serverCpuMsBoth = cpuMs() - cpu0;
    }
    // ③ 只问节点自己（scope=self）
    await timed('设备 EQ-CP，头一次问（scope=self）', EQ_CP, 'self');
    // ④ 客户端中途取消之后，后端还算不算、算完留不留
    {
      await waitBackendIdle('取消试验之前');
      const cpu0 = cpuMs();
      const aborted = await timed('SITE，头一次问——问到 2 秒客户端就取消', SITE, 'subtree', { abortAfterMs: 2_000 });
      const samples = [];
      const from = Date.now();
      for (const at of [3_000, 8_000, 13_000, 18_000, 23_000, 28_000, 38_000]) {
        await sleep(Math.max(0, at - (Date.now() - from)));
        samples.push({ afterAbortMs: Date.now() - from, serverCpuMsSinceStart: cpuMs() - cpu0 });
      }
      aborted.serverCpuAfterAbort = samples;
      console.log(`    取消之后后端进程累计的处理器时间：${samples.map((item) => `${Math.round(item.afterAbortMs / 1000)} 秒时 ${item.serverCpuMsSinceStart} ms`).join('，')}`);
      await timed('SITE，取消 38 秒之后再问（后端要是算完并留着，这一问应当立刻回）', SITE, 'subtree');
      await timed('SITE，再问一次', SITE, 'subtree');
    }
  }

  // ================================================================ 丁：后端重启后的「重载」
  if (wants('D')) {
    const roots = [{ refno: X_ZONE, dbnum: 7998 }];
    const part = (results.parts.D = {});
    let allowGenerate = false;
    const { context, page, log } = await openGuarded('丁', { allowExtraPost: () => (allowGenerate ? [/^\/api\/v1\/model\/generate$/] : []) });
    try {
      await openApp(page);
      await expandTree(page, [X_EQUI]);
      console.log(`[${stamp()}] D0：点眼睛装 7998 的 ZONE（沙箱后端按需生成）`);
      part.statusBefore = await backendNodeStatus(X_ZONE);
      allowGenerate = true;
      await clickEye(page, X_ZONE);
      await waitRootLoaded(page, roots[0], 240_000);
      await sleep(1_000);
      allowGenerate = false;
      const loaded = await readPage(page, roots);
      const recordsLoaded = await backendRecords(X_ZONE);
      part.D0 = {
        generatePosts: log.extraPost, statusAfterGenerate: await backendNodeStatus(X_ZONE), backendRecords: recordsLoaded.items.length,
        boxObjects: loaded.scene[7998]?.[X_BOX]?.length ?? 0, table: loaded.loadedTable.find((entry) => entry.refno === X_ZONE) ?? null,
        row7998: rowBrief(await backendRow(7998)),
      };
      check('D0', '7998 的 ZONE 装上了：后端按需生成了它的模型，场景里有那个 BOX', part.D0.boxObjects === 1 && recordsLoaded.items.length > 0,
        `场景里 BOX ${part.D0.boxObjects} 个对象；后端记录 ${recordsLoaded.items.length} 条；生成请求 ${JSON.stringify(log.extraPost)}；装之前后端说它 ${part.statusBefore.verdict}`);

      console.log(`[${stamp()}] D1：重起沙箱后端（监听名单不变）`);
      const startedBefore = (await backendFetch('/api/v1/health')).body.started_at;
      const restartAt = Date.now();
      const restart = spawnSync('pwsh', ['-NoProfile', '-File', path.join(HERE, 'stack.ps1'), '-Restart', '-Watch', '8000'], { stdio: 'ignore' });
      if (restart.status !== 0) throw new Error(`重起后端失败（退出码 ${restart.status}），看 logs\\stack.log`);
      let healthAfter = null;
      for (let i = 0; i < 600; i += 1) {
        try {
          const answer = await backendFetch('/api/v1/health');
          if (answer.status === 200 && answer.body.started_at && answer.body.started_at !== startedBefore) { healthAfter = answer.body; break; }
        } catch { /* 还没起来 */ }
        await sleep(500);
      }
      if (!healthAfter) throw new Error('重起后 5 分钟 /health 没有应答');
      // 等 8000 回到齐平（重起后它要自己对一遍账），免得页面的请求撞上它
      const row8000 = rowBrief(await backendRow(8000));
      await waitCaughtUp(8000, row8000?.file ?? 1698, Date.now(), 300_000);
      await sleep(4_000);
      const recordsAfter = await backendRecords(X_ZONE);
      const statusAfter = await backendNodeStatus(X_ZONE);
      part.restart = { ms: Date.now() - restartAt, startedBefore, startedAfter: healthAfter.started_at, watch: healthAfter.watch_dbnums };
      part.backendAfterRestart = { records: recordsAfter.items.length, complete: recordsAfter.complete, status: recordsAfter.status, nodeStatus: statusAfter, row7998: rowBrief(await backendRow(7998)) };
      check('D1', '后端重起了；按需生成的模型没了：7998 那个 ZONE 的记录查空且收齐，后端说它没生成', recordsAfter.status === 200 && recordsAfter.items.length === 0 && recordsAfter.complete !== false && /not_generated|partial/.test(String(statusAfter.verdict)),
        `记录 ${recordsAfter.items.length} 条 complete=${recordsAfter.complete}；节点模型状态 ${JSON.stringify(statusAfter)}`);

      const at = Date.now();
      const done = await dispatchReload(page, [X_ZONE]);
      await waitIdle(page);
      await sleep(1_500);
      const after = await readPage(page, roots);
      const toasts = toastsSince(after, at);
      part.D1 = {
        done, boxObjects: after.scene[7998]?.[X_BOX]?.length ?? 0, toasts, table: after.loadedTable.find((entry) => entry.refno === X_ZONE) ?? null,
        rowButtons: after.rowButtons[X_ZONE], inScene: after.roots[0]?.inScene,
      };
      check('D1', '经原有的「重载」（状态栏的重载、重新部署后的重装派发的那个事件）：查空没有当成已删除，BOX 还在场景里、节点还算装着',
        part.D1.boxObjects === 1 && after.roots[0]?.inScene === true && !!part.D1.table?.loaded, `场景里 BOX ${part.D1.boxObjects} 个对象；已加载节点表 ${JSON.stringify(part.D1.table)}`);
      check('D1', '给人的提示没有说它「已删除」「已从场景撤下」，说的是没有当成已删除', !toasts.some((text) => /已删除或|已从场景撤下/.test(text)) && toasts.some((text) => /没有当成已删除/.test(text)), JSON.stringify(toasts));

      if (part.D1.boxObjects === 1) {
        console.log(`[${stamp()}] D2：再点一次「取最新」`);
        const run = await clickGetWork(page);
        await waitIdle(page);
        await sleep(800);
        const healed = await readPage(page, roots);
        const report = healed.getWork.last;
        const during = healed.toasts.filter((item) => item.at >= run.clickedAt);
        part.D2 = {
          ms: run.ms, summary: report?.summary ?? null, detail: report?.detail ?? null, backendRestarted: report?.backendRestarted ?? null,
          kept: report?.models.kept ?? null, failed: report?.models.failed ?? null, withdrawn: report?.models.withdrawn ?? null,
          boxObjects: healed.scene[7998]?.[X_BOX]?.length ?? 0, toasts: during.map((item) => item.message), rowButtons: healed.rowButtons[X_ZONE],
        };
        check('D2', '取最新认出后端重启过；7998 的 ZONE 没有被撤下，BOX 还在场景里', report?.backendRestarted === true && (report?.models.withdrawn.length ?? 1) === 0 && part.D2.boxObjects === 1,
          `${report?.summary}｜没动的：${JSON.stringify(report?.models.kept)}｜没成的：${JSON.stringify(report?.models.failed)}`);
        check('D2', '那句交代里说了它没有被当成已删除', /不当成已删除|没有当成已删除|保持原样/.test(`${report?.summary} ${(report?.detail ?? []).join(' ')}`), `${report?.summary}｜${(report?.detail ?? []).join('｜')}`);
        check('D2', '取最新期间只弹了一条提示，就是最后那句交代', during.length === 1 && during[0].message === report?.summary, JSON.stringify(during.map((item) => item.message.slice(0, 60))));
      }
      part.generatePostsTotal = log.extraPost;
    } finally {
      await context.close();
    }
  }
} catch (error) {
  console.error(`[${stamp()}] 出错：${error?.stack ?? error}`);
  results.error = String(error?.stack ?? error).slice(0, 3000);
  process.exitCode = 2;
} finally {
  const toLive = guards.flatMap((guard) => guard.log.toLive);
  const blocked = guards.flatMap((guard) => guard.log.blocked.map((item) => ({ page: guard.name, ...item })));
  const extra = Object.fromEntries(guards.filter((guard) => Object.keys(guard.log.extraPost).length > 0).map((guard) => [guard.name, guard.log.extraPost]));
  results.guard = {
    toLive, blocked, extraPost: extra,
    requestsToSandbox: guards.reduce((sum, guard) => sum + guard.log.requests.length, 0),
    allowedPost: guards.reduce((acc, guard) => { for (const [name, count] of Object.entries(guard.log.allowedPost)) acc[name] = (acc[name] ?? 0) + count; return acc; }, {}),
    pageErrors: guards.flatMap((guard) => guard.events.pageErrors.map((text) => `${guard.name}：${text}`)).slice(0, 20),
  };
  check('护栏', '页面没有一个请求发往 8022 / 8009', toLive.length === 0, toLive.length ? JSON.stringify(toLive.slice(0, 5)) : `发往沙箱后端 ${results.guard.requestsToSandbox} 个请求`);
  check('护栏', '页面对沙箱后端只发了 GET 和三种只读 POST；多放行的只有丁那一页的 model/generate（发给沙箱后端）',
    blocked.length === 0 && Object.keys(extra).every((name) => name === '丁') && Object.values(extra).every((posts) => Object.keys(posts).every((route) => route === '/api/v1/model/generate')),
    blocked.length ? JSON.stringify(blocked.slice(0, 5)) : `只读 POST ${JSON.stringify(results.guard.allowedPost)}；多放行 ${JSON.stringify(extra)}`);
  await browser.close();
  results.finishedAt = new Date().toISOString();
  results.checks = checks;
  saveJson(`r3-reload-${phase}.json`, results);
  const failed = checks.filter((item) => !item.pass);
  console.log(`[${stamp()}] ${phase}：共 ${checks.length} 项，过 ${checks.length - failed.length}，没过 ${failed.length}`);
  if (failed.length > 0 && !process.exitCode) process.exitCode = 1;
}
