/**
 * 探查：回放脚本的「等上一个节点装完」（isRootInScene && !hasActiveModelLoad）为什么会提前放行——
 * 页面里用 import() 拿到的 modelLoadSession 模块，和应用自己用的是不是同一份？
 * 只开页面、点一次眼睛（装 8000 库的一台小设备）、读状态；不动库文件，不点取最新。
 */
import path from 'node:path';

import { chromium } from '@playwright/test';

import { EQ_CASE, TMP, clickEye, createGuardedContext, expandTree, newPage, openApp, sleep } from './r3-lib.mjs';

const browser = await chromium.launch({
  channel: 'chrome', headless: true,
  args: ['--disable-renderer-backgrounding', '--disable-background-timer-throttling', `--disk-cache-dir=${path.join(TMP, 'chrome-cache')}`],
});
try {
  const { context, log } = await createGuardedContext(browser, {});
  const { page } = await newPage(context, log);
  await openApp(page);
  await expandTree(page, [EQ_CASE]);
  const urls = await page.evaluate(() => performance.getEntriesByType('resource').map((entry) => entry.name)
    .filter((name) => /modelLoadSession|useModelGeneration\.ts|useLoadedNodeStatus|toastBus/.test(name)).map((name) => name.replace(location.origin, '')));
  console.log('页面装过的这几个模块的地址：', JSON.stringify(urls));
  // 点眼睛之后每 10 毫秒读一次：应用自己的会话表里有没有东西、场景里有没有它
  await page.evaluate(() => {
    window.__samples = [];
    const started = performance.now();
    const tick = async () => {
      const [sessions, generation] = await Promise.all([import('/src/composables/modelLoadSession.ts'), import('/src/composables/useModelGeneration.ts')]);
      const gen = generation.useModelGeneration({ viewer: { __dtxLayer: window.__dtxLayer } });
      window.__samples.push({ t: Math.round(performance.now() - started), active: sessions.hasActiveModelLoad(), inScene: gen.isRootInScene('24384_47470', 8000) });
      if (performance.now() - started < 1500) setTimeout(tick, 10);
    };
    tick();
  });
  await clickEye(page, EQ_CASE);
  await sleep(1800);
  const samples = await page.evaluate(() => window.__samples);
  const compact = [];
  for (const sample of samples) {
    const last = compact[compact.length - 1];
    if (!last || last.active !== sample.active || last.inScene !== sample.inScene) compact.push(sample);
  }
  console.log('点眼睛之后的状态变化（毫秒：有装载在跑 / 已在场景里）：', compact.map((item) => `${item.t}:${item.active ? '在跑' : '没在跑'}/${item.inScene ? '在场景' : '不在'}`).join(' → '));
  const early = samples.filter((item) => item.inScene && !item.active);
  const lastActive = samples.filter((item) => item.active).pop();
  console.log(`「已在场景里、又没有装载在跑」第一次出现在 ${early[0]?.t ?? '—'} 毫秒；最后一次看到「有装载在跑」在 ${lastActive?.t ?? '—'} 毫秒`);
} finally {
  await browser.close();
}
