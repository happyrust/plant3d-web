import { expect, test } from '@playwright/test';

const LIVE = process.env.GEN_MODEL_P5_LIVE === '1';
const GEN_BASE = process.env.GEN_MODEL_V1_BASE_URL || 'http://127.0.0.1:8022';
const DBNUM = Number(process.env.GEN_MODEL_P5_DBNUM || 7997);
const TERMINAL = new Set(['succeeded', 'partial', 'failed', 'yielded']);

const TARGETS = [
  { noun: 'BRAN', refno: '24381_145018' },
  { noun: 'EQUI', refno: '24381_109581' },
  { noun: 'ZONE', refno: '24381_101410' },
] as const;

type Health = {
  started_at?: string;
  data_face?: string;
  sul_db?: { medium?: string; durable?: boolean };
};

async function health(): Promise<Health> {
  const response = await fetch(`${GEN_BASE}/api/v1/health`);
  if (!response.ok) throw new Error(`health HTTP ${response.status}`);
  return response.json() as Promise<Health>;
}

async function waitForLastDbnum(page: import('@playwright/test').Page, dbnum = DBNUM): Promise<number> {
  await expect.poll(
    async () => page.evaluate(() =>
      // @ts-expect-error -- browser-side Vite module is available in the live dev server.
      import('/src/composables/useViewerContext.ts').then((mod) => {
        const viewer = mod.useViewerContext().viewerRef.value as { __dtxLastLoadedDbno?: number } | null;
        return viewer?.__dtxLastLoadedDbno ?? null;
      }),
    ),
    { timeout: 20 * 60_000, intervals: [1000, 2000, 5000] },
  ).toBe(dbnum);
  return dbnum;
}

async function viewerSnapshot(page: import('@playwright/test').Page): Promise<{ objects: number; refnos: number }> {
  return page.evaluate(() => {
    const windowWithLayer = window as unknown as {
      __dtxLayer?: { getAllObjectsWithBounds(): unknown[] };
    };
    // @ts-expect-error -- browser-side Vite module is available in the live dev server.
    return import('/src/composables/useViewerContext.ts').then((mod) => {
      const viewer = mod.useViewerContext().viewerRef.value as { __dtxLastLoadedRefnos?: string[] } | null;
      return {
        objects: windowWithLayer.__dtxLayer?.getAllObjectsWithBounds().length ?? -1,
        refnos: viewer?.__dtxLastLoadedRefnos?.length ?? 0,
      };
    });
  });
}

test.beforeEach(async () => {
  test.skip(!LIVE, 'set GEN_MODEL_P5_LIVE=1 to run the destructive/restart live gate');
  try {
    await health();
  } catch {
    test.skip(true, `gen-model 不在 ${GEN_BASE}`);
  }
});

