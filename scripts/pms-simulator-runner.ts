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
  openPlant3dAutomationPage,
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
  workflowRoleSource?: string;
  workflowNextStep?: string | null;
  taskCurrentNode?: string | null;
  workflowCurrentNode?: string | null;
  currentWorkflowNode: string | null;
  currentTaskId: string | null;
  currentFormId: string | null;
  currentTaskStatus: string;
  iframeSource: string | null;
  iframeUrl: string | null;
  lastOpenedFormId: string | null;
  selectedTaskId: string | null;
  selectedFormId: string | null;
  taskAssignedUserId?: string | null;
  canMutateWorkflow?: boolean;
  accessDecisionSource?: string | null;
  diagnosticsError?: string | null;
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
  cleanupFormIds: Set<string>;
  ensureBackendHealthy?: (caseId: PmsSimulatorCaseId) => Promise<void>;
};

type ScenarioRuntime = ScenarioContext & {
  context: BrowserContext;
  page: Page;
  caseId: PmsSimulatorCaseId;
  consoleMessages: {
    type: string;
    text: string;
    url: string;
  }[];
};

type CreatedReview = {
  packageName: string;
  formId: string;
  taskId: string | null;
};
type RestoreRecordReadback = {
  confirmedRecordCount: number;
  confirmedAnnotationCount: number;
  confirmedMeasurementCount: number;
  detail: string;
};
type RestoreConfirmedCounts = RestoreRecordReadback & {
  commentAnnotationId: string;
  commentContent: string;
  commentCount: number;
  uniqueCommentCount: number;
  duplicateCommentCount: number;
  commentContentFound: boolean;
  commentDetail: string;
};
type ConfirmedRecordApiRecord = {
  id?: string;
  taskId?: string;
  task_id?: string;
  formId?: string;
  form_id?: string;
  annotations?: unknown[];
  cloudAnnotations?: unknown[];
  rectAnnotations?: unknown[];
  obbAnnotations?: unknown[];
  measurements?: unknown[];
};
type CommentThreadApiComment = {
  id?: string;
  commentId?: string;
  comment_id?: string;
  annotationId?: string;
  annotation_id?: string;
  annotationType?: string;
  annotation_type?: string;
  formId?: string;
  form_id?: string;
  taskId?: string;
  task_id?: string;
  content?: string;
};
type RestoreCommentReadback = {
  annotationId: string;
  content: string;
  commentCount: number;
  uniqueCommentCount: number;
  duplicateCommentCount: number;
  contentFound: boolean;
  detail: string;
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
  'bran-mixed': '多 BRAN 批注驳回到最终批准',
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
  if (caseId === 'restore') {
    return `COMMENT-THREAD-REGRESSION-${Date.now()}`;
  }
  if (caseId === 'bran-mixed') {
    return `BRAN-MIXED-REGRESSION-${Date.now()}`;
  }
  return `SIM-${caseId.toUpperCase()}-${Date.now()}`;
}

function sanitizeFilePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-');
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

