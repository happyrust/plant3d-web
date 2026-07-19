// Scenario for harness/pipe-distance.html — pipe-distance family runtime evidence (#44).

const j = (body) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

export const viewport = { width: 900, height: 960 };

export async function routes(page) {
  await page.route(
    (url) => url.pathname.startsWith('/api/'),
    (r) => r.fulfill(j({ success: true, data: null })),
  );
}

export async function run({ page, shot }) {
  try {
    await page.waitForSelector('#host-drawer >> text=距离标注控制', { timeout: 15000 });
  } catch {
    console.log('!! drawer missing; body:', (await page.locator('body').innerText()).slice(0, 300));
  }
  await page.waitForTimeout(600);

  await shot('01-pipe-distance-drawer', '#host-drawer');

  // Scroll to the results list (active row highlight + result actions).
  try {
    await page.evaluate(() => {
      const scrollable = document.querySelector('#host-drawer .overflow-auto');
      if (scrollable) scrollable.scrollTop = scrollable.scrollHeight;
    });
    await page.waitForTimeout(300);
    await shot('02-pipe-distance-results', '#host-drawer');
  } catch (e) {
    console.log('scroll step failed:', String(e).slice(0, 160));
  }
}
