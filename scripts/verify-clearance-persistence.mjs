import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

const output = fileURLToPath(new URL('../docs/verification/clearance-persistence-2026-10-08/', import.meta.url));
const baseUrl = process.env.CLEARANCE_PREVIEW_BASE_URL || 'http://127.0.0.1:3181';
const scope = `browser-check:${Date.now()}`;
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto(`${baseUrl}/harness/review-attachment.html`);
  const initial = await page.evaluate(async key => {
    const { useClearanceStore } = await import('/src/clearance/stores/useClearanceStore.ts');
    const { createClearanceService } = await import('/src/clearance/services/clearanceService.ts');
    const { elboToCurvedWallResponse } = await import('/src/clearance/testing/surfaceClearanceFixtures.ts');
    const store = useClearanceStore();
    store.bindPersistence(key, localStorage);
    const record = await store.compute({ sourceRefno: '24384_22582', targetRefno: '17496_105912' }, {
      service: createClearanceService({ fetchSurfaceClearance: async () => elboToCurvedWallResponse() }),
    });
    store.setHidden(record.id, true);
    store.showAnnotations.value = false;
    return { id: record.id, snapshot: record.snapshot, modelVersion: record.modelVersion,
      persisted: JSON.parse(localStorage.getItem(`plant3d-clearance-v1:${key}`)), label: store.persistenceLabel.value };
  }, scope);
  assert.equal(initial.persisted.records.length, 1);
  assert.match(initial.label, /本机已保存/);
  await page.reload();
  const restored = await page.evaluate(async key => {
    const { useClearanceStore } = await import('/src/clearance/stores/useClearanceStore.ts');
    const store = useClearanceStore();
    store.bindPersistence(key, localStorage);
    const record = store.records.value[0];
    const result = { id: record.id, snapshot: record.snapshot, modelVersion: record.modelVersion,
      status: record.status, hidden: store.hiddenIds.value.has(record.id), showAnnotations: store.showAnnotations.value };
    store.bindPersistence(`${key}:other-project`, localStorage);
    const isolated = store.records.value.length === 0;
    store.bindPersistence(key, localStorage);
    const returned = store.records.value.length === 1;
    store.detachPersistence();
    store.clearRecords();
    localStorage.removeItem(`plant3d-clearance-v1:${key}`);
    localStorage.removeItem(`plant3d-clearance-v1:${key}:other-project`);
    return { ...result, isolated, returned };
  }, scope);
  assert.deepEqual(restored.snapshot, initial.snapshot);
  assert.deepEqual(restored.modelVersion, initial.modelVersion);
  assert.equal(restored.id, initial.id);
  assert.equal(restored.status, 'stale');
  assert.equal(restored.hidden, true);
  assert.equal(restored.showAnnotations, false);
  assert.equal(restored.isolated, true);
  assert.equal(restored.returned, true);
  const batchInitial = await page.evaluate(async key => {
    const { usePipeDistanceStore } = await import('/src/composables/usePipeDistanceStore.ts');
    const { createSpatialComputeStore } = await import('/src/composables/useSpatialCompute.ts');
    const { createApp } = await import('/node_modules/.vite/deps/vue.js');
    const { VueQueryPlugin } = await import('/node_modules/.vite/deps/@tanstack_vue-query.js');
    const app = createApp({});
    app.use(VueQueryPlugin);
    const { elboToCurvedWallResponse } = await import('/src/clearance/testing/surfaceClearanceFixtures.ts');
    const fixture = elboToCurvedWallResponse();
    const originalFetch = window.fetch;
    window.fetch = async () => new Response(JSON.stringify(fixture), { status: 200 });
    try {
      const pipe = usePipeDistanceStore();
      pipe.bindPersistence(key, localStorage);
      await pipe.autoDetectBrans(['24384_22582', '17496_105912']);
      const bran = app.runWithContext(() => createSpatialComputeStore());
      bran.bindPersistence(key, localStorage);
      const p = fixture.result;
      window.fetch = async () => new Response(JSON.stringify({ success: true, nearest_by_group: [
        { group: 'WALL', nouns: ['WALL'], candidates: [{ refno: '17496_105912', noun: 'WALL', distance_mm: p.distance_mm,
          intersects: false, nearest: { source_segment_refno: '24384_22582', source_segment_order: 1, source_point: p.source_point, target_point: p.target_point, vector: p.vector },
          annotation: { start_point: p.source_point, end_point: p.target_point, label_mm: p.distance_mm } }] }],
      noun_counts: { WALL: 1 }, excluded_self_members: 0 }), { status: 200 });
      await bran.submitScenario('branNearestClearance');
      return { pipe: pipe.results.value[0], branRows: bran.scenarios.branNearestClearance.resultRows.length };
    } finally { window.fetch = originalFetch; }
  }, scope);
  assert.ok(batchInitial.pipe.designPoints);
  assert.equal(batchInitial.branRows, 1);
  await page.reload();
  const batchRestored = await page.evaluate(async key => {
    const { usePipeDistanceStore } = await import('/src/composables/usePipeDistanceStore.ts');
    const { createSpatialComputeStore } = await import('/src/composables/useSpatialCompute.ts');
    const { createApp } = await import('/node_modules/.vite/deps/vue.js');
    const { VueQueryPlugin } = await import('/node_modules/.vite/deps/@tanstack_vue-query.js');
    const app = createApp({});
    app.use(VueQueryPlugin);
    const pipe = usePipeDistanceStore();
    const bran = app.runWithContext(() => createSpatialComputeStore());
    pipe.bindPersistence(key, localStorage);
    bran.bindPersistence(key, localStorage);
    const saved = { pipe: JSON.parse(JSON.stringify(pipe.results.value[0])), branRows: bran.scenarios.branNearestClearance.resultRows.length,
      branLabel: bran.scenarios.branNearestClearance.resultRows[0]?.label };
    pipe.bindPersistence(`${key}:B`, localStorage);
    bran.bindPersistence(`${key}:B`, localStorage);
    saved.isolated = pipe.results.value.length === 0 && bran.scenarios.branNearestClearance.resultRows.length === 0;
    pipe.detachPersistence(); bran.dispose();
    for (const prefix of ['plant3d-pipe-distance-v1', 'plant3d-bran-clearance-v1']) {
      localStorage.removeItem(`${prefix}:${key}`); localStorage.removeItem(`${prefix}:${key}:B`);
    }
    return saved;
  }, scope);
  assert.deepEqual(batchRestored.pipe.designPoints, batchInitial.pipe.designPoints);
  assert.deepEqual(batchRestored.pipe.modelVersion, batchInitial.pipe.modelVersion);
  assert.equal(batchRestored.pipe.status, 'stale');
  assert.equal(batchRestored.branRows, 1);
  assert.match(batchRestored.branLabel, /过期/);
  assert.equal(batchRestored.isolated, true);
  await mkdir(output, { recursive: true });
  await writeFile(`${output}/browser-results.json`, JSON.stringify({ checkedAt: new Date().toISOString(),
    source: 'production store/service + existing geometry fixture + actual Chromium localStorage and page reload',
    businessAcceptance: false, initial, restored, batchInitial, batchRestored }, null, 2));
  console.log('PASS: real browser save/reload, snapshots, versions, visibility, stale status and scope isolation');
} finally { await browser.close(); }
