import { test, expect } from '@playwright/test';

/**
 * 路由钉子（收口计划 2026-09-09 §2 / D8 翻默认；2026-09-20 legacy 退役后收紧）：数据源只有 `gen-model-v1`。
 *
 * - 不带任何参数打开页面：页面判定的数据源是 `gen-model-v1`，模型树 / 库元信息 / 徽标发出的
 *   请求全部落在 gen-model `/api/v1/*`，一发旧链路（`/api/e3d/*`、`/api/pdms/*`、`/api/projects`、
 *   `/files/output/**`、`/files/meshes/**`）都没有；
 * - `?model_source=legacy` 已不是开关：带着它打开页面结果与不带一样（旧链路零请求）。
 *
 * 只看「请求发往哪里」，不看应答——gen-model 在不在都能跑，不是 live 对拍
 * （live 对拍见 gen-model-v1-two-source-parity.spec.ts）。
 * 页面其它面板（尺寸 / 校审）对同源 `/api/review*` `/api/auth*` 的请求不属于模型数据源，这里不计。
 */

const V1_MARKERS = ['/api/v1/health', '/api/v1/tree/', '/api/v1/dbnums', '/api/v1/tasks', '/api/v1/search', '/api/v1/model/', '/api/v1/element/', '/api/v1/meshes/'];
const LEGACY_MARKERS = ['/api/e3d/', '/api/pdms/', '/api/projects', '/api/search/pdms', '/files/output/', '/files/meshes/'];

type Routed = { v1: string[]; legacy: string[] };

function classify(url: string, into: Routed): void {
  if (V1_MARKERS.some((m) => url.includes(m))) into.v1.push(url);
  else if (LEGACY_MARKERS.some((m) => url.includes(m))) into.legacy.push(url);
}

async function openAndCollect(page: import('@playwright/test').Page, path: string): Promise<{ kind: string; routed: Routed }> {
  const routed: Routed = { v1: [], legacy: [] };
  page.on('request', (req) => classify(req.url(), routed));

  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('canvas', { timeout: 60_000 });

  // 页面自己判定的数据源（与 getModelSource() 用的是同一个函数）
  const kind = await page.evaluate(() =>
    // @ts-expect-error -- browser-side dynamic import is only available at runtime in Playwright.
    import('/src/model-source/kind.ts').then((mod) => mod.getModelSourceKind() as string),
  );

  // 等模型树 / 库元信息 / 徽标的首批取数发出去（后端不在时请求会很快失败，但 request 事件照样有）
  await expect
    .poll(() => routed.v1.length + routed.legacy.length, { timeout: 30_000, intervals: [500, 1000, 2000] })
    .toBeGreaterThan(0);
  await page.waitForTimeout(3_000);

  const short = (urls: string[]) => Array.from(new Set(urls.map((u) => u.replace(/^https?:\/\/[^/]+/, '')))).slice(0, 12);
  console.log(`[model-source-default] ${path} kind=${kind} v1=${routed.v1.length} legacy=${routed.legacy.length}`);
  console.log(`[model-source-default]   v1: ${JSON.stringify(short(routed.v1))}`);
  console.log(`[model-source-default]   legacy: ${JSON.stringify(short(routed.legacy))}`);
  return { kind, routed };
}

test('不带参数打开页面：数据源是 gen-model-v1，模型取数只发往 /api/v1，旧链路零请求', async ({ page }) => {
  const { kind, routed } = await openAndCollect(page, '/');
  expect(kind).toBe('gen-model-v1');
  expect(routed.v1.length).toBeGreaterThan(0);
  expect(routed.legacy, `缺省 v1 下不该有旧链路请求: ${routed.legacy.join(', ')}`).toEqual([]);
});

test('?model_source=legacy 已退役：仍是 gen-model-v1，旧链路零请求', async ({ page }) => {
  const { kind, routed } = await openAndCollect(page, '/?model_source=legacy');
  expect(kind).toBe('gen-model-v1');
  expect(routed.v1.length).toBeGreaterThan(0);
  expect(routed.legacy, `legacy 开关已删，不该有旧链路请求: ${routed.legacy.join(', ')}`).toEqual([]);
});
