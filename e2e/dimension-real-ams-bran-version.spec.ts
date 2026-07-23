import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const BACKEND_ORIGIN = 'http://127.0.0.1:3100';
const PROJECT = 'AvevaMarineSample';
const DBNUM = 7997;
const UNIT_REFNO = '24381_145018';
const COMPARE_EVENT = 'plant3d:model-unit-version-compare';

test.setTimeout(120_000);

type ModelUnitCommitResponse = {
  success: boolean;
  data: {
    commit: {
      dbnum: number;
      unit_noun: string;
      unit_refno: string;
      sesno: number;
      artifact_sesno: number;
      impact_kind: string;
      generated_at: string;
    };
    manifest_url: string;
  }[];
};

async function waitForDimensionSystem(page: Page): Promise<void> {
  await page.getByText('三维查看器', { exact: true }).click();
  await page.waitForFunction(() => (
    (window as any).__viewerContext?.dimensionSystem?.value
    || typeof (window as any).__dimensionSystemError === 'string'
  ), null, { timeout: 60_000 });
  expect(await page.evaluate(() => (window as any).__dimensionSystemError ?? null)).toBeNull();
}

async function fetchVersions(request: APIRequestContext): Promise<ModelUnitCommitResponse['data']> {
  const response = await request.get(
    `${BACKEND_ORIGIN}/api/model/units/${encodeURIComponent(UNIT_REFNO)}/versions?dbnum=${DBNUM}`,
  );
  expect(response.ok()).toBe(true);
  const body = await response.json() as ModelUnitCommitResponse;
  expect(body.success).toBe(true);
  expect(body.data.length).toBeGreaterThanOrEqual(2);
  return body.data;
}

function findVersion(
  versions: ModelUnitCommitResponse['data'],
  sesno: number,
): ModelUnitCommitResponse['data'][number] {
  const version = versions.find(item => item.commit.sesno === sesno);
  expect(version, `missing AMS ${DBNUM} BRAN ${UNIT_REFNO} sesno ${sesno}`).toBeTruthy();
  expect(version!.commit.dbnum).toBe(DBNUM);
  expect(version!.commit.unit_noun).toBe('BRAN');
  expect(version!.commit.unit_refno).toBe(UNIT_REFNO);
  expect(version!.manifest_url).toContain(`/model_units/${DBNUM}/${UNIT_REFNO}/`);
  return version!;
}

async function queryManifestRefnos(
  page: Page,
  manifestUrl: string,
): Promise<string[]> {
  return page.evaluate(async ({ dbnum, unitRefno, manifestUrl }) => {
    const mod = await import('/src/composables/useDbnoInstancesParquetLoader.ts');
    const loader = mod.useDbnoInstancesParquetLoader();
    return loader.queryAllRefnosByDbno(dbnum, {
      manifestUrl,
      expectedRootRefno: unitRefno,
    });
  }, { dbnum: DBNUM, unitRefno: UNIT_REFNO, manifestUrl });
}

test('AMS 7997 empty parquet MBD source keeps the Three scene painter mounted safely', async ({ page }) => {
  await page.goto(
    `/?backendPort=3100&output_project=${PROJECT}&dimension_demo=1&show_dbnum=${DBNUM}`,
    { waitUntil: 'domcontentloaded' },
  );
  await waitForDimensionSystem(page);

  const state = await page.evaluate(() => {
    const system = (window as any).__viewerContext.dimensionSystem.value;
    const records = system.externalRegistry.snapshot.records
      .filter((record: any) => record.source === 'mbd');
    system.notifyViewerChanged();
    const group = (window as any).__dtxViewer.scene.getObjectByName('dimension-scene-overlay');
    return {
      recordCount: records.length,
      layoutCount: system.viewport.getLayouts().length,
      groupVisible: Boolean(group?.visible),
      childNames: group?.children?.map((child: any) => child.name) ?? [],
    };
  });

  expect(state.recordCount).toBe(0);
  expect(state.layoutCount).toBe(0);
  expect(state.groupVisible).toBe(true);
  expect(state.childNames).toEqual(expect.arrayContaining([
    'dimension-scene-lines',
    'dimension-scene-arrows',
  ]));

  const mbdRows = await page.evaluate(async (dbnum) => {
    const mod = await import('/src/composables/useDbnoInstancesParquetLoader.ts');
    const loaded = await mod.useDbnoInstancesParquetLoader().queryMbdDimensionsByDbno(dbnum, {
      forceRefresh: true,
    });
    return loaded.dimensions.length;
  }, DBNUM);
  expect(mbdRows).toBe(0);
});

