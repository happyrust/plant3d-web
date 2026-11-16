/**
 * 探查（接 r3-probe-resize.mjs）：窗口从 1600 改窄到 1280 之后状态栏还是 1600 宽——是谁撑着？
 * 只开一个页面、改窗口宽度、从状态栏往上逐层量宽度；再试几种「会不会让它重排」的动作。不动库文件、不点取最新。
 */
import path from 'node:path';

import { chromium } from '@playwright/test';

import { TMP, createGuardedContext, newPage, openApp, sleep } from './r3-lib.mjs';

const browser = await chromium.launch({
  channel: 'chrome', headless: true,
  args: ['--disable-renderer-backgrounding', '--disable-background-timer-throttling', `--disk-cache-dir=${path.join(TMP, 'chrome-cache')}`],
});
const chain = (page) => page.evaluate(() => {
  const out = [];
  let node = document.querySelector('[data-testid="app-status-bar"]');
  while (node && node !== document) {
    const style = getComputedStyle(node);
    out.push({
      tag: node.tagName.toLowerCase(),
      cls: String(node.className ?? '').split(/\s+/).filter(Boolean).slice(0, 5).join('.'),
      width: Math.round(node.getBoundingClientRect().width),
      inlineWidth: node.style?.width || '',
      minWidth: style.minWidth,
      flex: `${style.flexGrow} ${style.flexShrink} ${style.flexBasis}`,
      display: style.display,
    });
    node = node.parentElement;
  }
  // 状态栏的兄弟（停靠布局那一块）和它里面头两层
  const column = document.querySelector('[data-testid="app-status-bar"]')?.parentElement;
  const dock = column?.firstElementChild;
  const describe = (element) => (element ? {
    cls: String(element.className ?? '').split(/\s+/).filter(Boolean).slice(0, 4).join('.'),
    width: Math.round(element.getBoundingClientRect().width), inlineWidth: element.style?.width || '', position: getComputedStyle(element).position,
  } : null);
  return {
    innerWidth: window.innerWidth, scrollWidth: document.documentElement.scrollWidth, chain: out,
    dock: describe(dock), dockChild: describe(dock?.firstElementChild), dockGrandChild: describe(dock?.firstElementChild?.firstElementChild),
    dockGreat: describe(dock?.firstElementChild?.firstElementChild?.firstElementChild),
  };
});
const brief = (state) => `窗口 ${state.innerWidth}，页面可滚动宽度 ${state.scrollWidth}；` + state.chain.map((item) => `${item.tag}${item.cls ? `.${item.cls}` : ''}=${item.width}${item.inlineWidth ? `(行内 ${item.inlineWidth})` : ''}`).join(' ← ');
try {
  const a = await createGuardedContext(browser, {});
  const page = (await newPage(a.context, a.log)).page;
  await openApp(page);
  console.log('1600：', brief(await chain(page)));
  await page.setViewportSize({ width: 1280, height: 800 });
  await sleep(1500);
  const narrow = await chain(page);
  console.log('改到 1280 之后 1.5 秒：', brief(narrow));
  console.log('  每层：', JSON.stringify(narrow.chain.map((item) => ({ el: `${item.tag}.${item.cls}`, w: item.width, min: item.minWidth, flex: item.flex, d: item.display }))));
  console.log('  停靠布局：', JSON.stringify({ dock: narrow.dock, child: narrow.dockChild, grand: narrow.dockGrandChild, great: narrow.dockGreat }));
  // 试几种动作，看哪一种让它重排
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  await sleep(800);
  console.log('再派发一次 window resize 事件之后：', brief(await chain(page)).slice(0, 160));
  await page.mouse.move(640, 400);
  await page.mouse.click(640, 400);
  await sleep(800);
  console.log('在画面中间点一下之后：', brief(await chain(page)).slice(0, 160));
  await sleep(4000);
  console.log('再等 4 秒：', brief(await chain(page)).slice(0, 160));
} finally {
  await browser.close();
}
