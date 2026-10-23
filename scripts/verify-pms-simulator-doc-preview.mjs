#!/usr/bin/env node
/**
 * 仿 PMS 全流程 + Word / PDF 文档上传与分屏预览端到端验证脚本
 *
 * 覆盖流程：
 *   1. SJ 在仿 PMS 模拟器点击「新增」，在嵌入页上传 Word (.docx) 与 PDF (.pdf)
 *   2. SJ 在上传列表直接点击「查看」，验证右侧分屏预览 Word（中文工具栏、多页排版）与 PDF
 *   3. SJ 点击「保存编校审数据」，验证保存成功卡片保留「已上传附件」列表及「查看」按钮，
 *      同时外层仿 PMS 侧栏「模型附件」同步展示附件并支持点击「查看」联动内嵌页分屏预览
 *   4. SJ 执行「送审提交 (active)」流转至 JH（jd 节点）
 *   5. JH 打开单据，在「三维校审 -> 附件材料」分组列表点击「查看」分屏对照预览 Word 与 PDF
 *   6. JH 同意 -> SH 同意 -> PZ 批准，完成全流程闭环至 approved，并清理测试单据
 */

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';
import { createServer } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const BACKEND_TARGET = (process.env.PMS_DOC_VERIFY_BACKEND || 'http://123.57.182.243').replace(/\/$/, '');
const PROJECT_ID = process.env.PMS_DOC_VERIFY_PROJECT || 'AvevaMarineSample';
const OUT_DIR = process.env.PMS_DOC_VERIFY_OUT
  || path.resolve(repoRoot, 'docs/verification/pms-doc-upload-preview-2026-10-23/shots');

const WORD_FILE = path.resolve(repoRoot, 'docs/guides/PMS三维校审云线元素绑定操作说明-含截图操作.docx');
const PDF_CANDIDATES = [
  path.resolve(repoRoot, 'runtime/pms-cloud-binding-guide-qa.pdf'),
  path.resolve(repoRoot, 'docs/verification/files/三维校审操作教程/空白校审附件-01.pdf'),
];
const PDF_FILE = PDF_CANDIDATES.find(p => existsSync(p));

if (!existsSync(WORD_FILE)) {
  throw new Error(`Missing Word test file: ${WORD_FILE}`);
}
if (!PDF_FILE) {
  throw new Error(`Missing PDF test file in: ${PDF_CANDIDATES.join(', ')}`);
}

async function startLocalVite() {
  const server = await createServer({
    root: repoRoot,
    logLevel: 'error',
    define: {
      'import.meta.env.VITE_GEN_MODEL_V1_BASE_URL': JSON.stringify('/gm'),
      'import.meta.env.VITE_GEN_MODEL_API_BASE_URL': JSON.stringify(''),
    },
    server: {
      host: '127.0.0.1',
      port: 3186,
      strictPort: false,
      proxy: {
        '/api': {
          target: BACKEND_TARGET,
          changeOrigin: true,
        },
        '/files/review_attachments': {
          target: BACKEND_TARGET,
          changeOrigin: true,
        },
        '/gm': {
          target: BACKEND_TARGET,
          changeOrigin: true,
          ws: true,
          rewrite: p => p.replace(/^\/gm(?=\/|$)/, ''),
        },
      },
    },
  });
  await server.listen();
  const baseUrl = server.resolvedUrls.local[0].replace(/\/$/, '');
  return { server, baseUrl };
}

