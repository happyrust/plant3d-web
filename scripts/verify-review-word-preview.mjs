import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../docs/verification/word-preview-2026-10-08', import.meta.url));
const baseUrl = process.env.WORD_PREVIEW_BASE_URL || 'http://127.0.0.1:3181';
const sample = await readFile(`${root}/word-preview-sample.docx`);
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.route('**/word-preview-sample.docx', route => route.fulfill({ body: sample, contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }));
  await page.goto(`${baseUrl}/harness/review-attachment.html`);
  const result = await page.evaluate(async base64 => {
    const { renderWordPreview } = await import('/src/utils/wordPreview.ts');
    const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    const html = await renderWordPreview(bytes.buffer);
    const doc = new DOMParser().parseFromString(html, 'text/html');
    let invalidRejected = false;
    try { await renderWordPreview(new TextEncoder().encode('PK\x03\x04broken').buffer); }
    catch { invalidRejected = true; }
    const { openReviewAttachmentPreview } = await import('/src/composables/useReviewAttachmentPreview.ts');
    openReviewAttachmentPreview('TASK-DEMO-2026-0820', { id: 'att-word-check', name: '校审样例.docx', url: '/word-preview-sample.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', uploadedAt: Date.now() });
    return { text: doc.body.textContent, tableCount: doc.querySelectorAll('table').length, unsafeLinkCount: doc.querySelectorAll('[href],script,[onerror]').length, csp: doc.querySelector('meta[http-equiv]')?.getAttribute('content'), invalidRejected };
  }, sample.toString('base64'));
  assert.match(result.text, /三维校审 Word 预览验证/);
  assert.match(result.text, /DN100/);
  assert.equal(result.tableCount, 1);
  assert.equal(result.unsafeLinkCount, 0);
  assert.equal(result.invalidRejected, true);
  assert.match(result.csp, /default-src 'none'/);
  const iframe = page.locator('[data-testid="review-attachment-word"]');
  await iframe.waitFor();
  assert.equal(await iframe.getAttribute('sandbox'), '');
  await page.frameLocator('[data-testid="review-attachment-word"]').getByText('中文正文、尺寸 1200 mm 和版本 A/B。').waitFor();
  await page.screenshot({ path: `${root}/word-preview-browser.png`, fullPage: true });
  await writeFile(`${root}/word-preview-browser.json`, JSON.stringify({ checkedAt: new Date().toISOString(), ...result, sandbox: '', visible: true, source: 'real DOCX + browser + production preview component' }, null, 2));
  console.log('PASS: real DOCX text/table, unsafe link removal, invalid document rejection, sandbox and visible preview');
} finally { await browser.close(); }
