#!/usr/bin/env npx tsx
import fs from 'node:fs/promises';
import path from 'node:path';

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';

import {
  buildAuthLoginRequest,
  buildDeleteReviewPayload,
  type SimulatorPmsUser,
  type WorkflowRole,
} from '../src/debug/pmsPlatformContractPayloads';
import {
  buildPmsSimulatorEnvironmentConfig,
  type PmsSimulatorAssertionResult,
  type PmsSimulatorCaseId,
  type PmsSimulatorEnvironmentConfig,
  type PmsSimulatorScenarioReport,
} from '../src/debug/pmsSimulatorAutomation';

import {
  listPageAndFrames,
  registerPlant3dAutomationReviewInitScript,
  reloadReviewerWorkbenchAcrossContext,
  runSubmitReviewAcrossContext,
  waitForReviewerWorkbenchAcrossContext,
} from './pms-plant3d-initiate-flow';

type SimulatorSidePanelMode = 'initiate' | 'workflow' | 'readonly';
type SimulatorWorkflowAction = 'active' | 'agree' | 'return' | 'stop';
type SimulatorTestRowSummary = {
  index: number;
  taskId: string;
  formId: string | null;
  title: string;
  status: string;
  currentNode: string | null;
  requesterName: string;
  componentCount: number;
  selected: boolean;
};
type SimulatorVerifyAnnotationSummary = {
  passed: boolean;
  recommendedAction: 'submit' | 'return' | 'block';
  currentNode: string;
  summary: {
    total: number;
    open: number;
    pendingReview: number;
    approved: number;
    rejected: number;
  };
  blockerCount: number;
  message: string;
};
type SimulatorTestSnapshot = {
  currentPmsUser: SimulatorPmsUser;
  currentWorkflowRole: WorkflowRole;
  currentWorkflowNode: string | null;
  currentTaskId: string | null;
  currentFormId: string | null;
  currentTaskStatus: string;
  iframeSource: string | null;
  lastOpenedFormId: string | null;
  selectedTaskId: string | null;
  selectedFormId: string | null;
  sidePanelMode: SimulatorSidePanelMode;
  lastAction: SimulatorWorkflowAction | null;
  lastOk: boolean | null;
  lastMessage: string | null;
  lastActionAt: number | null;
  lastVerifyAction: SimulatorWorkflowAction | null;
  lastVerifyOk: boolean | null;
  lastVerifyMessage: string | null;
  lastVerifyAt: number | null;
  lastVerifyErrorCode: string | null;
  lastVerifyRecommendedAction: 'submit' | 'return' | 'block' | null;
  lastVerifyAnnotationSummary: SimulatorVerifyAnnotationSummary | null;
  passiveWorkflowMode: boolean;
};

type ScenarioContext = {
  env: PmsSimulatorEnvironmentConfig;
  browser: Browser;
  artifactDir: string;
};

type ScenarioRuntime = ScenarioContext & {
  context: BrowserContext;
  page: Page;
  caseId: PmsSimulatorCaseId;
  cleanupFormIds: Set<string>;
};

type CreatedReview = {
  packageName: string;
  formId: string;
  taskId: string | null;
};

type ScenarioHandler = (runtime: ScenarioRuntime) => Promise<PmsSimulatorScenarioReport>;

function traceSimulator(message: string): void {
  if (process.env.PMS_SIMULATOR_TRACE !== '1') return;
  console.error(`[pms-simulator] ${message}`);
}

async function waitForDesignerCommentAnnotationListAcrossContext(
  context: BrowserContext,
): Promise<{ page: Page; root: Page | import('playwright').Frame }> {
  const rawPoll = process.env.PMS_PLANT3D_POLL_MS?.trim();
  const parsed = rawPoll ? Number(rawPoll) : NaN;
  const pollMs = Number.isFinite(parsed) && parsed >= 60_000 ? parsed : 180_000;
  const deadline = Date.now() + pollMs;
  while (Date.now() < deadline) {
    const pages = context.pages().filter((p) => !p.isClosed());
    for (const p of pages) {
      for (const root of listPageAndFrames(p)) {
        let listVisible = false;
        try {
          listVisible = await root
            .locator('[data-testid="designer-comment-annotation-list"]')
            .first()
            .isVisible()
            .catch(() => false);
        } catch {
          continue;
        }
        if (!listVisible) continue;
        return { page: p, root };
      }
    }
    await new Promise((r) => setTimeout(r, 600));
  }
  throw new Error(
    '超时：未在任何标签页/iframe 内找到设计端批注列表 [data-testid=designer-comment-annotation-list]（请确认驳回后已从 PMS 重新打开对应单据）',
  );
}

const CASE_NAMES: Record<PmsSimulatorCaseId, string> = {
  approved: '主链通过到 approved',
  return: '驳回分支 return -> sj',
  stop: '终止分支 stop -> cancelled',
  restore: '刷新恢复',
  'gate-block': '批注门禁 block',
  'gate-return': '批注门禁 return',
};

