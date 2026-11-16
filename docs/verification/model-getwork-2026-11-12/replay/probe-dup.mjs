// 只读探查：先单独装一台设备、再装它所在的 ZONE，看同一个构件在场景里有几个对象。
//   node probe-dup.mjs [前端地址]
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FRONT = process.argv[2] ?? 'http://127.0.0.1:3103';
const BACKEND = 'http://127.0.0.1:9199';
const EQUI = '24384_47470';
const BOX = '24384_47471';
const ZONE = '24384_47463';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: [`--disk-cache-dir=${path.join(HERE, 'tmp', 'chrome-cache')}`] });
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const blocked = [];
await context.route('**/*', (route) => {
  const request = route.request();
  const url = new URL(request.url());
  if (url.port === '8022' || url.port === '8009') { blocked.push(request.url()); return route.abort(); }
  if (url.origin === BACKEND && !['GET', 'HEAD', 'OPTIONS'].includes(request.method())
    && !/^\/api\/v1\/(model\/records|meshes\/batch|element\/attributes)$/.test(url.pathname)) { blocked.push(`${request.method()} ${url.pathname}`); return route.abort(); }
  return route.continue();
});
const page = await context.newPage();
const logs = [];
page.on('console', (message) => { const text = message.text(); if (/model-load|loaded_refnos/.test(text)) logs.push(text.slice(0, 260)); });
await page.goto(`${FRONT}/?output_project=AvevaMarineSample&gm_backend=${encodeURIComponent(BACKEND)}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!window.__dtxViewer && !!window.__dtxLayer, null, { timeout: 180_000 });
await page.waitForFunction(async () => {
  const treeStore = await import('/src/composables/useModelTreeStore.ts');
  return (treeStore.getModelTreeInstance()?.flatRows.value.length ?? 0) > 1;
}, null, { timeout: 120_000, polling: 300 });
await page.evaluate(async (id) => {
  const treeStore = await import('/src/composables/useModelTreeStore.ts');
  await treeStore.getModelTreeInstance().expandPathToNode(id, { expandSelf: true });
}, EQUI);

async function clickEye(refno) {
  await page.evaluate(async (id) => {
    const selection = await import('/src/composables/useSelectionStore.ts');
    selection.setGlobalSelectedRefno(id);
  }, refno);
  const row = page.locator(`[data-testid="model-tree-row"][data-refno="${refno}"]`);
  await row.waitFor({ state: 'visible', timeout: 30_000 });
  await row.locator('[data-testid="model-tree-eye"]').click();
  // 和回放脚本一样的等法：这个节点已经在场景里、没有装载在跑，就算装完
  await page.waitForFunction(async ({ id }) => {
    const [generation, sessions] = await Promise.all([import('/src/composables/useModelGeneration.ts'), import('/src/composables/modelLoadSession.ts')]);
    const gen = generation.useModelGeneration({ viewer: { __dtxLayer: window.__dtxLayer } });
    return gen.isRootInScene(id, 8000) && !sessions.hasActiveModelLoad();
  }, { id: refno }, { timeout: 120_000, polling: 100 });
  await sleep(Number(process.env.PROBE_GAP_MS ?? 1200));
}

async function dump(label) {
  const state = await page.evaluate(async ({ box }) => {
    const loader = await import('/src/composables/useDbnoInstancesDtxLoader.ts');
    const layer = window.__dtxLayer;
    const ids = (layer.getAllObjectIds?.() ?? []).filter((id) => loader.resolveDtxRefnoByObjectId(8000, id) === box);
    return {
      total: layer.getAllObjectIds?.().length ?? -1,
      objects: ids.map((id) => ({ id, visible: layer.isObjectVisible(id), t: Array.from(layer.getObjectMatrix(id).elements).slice(12, 15) })),
      byRefno: loader.resolveDtxObjectIdsByRefno(8000, box),
    };
  }, { box: BOX });
  console.log(`${label}：场景共 ${state.total} 个对象；构件 ${BOX} 的对象 ${state.objects.length} 个：${JSON.stringify(state.objects)}；按构件索引查到 ${JSON.stringify(state.byRefno)}`);
}

await clickEye(EQUI);
if (process.env.PROBE_GAP_MS !== '0') await dump('只装了设备 EQ-CASE');
await clickEye(ZONE);
await sleep(1500);
await dump('再装它所在的 ZONE');
const table = await page.evaluate(async () => {
  const loadedNodes = await import('/src/composables/useLoadedNodeStatus.ts');
  return loadedNodes.useLoadedNodeStatus().entries().map((entry) => `${entry.refno}${entry.loaded ? '' : '（没装）'}`);
});
console.log(`已加载节点表：${table.join('、')}`);
console.log('页面日志：');
for (const line of logs) console.log(`  ${line}`);
console.log(`拦下的请求：${blocked.length}`);
await context.close();
await browser.close();