async function waitFor(fn, { timeoutMs = 60000, intervalMs = 400, message = 'waitFor timeout' } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastErr = null;
  while (Date.now() < deadline) {
    try {
      const val = await fn();
      if (val) return val;
    } catch (err) {
      lastErr = err;
    }
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error(`${message}${lastErr ? `: ${lastErr.message}` : ''}`);
}

async function callSim(page, method, ...args) {
  return await page.evaluate(
    async ([m, a]) => {
      const api = window.__pmsReviewSimulatorTest;
      if (!api || typeof api[m] !== 'function') {
        throw new Error(`Simulator API ${m} not ready`);
      }
      return await api[m](...a);
    },
    [method, args],
  );
}

async function waitForRoleReady(page, role, expectedMode = 'workflow') {
  return await waitFor(
    async () => {
      const snap = await callSim(page, 'getSnapshot');
      if (snap.currentPmsUser !== role) return null;
      if (expectedMode && snap.sidePanelMode !== expectedMode) return null;
      if (!snap.canMutateWorkflow) return null;
      return snap;
    },
    { timeoutMs: 45000, message: `Wait for role ${role} sidePanelMode=${expectedMode} ready` },
  );
}

async function runWorkflowStep(page, action, comment) {
  const before = await callSim(page, 'getSnapshot');
  const beforeAt = before.lastActionAt ?? 0;
  await callSim(page, 'openWorkflowAction', action);
  await callSim(page, 'setWorkflowDialogComment', comment);
  await callSim(page, 'confirmWorkflowDialog');
  return await waitFor(
    async () => {
      const snap = await callSim(page, 'getSnapshot');
      return snap.lastAction === action && snap.lastOk === true && (snap.lastActionAt ?? 0) > beforeAt ? snap : null;
    },
    { timeoutMs: 45000, message: `workflow ${action} did not succeed` },
  );
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const { server, baseUrl } = await startLocalVite();
  const browser = await chromium
    .launch({ headless: true, channel: 'chrome' })
    .catch(() => chromium.launch({ headless: true, channel: 'msedge' }))
    .catch(() => chromium.launch({ headless: true }));

  let createdFormId = null;
  try {
    const context = await browser.newContext({ viewport: { width: 1600, height: 960 } });
    await context.addInitScript(() => {
      try {
        localStorage.setItem('plant3d_automation_review', '1');
        localStorage.setItem('plant3d_debug_ui', '1');
        localStorage.setItem('plant3d_workflow_mode', 'external');
        localStorage.setItem(
          'plant3d-onboarding-v1',
          JSON.stringify({
            completedGuides: {
              SJ__designer: true,
              SJ__designer__external: true,
              JH__proofreader: true,
              JH__proofreader__external: true,
              SH__reviewer: true,
              SH__reviewer__external: true,
              PZ__manager: true,
              PZ__manager__external: true,
            },
          }),
        );
      } catch {
        // ignore
      }
    });

    const page = await context.newPage();
    const simUrl = `${baseUrl}/pms-review-simulator.html?debug_ui=1&auth_strict=0&project=${encodeURIComponent(PROJECT_ID)}`;
    console.log(`[1/7] Opening simulator: ${simUrl}`);
    await page.goto(simUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await waitFor(() => page.evaluate(() => Boolean(window.__pmsReviewSimulatorTest)), {
      message: 'Simulator test API not ready',
    });

    // Step 1: SJ clicks "新增"
    await callSim(page, 'switchRole', 'SJ');
    await callSim(page, 'openNew');
    const opened = await waitFor(
      async () => {
        const snap = await callSim(page, 'getSnapshot');
        return snap.iframeSource === 'new' && snap.iframeUrl && snap.iframeUrl !== 'about:blank' ? snap : null;
      },
      { message: 'Wait for new review iframe URL' },
    );
    createdFormId = opened.currentFormId || new URL(opened.iframeUrl).searchParams.get('form_id');
    console.log(`[2/7] Opened new review form_id=${createdFormId}`);

    const iframeEl = await page.waitForSelector('#review-iframe', { timeout: 30000 });
    const frame = await iframeEl.contentFrame();
    assert.ok(frame, 'Embedded review-iframe contentFrame must exist');

    // Open InitiateReviewPanel inside iframe via Ribbon "校审 -> 发起编校审" (same as pms-plant3d-initiate-flow.ts)
    await waitFor(
      async () => {
        const panelCount = await frame.locator('[data-testid="designer-landing-workspace"]').count();
        if (panelCount > 0) return true;
        const reviewTab = frame.locator('[data-ribbon-tab="review"]').first();
        if (await reviewTab.count().catch(() => 0)) {
          await reviewTab.click({ timeout: 3000 }).catch(() => undefined);
        }
        const initiateBtn = frame.locator('[data-command="panel.initiateReview"]').first();
        if (await initiateBtn.count().catch(() => 0)) {
          await initiateBtn.click({ timeout: 3000 }).catch(() => undefined);
        }
        return (await frame.locator('[data-testid="designer-landing-workspace"]').count()) > 0;
      },
      { timeoutMs: 60000, intervalMs: 600, message: 'Wait for InitiateReviewPanel to open via Ribbon' },
    );

    await waitFor(
      () =>
        frame.evaluate(() =>
          Boolean(
            typeof window.__plant3dInitiateReviewE2E?.addMockComponent === 'function'
              && document.querySelector('[data-testid="file-upload-input"]'),
          ),
        ),
      { timeoutMs: 60000, message: 'Wait for __plant3dInitiateReviewE2E & file input' },
    );

    const packageName = `PMS-DOC-PREVIEW-${Date.now()}`;
    await frame.evaluate(async () => {
      await window.__plant3dInitiateReviewE2E.addMockComponent('24381_145018', 'BRAN 24381_145018');
    });
    await frame.getByPlaceholder('输入编校审数据包名称...').fill(packageName);

    // Upload Word (.docx) and PDF (.pdf) in FileUploadSection
    console.log(`[3/7] Uploading Word & PDF attachments in InitiateReviewPanel...`);
    const fileInput = frame.locator('[data-testid="file-upload-input"]');
    await fileInput.setInputFiles([WORD_FILE, PDF_FILE]);

    await waitFor(
      async () => {
        const btns = await frame.locator('[data-testid^="file-upload-preview-"]').count();
        const text = await frame.locator('.file-upload-section').innerText();
        const uploadedMatches = text.match(/已上传/g) || [];
        return btns >= 2 && uploadedMatches.length >= 2 ? true : null;
      },
      { timeoutMs: 60000, message: 'Wait for both Word and PDF files to finish uploading and show 查看 buttons' },
    );
    await page.screenshot({ path: path.join(OUT_DIR, '01-sj-initiate-upload-word-pdf.png') });

    // Step 2: SJ clicks "查看" on Word (.docx) in FileUploadSection
    console.log(`[4/7] Previewing uploaded Word (.docx) in split view...`);
    const previewBtns = frame.locator('[data-testid^="file-upload-preview-"]');
    await previewBtns.nth(0).click();

    await frame.waitForSelector('[data-testid="zrimo-word-preview"] canvas', { timeout: 45000 });
    await waitFor(
      () =>
        frame.evaluate(() => {
          const canvas = document.querySelector('[data-testid="zrimo-word-preview"] canvas');
          if (!canvas || canvas.width === 0 || canvas.height === 0) return false;
          const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
          for (let i = 0; i < data.length; i += 4) {
            if (data[i + 3] > 0 && (data[i] < 240 || data[i + 1] < 240 || data[i + 2] < 240)) return true;
          }
          return false;
        }),
      { timeoutMs: 30000, message: 'Wait for Word canvas to render non-blank content' },
    );
    await new Promise(r => setTimeout(r, 800));
    await page.screenshot({ path: path.join(OUT_DIR, '02-sj-initiate-preview-word-split.png') });

    // SJ clicks "查看" on PDF (.pdf) in FileUploadSection
    console.log(`[4b/7] Previewing uploaded PDF (.pdf) in split view...`);
    await previewBtns.nth(1).click();
    await frame.waitForSelector('[data-testid="review-attachment-pdf"]', { timeout: 30000 });
    await new Promise(r => setTimeout(r, 1000));
    await page.screenshot({ path: path.join(OUT_DIR, '03-sj-initiate-preview-pdf-split.png') });

    // Step 3: SJ clicks "保存编校审数据" and verifies post-save attachment preview list + outer simulator side panel
    console.log(`[5/7] Saving review form and verifying post-save attachment list & simulator side panel...`);
    const submitBtn = frame.locator('[data-guide="submit-btn"]');
    await submitBtn.waitFor({ state: 'visible', timeout: 20000 });
    await waitFor(
      async () => {
        const disabled = await submitBtn.getAttribute('disabled');
        const ariaDisabled = await submitBtn.getAttribute('aria-disabled');
        return !disabled && ariaDisabled !== 'true';
      },
      { timeoutMs: 30000, message: 'Wait for submit-btn to become enabled' },
    );
    await submitBtn.click();

    await waitFor(
      async () => {
        const innerCount = await frame.locator('[data-testid^="review-attachment-preview-"]').count();
        const outerCount = await page.locator('[data-testid^="sim-attachment-preview-"]').count();
        return innerCount >= 2 && outerCount >= 2 ? { innerCount, outerCount } : null;
      },
      { timeoutMs: 30000, message: 'Wait for saved attachment preview buttons in both inner card and outer simulator panel' },
    );

    // Expand simulator side panel (side-by-side mode) and click "查看" on Word (.docx) from the outer simulator side panel
    await callSim(page, 'ensureSidePanelExpanded');
    await new Promise(r => setTimeout(r, 400));
    await page.locator('[data-testid^="sim-attachment-preview-"][data-attachment-name$=".docx"]').first().click();
    await frame.waitForSelector('[data-testid="zrimo-word-preview"] canvas', { timeout: 30000 });
    await new Promise(r => setTimeout(r, 800));
    await page.screenshot({ path: path.join(OUT_DIR, '04-sj-saved-card-and-sim-panel-attachments.png') });

    // Step 4: SJ submits workflow active -> JH opens task and previews Word & PDF in ReviewPanel
    console.log(`[6/7] Running SJ active -> switching to JH proofreader and previewing attachments...`);
    const afterActive = await runWorkflowStep(page, 'active', 'SJ 送审：含 Word 与 PDF 校审附件');
    const taskId = afterActive.currentTaskId || afterActive.selectedTaskId;

    await callSim(page, 'openTaskByFormId', {
      formId: createdFormId,
      taskId,
      role: 'JH',
      source: 'task-view',
    });

    const jhIframeEl = await page.waitForSelector('#review-iframe', { timeout: 30000 });
    const jhFrame = await jhIframeEl.contentFrame();
    assert.ok(jhFrame, 'JH review-iframe contentFrame must exist');

    await waitFor(
      async () => {
        const count = await jhFrame.locator('[data-testid^="review-attachment-preview-"]').count();
        return count >= 2 ? count : null;
      },
      { timeoutMs: 60000, message: 'Wait for JH ReviewPanel AssociatedFilesList preview buttons' },
    );

    const archiveToggle = jhFrame.locator('[data-testid="review-archive-toggle"]').first();
    if (await archiveToggle.count()) {
      await archiveToggle.click();
      await new Promise(r => setTimeout(r, 400));
    }

    // In AssociatedFilesList inside review-workbench-attachments-zone, GROUP_ORDER puts "PDF 文件" first and "文档文件" second
    const jhPreviewBtns = jhFrame.locator('[data-testid="review-workbench-attachments-zone"] [data-testid^="review-attachment-preview-"]');
    await jhPreviewBtns.nth(1).scrollIntoViewIfNeeded();
    // Click Word preview in JH ReviewPanel
    await jhPreviewBtns.nth(1).click();
    await jhFrame.waitForSelector('[data-testid="zrimo-word-preview"] canvas', { timeout: 45000 });
    await waitFor(
      () =>
        jhFrame.evaluate(() => {
          const canvas = document.querySelector('[data-testid="zrimo-word-preview"] canvas');
          return canvas && canvas.width > 0 && canvas.height > 0;
        }),
      { timeoutMs: 30000, message: 'Wait for JH Word preview canvas' },
    );
    await new Promise(r => setTimeout(r, 1000));
    await page.screenshot({ path: path.join(OUT_DIR, '05-jh-review-panel-preview-word.png') });

    // Click PDF preview in JH ReviewPanel
    await jhPreviewBtns.nth(0).click();
    await jhFrame.waitForSelector('[data-testid="review-attachment-pdf"]', { timeout: 30000 });
    await new Promise(r => setTimeout(r, 1000));
    await page.screenshot({ path: path.join(OUT_DIR, '06-jh-review-panel-preview-pdf.png') });

    // Step 5: Complete JH agree -> SH agree -> PZ agree (approved)
    console.log(`[7/7] Completing JH agree -> SH agree -> PZ agree workflow...`);
    await waitForRoleReady(page, 'JH', 'workflow');
    await runWorkflowStep(page, 'agree', 'JH 校核通过：Word 与 PDF 附件核对无误');

    await callSim(page, 'openTaskByFormId', {
      formId: createdFormId,
      taskId,
      role: 'SH',
      source: 'task-view',
    });
    await waitForRoleReady(page, 'SH', 'workflow');
    await runWorkflowStep(page, 'agree', 'SH 审核通过');

    await callSim(page, 'openTaskByFormId', {
      formId: createdFormId,
      taskId,
      role: 'PZ',
      source: 'task-view',
    });
    await waitForRoleReady(page, 'PZ', 'workflow');
    const finalSnap = await runWorkflowStep(page, 'agree', 'PZ 批准通过');
    assert.equal(finalSnap.currentTaskStatus, 'approved', 'Final task status must be approved');
    await new Promise(r => setTimeout(r, 800));
    await page.screenshot({ path: path.join(OUT_DIR, '07-pz-approved-complete.png') });

    const summary = {
      verifiedAt: new Date().toISOString(),
      backendTarget: BACKEND_TARGET,
      projectId: PROJECT_ID,
      formId: createdFormId,
      taskId,
      packageName,
      finalStatus: finalSnap.currentTaskStatus,
      finalNode: finalSnap.currentWorkflowNode,
      screenshots: [
        '01-sj-initiate-upload-word-pdf.png',
        '02-sj-initiate-preview-word-split.png',
        '03-sj-initiate-preview-pdf-split.png',
        '04-sj-saved-card-and-sim-panel-attachments.png',
        '05-jh-review-panel-preview-word.png',
        '06-jh-review-panel-preview-pdf.png',
        '07-pz-approved-complete.png',
      ],
    };
    await writeFile(path.join(OUT_DIR, '..', 'report.json'), `${JSON.stringify(summary, null, 2)}\n`);
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    // Cleanup test form from backend
    if (createdFormId) {
      try {
        const authRes = await fetch(`${BACKEND_TARGET}/api/auth/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ project_id: PROJECT_ID, user_id: 'SJ', role: 'sj' }),
        });
        const authBody = await authRes.json();
        const token = authBody?.data?.token || authBody?.token;
        if (token) {
          await fetch(`${BACKEND_TARGET}/api/review/delete`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              form_ids: [createdFormId],
              operator_id: 'SJ',
              token,
            }),
          });
        }
      } catch {
        // ignore cleanup error
      }
    }
    await browser.close();
    await server.close();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});