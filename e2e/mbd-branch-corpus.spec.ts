import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';

type Page = import('@playwright/test').Page;

type MbdCorpusSample = {
  refno: string
  displayRefno?: string
  project: string
  priority?: string
  backendUrl?: string
  dbno?: number
  expectedLengthTexts?: string[]
  requiredChecks?: string[]
  topology?: string
};

type MbdScreenPoint = {
  id: string
  x: number
  y: number
};

type MbdApiCapture = {
  apiRequests: string[]
  apiResponses: { url: string; status: number }[]
};

const runRealCorpusE2E = process.env.MBD_REAL_CORPUS_E2E === '1';
const fixturePath = process.env.MBD_REAL_CORPUS_FIXTURE?.trim() || 'e2e/fixtures/mbd-branch-corpus.json';
const corpus = JSON.parse(readFileSync(path.resolve(fixturePath), 'utf8'));
const defaultProject = String(corpus.defaults?.multiBranchProject || corpus.defaults?.primaryProject || '').trim();
const outputProject = process.env.MBD_REAL_OUTPUT_PROJECT?.trim() ||
  process.env.MBD_REAL_CORPUS_PROJECT?.trim() ||
  defaultProject;
const backendUrl = process.env.MBD_REAL_BACKEND_URL?.trim() ||
  process.env.MBD_REAL_CORPUS_BACKEND_URL?.trim() ||
  String(
    outputProject === corpus.defaults?.marineProject
      ? corpus.defaults?.marineBackendUrl || corpus.defaults?.backendUrl
      : outputProject === corpus.defaults?.multiBranchProject
        ? corpus.defaults?.multiBranchBackendUrl || corpus.defaults?.backendUrl
        : corpus.defaults?.backendUrl || corpus.defaults?.multiBranchBackendUrl,
  ).trim();
const priorityFilter = process.env.MBD_REAL_CORPUS_PRIORITY?.trim();
const refFilter = new Set(
  (process.env.MBD_REAL_REFNOS || '')
    .split(/[,;\s]+/)
    .map((item) => item.trim().replace(/[\\/]/g, '_'))
    .filter(Boolean),
);
const maxSevereOverlap = Number(process.env.MBD_REAL_CORPUS_MAX_SEVERE_OVERLAP ?? '0');

const samples: MbdCorpusSample[] = (Array.isArray(corpus.samples) ? corpus.samples : [])
  .map((sample: MbdCorpusSample) => ({
    ...sample,
    backendUrl: String(sample.backendUrl || '').trim(),
    expectedLengthTexts: Array.isArray(sample.expectedLengthTexts)
      ? sample.expectedLengthTexts.map((item) => String(item).trim()).filter(Boolean)
      : [],
    dbno: Number.isFinite(Number(sample.dbno)) && Number(sample.dbno) > 0
      ? Number(sample.dbno)
      : undefined,
    project: String(sample.project || '').trim(),
    refno: String(sample.refno || '').trim().replace(/[\\/]/g, '_'),
  }))
  .filter((sample) => !!sample.refno)
  .filter((sample) => sample.project === outputProject)
  .filter((sample) => !priorityFilter || sample.priority === priorityFilter)
  .filter((sample) => refFilter.size === 0 || refFilter.has(sample.refno));

test.describe.configure({ mode: 'serial' });
test.skip(!runRealCorpusE2E, 'Set MBD_REAL_CORPUS_E2E=1 to run the real MBD branch corpus.');
test.skip(samples.length === 0, `No MBD corpus samples selected for project ${outputProject}.`);
test.setTimeout(150_000);

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

function resolveBackendUrlForSample(sample: MbdCorpusSample): string {
  return process.env.MBD_REAL_BACKEND_URL?.trim() ||
    process.env.MBD_REAL_CORPUS_BACKEND_URL?.trim() ||
    sample.backendUrl ||
    backendUrl;
}

