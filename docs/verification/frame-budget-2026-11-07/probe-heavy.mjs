// 诊断：demo 重场景下拖动时档位是否真的变化、pipeline 是否收到 setDowngradeLevel。
import { createRequire } from 'node:module';
const require = createRequire('D:/work/plant-code/old/plant3d-web/package.json');
const { chromium } = require('playwright');

const baseUrl = process.argv[2] ?? 'http://localhost:3101';
const url = `${baseUrl}/?dtx_demo=primitives&dtx_demo_count=100000&dtx_look=sgl&dtx_look_preset=factory`;
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)));
await page.goto(url, { timeout: 180_000, waitUntil: 'load' });
await page.waitForFunction(() => !!window.__sglLookPipeline && !!window.__dtxViewer && !!window.__dtxViewCull, null, { timeout: 180_000, polling: 500 });
await page.waitForTimeout(4000);

const info = await page.evaluate(() => {
  const p = window.__sglLookPipeline;
  window.__calls = [];
  const orig = p.setDowngradeLevel.bind(p);
  p.setDowngradeLevel = (lv) => { window.__calls.push({ t: performance.now(), lv }); orig(lv); };
  return {
    level: p.downgradeLevel,
    interacting: p.interacting,
    cullDragging: window.__dtxViewCull.dragging,
    cullOptions: window.__dtxViewCull.getOptions(),
    stats: window.__dtxViewCull.getStats?.() ?? null,
    canvas: (() => { const r = window.__dtxViewer.renderer.domElement.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })(),
  };
});
console.log('info', JSON.stringify(info, null, 2));

const box = info.canvas;
const cx = box.x + box.w / 2;
const cy = box.y + box.h / 2;
await page.mouse.move(cx, cy);
await page.mouse.down();
for (let i = 0; i < 60; i += 1) {
  const s = Math.sin((i / 20) * Math.PI * 2);
  await page.mouse.move(cx + 200 * s, cy + 80 * Math.cos((i / 20) * Math.PI * 2));
  await page.waitForTimeout(80);
}
await page.mouse.up();
await page.waitForTimeout(800);
const after = await page.evaluate(() => ({
  level: window.__sglLookPipeline.downgradeLevel,
  cullDragging: window.__dtxViewCull.dragging,
  downgrade: window.__dtxDowngrade ?? null,
  calls: window.__calls.slice(-6),
}));
console.log('after', JSON.stringify(after, null, 2));
await browser.close();
