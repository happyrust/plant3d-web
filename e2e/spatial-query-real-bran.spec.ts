import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

import {
  buildSpatialQueryRealBranConfig,
  KNOWN_REAL_BRANCH_FIXTURES,
  resolveSpatialQueryRealBranConfig,
} from './helpers/spatialQueryRealBran';
const DEFAULT_REAL_BRAN_CASES = ['24381_145018'];

test.describe.configure({ mode: 'serial' });
test.setTimeout(180_000);

function parseSummaryCounts(summary: string): { total: number; loaded: number; unloaded: number } | null {
  const matched = summary.match(/共\s*(\d+)\s*项，已加载\s*(\d+)\s*项，未加载\s*(\d+)\s*项/);
  if (!matched) return null;
  return {
    total: Number(matched[1]),
    loaded: Number(matched[2]),
    unloaded: Number(matched[3]),
  };
}

async function fetchBranchAabb(request: APIRequestContext, refnoUnderscore: string) {
  const known = KNOWN_REAL_BRANCH_FIXTURES[refnoUnderscore];
  if (known?.aabb) {
    return known.aabb;
  }
  const response = await request.get(`http://127.0.0.1:3100/api/mbd/pipe/${refnoUnderscore}`);
  expect(response.ok()).toBe(true);
  const payload = await response.json() as {
    success?: boolean;
    data?: {
      segments?: { arrive?: [number, number, number] | null; leave?: [number, number, number] | null }[];
    };
  };
  expect(payload.success).toBe(true);

  const points = (payload.data?.segments || []).flatMap((segment) => {
    const out: number[][] = [];
    if (Array.isArray(segment.arrive)) out.push(segment.arrive);
    if (Array.isArray(segment.leave)) out.push(segment.leave);
    return out;
  });
  expect(points.length).toBeGreaterThan(0);

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;

  for (const [x, y, z] of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    maxZ = Math.max(maxZ, z);
  }

  const padding = 100;
  return [
    minX - padding,
    minY - padding,
    minZ - padding,
    maxX + padding,
    maxY + padding,
    maxZ + padding,
  ] as const;
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('plant3d-menu-mode', 'ribbon');
    localStorage.removeItem('plant3d-onboarding-v1');

    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
      const resolvedUrl = new URL(url, window.location.href);
      if (resolvedUrl.pathname === '/api/projects') {
        const params = new URLSearchParams(window.location.search);
        const projectPath = params.get('output_project')?.trim() || 'AvevaMarineSample';
        const payload = {
          items: [
            {
              id: projectPath,
              name: projectPath,
              notes: '',
              updated_at: '2026-04-13T00:00:00Z',
            },
          ],
          total: 1,
          page: 1,
          per_page: 20,
        };
        return new Response(JSON.stringify(payload), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        });
      }
      return originalFetch(input, init);
    };
  });
});

