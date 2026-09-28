import { chromium } from 'playwright';

const FRONT = process.env.FRONT || 'http://127.0.0.1:5173';
const OUTDIR = 'D:/work/plant-code/plant3d-web';
const UNIT = '24381_145018';
const MOVED = '24381_145019';

const logs = [];
const browser = await chromium.launch({
  headless: true,
  args: ['--ignore-gpu-blocklist', '--enable-webgl', '--use-angle=swiftshader'],
});
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await ctx.newPage();
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`.slice(0, 400)));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`.slice(0, 400)));

const shot = async (name) => { await page.screenshot({ path: `${OUTDIR}/${name}` }); console.log('SHOT', name); };
const step = async (label, fn) => { try { await fn(); console.log('OK', label); } catch (e) { console.log('FAIL', label, e.message); } };

console.log('GOTO');
await page.goto(`${FRONT}/?output_project=AvevaMarineSample&unit_refno=${UNIT}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('canvas', { timeout: 60000 });
await page.waitForTimeout(9000);

// 1) Open ribbon 任务 tab, then 版本对比 button
await step('click 任务 tab', async () => {
  await page.getByText('任务', { exact: true }).first().click({ timeout: 8000 });
  await page.waitForTimeout(800);
});
await step('click 版本对比', async () => {
  await page.getByText('版本对比', { exact: true }).first().click({ timeout: 8000 });
  await page.waitForTimeout(1500);
});

// 2) Ensure panel present + fill refno + load versions
await step('panel visible', async () => {
  await page.waitForSelector('[data-testid="model-unit-version-compare-panel"]', { timeout: 8000 });
});
await step('fill refno', async () => {
  const input = page.locator('[data-testid="model-unit-compare-refno"]');
  await input.fill(UNIT, { timeout: 5000 });
});
await step('click 查询 load', async () => {
  await page.locator('[data-testid="model-unit-compare-load"]').click({ timeout: 5000 });
  await page.waitForSelector('[data-testid="model-unit-compare-a"]', { timeout: 15000 });
});
await page.waitForTimeout(1500);
await shot('bran-compare-00-panel.png');

// 3) Run 3D compare
await step('click 在三维中对比 run', async () => {
  await page.locator('[data-testid="model-unit-compare-run"]').click({ timeout: 5000 });
});
// wait for compare state ready
await step('await compare ready', async () => {
  await page.waitForFunction(() => {
    const s = window.__modelUnitVersionCompare;
    return !!s && (s.status === 'ready' || s.status === undefined);
  }, { timeout: 30000 });
});
await page.waitForTimeout(4000);
const state1 = await page.evaluate(() => window.__modelUnitVersionCompare || null);
console.log('STATE after run', JSON.stringify(state1));
await shot('bran-compare-01-single-after.png');

// 4) Switch to split (双视口分屏)
await step('click split mode', async () => {
  await page.locator('[data-testid="model-unit-compare-split-mode"]').click({ timeout: 5000 });
  await page.waitForTimeout(3000);
});
await shot('bran-compare-02-split.png');

// 5) Focus the moved component to make the 1m shift obvious
await step('focus moved refno row', async () => {
  const row = page.locator('[data-testid="model-unit-compare-list"]').getByText(MOVED, { exact: false }).first();
  await row.click({ timeout: 5000 });
  await page.waitForTimeout(2500);
});
await shot('bran-compare-03-split-focus-moved.png');

// 6) Toggle single before vs after (only meaningful after switching back to single)
await step('back to single', async () => {
  await page.locator('[data-testid="model-unit-compare-single-mode"]').click({ timeout: 5000 });
  await page.waitForTimeout(1500);
});
await step('show before (897)', async () => {
  await page.locator('[data-testid="model-unit-compare-show-before"]').click({ timeout: 5000 });
  await page.waitForTimeout(2500);
});
await shot('bran-compare-04-single-before-897.png');
await step('show after (898)', async () => {
  await page.locator('[data-testid="model-unit-compare-show-after"]').click({ timeout: 5000 });
  await page.waitForTimeout(2500);
});
await shot('bran-compare-05-single-after-898.png');

console.log('--- relevant logs ---');
console.log(logs.filter((l) => /compare|对比|unit version|modelUnit|manifest|missing|错误|error|placement|position/i.test(l)).slice(-60).join('\n'));

await browser.close();
