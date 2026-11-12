/**
 * 第三轮的两份「重跑」脚本是从第二轮的回放脚本派生出来的：r3-nodes.mjs ← replay-verify.mjs，r3-showdbnum.mjs ← replay-showdbnum.mjs。
 * 步骤、对账办法一字不动，只加这一轮要看的几件事（每一处替换都要求恰好命中一次，命中不了就报错）：
 *   - 每一步点「取最新」之前，状态栏出没出「数据已更新」的提示（上一轮 S1、S6、J1 三步没出）；
 *   - 取最新期间一共弹了几条提示（应当只有最后那一句）；
 *   - 那一句弹出来的时候压没压在状态栏上；
 *   - 「监听范围」改叫「后端更新范围」之后的那句交代。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

function derive(from, to, edits) {
  let text = readFileSync(path.join(here, from), 'utf8');
  for (const [a, b, times = 1] of edits) {
    const hits = text.split(a).length - 1;
    if (hits !== times) throw new Error(`${from}：要求恰好 ${times} 处，实际 ${hits} 处：${a.slice(0, 80)}`);
    text = text.split(a).join(b);
  }
  writeFileSync(path.join(here, to), text, 'utf8');
  console.log(`${to} ← ${from}：${edits.length} 处改动`);
}

const TOAST_FN_OLD = `    const button = document.querySelector('[data-testid="model-getwork-button"]');
    const toasts = [...document.querySelectorAll('.v-snackbar__wrapper')].map(rectOf).filter(Boolean);
    const buttonRect = rectOf(button);
    const overlaps = (a, b) => !!a && !!b && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;`;
const TOAST_FN_NEW = `    const button = document.querySelector('[data-testid="model-getwork-button"]');
    const toasts = [...document.querySelectorAll('.v-snackbar__wrapper')].map(rectOf).filter(Boolean);
    const buttonRect = rectOf(button);
    const overlaps = (a, b) => !!a && !!b && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    const statusBar = rectOf(document.querySelector('[data-testid="app-status-bar"]'));`;
const TOAST_RET_OLD = `    return { viewport: window.innerWidth, button: buttonRect, toasts, covered: toasts.some((toast) => overlaps(toast, buttonRect)), clickable: hit };`;
const TOAST_RET_NEW = `    return { viewport: window.innerWidth, button: buttonRect, toasts, covered: toasts.some((toast) => overlaps(toast, buttonRect)), clickable: hit, statusBar, overStatusBar: toasts.some((toast) => overlaps(toast, statusBar)) };`;

derive('replay-verify.mjs', 'r3-nodes.mjs', [
  [` * 「取最新」的真实增量回放验证。`, ` * 「取最新」的真实增量回放验证——第三轮在最终代码上的重跑（由 make-r3-scripts.mjs 从 replay-verify.mjs 派生，步骤与对账办法没动）。`],
  [`import { fileURLToPath } from 'node:url';\n\nimport { chromium } from '@playwright/test';`,
    `import { fileURLToPath } from 'node:url';\n\nimport { chromium } from '@playwright/test';\n\nimport { overlayVersusStatusBar, resizeAndSettle, showProbeToast, takeReplayLock, waitIdle, waitInPage, waitRootLoaded } from './r3-lib.mjs';`],
  // 「等装载结束」「等这个节点装完」：原来用 waitForFunction 配异步判断，其实一下都没等（见 r3-lib.mjs 的说明）。换成真的会等的那一份
  [`async function waitIdle(page, timeoutMs = 300_000) {
  await page.waitForFunction(async () => {
    const sessions = await import('/src/composables/modelLoadSession.ts');
    return !sessions.hasActiveModelLoad();
  }, null, { timeout: timeoutMs, polling: 300 });
}

async function waitRootLoaded(page, root, timeoutMs = 120_000) {
  await page.waitForFunction(async ({ refno, dbnum }) => {
    const [generation, sessions] = await Promise.all([import('/src/composables/useModelGeneration.ts'), import('/src/composables/modelLoadSession.ts')]);
    const gen = generation.useModelGeneration({ viewer: { __dtxLayer: window.__dtxLayer } });
    return gen.isRootInScene(refno, dbnum) && !sessions.hasActiveModelLoad();
  }, root, { timeout: timeoutMs, polling: 300 });
}`, `// waitIdle / waitRootLoaded：用 r3-lib.mjs 里的（原来这里的写法其实没有等）`],
  [`  await page.waitForFunction(async () => {
    const treeStore = await import('/src/composables/useModelTreeStore.ts');
    return (treeStore.getModelTreeInstance()?.flatRows.value.length ?? 0) > 1;
  }, null, { timeout: 120_000, polling: 300 });`,
    `  await waitInPage(page, async () => {
    const treeStore = await import('/src/composables/useModelTreeStore.ts');
    return (treeStore.getModelTreeInstance()?.flatRows.value.length ?? 0) > 1;
  }, null, { timeoutMs: 120_000, intervalMs: 300, what: '模型树取到根' });`],
  [`const args = process.argv.slice(2);`, `takeReplayLock();\nconst args = process.argv.slice(2);`],
  [TOAST_FN_OLD, TOAST_FN_NEW],
  [TOAST_RET_OLD, TOAST_RET_NEW],
  // 点之前：提示出没出
  [`    await sleep(800);\n    record.noticeBeforeClick = await noticeText(page);\n    clickedAt = Date.now();\n    run = await clickGetWork(page);\n  }`,
    `    await sleep(800);\n    record.noticeBeforeClick = await noticeText(page);\n    record.noticeHintBeforeClick = await page.evaluate(() => document.querySelector('[data-testid="gen-model-v1-update-notice-getwork-hint"]')?.textContent?.trim() ?? null);\n    record.noticeReloadBeforeClick = await page.evaluate(() => !!document.querySelector('[data-testid="gen-model-v1-update-notice-reload"]'));\n    check(step.id, '点之前：状态栏出了「数据已更新」的提示，说的是这个库到了这个会话；有「重载」可点，或者写着点「取最新」',\n      !!record.noticeBeforeClick && record.noticeBeforeClick.includes(\`库 \${step.dbnum}\`) && record.noticeBeforeClick.includes(String(step.to)) && (record.noticeReloadBeforeClick || /取最新/.test(record.noticeHintBeforeClick ?? '')),\n      \`\${record.noticeBeforeClick ?? '（没有提示）'}｜\${record.noticeReloadBeforeClick ? '有「重载」' : record.noticeHintBeforeClick ?? '没有引导'}\`);\n    if (step.measureNotice) {\n      // 状态栏的提示上有「重载」「忽略」的这一刻：放一条验证用的长提示，量它压没压住这两个按钮（两种窗口宽度）\n      record.noticeOverlay = {};\n      for (const [width, height] of [[1600, 1000], [1280, 800]]) {\n        await resizeAndSettle(page, width, height);\n        await showProbeToast(page);\n        const o = (record.noticeOverlay[width] = await overlayVersusStatusBar(page));\n        // 这一步的提示上不一定有「重载」（认不出可重载的根时没有，换成一句「点「取最新」同步」）：有就要点得到
        check(step.id, \`窗口宽 \${width}：底部提示条正显示着，状态栏提示上的\${o.reload.rect ? '「重载」' : ''}「忽略」和「取最新」都点得到，提示条没有压在状态栏上\`,\n          o.viewport === width && o.statusBar?.right <= width && o.snackbars.length > 0 && !o.snackbarOverStatusBar && (o.reload.rect === null || o.reload.clickable === true) && o.dismiss.clickable === true && o.getWork.clickable === true,\n          \`提示条 \${JSON.stringify(o.snackbars)} 状态栏 \${JSON.stringify(o.statusBar)} 重载 \${JSON.stringify(o.reload)} 忽略 \${JSON.stringify(o.dismiss)} 取最新 \${JSON.stringify(o.getWork)}\`);\n        if (width === 1280) await page.screenshot({ path: path.join(OUT, \`r3-nodes-\${step.id}-toast-vs-status-bar-1280.png\`) });\n      }\n      await resizeAndSettle(page, 1600, 1000);\n      await page.mouse.move(800, 300);\n      await page.waitForSelector('.v-snackbar__wrapper', { state: 'hidden', timeout: 20_000 }).catch(() => undefined);\n    }\n    clickedAt = Date.now();\n    run = await clickGetWork(page);\n  }`],
  [`      id: 'S3', dbnum: 8000, to: 1660, screenshot: 'replay-3-delete.png',`, `      id: 'S3', dbnum: 8000, to: 1660, screenshot: 'replay-3-delete.png', measureNotice: true,`],
  [`      id: 'S7', dbnum: 8000, to: 1686, screenshot: 'replay-7-rezone.png',`, `      id: 'S7', dbnum: 8000, to: 1686, screenshot: 'replay-7-rezone.png', measureNotice: true,`],
  // 取最新期间弹了几条
  [`  check(step.id, '状态栏那句交代和回执一致', !!pageAfter.dom.result && pageAfter.dom.result === report?.summary, pageAfter.dom.result ?? '');`,
    `  check(step.id, '状态栏那句交代和回执一致', !!pageAfter.dom.result && pageAfter.dom.result === report?.summary, pageAfter.dom.result ?? '');\n  record.toastsDuringGetWork = await page.evaluate((since) => (window.__toasts ?? []).filter((item) => item.at >= since).map((item) => item.message), clickedAt);\n  check(step.id, '取最新期间只弹了一条提示，就是最后那句交代（每个节点各自的装载提示没有弹）', record.toastsDuringGetWork.length === 1 && record.toastsDuringGetWork[0] === report?.summary,\n    JSON.stringify(record.toastsDuringGetWork.map((text) => text.slice(0, 50))));\n  check(step.id, '那一句弹出来的时候没有压在状态栏上', record.toast.toasts.length > 0 && record.toast.overStatusBar === false, \`提示条 \${JSON.stringify(record.toast.toasts)} 状态栏 \${JSON.stringify(record.toast.statusBar)}\`);`],
  // R1：叫法
  [`      !!named && named.kind === 'out_of_scope' && /7998/.test(named.text) && /677/.test(named.text) && /679/.test(named.text) && /监听范围/.test(named.text),`,
    `      !!named && named.kind === 'out_of_scope' && /7998/.test(named.text) && /677/.test(named.text) && /679/.test(named.text) && /不在后端更新范围里/.test(named.text) && !/监听范围/.test(named.text),`],
  [`    check('R1', '不在监听范围的库被如实点名：库 7998，模型停在 677，库文件已到 679',`, `    check('R1', '不在后端更新范围里的库被如实点名（叫法已改）：库 7998，模型停在 677，库文件已到 679',`],
  [`    check('R1', '那句交代里也说了这件事（状态栏上看得到）', /7998/.test(\`\${report?.summary} \${report?.detail}\`) && /监听范围/.test(\`\${report?.summary} \${report?.detail}\`), \`\${report?.summary}｜\${report?.detail}\`);`,
    `    check('R1', '那句交代里也说了这件事（状态栏上看得到）', /7998/.test(\`\${report?.summary} \${report?.detail}\`) && /后端更新范围/.test(\`\${report?.summary} \${report?.detail}\`), \`\${report?.summary}｜\${report?.detail}\`);\n    record.toastsDuringGetWork = await page.evaluate((since) => (window.__toasts ?? []).filter((item) => item.at >= since).map((item) => item.message), clickedAt);\n    check('R1', '取最新期间只弹了一条提示，就是最后那句交代', record.toastsDuringGetWork.length === 1 && record.toastsDuringGetWork[0] === report?.summary, JSON.stringify(record.toastsDuringGetWork.map((text) => text.slice(0, 50))));\n    check('R1', '那一句弹出来的时候没有压在状态栏上', record.toast.toasts.length > 0 && record.toast.overStatusBar === false, JSON.stringify(record.toast));`],
  [`    check('窄窗口', '窗口宽 1280 时：那一句弹出来也盖不到「取最新」按钮', narrow.toasts.length > 0 && narrow.clickable === true && !narrow.covered, JSON.stringify(narrow));`,
    `    check('窄窗口', '窗口宽 1280 时：那一句弹出来也盖不到「取最新」按钮，也没有压在状态栏上', narrow.toasts.length > 0 && narrow.clickable === true && !narrow.covered && narrow.overStatusBar === false, JSON.stringify(narrow));`],
  // 基线：把四次装载各自「装了几个、跳过几个」的那几行控制台日志留下（上一轮和这一轮各撞到一次「同一个构件两个对象」）
  [`    check('基线', \`三维对上：四个节点名下的构件和 \${scene.matricesCompared} 个实例矩阵与后端的记录逐条一样\`, scene.mismatches.length === 0, scene.mismatches.slice(0, 4).join('；'));`,
    `    check('基线', \`三维对上：四个节点名下的构件和 \${scene.matricesCompared} 个实例矩阵与后端的记录逐条一样\`, scene.mismatches.length === 0, scene.mismatches.slice(0, 4).join('；'));\n    results.baseline.modelLoadLog = await page.evaluate(async () => {\n      const store = (await import('/src/composables/useConsoleStore.ts')).useConsoleStore();\n      const logs = store.logs?.value ?? store.logs ?? [];\n      return logs.map((item) => String(item.content ?? '')).filter((text) => /\\[model-load\\] (gen-model-v1 root=|load_scope_refnos|resolved_load_scope)/.test(text)).slice(-24);\n    });\n    results.baseline.sceneMismatches = scene.mismatches;`],
  // 输出另起名字，不盖掉第二轮的
  [`path.join(OUT, 'replay-result.json')`, `path.join(OUT, 'r3-nodes-result.json')`],
  [`'replay-0-baseline.png'`, `'r3-nodes-0-baseline.png'`],
  [`screenshot: 'replay-`, `screenshot: 'r3-nodes-`, 6],
  [`'replay-12-restart-excluded.png'`, `'r3-nodes-12-restart-excluded.png'`],
  [`'replay-13-narrow-1280.png'`, `'r3-nodes-13-narrow-1280.png'`],
  [`'replay-error.png'`, `'r3-nodes-error.png'`],
]);

derive('replay-showdbnum.mjs', 'r3-showdbnum.mjs', [
  // 「等装载结束」原来用 waitForFunction 配异步判断，其实没有等：换成真的会等的
  [`import { chromium } from '@playwright/test';`, `import { chromium } from '@playwright/test';\n\nimport { waitInPage } from './r3-lib.mjs';`],
  [`await page.waitForFunction(async () => !(await import('/src/composables/modelLoadSession.ts')).hasActiveModelLoad(), null, { timeout: 600_000, polling: 300 });`,
    `await waitInPage(page, async () => !(await import('/src/composables/modelLoadSession.ts')).hasActiveModelLoad(), null, { timeoutMs: 600_000, intervalMs: 300, what: '装载结束' });`, 2],
  // 页面弹过的每一条提示
  [`const page = await context.newPage();\nconst pageErrors = [];`,
    `const page = await context.newPage();\nawait page.addInitScript(() => {\n  window.__toasts = [];\n  import('/src/ribbon/toastBus.ts').then((bus) => {\n    bus.onToast((payload) => { window.__toasts.push({ at: Date.now(), level: payload.level ?? 'info', message: payload.message }); });\n  }).catch(() => undefined);\n});\nconst pageErrors = [];`],
  // 点之前：整库显示的页面上，装着节点的库有变化的批次落地也要出提示
  [`    await sleep(1000);\n    const run = await clickGetWork();`,
    `    await sleep(1500);\n    record.noticeBeforeClick = await page.evaluate(() => ({\n      text: document.querySelector('[data-testid="gen-model-v1-update-notice-text"]')?.textContent?.replace(/\\s+/g, ' ').trim() ?? null,\n      hint: document.querySelector('[data-testid="gen-model-v1-update-notice-getwork-hint"]')?.textContent?.trim() ?? null,\n      reload: !!document.querySelector('[data-testid="gen-model-v1-update-notice-reload"]'),\n    }));\n    check(step.id, '点之前：状态栏出了「数据已更新」的提示，说的是这个库到了这个会话；有「重载」可点，或者写着点「取最新」',\n      !!record.noticeBeforeClick.text && record.noticeBeforeClick.text.includes(\`库 \${DBNUM}\`) && record.noticeBeforeClick.text.includes(String(step.to)) && (record.noticeBeforeClick.reload || /取最新/.test(record.noticeBeforeClick.hint ?? '')),\n      JSON.stringify(record.noticeBeforeClick));\n    const run = await clickGetWork();`],
  [`    check(step.id, '状态栏那句交代和回执一致', pageState.result === report?.summary, pageState.result ?? '');`,
    `    check(step.id, '状态栏那句交代和回执一致', pageState.result === report?.summary, pageState.result ?? '');\n    record.toastsDuringGetWork = await page.evaluate((since) => (window.__toasts ?? []).filter((item) => item.at >= since).map((item) => item.message), run.from);\n    check(step.id, '取最新期间只弹了一条提示，就是最后那句交代（每个 SITE 各自的装载提示没有弹）', record.toastsDuringGetWork.length === 1 && record.toastsDuringGetWork[0] === report?.summary,\n      JSON.stringify(record.toastsDuringGetWork.map((text) => text.slice(0, 50))));`],
  [`path.join(OUT, 'replay-showdbnum-result.json')`, `path.join(OUT, 'r3-showdbnum-result.json')`],
  [`'replay-w0-showdbnum.png'`, `'r3-w0-showdbnum.png'`],
  ['`replay-${step.id.toLowerCase()}-showdbnum.png`', '`r3-${step.id.toLowerCase()}-showdbnum.png`'],
  [`'replay-w-error.png'`, `'r3-w-error.png'`],
]);
