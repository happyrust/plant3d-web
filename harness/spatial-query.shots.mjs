// Scenario for harness/spatial-query.html — spatial-query family runtime evidence (#44).
// The entry (src/harness/spatialQuery.ts) seeds the singleton stores and
// self-expands advanced filters / results / mini mode via component testids,
// so this scenario only waits and captures the three hosts.

const j = (body) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

export const viewport = { width: 1440, height: 1080 };

export async function routes(page) {
  await page.route(
    (url) => url.pathname.startsWith('/api/'),
    (r) => r.fulfill(j({ success: true, data: null })),
  );
}

export async function run({ page, shot }) {
  try {
    await page.waitForSelector('#host-sq-full [data-testid="spatial-query-mini-toggle"]', { timeout: 15000 });
    await page.waitForSelector('#host-sq-mini [data-testid="spatial-query-mini-expand"]', { timeout: 15000 });
  } catch {
    console.log('!! drawer instances missing; body:', (await page.locator('body').innerText()).slice(0, 300));
  }
  await page.waitForTimeout(800);

  await shot('01-query-drawer-full', '#host-sq-full');

  // Scroll the drawer's internal list down to the grouped result rows.
  try {
    await page.evaluate(() => {
      const scrollable = document.querySelector('#host-sq-full .overflow-y-auto');
      if (scrollable) scrollable.scrollTop = scrollable.scrollHeight;
    });
    await page.waitForTimeout(300);
    await shot('02-query-drawer-results', '#host-sq-full');
  } catch (e) {
    console.log('drawer scroll failed:', String(e).slice(0, 160));
  }

  await shot('03-query-drawer-mini', '#host-sq-mini');
  await shot('04-compute-panel', '#host-compute');
}