test('AMS 7997 BRAN 24381_145018 loads minimal delivery unit versions 791 and 898 for compare', async ({ page, request }) => {
  const versions = await fetchVersions(request);
  const before = findVersion(versions, 791);
  const after = findVersion(versions, 898);

  await page.goto(
    `/?backendPort=3100&output_project=${PROJECT}&dimension_demo=1`,
    { waitUntil: 'domcontentloaded' },
  );
  await waitForDimensionSystem(page);

  const beforeRefnos = await queryManifestRefnos(page, before.manifest_url);
  const afterRefnos = await queryManifestRefnos(page, after.manifest_url);
  expect(beforeRefnos.length, 'sesno 791 manifest refnos').toBeGreaterThan(0);
  expect(afterRefnos.length, 'sesno 898 manifest refnos').toBeGreaterThan(0);

  await page.evaluate(({ eventName, dbnum, unitRefno, before, after, beforeRefnos, afterRefnos }) => {
    window.dispatchEvent(new CustomEvent(eventName, {
      detail: {
        action: 'open',
        dbnum,
        unitRefno,
        before: {
          sesno: before.commit.sesno,
          artifactSesno: before.commit.artifact_sesno,
          manifestUrl: before.manifest_url,
          generatedAt: before.commit.generated_at,
          refnos: beforeRefnos,
        },
        after: {
          sesno: after.commit.sesno,
          artifactSesno: after.commit.artifact_sesno,
          manifestUrl: after.manifest_url,
          generatedAt: after.commit.generated_at,
          refnos: afterRefnos,
        },
        refnos: Array.from(new Set([...beforeRefnos, ...afterRefnos])),
        rows: [{
          refno: unitRefno,
          noun: 'BRAN',
          status: before.commit.artifact_sesno === after.commit.artifact_sesno ? 'unchanged' : 'modified',
        }],
      },
    }));
  }, {
    eventName: COMPARE_EVENT,
    dbnum: DBNUM,
    unitRefno: UNIT_REFNO,
    before,
    after,
    beforeRefnos,
    afterRefnos,
  });

  await expect.poll(() => page.evaluate(() => (window as any).__modelUnitVersionCompare ?? null), {
    timeout: 120_000,
  }).toMatchObject({
    unitRefno: UNIT_REFNO,
    beforeSesno: 791,
    afterSesno: 898,
  });

  await page.evaluate(async () => {
    const { emitCommand } = await import('/src/ribbon/commandBus.ts');
    emitCommand('panel.modelVersionCompare');
  });
  await expect(page.getByTestId('model-unit-version-compare-panel')).toBeVisible();
  await expect(page.getByTestId('model-unit-compare-runtime')).toBeVisible();
  await expect(page.getByTestId('viewer-model-unit-version-compare-overlay')).toHaveCount(0);

  const debug = await page.evaluate(() => (window as any).__modelUnitVersionCompare);
  expect(debug.beforeObjects).toBeGreaterThan(0);
  expect(debug.afterObjects).toBeGreaterThan(0);
  expect(debug.environmentLoadedRefnos).toBeGreaterThanOrEqual(0);

  await expect(page.getByTestId('model-unit-compare-show-before')).toContainText('A · sesno 791');
  await expect(page.getByTestId('model-unit-compare-show-after')).toContainText('B · sesno 898');

  await page.getByTestId('model-unit-compare-show-before').click();
  await expect.poll(() => page.evaluate(() => (
    (window as any).__modelUnitVersionCompare?.activeSide
  ))).toBe('before');
  await page.getByTestId('model-unit-compare-show-after').click();
  await expect.poll(() => page.evaluate(() => (
    (window as any).__modelUnitVersionCompare?.activeSide
  ))).toBe('after');

  await page.getByTestId('model-unit-compare-split-mode').click();
  await expect(page.getByTestId('viewer-model-unit-split-overlay')).toBeVisible();
  await expect(page.getByTestId('model-unit-compare-split-summary'))
    .toContainText('左 A · sesno 791');
  await expect(page.getByTestId('model-unit-compare-split-summary'))
    .toContainText('右 B · sesno 898');

  const canvas = page.locator('canvas.viewer');
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  const interactionPoint = {
    x: box!.x + box!.width * 0.75,
    y: box!.y + box!.height * 0.25,
  };
  expect(await page.evaluate(({ x, y }) => (
    document.elementFromPoint(x, y)?.tagName
  ), interactionPoint)).toBe('CANVAS');

  const cameraBefore = await page.evaluate(() => (
    (window as any).__dtxViewer.camera.position.toArray() as number[]
  ));
  await page.mouse.move(interactionPoint.x, interactionPoint.y);
  await page.mouse.down();
  await page.mouse.move(interactionPoint.x + 60, interactionPoint.y + 40, { steps: 10 });
  await page.mouse.up();
  await expect.poll(async () => {
    const cameraAfter = await page.evaluate(() => (
      (window as any).__dtxViewer.camera.position.toArray() as number[]
    ));
    return cameraAfter.some((value, index) => Math.abs(value - cameraBefore[index]!) > 1e-6);
  }).toBe(true);

  await page.getByTestId('model-unit-compare-close').click();
  await expect(page.getByTestId('model-unit-compare-runtime')).toHaveCount(0);
  await expect(page.getByTestId('viewer-model-unit-split-overlay')).toHaveCount(0);
});
