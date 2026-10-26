import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { createServer } from 'vite';

import { chromium } from 'playwright';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const sampleDocx = `${repoRoot}docs/verification/word-preview-2026-10-08/word-preview-sample.docx`;
const imageDocx = process.env.WORD_PREVIEW_IMAGE_DOCX
  || `${repoRoot}docs/guides/PMS三维校审云线元素绑定操作说明-含截图操作.docx`;
const outDir = process.env.WORD_PREVIEW_OUT_DIR || `${repoRoot}test-results/word-preview-zrimo`;
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

// 没给 WORD_PREVIEW_BASE_URL 就自己起一个 Vite，检查完即关，不留常驻进程
let server = null;
let baseUrl = process.env.WORD_PREVIEW_BASE_URL;
if (!baseUrl) {
  server = await createServer({
    root: repoRoot,
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 3181, strictPort: false },
  });
  await server.listen();
  baseUrl = server.resolvedUrls.local[0];
}
baseUrl = baseUrl.replace(/\/$/, '');

const browser = await chromium.launch({ headless: true, channel: 'chrome' }).catch(() => chromium.launch({ headless: true, channel: 'msedge' })).catch(() => chromium.launch({ headless: true }));
try {
  await mkdir(outDir, { recursive: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.route('**/word-preview-sample.docx', async route =>
    route.fulfill({ body: await readFile(sampleDocx), contentType: DOCX }),
  );
  await page.route('**/word-preview-images.docx', async route =>
    route.fulfill({ body: await readFile(imageDocx), contentType: DOCX }),
  );
  await page.goto(`${baseUrl}/harness/review-attachment.html`);

  const openInPanel = (name, url, mimeType = DOCX) =>
    page.evaluate(
      async ({ name, url, mimeType }) => {
        const { openReviewAttachmentPreview } = await import('/src/composables/useReviewAttachmentPreview.ts');
        return openReviewAttachmentPreview('TASK-DEMO-2026-0820', {
          id: `att-${name}`,
          name,
          url,
          mimeType,
          uploadedAt: Date.now(),
        });
      },
      { name, url, mimeType },
    );

  const preview = page.locator('[data-host="preview"]');

  // 1. 打开样例 DOCX，验证 @zrimo/viewer Canvas 渲染、中文翻译工具栏、外层隐藏「新窗口打开」按钮
  await openInPanel('校审样例.docx', '/word-preview-sample.docx');
  await page.locator('[data-testid="zrimo-word-preview"] canvas').first().waitFor({ timeout: 30000 });
  await page.waitForFunction(() => {
    const canvas = document.querySelector('[data-testid="zrimo-word-preview"] canvas');
    if (!canvas || canvas.width === 0 || canvas.height === 0) return false;
    const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] > 0 && (data[i] < 240 || data[i + 1] < 240 || data[i + 2] < 240)) return true;
    }
    return false;
  });

  const uiSummary = await page.evaluate(() => {
    const root = document.querySelector('[data-zrimo-ui="root"]');
    const searchInput = root?.querySelector('.zrimo-ui__search input');
    const fitWidthBtn = root?.querySelector('[data-action="fit-width"]');
    const downloadBtn = root?.querySelector('[data-action="download"]');
    const downloadDisplay = downloadBtn ? window.getComputedStyle(downloadBtn).display : null;
    const zoomLabel = root?.querySelector('[data-control="zoom-label"]')?.textContent?.trim() ?? '';
    const outerNewTabBtn = document.querySelector('[data-testid="review-attachment-preview-open-new-tab"]');
    return {
      lang: root?.lang ?? '',
      searchPlaceholder: searchInput?.getAttribute('placeholder') ?? '',
      fitWidthTitle: fitWidthBtn?.getAttribute('title') ?? '',
      downloadDisplay,
      zoomLabel,
      hasOuterNewTabBtn: Boolean(outerNewTabBtn),
    };
  });

  assert.equal(uiSummary.lang, 'zh-CN');
  assert.equal(uiSummary.searchPlaceholder, '搜索文档内容…');
  assert.equal(uiSummary.fitWidthTitle, '适应宽度');
  assert.equal(uiSummary.downloadDisplay, 'none', 'redundant inner download button should be hidden');
  assert.equal(uiSummary.hasOuterNewTabBtn, false, 'Word preview should not show outer open-in-new-tab button');
  await preview.screenshot({ path: `${outDir}/word-preview-zrimo-sample.png` });

  // 2. 缩放交互验证
  const zoomBefore = uiSummary.zoomLabel;
  await page.locator('[data-zrimo-ui="root"] [data-action="zoom-in"]').click();
  await page.waitForFunction(
    before => document.querySelector('[data-control="zoom-label"]')?.textContent?.trim() !== before,
    zoomBefore,
  );
  const zoomAfter = await page.locator('[data-control="zoom-label"]').textContent();
  await page.locator('[data-zrimo-ui="root"] [data-action="fit-width"]').click();

  // 3. 打开多页带图 DOCX，验证页数与滚动翻页
  await openInPanel('PMS三维校审云线元素绑定操作说明-含截图操作.docx', '/word-preview-images.docx');
  await page.waitForFunction(() => {
    const text = document.querySelector('[data-control="page"] span')?.textContent ?? '';
    const m = /\/\s*(\d+)/.exec(text);
    return m && Number(m[1]) > 1;
  }, null, { timeout: 30000 });
  const pageCountText = (await page.locator('[data-control="page"] span').textContent())?.trim() ?? '';
  await preview.screenshot({ path: `${outDir}/word-preview-zrimo-guide.png` });

  assert.deepEqual(pageErrors, []);
  const report = {
    verifiedAt: new Date().toISOString(),
    uiSummary,
    zoomBefore,
    zoomAfter: zoomAfter?.trim(),
    pageCountText,
    pageErrors,
  };
  await writeFile(`${outDir}/word-preview-browser.json`, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
  await server?.close();
}