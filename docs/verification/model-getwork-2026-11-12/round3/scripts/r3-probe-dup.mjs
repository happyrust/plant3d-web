/**
 * 探查：「同一个构件在场景里出现两个对象」是怎么来的。
 * 照节点装载那一轮的基线做：先点设备 EQ-CASE 的眼睛、等它装完（脚本的等法：isRootInScene && !hasActiveModelLoad），再点它所在的 ZONE。
 * 每次开一个新页面，记下：两次点击各在什么时候、其间「有没有装载在跑 / 设备在不在场景里」的变化、
 * 两次装载各自「装了几个、跳过几个」、BOX 最后有几个对象。只读：不动库文件，不点取最新。
 */
import path from 'node:path';

import { chromium } from '@playwright/test';

import { BOX_CASE, EQ_CASE, TMP, Z, clickEye, createGuardedContext, expandTree, newPage, openApp, sleep, waitRootLoaded } from './r3-lib.mjs';

const rounds = Number(process.argv.find((arg) => arg.startsWith('--rounds='))?.slice('--rounds='.length) ?? 4);
const browser = await chromium.launch({
  channel: 'chrome', headless: true,
  args: ['--disable-renderer-backgrounding', '--disable-background-timer-throttling', `--disk-cache-dir=${path.join(TMP, 'chrome-cache')}`],
});
try {
  for (let round = 1; round <= rounds; round += 1) {
    const { context, log } = await createGuardedContext(browser, {});
    const { page } = await newPage(context, log);
    await openApp(page);
    await expandTree(page, [EQ_CASE]);
    await page.evaluate(() => {
      window.__t0 = performance.now();
      window.__marks = [];
      window.__samples = [];
      const tick = async () => {
        const [sessions, generation] = await Promise.all([import('/src/composables/modelLoadSession.ts'), import('/src/composables/useModelGeneration.ts')]);
        const gen = generation.useModelGeneration({ viewer: { __dtxLayer: window.__dtxLayer } });
        window.__samples.push({ t: Math.round(performance.now() - window.__t0), active: sessions.hasActiveModelLoad(), inScene: gen.isRootInScene('24384_47470', 8000) });
        if (performance.now() - window.__t0 < 6000) setTimeout(tick, 5);
      };
      tick();
    });
    const mark = (name) => page.evaluate((label) => { window.__marks.push({ t: Math.round(performance.now() - window.__t0), label }); }, name);
    await mark('点设备的眼睛之前');
    await clickEye(page, EQ_CASE);
    await mark('点了设备的眼睛');
    await waitRootLoaded(page, { refno: EQ_CASE, dbnum: 8000 });
    await mark('脚本认为设备装完了');
    await clickEye(page, Z);
    await mark('点了 ZONE 的眼睛');
    await waitRootLoaded(page, { refno: Z, dbnum: 8000 });
    await sleep(800);
    const out = await page.evaluate(async (box) => {
      const [loader, consoleStore] = await Promise.all([import('/src/composables/useDbnoInstancesDtxLoader.ts'), import('/src/composables/useConsoleStore.ts')]);
      const layer = window.__dtxLayer;
      const objects = (layer?.getAllObjectIds?.() ?? []).filter((id) => loader.resolveDtxRefnoByObjectId(8000, id) === box);
      const store = consoleStore.useConsoleStore();
      const logs = store.logs?.value ?? store.logs ?? [];
      const lines = logs.map((item) => String(item.content ?? '')).filter((text) => /\[model-load\] (gen-model-v1 root=|load_scope_refnos)/.test(text))
        .map((text) => text.replace('[model-load] ', '').replace(/ invalid_tubi.*$/, '').replace(/ source=visible-insts/, ''));
      const compact = [];
      for (const sample of window.__samples) {
        const last = compact[compact.length - 1];
        if (!last || last.active !== sample.active || last.inScene !== sample.inScene) compact.push(sample);
      }
      return { objects, lines, marks: window.__marks, states: compact.map((item) => `${item.t}:${item.active ? '在跑' : '没在跑'}/${item.inScene ? '在场景' : '不在'}`) };
    }, BOX_CASE);
    console.log(`第 ${round} 次：BOX 的对象 ${out.objects.length} 个（${out.objects.join(', ')}）`);
    console.log(`  点击：${out.marks.map((item) => `${item.t} ${item.label}`).join(' → ')}`);
    console.log(`  状态：${out.states.join(' → ')}`);
    console.log(`  装载：${out.lines.join(' ｜ ')}`);
    await context.close();
  }
} finally {
  await browser.close();
}
