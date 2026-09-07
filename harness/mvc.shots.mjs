// Scenario for harness/mvc.html — ModelVersionComparePanel visual baseline.
// Exports consumed by scripts/visual-baseline/shot.mjs (see harness/README.md).

const FROM = 'codex-ams1112-physical-791';
const TO = 'codex-ams1112-physical-897';

const rows = [
  { change_type: 'changed', noun: 'BOX', refno_str: '17496_250377', component_key: '1112:75144748061193', dbnum: 1112 },
  { change_type: 'changed', noun: 'PIPE', refno_str: '17496_250401', component_key: '1112:75144748061201', dbnum: 1112 },
  { change_type: 'changed', noun: 'ELBO', refno_str: '17496_250412', component_key: '1112:75144748061212', dbnum: 1112 },
  { change_type: 'changed', noun: 'TEE', refno_str: '17496_250420', component_key: '1112:75144748061220', dbnum: 1112 },
  { change_type: 'changed', noun: 'FLAN', refno_str: '17496_250433', component_key: '1112:75144748061233', dbnum: 1112 },
];
const summary = { added: 5059, changed: 43, deleted: 2525, unchanged: 23549, emitted: 2, total_old: 26117, total_new: 28651 };

const j = (body) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

export const query = `output_project=AvevaMarineSample&from_release_id=${FROM}&to_release_id=${TO}&dbnum=1112&diff_limit=10`;
export const viewport = { width: 900, height: 900 };

export async function routes(page) {
  await page.route('**/api/model-version/diff**', (r) => r.fulfill(j({ success: true, data: { diff: { dbnum: 1112, from_release_id: FROM, to_release_id: TO, rows, summary } } })));
  await page.route('**/api/model-version/compare-readiness**', (r) => r.fulfill(j({ data: { readiness: { dbnum: 1112, classification: 'quarantined_visual', production_ready: false, from: { baseline_state_manifest_path: 'output/from-baseline.json' }, to: { baseline_state_manifest_path: 'output/to-baseline.json' } } } })));
  await page.route('**/output/from-baseline.json', (r) => r.fulfill(j({ source_db_file: 'D:\\AVEVA\\Projects\\E3D2.1\\AvevaMarineSample\\ams1112_0001 copy', source_db_latest_sesno: 791 })));
  await page.route('**/output/to-baseline.json', (r) => r.fulfill(j({ source_db_file: '\\\\?\\D:\\AVEVA\\Projects\\E3D2.1\\AvevaMarineSample\\ams000\\ams1112_0001', source_db_latest_sesno: 897 })));
}

export async function run({ page, shot }) {
  try {
    await page.waitForSelector('[data-testid="model-version-compare-dtx-summary"], [data-testid="model-version-compare-diff-list"]', { timeout: 15000 });
  } catch {
    console.log('!! no compare content; body:', (await page.locator('body').innerText()).slice(0, 300));
  }
  await page.waitForTimeout(800);

  await shot('01-compare');

  // Open diagnostic status -> provenance details
  try {
    await page.locator('[data-testid="model-version-compare-data-status"]').click();
    await page.waitForTimeout(500);
    await shot('02-compare-diagnostic');
  } catch (e) {
    console.log('diagnostic step failed:', String(e).slice(0, 160));
  }
}
