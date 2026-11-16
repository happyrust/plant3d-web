/**
 * 第三轮重跑叠加层场景用的脚本：verify-r3.mjs ← verify.mjs。场景与断言不动，只改两样（每处替换要求恰好命中）：
 *   - 四处「等……」原来用 page.waitForFunction 配异步判断——它不等异步判断的结果（回来的 Promise 本身就算「真」），
 *     其实一下都没等，靠的是后面跟着的固定等待。换成在页面里反复问、真的会等的写法。
 *   - 结果另起文件名，不盖掉前两轮的。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
let text = readFileSync(path.join(here, 'verify.mjs'), 'utf8');
const swap = (from, to, times = 1) => {
  const hits = text.split(from).length - 1;
  if (hits !== times) throw new Error(`要求恰好 ${times} 处，实际 ${hits} 处：${from.slice(0, 80)}`);
  text = text.split(from).join(to);
};

swap(`async function waitLoaded(page, refnos, timeoutMs = 120_000) {
  await page.waitForFunction(async ({ list, dbno }) => {
    const loader = await import('/src/composables/useDbnoInstancesDtxLoader.ts');
    const sessions = await import('/src/composables/modelLoadSession.ts');
    return list.every((id) => loader.isDtxRefnoLoaded(dbno, id)) && !sessions.hasActiveModelLoad();
  }, { list: refnos, dbno: DBNUM }, { timeout: timeoutMs, polling: 250 });
}

async function waitIdle(page, timeoutMs = 300_000) {
  await page.waitForFunction(async () => {
    const sessions = await import('/src/composables/modelLoadSession.ts');
    return !sessions.hasActiveModelLoad();
  }, null, { timeout: timeoutMs, polling: 300 });
}`, `/** 在页面里反复问一个（可以是异步的）判断，直到它为真。不用 page.waitForFunction：它不等异步判断的结果。 */
async function waitInPage(page, predicate, arg, timeoutMs, intervalMs, what) {
  const from = Date.now();
  for (;;) {
    if (await page.evaluate(predicate, arg)) return;
    if (Date.now() - from > timeoutMs) throw new Error(\`等「\${what}」超过 \${timeoutMs} 毫秒\`);
    await sleep(intervalMs);
  }
}

async function waitLoaded(page, refnos, timeoutMs = 120_000) {
  await waitInPage(page, async ({ list, dbno }) => {
    const loader = await import('/src/composables/useDbnoInstancesDtxLoader.ts');
    const sessions = await import('/src/composables/modelLoadSession.ts');
    return list.every((id) => loader.isDtxRefnoLoaded(dbno, id)) && !sessions.hasActiveModelLoad();
  }, { list: refnos, dbno: DBNUM }, timeoutMs, 150, '这几个构件装完');
}

async function waitIdle(page, timeoutMs = 300_000) {
  await waitInPage(page, async () => {
    const sessions = await import('/src/composables/modelLoadSession.ts');
    return !sessions.hasActiveModelLoad();
  }, null, timeoutMs, 150, '装载结束');
}`);

swap(`    await page.waitForFunction(async () => {
      const treeStore = await import('/src/composables/useModelTreeStore.ts');
      return (treeStore.getModelTreeInstance()?.flatRows.value.length ?? 0) > 1;
    }, null, { timeout: 120_000, polling: 300 });`, `    await waitInPage(page, async () => {
      const treeStore = await import('/src/composables/useModelTreeStore.ts');
      return (treeStore.getModelTreeInstance()?.flatRows.value.length ?? 0) > 1;
    }, null, 120_000, 300, '模型树取到根');`);

swap(`    await page.waitForFunction(async () => {
      const sessions = await import('/src/composables/modelLoadSession.ts');
      return sessions.hasActiveModelLoad();
    }, null, { timeout: 30_000, polling: 50 });`, `    await waitInPage(page, async () => {
      const sessions = await import('/src/composables/modelLoadSession.ts');
      return sessions.hasActiveModelLoad();
    }, null, 30_000, 20, '那个大节点开始装');`);

// 后端地址：缺省还是现网 8022；第三轮跑的时候 8022 的后端不在（不是这边停的），用环境变量指到沙箱后端（同一工程库文件的副本）
swap(`const BACKEND = 'http://127.0.0.1:8022';`, `const BACKEND = process.env.GETWORK_VERIFY_BACKEND ?? 'http://127.0.0.1:8022';`);
// 结果和截图另放一个目录，不盖掉前两轮的
swap(`const OUT = path.join(HERE, 'out');`, `const OUT = path.join(HERE, 'out-r3');`);
writeFileSync(path.join(here, 'verify-r3.mjs'), text, 'utf8');
console.log('verify-r3.mjs 写好了');
