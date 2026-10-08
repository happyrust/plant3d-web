#!/usr/bin/env node
/**
 * 线上三维校审全流程验收（外部流程模式）：模拟 PMS 后端直调模型中心 API + Playwright 无头 Chromium 驾驭线上嵌入页真点。
 *
 * 用法（仓库根目录）：
 *   node scripts/online-review-acceptance.mjs all        # TC1 + TC2
 *   node scripts/online-review-acceptance.mjs tc1        # 正向全通：SJ 发起 → active → JH 测量+确认 → agree → SH → PZ → approved → reopen
 *   node scripts/online-review-acceptance.mjs tc2        # 驳回回路：JH 批注 → verify 被拦 → return → SJ「已修改」→ 重提 → JH「同意」→ agree → SH → PZ → approved
 *   node scripts/online-review-acceptance.mjs resave     # 二次保存：重开自动落到发起面板 →「保存修改」→ 同一 task → active → 送审后再保存 409 → JH 看到新构件 → approved
 *   node scripts/online-review-acceptance.mjs smoke      # 只领 token / embed-url，开 SJ 嵌入页确认面板出现；不建单、不推流程
 *
 * 环境变量：
 *   P3D_BASE      模型中心 / 前端站点，默认 http://123.57.182.243（nginx 80：前端 + /api 反代 gen-model）
 *   P3D_PROJECT   output_project / project_id，默认 AvevaMarineSample
 *   P3D_BRAN      发起编校审注入的 BRAN，默认 24381_145018
 *   P3D_BRAN2     RESAVE 二次保存时加进去的第二个构件，默认 24384_24935
 *   OUT_DIR       截图 / 报告输出目录，默认 tmp/online-review-acceptance（已 gitignore）
 *
 * 每张单都是真建：TC1 / TC2 / RESAVE 各在模型中心留一张 approved 的单（包名 ACCEPT-<时间戳>-<用例>），可在 PMS 仿真页或 API 里查看 / 删除。
 * 做法与 2026-09-28 首次实跑结果见 docs/verification/online-3d-review-acceptance-2026-09-28/README.md。
 *
 * 两个时序坑（首轮实跑踩到，脚本已绕开）：
 *   1. 嵌入页刚挂出 __plant3dReviewerE2E 钩子就注入草稿会被随后的 applyProject / 任务作用域切换
 *      （refreshToolStorePersistedScope）整体换掉——页面显示「本机 无草稿」、confirm 无 POST。所以先等模型加载提示消失 + 网络空闲。
 *   2. 「批注表格 共 N 条」只列已落库批注，草稿不计；判断草稿是否留在当前任务容器里要用 getAnnotationCount()。
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { chromium } from 'playwright';

const BASE = (process.env.P3D_BASE || 'http://123.57.182.243').replace(/\/$/, '');
const PROJECT = process.env.P3D_PROJECT || 'AvevaMarineSample';
const BRAN = process.env.P3D_BRAN || '24381_145018';
const OUT = process.env.OUT_DIR || path.resolve('tmp/online-review-acceptance');
const WHICH = (process.argv[2] || 'all').toLowerCase();
const STAMP = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');

if (WHICH === '--help' || WHICH === '-h' || !['all', 'tc1', 'tc2', 'resave', 'smoke'].includes(WHICH)) {
  console.log('用法：node scripts/online-review-acceptance.mjs <all|tc1|tc2|resave|smoke>\n环境变量：P3D_BASE P3D_PROJECT P3D_BRAN P3D_BRAN2 OUT_DIR（见文件头注释）');
  process.exit(WHICH === '--help' || WHICH === '-h' ? 0 : 2);
}

const ROLES = {
  SJ: { id: 'SJ', name: 'SJ', role: 'sj' },
  JH: { id: 'JH', name: 'JH', role: 'jd' },
  SH: { id: 'SH', name: 'SH', role: 'sh' },
  PZ: { id: 'PZ', name: 'PZ', role: 'pz' },
};

const report = { base: BASE, project: PROJECT, bran: BRAN, startedAt: new Date().toISOString(), cases: [] };
let current = null;

function log(...args) {
  const line = `[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}] ${args.join(' ')}`;
  console.log(line);
  current?.log.push(line);
}

function step(name, ok, detail) {
  current.steps.push({ name, ok, detail });
  const text = detail === undefined ? '' : ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`;
  log(`${ok ? '✓' : '✗'} ${name}${text}`);
  if (!ok) current.failed += 1;
}

function begin(id, title) {
  current = { id, title, steps: [], failed: 0, log: [], uiErrors: [], api: {} };
  report.cases.push(current);
  log(`\n═══ ${id} ${title} ═══`);
}

// ---------------------------------------------------------------------------
// 模型中心 API（模拟 PMS 后端那一跳）
// ---------------------------------------------------------------------------
async function api(method, p, body, bearer) {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  const resp = await fetch(`${BASE}${p}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  const text = await resp.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { _raw: text.slice(0, 300) };
  }
  return { status: resp.status, json };
}

async function mint(who) {
  const r = await api('POST', '/api/auth/token', { project_id: PROJECT, user_id: who.id, user_name: who.name, role: who.role });
  if (r.status !== 200 || !r.json?.data?.token) {
    throw new Error(`auth/token ${who.id} failed: ${r.status} ${JSON.stringify(r.json).slice(0, 200)}`);
  }
  return r.json.data.token;
}

/** PMS 后端 GetZyModelUrl 做的事：领一张空白单存根 */
async function embedUrlForm(sjToken) {
  const r = await api('POST', '/api/review/embed-url', { project_id: PROJECT, user_id: 'SJ', workflow_role: 'sj', token: sjToken });
  const formId = r.json?.data?.query?.form_id;
  if (r.status !== 200 || !formId) throw new Error(`embed-url failed: ${r.status} ${JSON.stringify(r.json).slice(0, 200)}`);
  return { formId, url: r.json.url, form: r.json.data.form };
}

