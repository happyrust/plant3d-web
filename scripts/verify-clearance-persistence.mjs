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
  await mkdir(output, { recursive: true });
  await writeFile(`${output}/browser-results.json`, JSON.stringify({ checkedAt: new Date().toISOString(),
    source: 'production store/service + existing geometry fixture + actual Chromium localStorage and page reload',
    businessAcceptance: false, initial, restored }, null, 2));
  console.log('PASS: real browser save/reload, snapshots, versions, visibility, stale status and scope isolation');
} finally { await browser.close(); }
