import fs from 'node:fs/promises';

import { expect, test, type Page } from '@playwright/test';

/**
 * 三维规范校验工作台（#174 + #175）Playwright 端到端回归测试。
 *
 * 通过 Playwright `page.route` 拦截四套 `/api/v1/rule-check/*` 接口，
 * 无需真实后端即可在真实无头浏览器中验证完整交互链路：
 * - Ribbon「空间计算 → 规范校验」打开右侧 Dock 面板
 * - 四引擎目录自动加载、五专业与关键词/#工单号过滤
 * - BRAN refno 与交互有序选集参数规整透传、四引擎并发评测与徽标渲染
 * - 火灾分区红/黄三维着色覆盖层图例与还原
 * - UTF-8 BOM CSV 与 Schema v1 JSON 真实文件下载内容校验
 * - 单引擎 503 容错降级与 BRAN 必填校验错误提示
 */

const SPATIAL_CATALOG = [
  {
    id: 'LAY-189',
    issue: 189,
    discipline: '布置',
    title: '管道与墙体最小净距',
    requirement: '>=500mm',
    threshold_mm: 500,
    unit: 'mm',
  },
  {
    id: 'HYD-315',
    issue: 315,
    discipline: '水工',
    title: '水工管廊净距',
    requirement: '>=300mm',
    threshold_mm: 300,
    unit: 'mm',
  },
];

const BRAN_CATALOG = [
  {
    id: 'INST-225',
    issue: 225,
    discipline: '仪控',
    title: '流量计前后直管段提醒',
    requirement: '>=5D',
    unit: 'mm',
  },
];

const ROOM_CATALOG = [
  {
    id: 'ELEC-250',
    issue: 250,
    discipline: '电气',
    title: '配电室盘前操作通道宽度',
    requirement: '>=1500mm',
    unit: 'mm',
  },
];

const ATTR_CATALOG = [
  {
    id: 'ELEC-282',
    issue: 282,
    discipline: '电气',
    title: '电缆桥架火灾分区红黄高亮',
    requirement: '扩散性红 / 局部性黄',
    unit: '个',
  },
];

type AppModuleWindow = Window & {
  __appModuleUrl?: (path: string) => string;
  __ruleCheckPainted?: Record<string, string>;
  __ruleCheckFlownTo?: number[] | null;
};

async function openRuleCheckWorkbench(page: Page): Promise<string[]> {
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await page.addInitScript(() => {
    (window as AppModuleWindow).__appModuleUrl = (path: string) => {
      const hit = performance.getEntriesByType('resource').map((entry) => entry.name).find((name) => {
        try {
          return new URL(name).pathname === path;
        } catch {
          return false;
        }
      });
      return hit ?? path;
    };
  });

  // 屏蔽非规则接口的离线后端报错噪音，保证页面稳定进入主工作台
  await page.route('**/api/v1/health**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }),
  );
  await page.route('**/api/v1/dbnums**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ dbnums: [] }) }),
  );
  await page.route('**/api/users**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) }),
  );
  await page.route('**/api/review/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tasks: [] }) }),
  );

  await page.goto('/?output_project=AvevaMarineSample', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[title="三维校审导航"]').first()).toBeVisible({ timeout: 30_000 });

  // 点击 Ribbon「空间计算」页签 →「规范校验」按钮打开右侧 Dock 面板
  await page.getByRole('tab', { name: '空间计算' }).or(page.getByText('空间计算', { exact: true })).first().click();
  await page.getByRole('button', { name: /规范校验/ }).first().click();

  await expect(page.getByTestId('rule-check-total-count')).toBeVisible({ timeout: 15_000 });
  return pageErrors;
}

async function mockAllRuleCheckCatalogs(page: Page, options?: { failBran?: boolean }): Promise<void> {
  await page.route('**/api/v1/rule-check/rules*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SPATIAL_CATALOG) }),
  );
  await page.route('**/api/v1/rule-check/bran/rules*', (route) => {
    if (options?.failBran) {
      return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'bran offline' }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(BRAN_CATALOG) });
  });
  await page.route('**/api/v1/rule-check/rooms/rules*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ROOM_CATALOG) }),
  );
  await page.route('**/api/v1/rule-check/attrs/rules*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ATTR_CATALOG) }),
  );
}