async function runRealBranSpatialQueryCase(
  page: Page,
  request: APIRequestContext,
  config = resolveSpatialQueryRealBranConfig(),
) {
  const branchAabb = await fetchBranchAabb(request, config.refno);
  const selectedRadius = config.radii[config.radii.length - 1];
  const branchCenter = {
    x: (branchAabb[0] + branchAabb[3]) / 2,
    y: (branchAabb[1] + branchAabb[4]) / 2,
    z: (branchAabb[2] + branchAabb[5]) / 2,
  };

  await page.goto(config.url, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: '空间查询', exact: true })).toBeVisible({ timeout: 60_000 });
  const onboardingClose = page.getByRole('button', { name: '关闭向导', exact: true });
  if (await onboardingClose.isVisible().catch(() => false)) {
    await onboardingClose.click({ force: true }).catch(() => {});
    await expect(onboardingClose).toBeHidden({ timeout: 5_000 }).catch(() => {});
  }

  await page.waitForFunction(() => {
    return typeof window !== 'undefined' && !!(window as any).__xeokitViewer?.scene;
  }, null, { timeout: 60_000 });

  await page.evaluate(({ refno, aabb }) => {
    const viewer = (window as any).__xeokitViewer;
    if (!viewer?.scene?.objects) {
      throw new Error('viewer scene 未就绪');
    }
    viewer.scene.objects[refno] = {
      ...(viewer.scene.objects[refno] || {}),
      id: refno,
      visible: true,
      selected: false,
      xrayed: false,
      noun: 'BRAN',
      aabb,
    };
  }, { refno: config.refno, aabb: branchAabb });

  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('openSpatialQuery', {
      detail: {
        mode: 'range',
      },
    }));
  });
  await expect(page.getByText('执行空间查询', { exact: true })).toBeVisible({ timeout: 30_000 });

  await page.getByRole('button', { name: '范围查询', exact: true }).click();
  await page.getByRole('button', { name: '手输坐标', exact: true }).click();
  await page.locator('label:has-text("X") input').fill(String(branchCenter.x));
  await page.locator('label:has-text("Y") input').fill(String(branchCenter.y));
  await page.locator('label:has-text("Z") input').fill(String(branchCenter.z));

  await page.getByLabel('查询半径 (mm)').fill(String(selectedRadius));
  await page.getByLabel('最大结果数').fill('100');
  await page.getByLabel('Noun 类型（逗号分隔）').fill(config.nouns.join(','));

  const queryPromise = page.waitForResponse((resp) => {
    if (!resp.url().includes('/api/sqlite-spatial/query')) return false;
    const url = new URL(resp.url());
    return url.searchParams.get('mode') === 'position'
      && url.searchParams.get('radius') === String(selectedRadius)
      && url.searchParams.get('shape') === 'sphere'
      && url.searchParams.get('nouns') === config.nouns.join(',');
  }, { timeout: 60_000 });

  await page.getByRole('button', { name: '执行空间查询', exact: true }).click();
  const queryResp = await queryPromise;
  expect(queryResp.ok()).toBe(true);

  const summary = page.locator('text=/共\\s*\\d+\\s*项，已加载\\s*\\d+\\s*项，未加载\\s*\\d+\\s*项/');
  await expect(summary).toBeVisible({ timeout: 60_000 });
  const summaryText = await summary.textContent();
  const counts = parseSummaryCounts(summaryText || '');

  expect(counts).not.toBeNull();
  expect(counts?.total ?? 0).toBeGreaterThan(0);

  const targetRow = page.getByRole('button').filter({ hasText: config.refno }).first();
  await expect(targetRow).toBeVisible({ timeout: 60_000 });
  await targetRow.click();

  await expect(page.getByText(/查看器未就绪|无法解析当前选中构件的位置|空间查询失败|加载模型失败/)).toHaveCount(0);

  if ((counts?.unloaded ?? 0) > 0) {
    await page.getByRole('button', { name: '只加载未加载结果', exact: true }).click();
    await expect.poll(async () => {
      const nextText = await summary.textContent();
      const nextCounts = parseSummaryCounts(nextText || '');
      return nextCounts?.unloaded ?? Number.NaN;
    }, { timeout: 120_000 }).toBeLessThan(counts!.unloaded);
  }
}

const multiRefnosRaw = process.env.SPATIAL_QUERY_E2E_REFNOS?.trim();
const caseRefnos = multiRefnosRaw
  ? multiRefnosRaw.split(',').map((item) => item.trim()).filter(Boolean)
  : [process.env.SPATIAL_QUERY_E2E_REFNO?.trim() || DEFAULT_REAL_BRAN_CASES[0]];

for (const refnoRaw of caseRefnos) {
  test(`真实 BRAN ${refnoRaw.replace(/\//g, '_')} 可驱动范围查询并返回结果`, async ({ page, request }) => {
    const base = resolveSpatialQueryRealBranConfig();
    const config = buildSpatialQueryRealBranConfig(refnoRaw, base);
    await runRealBranSpatialQueryCase(page, request, config);
  });
}
