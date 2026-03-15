import { test, expect } from '@playwright/test';

test('debug show_dbnum=7997 loads parquet and renders some objects', async ({ page }) => {
  const url = '/?output_project=AvevaMarineSample&show_dbnum=7997';

  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  page.on('console', (msg) => {
    // Playwright e2e 下 isDev=false，很多内部日志不会走 console.error；这里先尽量收集 error 线索。
    if (msg.type() === 'error') errors.push(`[console.error] ${msg.text()}`);
  });

  // 记录关键网络请求（show_dbnum 路径下应该会出现 /files/output/.../manifest_7997.json 以及 parquet 文件 Range 请求）
  const requests: { method: string; url: string; status?: number }[] = [];
  page.on('request', (req) => {
    const u = req.url();
    if (u.includes('/files/') || u.includes('/api/')) {
      requests.push({ method: req.method(), url: u });
    }
  });
  page.on('response', (resp) => {
    const u = resp.url();
    if (u.includes('/files/') || u.includes('/api/')) {
      const item = requests
        .slice()
        .reverse()
        .find((r) => r.url === u && r.status === undefined);
      if (item) item.status = resp.status();
    }
  });

  await page.goto(url, { waitUntil: 'domcontentloaded' });

  // Viewer 一定会渲染 canvas
  await page.waitForSelector('canvas', { timeout: 60_000 });

  // 给 show_dbnum 分支足够时间跑完（DuckDB 初始化 + parquet 扫描 + 分批 load）
  await page.waitForTimeout(5_000);

  // 主动读取 show_dbnum，以排除“URL 没传进去/被改写”的情况
  const urlInfo = await page.evaluate(() => {
    return {
      href: window.location.href,
      search: window.location.search,
      show_dbnum: new URLSearchParams(window.location.search).get('show_dbnum'),
      output_project: new URLSearchParams(window.location.search).get('output_project'),
    };
  });
  console.log('Location info:', JSON.stringify(urlInfo, null, 2));

  // 等待出现“已加载过某个 dbno”的标记（__dtxAfterInstancesLoaded 会写入）
  // 最长等 120s，避免全量 7997 慢导致误判
  await expect
    .poll(
      async () => {
        return await page.evaluate(() => {
          // @ts-expect-error -- browser-side dynamic import is only available at runtime in Playwright.
          return import('/src/composables/useViewerContext.ts').then((mod) => {
            const ctx = mod.useViewerContext();
            const v: any = ctx.viewerRef.value;
            return v?.__dtxLastLoadedDbno ?? null;
          });
        });
      },
      { timeout: 120_000, intervals: [1000, 2000, 5000] }
    )
    .toBe(7997);

  // 注意：ViewerPanel 里 __xeokitViewer 只在 import.meta.env.DEV 时注入；e2e 跑的是 dev server 但 Playwright 可能仍拿不到这个变量。
  // 更可靠的方式：读 useViewerContext 的单例引用是否已建立（ctx.viewerRef / ctx.viewerRef.__dtxAfterInstancesLoaded 写入的 lastLoaded）。
  const state = await page.evaluate(() => {
    // useViewerContext 返回的是模块内单例，这里在浏览器上下文里 import 同一个模块即可读到 ViewerPanel 写入的 viewerRef。
    // 注意：这里不要用 async import（会变成另一个 chunk / 运行时上下文差异），用静态 URL import。
     
    // @ts-expect-error -- browser-side dynamic import is only available at runtime in Playwright.
    return import('/src/composables/useViewerContext.ts').then((mod) => {
      const ctx = mod.useViewerContext();
      const v: any = ctx.viewerRef.value;
      return {
        viewerReady: Boolean(v),
        lastDbno: v?.__dtxLastLoadedDbno ?? null,
        lastRefnosCount: Array.isArray(v?.__dtxLastLoadedRefnos) ? v.__dtxLastLoadedRefnos.length : null,
      };
    });
  });

  const key = requests
    .filter((r) => r.url.includes('manifest_7997') || r.url.includes('7997'))
    .slice(0, 80);

  console.log('Key requests:', JSON.stringify(key, null, 2));
  console.log('State:', JSON.stringify(state, null, 2));

  // 首先确认 viewer 确实初始化了
  expect(state.viewerReady).toBe(true);

  // show_dbnum 这条链路如果生效，至少应当触发一次 __dtxAfterInstancesLoaded 写入 lastDbno
  expect(state.lastDbno).toBe(7997);
  expect(state.lastRefnosCount).toBeGreaterThan(0);

  expect(errors, errors.join('\n')).toEqual([]);
});

