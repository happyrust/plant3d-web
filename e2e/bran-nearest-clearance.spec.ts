import { expect, test } from '@playwright/test';

const DEFAULT_REFNO = '2013286704_476';

type Point = { x: number; y: number; z: number };

type Candidate = {
  refno: string;
  noun: string;
  distance_mm: number;
  nearest?: {
    source_segment_refno?: string | null;
    source_segment_order?: number | null;
    source_point: Point;
    target_point: Point;
    vector: { dx: number; dy: number; dz: number };
  } | null;
  annotation?: {
    start_point: Point;
    end_point: Point;
    label_mm: number;
  } | null;
};

type GroupResult = {
  group: string;
  candidates: Candidate[];
};

type ResponseBody = {
  success: boolean;
  error?: string;
  source?: {
    kind?: string;
    refno?: string;
    segment_count?: number;
    centerline_bbox?: unknown;
  };
  distance_method?: string;
  unit?: string;
  nearest_by_group?: GroupResult[] | Record<string, Candidate[]>;
};

function flattenCandidates(nearestByGroup: ResponseBody['nearest_by_group']): (Candidate & { targetGroup: string })[] {
  if (!nearestByGroup) return [];
  if (Array.isArray(nearestByGroup)) {
    return nearestByGroup.flatMap((group) =>
      (group.candidates ?? []).map((candidate) => ({
        ...candidate,
        targetGroup: group.group,
      })),
    );
  }
  return Object.entries(nearestByGroup).flatMap(([targetGroup, candidates]) =>
    (candidates ?? []).map((candidate) => ({
      ...candidate,
      targetGroup,
    })),
  );
}

test.describe.configure({ mode: 'serial' });
test.setTimeout(120_000);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('plant3d-menu-mode', 'classic');
    localStorage.removeItem('plant3d-onboarding-v1');
  });
});

test('BRAN nearest-clearance browser flow reaches backend and reflects response state', async ({ page }) => {
  const refno = process.env.BRAN_CLEARANCE_E2E_REFNO?.trim() || DEFAULT_REFNO;
  await page.goto('/?backendPort=3100&output_project=AvevaMarineSample', {
    waitUntil: 'domcontentloaded',
  });

  await expect(page.getByRole('button', { name: '空间计算', exact: true })).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: '空间计算', exact: true }).click();
  await page.getByRole('button', { name: '支架空间计算', exact: true }).click();
  await expect(page.getByText('支架空间计算').last()).toBeVisible({ timeout: 30_000 });

  await page.getByRole('button', { name: /展开\s+7\s+个场景/ }).click();
  await page.getByRole('button', { name: /BRAN 中心线最近清距/ }).click();

  await expect(page.getByLabel(/BRAN Refno/)).toBeVisible();
  await page.getByLabel(/BRAN Refno/).fill(refno);
  await page.getByLabel(/search_radius \(mm\)/).fill('5000');
  await page.getByLabel(/target_groups/).fill('wall,column');
  await expect(page.getByLabel(/BRAN Refno/)).toHaveValue(refno);
  await expect(page.getByLabel(/search_radius \(mm\)/)).toHaveValue('5000');
  await expect(page.getByLabel(/target_groups/)).toHaveValue('wall,column');

  const responsePromise = page.waitForResponse((response) => {
    if (!response.url().includes('/api/sqlite-spatial/nearest-clearance')) return false;
    const url = new URL(response.url());
    return url.searchParams.get('source_mode') === 'bran_centerline'
      && url.searchParams.get('source_refno') === refno.replace(/\//g, '_')
      && url.searchParams.get('target_groups') === 'wall,column'
      && url.searchParams.get('radius') === '5000'
      && url.searchParams.get('scope') === 'same_dbnum';
  }, { timeout: 60_000 });

  await page.getByRole('button', { name: '执行计算并定位', exact: true }).click();
  const response = await responsePromise;
  expect(response.ok()).toBe(true);
  expect(new URL(response.url()).port).toBe('3100');

  const body = await response.json() as ResponseBody;
  const candidates = flattenCandidates(body.nearest_by_group);

  await expect(page.getByText('查询结果表')).toBeVisible({ timeout: 30_000 });

  if (!body.success) {
    expect(body.error || '').not.toBe('');
    await expect(page.getByText(body.error!, { exact: false })).toBeVisible();
    const debug = await page.evaluate(() => (window as any).__plant3dBranClearanceAnnotations?.getSnapshot?.());
    expect(debug?.ids ?? []).toEqual([]);
    return;
  }

  expect(body.distance_method).toBe('centerline_aabb_clearance_mm');
  expect(body.unit).toBe('mm');
  expect(body.source?.kind).toBe('bran_centerline');
  expect(body.source?.segment_count ?? 0).toBeGreaterThan(0);
  expect(body.source?.centerline_bbox).toBeTruthy();

  if (candidates.length === 0) {
    const debug = await page.evaluate(() => (window as any).__plant3dBranClearanceAnnotations?.getSnapshot?.());
    expect(debug?.ids ?? []).toEqual([]);
    return;
  }

  const first = candidates[0]!;
  expect(first.annotation?.start_point).toEqual(first.nearest?.source_point);
  expect(first.annotation?.end_point).toEqual(first.nearest?.target_point);
  expect(first.annotation?.label_mm).toBe(first.distance_mm);
  await expect(page.getByText(first.refno, { exact: false })).toBeVisible();
  await expect(page.getByText(first.noun, { exact: false })).toBeVisible();
  await expect(page.getByText(first.targetGroup, { exact: false })).toBeVisible();
  if (first.nearest?.source_segment_refno) {
    await expect(page.getByText(first.nearest.source_segment_refno, { exact: false })).toBeVisible();
  }

  await expect.poll(async () => {
    const debug = await page.evaluate(() => (window as any).__plant3dBranClearanceAnnotations?.getSnapshot?.());
    return debug?.ids?.filter((id: string) => id.startsWith('bran_clearance_')).length ?? 0;
  }, { timeout: 30_000 }).toBe(candidates.filter((candidate) => candidate.annotation).length);
});
