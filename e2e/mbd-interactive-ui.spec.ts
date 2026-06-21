import { mkdirSync, writeFileSync } from 'node:fs';

import { expect, test } from '@playwright/test';

const runRealUiE2E = process.env.MBD_REAL_UI_E2E === '1';
const backendUrl = process.env.MBD_REAL_BACKEND_URL?.trim() || 'http://127.0.0.1:18082';
const outputProject = process.env.MBD_REAL_OUTPUT_PROJECT?.trim() || 'aps250160-mbd-cata2';
const targetRefno = (process.env.MBD_REAL_REFNO?.trim() || '2013286704_476').replace(/[\\/]/g, '_');
const expectedLengthTexts = (process.env.MBD_REAL_EXPECTED_LENGTHS?.trim() || '600,1073,783')
  .split(/[,;\s]+/)
  .map((item) => item.trim())
  .filter(Boolean);

test.describe.configure({ mode: 'serial' });
test.skip(!runRealUiE2E, 'Set MBD_REAL_UI_E2E=1 to run the real interactive MBD UI flow.');
test.setTimeout(120_000);

type Page = import('@playwright/test').Page;

type MbdApiCapture = {
  apiRequests: string[]
  apiResponses: { url: string; status: number }[]
};

type MbdScreenItem = {
  id: string
  text: string
  x: number
  y: number
  in_viewport: boolean
};

function captureMbdApi(page: Page): MbdApiCapture {
  const apiRequests: string[] = [];
  const apiResponses: { url: string; status: number }[] = [];

  page.on('request', (request) => {
    const url = request.url();
    if (url.includes('/api/mbd/v2/pipe/') || url.includes('/api/mbd/pipe/')) {
      apiRequests.push(url);
    }
  });
  page.on('response', (response) => {
    const url = response.url();
    if (url.includes('/api/mbd/v2/pipe/') || url.includes('/api/mbd/pipe/')) {
      apiResponses.push({ url, status: response.status() });
    }
  });

  return { apiRequests, apiResponses };
}

function pickExpectedItems(snapshot: any): MbdScreenItem[] {
  const expected = new Set(expectedLengthTexts);
  return (snapshot?.screen_items || [])
    .filter((item: any) => expected.has(String(item.text || '').trim()))
    .map((item: any) => ({
      id: String(item.id ?? ''),
      text: String(item.text || '').trim(),
      x: Number(item.x),
      y: Number(item.y),
      in_viewport: item.in_viewport === true,
    }))
    .sort((a: MbdScreenItem, b: MbdScreenItem) =>
      a.text.localeCompare(b.text) || a.id.localeCompare(b.id));
}