const actorOf = (who) => ({ id: who.id, name: who.name, roles: who.role });

/** PMS 后端 SyncRevInfo（action=active|agree|return|stop）/ 打开时的 query */
async function sync(formId, token, who, action, comments, nextStep) {
  const body = { form_id: formId, token, action, actor: actorOf(who), comments: comments || '' };
  if (nextStep) body.next_step = { assignee_id: nextStep.id, name: nextStep.name, roles: nextStep.role };
  return api('POST', '/api/review/workflow/sync', body);
}

/** PMS 后端 PreValidate（不写库） */
async function verify(formId, token, who, action, nextStep) {
  const body = { form_id: formId, token, action, actor: actorOf(who), comments: `预验证 ${action}` };
  if (nextStep) body.next_step = { assignee_id: nextStep.id, name: nextStep.name, roles: nextStep.role };
  return api('POST', '/api/review/workflow/verify', body);
}

function snap(r) {
  const d = r.json?.data || {};
  return {
    http: r.status,
    code: r.json?.code,
    msg: r.json?.message,
    form_status: d.form_status,
    task_status: d.task_status,
    current_node: d.current_node,
    task_id: d.task_id,
    records: Array.isArray(d.records) ? d.records.length : d.records,
    attachments: Array.isArray(d.attachments) ? d.attachments.length : d.attachments,
  };
}

async function history(taskId, token) {
  const r = await api('GET', `/api/review/tasks/${encodeURIComponent(taskId)}/workflow`, undefined, token);
  const h = r.json?.history || r.json?.data?.history || [];
  return { http: r.status, lines: h.map((x) => `${x.node} ${x.action} by ${x.operatorId || x.operator_id || '?'}`) };
}

async function states(formId, token) {
  const r = await api('GET', `/api/review/annotation-states?form_id=${encodeURIComponent(formId)}`, undefined, token);
  const s = r.json?.states || r.json?.data?.states || [];
  return { http: r.status, lines: s.map((x) => `${x.annotationId} r${x.reviewRound} ${x.resolutionStatus}/${x.decisionStatus}`), raw: s };
}

const verifyBlocked = (v) => v.status !== 200 || v.json?.data?.passed === false;
const verifyPassed = (v) => v.status === 200 && v.json?.data?.passed !== false;
const brief = (v) => ({ http: v.status, body: JSON.stringify(v.json).slice(0, 260) });

// ---------------------------------------------------------------------------
// 浏览器：每个角色一个独立 context（独立 localStorage，避免本机草稿互串）
// ---------------------------------------------------------------------------
const embed = (formId, token) => `${BASE}/review/3d-view?form_id=${encodeURIComponent(formId)}&user_token=${encodeURIComponent(token)}&output_project=${encodeURIComponent(PROJECT)}&automation_review=1`;

let browser;