async function openViewer(page: Page, sample: MbdCorpusSample): Promise<{ backendUrl: string; viewerUrl: string }> {
  await page.addInitScript(() => {
    localStorage.removeItem('plant3d-web-mbd-drawing-style-v1');
  });

  const sampleBackendUrl = resolveBackendUrlForSample(sample);
  const params = new URLSearchParams({
    backend: sampleBackendUrl,
    output_project: outputProject,
    mbd_debug: '1',
    mbd_api_debug: '1',
    mbd_dim_text: 'backend',
    cache_bust: String(Date.now()),
  });
  if (sample.dbno) {
    params.set('show_dbnum', String(sample.dbno));
  }
  const viewerUrl = `/viewer/?${params.toString()}`;
  await page.goto(viewerUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForFunction(
    () => !!(window as any).__plant3dMbdE2E && !!(window as any).__dtxViewer,
    null,
    { timeout: 60_000 },
  );

  return { backendUrl: sampleBackendUrl, viewerUrl };
}

async function generateFromRibbon(page: Page, refno: string): Promise<void> {
  await page.evaluate((nextRefno) => {
    (window as any).__plant3dMbdE2E.setSelectedRefno(nextRefno);
  }, refno);

  await page.locator('[data-ribbon-tab="mbd"]').click();
  await page.locator('[data-command="mbd.generate"]').first().click();
}

function snapshotHasExpectedLengths(snapshot: any, expectedLengthTexts: string[]): boolean {
  if (expectedLengthTexts.length <= 0) return true;
  const visibleTexts = new Set(
    (snapshot?.screen_items || [])
      .filter((item: any) => item.in_viewport === true)
      .map((item: any) => String(item.text || '').trim()),
  );
  return expectedLengthTexts.every((text) => visibleTexts.has(text));
}

function renderedAnnotationCount(snapshot: any): number {
  return Number(snapshot?.rendered_counts?.dims || 0) +
    Number(snapshot?.rendered_counts?.cut_tubis || 0) +
    Number(snapshot?.rendered_counts?.tags || 0) +
    Number(snapshot?.rendered_counts?.v2_leader_lines || 0);
}

async function waitForCorpusMbd(page: Page, sample: MbdCorpusSample): Promise<void> {
  await page.waitForFunction(({ refno, expectedLengthTexts, maxSevereOverlap }) => {
    const snapshot = (window as any).__plant3dMbdE2E?.getSnapshot?.();
    if (!snapshot || snapshot.branch_refno !== refno || snapshot.visible !== true) return false;
    const count = Number(snapshot.rendered_counts?.dims || 0) +
      Number(snapshot.rendered_counts?.cut_tubis || 0) +
      Number(snapshot.rendered_counts?.tags || 0) +
      Number(snapshot.rendered_counts?.v2_leader_lines || 0);
    if (count <= 0) return false;
    if (Number(snapshot.severe_screen_overlap_count || 0) > maxSevereOverlap) return false;
    const visibleTexts = new Set(
      (snapshot.screen_items || [])
        .filter((item: any) => item.in_viewport === true)
        .map((item: any) => String(item.text || '').trim()),
    );
    return (expectedLengthTexts || []).every((text: string) => visibleTexts.has(text));
  }, {
    refno: sample.refno,
    expectedLengthTexts: sample.expectedLengthTexts || [],
    maxSevereOverlap,
  }, { timeout: 90_000 });
}

async function waitForSettledCorpusMbd(page: Page, sample: MbdCorpusSample): Promise<void> {
  await waitForCorpusMbd(page, sample);
  await page.waitForTimeout(1700);
  await waitForCorpusMbd(page, sample);
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

function collectMotionPoints(snapshot: any): MbdScreenPoint[] {
  const fromLines = (snapshot?.line_object_states || [])
    .filter((item: any) =>
      item.visible !== false &&
      item.screen_box &&
      item.annotation_id &&
      (
        String(item.line_role || '').startsWith('dimensionLine') ||
        String(item.line_role || '').startsWith('extensionLine') ||
        String(item.dim_kind || '').length > 0
      ))
    .map((item: any) => ({
      id: `${String(item.annotation_id)}:${String(item.line_role || item.name || '')}`,
      x: Number(item.screen_box.x) + Number(item.screen_box.width) / 2,
      y: Number(item.screen_box.y) + Number(item.screen_box.height) / 2,
    }));
  if (fromLines.length > 0) return fromLines;

  return (snapshot?.screen_items || [])
    .filter((item: any) => item.in_viewport === true && item.id && item.text)
    .map((item: any) => ({
      id: String(item.id),
      x: Number(item.x),
      y: Number(item.y),
    }));
}

function maxScreenDelta(before: MbdScreenPoint[], after: MbdScreenPoint[]): number {
  let maxDelta = 0;
  for (const beforeItem of before) {
    const afterItem = after.find((item) => item.id === beforeItem.id);
    if (!afterItem) continue;
    const delta = Math.hypot(afterItem.x - beforeItem.x, afterItem.y - beforeItem.y);
    maxDelta = Math.max(maxDelta, delta);
  }
  return maxDelta;
}

function assertFullMbdRequest(apiRequests: string[], sample: MbdCorpusSample): string {
  const { refno } = sample;
  const fullMbdRequest = apiRequests.find((url) => url.includes(`/api/mbd/v2/pipe/${refno}`)) ??
    apiRequests.find((url) => url.includes(`/api/mbd/pipe/${refno}`));
  expect(fullMbdRequest).toBeTruthy();

  const query = new URL(fullMbdRequest!).searchParams;
  expect(query.get('mode')).toBe('layout_first');
  expect(query.get('include_layout_result')).toBe('true');
  expect(query.get('include_fittings')).toBe('false');
  expect(query.get('include_tags')).toBe('false');
  expect(query.get('include_material_balloons')).toBe('false');
  expect(query.get('include_bends')).toBe('false');
  if (sample.dbno) {
    expect(query.get('dbno')).toBe(String(sample.dbno));
  }

  return fullMbdRequest!;
}

function writeArtifact(name: string, data: Record<string, unknown>): void {
  mkdirSync('tmp', { recursive: true });
  writeFileSync(`tmp/${name}.json`, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

for (const sample of samples) {
  test(`MBD corpus renders interactive 3D annotations for ${sample.refno}`, async ({ page }) => {
    const apiCapture = captureMbdApi(page);
    const opened = await openViewer(page, sample);

    await generateFromRibbon(page, sample.refno);
    await waitForSettledCorpusMbd(page, sample);

    const fullMbdRequest = assertFullMbdRequest(apiCapture.apiRequests, sample);
    const before = await page.evaluate(() => (window as any).__plant3dMbdE2E.getSnapshot());
    expect(renderedAnnotationCount(before)).toBeGreaterThan(0);
    expect(snapshotHasExpectedLengths(before, sample.expectedLengthTexts || [])).toBe(true);
    expect(Number(before.severe_screen_overlap_count || 0)).toBeLessThanOrEqual(maxSevereOverlap);

    const beforeMotionPoints = collectMotionPoints(before);
    expect(beforeMotionPoints.length).toBeGreaterThan(0);

    await rotateCamera(page);
    await waitForSettledCorpusMbd(page, sample);
    const after = await page.evaluate(() => (window as any).__plant3dMbdE2E.getSnapshot());
    expect(after.branch_refno).toBe(sample.refno);
    expect(renderedAnnotationCount(after)).toBeGreaterThan(0);
    expect(snapshotHasExpectedLengths(after, sample.expectedLengthTexts || [])).toBe(true);
    expect(Number(after.severe_screen_overlap_count || 0)).toBeLessThanOrEqual(maxSevereOverlap);

    const maxDelta = maxScreenDelta(beforeMotionPoints, collectMotionPoints(after));
    expect(maxDelta).toBeGreaterThan(2);

    const screenshotPath = `tmp/mbd-real-corpus-${sample.refno}.png`;
    await page.screenshot({ path: screenshotPath, fullPage: false });
    writeArtifact(`mbd-real-corpus-${sample.refno}`, {
      viewerUrl: opened.viewerUrl,
      backendUrl: opened.backendUrl,
      outputProject,
      fullMbdRequest,
      apiResponses: apiCapture.apiResponses,
      sample,
      before: {
        renderedCounts: before.rendered_counts,
        dataCounts: before.data_counts,
        dimTexts: before.dim_texts,
        severeOverlap: before.severe_screen_overlap_count,
      },
      after: {
        renderedCounts: after.rendered_counts,
        dataCounts: after.data_counts,
        dimTexts: after.dim_texts,
        severeOverlap: after.severe_screen_overlap_count,
        maxScreenDelta: Number(maxDelta.toFixed(2)),
      },
      screenshotPath,
    });
  });
}
