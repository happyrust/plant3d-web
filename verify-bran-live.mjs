import { chromium } from 'playwright';

const FRONT = process.env.FRONT || 'http://127.0.0.1:5173';
const params = new URLSearchParams({
  output_project: 'AvevaMarineSample',
  show_dbnum: '7997',
  show_refno: '24381_145018',
  data_source: 'backend',
  backendPort: '3100',
});
const URL = `${FRONT}/?${params.toString()}`;
const OUT = 'D:/work/plant-code/plant3d-web/bran-24381_145018-live-verify.png';

const logs = [];
const net = [];

const browser = await chromium.launch({
  headless: true,
  args: ['--ignore-gpu-blocklist', '--enable-webgl', '--use-angle=swiftshader'],
});
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await ctx.newPage();
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`.slice(0, 300)));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`.slice(0, 300)));
page.on('response', (r) => {
  const u = r.url();
  if (u.includes('/api/') || u.includes('realtime') || u.includes('/files/') || u.includes('/model-version'))
    net.push(`[${r.status()}] ${r.request().method()} ${u}`.slice(0, 200));
});

console.log('GOTO', URL);
try {
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
} catch (e) {
  console.log('goto error:', e.message);
}

const hasCanvas = await page.waitForSelector('canvas', { timeout: 60000 }).then(() => true).catch(() => false);
console.log('hasCanvas:', hasCanvas);

await page.waitForLoadState('networkidle', { timeout: 45000 }).catch(() => console.log('networkidle timeout (ok, viewer may poll)'));
await page.waitForTimeout(12000);

// Probe whether the main canvas has non-blank pixels
let canvasInfo = null;
try {
  canvasInfo = await page.evaluate(() => {
    const cs = Array.from(document.querySelectorAll('canvas'));
    return cs.map((c) => ({ id: c.id, w: c.width, h: c.height, cls: (c.className || '').slice(0, 40) }));
  });
} catch {}

await page.screenshot({ path: OUT, fullPage: false });
console.log('SCREENSHOT', OUT);
console.log('CANVASES', JSON.stringify(canvasInfo));
console.log('--- NET (last 40) ---');
console.log(net.slice(-40).join('\n'));
console.log('--- LOGS (last 50) ---');
console.log(logs.slice(-50).join('\n'));

await browser.close();