async function openRole(formId, token, tag) {
  const context = await browser.newContext({ viewport: { width: 1800, height: 1050 }, ignoreHTTPSErrors: true, locale: 'zh-CN' });
  await context.addInitScript(() => {
    try {
      localStorage.setItem('plant3d_automation_review', '1');
    } catch {}
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 200)}`);
  });
  const apiCalls = [];
  page.on('response', (resp) => {
    const u = resp.url();
    if (/\/api\/review\/(records|annotation-states|tasks|workflow)/.test(u)) {
      apiCalls.push(`${resp.request().method()} ${u.replace(BASE, '')} → ${resp.status()}`);
    }
  });
  await page.goto(embed(formId, token), { waitUntil: 'domcontentloaded', timeout: 90_000 });
  return { context, page, errors, apiCalls, tag };
}

async function shot(page, name) {
  const fp = path.join(OUT, `${STAMP}-${name}.png`);
  await page.screenshot({ path: fp, fullPage: false, timeout: 20_000 }).catch((e) => log(`screenshot failed ${name}: ${e.message}`));
  return fp;
}

const bodyText = (page) => page.evaluate(() => document.body.innerText).catch(() => '');

async function textOf(page, sel, max = 400) {
  try {
    const t = await page.locator(sel).first().innerText({ timeout: 3000 });
    return t.replace(/\s+/g, ' ').slice(0, max);
  } catch {
    return null;
  }
}

async function waitAny(page, selectors, timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const s of selectors) {
      if (await page.locator(s).first().isVisible().catch(() => false)) return s;
    }
    await page.waitForTimeout(500);
  }
  return null;
}

/** 等页面稳定：模型加载提示消失 + 网络空闲 + 缓冲（见文件头「时序坑 1」） */
async function waitStable(page, label) {
  const t0 = Date.now();
  const loading = page.getByText(/从 gen-model 加载|正在加载|加载中/).first();
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (!(await loading.isVisible().catch(() => false))) break;
    await page.waitForTimeout(500);
  }
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(3000);
  log(`${label}: 页面稳定（${Math.round((Date.now() - t0) / 1000)}s）`);
}

async function tableCount(page) {
  const m = (await bodyText(page)).match(/共 (\d+) 条/);
  return m ? Number(m[1]) : null;
}

async function closeRole(s) {
  current.uiErrors.push(...s.errors.slice(0, 5));
  await s.context.close();
}

// ---------------------------------------------------------------------------
// UI：SJ 发起编校审
// ---------------------------------------------------------------------------
/** 新建单据和已送审单据的设计端落点是三维查看器，不会自动弹发起面板；只有重开编制节点的已保存草稿才自动落到发起面板 */
async function openInitiatePanel(page) {
  const panel = '[data-testid="designer-landing-workspace"]';
  const hit = await waitAny(page, [panel], 60_000);
  if (hit) return hit;
  // 照人的走法：Ribbon 校审 → 发起编校审
  const tab = page.locator('[data-ribbon-tab="review"]').first();
  if (await tab.count()) await tab.click({ timeout: 5000 }).catch(() => {});
  const btn = page.locator('[data-command="panel.initiateReview"]').first();
  if (await btn.count()) await btn.click({ timeout: 5000 }).catch(() => {});
  return waitAny(page, [panel], 60_000);
}

async function uiSjInitiate(formId, sjToken, pkg, { submit = true } = {}) {
  const s = await openRole(formId, sjToken, 'SJ-initiate');
  const { page } = s;
  try {
    const hit = await openInitiatePanel(page);
    step('SJ 嵌入页出现发起编校审面板', !!hit, hit || (await bodyText(page)).slice(0, 300));
    if (!submit) {
      await shot(page, `${current.id}-01-sj-initiate-panel`);
      return null;
    }
    await page.waitForFunction(() => typeof window.__plant3dInitiateReviewE2E?.addMockComponent === 'function', null, { timeout: 45_000 });
    await page.evaluate(async (ref) => {
      await window.__plant3dInitiateReviewE2E.addMockComponent(ref, `BRAN ${ref}`);
    }, BRAN);
    const listHasBran = await page
      .waitForFunction((ref) => document.body.innerText.includes(ref) || document.body.innerText.includes(ref.replace('_', '/')), BRAN, { timeout: 15_000 })
      .then(() => true)
      .catch(() => false);
    step('构件列表出现 BRAN', listHasBran, BRAN);
    await page.getByPlaceholder('输入编校审数据包名称...').fill(pkg);
    const checkerSel = page.locator('[data-testid="initiate-checker-select"]');
    const approverSel = page.locator('[data-testid="initiate-approver-select"]');
    if ((await checkerSel.count()) && (await approverSel.count())) {
      await page
        .waitForFunction(() => {
          const c = document.querySelector('[data-testid="initiate-checker-select"]');
          const a = document.querySelector('[data-testid="initiate-approver-select"]');
          return c && a && [...c.options].some((o) => o.value) && [...a.options].some((o) => o.value);
        }, null, { timeout: 60_000 })
        .catch(() => {});
      const cv = await checkerSel.locator('option').evaluateAll((o) => o.map((x) => x.value).filter(Boolean));
      const av = await approverSel.locator('option').evaluateAll((o) => o.map((x) => x.value).filter(Boolean));
      const cid = cv.find((v) => /JH/i.test(v)) || cv[0];
      const aid = av.find((v) => /PZ/i.test(v)) || av.find((v) => v !== cid) || av[0];
      if (cid) await checkerSel.selectOption(cid);
      if (aid) await approverSel.selectOption(aid);
      log(`checker=${cid} approver=${aid}`);
    } else {
      log('无校核/批准下拉（外部流程模式）');
    }
    await shot(page, `${current.id}-01-sj-initiate-form`);
    const submitBtn = page.locator('[data-guide="submit-btn"]').first();
    await submitBtn.waitFor({ state: 'visible', timeout: 20_000 });
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const d = await submitBtn.getAttribute('disabled');
      const ad = await submitBtn.getAttribute('aria-disabled');
      if (!d && ad !== 'true') break;
      await page.waitForTimeout(400);
    }
    await submitBtn.click({ timeout: 20_000 });
    const toast = await page.getByText(/编校审单(创建|保存)成功/).first().waitFor({ state: 'visible', timeout: 30_000 }).then(() => true).catch(() => false);
    let result = null;
    for (let i = 0; i < 40 && !result?.taskId; i += 1) {
      result = await page.evaluate(() => window.__plant3dInitiateReviewE2E?.getLastCreateResult?.() || null).catch(() => null);
      if (!result?.taskId) await page.waitForTimeout(500);
    }
    step('SJ 点击「创建编校审数据」成功', toast || !!result?.taskId, { toast, result });
    await shot(page, `${current.id}-02-sj-initiated`);
    return result;
  } finally {
    await closeRole(s);
  }
}

// ---------------------------------------------------------------------------
// UI：JH 批注(可选) + 测量 + 确认当前数据
// ---------------------------------------------------------------------------
async function uiJhAnnotate(formId, jhToken, title, { withAnnotation = true } = {}) {
  const s = await openRole(formId, jhToken, 'JH-annotate');
  const { page } = s;
  try {
    const hit = await waitAny(page, ['[data-testid="reviewer-landing-workspace"]', '[data-testid="review-workbench-workflow-zone"]'], 90_000);
    step('JH 嵌入页出现校审工作台', !!hit, hit);
    await page.waitForFunction(() => typeof window.__plant3dReviewerE2E?.addMockAnnotation === 'function', null, { timeout: 60_000 });
    await waitStable(page, 'JH');
    const text = await bodyText(page);
    const node = (text.match(/当前节点[：:]?\s*[^\n]{0,20}/) || [null])[0];
    const taskBound = text.includes(formId);
    step('JH 页面显示当前节点 / 外部流程模式 / 任务详情含 form_id', !!node && taskBound, {
      node,
      external: /外部流程模式/.test(text),
      taskBound,
      status: (text.match(/当前状态[：:]?\s*[^\n]{0,12}/) || [null])[0],
    });
    let annotationId = null;
    let measureId = null;
    let pending = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      if (withAnnotation) {
        annotationId = await page.evaluate((t) => window.__plant3dReviewerE2E.addMockAnnotation(t, '线上验收：校对人员通过自动化钩子创建的文字批注（挂 24381/145018）'), title);
      }
      measureId = await page.evaluate(() => window.__plant3dReviewerE2E.addMockMeasurement('distance'));
      await page.waitForTimeout(2500);
      pending = await page.evaluate(() => window.__plant3dReviewerE2E.getAnnotationCount()).catch(() => null);
      const draftText = (await bodyText(page)).match(/本机[^\n]{0,30}/)?.[0] ?? null;
      log(`注入尝试 ${attempt}: annotation=${annotationId} measure=${measureId} pending=${pending} 本机=「${draftText}」`);
      if (!withAnnotation || (pending ?? 0) >= 1) break;
      await page.waitForTimeout(5000);
    }
    step(
      withAnnotation ? 'JH 添加 1 条文字批注 + 1 条距离测量（草稿态）' : 'JH 添加 1 条距离测量（草稿态，作为证据）',
      withAnnotation ? pending === 1 : !!measureId,
      { annotationId, measureId, pendingAnnotationCount: pending },
    );
    await shot(page, `${current.id}-03-jh-draft`);
    await page.evaluate(async () => {
      await window.__plant3dReviewerE2E.confirmData('线上验收：确认当前数据');
    });
    let confirmed = 0;
    for (let i = 0; i < 40 && !confirmed; i += 1) {
      confirmed = await page.evaluate(() => window.__plant3dReviewerE2E.getConfirmedRecordCount()).catch(() => 0);
      if (!confirmed) await page.waitForTimeout(500);
    }
    const posted = s.apiCalls.filter((c) => /POST \/api\/review\/records/.test(c));
    const toastSaved = /确认数据已保存|已确认到修订|审核记录 1/.test(await bodyText(page));
    step('JH「确认当前数据」→ POST /api/review/records 200，确认记录 1', confirmed >= 1 && posted.some((c) => /→ 200/.test(c)), {
      confirmedRecordCount: confirmed,
      posted,
      toastSaved,
    });
    await page.waitForTimeout(1500);
    await shot(page, `${current.id}-04-jh-confirmed`);
    return { annotationId, measureId };
  } finally {
    await closeRole(s);
  }
}

// ---------------------------------------------------------------------------
// UI：期望某决定按钮不可用（设计未处理前 JH 不能「同意」）
// ---------------------------------------------------------------------------
async function uiExpectDecisionDisabled(formId, token, who, label, tag) {
  const s = await openRole(formId, token, tag);
  const { page } = s;
  try {
    await waitAny(page, ['[data-testid="reviewer-landing-workspace"]', '[data-testid="annotation-table-view"]'], 90_000);
    await waitStable(page, who.id);
    const row = page.locator('[data-testid^="annotation-table-row-"]').first();
    await row.waitFor({ state: 'visible', timeout: 30_000 });
    const rowText = (await row.innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 120);
    await row.click({ timeout: 10_000 });
    const btn = page.getByRole('button', { name: label, exact: true }).first();
    const visible = await btn.waitFor({ state: 'visible', timeout: 15_000 }).then(() => true).catch(() => false);
    const disabled = visible ? await btn.isDisabled().catch(() => null) : null;
    step(`${who.id} 在设计侧未处理前「${label}」应不可用`, visible && disabled === true, { rowText, visible, disabled });
    await shot(page, `${current.id}-${tag}`);
  } finally {
    await closeRole(s);
  }
}

// ---------------------------------------------------------------------------
// UI：打开批注行并执行 已修改 / 不需解决 / 同意 / 驳回
// ---------------------------------------------------------------------------
async function uiHandleAnnotation(formId, token, who, action, note, tag) {
  const label = { fixed: '已修改', wont_fix: '不需解决', agree: '同意', reject: '驳回' }[action];
  const s = await openRole(formId, token, tag);
  const { page } = s;
  try {
    const hit = await waitAny(page, ['[data-testid="reviewer-landing-workspace"]', '[data-testid="designer-landing-workspace"]', '[data-testid="annotation-table-view"]'], 90_000);
    step(`${who.id} 嵌入页加载`, !!hit, hit);
    await waitStable(page, who.id);
    const table = page.locator('[data-testid="annotation-table-view"]').first();
    const toggle = page.locator('[data-testid="annotation-overlay-details-toggle"]').first();
    const openDeadline = Date.now() + 60_000;
    while (Date.now() < openDeadline && !(await table.isVisible().catch(() => false))) {
      if (await toggle.isVisible().catch(() => false)) {
        await toggle.click({ timeout: 5000 }).catch(() => {});
        log('点击浮层「打开批注单」');
        await page.waitForTimeout(1500);
      } else {
        await page.waitForTimeout(800);
      }
    }
    const tableVisible = await table.waitFor({ state: 'visible', timeout: 30_000 }).then(() => true).catch(() => false);
    const stats = await textOf(page, '[data-testid="annotation-table-view"] >> text=/共 \\d+ 条/', 120);
    step(`${who.id} 看到批注表格`, tableVisible, stats);
    const returnReason = (await bodyText(page)).match(/(打回原因|退回原因|驳回原因)[：:]?\s*[^\n]{0,60}/)?.[0] ?? null;
    if (returnReason) log(`页面显示 ${returnReason}`);
    await shot(page, `${current.id}-${tag}-a-table`);
    const row = page.locator('[data-testid^="annotation-table-row-"]').first();
    await row.waitFor({ state: 'visible', timeout: 60_000 });
    const rowText = (await row.innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 160);
    log(`批注行：${rowText}`);
    await row.click({ timeout: 10_000 });
    const actionBtn = page.getByRole('button', { name: label, exact: true }).first();
    const btnVisible = await actionBtn.waitFor({ state: 'visible', timeout: 15_000 }).then(() => true).catch(() => false);
    if (!btnVisible) {
      await shot(page, `${current.id}-${tag}-b-no-button`);
      throw new Error(`未找到按钮「${label}」`);
    }
    let btnDisabled = await actionBtn.isDisabled().catch(() => false);
    for (let i = 0; i < 20 && btnDisabled; i += 1) {
      await page.waitForTimeout(500);
      btnDisabled = await actionBtn.isDisabled().catch(() => false);
    }
    step(`${who.id} 打开批注详情，看到可用的「${label}」按钮`, btnVisible && !btnDisabled, { rowText, disabled: btnDisabled });
    if (btnDisabled) {
      await shot(page, `${current.id}-${tag}-b-disabled`);
      throw new Error(`按钮「${label}」不可用`);
    }
    await actionBtn.click({ timeout: 10_000 });
    const noteBox = page.locator('[data-testid="review-action-note"]').first();
    const placeholder = await noteBox.getAttribute('placeholder').catch(() => null);
    const required = await noteBox.getAttribute('aria-required').catch(() => null);
    if (note) await noteBox.fill(note);
    log(`备注框 placeholder=「${placeholder}」 aria-required=${required}`);
    const submit = page.locator('[data-testid="review-action-submit"]').first();
    await submit.waitFor({ state: 'visible', timeout: 10_000 });
    const submitLabel = (await submit.innerText().catch(() => '')).trim();
    await shot(page, `${current.id}-${tag}-b-before-submit`);
    const appliedPromise = page
      .waitForResponse((r) => /\/api\/review\/annotation-states\/apply/.test(r.url()) && r.request().method() === 'POST', { timeout: 30_000 })
      .then(async (r) => ({ status: r.status(), body: (await r.text().catch(() => '')).slice(0, 300) }))
      .catch(() => null);
    await submit.click({ timeout: 10_000 });
    const applied = await appliedPromise;
    step(`${who.id} 点击「${submitLabel}」→ POST annotation-states/apply`, applied?.status === 200, { placeholder, required, applied });
    await page.waitForTimeout(4000);
    const statsAfter = await textOf(page, '[data-testid="annotation-table-view"] >> text=/共 \\d+ 条/', 120);
    const rowAfter = (await page.locator('[data-testid^="annotation-table-row-"]').first().innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200);
    log(`提交后统计：${statsAfter}；行：${rowAfter}`);
    await shot(page, `${current.id}-${tag}-c-after-submit`);
    return { applied, statsAfter, rowAfter, returnReason };
  } finally {
    await closeRole(s);
  }
}

// ---------------------------------------------------------------------------
// UI：只读复核（SH / PZ / 终态 / 设计侧终态落地页）
// ---------------------------------------------------------------------------
const REVIEW_LANDING = ['[data-testid="reviewer-landing-workspace"]', '[data-testid="review-workbench-workflow-zone"]', '[data-testid="designer-landing-workspace"]', '[data-testid="annotation-table-view"]'];

async function uiView(formId, token, who, tag, expectRe, selectors = REVIEW_LANDING) {
  const s = await openRole(formId, token, tag);
  const { page } = s;
  try {
    const hit = await waitAny(page, selectors, 90_000);
    await waitStable(page, who.id);
    const text = await bodyText(page);
    const node = (text.match(/当前节点[：:]?\s*[^\n]{0,24}/) || [null])[0];
    const status = (text.match(/当前状态[：:]?\s*[^\n]{0,12}/) || [null])[0];
    const stats = (text.match(/共 \d+ 条[^\n]{0,60}/) || [null])[0];
    const detail = { landing: hit, node, status, stats, external: /外部流程模式/.test(text), expect: expectRe ? String(expectRe) : null };
    step(`${who.id} 复核页面（${tag}）`, !!hit && (expectRe ? expectRe.test(text) : true), detail);
    await shot(page, `${current.id}-${tag}`);
    return detail;
  } finally {
    await closeRole(s);
  }
}

// ---------------------------------------------------------------------------
// TC-1 正向全通
// ---------------------------------------------------------------------------
async function tc1(tokens) {
  begin('TC1', '正向全通：SJ 发起 → active → JH 测量+确认 → agree → SH agree → PZ agree → approved → 终态 reopen');
  const { formId, form } = await embedUrlForm(tokens.SJ);
  step('模拟 PMS GetZyModelUrl → POST /api/review/embed-url 领 form_id', !!formId, { formId, form });
  current.api.formId = formId;
  const pkg = `ACCEPT-${STAMP}-TC1`;
  const created = await uiSjInitiate(formId, tokens.SJ, pkg);
  const taskId = created?.taskId;
  Object.assign(current.api, { taskId, packageName: pkg });
  let q = snap(await sync(formId, tokens.SJ, ROLES.SJ, 'query'));
  step('query：建单后 draft / sj', q.task_status === 'draft' && q.current_node === 'sj', q);
  const v1 = await verify(formId, tokens.SJ, ROLES.SJ, 'active', ROLES.JH);
  step('模拟 PMS PreValidate → workflow/verify active 通过', verifyPassed(v1), brief(v1));
  let r = snap(await sync(formId, tokens.SJ, ROLES.SJ, 'active', '送审（线上验收）', ROLES.JH));
  step('模拟 PMS SyncRevInfo → sync active：submitted / jd', r.task_status === 'submitted' && r.current_node === 'jd', r);
  // 正向主线：JH 只补测量证据并确认（无待处理批注，可直接放行）
  const anno = await uiJhAnnotate(formId, tokens.JH, `验收 ${STAMP} TC1`, { withAnnotation: false });
  current.api.measureId = anno.measureId;
  q = snap(await sync(formId, tokens.JH, ROLES.JH, 'query'));
  step('query：records=1（测量证据已落库）', q.records >= 1, q);
  const v2 = await verify(formId, tokens.JH, ROLES.JH, 'agree', ROLES.SH);
  step('JH verify agree（无待处理批注）→ 通过', verifyPassed(v2), brief(v2));
  r = snap(await sync(formId, tokens.JH, ROLES.JH, 'agree', '校对同意（线上验收）', ROLES.SH));
  step('JH sync agree：in_review / sh', r.current_node === 'sh', r);
  await uiView(formId, tokens.SH, ROLES.SH, '05-sh-view', /审核/);
  r = snap(await sync(formId, tokens.SH, ROLES.SH, 'agree', '审核同意（线上验收）', ROLES.PZ));
  step('SH sync agree：/ pz', r.current_node === 'pz', r);
  await uiView(formId, tokens.PZ, ROLES.PZ, '06-pz-view', /批准/);
  r = snap(await sync(formId, tokens.PZ, ROLES.PZ, 'agree', '批准通过（线上验收）'));
  step('PZ sync agree：approved / approved', r.form_status === 'approved' && r.task_status === 'approved', r);
  await uiView(formId, tokens.PZ, ROLES.PZ, '07-pz-approved-reopen', /已通过|仅可查看|已完成/);
  const h = await history(taskId, tokens.PZ);
  step(
    'workflow history：sj submit → jd approve → sh approve → pz approve',
    h.lines.length >= 4 && /sj submit/.test(h.lines[0]) && /pz approve/.test(h.lines[h.lines.length - 1]),
    h.lines,
  );
  current.api.history = h.lines;
  current.api.states = (await states(formId, tokens.PZ)).lines;
}

// ---------------------------------------------------------------------------
// TC-2 驳回回路
// ---------------------------------------------------------------------------
async function tc2(tokens) {
  begin('TC2', '驳回回路：SJ 发起 → active → JH 批注 → return → SJ 已修改 → 重提 active → JH 同意 → agree → SH → PZ → approved');
  const { formId } = await embedUrlForm(tokens.SJ);
  step('embed-url 领 form_id', !!formId, { formId });
  current.api.formId = formId;
  const pkg = `ACCEPT-${STAMP}-TC2`;
  const created = await uiSjInitiate(formId, tokens.SJ, pkg);
  const taskId = created?.taskId;
  Object.assign(current.api, { taskId, packageName: pkg });
  let r = snap(await sync(formId, tokens.SJ, ROLES.SJ, 'active', '送审（线上验收 TC2）', ROLES.JH));
  step('SJ sync active：submitted / jd', r.task_status === 'submitted' && r.current_node === 'jd', r);
  const anno = await uiJhAnnotate(formId, tokens.JH, `验收批注 ${STAMP} TC2`);
  current.api.annotationId = anno.annotationId;
  const q = snap(await sync(formId, tokens.JH, ROLES.JH, 'query'));
  step('query：records=1（批注 + 测量已落库）', q.records >= 1, q);
  const st0 = await states(formId, tokens.JH);
  step('annotation-states：round1 open/pending', st0.lines.some((l) => /r1 open\/pending/.test(l)), st0.lines);
  const vBlock = await verify(formId, tokens.JH, ROLES.JH, 'agree', ROLES.SH);
  step('JH 带「待处理」批注 verify agree → 应被拦（要求先驳回）', verifyBlocked(vBlock), brief(vBlock));
  await uiExpectDecisionDisabled(formId, tokens.JH, ROLES.JH, '同意', 'jh-agree-disabled-before-fix');
  r = snap(await sync(formId, tokens.JH, ROLES.JH, 'return', '校对驳回：请处理批注后重提（线上验收）', ROLES.SJ));
  step('JH sync return：current_node=sj', r.current_node === 'sj', r);
  let h = await history(taskId, tokens.JH);
  step('history 含 jd return', h.lines.some((l) => /jd return/.test(l)), h.lines);
  const vBlockRe = await verify(formId, tokens.SJ, ROLES.SJ, 'active', ROLES.JH);
  step('SJ 带「待处理」批注 verify active（重提）→ 应被拦', verifyBlocked(vBlockRe), brief(vBlockRe));
  const fixed = await uiHandleAnnotation(formId, tokens.SJ, ROLES.SJ, 'fixed', '线上验收：已按退回意见修改', 'sj-fixed');
  const st1 = await states(formId, tokens.SJ);
  step('annotation-states：round2 fixed/pending', st1.lines.some((l) => /r2 fixed\/pending/.test(l)), st1.lines);
  const vOk = await verify(formId, tokens.SJ, ROLES.SJ, 'active', ROLES.JH);
  step('SJ 处理完批注后 verify active → 通过', verifyPassed(vOk), brief(vOk));
  r = snap(await sync(formId, tokens.SJ, ROLES.SJ, 'active', '处理完批注重提（线上验收）', ROLES.JH));
  step('SJ sync active（重提）：submitted / jd', r.task_status === 'submitted' && r.current_node === 'jd', r);
  await uiHandleAnnotation(formId, tokens.JH, ROLES.JH, 'agree', '', 'jh-agree');
  const st2 = await states(formId, tokens.JH);
  step('annotation-states：round2 fixed/agreed', st2.lines.some((l) => /r2 fixed\/agreed/.test(l)), st2.lines);
  r = snap(await sync(formId, tokens.JH, ROLES.JH, 'agree', '校对复核同意（线上验收）', ROLES.SH));
  step('JH sync agree：/ sh', r.current_node === 'sh', r);
  r = snap(await sync(formId, tokens.SH, ROLES.SH, 'agree', '审核同意（线上验收）', ROLES.PZ));
  step('SH sync agree：/ pz', r.current_node === 'pz', r);
  r = snap(await sync(formId, tokens.PZ, ROLES.PZ, 'agree', '批准通过（线上验收）'));
  step('PZ sync agree：approved', r.form_status === 'approved' && r.task_status === 'approved', r);
  // 设计侧打开已批准单：落地页没有校审面板，只有三维 + 回放的批注 / 测量（「待保存证据」卡）
  await uiView(formId, tokens.SJ, ROLES.SJ, '08-sj-approved-view', /批注|测量/, ['[data-testid="review-confirmation"]', 'canvas']);
  h = await history(taskId, tokens.PZ);
  step(
    'history 6 条：sj submit → jd return → sj submit(重提) → jd approve → sh approve → pz approve',
    h.lines.length >= 6 && /jd return/.test(h.lines[1] || '') && /pz approve/.test(h.lines[h.lines.length - 1]),
    h.lines,
  );
  current.api.history = h.lines;
  current.api.states = (await states(formId, tokens.PZ)).lines;
  current.api.fixedUi = fixed;
}

// ---------------------------------------------------------------------------
// RESAVE 二次保存（PMS 端到端案例 TC-1 第 2b / 2c / 2d 步，后端 2026-09-28 缺陷修复计划 T1 / T5）
// ---------------------------------------------------------------------------
const refVariants = (ref) => [ref, ref.replace('_', '/')];
const mentionsRef = (value, ref) => refVariants(ref).some((v) => JSON.stringify(value ?? '').includes(v));

async function taskDetail(taskId, token) {
  const r = await api('GET', `/api/review/tasks/${encodeURIComponent(taskId)}`, undefined, token);
  const task = r.json?.task || r.json?.data || {};
  return { http: r.status, task, components: task.components || [] };
}

async function queryModels(formId, token) {
  const r = await sync(formId, token, ROLES.SJ, 'query');
  return { ...snap(r), models: r.json?.data?.models || [] };
}

/** SJ 重开嵌入页：断言「修改已保存的编校审单」，可加一个构件后点「保存修改」；expectRejected 时断言页面原文显示 409 */
async function uiSjResave(formId, sjToken, tag, { extraRef, firstTaskId, expectRejected = false }) {
  const s = await openRole(formId, sjToken, tag);
  const { page } = s;
  const createBodies = [];
  page.on('request', (req) => {
    if (req.method() === 'POST' && /\/api\/review\/tasks(\?|$)/.test(req.url())) createBodies.push(req.postData());
  });
  try {
    const hit = expectRejected
      ? await openInitiatePanel(page)
      : await waitAny(page, ['[data-testid="designer-landing-workspace"]'], 60_000);
    step(
      expectRejected
        ? `送审后重开，校审 → 发起编校审打开发起面板（${tag}）`
        : `SJ 重开已保存草稿，嵌入页自动落到发起面板（${tag}）`,
      !!hit,
      hit || (await bodyText(page)).slice(0, 300),
    );
    if (!hit) return { createBodies };
    await waitStable(page, `SJ-${tag}`);
    const title = await textOf(page, '[data-testid="initiate-review-panel-title"]', 60);
    const banner = await page.locator('[data-testid="initiate-review-editing-saved-task"]').first().isVisible().catch(() => false);
    step(`面板标题「修改已保存的编校审单」+ 黄条提示（${tag}）`, /修改已保存的编校审单/.test(title || '') && banner, { title, banner });
    await page.waitForFunction(() => typeof window.__plant3dInitiateReviewE2E?.addMockComponent === 'function', null, { timeout: 45_000 });
    if (extraRef) {
      await page.evaluate(async (ref) => {
        await window.__plant3dInitiateReviewE2E.addMockComponent(ref, `BRAN ${ref}`);
      }, extraRef);
      const listed = await page
        .waitForFunction((refs) => refs.some((r) => document.body.innerText.includes(r)), refVariants(extraRef), { timeout: 15_000 })
        .then(() => true)
        .catch(() => false);
      step(`构件列表加进第二个构件 ${extraRef}`, listed);
    }
    const submitBtn = page.locator('[data-guide="submit-btn"]').first();
    await submitBtn.waitFor({ state: 'visible', timeout: 20_000 });
    const label = (await submitBtn.innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const d = await submitBtn.getAttribute('disabled');
      const ad = await submitBtn.getAttribute('aria-disabled');
      if (!d && ad !== 'true') break;
      await page.waitForTimeout(400);
    }
    await shot(page, `${current.id}-${tag}-before-save`);
    await submitBtn.click({ timeout: 20_000 });
    if (expectRejected) {
      const shown = await page.getByText(/单据已送审|不可修改/).first().waitFor({ state: 'visible', timeout: 30_000 }).then(() => true).catch(() => false);
      const line = ((await bodyText(page)).match(/[^\n]*(单据已送审|不可修改)[^\n]*/) || [null])[0];
      step('送审后再保存：页面显示后端 409 原文（单据已送审…不可修改），不被笼统文案盖掉', shown, { label, line });
      await shot(page, `${current.id}-${tag}-rejected`);
      return { label, line, createBodies };
    }
    const toast = await page.getByText(/编校审单(创建|保存)成功|保存成功/).first().waitFor({ state: 'visible', timeout: 30_000 }).then(() => true).catch(() => false);
    let result = null;
    for (let i = 0; i < 40 && !result?.taskId; i += 1) {
      result = await page.evaluate(() => window.__plant3dInitiateReviewE2E?.getLastCreateResult?.() || null).catch(() => null);
      if (!result?.taskId) await page.waitForTimeout(500);
    }
    step('按钮是「保存修改」，二次保存成功且仍是同一个 task', /保存修改/.test(label) && (toast || !!result?.taskId) && result?.taskId === firstTaskId, { label, toast, taskId: result?.taskId, firstTaskId });
    await shot(page, `${current.id}-${tag}-saved`);
    return { label, result, createBodies };
  } finally {
    await closeRole(s);
  }
}

async function resave(tokens) {
  const bran2 = process.env.P3D_BRAN2 || '24384_24935';
  begin('RESAVE', '二次保存：SJ 建单 → 重开自动落到发起面板 → 加构件「保存修改」→ 同一 task、两路读回一致、历史一条 resave → active → 送审后再保存 409 → JH 看到 2 个构件 → agree 到 approved');
  const { formId } = await embedUrlForm(tokens.SJ);
  step('embed-url 领 form_id', !!formId, { formId });
  current.api.formId = formId;
  const pkg = `ACCEPT-${STAMP}-RESAVE`;
  const created = await uiSjInitiate(formId, tokens.SJ, pkg);
  const taskId = created?.taskId;
  Object.assign(current.api, { taskId, packageName: pkg, bran2 });
  if (!taskId) throw new Error('首次保存没拿到 taskId');

  const saved = await uiSjResave(formId, tokens.SJ, 'resave-1', { extraRef: bran2, firstTaskId: taskId });
  const d1 = await taskDetail(taskId, tokens.SJ);
  step('GET /api/review/tasks/{id}：两个构件都在', d1.http === 200 && mentionsRef(d1.components, BRAN) && mentionsRef(d1.components, bran2), { http: d1.http, components: d1.components.length });
  const q1 = await queryModels(formId, tokens.SJ);
  step('workflow/sync query：models 与任务一致（两个构件，仍 draft / sj）', mentionsRef(q1.models, BRAN) && mentionsRef(q1.models, bran2) && q1.current_node === 'sj', { models: q1.models, task_status: q1.task_status, current_node: q1.current_node, task_id: q1.task_id });
  let h = await history(taskId, tokens.SJ);
  const resaveLines = h.lines.filter((l) => /resave/.test(l));
  step('workflow history 恰好一条 resave', resaveLines.length === 1, h.lines);

  const v = await verify(formId, tokens.SJ, ROLES.SJ, 'active', ROLES.JH);
  step('verify active 通过', verifyPassed(v), brief(v));
  const r = snap(await sync(formId, tokens.SJ, ROLES.SJ, 'active', '送审（线上验收 RESAVE）', ROLES.JH));
  step('sync active：submitted / jd', r.task_status === 'submitted' && r.current_node === 'jd', r);

  const rejected = await uiSjResave(formId, tokens.SJ, 'resave-after-submit', { expectRejected: true });
  const body = saved.createBodies?.[saved.createBodies.length - 1];
  if (body) {
    const replay = await api('POST', '/api/review/tasks', JSON.parse(body), tokens.SJ);
    step('接口复核：送审后按前端同一请求再保存 → 409 且带原因', replay.status === 409, { http: replay.status, body: JSON.stringify(replay.json).slice(0, 260) });
  } else {
    step('接口复核：没截到前端保存请求，跳过重放', false, '未截到 POST /api/review/tasks');
  }
  const d2 = await taskDetail(taskId, tokens.SJ);
  h = await history(taskId, tokens.SJ);
  step('被拒后任务构件不变、历史没多 resave', mentionsRef(d2.components, bran2) && d2.components.length === d1.components.length && h.lines.filter((l) => /resave/.test(l)).length === 1, { components: d2.components.length, history: h.lines });
  current.api.rejectedLine = rejected.line;

  await uiView(formId, tokens.JH, ROLES.JH, 'resave-jh-view', /2\s*(个)?构件/);

  let s2 = snap(await sync(formId, tokens.JH, ROLES.JH, 'agree', '校对同意（线上验收 RESAVE）', ROLES.SH));
  step('JH sync agree：/ sh', s2.current_node === 'sh', s2);
  s2 = snap(await sync(formId, tokens.SH, ROLES.SH, 'agree', '审核同意（线上验收 RESAVE）', ROLES.PZ));
  step('SH sync agree：/ pz', s2.current_node === 'pz', s2);
  s2 = snap(await sync(formId, tokens.PZ, ROLES.PZ, 'agree', '批准通过（线上验收 RESAVE）'));
  step('PZ sync agree：approved', s2.form_status === 'approved' && s2.task_status === 'approved', s2);
  h = await history(taskId, tokens.PZ);
  step('history：sj resave → sj submit → jd approve → sh approve → pz approve', /resave/.test(h.lines.join(' ')) && /pz approve/.test(h.lines[h.lines.length - 1] || ''), h.lines);
  current.api.history = h.lines;
}

// ---------------------------------------------------------------------------
// smoke：不建单、不推流程
// ---------------------------------------------------------------------------
async function smoke(tokens) {
  begin('SMOKE', '只领 token / embed-url，打开 SJ 嵌入页确认发起面板出现');
  const { formId, form } = await embedUrlForm(tokens.SJ);
  step('embed-url 领 form_id（空白存根，不建任务）', !!formId, { formId, form });
  current.api.formId = formId;
  await uiSjInitiate(formId, tokens.SJ, '', { submit: false });
}

async function main() {
  await mkdir(OUT, { recursive: true });
  log(`BASE=${BASE} PROJECT=${PROJECT} BRAN=${BRAN} OUT=${OUT} which=${WHICH}`);
  const ver = await api('GET', '/version.json');
  log(`线上 version.json: ${JSON.stringify(ver.json)}`);
  report.version = ver.json;
  const tokens = {};
  for (const k of Object.keys(ROLES)) tokens[k] = await mint(ROLES[k]);
  log(`tokens minted: ${Object.keys(tokens).join(',')}`);
  browser = await chromium.launch({
    headless: true,
    // 直连：本机若开着系统代理（如 127.0.0.1:7890），模型中心 / PMS 走代理会超时
    args: ['--proxy-server=direct://', '--proxy-bypass-list=*', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'],
  });
  try {
    const runCase = async (fn, id) => {
      try {
        await fn(tokens);
      } catch (e) {
        step(`${id} 异常中止`, false, e.message);
      }
    };
    if (WHICH === 'smoke') await runCase(smoke, 'SMOKE');
    if (WHICH === 'tc1' || WHICH === 'all') await runCase(tc1, 'TC1');
    if (WHICH === 'tc2' || WHICH === 'all') await runCase(tc2, 'TC2');
    if (WHICH === 'resave' || WHICH === 'all') await runCase(resave, 'RESAVE');
  } finally {
    await browser.close();
  }
  report.finishedAt = new Date().toISOString();
  const reportPath = path.join(OUT, `${STAMP}-report.json`);
  await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf-8');
  console.log('\n══════ 汇总 ══════');
  for (const c of report.cases) {
    console.log(`${c.failed === 0 ? '✓' : '✗'} ${c.id} ${c.title}  (${c.steps.filter((s) => s.ok).length}/${c.steps.length} 步通过) form=${c.api.formId} task=${c.api.taskId ?? '-'}`);
    for (const s of c.steps.filter((x) => !x.ok)) {
      console.log(`    ✗ ${s.name} — ${typeof s.detail === 'string' ? s.detail : JSON.stringify(s.detail)}`);
    }
  }
  console.log(`report: ${reportPath}`);
  process.exitCode = report.cases.some((c) => c.failed > 0) ? 1 : 0;
}

main().catch((e) => {
  console.error('fatal:', e);
  process.exitCode = 2;
});