function appendNoProxy(value: string | undefined): string {
  const items = new Set(
    String(value || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  );
  items.add('127.0.0.1');
  items.add('localhost');
  return [...items].join(',');
}

function prepareLocalNoProxy(): void {
  process.env.NO_PROXY = appendNoProxy(process.env.NO_PROXY);
  process.env.no_proxy = appendNoProxy(process.env.no_proxy);
}

const ROLE_TO_USER_ROLE: Record<WorkflowRole, 'designer' | 'proofreader' | 'reviewer'> = {
  sj: 'designer',
  jd: 'proofreader',
  sh: 'reviewer',
  pz: 'reviewer',
};

function scenarioPackageName(caseId: PmsSimulatorCaseId): string {
  return `SIM-${caseId.toUpperCase()}-${Date.now()}`;
}

function sanitizeFilePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-');
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

async function postJson<T>(url: string, payload: unknown, bearerToken?: string): Promise<{ status: number; body: T }> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(bearerToken ? { Authorization: `Bearer ${bearerToken}` } : {}),
    },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  let body: T;
  try {
    body = JSON.parse(text) as T;
  } catch {
    throw new Error(`POST ${url} 返回非 JSON：HTTP ${response.status} ${text}`);
  }
  if (!response.ok) {
    throw new Error(`POST ${url} 失败：HTTP ${response.status} ${text}`);
  }
  return { status: response.status, body };
}

