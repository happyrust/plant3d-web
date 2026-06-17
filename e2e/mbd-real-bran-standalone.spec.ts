import { expect, test } from '@playwright/test';

const viewerUrl = process.env.MBD_REAL_VIEWER_URL?.trim() ?? '';
const outputProject = process.env.MBD_REAL_OUTPUT_PROJECT?.trim() || 'aps250160-mbd-cata2';
const refno = process.env.MBD_REAL_REFNO?.trim() || '2013286704_476';

test.describe.configure({ mode: 'serial' });
test.skip(!viewerUrl, 'Set MBD_REAL_VIEWER_URL to run the real deployed BRAN MBD regression.');
test.setTimeout(120_000);

function buildStandaloneUrl(): string {
  const url = new URL(viewerUrl);
  url.searchParams.set('output_project', outputProject);
  url.searchParams.set('mbd_refno', refno);
  url.searchParams.set('mbd_debug', '1');
  url.searchParams.set('cache_bust', String(Date.now()));
  return url.toString();
}

test(`real BRAN ${refno} standalone MBD renders drawing annotations`, async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });

  const responses: { url: string; status: number; body: any }[] = [];
  const fontResponses: { url: string; status: number }[] = [];
  page.on('response', async (response) => {
    const url = response.url();
    if (url.includes('unicode.lff')) {
      fontResponses.push({ url, status: response.status() });
    }
    if (!url.includes('/api/mbd/v2/pipe/') && !url.includes('/api/mbd/pipe/')) return;
    let body: any = null;
    try {
      body = await response.json();
    } catch {
      // ignore non-json diagnostics
    }
    responses.push({ url, status: response.status(), body });
  });

  await page.goto(buildStandaloneUrl(), { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForFunction((targetRefno) => {
    const snapshot = (window as any).__plant3dMbdE2E?.getSnapshot?.();
    return snapshot?.branch_refno === targetRefno
      && snapshot.rendered_counts?.dims >= 4
      && snapshot.rendered_counts?.tags >= 9
      && (snapshot.screen_items || []).length >= 10;
  }, refno, { timeout: 70_000 });

  await page.waitForFunction(() => {
    const snapshot = (window as any).__plant3dMbdE2E?.getSnapshot?.();
    if (!snapshot || snapshot.severe_screen_overlap_count > 15) return false;
    const head = (snapshot.screen_items || []).find((item: any) => item.id === 'tag:position:2013286704_476:head');
    const tail = (snapshot.screen_items || []).find((item: any) => item.id === 'tag:position:2013286704_476:tail');
    if (!head || !tail) return false;
    return Math.hypot(Number(head.x) - Number(tail.x), Number(head.y) - Number(tail.y)) > 120;
  }, null, { timeout: 15_000 });

  const snapshot = await page.evaluate(() => (window as any).__plant3dMbdE2E.getSnapshot());
  const v2 = responses.find((item) => item.url.includes('/api/mbd/v2/pipe/'));
  const legacy = responses.find((item) => item.url.includes('/api/mbd/pipe/') && !item.url.includes('/api/mbd/v2/'));

  expect(v2?.status).toBe(200);
  expect(legacy?.status).toBe(200);
  expect(fontResponses).toEqual(expect.arrayContaining([
    expect.objectContaining({ status: 200 }),
  ]));
  expect(v2?.body?.success).toBe(true);
  expect(legacy?.body?.success).toBe(true);

  const v2Url = new URL(v2!.url);
  expect(v2Url.searchParams.get('include_tags')).toBe('true');
  expect(v2Url.searchParams.get('include_position_tags')).toBe('true');
  expect(v2Url.searchParams.get('include_elevation_marks')).toBe('true');
  expect(v2Url.searchParams.get('include_branch_label')).toBe('true');
  expect(v2Url.searchParams.get('include_material_balloons')).toBe('true');
  expect(v2Url.searchParams.get('include_material_table')).toBe('true');
  expect(v2Url.searchParams.get('include_bends')).toBe('true');

  expect(snapshot.render_source).toBe('layout_result');
  expect(snapshot.rendered_counts).toMatchObject({
    dims: 4,
    cut_tubis: 2,
    tags: 9,
    v2_leader_lines: 9,
  });
  expect(snapshot.data_counts.material_rows).toBe(2);
  expect(snapshot.screen_items.every((item: any) => item.in_viewport)).toBe(true);
  expect(snapshot.screen_items.every((item: any) =>
    item.box
    && Number.isFinite(item.box.left)
    && Number.isFinite(item.box.right)
    && item.box.width > 0
    && item.box.height > 0,
  )).toBe(true);
  expect(snapshot.severe_screen_overlap_count).toBeLessThanOrEqual(15);

  const visibleText = (text: string) =>
    snapshot.screen_items.some((item: any) => item.in_viewport && String(item.text).includes(text));
  for (const text of ['600', '145', '03SKID1-PIPE-SUCTION/B1', 'PE 100790', 'L=600', 'L=145', 'ELBO 90.0°']) {
    expect(visibleText(text), `${text} should be projected inside the viewport`).toBe(true);
  }

  expect(snapshot.screen_items).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: 'tag:fitting:2013286704_480', text: 'ELBO 90.0°', in_viewport: true }),
  ]));

  const headPositionTag = snapshot.screen_items.find((item: any) => item.id === 'tag:position:2013286704_476:head');
  const tailPositionTag = snapshot.screen_items.find((item: any) => item.id === 'tag:position:2013286704_476:tail');
  expect(headPositionTag).toBeTruthy();
  expect(tailPositionTag).toBeTruthy();
  expect(Math.hypot(
    Number(headPositionTag.x) - Number(tailPositionTag.x),
    Number(headPositionTag.y) - Number(tailPositionTag.y),
  )).toBeGreaterThan(120);

  const materialItems = snapshot.screen_items.filter((item: any) => String(item.id).startsWith('tag:material:'));
  expect(materialItems).toHaveLength(2);
  expect(materialItems).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: 'tag:material:1:2013286704_479', text: '1', in_viewport: true }),
    expect.objectContaining({ id: 'tag:material:2:2013286704_480', text: '2', in_viewport: true }),
  ]));

  const rows = legacy?.body?.data?.material_rows ?? [];
  expect(rows).toHaveLength(2);
  expect(rows[0]).toMatchObject({ ns: '3"', item_code: 'PA100' });
  expect(rows[0].quantity).toBeCloseTo(0.59996873, 5);
  expect(rows[1]).toMatchObject({ ns: '3"', item_code: 'PA100' });
  expect(rows[1].quantity).toBeCloseTo(0.145, 5);

  expect(legacy?.body?.data?.stats).toMatchObject({
    fittings_count: 1,
    tags_count: 9,
    bends_count: 1,
  });
  expect(legacy?.body?.data?.tags ?? []).toEqual(expect.arrayContaining([
    expect.objectContaining({
      id: 'tag:fitting:2013286704_480',
      refno: '2013286704_480',
      text: 'ELBO 90.0°',
    }),
  ]));

  const overviewText = await page.locator('body').innerText();
  expect(overviewText).toContain('弯头: 1');
  expect(overviewText).toContain('管件: 1');
  expect(overviewText).toContain('fittings: elbow=1');

  await page.getByText('材质', { exact: true }).click();
  const bodyText = await page.locator('body').innerText();
  expect(bodyText).toContain('PA100');
  expect(bodyText).toContain('3"');

  await page.screenshot({
    path: `e2e/screenshots/mbd-real-bran-${refno.replace(/[\\/]/g, '_')}.png`,
    fullPage: false,
  });
});