async function openViewer(page: Page): Promise<string> {
  await page.addInitScript(() => {
    localStorage.removeItem('plant3d-web-mbd-drawing-style-v1');
  });

  const viewerUrl = `/viewer/?backend=${encodeURIComponent(backendUrl)}&output_project=${encodeURIComponent(outputProject)}&mbd_debug=1&mbd_api_debug=1&mbd_dim_text=backend&cache_bust=${Date.now()}`;
  await page.goto(viewerUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForFunction(() => !!(window as any).__plant3dMbdE2E && !!(window as any).__dtxViewer, null, { timeout: 60_000 });

  return viewerUrl;
}

async function rotateCamera(page: Page): Promise<void> {
  await page.evaluate(() => {
    const viewer = (window as any).__dtxViewer;
    const camera = viewer.camera;
    const controls = viewer.controls;
    const target = controls.target.clone();
    const offset = camera.position.clone().sub(target);
    offset.applyAxisAngle(camera.up.clone().normalize(), Math.PI / 5);
    camera.position.copy(target.clone().add(offset));
    camera.lookAt(target);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    controls.update();
    controls.dispatchEvent({ type: 'change' });
  });
}

function hasMoved(beforeItems: MbdScreenItem[], afterItems: MbdScreenItem[]): boolean {
  return beforeItems.some((beforeItem) => {
    const afterItem = afterItems.find((item) => item.id === beforeItem.id);
    if (!afterItem) return false;
    return Math.hypot(afterItem.x - beforeItem.x, afterItem.y - beforeItem.y) > 5;
  });
}

async function waitForInteractiveMbd(page: Page, refno = targetRefno): Promise<void> {
  await page.waitForFunction(({ expectedTexts, refno: branchRefno }) => {
    const snapshot = (window as any).__plant3dMbdE2E?.getSnapshot?.();
    if (!snapshot || snapshot.branch_refno !== branchRefno) return false;
    const texts = new Set((snapshot.screen_items || []).map((item: any) => String(item.text || '').trim()));
    return Number(snapshot.rendered_counts?.dims || 0) >= expectedTexts.length &&
      expectedTexts.every((text: string) => texts.has(text));
  }, { refno, expectedTexts: expectedLengthTexts }, { timeout: 80_000 });
}

function assertFullMbdRequest(apiRequests: string[], refno = targetRefno): string {
  const fullMbdRequest = apiRequests.find((url) => url.includes(`/api/mbd/v2/pipe/${refno}`)) ??
    apiRequests.find((url) => url.includes(`/api/mbd/pipe/${refno}`));
  expect(fullMbdRequest).toBeTruthy();

  const query = new URL(fullMbdRequest!).searchParams;
  expect(query.get('include_fittings')).toBe('false');
  expect(query.get('include_tags')).toBe('false');
  expect(query.get('include_material_balloons')).toBe('false');
  expect(query.get('include_welds')).toBe('false');
  expect(query.get('include_bends')).toBe('false');

  return fullMbdRequest!;
}

async function assertCameraAnchoredDimensions(page: Page): Promise<{
  beforeItems: MbdScreenItem[]
  afterItems: MbdScreenItem[]
  after: any
}> {
  const before = await page.evaluate(() => (window as any).__plant3dMbdE2E.getSnapshot());
  const beforeItems = pickExpectedItems(before);
  expect(beforeItems).toHaveLength(expectedLengthTexts.length);
  expect(beforeItems.every((item) => item.in_viewport)).toBe(true);

  await rotateCamera(page);
  await page.waitForTimeout(1200);
  const after = await page.evaluate(() => (window as any).__plant3dMbdE2E.getSnapshot());
  const afterItems = pickExpectedItems(after);
  expect(afterItems).toHaveLength(expectedLengthTexts.length);
  expect(afterItems.every((item) => item.in_viewport)).toBe(true);
  expect(hasMoved(beforeItems, afterItems)).toBe(true);
  expect(Number(after.severe_screen_overlap_count ?? 0)).toBe(0);

  return { beforeItems, afterItems, after };
}

function writeArtifact(name: string, data: Record<string, unknown>): void {
  mkdirSync('tmp', { recursive: true });
  writeFileSync(`tmp/${name}.json`, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

test('Ribbon menu generates full interactive 3D MBD annotations for a real BRAN', async ({ page }) => {
  const apiCapture = captureMbdApi(page);
  const viewerUrl = await openViewer(page);

  await page.evaluate((refno) => {
    (window as any).__plant3dMbdE2E.setSelectedRefno(refno);
  }, targetRefno);

  await page.locator('[data-ribbon-tab="mbd"]').click();
  await page.locator('[data-command="mbd.generate"]').first().click();

  await waitForInteractiveMbd(page);
  const fullMbdRequest = assertFullMbdRequest(apiCapture.apiRequests);
  const { beforeItems, afterItems, after } = await assertCameraAnchoredDimensions(page);

  await page.locator('[data-ribbon-tab="mbd"]').click();
  await page.locator('[data-command="mbd.settings"]').first().click();
  await expect(page.getByText('MBD 管道标注样式')).toBeVisible();
  await page.getByTestId('mbd-style-preset-light').click();
  await page.waitForTimeout(300);

  await expect.poll(
    async () => page.evaluate(() => {
      const snapshot = (window as any).__plant3dMbdE2E.getSnapshot();
      return (snapshot.line_object_states || []).some((item: any) =>
        item.visible &&
        ['dimensionLineA', 'dimensionLineB', 'dimensionLineOutside'].includes(String(item.line_role || '')) &&
        String(item.color_hex || '').toLowerCase() === '#b91c1c');
    }),
    { timeout: 15_000, message: '等待 full 交互 MBD 标注应用样式预设' },
  ).toBe(true);

  writeArtifact(`mbd-real-${targetRefno}-interactive-ui-menu`, {
    viewerUrl,
    fullMbdRequest,
    apiResponses: apiCapture.apiResponses,
    beforeItems,
    afterItems,
    renderedCounts: after.rendered_counts,
    dataCounts: after.data_counts,
  });
});

test('Model tree context menu generates full interactive 3D MBD annotations for a real BRAN', async ({ page }) => {
  const apiCapture = captureMbdApi(page);
  const viewerUrl = await openViewer(page);

  await page.waitForFunction(() => !!(window as any).__plant3dModelTreeE2E, null, { timeout: 60_000 });
  await page.waitForFunction(() => {
    const snapshot = (window as any).__plant3dModelTreeE2E?.getSnapshot?.();
    return Array.isArray(snapshot?.rootIds) && snapshot.rootIds.length > 0 && Number(snapshot.flatRowCount || 0) > 0;
  }, null, { timeout: 60_000 });
  const treeSnapshot = await page.evaluate(async (refno) => {
    return await (window as any).__plant3dModelTreeE2E.focusRefno(refno);
  }, targetRefno);
  if (treeSnapshot.error || treeSnapshot.targetIndex < 0) {
    writeArtifact(`mbd-real-${targetRefno}-model-tree-focus-failed`, {
      viewerUrl,
      treeSnapshot,
    });
  }
  expect(treeSnapshot.error).toBeNull();
  expect(treeSnapshot.targetIndex).toBeGreaterThanOrEqual(0);
  expect(treeSnapshot.targetNode?.type).toBe('BRAN');

  const branchRow = page.locator(`[data-testid="model-tree-row"][data-refno="${targetRefno}"]`).first();
  await expect(branchRow).toBeVisible({ timeout: 60_000 });
  await expect(branchRow).toHaveAttribute('data-node-type', 'BRAN', { timeout: 10_000 });

  await branchRow.click({ button: 'right' });
  const menuItem = page.getByTestId('model-tree-generate-mbd');
  await expect(menuItem).toBeVisible({ timeout: 10_000 });
  await expect(menuItem).toHaveAttribute('data-refno', targetRefno);
  await menuItem.click();

  await waitForInteractiveMbd(page);
  const fullMbdRequest = assertFullMbdRequest(apiCapture.apiRequests);
  const { beforeItems, afterItems, after } = await assertCameraAnchoredDimensions(page);

  writeArtifact(`mbd-real-${targetRefno}-model-tree-context-menu`, {
    viewerUrl,
    fullMbdRequest,
    apiResponses: apiCapture.apiResponses,
    beforeItems,
    afterItems,
    renderedCounts: after.rendered_counts,
    dataCounts: after.data_counts,
  });
});
