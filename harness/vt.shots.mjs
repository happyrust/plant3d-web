// Scenario for harness/vt.html — VersionTimelinePanel visual baseline.
// Exports consumed by scripts/visual-baseline/shot.mjs:
//   query    URL search params the panel reads (project / dbnum)
//   viewport default browser viewport for this scenario
//   routes   Playwright network mocks for the model-version/model-history APIs
//   run      wait + interact + screenshot steps (shot(name) -> <out>/<name>.png)

const now = new Date();
const iso = (dayOffset, h, m = 0) => {
  const d = new Date(now);
  d.setDate(d.getDate() + dayOffset);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};

const rel = (o) => ({ project_name: 'AvevaMarineSample', dbnum: 1112, release_lifecycle: 'published', release_quality: 'complete_visual', ...o });

const releases = [
  rel({ release_id: 'codex-ams1112-physical-897', release_label: '结构管廊 D 区补强', branch_id: 'main', release_quality: 'complete_visual', release_lifecycle: 'published', registered_at: iso(0, 15, 12) }),
  rel({ release_id: 'codex-ams1112-physical-896', release_label: '管道坡度批量修订', branch_id: 'main', release_quality: 'degraded_visual', release_lifecycle: 'published', registered_at: iso(0, 9, 40) }),
  rel({ release_id: 'codex-ams1112-physical-791', release_label: '设备基础调整', branch_id: 'main', release_quality: 'quarantined_visual', release_quality_reason: '几何校验不一致，已隔离', release_lifecycle: 'published', registered_at: iso(-1, 16, 5) }),
  rel({ release_id: 'codex-ams1112-physical-655', release_label: '初始基线', branch_id: 'main', release_quality: 'complete_visual', release_lifecycle: 'staged', registered_at: iso(-1, 10, 20) }),
];

const diffByTo = {
  'codex-ams1112-physical-897': { added: 12, changed: 5, deleted: 3 },
  'codex-ams1112-physical-896': { added: 3, changed: 1, deleted: 0 },
  'codex-ams1112-physical-791': { added: 45, changed: 20, deleted: 11 },
  'codex-ams1112-physical-655': { added: 0, changed: 0, deleted: 0 },
};

const mv = (data) => ({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, message: 'ok', data }) });
const mh = (data) => ({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data }) });

export const query = 'project=AvevaMarineSample&dbnum=1112';
export const viewport = { width: 900, height: 900 };

export async function routes(page) {
  await page.route('**/api/model-version/releases**', (r) => r.fulfill(mv({ releases })));
  await page.route('**/api/model-version/diff**', (r) => {
    const to = new URL(r.request().url()).searchParams.get('to_release_id');
    r.fulfill(mv({ diff: { rows: [], summary: diffByTo[to] || { added: 0, changed: 0, deleted: 0 } } }));
  });
  await page.route('**/api/model-version/compare-readiness**', (r) => r.fulfill(mv({ readiness: { classification: 'ok', production_ready: true, problems: [], warnings: [] } })));
  await page.route('**/api/model-history/anchors**', (r) => r.fulfill(mh({ dbnum: 1112, count: 1, anchors: [{ dbnum: 1112, sesno: 895, anchored_at: iso(0, 12, 0) }] })));
}

export async function run({ page, shot }) {
  try {
    await page.waitForSelector('[data-testid="version-card"]', { timeout: 15000 });
  } catch {
    console.log('!! no version-card; body text:', (await page.locator('body').innerText()).slice(0, 300));
  }
  await page.waitForTimeout(1000);

  await shot('01-timeline-list');
  console.log('  cards:', await page.locator('[data-testid="version-card"]').count());

  // Interaction: pin A + B -> compare bar state
  try {
    await page.locator('[data-release-id="codex-ams1112-physical-897"] [data-testid="version-card-pin-a"]').click();
    await page.locator('[data-release-id="codex-ams1112-physical-896"] [data-testid="version-card-pin-b"]').click();
    await page.waitForTimeout(500);
    await shot('02-timeline-compare-bar');
    console.log('  bar:', await page.locator('[data-testid="version-timeline-compare-bar"]').count());
  } catch (e) {
    console.log('interaction step failed:', String(e).slice(0, 160));
  }
}
