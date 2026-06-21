import { test, expect } from '@playwright/test';

type MbdPipeResponse = {
  success: boolean
  error_message?: string
  data?: {
    input_refno: string
    branch_refno: string
    branch_name: string
    branch_attrs: Record<string, unknown>
    segments: Record<string, unknown>[]
    dims: Record<string, unknown>[]
    welds: Record<string, unknown>[]
    slopes: Record<string, unknown>[]
    bends: Record<string, unknown>[]
    stats: {
      segments_count: number
      dims_count: number
      welds_count: number
      slopes_count: number
      bends_count: number
    }
  }
}

function buildMbdResponse(refno: string): MbdPipeResponse {
  return {
    success: true,
    data: {
      input_refno: refno,
      branch_refno: refno,
      branch_name: `BR-${refno}`,
      branch_attrs: {},
      segments: [
        {
          id: `seg-${refno}`,
          refno: `S-${refno}`,
          noun: 'STRA',
          arrive: [0, 0, 0],
          leave: [1000, 0, 0],
          length: 1000,
          straight_length: 1000,
        },
      ],
      dims: [
        {
          id: `dim-${refno}`,
          kind: 'segment',
          start: [0, 0, 0],
          end: [1000, 0, 0],
          length: 1000,
          text: '1000',
        },
      ],
      welds: [],
      slopes: [],
      bends: [],
      stats: {
        segments_count: 1,
        dims_count: 1,
        welds_count: 0,
        slopes_count: 0,
        bends_count: 0,
      },
    },
  };
}

test('mbd pipe race: should keep latest request result', async ({ page }) => {
  const firstRefno = '24381_145018';
  const secondRefno = '24381_145019';

  let firstHit = 0;
  let secondHit = 0;
  const malformedQueryUrls: string[] = [];

  await page.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('plant3d-onboarding-v1', JSON.stringify({
      completedGuides: {
        'designer_001__designer__manual': true,
        'designer_001__designer': true,
      },
    }));
  });

  await page.route('**/api/mbd/pipe/**', async (route) => {
    const url = new URL(route.request().url());
    const refno = decodeURIComponent(url.pathname.split('/').pop() || '');
    const mode = url.searchParams.get('mode');
    const includeChainDims = url.searchParams.get('include_chain_dims');
    const includeOverallDim = url.searchParams.get('include_overall_dim');
    const includePortDims = url.searchParams.get('include_port_dims');
    const includeFittings = url.searchParams.get('include_fittings');
    const includeTags = url.searchParams.get('include_tags');
    const includeMaterialBalloons = url.searchParams.get('include_material_balloons');
    const includeWelds = url.searchParams.get('include_welds');
    const includeSlopes = url.searchParams.get('include_slopes');
    const includeBends = url.searchParams.get('include_bends');
    const bendMode = url.searchParams.get('bend_mode');

    if (
      mode !== 'layout_first' ||
      includeChainDims !== 'true' ||
      includeOverallDim !== 'false' ||
      includePortDims !== 'false' ||
      includeFittings !== 'true' ||
      includeTags !== 'true' ||
      includeMaterialBalloons !== 'true' ||
      includeWelds !== 'true' ||
      includeSlopes !== 'false' ||
      includeBends !== 'true' ||
      bendMode !== 'facecenter' ||
      url.searchParams.get('include_layout_result') !== 'true'
    ) {
      malformedQueryUrls.push(url.toString());
    }

    if (refno === firstRefno) {
      firstHit += 1;
      await new Promise<void>((resolve) => setTimeout(resolve, 600));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(buildMbdResponse(firstRefno)),
      });
      return;
    }

    if (refno === secondRefno) {
      secondHit += 1;
      await new Promise<void>((resolve) => setTimeout(resolve, 80));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(buildMbdResponse(secondRefno)),
      });
      return;
    }

    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ success: false, error_message: `unexpected refno: ${refno}` }),
    });
  });

  await page.goto('/?output_project=PlaywrightMbdPipeRace&dtx_demo=primitives&dtx_demo_count=20&mbd_api=v1', { waitUntil: 'domcontentloaded' });

  await page.waitForFunction(
    () => !!(window as any).__xeokitViewer?.scene && !!(window as any).__viewerToolStore,
    null,
    { timeout: 60_000 },
  );

  await page.evaluate(({ first }) => {
    (window as any).__viewerToolStore.requestMbdPipeAnnotation(first, { displayMode: 'full' });
  }, { first: firstRefno });

  await expect
    .poll(() => firstHit, { timeout: 10_000, message: '等待首个请求发出' })
    .toBeGreaterThan(0);

  await page.evaluate(({ second }) => {
    (window as any).__viewerToolStore.requestMbdPipeAnnotation(second, { displayMode: 'full' });
  }, { second: secondRefno });

  await expect
    .poll(
      async () =>
        await page.evaluate(() =>
          (window as any).__plant3dMbdE2E?.getSnapshot?.()?.branch_refno ?? null),
      { timeout: 15_000, message: '等待最新请求渲染完成' },
    )
    .toBe(secondRefno);

  expect(firstHit).toBeGreaterThan(0);
  expect(secondHit).toBeGreaterThan(0);
  expect(malformedQueryUrls).toEqual([]);
});
