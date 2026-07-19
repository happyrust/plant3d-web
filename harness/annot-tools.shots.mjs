// Scenario for harness/annot-tools.html — annotation tool panel family (#48).
// Shots cover: AnnotationPanel (top + comments area), AnnotationStylePanel,
// AnnotationCard states, and the overlay bar with the color palette expanded
// (palette colors are FUNCTIONAL and must be identical before/after migration).

const j = (body) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

export const query = '';
export const viewport = { width: 1800, height: 1100 };

export async function routes(page) {
  // Panels are store-driven; APIs only serve comment threads / user sync.
  // Backend-path catch-all keeps the harness offline-stable and console quiet
  // (predicate, not glob: '**/api/**' would also swallow /src/api/*.ts modules).
  await page.route(
    (url) => url.pathname.startsWith('/api/'),
    (r) => r.fulfill(j({ success: true, comments: [], data: null })),
  );
}

export async function run({ page, shot }) {
  try {
    await page.waitForSelector('[data-testid="annotation-panel-severity-overview"]', { timeout: 15000 });
    await page.waitForSelector('[data-testid="annotation-overlay-bar"]', { timeout: 15000 });
  } catch {
    console.log('!! harness content missing; body:', (await page.locator('body').innerText()).slice(0, 300));
  }
  await page.waitForTimeout(800);

  await shot('01-annotation-panel-top', '#host-panel');

  // Scroll to the edit + comments cards (view-mode switcher lives there).
  await page.evaluate(() => {
    const host = document.querySelector('#host-panel');
    if (host) host.scrollTop = host.scrollHeight;
  });
  await page.waitForTimeout(300);
  await shot('02-annotation-panel-comments', '#host-panel');

  await shot('03-style-panel-top', '#host-style');
  await page.evaluate(() => {
    const host = document.querySelector('#host-style');
    if (host) host.scrollTop = host.scrollHeight;
  });
  await page.waitForTimeout(300);
  await shot('04-style-panel-bottom', '#host-style');

  await shot('05-annotation-cards', '#host-cards');

  // Overlay bar with severity dropdown closed + color palette expanded.
  try {
    await page.locator('[data-testid="annotation-overlay-bar"] .color-picker-container > button').click();
    await page.waitForTimeout(400);
    const root = page.locator('[data-testid="annotation-overlay-root"]');
    const box = await root.boundingBox();
    if (box) {
      await shot('06-overlay-color-palette', null, {
        clip: {
          x: Math.max(0, box.x - 40),
          y: Math.max(0, box.y - 190),
          width: box.width + 80,
          height: box.height + 230,
        },
      });
    } else {
      await shot('06-overlay-color-palette', '[data-testid="annotation-overlay-root"]');
    }
  } catch (e) {
    console.log('palette step failed:', String(e).slice(0, 160));
  }
}
