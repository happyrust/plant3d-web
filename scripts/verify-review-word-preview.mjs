import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { createServer } from 'vite';

import { chromium } from 'playwright';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const sampleDocx = `${repoRoot}docs/verification/word-preview-2026-10-08/word-preview-sample.docx`;
const imageDocx = process.env.WORD_PREVIEW_IMAGE_DOCX
  || `${repoRoot}docs/guides/PMS三维校审云线元素绑定操作说明-含截图操作.docx`;
const outDir = process.env.WORD_PREVIEW_OUT_DIR || `${repoRoot}test-results/word-preview-canvas`;
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

// 没给 WORD_PREVIEW_BASE_URL 就自己起一个 Vite，检查完即关，不留常驻进程
let server = null;
let baseUrl = process.env.WORD_PREVIEW_BASE_URL;
if (!baseUrl) {
  server = await createServer({
    root: repoRoot,
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 3181, strictPort: false },
    optimizeDeps: { include: ['@hufe921/canvas-editor', 'mammoth'] },
  });
  await server.listen();
  baseUrl = server.resolvedUrls.local[0];
}
baseUrl = baseUrl.replace(/\/$/, '');

const browser = await chromium.launch({ headless: true });
try {
  await mkdir(outDir, { recursive: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.route('**/word-preview-sample.docx', async route => route.fulfill({ body: await readFile(sampleDocx), contentType: DOCX }));
  await page.route('**/word-preview-images.docx', async route => route.fulfill({ body: await readFile(imageDocx), contentType: DOCX }));
  await page.goto(`${baseUrl}/harness/review-attachment.html`);

  const conversion = await page.evaluate(async () => {
    const { buildWordPreviewElements } = await import('/src/utils/wordPreview.ts');
    const summarize = (elements) => {
      const summary = { text: '', types: {}, urls: 0, tables: elements.filter(element => element.type === 'table').length };
      const walk = (list) => {
        for (const element of list) {
          summary.text += element.value ?? '';
          const type = element.type ?? 'text';
          summary.types[type] = (summary.types[type] ?? 0) + 1;
          if (element.url) summary.urls += 1;
          if (element.valueList) walk(element.valueList);
          element.trList?.forEach(tr => tr.tdList.forEach(td => walk(td.value)));
        }
      };
      walk(elements);
      return summary;
    };
    const load = async url => (await fetch(url)).arrayBuffer();
    const sample = summarize(await buildWordPreviewElements(await load('/word-preview-sample.docx')));
    const images = summarize(await buildWordPreviewElements(await load('/word-preview-images.docx')));
    let invalidRejected = false;
    try { await buildWordPreviewElements(new TextEncoder().encode('PK\x03\x04broken').buffer); }
    catch { invalidRejected = true; }
    return { sample, images: { types: images.types, textLength: images.text.length }, invalidRejected };
  });
  assert.match(conversion.sample.text, /三维校审 Word 预览验证/);
  assert.match(conversion.sample.text, /DN100/);
  assert.match(conversion.sample.text, /中文正文、尺寸 1200 mm 和版本 A\/B。/);
  assert.equal(conversion.sample.tables, 1);
  assert.equal(conversion.sample.urls, 0, 'links must reach canvas-editor as plain text');
  assert.equal(conversion.sample.types.hyperlink ?? 0, 0);
  assert.equal(conversion.invalidRejected, true);
  assert.ok((conversion.images.types.image ?? 0) > 0, 'screenshots embedded in the guide must survive conversion');

  const openInPanel = (name, url) => page.evaluate(async ({ name, url, mimeType }) => {
    const { openReviewAttachmentPreview } = await import('/src/composables/useReviewAttachmentPreview.ts');
    openReviewAttachmentPreview('TASK-DEMO-2026-0820', { id: `att-${name}`, name, url, mimeType, uploadedAt: Date.now() });
  }, { name, url, mimeType: DOCX });
  const firstPageInk = () => page.evaluate(() => {
    const canvas = document.querySelector('[data-testid="word-preview-pages"] canvas');
    if (!canvas) return 0;
    const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    let ink = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 0 && data[i] < 128) ink += 1;
    return ink;
  });
  const preview = page.locator('[data-host="preview"]');
  const indicator = page.getByTestId('word-preview-page-indicator');

  await openInPanel('校审样例.docx', '/word-preview-sample.docx');
  await page.locator('[data-testid="review-attachment-word"] canvas').first().waitFor();
  await page.waitForFunction(() => {
    const canvas = document.querySelector('[data-testid="word-preview-pages"] canvas');
    if (!canvas) return false;
    const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 0 && data[i] < 128) return true;
    return false;
  });
  await page.waitForFunction(() => /\/ [1-9]/.test(document.querySelector('[data-testid="word-preview-page-indicator"]')?.textContent ?? ''));
  const sampleInk = await firstPageInk();
  const sampleIndicator = (await indicator.textContent()).trim();
  const fitScale = (await page.getByTestId('word-preview-scale').textContent()).trim();
  await preview.screenshot({ path: `${outDir}/word-preview-canvas-sample.png` });

  const widthBefore = await page.locator('[data-testid="word-preview-pages"] canvas').first().evaluate(canvas => canvas.getBoundingClientRect().width);
  await page.getByTestId('word-preview-zoom-in').click();
  await page.waitForFunction(before => document.querySelector('[data-testid="word-preview-pages"] canvas').getBoundingClientRect().width > before, widthBefore);
  const zoomedScale = (await page.getByTestId('word-preview-scale').textContent()).trim();
  await page.getByTestId('word-preview-fit-width').click();
  const refitScale = (await page.getByTestId('word-preview-scale').textContent()).trim();

  await openInPanel('PMS三维校审云线元素绑定操作说明-含截图操作.docx', '/word-preview-images.docx');
  await page.waitForFunction(() => {
    const match = /\/ (\d+) 页/.exec(document.querySelector('[data-testid="word-preview-page-indicator"]')?.textContent ?? '');
    return match && Number(match[1]) > 1;
  });
  const imagePages = Number(/\/ (\d+) 页/.exec(await indicator.textContent())[1]);
  await page.locator('[data-testid="review-attachment-word"] [role="document"]').evaluate(scroller => { scroller.scrollTop = scroller.clientHeight; });
  await page.waitForFunction(() => /第 [2-9]/.test(document.querySelector('[data-testid="word-preview-page-indicator"]')?.textContent ?? ''));
  await page.waitForTimeout(300);
  await preview.screenshot({ path: `${outDir}/word-preview-canvas-images.png` });

  assert.ok(sampleInk > 500, `first page should carry drawn text, got ${sampleInk} dark pixels`);
  assert.match(sampleIndicator, /第 1 \/ 1 页/);
  assert.notEqual(zoomedScale, fitScale);
  assert.equal(refitScale, fitScale);
  assert.deepEqual(pageErrors, []);

  const result = {
    checkedAt: new Date().toISOString(),
    renderer: '@hufe921/canvas-editor (read-only, paged)',
    sample: { ...conversion.sample, text: undefined, indicator: sampleIndicator, firstPageDarkPixels: sampleInk, fitScale, zoomedScale },
    imageDocument: { file: imageDocx.split(/[\\/]/).pop(), elementTypes: conversion.images.types, pages: imagePages },
    invalidRejected: conversion.invalidRejected,
    pageErrors,
  };
  await writeFile(`${outDir}/word-preview-canvas.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  console.log(`PASS: DOCX → canvas-editor pages (text, table, links as text, broken file rejected, zoom/fit, ${imagePages}-page guide with images); evidence in ${outDir}`);
} finally {
  await browser.close();
  await server?.close();
}