async function postJson<T>(url: string, payload: unknown, bearerToken?: string): Promise<{ status: number; body: T }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(bearerToken ? { Authorization: `Bearer ${bearerToken}` } : {}),
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error(`POST ${url} 超时`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
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

async function getJson<T>(url: string, bearerToken?: string): Promise<{ status: number; body: T }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: bearerToken ? { Authorization: `Bearer ${bearerToken}` } : {},
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error(`GET ${url} 超时`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  const text = await response.text();
  let body: T;
  try {
    body = JSON.parse(text) as T;
  } catch {
    throw new Error(`GET ${url} 返回非 JSON：HTTP ${response.status} ${text}`);
  }
  if (!response.ok) {
    throw new Error(`GET ${url} 失败：HTTP ${response.status} ${text}`);
  }
  return { status: response.status, body };
}

type BackendTaskProbe = {
  taskId: string | null;
  currentNode: string | null;
  status: string | null;
  raw: unknown;
};

type WorkflowSyncProbeResponse = {
  data?: {
    taskId?: string;
    task_id?: string;
    currentNode?: string;
    current_node?: string;
    taskStatus?: string;
    task_status?: string;
  };
};

async function probeBackendTaskByFormId(
  runtime: ScenarioRuntime,
  formId: string,
  taskId?: string | null,
): Promise<BackendTaskProbe | null> {
  try {
    const token = await createCleanupToken(runtime.env);
    const normalizedTaskId = String(taskId || '').trim();
    const syncResponse = await postJson<WorkflowSyncProbeResponse>(
      `${runtime.env.backendBaseUrl}/api/review/workflow/sync`,
      {
        form_id: formId,
        token,
        action: 'query',
        actor: {
          id: 'SJ',
          name: 'SJ',
          roles: 'sj',
        },
      },
      token,
    );
    const syncData = syncResponse.body.data;
    if (syncData) {
      return {
        taskId: String(syncData.taskId || syncData.task_id || normalizedTaskId || '').trim() || null,
        currentNode: String(syncData.currentNode || syncData.current_node || '').trim() || null,
        status: String(syncData.taskStatus || syncData.task_status || '').trim() || null,
        raw: syncData,
      };
    }

    if (normalizedTaskId) {
      type TaskDetailResponse = {
        success?: boolean;
        task?: {
          id?: string;
          formId?: string;
          form_id?: string;
          currentNode?: string;
          current_node?: string;
          status?: string;
        };
      };
      const detailResponse = await getJson<TaskDetailResponse>(
        `${runtime.env.backendBaseUrl}/api/review/tasks/${encodeURIComponent(normalizedTaskId)}`,
        token,
      );
      const task = detailResponse.body.task;
      if (task) {
        return {
          taskId: String(task.id || normalizedTaskId).trim() || normalizedTaskId,
          currentNode: String(task.currentNode || task.current_node || '').trim() || null,
          status: String(task.status || '').trim() || null,
          raw: task,
        };
      }
    }
    type TasksResponse = {
      success?: boolean;
      tasks?: {
        id?: string;
        formId?: string;
        form_id?: string;
        currentNode?: string;
        current_node?: string;
        status?: string;
      }[];
    };
    const response = await getJson<TasksResponse>(
      `${runtime.env.backendBaseUrl}/api/review/tasks?limit=100&offset=0`,
      token,
    );
    const tasks = Array.isArray(response.body.tasks) ? response.body.tasks : [];
    const found = tasks.find((task) => {
      const fid = String(task.formId || task.form_id || '').trim();
      return fid === formId;
    });
    if (!found) return null;
    return {
      taskId: String(found.id || '').trim() || null,
      currentNode: String(found.currentNode || found.current_node || '').trim() || null,
      status: String(found.status || '').trim() || null,
      raw: found,
    };
  } catch (error) {
    traceSimulator(`probeBackendTaskByFormId form_id=${formId} 失败：${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function collectConfirmedRecords(body: unknown): ConfirmedRecordApiRecord[] {
  if (!isObjectRecord(body)) return [];
  const data = isObjectRecord(body.data) ? body.data : null;
  const candidates = [
    body.records,
    data?.records,
    body.record,
    data?.record,
    Array.isArray(body.data) ? body.data : null,
  ];
  const records: ConfirmedRecordApiRecord[] = [];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      records.push(...candidate.filter(isObjectRecord).map((item) => item as ConfirmedRecordApiRecord));
    } else if (isObjectRecord(candidate)) {
      records.push(candidate as ConfirmedRecordApiRecord);
    }
  }
  return records;
}

function countArray(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function summarizeConfirmedRecords(
  status: number,
  body: unknown,
  formId: string,
): RestoreRecordReadback {
  const records = collectConfirmedRecords(body);
  const matched = records.filter((record) => {
    const recordFormId = String(record.formId || record.form_id || '').trim();
    return !recordFormId || recordFormId === formId;
  });
  const confirmedAnnotationCount = matched.reduce((sum, record) => {
    return sum
      + countArray(record.annotations)
      + countArray(record.cloudAnnotations)
      + countArray(record.rectAnnotations)
      + countArray(record.obbAnnotations);
  }, 0);
  const confirmedMeasurementCount = matched.reduce((sum, record) => {
    return sum + countArray(record.measurements);
  }, 0);
  return {
    confirmedRecordCount: matched.length,
    confirmedAnnotationCount,
    confirmedMeasurementCount,
    detail: `HTTP ${status} records=${records.length} matched=${matched.length} annotations=${confirmedAnnotationCount} measurements=${confirmedMeasurementCount}`,
  };
}

async function readBackendConfirmedCounts(
  runtime: ScenarioRuntime,
  options: {
    taskId: string;
    formId: string;
    token: string;
  },
): Promise<RestoreRecordReadback> {
  const params = new URLSearchParams({ form_id: options.formId });
  const response = await getJson<unknown>(
    `${runtime.env.backendBaseUrl}/api/review/records/by-task/${encodeURIComponent(options.taskId)}?${params}`,
    options.token,
  );
  return summarizeConfirmedRecords(response.status, response.body, options.formId);
}

function collectCommentThreadRecords(body: unknown): CommentThreadApiComment[] {
  if (!isObjectRecord(body)) return [];
  const data = isObjectRecord(body.data) ? body.data : null;
  const candidates = [
    body.comments,
    data?.comments,
    body.comment,
    data?.comment,
    Array.isArray(body.data) ? body.data : null,
  ];
  const comments: CommentThreadApiComment[] = [];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      comments.push(...candidate.filter(isObjectRecord).map((item) => item as CommentThreadApiComment));
    } else if (isObjectRecord(candidate)) {
      comments.push(candidate as CommentThreadApiComment);
    }
  }
  return comments;
}

function readCommentId(comment: CommentThreadApiComment): string {
  return String(comment.id || comment.commentId || comment.comment_id || '').trim();
}

async function readBackendCommentThread(
  runtime: ScenarioRuntime,
  options: {
    taskId: string;
    formId: string;
    annotationId: string;
    content: string;
    token: string;
  },
): Promise<RestoreCommentReadback> {
  const params = new URLSearchParams({
    type: 'text',
    form_id: options.formId,
    task_id: options.taskId,
  });
  const response = await getJson<unknown>(
    `${runtime.env.backendBaseUrl}/api/review/comments/by-annotation/${encodeURIComponent(options.annotationId)}?${params}`,
    options.token,
  );
  const comments = collectCommentThreadRecords(response.body).filter((comment) => {
    const annotationId = String(comment.annotationId || comment.annotation_id || '').trim();
    const annotationType = String(comment.annotationType || comment.annotation_type || '').trim();
    const formId = String(comment.formId || comment.form_id || '').trim();
    const taskId = String(comment.taskId || comment.task_id || '').trim();
    return (!annotationId || annotationId === options.annotationId)
      && (!annotationType || annotationType === 'text')
      && (!formId || formId === options.formId)
      && (!taskId || taskId === options.taskId);
  });
  const ids = comments.map(readCommentId).filter(Boolean);
  const uniqueCommentCount = new Set(ids).size;
  const duplicateCommentCount = Math.max(0, ids.length - uniqueCommentCount);
  const contentFound = comments.some((comment) => String(comment.content || '') === options.content);
  return {
    annotationId: options.annotationId,
    content: options.content,
    commentCount: comments.length,
    uniqueCommentCount,
    duplicateCommentCount,
    contentFound,
    detail: `HTTP ${response.status} comments=${comments.length} unique=${uniqueCommentCount} duplicates=${duplicateCommentCount} content_found=${contentFound}`,
  };
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

async function waitForOpenedIframeSnapshot(
  page: Page,
  options: {
    source?: string;
    formId?: string | null;
    taskId?: string | null;
    timeoutMs?: number;
    message: string;
  },
): Promise<SimulatorTestSnapshot> {
  return await waitFor(async () => {
    const snapshot = await getSnapshot(page);
    if (!snapshot.iframeSource || !snapshot.iframeUrl) return null;
    if (options.source && snapshot.iframeSource !== options.source) return null;
    if (options.formId && snapshot.currentFormId !== options.formId && snapshot.lastOpenedFormId !== options.formId) {
      return null;
    }
    if (options.taskId && snapshot.currentTaskId !== options.taskId && snapshot.selectedTaskId !== options.taskId) {
      return null;
    }
    return snapshot;
  }, {
    timeoutMs: options.timeoutMs ?? 90_000,
    intervalMs: 600,
    message: options.message,
  });
}

async function openAutomationPageFromSnapshot(
  runtime: ScenarioRuntime,
  snapshot: SimulatorTestSnapshot,
  label: string,
  options?: { tokenUserId?: string; tokenRole?: WorkflowRole },
): Promise<Page | null> {
  if (!snapshot.iframeUrl) return null;
  let url = snapshot.iframeUrl;
  if (options?.tokenUserId && options.tokenRole) {
    const response = await postJson<{ code?: number; data?: { token?: string }; token?: string }>(
      `${runtime.env.backendBaseUrl}/api/auth/token`,
      {
        project_id: runtime.env.projectId,
        user_id: options.tokenUserId,
        role: options.tokenRole,
      },
    );
    const token = response.body.data?.token || response.body.token || '';
    if (!token) {
      throw new Error(`automation page token 获取失败：${options.tokenUserId}/${options.tokenRole}`);
    }
    const parsed = new URL(url);
    parsed.searchParams.set('user_token', token);
    parsed.searchParams.set('user_id', options.tokenUserId);
    url = parsed.toString();
  }
  return await openPlant3dAutomationPage(runtime.context, url, label);
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
    predicate: (item) => {
      if (!item.iframeSource) return false;
      if (normalizedTaskId && item.currentTaskId !== normalizedTaskId && item.selectedTaskId !== normalizedTaskId) {
        return false;
      }
      return Boolean(
        item.taskCurrentNode
          || item.workflowNextStep
          || item.workflowCurrentNode
          || item.currentTaskStatus !== '--'
          || item.diagnosticsError,
      );
    },
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

function describeWorkflowVerifyDetail(
  snapshot: SimulatorTestSnapshot,
  expectedAction: SimulatorWorkflowAction,
): string {
  return [
    `expected_action=${expectedAction}`,
    `actual_action=${snapshot.lastVerifyAction || '--'}`,
    `ok=${snapshot.lastVerifyOk === null ? '--' : snapshot.lastVerifyOk}`,
    `message=${snapshot.lastVerifyMessage || ''}`,
  ].join(' ｜ ');
}

function describeWorkflowSyncDetail(
  snapshot: SimulatorTestSnapshot,
  expectedAction: SimulatorWorkflowAction,
): string {
  return [
    `expected_action=${expectedAction}`,
    `actual_action=${snapshot.lastAction || '--'}`,
    `ok=${snapshot.lastOk === null ? '--' : snapshot.lastOk}`,
    `message=${snapshot.lastMessage || ''}`,
  ].join(' ｜ ');
}

function assertWorkflowVerify(
  key: string,
  snapshot: SimulatorTestSnapshot,
  expectedAction: SimulatorWorkflowAction,
): PmsSimulatorAssertionResult {
  const passed = snapshot.lastVerifyAction === expectedAction && snapshot.lastVerifyOk === true;
  return assertResult(key, passed, describeWorkflowVerifyDetail(snapshot, expectedAction));
}

function assertWorkflowSync(
  key: string,
  snapshot: SimulatorTestSnapshot,
  expectedAction: SimulatorWorkflowAction,
): PmsSimulatorAssertionResult {
  const passed = snapshot.lastAction === expectedAction && snapshot.lastOk === true;
  return assertResult(key, passed, describeWorkflowSyncDetail(snapshot, expectedAction));
}

function assertBackendCurrentNode(
  key: string,
  probe: BackendTaskProbe | null,
  expectedNode: WorkflowRole,
): PmsSimulatorAssertionResult {
  return assertResult(
    key,
    probe?.currentNode === expectedNode,
    probe
      ? `backend task_id=${probe.taskId} current_node=${probe.currentNode} status=${probe.status}`
      : '后端未返回 form_id 对应任务',
    expectedNode,
    probe?.currentNode ?? null,
  );
}

function collectConsoleIssues(runtime: ScenarioRuntime, patterns: RegExp[]): string[] {
  return runtime.consoleMessages
    .filter((item) => patterns.some((pattern) => pattern.test(item.text)))
    .map((item) => `${item.type}: ${item.text}`)
    .slice(0, 8);
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

async function cleanupForms(runtime: Pick<ScenarioRuntime, 'env' | 'cleanupFormIds'>): Promise<void> {
  if (process.env.PMS_SIMULATOR_SKIP_CLEANUP === '1') {
    traceSimulator('skip cleanup because PMS_SIMULATOR_SKIP_CLEANUP=1');
    return;
  }
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

async function saveRestoreRecord(
  runtime: ScenarioRuntime,
  options: {
    taskId: string;
    formId: string;
  },
): Promise<RestoreConfirmedCounts> {
  const auth = buildAuthLoginRequest({
    projectId: runtime.env.projectId,
    currentPmsUser: 'JH',
    currentWorkflowRole: 'jd',
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
    throw new Error('restore 记录注入登录未返回 token');
  }

  const now = Date.now();
  const annotationId = `restore-annot-${now}`;
  const commentContent = `评论线程回归 ${now}`;
  await postJson(`${runtime.env.backendBaseUrl}/api/review/records`, {
    taskId: options.taskId,
    formId: options.formId,
    type: 'batch',
    annotations: [{
      id: annotationId,
      entityId: '24381/145018',
      worldPos: [0, 0, 0],
      normal: [0, 1, 0],
      visible: true,
      glyph: '1',
      title: 'restore 自动化批注 24381_145018',
      description: '刷新恢复自动化持久化批注',
      createdAt: now,
      refno: '24381/145018',
      refnos: ['24381/145018', '24381_145018'],
      formId: options.formId,
      taskId: options.taskId,
    }],
    cloudAnnotations: [],
    rectAnnotations: [],
    measurements: [{
      id: `restore-measure-${now}`,
      kind: 'distance',
      origin: { entityId: '24381/145018:origin', worldPos: [0, 0, 0] },
      target: { entityId: '24381/145018:target', worldPos: [1, 0, 0] },
      visible: true,
      createdAt: now,
      formId: options.formId,
      taskId: options.taskId,
    }],
    note: 'restore 自动化确认记录',
  }, token);
  const commentResponse = await postJson<{ success?: boolean; comment?: CommentThreadApiComment; error_message?: string }>(
    `${runtime.env.backendBaseUrl}/api/review/comments`,
    {
      annotationId,
      annotationType: 'text',
      authorId: 'proofreader_001',
      authorName: 'JH',
      authorRole: 'proofreader',
      content: commentContent,
      formId: options.formId,
      taskId: options.taskId,
      workflowNode: 'jd',
    },
    token,
  );
  if (commentResponse.body.success === false) {
    throw new Error(`restore 评论创建失败：${commentResponse.body.error_message || 'unknown error'}`);
  }
  const recordReadback = await readBackendConfirmedCounts(runtime, {
    taskId: options.taskId,
    formId: options.formId,
    token,
  });
  const commentReadback = await readBackendCommentThread(runtime, {
    taskId: options.taskId,
    formId: options.formId,
    annotationId,
    content: commentContent,
    token,
  });
  traceSimulator(`restore backend confirmed readback form_id=${options.formId} task_id=${options.taskId} ${recordReadback.detail} ｜ ${commentReadback.detail}`);
  return {
    ...recordReadback,
    commentAnnotationId: commentReadback.annotationId,
    commentContent: commentReadback.content,
    commentCount: commentReadback.commentCount,
    uniqueCommentCount: commentReadback.uniqueCommentCount,
    duplicateCommentCount: commentReadback.duplicateCommentCount,
    commentContentFound: commentReadback.contentFound,
    commentDetail: commentReadback.detail,
  };
}

async function captureFailureScreenshot(runtime: ScenarioRuntime, caseId: PmsSimulatorCaseId): Promise<string> {
  const dir = path.join(runtime.artifactDir, 'screenshots');
  await ensureDir(dir);
  const filePath = path.join(dir, `${sanitizeFilePart(caseId)}.png`);
  await runtime.page.screenshot({ path: filePath, fullPage: true }).catch(() => undefined);
  const pages = runtime.context.pages().filter((page) => !page.isClosed());
  await Promise.all(pages.map(async (page, index) => {
    const pagePath = path.join(dir, `${sanitizeFilePart(caseId)}-page-${index + 1}.png`);
    await page.screenshot({ path: pagePath, fullPage: true }).catch(() => undefined);
  }));
  const pageSummary = pages.map((page, index) => ({
    index: index + 1,
    url: page.url(),
    frames: page.frames().filter((frame) => !frame.isDetached()).map((frame) => frame.url()),
  }));
  await fs.writeFile(
    path.join(dir, `${sanitizeFilePart(caseId)}-pages.json`),
    JSON.stringify(pageSummary, null, 2),
    'utf8',
  ).catch(() => undefined);
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
  const opened = await waitForOpenedIframeSnapshot(runtime.page, {
    source: 'new',
    message: `等待 createReview case=${caseId} 新建 iframe URL 超时`,
  });
  const automationPage = await openAutomationPageFromSnapshot(runtime, opened, `createReview case=${caseId}`);
  traceSimulator(`createReview case=${caseId} submitReview`);
  const submitResult = await runSubmitReviewAcrossContext(runtime.context);
  if (automationPage && automationPage !== runtime.page) {
    await automationPage.close().catch(() => undefined);
  }
  const packageName = submitResult.packageName;
  traceSimulator(`createReview case=${caseId} submitDone package=${packageName} hook_task_id=${submitResult.createResult?.taskId || '--'} hook_form_id=${submitResult.createResult?.formId || '--'} hook_error=${submitResult.createResult?.error || '--'}`);
  const snapshot = await waitFor(async () => {
    const current = await getSnapshot(runtime.page);
    return current.lastOpenedFormId || submitResult.createResult?.formId ? current : null;
  }, {
    timeoutMs: 120_000,
    intervalMs: 600,
    message: '等待新建单据回填 form_id 超时',
  });
  const formId = snapshot.lastOpenedFormId || submitResult.createResult?.formId;
  if (!formId) {
    throw new Error('新建单据后未获得 form_id');
  }
  runtime.cleanupFormIds.add(formId);
  const taskId = snapshot.currentTaskId || snapshot.selectedTaskId || submitResult.createResult?.taskId;
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

async function buildRestoreCounts(runtime: ScenarioRuntime, formId: string, taskId: string | null): Promise<{
  pendingAnnotationCount: number;
  pendingMeasurementCount: number;
  confirmedRecordCount: number;
  confirmedAnnotationCount: number;
  confirmedMeasurementCount: number;
  confirmedDetail: string;
  commentAnnotationId: string;
  commentContent: string;
  commentCount: number;
  uniqueCommentCount: number;
  duplicateCommentCount: number;
  commentContentFound: boolean;
  commentDetail: string;
}> {
  const located = await waitForReviewerWorkbenchAcrossContext(runtime.context, { formId });
  const pendingCounts = await located.root.evaluate(() => {
    const hook = (window as Window & {
      __plant3dReviewerE2E?: {
        addMockAnnotation: (title?: string, description?: string) => string;
        addMockMeasurement: (kind?: 'distance' | 'angle') => string;
        getAnnotationCount: () => number;
        getMeasurementCount: () => number;
      };
    }).__plant3dReviewerE2E;
    if (!hook) {
      throw new Error('__plant3dReviewerE2E 未挂载');
    }
    hook.addMockAnnotation(`restore-${Date.now()}`, '刷新恢复自动化批注');
    hook.addMockMeasurement('distance');
    const pendingAnnotationCount = hook.getAnnotationCount();
    const pendingMeasurementCount = hook.getMeasurementCount();
    return {
      pendingAnnotationCount,
      pendingMeasurementCount,
    };
  });
  if (!taskId) {
    throw new Error(`restore 缺少 task_id（form_id=${formId}）`);
  }
  const confirmedCounts = await saveRestoreRecord(runtime, { taskId, formId });
  return {
    ...pendingCounts,
    confirmedRecordCount: confirmedCounts.confirmedRecordCount,
    confirmedAnnotationCount: confirmedCounts.confirmedAnnotationCount,
    confirmedMeasurementCount: confirmedCounts.confirmedMeasurementCount,
    confirmedDetail: confirmedCounts.detail,
    commentAnnotationId: confirmedCounts.commentAnnotationId,
    commentContent: confirmedCounts.commentContent,
    commentCount: confirmedCounts.commentCount,
    uniqueCommentCount: confirmedCounts.uniqueCommentCount,
    duplicateCommentCount: confirmedCounts.duplicateCommentCount,
    commentContentFound: confirmedCounts.commentContentFound,
    commentDetail: confirmedCounts.commentDetail,
  };
}

async function readRestoreCounts(
  runtime: ScenarioRuntime,
  formId: string,
  taskId: string,
  comment: {
    annotationId: string;
    content: string;
  },
): Promise<{
  confirmedRecordCount: number;
  confirmedAnnotationCount: number;
  confirmedMeasurementCount: number;
  uiAnnotationCount: number;
  uiAnnotationTitleFound: boolean;
  uiCommentContentFound: boolean;
  uiBranRefnoFound: boolean;
  uiDetail: string;
  commentCount: number;
  uniqueCommentCount: number;
  duplicateCommentCount: number;
  commentContentFound: boolean;
  commentDetail: string;
}> {
  const located = await waitForReviewerWorkbenchAcrossContext(runtime.context, { formId });
  const counts = await located.root.evaluate(() => {
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
  const expectedAnnotationTitle = 'restore 自动化批注 24381_145018';
  let visibleText = await waitFor(async () => {
    const text = await located.root.locator('body').innerText({ timeout: 3000 }).catch(() => '');
    const hasTitle = text.includes(expectedAnnotationTitle);
    const hasComment = text.includes(comment.content);
    return hasTitle && hasComment ? text : null;
  }, {
    timeoutMs: 30_000,
    intervalMs: 600,
    message: '等待 reviewer 详情页显示恢复批注标题与评论内容超时',
  }).catch(async () => await located.root.locator('body').innerText({ timeout: 3000 }).catch(() => ''));
  if (visibleText.includes(expectedAnnotationTitle) && !visibleText.includes(comment.content)) {
    await located.root.getByText(expectedAnnotationTitle, { exact: false }).first().click({ timeout: 3000 }).catch(() => undefined);
    visibleText = await waitFor(async () => {
      const text = await located.root.locator('body').innerText({ timeout: 3000 }).catch(() => '');
      return text.includes(comment.content) ? text : null;
    }, {
      timeoutMs: 10_000,
      intervalMs: 500,
      message: '点击恢复批注后等待评论内容显示超时',
    }).catch(async () => await located.root.locator('body').innerText({ timeout: 3000 }).catch(() => visibleText));
  }
  const token = await createCleanupToken(runtime.env);
  const commentReadback = await readBackendCommentThread(runtime, {
    formId,
    taskId,
    annotationId: comment.annotationId,
    content: comment.content,
    token,
  });
  return {
    ...counts,
    uiAnnotationCount: counts.confirmedAnnotationCount,
    uiAnnotationTitleFound: visibleText.includes(expectedAnnotationTitle),
    uiCommentContentFound: visibleText.includes(comment.content),
    uiBranRefnoFound: visibleText.includes('24381_145018') || visibleText.includes('24381/145018'),
    uiDetail: `title_found=${visibleText.includes(expectedAnnotationTitle)} comment_found=${visibleText.includes(comment.content)} bran_found=${visibleText.includes('24381_145018') || visibleText.includes('24381/145018')}`,
    commentCount: commentReadback.commentCount,
    uniqueCommentCount: commentReadback.uniqueCommentCount,
    duplicateCommentCount: commentReadback.duplicateCommentCount,
    commentContentFound: commentReadback.contentFound,
    commentDetail: commentReadback.detail,
  };
}

const BRAN_MIXED_REFNOS = [
  '24381_144976',
  '24381_144991',
  '24381_145012',
  '24381_145018',
] as const;

type BranMixedRefno = (typeof BRAN_MIXED_REFNOS)[number];
type AnnotationAction = 'fixed' | 'wont_fix' | 'agree' | 'reject';
type BranMixedAnnotation = {
  refno: BranMixedRefno;
  slashRefno: string;
  annotationId: string;
};
type AnnotationStateApiRecord = {
  annotationId?: string;
  annotation_id?: string;
  annotationType?: string;
  annotation_type?: string;
  formId?: string;
  form_id?: string;
  taskId?: string;
  task_id?: string;
  resolutionStatus?: string;
  resolution_status?: string;
  decisionStatus?: string;
  decision_status?: string;
  history?: unknown[];
};

type AnnotationStateReadback = {
  records: AnnotationStateApiRecord[];
  detail: string;
};

function branRefnoToSlash(refno: string): string {
  return refno.replace(/_/g, '/');
}

function branMixedAnnotationId(refno: string, now: number): string {
  return `bran-mixed-${refno.replace(/[^a-zA-Z0-9]+/g, '-')}-${now}`;
}

function collectAnnotationStateRecords(body: unknown): AnnotationStateApiRecord[] {
  if (!isObjectRecord(body)) return [];
  const data = isObjectRecord(body.data) ? body.data : null;
  const candidates = [
    body.states,
    data?.states,
    body.records,
    data?.records,
    body.state,
    data?.state,
    Array.isArray(body.data) ? body.data : null,
  ];
  const records: AnnotationStateApiRecord[] = [];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      records.push(...candidate.filter(isObjectRecord).map((item) => item as AnnotationStateApiRecord));
    } else if (isObjectRecord(candidate)) {
      records.push(candidate as AnnotationStateApiRecord);
    }
  }
  return records;
}

function readAnnotationIdFromState(state: AnnotationStateApiRecord): string {
  return String(state.annotationId || state.annotation_id || '').trim();
}

function readDecisionStatusFromState(state: AnnotationStateApiRecord): string {
  return String(state.decisionStatus || state.decision_status || '').trim();
}

function readUpdatedAtFromState(state: AnnotationStateApiRecord): number {
  const raw = isObjectRecord(state) ? state.updatedAt || state.updated_at : undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function findLatestAnnotationState(
  states: AnnotationStateApiRecord[],
  annotationId: string,
): AnnotationStateApiRecord | undefined {
  return states
    .filter((item) => readAnnotationIdFromState(item) === annotationId)
    .sort((a, b) => readUpdatedAtFromState(b) - readUpdatedAtFromState(a))[0];
}

async function createRoleToken(
  runtime: ScenarioRuntime,
  currentPmsUser: SimulatorPmsUser,
  currentWorkflowRole: WorkflowRole,
): Promise<string> {
  const auth = buildAuthLoginRequest({
    projectId: runtime.env.projectId,
    currentPmsUser,
    currentWorkflowRole,
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
    throw new Error(`${currentPmsUser}/${currentWorkflowRole} 登录未返回 token`);
  }
  return token;
}

async function seedBranMixedRecords(
  runtime: ScenarioRuntime,
  options: {
    taskId: string;
    formId: string;
  },
): Promise<BranMixedAnnotation[]> {
  const token = await createRoleToken(runtime, 'SJ', 'sj');
  const now = Date.now();
  const annotations = BRAN_MIXED_REFNOS.map((refno, index) => {
    const slashRefno = branRefnoToSlash(refno);
    const annotationId = branMixedAnnotationId(refno, now);
    return {
      id: annotationId,
      entityId: slashRefno,
      worldPos: [index * 2, 0, 0],
      normal: [0, 1, 0],
      visible: true,
      glyph: String(index + 1),
      title: `BRAN ${refno} 混合流程批注`,
      description: `仿 PMS 多 BRAN 批注 ${refno}`,
      createdAt: now + index,
      refno: slashRefno,
      refnos: [slashRefno, refno],
      formId: options.formId,
      taskId: options.taskId,
    };
  });
  await postJson(`${runtime.env.backendBaseUrl}/api/review/records`, {
    taskId: options.taskId,
    formId: options.formId,
    type: 'batch',
    annotations,
    cloudAnnotations: [],
    rectAnnotations: [],
    measurements: [],
    note: 'bran-mixed 多 BRAN 批注自动化确认记录',
  }, token);

  for (const annotation of annotations) {
    await postJson(`${runtime.env.backendBaseUrl}/api/review/comments`, {
      annotationId: annotation.id,
      annotationType: 'text',
      authorId: 'SJ',
      authorName: 'SJ',
      authorRole: 'designer',
      content: `BRAN ${annotation.refnos[1]} 初始说明`,
      formId: options.formId,
      taskId: options.taskId,
      workflowNode: 'sj',
    }, token);
  }

  return annotations.map((annotation) => ({
    refno: annotation.refnos[1] as BranMixedRefno,
    slashRefno: annotation.refno,
    annotationId: annotation.id,
  }));
}

async function applyAnnotationAction(
  runtime: ScenarioRuntime,
  options: {
    taskId: string;
    formId: string;
    annotationId: string;
    action: AnnotationAction;
    note: string;
    currentPmsUser: SimulatorPmsUser;
    currentWorkflowRole: WorkflowRole;
  },
): Promise<void> {
  const token = await createRoleToken(runtime, options.currentPmsUser, options.currentWorkflowRole);
  await postJson(`${runtime.env.backendBaseUrl}/api/review/annotation-states/apply`, {
    formId: options.formId,
    taskId: options.taskId,
    annotationId: options.annotationId,
    annotationType: 'text',
    action: options.action,
    note: options.note,
  }, token);
}

async function readAnnotationStates(
  runtime: ScenarioRuntime,
  options: {
    taskId: string;
    formId: string;
  },
): Promise<AnnotationStateReadback> {
  const token = await createCleanupToken(runtime.env);
  const params = new URLSearchParams({
    form_id: options.formId,
    task_id: options.taskId,
  });
  const response = await getJson<unknown>(
    `${runtime.env.backendBaseUrl}/api/review/annotation-states?${params}`,
    token,
  );
  const records = collectAnnotationStateRecords(response.body).filter((state) => {
    const formId = String(state.formId || state.form_id || '').trim();
    const taskId = String(state.taskId || state.task_id || '').trim();
    return (!formId || formId === options.formId) && (!taskId || taskId === options.taskId);
  });
  return {
    records,
    detail: `HTTP ${response.status} states=${records.length}`,
  };
}

async function assertTaskContainsBranRefs(
  runtime: ScenarioRuntime,
  taskId: string,
): Promise<PmsSimulatorAssertionResult[]> {
  const token = await createCleanupToken(runtime.env);
  const taskDetail = await getJson<unknown>(
    `${runtime.env.backendBaseUrl}/api/review/tasks/${encodeURIComponent(taskId)}`,
    token,
  );
  const detailText = JSON.stringify(taskDetail.body);
  return BRAN_MIXED_REFNOS.map((refno) => assertResult(
    `bran-mixed-task-contains-${refno}`,
    detailText.includes(refno) || detailText.includes(branRefnoToSlash(refno)),
    '新建任务详情应包含 BRAN 参考号',
    refno,
    detailText.slice(0, 800),
  ));
}

async function applyBranMixedDesignerActions(
  runtime: ScenarioRuntime,
  created: CreatedReview,
  annotations: BranMixedAnnotation[],
): Promise<void> {
  if (!created.taskId) throw new Error(`bran-mixed 缺少 task_id（form_id=${created.formId}）`);
  const actionByRefno: Record<BranMixedRefno, AnnotationAction> = {
    '24381_144976': 'fixed',
    '24381_144991': 'fixed',
    '24381_145012': 'wont_fix',
    '24381_145018': 'fixed',
  };
  for (const annotation of annotations) {
    await applyAnnotationAction(runtime, {
      taskId: created.taskId,
      formId: created.formId,
      annotationId: annotation.annotationId,
      action: actionByRefno[annotation.refno],
      note: `SJ 处理 ${annotation.refno}: ${actionByRefno[annotation.refno]}`,
      currentPmsUser: 'SJ',
      currentWorkflowRole: 'sj',
    });
  }
}

async function scenarioBranMixed(runtime: ScenarioRuntime): Promise<PmsSimulatorScenarioReport> {
  const previousTargetRefnos = process.env.PMS_TARGET_BRAN_REFNOS;
  process.env.PMS_TARGET_BRAN_REFNOS = BRAN_MIXED_REFNOS.join(',');
  try {
    const created = await createReview(runtime, 'bran-mixed');
    const assertions: PmsSimulatorAssertionResult[] = [];
    if (!created.taskId) {
      throw new Error(`bran-mixed 缺少 task_id（form_id=${created.formId}）`);
    }

    assertions.push(...await assertTaskContainsBranRefs(runtime, created.taskId));
    const annotations = await seedBranMixedRecords(runtime, {
      taskId: created.taskId,
      formId: created.formId,
    });
    assertions.push(assertResult('bran-mixed-seeded-annotation-count', annotations.length === 4, undefined, 4, annotations.length));
    await applyBranMixedDesignerActions(runtime, created, annotations);

    let snapshot = await runWorkflowAction(runtime.page, 'active', { comment: 'SJ active 多 BRAN 自动化' });
    assertions.push(assertWorkflowVerify('bran-mixed-sj-active-verify', snapshot, 'active'));
    assertions.push(assertWorkflowSync('bran-mixed-sj-active-sync', snapshot, 'active'));
    assertions.push(assertBackendCurrentNode('bran-mixed-sj-active-backend-current-node', await probeBackendTaskByFormId(runtime, created.formId, created.taskId), 'jd'));

    await openTaskForRole(runtime.page, created.formId, 'JH', { taskId: created.taskId });
    const rejected = annotations.find((item) => item.refno === '24381_144991');
    if (!rejected) throw new Error('bran-mixed 未找到 24381_144991 批注');
    for (const annotation of annotations) {
      const action: AnnotationAction = annotation.refno === '24381_144991' ? 'reject' : 'agree';
      await applyAnnotationAction(runtime, {
        taskId: created.taskId,
        formId: created.formId,
        annotationId: annotation.annotationId,
        action,
        note: `JH ${action === 'reject' ? '驳回' : '同意'} ${annotation.refno}`,
        currentPmsUser: 'JH',
        currentWorkflowRole: 'jd',
      });
    }
    snapshot = await runWorkflowAction(runtime.page, 'return', {
      comment: 'JH return 多 BRAN 自动化：24381_144991 驳回',
      targetNode: 'sj',
    });
    assertions.push(assertWorkflowVerify('bran-mixed-jh-return-verify', snapshot, 'return'));
    assertions.push(assertWorkflowSync('bran-mixed-jh-return-sync', snapshot, 'return'));
    assertions.push(assertBackendCurrentNode('bran-mixed-jh-return-backend-current-node', await probeBackendTaskByFormId(runtime, created.formId, created.taskId), 'sj'));
    const rejectedStates = await readAnnotationStates(runtime, {
      taskId: created.taskId,
      formId: created.formId,
    });
    const rejectedState = findLatestAnnotationState(rejectedStates.records, rejected.annotationId);
    const rejectedDecision = rejectedState ? readDecisionStatusFromState(rejectedState) : '';
    assertions.push(assertResult(
      'bran-mixed-144991-rejected-before-rework',
      rejectedDecision === 'rejected',
      `${rejectedStates.detail} decision=${rejectedDecision}`,
      'rejected',
      rejectedDecision,
    ));

    await openTaskForRole(runtime.page, created.formId, 'SJ', {
      source: 'task-reopen',
      taskId: created.taskId,
    });
    await applyAnnotationAction(runtime, {
      taskId: created.taskId,
      formId: created.formId,
      annotationId: rejected.annotationId,
      action: 'fixed',
      note: 'SJ 重新处理 24381_144991',
      currentPmsUser: 'SJ',
      currentWorkflowRole: 'sj',
    });
    snapshot = await runWorkflowAction(runtime.page, 'active', { comment: 'SJ active 重新提交 24381_144991' });
    assertions.push(assertWorkflowVerify('bran-mixed-sj-reactive-verify', snapshot, 'active'));
    assertions.push(assertWorkflowSync('bran-mixed-sj-reactive-sync', snapshot, 'active'));
    assertions.push(assertBackendCurrentNode('bran-mixed-sj-reactive-backend-current-node', await probeBackendTaskByFormId(runtime, created.formId, created.taskId), 'jd'));

    await openTaskForRole(runtime.page, created.formId, 'JH', { taskId: created.taskId });
    await applyAnnotationAction(runtime, {
      taskId: created.taskId,
      formId: created.formId,
      annotationId: rejected.annotationId,
      action: 'agree',
      note: 'JH 同意重新处理后的 24381_144991',
      currentPmsUser: 'JH',
      currentWorkflowRole: 'jd',
    });
    snapshot = await runWorkflowAction(runtime.page, 'agree', { comment: 'JH agree 多 BRAN 全部通过' });
    assertions.push(assertWorkflowVerify('bran-mixed-jh-agree-verify', snapshot, 'agree'));
    assertions.push(assertWorkflowSync('bran-mixed-jh-agree-sync', snapshot, 'agree'));
    assertions.push(assertBackendCurrentNode('bran-mixed-jh-agree-backend-current-node', await probeBackendTaskByFormId(runtime, created.formId, created.taskId), 'sh'));

    await openTaskForRole(runtime.page, created.formId, 'SH', { taskId: created.taskId });
    snapshot = await runWorkflowAction(runtime.page, 'agree', { comment: 'SH agree 多 BRAN 自动化' });
    assertions.push(assertWorkflowVerify('bran-mixed-sh-agree-verify', snapshot, 'agree'));
    assertions.push(assertWorkflowSync('bran-mixed-sh-agree-sync', snapshot, 'agree'));
    assertions.push(assertBackendCurrentNode('bran-mixed-sh-agree-backend-current-node', await probeBackendTaskByFormId(runtime, created.formId, created.taskId), 'pz'));

    await openTaskForRole(runtime.page, created.formId, 'PZ', { taskId: created.taskId });
    snapshot = await runWorkflowAction(runtime.page, 'agree', { comment: 'PZ approve 多 BRAN 自动化' });
    assertions.push(assertWorkflowVerify('bran-mixed-pz-approve-verify', snapshot, 'agree'));
    assertions.push(assertWorkflowSync('bran-mixed-pz-approve-sync', snapshot, 'agree'));
    assertions.push(assertResult('bran-mixed-approved-status', snapshot.currentTaskStatus === 'approved', undefined, 'approved', snapshot.currentTaskStatus));
    assertions.push(assertResult('bran-mixed-approved-node', normalizeNode(snapshot.currentWorkflowNode) === 'pz', undefined, 'pz', normalizeNode(snapshot.currentWorkflowNode)));

    const states = await readAnnotationStates(runtime, {
      taskId: created.taskId,
      formId: created.formId,
    });
    for (const annotation of annotations) {
      const state = findLatestAnnotationState(states.records, annotation.annotationId);
      const decisionStatus = state ? readDecisionStatusFromState(state) : '';
      assertions.push(assertResult(
        `bran-mixed-state-exists-${annotation.refno}`,
        Boolean(state),
        states.detail,
        true,
        Boolean(state),
      ));
      assertions.push(assertResult(
        `bran-mixed-state-agreed-${annotation.refno}`,
        decisionStatus === 'agreed' || decisionStatus === 'approved',
        `${states.detail} decision=${decisionStatus}`,
        'agreed|approved',
        decisionStatus,
      ));
    }

    const consoleIssues = collectConsoleIssues(runtime, [
      /comment thread/i,
      /review thread store.*failed/i,
      /Failed to open panel review/i,
      /Failed to create panel review/i,
    ]);
    assertions.push(assertResult('bran-mixed-console-no-review-errors', consoleIssues.length === 0, consoleIssues.join('\n'), 0, consoleIssues.length));

    return finalizeScenarioReport({
      caseId: 'bran-mixed',
      name: CASE_NAMES['bran-mixed'],
      formId: created.formId,
      taskId: created.taskId,
      finalNode: normalizeNode(snapshot.currentWorkflowNode),
      finalStatus: snapshot.currentTaskStatus,
      packageName: created.packageName,
      assertions,
    });
  } finally {
    if (previousTargetRefnos == null) {
      delete process.env.PMS_TARGET_BRAN_REFNOS;
    } else {
      process.env.PMS_TARGET_BRAN_REFNOS = previousTargetRefnos;
    }
  }
}

async function scenarioApproved(runtime: ScenarioRuntime): Promise<PmsSimulatorScenarioReport> {
  const created = await createReview(runtime, 'approved');
  const assertions: PmsSimulatorAssertionResult[] = [];

  let snapshot = await runWorkflowAction(runtime.page, 'active', { comment: 'SJ active 自动化' });
  assertions.push(assertWorkflowVerify('sj-active-verify', snapshot, 'active'));
  assertions.push(assertResult('sj-active-order', snapshot.lastVerifyAt != null && snapshot.lastActionAt != null && snapshot.lastVerifyAt <= snapshot.lastActionAt));
  assertions.push(assertWorkflowSync('sj-active-sync', snapshot, 'active'));

  await openTaskForRole(runtime.page, created.formId, 'JH', { taskId: created.taskId });
  snapshot = await runWorkflowAction(runtime.page, 'agree', { comment: 'JH agree 自动化' });
  assertions.push(assertWorkflowVerify('jh-agree-verify', snapshot, 'agree'));
  assertions.push(assertWorkflowSync('jh-agree-sync', snapshot, 'agree'));

  await openTaskForRole(runtime.page, created.formId, 'SH', { taskId: created.taskId });
  snapshot = await runWorkflowAction(runtime.page, 'agree', { comment: 'SH agree 自动化' });
  assertions.push(assertWorkflowVerify('sh-agree-verify', snapshot, 'agree'));
  assertions.push(assertWorkflowSync('sh-agree-sync', snapshot, 'agree'));

  await openTaskForRole(runtime.page, created.formId, 'PZ', { taskId: created.taskId });
  snapshot = await runWorkflowAction(runtime.page, 'agree', { comment: 'PZ agree 自动化' });
  assertions.push(assertWorkflowVerify('pz-agree-verify', snapshot, 'agree'));
  assertions.push(assertWorkflowSync('pz-agree-sync', snapshot, 'agree'));
  assertions.push(assertResult('approved-status', snapshot.currentTaskStatus === 'approved', undefined, 'approved', snapshot.currentTaskStatus));
  assertions.push(assertResult('approved-node', normalizeNode(snapshot.currentWorkflowNode) === 'pz', undefined, 'pz', normalizeNode(snapshot.currentWorkflowNode)));

  return finalizeScenarioReport({
    caseId: 'approved',
    name: CASE_NAMES.approved,
    formId: created.formId,
    taskId: created.taskId,
    finalNode: normalizeNode(snapshot.currentWorkflowNode),
    finalStatus: snapshot.currentTaskStatus,
    packageName: created.packageName,
    assertions,
  });
}

async function scenarioReturn(runtime: ScenarioRuntime): Promise<PmsSimulatorScenarioReport> {
  const created = await createReview(runtime, 'return');
  const assertions: PmsSimulatorAssertionResult[] = [];

  let snapshot = await runWorkflowAction(runtime.page, 'active', { comment: 'SJ active 自动化' });
  assertions.push(assertWorkflowVerify('sj-active-verify', snapshot, 'active'));
  assertions.push(assertWorkflowSync('sj-active-sync', snapshot, 'active'));
  assertions.push(assertBackendCurrentNode('sj-active-backend-current-node', await probeBackendTaskByFormId(runtime, created.formId, created.taskId), 'jd'));

  await openTaskForRole(runtime.page, created.formId, 'JH', { taskId: created.taskId });
  snapshot = await runWorkflowAction(runtime.page, 'agree', { comment: 'JH agree 自动化' });
  assertions.push(assertWorkflowVerify('jh-agree-verify', snapshot, 'agree'));
  assertions.push(assertWorkflowSync('jh-agree-sync', snapshot, 'agree'));
  assertions.push(assertBackendCurrentNode('jh-agree-backend-current-node', await probeBackendTaskByFormId(runtime, created.formId, created.taskId), 'sh'));

  await openTaskForRole(runtime.page, created.formId, 'SH', { taskId: created.taskId });
  snapshot = await runWorkflowAction(runtime.page, 'agree', { comment: 'SH agree 自动化' });
  assertions.push(assertWorkflowVerify('sh-agree-verify', snapshot, 'agree'));
  assertions.push(assertWorkflowSync('sh-agree-sync', snapshot, 'agree'));
  assertions.push(assertBackendCurrentNode('sh-agree-backend-current-node', await probeBackendTaskByFormId(runtime, created.formId, created.taskId), 'pz'));

  await openTaskForRole(runtime.page, created.formId, 'PZ', { taskId: created.taskId });
  const returnSnapshot = await runWorkflowAction(runtime.page, 'return', {
    comment: 'PZ return 自动化',
    targetNode: 'sj',
  });
  assertions.push(assertWorkflowVerify('return-verify', returnSnapshot, 'return'));
  assertions.push(assertWorkflowSync('return-sync', returnSnapshot, 'return'));

  const backendAfterReturn = await probeBackendTaskByFormId(runtime, created.formId, created.taskId);
  assertions.push(assertBackendCurrentNode('return-backend-current-node', backendAfterReturn, 'sj'));

  const reopened = await openTaskForRole(runtime.page, created.formId, 'SJ', {
    source: 'task-reopen',
    taskId: created.taskId,
  });
  assertions.push(assertResult('return-node', reopened.currentWorkflowNode === 'sj', undefined, 'sj', reopened.currentWorkflowNode));
  assertions.push(assertResult(
    'return-side-panel',
    reopened.sidePanelMode === 'initiate' || reopened.sidePanelMode === 'readonly',
    'SJ draft reopen may expose the designer comment handling area even when workflow controls are readonly.',
    'initiate|readonly',
    reopened.sidePanelMode,
  ));
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
  assertions.push(assertWorkflowVerify('stop-verify', stopSnapshot, 'stop'));
  assertions.push(assertWorkflowSync('stop-sync', stopSnapshot, 'stop'));

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
  if (created.taskId) {
    const token = await createCleanupToken(runtime.env);
    const taskDetail = await getJson<unknown>(
      `${runtime.env.backendBaseUrl}/api/review/tasks/${encodeURIComponent(created.taskId)}`,
      token,
    );
    const taskDetailText = JSON.stringify(taskDetail.body);
    assertions.push(assertResult(
      'restore-task-contains-bran-24381_145018',
      taskDetailText.includes('24381_145018') || taskDetailText.includes('24381/145018'),
      '新建任务详情应包含 BRAN 参考号 24381_145018',
      '24381_145018',
      taskDetailText.slice(0, 500),
    ));
  }

  await runWorkflowAction(runtime.page, 'active', { comment: 'SJ active 自动化' });
  const reviewerSnapshot = await openTaskForRole(runtime.page, created.formId, 'JH', { taskId: created.taskId });
  await openAutomationPageFromSnapshot(runtime, reviewerSnapshot, `restore reviewer form_id=${created.formId}`, {
    tokenUserId: 'proofreader_001',
    tokenRole: 'jd',
  });
  const beforeCounts = await buildRestoreCounts(runtime, created.formId, created.taskId);
  assertions.push(assertResult('restore-before-annotation', beforeCounts.pendingAnnotationCount >= 1, undefined, '>=1', beforeCounts.pendingAnnotationCount));
  assertions.push(assertResult('restore-before-measurement', beforeCounts.pendingMeasurementCount >= 1, undefined, '>=1', beforeCounts.pendingMeasurementCount));
  assertions.push(assertResult('restore-before-confirmed-record', beforeCounts.confirmedRecordCount >= 1, beforeCounts.confirmedDetail, '>=1', beforeCounts.confirmedRecordCount));
  assertions.push(assertResult('restore-before-confirmed-annotation', beforeCounts.confirmedAnnotationCount >= 1, beforeCounts.confirmedDetail, '>=1', beforeCounts.confirmedAnnotationCount));
  assertions.push(assertResult('restore-before-confirmed-measurement', beforeCounts.confirmedMeasurementCount >= 1, beforeCounts.confirmedDetail, '>=1', beforeCounts.confirmedMeasurementCount));
  assertions.push(assertResult('restore-before-comment-exists', beforeCounts.commentCount === 1, beforeCounts.commentDetail, 1, beforeCounts.commentCount));
  assertions.push(assertResult('restore-before-comment-content', beforeCounts.commentContentFound, beforeCounts.commentDetail, true, beforeCounts.commentContentFound));
  assertions.push(assertResult('restore-before-comment-dedup', beforeCounts.duplicateCommentCount === 0, beforeCounts.commentDetail, 0, beforeCounts.duplicateCommentCount));

  await reloadReviewerWorkbenchAcrossContext(runtime.context, { formId: created.formId });
  await waitForSimulatorReady(runtime.page);
  const afterSnapshot = await waitForSnapshotByFormId(runtime.page, created.formId, {
    predicate: (item) => item.sidePanelMode === 'workflow',
  });
  if (!created.taskId) {
    throw new Error(`restore 刷新后缺少 task_id（form_id=${created.formId}）`);
  }
  const afterCounts = await readRestoreCounts(runtime, created.formId, created.taskId, {
    annotationId: beforeCounts.commentAnnotationId,
    content: beforeCounts.commentContent,
  });
  assertions.push(assertResult('restore-form-preserved', afterSnapshot.currentFormId === created.formId, undefined, created.formId, afterSnapshot.currentFormId));
  assertions.push(assertResult('restore-annotation-count', afterCounts.confirmedAnnotationCount >= beforeCounts.confirmedAnnotationCount, undefined, beforeCounts.confirmedAnnotationCount, afterCounts.confirmedAnnotationCount));
  assertions.push(assertResult('restore-confirmed-record-count', afterCounts.confirmedRecordCount >= beforeCounts.confirmedRecordCount, undefined, beforeCounts.confirmedRecordCount, afterCounts.confirmedRecordCount));
  assertions.push(assertResult('restore-confirmed-measurement-count', afterCounts.confirmedMeasurementCount >= beforeCounts.confirmedMeasurementCount, undefined, beforeCounts.confirmedMeasurementCount, afterCounts.confirmedMeasurementCount));
  assertions.push(assertResult('restore-ui-annotation-count', afterCounts.uiAnnotationCount >= 1, afterCounts.uiDetail, '>=1', afterCounts.uiAnnotationCount));
  assertions.push(assertResult('restore-ui-annotation-title', afterCounts.uiAnnotationTitleFound, afterCounts.uiDetail, true, afterCounts.uiAnnotationTitleFound));
  assertions.push(assertResult('restore-ui-comment-content', afterCounts.uiCommentContentFound, afterCounts.uiDetail, true, afterCounts.uiCommentContentFound));
  assertions.push(assertResult('restore-ui-bran-refno', afterCounts.uiBranRefnoFound, afterCounts.uiDetail, true, afterCounts.uiBranRefnoFound));
  assertions.push(assertResult('restore-comment-after-refresh', afterCounts.commentCount === 1, afterCounts.commentDetail, 1, afterCounts.commentCount));
  assertions.push(assertResult('restore-comment-content-after-refresh', afterCounts.commentContentFound, afterCounts.commentDetail, true, afterCounts.commentContentFound));
  assertions.push(assertResult('restore-comment-dedup-after-refresh', afterCounts.duplicateCommentCount === 0, afterCounts.commentDetail, 0, afterCounts.duplicateCommentCount));
  const commentThreadConsoleIssues = collectConsoleIssues(runtime, [
    /comment thread/i,
    /review thread store.*failed/i,
  ]);
  const dockConsoleIssues = collectConsoleIssues(runtime, [
    /Failed to open panel review/i,
    /Failed to create panel review/i,
  ]);
  assertions.push(assertResult('restore-console-no-comment-thread-errors', commentThreadConsoleIssues.length === 0, commentThreadConsoleIssues.join('\n'), 0, commentThreadConsoleIssues.length));
  assertions.push(assertResult('restore-console-no-dock-panel-failed', dockConsoleIssues.length === 0, dockConsoleIssues.join('\n'), 0, dockConsoleIssues.length));

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
  'bran-mixed': scenarioBranMixed,
};

async function runSingleScenario(base: ScenarioContext, caseId: PmsSimulatorCaseId): Promise<PmsSimulatorScenarioReport> {
  traceSimulator(`runSingleScenario ${caseId} newContext`);
  const context = await base.browser.newContext({ viewport: { width: 1680, height: 1040 } });
  const consoleMessages: ScenarioRuntime['consoleMessages'] = [];
  const attachedPages = new WeakSet<Page>();
  const attachConsoleCapture = (targetPage: Page) => {
    if (attachedPages.has(targetPage)) return;
    attachedPages.add(targetPage);
    targetPage.on('console', (message) => {
      consoleMessages.push({
        type: message.type(),
        text: message.text(),
        url: targetPage.url(),
      });
    });
  };
  context.on('page', attachConsoleCapture);
  const page = await context.newPage();
  attachConsoleCapture(page);
  const runtime: ScenarioRuntime = {
    ...base,
    context,
    page,
    caseId,
    consoleMessages,
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
    await context.close().catch(() => undefined);
    delete process.env.PMS_MOCK_PACKAGE_NAME;
  }
}

export async function runPmsSimulatorScenarios(options?: {
  env?: PmsSimulatorEnvironmentConfig;
  artifactDir?: string;
  ensureBackendHealthy?: (caseId: PmsSimulatorCaseId) => Promise<void>;
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
      cleanupFormIds: new Set<string>(),
      ensureBackendHealthy: options?.ensureBackendHealthy,
    };
    const results: PmsSimulatorScenarioReport[] = [];
    for (const caseId of env.caseIds) {
      await base.ensureBackendHealthy?.(caseId);
      results.push(await runSingleScenario(base, caseId));
    }
    try {
      await cleanupForms(base);
    } catch (cleanupError) {
      console.error('[pms-simulator] 全量场景结束后清理失败:', cleanupError);
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