test('P5 show_refno：BRAN / EQUI / ZONE 都经当前服务绘出对象', async ({ page }) => {
  test.setTimeout(20 * 60_000);
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  for (const target of TARGETS) {
    const params = new URLSearchParams({
      model_source: 'gen-model-v1',
      gm_backend: GEN_BASE,
      output_project: 'AvevaMarineSample',
      show_refno: target.refno,
    });
    await page.goto(`/?${params.toString()}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('canvas', { timeout: 60_000 });
    await waitForLastDbnum(page);
    const snapshot = await viewerSnapshot(page);
    console.log(`[p5-live] ${target.noun} ${target.refno}: objects=${snapshot.objects} refnos=${snapshot.refnos}`);
    expect(snapshot.objects, `${target.noun} ${target.refno}`).toBeGreaterThan(0);
    expect(snapshot.refnos, `${target.noun} ${target.refno}`).toBeGreaterThan(0);
  }
  expect(pageErrors, pageErrors.join('\n')).toEqual([]);
});

test('P5 show_dbnum：task_id 冻结 roots、批量 records、首批早于终态且不逐根 ensure', async ({ page }) => {
  test.setTimeout(35 * 60_000);
  let taskId: string | null = null;
  let firstRecordsAt: number | null = null;
  const taskRootUrls: string[] = [];
  const recordBatches: number[] = [];
  let dbnumEnsureCalls = 0;
  let singleEnsureCalls = 0;
  const pageErrors: string[] = [];

  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('request', (request) => {
    const url = request.url();
    if (request.method() === 'POST' && url.includes(`/api/v1/dbnums/${DBNUM}/model/ensure`)) {
      dbnumEnsureCalls += 1;
    }
    if (request.method() === 'POST' && url.endsWith('/api/v1/model/ensure')) {
      singleEnsureCalls += 1;
    }
    if (url.includes(`/api/v1/dbnums/${DBNUM}/model/roots`)) taskRootUrls.push(url);
    if (request.method() === 'POST' && url.endsWith('/api/v1/model/records')) {
      firstRecordsAt ??= Date.now();
      try {
        const body = request.postDataJSON() as { generation_roots?: unknown[] };
        if (Array.isArray(body.generation_roots)) recordBatches.push(body.generation_roots.length);
      } catch {
        // The assertion below requires at least one valid batch body.
      }
    }
  });
  page.on('response', (response) => {
    if (
      response.request().method() === 'POST'
      && response.url().includes(`/api/v1/dbnums/${DBNUM}/model/ensure`)
    ) {
      void response.json()
        .then((body: { task_id?: unknown }) => {
          if (typeof body.task_id === 'string') taskId = body.task_id;
        })
        .catch(() => undefined);
    }
  });

  const params = new URLSearchParams({
    model_source: 'gen-model-v1',
    gm_backend: GEN_BASE,
    output_project: 'AvevaMarineSample',
    show_dbnum: String(DBNUM),
    show_dbnum_full: '1',
  });
  await page.goto(`/?${params.toString()}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('canvas', { timeout: 60_000 });
  await expect.poll(() => taskId, { timeout: 130_000 }).not.toBeNull();
  await expect.poll(() => firstRecordsAt, { timeout: 20 * 60_000, intervals: [1000, 2000, 5000] }).not.toBeNull();
  await waitForLastDbnum(page);

  let terminalObservedAt = 0;
  await expect.poll(async () => {
    const response = await fetch(`${GEN_BASE}/api/v1/tasks/${encodeURIComponent(taskId!)}`);
    if (!response.ok) return `http-${response.status}`;
    const task = await response.json() as { state?: string; units_done?: number; total_units?: number };
    console.log(`[p5-live] dbnum task ${task.state} ${task.units_done}/${task.total_units}`);
    if (TERMINAL.has(String(task.state))) terminalObservedAt = Date.now();
    return task.state;
  }, { timeout: 30 * 60_000, intervals: [2000, 5000] }).toMatch(/succeeded|partial|failed|yielded/);

  const snapshot = await viewerSnapshot(page);
  expect(snapshot.objects).toBeGreaterThan(0);
  expect(dbnumEnsureCalls).toBe(1);
  expect(singleEnsureCalls).toBe(0);
  expect(taskRootUrls.length).toBeGreaterThan(0);
  expect(taskRootUrls.every((url) => new URL(url).searchParams.get('task_id') === taskId)).toBe(true);
  expect(recordBatches.length).toBeGreaterThan(0);
  expect(recordBatches.every((size) => size >= 1 && size <= 64)).toBe(true);
  expect(firstRecordsAt!).toBeLessThan(terminalObservedAt);
  expect(pageErrors, pageErrors.join('\n')).toEqual([]);
  await page.screenshot({ path: 'e2e/screenshots/gen-model-v1-p5-show-dbnum.png' });
});

test('P5 重启：旧 task 404、前端代次失效后重新 ensure，当前场景不被动卸载', async ({ page }) => {
  test.setTimeout(15 * 60_000);
  const params = new URLSearchParams({
    model_source: 'gen-model-v1',
    gm_backend: GEN_BASE,
    output_project: 'AvevaMarineSample',
    show_refno: '24381_145018',
  });
  await page.goto(`/?${params.toString()}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('canvas', { timeout: 60_000 });
  await waitForLastDbnum(page);
  const beforeScene = await viewerSnapshot(page);
  expect(beforeScene.objects).toBeGreaterThan(0);

  const oldHealth = await health();
  expect(oldHealth.started_at).toBeTruthy();
  const taskResponse = await fetch(`${GEN_BASE}/api/v1/dbnums/${DBNUM}/model/ensure`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  expect(taskResponse.status).toBe(202);
  const oldTask = await taskResponse.json() as { task_id: string };

  const beforeGeneration = await page.evaluate(() =>
    // @ts-expect-error -- browser-side Vite module is available in the live dev server.
    import('/src/composables/useGenModelV1Health.ts').then((mod) =>
      mod.useGenModelV1Health().state.serviceGeneration,
    ),
  );

  const restart = await fetch(`${GEN_BASE}/api/v1/setup/restart`, { method: 'POST' });
  expect(restart.status).toBe(202);
  await expect.poll(async () => {
    try {
      const next = await health();
      return next.started_at && next.started_at !== oldHealth.started_at ? next.started_at : null;
    } catch {
      return null;
    }
  }, { timeout: 5 * 60_000, intervals: [500, 1000, 2000] }).not.toBeNull();

  const oldTaskResponse = await fetch(`${GEN_BASE}/api/v1/tasks/${encodeURIComponent(oldTask.task_id)}`);
  expect(oldTaskResponse.status).toBe(404);

  await page.evaluate(async () => {
    // @ts-expect-error -- browser-side Vite module is available in the live dev server.
    const healthModule = await import('/src/composables/useGenModelV1Health.ts');
    await healthModule.useGenModelV1Health().refresh();
  });
  const afterGeneration = await page.evaluate(() =>
    // @ts-expect-error -- browser-side Vite module is available in the live dev server.
    import('/src/composables/useGenModelV1Health.ts').then((mod) =>
      mod.useGenModelV1Health().state.serviceGeneration,
    ),
  );
  expect(afterGeneration).toBeGreaterThan(beforeGeneration);
  expect((await viewerSnapshot(page)).objects).toBe(beforeScene.objects);

  let ensureAfterRestart = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/api/v1/model/ensure')) {
      ensureAfterRestart += 1;
    }
  });
  await page.evaluate(async ({ dbnum }) => {
    // @ts-expect-error -- browser-side Vite module is available in the live dev server.
    const sourceModule = await import('/src/model-source/index.ts');
    const source = sourceModule.getGenModelV1ModelSource();
    if (!source) throw new Error('gen-model-v1 source is not active');
    await source.records.instanceEntriesByRefnos(dbnum, ['24381_145018']);
  }, { dbnum: DBNUM });
  expect(ensureAfterRestart).toBeGreaterThan(0);
  expect((await viewerSnapshot(page)).objects).toBe(beforeScene.objects);
});