test('从 Ribbon 空间计算打开规范校验面板，自动拉取四套引擎目录并支持专业与关键词过滤', async ({ page }) => {
  await mockAllRuleCheckCatalogs(page);
  const pageErrors = await openRuleCheckWorkbench(page);

  await expect(page.getByTestId('rule-check-total-count')).toHaveText('5 条');
  await expect(page.getByText('LAY-189')).toBeVisible();
  await expect(page.getByText('ELEC-282')).toBeVisible();

  // 按专业过滤：电气应仅剩 ELEC-250 与 ELEC-282
  await page.getByRole('button', { name: /^电气\s+2$/ }).click();
  await expect(page.getByText('ELEC-250')).toBeVisible();
  await expect(page.getByText('ELEC-282')).toBeVisible();
  await expect(page.getByText('LAY-189')).toHaveCount(0);

  // 按工单号关键词过滤：#282 应仅剩 ELEC-282
  const searchInput = page.getByPlaceholder('搜索规则 id / 标题 / 规范要求 / #工单号…');
  await searchInput.fill('#282');
  await expect(page.getByText('ELEC-282')).toBeVisible();
  await expect(page.getByText('ELEC-250')).toHaveCount(0);

  expect(pageErrors).toEqual([]);
});

test('全量运行四套引擎校验，验证徽标渲染、火灾分区着色图例/还原及 CSV/JSON 文件下载内容', async ({ page }) => {
  await mockAllRuleCheckCatalogs(page);

  const capturedUrls: Record<string, URL> = {};

  await page.route('**/api/v1/rule-check/run*', (route) => {
    capturedUrls.spatial = new URL(route.request().url());
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        tree_state: 'ready',
        rules_run: 2,
        elapsed_ms: 14,
        warnings: [],
        results: [
          {
            id: 'LAY-189',
            issue: 189,
            discipline: '布置',
            title: '管道与墙体最小净距',
            requirement: '>=500mm',
            unit: 'mm',
            source_items: 4,
            target_items: 2,
            violation_total: 1,
            truncated: false,
            violations: [
              {
                source: { refno: '24381_10', noun: 'PIPE' },
                target: { refno: '24381_20', noun: 'WALL' },
                measured_mm: 240,
                threshold_mm: 500,
                margin_mm: -260,
                highlight_refnos: ['24381_10', '24381_20'],
              },
            ],
          },
        ],
      }),
    });
  });

  await page.route('**/api/v1/rule-check/bran/run*', (route) => {
    capturedUrls.bran = new URL(route.request().url());
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        branch_refno: '24381_145018',
        flow_direction: 'forward',
        elem_count: 6,
        rules_run: 1,
        warnings: [],
        results: [
          {
            id: 'INST-225',
            issue: 225,
            discipline: '仪控',
            title: '流量计前后直管段提醒',
            requirement: '>=5D',
            unit: 'mm',
            checked_pairs: 1,
            violation_total: 1,
            truncated: false,
            warnings: [],
            violations: [
              {
                source: { refno: '24381_33', noun: 'INST', order: 2 },
                target: { refno: '24381_34', noun: 'ELBO', order: 3 },
                measured_mm: 180,
                threshold_mm: 300,
                margin_mm: -120,
                severity: 'reminder',
                highlight_refnos: ['24381_33', '24381_34'],
                detail: '直管段偏短，建议人工复核',
              },
            ],
          },
        ],
      }),
    });
  });

  await page.route('**/api/v1/rule-check/rooms/run*', (route) => {
    capturedUrls.rooms = new URL(route.request().url());
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        tree_state: 'ready',
        room_count: 2,
        rules_run: 1,
        elapsed_ms: 8,
        warnings: [],
        results: [
          {
            id: 'ELEC-250',
            issue: 250,
            discipline: '电气',
            title: '配电室盘前操作通道宽度',
            requirement: '>=1500mm',
            unit: 'mm',
            rooms_checked: 2,
            violation_total: 1,
            truncated: false,
            violations: [
              {
                room_num: 'R101',
                source_refnos: ['24381_100'],
                target_refnos: ['24381_101'],
                measured_mm: 1150,
                threshold_mm: 1500,
                margin_mm: -350,
                has_column: true,
                highlight_refnos: ['24381_100', '24381_101'],
                detail: '配电室 R101 盘前局部有柱，通道净宽不足',
              },
            ],
          },
        ],
      }),
    });
  });

  await page.route('**/api/v1/rule-check/attrs/run*', (route) => {
    capturedUrls.attrs = new URL(route.request().url());
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        tree_state: 'ready',
        rules_run: 1,
        elapsed_ms: 5,
        warnings: [],
        results: [
          {
            id: 'ELEC-282',
            issue: 282,
            discipline: '电气',
            title: '电缆桥架火灾分区红黄高亮',
            requirement: '扩散性红 / 局部性黄',
            checked_items: 2,
            violation_total: 2,
            truncated: false,
            violations: [
              {
                source_refno: '24381_500',
                source_noun: 'CTRAY',
                highlight_color: 'red',
                highlight_refnos: ['24381_500'],
                detail: '穿越扩散性火灾分区边界',
              },
              {
                source_refno: '24381_501',
                source_noun: 'CTRAY',
                highlight_color: 'yellow',
                highlight_refnos: ['24381_501'],
                detail: '处于局部性火灾保护区',
              },
            ],
          },
        ],
      }),
    });
  });

  const pageErrors = await openRuleCheckWorkbench(page);
  await expect(page.getByTestId('rule-check-total-count')).toHaveText('5 条');

  // 填写带斜杠的 BRAN refno 与交互有序选集，验证自动规整为下划线格式
  await page.getByPlaceholder('如 24381_145018（BRAN 拓扑规则必填）').fill('24381/145018');
  await page.getByPlaceholder('可选：逗号分隔 refno（通道/火灾/点选支架）').fill('24381/10, 24381/20');

  await page.getByTestId('rule-check-run-btn').click();

  const rows = page.getByTestId('rule-check-violation-row');
  await expect(rows).toHaveCount(5);

  // 验证四引擎均被调用且 refno 规范化正确
  expect(capturedUrls.spatial).toBeDefined();
  expect(capturedUrls.bran?.searchParams.get('refno')).toBe('24381_145018');
  expect(capturedUrls.rooms).toBeDefined();
  expect(capturedUrls.attrs?.searchParams.get('refno')).toBe('24381_10,24381_20');

  // 验证分级 / 有柱 / 火灾分区红黄徽标全部渲染
  await expect(page.getByText('配电室 R101 盘前局部有柱，通道净宽不足')).toBeVisible();
  await expect(page.getByText('有柱', { exact: true })).toBeVisible();
  await expect(page.getByText('扩散性火灾', { exact: true })).toBeVisible();
  await expect(page.getByText('局部性火灾', { exact: true })).toBeVisible();
  await expect(page.getByText('提醒', { exact: true })).toBeVisible();

  // 在浏览器侧注入轻量 DTX 视口桩，使离线无后端场景也能完整验通「定位高亮」「火灾着色」「还原」全链路
  await page.evaluate(async () => {
    const win = window as AppModuleWindow;
    win.__ruleCheckPainted = {};
    win.__ruleCheckFlownTo = null;
    const modUrl = win.__appModuleUrl?.('/src/composables/useViewerContext.ts') ?? '/src/composables/useViewerContext.ts';
    const mod = await import(/* @vite-ignore */ modUrl) as {
      useViewerContext: () => { viewerRef: { value: unknown } };
    };
    mod.useViewerContext().viewerRef.value = {
      __dtxLayer: {
        getAllObjectIds: () => ['o:24381_10:0', 'o:24381_20:0', 'o:24381_500:0', 'o:24381_501:0', 'o:24381_999:0'],
        setObjectColor: (objectId: string, color: { getHexString: () => string }) => {
          win.__ruleCheckPainted![objectId] = `#${color.getHexString()}`;
        },
        resetObjectColor: (objectId: string) => {
          delete win.__ruleCheckPainted![objectId];
        },
      },
      requestRender: () => {},
      scene: {
        getLoadedRefnos: () => ['24381_10', '24381_20', '24381_500', '24381_501', '24381_999'],
        getSubtreeRefnos: (refnos: string[]) => refnos,
        ensureRefnos: () => {},
        setObjectsVisible: () => {},
        setObjectsSelected: () => {},
        setObjectsXRayed: () => {},
        getAABB: () => [0, 0, 0, 10, 10, 10],
      },
      cameraFlight: {
        flyTo: (opts: { aabb?: number[] }) => {
          win.__ruleCheckFlownTo = opts.aabb ?? null;
        },
      },
    };
  });

  // 点击首条违规的「定位高亮」验证三维相机飞行调用
  await page.getByTestId('rule-check-focus-btn').first().click();
  await expect.poll(() => page.evaluate(() => (window as AppModuleWindow).__ruleCheckFlownTo)).toEqual([0, 0, 0, 10, 10, 10]);

  // 点击火灾着色并验证红/黄着色覆盖层与实时图例，随后一键还原
  await page.getByTestId('rule-check-firezone-overlay-btn').click();
  await expect(page.getByTestId('rule-check-overlay-legend')).toBeVisible();
  await expect(page.getByTestId('rule-check-overlay-legend')).toContainText('已着色 2 构件 / 2 图元');
  const painted = await page.evaluate(() => (window as AppModuleWindow).__ruleCheckPainted);
  expect(painted).toEqual({
    'o:24381_500:0': '#ef4444',
    'o:24381_501:0': '#eab308',
  });

  await page.getByTestId('rule-check-clear-overlay-btn').click();
  await expect(page.getByTestId('rule-check-overlay-legend')).toHaveCount(0);
  const afterClear = await page.evaluate(() => (window as AppModuleWindow).__ruleCheckPainted);
  expect(afterClear).toEqual({});

  // 验证真实 CSV 文件下载（UTF-8 BOM + 中文列头 + 火灾红黄与有柱字段）
  const [csvDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('rule-check-export-csv-btn').click(),
  ]);
  expect(csvDownload.suggestedFilename()).toMatch(/^rule-check-report-\d{8}-\d{6}\.csv$/);
  const csvPath = await csvDownload.path();
  expect(csvPath).toBeTruthy();
  const csvText = await fs.readFile(csvPath!, 'utf8');
  expect(csvText.startsWith('\uFEFF')).toBe(true);
  expect(csvText).toContain('引擎,规则ID,工单号,专业');
  expect(csvText).toContain('红(扩散性火灾)');
  expect(csvText).toContain('黄(局部性火灾)');
  expect(csvText).toContain(',R101,是,');

  // 验证真实 JSON 文件下载（Schema v1 结构与汇总数）
  const [jsonDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('rule-check-export-json-btn').click(),
  ]);
  expect(jsonDownload.suggestedFilename()).toMatch(/^rule-check-report-\d{8}-\d{6}\.json$/);
  const jsonPath = await jsonDownload.path();
  expect(jsonPath).toBeTruthy();
  const report = JSON.parse(await fs.readFile(jsonPath!, 'utf8')) as {
    schemaVersion: number;
    summary: { firezones: number; reminders: number; totalReported: number };
    violations: unknown[];
  };
  expect(report.schemaVersion).toBe(1);
  expect(report.summary.firezones).toBe(2);
  expect(report.summary.reminders).toBe(1);
  expect(report.summary.totalReported).toBe(5);
  expect(report.violations).toHaveLength(5);

  // 结果分级快筛（火灾分区 → 2/5）+ 按规则分组折叠与组级定位
  await page.getByTestId('rule-check-result-filter-firezone').click();
  await expect(page.getByTestId('rule-check-result-filtered-count')).toHaveText('2/5');
  await expect(page.getByTestId('rule-check-violation-row')).toHaveCount(2);

  await page.getByTestId('rule-check-group-toggle-btn').click();
  await expect(page.getByTestId('rule-check-violation-group')).toHaveCount(1);
  await page.getByTestId('rule-check-group-header').first().click();
  await expect(page.getByTestId('rule-check-violation-row')).toHaveCount(0);

  expect(pageErrors).toEqual([]);
});

test('单引擎目录 503 时容错降级加载其余三引擎，单独运行 BRAN 缺 refno 时提示错误', async ({ page }) => {
  await mockAllRuleCheckCatalogs(page, { failBran: true });
  const pageErrors = await openRuleCheckWorkbench(page);

  await expect(page.getByTestId('rule-check-total-count')).toHaveText('4 条');
  await expect(page.getByText(/BRAN 拓扑规则目录加载失败/)).toBeVisible();

  await page.getByRole('button', { name: /BRAN 拓扑/ }).click();
  await page.getByTestId('rule-check-run-btn').click();
  await expect(page.getByText(/请先输入或从三维选择一条 BRAN 的 refno/)).toBeVisible();

  expect(pageErrors).toEqual([]);
});
