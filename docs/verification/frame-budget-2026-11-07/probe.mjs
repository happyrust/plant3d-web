// 探测：页面是否起了 viewer / 管线，后端请求是否通。
import { createRequire } from 'node:module';
const require = createRequire('D:/work/plant-code/old/plant3d-web/package.json');
const { chromium } = require('playwright');

const baseUrl = process.argv[2] ?? 'http://localhost:3101';
const url = `${baseUrl}/?show_dbnum=7997&dtx_look=sgl&dtx_look_preset=factory`;
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('console', (m) => console.log('[console]', m.type(), m.text().slice(0, 300)));
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 400)));
page.on('response', (r) => {
  const u = r.url();
  if (u.includes('/api/')) console.log('[resp]', r.status(), u.slice(0, 160));
});
await page.goto(url, { timeout: 120_000, waitUntil: 'load' });
await page.waitForTimeout(15000);
const state = await page.evaluate(() => ({
  dtxViewer: !!window.__dtxViewer,
  dtxLayer: !!window.__dtxLayer,
  pipeline: !!window.__sglLookPipeline,
  cull: !!window.__dtxViewCull,
  box: (() => { try { return window.__dtxLayer?.getBoundingBox?.().isEmpty?.() ?? 'n/a'; } catch (e) { return String(e); } })(),
  bodyText: document.body.innerText.slice(0, 400),
}));
console.log(JSON.stringify(state, null, 2));
await browser.close();