async function waitFor<T>(
  producer: () => Promise<T | null> | T | null,
  options: {
    timeoutMs?: number;
    intervalMs?: number;
    message: string;
  },
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 90_000;
  const intervalMs = options.intervalMs ?? 500;
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = null;
  while (Date.now() < deadline) {
    try {
      const value = await producer();
      if (value != null) {
        return value;
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  const suffix = lastError instanceof Error ? `：${lastError.message}` : '';
  throw new Error(`${options.message}${suffix}`);
}

async function waitForSimulatorReady(page: Page): Promise<void> {
  await page.waitForFunction(
    () => Boolean((window as Window & { __pmsReviewSimulatorReady?: boolean }).__pmsReviewSimulatorReady),
    null,
    { timeout: 90_000 },
  );
}

function isRetryableSimulatorNavigationError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('Execution context was destroyed')
    || message.includes('Cannot find context with specified id')
    || message.includes('__pmsReviewSimulatorTest')
    || message.includes('Target page, context or browser has been closed');
}

async function callSimulatorApi<T>(page: Page, method: string, ...args: unknown[]): Promise<T> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      await waitForSimulatorReady(page);
      return await page.evaluate(
        async ({ targetMethod, targetArgs }) => {
          const host = window as Window & {
            __pmsReviewSimulatorTest?: Record<string, (...innerArgs: unknown[]) => unknown>;
          };
          const api = host.__pmsReviewSimulatorTest;
          if (!api || typeof api[targetMethod] !== 'function') {
            throw new Error(`__pmsReviewSimulatorTest.${targetMethod} 不存在`);
          }
          return await api[targetMethod](...targetArgs);
        },
        { targetMethod: method, targetArgs: args },
      ) as T;
    } catch (error) {
      lastError = error;
      if (!isRetryableSimulatorNavigationError(error) || attempt >= 3 || page.isClosed()) {
        throw error;
      }
      await page.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function getSnapshot(page: Page): Promise<SimulatorTestSnapshot> {
  return await callSimulatorApi<SimulatorTestSnapshot>(page, 'getSnapshot');
}

async function listRows(page: Page): Promise<SimulatorTestRowSummary[]> {
  return await callSimulatorApi<SimulatorTestRowSummary[]>(page, 'listRows');
}

async function refreshList(page: Page): Promise<void> {
  await callSimulatorApi<void>(page, 'refreshList');
}

async function switchRole(page: Page, role: SimulatorPmsUser): Promise<void> {
  const snapshot = await getSnapshot(page);
  if (snapshot.currentPmsUser === role) return;
  await callSimulatorApi<void>(page, 'switchRole', role);
  await waitFor(async () => {
    const next = await getSnapshot(page);
    return next.currentPmsUser === role ? next : null;
  }, {
    message: `切换角色到 ${role} 超时`,
  });
}

async function waitForRowByFormId(page: Page, formId: string, options?: { timeoutMs?: number }): Promise<SimulatorTestRowSummary> {
  return await waitFor(async () => {
    await refreshList(page);
    const rows = await listRows(page);
    return rows.find((row) => row.formId === formId) || null;
  }, {
    timeoutMs: options?.timeoutMs ?? 90_000,
    intervalMs: 1200,
    message: `等待 form_id=${formId} 出现在 simulator 列表超时`,
  });
}

async function resolveTaskIdByFormId(
  page: Page,
  formId: string,
  preferredTaskId?: string | null,
  options?: { timeoutMs?: number; allowMissing?: boolean },
): Promise<string | null> {
  const normalizedTaskId = String(preferredTaskId || '').trim() || null;
  if (normalizedTaskId) return normalizedTaskId;

  try {
    const row = await waitForRowByFormId(page, formId, {
      timeoutMs: options?.timeoutMs,
    });
    return String(row.taskId || '').trim() || null;
  } catch (error) {
    if (options?.allowMissing) return null;
    throw error;
  }
}

async function waitForSnapshotByFormId(
  page: Page,
  formId: string,
  options?: { timeoutMs?: number; predicate?: (snapshot: SimulatorTestSnapshot) => boolean },
): Promise<SimulatorTestSnapshot> {
  return await waitFor(async () => {
    const snapshot = await getSnapshot(page);
    if (snapshot.currentFormId !== formId && snapshot.lastOpenedFormId !== formId) {
      return null;
    }
    if (options?.predicate && !options.predicate(snapshot)) {
      return null;
    }
    return snapshot;
  }, {
    timeoutMs: options?.timeoutMs ?? 90_000,
    intervalMs: 600,
    message: `等待 simulator 快照切到 form_id=${formId} 超时`,
  });
}

async function openTaskForRole(
  page: Page,
  formId: string,
  role: SimulatorPmsUser,
  options?: {
    source?: 'task-view' | 'task-reopen';
    taskId?: string | null;
  },
): Promise<SimulatorTestSnapshot> {
  const normalizedTaskId = await resolveTaskIdByFormId(page, formId, options?.taskId, {
    timeoutMs: 30_000,
    allowMissing: true,
  });
  const source = options?.source || 'task-view';
  traceSimulator(`openTaskForRole role=${role} source=${source} form_id=${formId} task_id=${normalizedTaskId || '--'}`);
  await callSimulatorApi<void>(page, 'openTaskByFormId', {
    role,
    formId,
    taskId: normalizedTaskId,
    source,
  });
  return await waitForSnapshotByFormId(page, formId, {
    predicate: (item) => Boolean(item.iframeSource),
  });
}

async function runWorkflowAction(
  page: Page,
  action: SimulatorWorkflowAction,
  options?: {
    comment?: string;
    targetNode?: WorkflowRole | null;
  },
): Promise<SimulatorTestSnapshot> {
  const before = await getSnapshot(page);
  traceSimulator(`runWorkflowAction action=${action} form_id=${before.currentFormId || before.lastOpenedFormId || '--'} node=${before.currentWorkflowNode || '--'}`);
  await callSimulatorApi<void>(page, 'openWorkflowAction', action);
  if (action === 'return' && options?.targetNode) {
    await callSimulatorApi<void>(page, 'setWorkflowDialogTargetNode', options.targetNode);
  }
  if (options?.comment != null) {
    await callSimulatorApi<void>(page, 'setWorkflowDialogComment', options.comment);
  }
  await callSimulatorApi<void>(page, 'confirmWorkflowDialog');
  return await waitFor(async () => {
    const snapshot = await getSnapshot(page);
    if (snapshot.lastAction !== action || snapshot.lastActionAt == null) return null;
    if (before.lastActionAt != null && snapshot.lastActionAt <= before.lastActionAt) return null;
    return snapshot;
  }, {
    timeoutMs: 120_000,
    intervalMs: 600,
    message: `等待 workflow action=${action} 完成超时`,
  });
}

function assertResult(key: string, passed: boolean, detail?: string, expected?: unknown, actual?: unknown): PmsSimulatorAssertionResult {
  return { key, passed, detail, expected, actual };
}

function normalizeNode(value: string | null | undefined): string | null {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized || null;
}

function finalizeScenarioReport(base: Omit<PmsSimulatorScenarioReport, 'ok'>): PmsSimulatorScenarioReport {
  return {
    ...base,
    ok: base.assertions.every((item) => item.passed),
  };
}

async function createCleanupToken(env: PmsSimulatorEnvironmentConfig): Promise<string> {
  const auth = buildAuthLoginRequest({
    projectId: env.projectId,
    currentPmsUser: 'SJ',
    currentWorkflowRole: 'sj',
  });
  const response = await postJson<{ code?: number; data?: { token?: string }; token?: string }>(
    `${env.backendBaseUrl}/api/auth/token`,
    {
      project_id: auth.projectId,
      user_id: auth.userId,
      role: auth.role,
    },
  );
  const token = response.body.data?.token || response.body.token || '';
  if (!token) {
    throw new Error('cleanup 登录未返回 token');
  }
  return token;
}

async function cleanupForms(runtime: ScenarioRuntime): Promise<void> {
  if (runtime.cleanupFormIds.size === 0) return;
  const token = await createCleanupToken(runtime.env);
  const formIds = [...runtime.cleanupFormIds].filter(Boolean);
  if (!formIds.length) return;
  const payload = buildDeleteReviewPayload({
    formIds,
    operatorId: 'SJ',
    token,
  });
  await postJson(`${runtime.env.backendBaseUrl}/api/review/delete`, payload, token);
}

async function saveGateRecord(
  runtime: ScenarioRuntime,
  options: {
    taskId: string;
    formId: string;
    currentWorkflowRole: WorkflowRole;
    currentPmsUser: SimulatorPmsUser;
    gateType: 'block' | 'return';
  },
): Promise<void> {
  const auth = buildAuthLoginRequest({
    projectId: runtime.env.projectId,
    currentPmsUser: options.currentPmsUser,
    currentWorkflowRole: options.currentWorkflowRole,
  });
  const authResponse = await postJson<{ code?: number; data?: { token?: string }; token?: string }>(
    `${runtime.env.backendBaseUrl}/api/auth/token`,
    {
      project_id: auth.projectId,
      user_id: auth.userId,
      role: auth.role,
    },
  );
  const token = authResponse.body.data?.token || authResponse.body.token || '';
  if (!token) {
    throw new Error('门禁批注注入登录未返回 token');
  }

  const now = Date.now();
  const annotationId = `sim-${options.gateType}-${now}`;
  const reviewState = options.gateType === 'block'
    ? {
      resolutionStatus: 'fixed',
      decisionStatus: 'pending',
      note: '自动化构造 pending_review',
      updatedAt: now,
      updatedById: options.currentPmsUser,
      updatedByName: options.currentPmsUser,
      updatedByRole: ROLE_TO_USER_ROLE[options.currentWorkflowRole],
      history: [],
    }
    : {
      resolutionStatus: 'fixed',
      decisionStatus: 'rejected',
      note: '自动化构造 rejected',
      updatedAt: now,
      updatedById: options.currentPmsUser,
      updatedByName: options.currentPmsUser,
      updatedByRole: ROLE_TO_USER_ROLE[options.currentWorkflowRole],
      history: [],
    };

  await postJson(`${runtime.env.backendBaseUrl}/api/review/records`, {
    taskId: options.taskId,
    formId: options.formId,
    type: 'batch',
    annotations: [{
      id: annotationId,
      entityId: '24381/145018',
      worldPos: [0, 0, 0],
      visible: true,
      glyph: '1',
      title: options.gateType === 'block' ? '待确认批注' : '驳回批注',
      description: options.gateType === 'block' ? '自动化构造 pending_review' : '自动化构造 rejected',
      createdAt: now,
      refno: '24381/145018',
      reviewState,
    }],
    cloudAnnotations: [],
    rectAnnotations: [],
    measurements: [],
    note: options.gateType === 'block' ? 'gate-block 注入 confirmed record' : 'gate-return 注入 confirmed record',
  }, token);
}

async function captureFailureScreenshot(runtime: ScenarioRuntime, caseId: PmsSimulatorCaseId): Promise<string> {
  const dir = path.join(runtime.artifactDir, 'screenshots');
  await ensureDir(dir);
  const filePath = path.join(dir, `${sanitizeFilePart(caseId)}.png`);
  await runtime.page.screenshot({ path: filePath, fullPage: true }).catch(() => undefined);
  return filePath;
}

async function openScenarioPage(runtime: ScenarioRuntime): Promise<void> {
  await registerPlant3dAutomationReviewInitScript(runtime.context);
  await runtime.context.addInitScript(() => {
    try {
      localStorage.setItem('plant3d_automation_review', '1');
      localStorage.setItem('plant3d_debug_ui', '1');
      localStorage.setItem('plant3d_workflow_mode', 'external');
      localStorage.setItem('plant3d-onboarding-v1', JSON.stringify({
        completedGuides: {
          'SJ__designer': true,
          'SJ__designer__external': true,
          'JH__proofreader': true,
          'JH__proofreader__external': true,
          'SH__reviewer': true,
          'SH__reviewer__external': true,
          'PZ__manager': true,
          'PZ__manager__external': true,
        },
      }));
    } catch {
      /* ignore */
    }
  });
  traceSimulator(`openScenarioPage goto ${runtime.env.simulatorUrl}`);
  await runtime.page.goto(runtime.env.simulatorUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await waitForSimulatorReady(runtime.page);
  traceSimulator('openScenarioPage ready');
}

async function createReview(runtime: ScenarioRuntime, caseId: PmsSimulatorCaseId): Promise<CreatedReview> {
  await switchRole(runtime.page, 'SJ');
  process.env.PMS_MOCK_PACKAGE_NAME = scenarioPackageName(caseId);
  traceSimulator(`createReview case=${caseId} openNew`);
  await callSimulatorApi<void>(runtime.page, 'openNew');
  traceSimulator(`createReview case=${caseId} submitReview`);
  const packageName = await runSubmitReviewAcrossContext(runtime.context);
  traceSimulator(`createReview case=${caseId} submitDone package=${packageName}`);
  const snapshot = await waitFor(async () => {
    const current = await getSnapshot(runtime.page);
    return current.lastOpenedFormId ? current : null;
  }, {
    timeoutMs: 120_000,
    intervalMs: 600,
    message: '等待新建单据回填 form_id 超时',
  });
  const formId = snapshot.lastOpenedFormId;
  if (!formId) {
    throw new Error('新建单据后未获得 form_id');
  }
  runtime.cleanupFormIds.add(formId);
  const taskId = snapshot.currentTaskId || snapshot.selectedTaskId;
  const resolvedTaskId = await resolveTaskIdByFormId(runtime.page, formId, taskId, {
    timeoutMs: 30_000,
    allowMissing: true,
  });
  traceSimulator(`createReview case=${caseId} created form_id=${formId} task_id=${resolvedTaskId || '--'}`);
  return {
    packageName,
    formId,
    taskId: resolvedTaskId,
  };
}

async function buildRestoreCounts(runtime: ScenarioRuntime): Promise<{
  pendingAnnotationCount: number;
  pendingMeasurementCount: number;
  confirmedRecordCount: number;
  confirmedAnnotationCount: number;
  confirmedMeasurementCount: number;
}> {
  const located = await waitForReviewerWorkbenchAcrossContext(runtime.context);
  return await located.root.evaluate(async () => {
    const hook = (window as Window & {
      __plant3dReviewerE2E?: {
        addMockAnnotation: (title?: string, description?: string) => string;
        addMockMeasurement: (kind?: 'distance' | 'angle') => string;
        confirmData: (note?: string) => Promise<void>;
        getAnnotationCount: () => number;
        getMeasurementCount: () => number;
        getConfirmedRecordCount: () => number;
        getConfirmedAnnotationCount: () => number;
        getConfirmedMeasurementCount: () => number;
      };
    }).__plant3dReviewerE2E;
    if (!hook) {
      throw new Error('__plant3dReviewerE2E 未挂载');
    }
    hook.addMockAnnotation(`restore-${Date.now()}`, '刷新恢复自动化批注');
    hook.addMockMeasurement('distance');
    const pendingAnnotationCount = hook.getAnnotationCount();
    const pendingMeasurementCount = hook.getMeasurementCount();
    await hook.confirmData('restore 自动化确认');
    return {
      pendingAnnotationCount,
      pendingMeasurementCount,
      confirmedRecordCount: hook.getConfirmedRecordCount(),
      confirmedAnnotationCount: hook.getConfirmedAnnotationCount(),
      confirmedMeasurementCount: hook.getConfirmedMeasurementCount(),
    };
  });
}

async function readRestoreCounts(runtime: ScenarioRuntime): Promise<{
  confirmedRecordCount: number;
  confirmedAnnotationCount: number;
  confirmedMeasurementCount: number;
}> {
  const located = await waitForReviewerWorkbenchAcrossContext(runtime.context);
  return await located.root.evaluate(() => {
    const hook = (window as Window & {
      __plant3dReviewerE2E?: {
        getConfirmedRecordCount: () => number;
        getConfirmedAnnotationCount: () => number;
        getConfirmedMeasurementCount: () => number;
      };
    }).__plant3dReviewerE2E;
    if (!hook) {
      throw new Error('__plant3dReviewerE2E 未挂载');
    }
    return {
      confirmedRecordCount: hook.getConfirmedRecordCount(),
      confirmedAnnotationCount: hook.getConfirmedAnnotationCount(),
      confirmedMeasurementCount: hook.getConfirmedMeasurementCount(),
    };
  });
}

async function scenarioApproved(runtime: ScenarioRuntime): Promise<PmsSimulatorScenarioReport> {
  const created = await createReview(runtime, 'approved');
  const assertions: PmsSimulatorAssertionResult[] = [];

  let snapshot = await runWorkflowAction(runtime.page, 'active', { comment: 'SJ active 自动化' });
  assertions.push(assertResult('sj-active-verify', snapshot.lastVerifyAction === 'active' && snapshot.lastVerifyOk === true, snapshot.lastVerifyMessage || ''));
  assertions.push(assertResult('sj-active-order', snapshot.lastVerifyAt != null && snapshot.lastActionAt != null && snapshot.lastVerifyAt <= snapshot.lastActionAt));
  assertions.push(assertResult('sj-active-sync', snapshot.lastAction === 'active' && snapshot.lastOk === true, snapshot.lastMessage || ''));

  await openTaskForRole(runtime.page, created.formId, 'JH', { taskId: created.taskId });
  snapshot = await runWorkflowAction(runtime.page, 'agree', { comment: 'JH agree 自动化' });
  assertions.push(assertResult('jh-agree-verify', snapshot.lastVerifyAction === 'agree' && snapshot.lastVerifyOk === true, snapshot.lastVerifyMessage || ''));
  assertions.push(assertResult('jh-agree-sync', snapshot.lastAction === 'agree' && snapshot.lastOk === true, snapshot.lastMessage || ''));

  await openTaskForRole(runtime.page, created.formId, 'SH', { taskId: created.taskId });
  snapshot = await runWorkflowAction(runtime.page, 'agree', { comment: 'SH agree 自动化' });
  assertions.push(assertResult('sh-agree-verify', snapshot.lastVerifyAction === 'agree' && snapshot.lastVerifyOk === true, snapshot.lastVerifyMessage || ''));
  assertions.push(assertResult('sh-agree-sync', snapshot.lastAction === 'agree' && snapshot.lastOk === true, snapshot.lastMessage || ''));

  await openTaskForRole(runtime.page, created.formId, 'PZ', { taskId: created.taskId });
  snapshot = await runWorkflowAction(runtime.page, 'agree', { comment: 'PZ agree 自动化' });
  assertions.push(assertResult('pz-agree-verify', snapshot.lastVerifyAction === 'agree' && snapshot.lastVerifyOk === true, snapshot.lastVerifyMessage || ''));
  assertions.push(assertResult('pz-agree-sync', snapshot.lastAction === 'agree' && snapshot.lastOk === true, snapshot.lastMessage || ''));

  await callSimulatorApi<void>(runtime.page, 'reopenLast');
  const finalSnapshot = await waitForSnapshotByFormId(runtime.page, created.formId, {
    predicate: (item) => item.sidePanelMode === 'readonly' && item.currentTaskStatus === 'approved',
  });
  assertions.push(assertResult('approved-status', finalSnapshot.currentTaskStatus === 'approved', undefined, 'approved', finalSnapshot.currentTaskStatus));
  assertions.push(assertResult('approved-readonly', finalSnapshot.sidePanelMode === 'readonly', undefined, 'readonly', finalSnapshot.sidePanelMode));

  return finalizeScenarioReport({
    caseId: 'approved',
    name: CASE_NAMES.approved,
    formId: created.formId,
    taskId: created.taskId,
    finalNode: normalizeNode(finalSnapshot.currentWorkflowNode),
    finalStatus: finalSnapshot.currentTaskStatus,
    packageName: created.packageName,
    assertions,
  });
}

async function scenarioReturn(runtime: ScenarioRuntime): Promise<PmsSimulatorScenarioReport> {
  const created = await createReview(runtime, 'return');
  const assertions: PmsSimulatorAssertionResult[] = [];

  await runWorkflowAction(runtime.page, 'active', { comment: 'SJ active 自动化' });
  await openTaskForRole(runtime.page, created.formId, 'JH', { taskId: created.taskId });
  await runWorkflowAction(runtime.page, 'agree', { comment: 'JH agree 自动化' });
  await openTaskForRole(runtime.page, created.formId, 'SH', { taskId: created.taskId });
  await runWorkflowAction(runtime.page, 'agree', { comment: 'SH agree 自动化' });
  await openTaskForRole(runtime.page, created.formId, 'PZ', { taskId: created.taskId });
  const returnSnapshot = await runWorkflowAction(runtime.page, 'return', {
    comment: 'PZ return 自动化',
    targetNode: 'sj',
  });
  assertions.push(assertResult('return-verify', returnSnapshot.lastVerifyAction === 'return' && returnSnapshot.lastVerifyOk === true, returnSnapshot.lastVerifyMessage || ''));
  assertions.push(assertResult('return-sync', returnSnapshot.lastAction === 'return' && returnSnapshot.lastOk === true, returnSnapshot.lastMessage || ''));

  const reopened = await openTaskForRole(runtime.page, created.formId, 'SJ', {
    source: 'task-reopen',
    taskId: created.taskId,
  });
  assertions.push(assertResult('return-node', reopened.currentWorkflowNode === 'sj', undefined, 'sj', reopened.currentWorkflowNode));
  assertions.push(assertResult('return-side-panel', reopened.sidePanelMode === 'initiate', undefined, 'initiate', reopened.sidePanelMode));
  assertions.push(assertResult('return-form-preserved', reopened.currentFormId === created.formId, undefined, created.formId, reopened.currentFormId));
  const designerCommentPanel = await waitForDesignerCommentAnnotationListAcrossContext(runtime.context);
  const detailVisible = await designerCommentPanel.root
    .locator('[data-testid="designer-comment-annotation-detail"]')
    .first()
    .isVisible()
    .catch(() => false);
  const taskEntryVisible = await designerCommentPanel.root
    .locator('[data-testid="designer-comment-task-entry"]')
    .first()
    .isVisible()
    .catch(() => false);
  const listText = await designerCommentPanel.root
    .locator('[data-testid="designer-comment-annotation-list"]')
    .first()
    .textContent()
    .catch(() => null);
  assertions.push(assertResult('return-designer-comment-list', Boolean(listText?.includes('批注列表')), listText || ''));
  assertions.push(assertResult('return-designer-comment-detail-hidden', detailVisible === false, undefined, false, detailVisible));
  assertions.push(assertResult('return-designer-comment-task-entry-hidden', taskEntryVisible === false, undefined, false, taskEntryVisible));

  return finalizeScenarioReport({
    caseId: 'return',
    name: CASE_NAMES.return,
    formId: created.formId,
    taskId: created.taskId,
    finalNode: normalizeNode(reopened.currentWorkflowNode),
    finalStatus: reopened.currentTaskStatus,
    packageName: created.packageName,
    assertions,
  });
}

async function scenarioStop(runtime: ScenarioRuntime): Promise<PmsSimulatorScenarioReport> {
  const created = await createReview(runtime, 'stop');
  const assertions: PmsSimulatorAssertionResult[] = [];

  await runWorkflowAction(runtime.page, 'active', { comment: 'SJ active 自动化' });
  await openTaskForRole(runtime.page, created.formId, 'JH', { taskId: created.taskId });
  const stopSnapshot = await runWorkflowAction(runtime.page, 'stop', { comment: 'JH stop 自动化' });
  assertions.push(assertResult('stop-verify', stopSnapshot.lastVerifyAction === 'stop' && stopSnapshot.lastVerifyOk === true, stopSnapshot.lastVerifyMessage || ''));
  assertions.push(assertResult('stop-sync', stopSnapshot.lastAction === 'stop' && stopSnapshot.lastOk === true, stopSnapshot.lastMessage || ''));

  await callSimulatorApi<void>(runtime.page, 'reopenLast');
  const finalSnapshot = await waitForSnapshotByFormId(runtime.page, created.formId, {
    predicate: (item) => item.sidePanelMode === 'readonly' && item.currentTaskStatus === 'cancelled',
  });
  assertions.push(assertResult('stop-status', finalSnapshot.currentTaskStatus === 'cancelled', undefined, 'cancelled', finalSnapshot.currentTaskStatus));
  assertions.push(assertResult('stop-readonly', finalSnapshot.sidePanelMode === 'readonly', undefined, 'readonly', finalSnapshot.sidePanelMode));

  return finalizeScenarioReport({
    caseId: 'stop',
    name: CASE_NAMES.stop,
    formId: created.formId,
    taskId: created.taskId,
    finalNode: normalizeNode(finalSnapshot.currentWorkflowNode),
    finalStatus: finalSnapshot.currentTaskStatus,
    packageName: created.packageName,
    assertions,
  });
}

async function scenarioRestore(runtime: ScenarioRuntime): Promise<PmsSimulatorScenarioReport> {
  const created = await createReview(runtime, 'restore');
  const assertions: PmsSimulatorAssertionResult[] = [];

  await runWorkflowAction(runtime.page, 'active', { comment: 'SJ active 自动化' });
  await openTaskForRole(runtime.page, created.formId, 'JH', { taskId: created.taskId });
  const beforeCounts = await buildRestoreCounts(runtime);
  assertions.push(assertResult('restore-before-annotation', beforeCounts.pendingAnnotationCount >= 1, undefined, '>=1', beforeCounts.pendingAnnotationCount));
  assertions.push(assertResult('restore-before-measurement', beforeCounts.pendingMeasurementCount >= 1, undefined, '>=1', beforeCounts.pendingMeasurementCount));
  assertions.push(assertResult('restore-before-confirmed-record', beforeCounts.confirmedRecordCount >= 1, undefined, '>=1', beforeCounts.confirmedRecordCount));
  assertions.push(assertResult('restore-before-confirmed-annotation', beforeCounts.confirmedAnnotationCount >= 1, undefined, '>=1', beforeCounts.confirmedAnnotationCount));
  assertions.push(assertResult('restore-before-confirmed-measurement', beforeCounts.confirmedMeasurementCount >= 1, undefined, '>=1', beforeCounts.confirmedMeasurementCount));

  await reloadReviewerWorkbenchAcrossContext(runtime.context);
  await waitForSimulatorReady(runtime.page);
  const afterSnapshot = await waitForSnapshotByFormId(runtime.page, created.formId, {
    predicate: (item) => item.sidePanelMode === 'workflow',
  });
  const afterCounts = await readRestoreCounts(runtime);
  assertions.push(assertResult('restore-form-preserved', afterSnapshot.currentFormId === created.formId, undefined, created.formId, afterSnapshot.currentFormId));
  assertions.push(assertResult('restore-annotation-count', afterCounts.confirmedAnnotationCount >= beforeCounts.confirmedAnnotationCount, undefined, beforeCounts.confirmedAnnotationCount, afterCounts.confirmedAnnotationCount));
  assertions.push(assertResult('restore-confirmed-record-count', afterCounts.confirmedRecordCount >= beforeCounts.confirmedRecordCount, undefined, beforeCounts.confirmedRecordCount, afterCounts.confirmedRecordCount));
  assertions.push(assertResult('restore-confirmed-measurement-count', afterCounts.confirmedMeasurementCount >= beforeCounts.confirmedMeasurementCount, undefined, beforeCounts.confirmedMeasurementCount, afterCounts.confirmedMeasurementCount));

  return finalizeScenarioReport({
    caseId: 'restore',
    name: CASE_NAMES.restore,
    formId: created.formId,
    taskId: created.taskId,
    finalNode: normalizeNode(afterSnapshot.currentWorkflowNode),
    finalStatus: afterSnapshot.currentTaskStatus,
    packageName: created.packageName,
    assertions,
  });
}

async function scenarioGateBlock(runtime: ScenarioRuntime): Promise<PmsSimulatorScenarioReport> {
  const created = await createReview(runtime, 'gate-block');
  const assertions: PmsSimulatorAssertionResult[] = [];
  if (!created.taskId) {
    throw new Error(`gate-block 缺少 task_id（form_id=${created.formId}）`);
  }

  await runWorkflowAction(runtime.page, 'active', { comment: 'SJ active 自动化' });
  await openTaskForRole(runtime.page, created.formId, 'JH', { taskId: created.taskId });
  await saveGateRecord(runtime, {
    taskId: created.taskId,
    formId: created.formId,
    currentWorkflowRole: 'jd',
    currentPmsUser: 'JH',
    gateType: 'block',
  });
  const blocked = await runWorkflowAction(runtime.page, 'agree', { comment: 'JH gate-block 自动化' });
  assertions.push(assertResult('gate-block-verify', blocked.lastVerifyOk === false, blocked.lastVerifyMessage || ''));
  assertions.push(assertResult('gate-block-recommended', blocked.lastVerifyRecommendedAction === 'block', undefined, 'block', blocked.lastVerifyRecommendedAction));
  assertions.push(assertResult('gate-block-sync-blocked', blocked.lastOk === false, blocked.lastMessage || ''));
  assertions.push(assertResult('gate-block-feedback', (blocked.lastMessage || '').includes('recommended=block') || (blocked.lastVerifyMessage || '').includes('待确认') || blocked.lastVerifyAnnotationSummary?.recommendedAction === 'block', blocked.lastMessage || blocked.lastVerifyMessage || ''));

  return finalizeScenarioReport({
    caseId: 'gate-block',
    name: CASE_NAMES['gate-block'],
    formId: created.formId,
    taskId: created.taskId,
    finalNode: normalizeNode(blocked.currentWorkflowNode),
    finalStatus: blocked.currentTaskStatus,
    packageName: created.packageName,
    assertions,
  });
}

async function scenarioGateReturn(runtime: ScenarioRuntime): Promise<PmsSimulatorScenarioReport> {
  const created = await createReview(runtime, 'gate-return');
  const assertions: PmsSimulatorAssertionResult[] = [];
  if (!created.taskId) {
    throw new Error(`gate-return 缺少 task_id（form_id=${created.formId}）`);
  }

  await runWorkflowAction(runtime.page, 'active', { comment: 'SJ active 自动化' });
  await openTaskForRole(runtime.page, created.formId, 'JH', { taskId: created.taskId });
  await runWorkflowAction(runtime.page, 'agree', { comment: 'JH agree 自动化' });
  await openTaskForRole(runtime.page, created.formId, 'SH', { taskId: created.taskId });
  await saveGateRecord(runtime, {
    taskId: created.taskId,
    formId: created.formId,
    currentWorkflowRole: 'sh',
    currentPmsUser: 'SH',
    gateType: 'return',
  });
  const blocked = await runWorkflowAction(runtime.page, 'agree', { comment: 'SH gate-return 自动化' });
  assertions.push(assertResult('gate-return-verify', blocked.lastVerifyOk === false, blocked.lastVerifyMessage || ''));
  assertions.push(assertResult('gate-return-recommended', blocked.lastVerifyRecommendedAction === 'return', undefined, 'return', blocked.lastVerifyRecommendedAction));
  assertions.push(assertResult('gate-return-sync-blocked', blocked.lastOk === false, blocked.lastMessage || ''));
  assertions.push(assertResult('gate-return-feedback', (blocked.lastMessage || '').includes('recommended=return') || (blocked.lastVerifyMessage || '').includes('驳回') || blocked.lastVerifyAnnotationSummary?.recommendedAction === 'return', blocked.lastMessage || blocked.lastVerifyMessage || ''));

  return finalizeScenarioReport({
    caseId: 'gate-return',
    name: CASE_NAMES['gate-return'],
    formId: created.formId,
    taskId: created.taskId,
    finalNode: normalizeNode(blocked.currentWorkflowNode),
    finalStatus: blocked.currentTaskStatus,
    packageName: created.packageName,
    assertions,
  });
}

const SCENARIO_HANDLERS: Record<PmsSimulatorCaseId, ScenarioHandler> = {
  approved: scenarioApproved,
  return: scenarioReturn,
  stop: scenarioStop,
  restore: scenarioRestore,
  'gate-block': scenarioGateBlock,
  'gate-return': scenarioGateReturn,
};

async function runSingleScenario(base: ScenarioContext, caseId: PmsSimulatorCaseId): Promise<PmsSimulatorScenarioReport> {
  traceSimulator(`runSingleScenario ${caseId} newContext`);
  const context = await base.browser.newContext({ viewport: { width: 1680, height: 1040 } });
  const page = await context.newPage();
  const runtime: ScenarioRuntime = {
    ...base,
    context,
    page,
    caseId,
    cleanupFormIds: new Set<string>(),
  };

  try {
    await openScenarioPage(runtime);
    return await SCENARIO_HANDLERS[caseId](runtime);
  } catch (error) {
    const screenshotPath = await captureFailureScreenshot(runtime, caseId).catch(() => null);
    return {
      caseId,
      name: CASE_NAMES[caseId],
      ok: false,
      formId: null,
      taskId: null,
      finalNode: null,
      finalStatus: null,
      packageName: null,
      assertions: [],
      failureMessage: error instanceof Error ? error.message : String(error),
      screenshotPath: screenshotPath || undefined,
    };
  } finally {
    try {
      await cleanupForms(runtime);
    } catch (cleanupError) {
      console.error(`[pms-simulator] 清理 ${caseId} 失败:`, cleanupError);
    }
    await context.close().catch(() => undefined);
    delete process.env.PMS_MOCK_PACKAGE_NAME;
  }
}

export async function runPmsSimulatorScenarios(options?: {
  env?: PmsSimulatorEnvironmentConfig;
  artifactDir?: string;
}): Promise<PmsSimulatorScenarioReport[]> {
  prepareLocalNoProxy();
  const env = options?.env || buildPmsSimulatorEnvironmentConfig(process.env);
  const artifactDir = path.resolve(options?.artifactDir || path.dirname(env.outputPath), 'pms-simulator-artifacts');
  await ensureDir(artifactDir);

  traceSimulator(`launch browser headless=${env.headless}`);
  const browser = await chromium.launch({ headless: env.headless });
  try {
    const base: ScenarioContext = {
      env,
      browser,
      artifactDir,
    };
    const results: PmsSimulatorScenarioReport[] = [];
    for (const caseId of env.caseIds) {
      results.push(await runSingleScenario(base, caseId));
    }
    return results;
  } finally {
    await browser.close().catch(() => undefined);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const env = buildPmsSimulatorEnvironmentConfig(process.env);
  runPmsSimulatorScenarios({ env }).then((results) => {
    const ok = results.every((item) => item.ok);
    console.log(JSON.stringify({ ok, scenarios: results }, null, 2));
    process.exitCode = ok ? 0 : 1;
  }).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
