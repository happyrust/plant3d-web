/**
 * 探查：r3-reload.mjs 里「窗口宽 1280」那一项，状态栏量出来还是 1600 宽——是页面的问题，还是脚本同时开着几个页面造成的？
 * 不动库文件、不点任何按钮；只开页面、改窗口宽度、量状态栏。
 *   ① 只开一个页面：改到 1280，量；
 *   ② 再开第二个页面（另一个浏览器上下文），回头把第一个页面改到 1280，量；切到前台再量。
 */
import path from 'node:path';

import { chromium } from '@playwright/test';

import { TMP, createGuardedContext, newPage, openApp, sleep } from './r3-lib.mjs';

const browser = await chromium.launch({
  channel: 'chrome', headless: true,
  args: ['--disable-renderer-backgrounding', '--disable-background-timer-throttling', `--disk-cache-dir=${path.join(TMP, 'chrome-cache')}`],
});
const measure = (page) => page.evaluate(() => {
  const bar = document.querySelector('[data-testid="app-status-bar"]');
  const button = document.querySelector('[data-testid="model-getwork-button"]');
  return {
    innerWidth: window.innerWidth,
    statusBarRight: bar ? Math.round(bar.getBoundingClientRect().right) : null,
    getWorkRight: button ? Math.round(button.getBoundingClientRect().right) : null,
    visibility: document.visibilityState,
  };
});
const resizeAndWait = async (page, width, height, waitMs) => {
  await page.setViewportSize({ width, height });
  const from = Date.now();
  let last = await measure(page);
  while (Date.now() - from < waitMs && last.statusBarRight !== width) {
    await sleep(200);
    last = await measure(page);
  }
  return { ...last, waitedMs: Date.now() - from };
};
try {
  const a = await createGuardedContext(browser, {});
  const pageA = (await newPage(a.context, a.log)).page;
  await openApp(pageA);
  console.log('① 只有一个页面，改到 1280：', JSON.stringify(await resizeAndWait(pageA, 1280, 800, 6_000)));
  console.log('   改回 1600：', JSON.stringify(await resizeAndWait(pageA, 1600, 1000, 6_000)));

  const b = await createGuardedContext(browser, {});
  const pageB = (await newPage(b.context, b.log)).page;
  await openApp(pageB);
  console.log('② 又开了第二个页面之后，第一个页面改到 1280：', JSON.stringify(await resizeAndWait(pageA, 1280, 800, 6_000)));
  await pageA.bringToFront();
  await sleep(500);
  const front = await measure(pageA);
  console.log('   把第一个页面切到前台之后：', JSON.stringify(front));
  console.log('   再等 5 秒：', JSON.stringify(await resizeAndWait(pageA, 1280, 800, 5_000)));
  await pageB.close();
  await sleep(500);
  console.log('   关掉第二个页面之后：', JSON.stringify(await resizeAndWait(pageA, 1280, 800, 5_000)));
  const blocked = [...a.log.blocked, ...b.log.blocked, ...a.log.toLive, ...b.log.toLive];
  console.log(`护栏：拦下 ${blocked.length} 个请求`);
} finally {
  await browser.close();
}
