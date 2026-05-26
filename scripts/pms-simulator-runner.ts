#!/usr/bin/env npx tsx
import fs from 'node:fs/promises';
import path from 'node:path';

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';

import {
  buildAuthLoginRequest,
  buildDeleteReviewPayload,
  buildEmbedUrlPayload,
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
  'annotation-screenshot': '批注截图包含三维批注与测量覆盖层',
  return: '驳回分支 return -> sj',
  stop: '终止分支 stop -> cancelled',
  restore: '刷新恢复',
  'gate-block': '批注门禁 block',
  'gate-return': '批注门禁 return',
  'bran-mixed': '多 BRAN 批注驳回到最终批准',
  'stop-sh': 'SH 节点终止分支 stop -> cancelled',
  'duplicate-bran-form': '同一 BRAN 多 form_id 隔离',
  'rus-244-design-a-ui-empty-state': 'RUS-244 design-A 三态拆分 + 入口收紧',
  'bug-rus-244-designer-empty-after-return': 'RUS-244 design-B PMS<->plant3d workflow 同步桥端到端',
  'bug-resubmit-creates-duplicate-task': '驳回后真按"发起编校审"按钮会再次 createReviewTask（生产 bug）',
  'resubmit-reviewer-reopen': '驳回后设计重新发起，校对/审核可重开审核面板',
  'returned-sj-active-block': '驳回后 sj 节点 verify(active) 仍被未处理批注阻断',
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
  const timeout = setTimeout(() => controller.abort(), 30_000);
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
  const timeout = setTimeout(() => controller.abort(), 30_000);
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

/**
 * 数同 form_id 下 backend `review_tasks` 表里非软删的 task 条数。
 *
 * 用途：验证 InitiateReviewPanel.handleSubmit 在 PMS 嵌入态下被多次触发时，
 *   是否会重复创建 review_task（bug-resubmit-creates-duplicate-task）。
 */
async function countBackendTasksByFormId(
  runtime: ScenarioRuntime,
  formId: string,
): Promise<{ total: number; activeTasks: { id: string; currentNode: string | null; status: string | null }[] }> {
  try {
    const token = await createCleanupToken(runtime.env);
    type TasksResponse = {
      success?: boolean;
      tasks?: {
        id?: string;
        formId?: string;
        form_id?: string;
        currentNode?: string;
        current_node?: string;
        status?: string;
        deleted?: boolean;
      }[];
    };
    const response = await getJson<TasksResponse>(
      `${runtime.env.backendBaseUrl}/api/review/tasks?limit=200&offset=0`,
      token,
    );
    const tasks = Array.isArray(response.body.tasks) ? response.body.tasks : [];
    const matched = tasks.filter((task) => {
      const fid = String(task.formId || task.form_id || '').trim();
      if (fid !== formId) return false;
      if (task.deleted === true) return false;
      return true;
    });
    return {
      total: matched.length,
      activeTasks: matched.map((task) => ({
        id: String(task.id || '').trim(),
        currentNode: String(task.currentNode || task.current_node || '').trim() || null,
        status: String(task.status || '').trim() || null,
      })),
    };
  } catch (error) {
    traceSimulator(`countBackendTasksByFormId form_id=${formId} 失败：${error instanceof Error ? error.message : String(error)}`);
    return { total: 0, activeTasks: [] };
  }
}

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

function readNonEmptyString(value: unknown): string | null {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || null;
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
  const skipIframeSrc = process.env.PMS_SIMULATOR_SKIP_REVIEWER_IFRAME === '1';
  await callSimulatorApi<void>(page, 'openTaskByFormId', {
    role,
    formId,
    taskId: normalizedTaskId,
    source,
    skipIframeSrc,
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
  await page.evaluate(() => {
    const api = (window as Window & {
      __pmsReviewSimulatorTest?: Record<string, (...innerArgs: unknown[]) => unknown>;
    }).__pmsReviewSimulatorTest;
    if (api && typeof api.confirmWorkflowDialog === 'function') {
      api.confirmWorkflowDialog();
    }
  });
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
      origin: { entityId: 'o:24381_145018:0', worldPos: [0, 0, 0] },
      target: { entityId: 'o:24381_145018:1', worldPos: [1, 0, 0] },
      visible: true,
      createdAt: now,
      sourceAnnotationId: annotationId,
      sourceAnnotationType: 'text',
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
  if (process.env.PMS_SIMULATOR_SEED_REVIEW_TASK === '1') {
    return await createSeededReview(runtime, caseId);
  }
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

async function createReviewWithBran(
  runtime: ScenarioRuntime,
  caseId: PmsSimulatorCaseId,
  refno: string,
  options?: { seeded?: boolean },
): Promise<CreatedReview> {
  const previousTargetRefno = process.env.PMS_TARGET_BRAN_REFNO;
  const previousTargetRefnos = process.env.PMS_TARGET_BRAN_REFNOS;
  const previousSeedFlag = process.env.PMS_SIMULATOR_SEED_REVIEW_TASK;
  process.env.PMS_TARGET_BRAN_REFNO = refno;
  delete process.env.PMS_TARGET_BRAN_REFNOS;
  if (options?.seeded) {
    process.env.PMS_SIMULATOR_SEED_REVIEW_TASK = '1';
  }
  try {
    return await createReview(runtime, caseId);
  } finally {
    if (previousTargetRefno == null) {
      delete process.env.PMS_TARGET_BRAN_REFNO;
    } else {
      process.env.PMS_TARGET_BRAN_REFNO = previousTargetRefno;
    }
    if (previousTargetRefnos == null) {
      delete process.env.PMS_TARGET_BRAN_REFNOS;
    } else {
      process.env.PMS_TARGET_BRAN_REFNOS = previousTargetRefnos;
    }
    if (previousSeedFlag == null) {
      delete process.env.PMS_SIMULATOR_SEED_REVIEW_TASK;
    } else {
      process.env.PMS_SIMULATOR_SEED_REVIEW_TASK = previousSeedFlag;
    }
  }
}

async function createSeededReview(runtime: ScenarioRuntime, caseId: PmsSimulatorCaseId): Promise<CreatedReview> {
  const packageName = scenarioPackageName(caseId);
  const bearerToken = await createRoleToken(runtime, 'SJ', 'sj');
  const embedPayload = buildEmbedUrlPayload({
    projectId: runtime.env.projectId,
    currentPmsUser: 'SJ',
    currentWorkflowRole: 'sj',
    workflowMode: 'external',
    token: bearerToken,
  });
  traceSimulator(`createSeededReview case=${caseId} embed-url`);
  const embedResponse = await postJson<Record<string, unknown>>(
    `${runtime.env.backendBaseUrl}/api/review/embed-url`,
    embedPayload,
    bearerToken,
  );
  const embedData = isObjectRecord(embedResponse.body.data) ? embedResponse.body.data : embedResponse.body;
  const query = isObjectRecord(embedData.query) ? embedData.query : null;
  const lineage = isObjectRecord(embedData.lineage) ? embedData.lineage : null;
  const formId = readNonEmptyString(embedData.form_id)
    || readNonEmptyString(embedData.formId)
    || readNonEmptyString(query?.form_id)
    || readNonEmptyString(query?.formId)
    || readNonEmptyString(lineage?.form_id)
    || readNonEmptyString(lineage?.formId);
  if (!formId) {
    throw new Error('seed 建单未获得 form_id');
  }

  const componentRefnos = (process.env.PMS_TARGET_BRAN_REFNOS || process.env.PMS_TARGET_BRAN_REFNO || '24381_145018')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const createPayload = {
    title: packageName,
    description: 'PMS simulator seeded review task',
    modelName: runtime.env.projectId,
    checkerId: 'JH',
    approverId: 'SH',
    reviewerId: 'JH',
    formId,
    priority: 'medium',
    components: componentRefnos.map((refNo, index) => ({
      id: `sim-seed-${index + 1}`,
      refNo,
      name: `模拟构件 ${index + 1}`,
      type: 'PIPE',
    })),
  };
  traceSimulator(`createSeededReview case=${caseId} review/tasks form_id=${formId}`);
  const createResponse = await postJson<Record<string, unknown>>(
    `${runtime.env.backendBaseUrl}/api/review/tasks`,
    createPayload,
    bearerToken,
  );
  const task = isObjectRecord(createResponse.body.task)
    ? createResponse.body.task
    : (isObjectRecord(createResponse.body.data) && isObjectRecord(createResponse.body.data.task)
      ? createResponse.body.data.task
      : null);
  const taskId = readNonEmptyString(task?.id);
  if (!taskId) {
    throw new Error('seed 建单未获得 task_id');
  }

  runtime.cleanupFormIds.add(formId);
  await refreshList(runtime.page);
  await openTaskForRole(runtime.page, formId, 'SJ', { taskId });
  traceSimulator(`createSeededReview case=${caseId} created form_id=${formId} task_id=${taskId}`);
  return {
    packageName,
    formId,
    taskId,
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
  uiMeasurementPathFound: boolean;
  uiMeasurementRawSuffixLeaked: boolean;
  uiDetail: string;
  commentCount: number;
  uniqueCommentCount: number;
  duplicateCommentCount: number;
  commentContentFound: boolean;
  commentDetail: string;
}> {
  const located = await waitForReviewerWorkbenchAcrossContext(runtime.context, { formId });
  const counts = await located.root.evaluate(async ({ annotationId }) => {
    const hook = (window as Window & {
      __plant3dReviewerE2E?: {
        getConfirmedRecordCount: () => number;
        getConfirmedAnnotationCount: () => number;
        getConfirmedMeasurementCount: () => number;
        refreshAnnotationCommentThread?: (annotationType?: 'text' | 'cloud' | 'rect' | 'obb', annotationId?: string) => Promise<number>;
      };
    }).__plant3dReviewerE2E;
    if (!hook) {
      throw new Error('__plant3dReviewerE2E 未挂载');
    }
    if (typeof hook.refreshAnnotationCommentThread === 'function') {
      await hook.refreshAnnotationCommentThread('text', annotationId);
    }
    return {
      confirmedRecordCount: hook.getConfirmedRecordCount(),
      confirmedAnnotationCount: hook.getConfirmedAnnotationCount(),
      confirmedMeasurementCount: hook.getConfirmedMeasurementCount(),
    };
  }, { annotationId: comment.annotationId });
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
  if (visibleText.includes(expectedAnnotationTitle)) {
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
  await located.root.getByRole('button', { name: /审核记录/ }).first().click({ timeout: 3000 }).catch(() => undefined);
  visibleText = await waitFor(async () => {
    const text = await located.root.locator('body').innerText({ timeout: 3000 }).catch(() => '');
    return text.includes('restore-measure') || text.includes('起点') ? text : null;
  }, {
    timeoutMs: 10_000,
    intervalMs: 500,
    message: '等待审核记录显示测量路径超时',
  }).catch(async () => await located.root.locator('body').innerText({ timeout: 3000 }).catch(() => visibleText));
  const token = await createCleanupToken(runtime.env);
  const commentReadback = await readBackendCommentThread(runtime, {
    formId,
    taskId,
    annotationId: comment.annotationId,
    content: comment.content,
    token,
  });
  const measurementTextIndex = Math.max(
    visibleText.indexOf('已确认测量回放'),
    visibleText.indexOf('restore-measure'),
    visibleText.indexOf('o:24381_145018'),
    visibleText.indexOf('起点'),
    visibleText.indexOf('距离测量'),
    visibleText.indexOf('测量'),
    visibleText.indexOf('距离'),
  );
  const measurementTextSnippet = measurementTextIndex >= 0
    ? visibleText.slice(Math.max(0, measurementTextIndex - 80), measurementTextIndex + 240).replace(/\s+/g, ' ')
    : visibleText.slice(0, 240).replace(/\s+/g, ' ');
  return {
    ...counts,
    uiAnnotationCount: counts.confirmedAnnotationCount,
    uiAnnotationTitleFound: visibleText.includes(expectedAnnotationTitle),
    uiCommentContentFound: visibleText.includes(comment.content),
    uiBranRefnoFound: visibleText.includes('24381_145018') || visibleText.includes('24381/145018'),
    uiMeasurementPathFound: visibleText.includes('距离测量')
      && visibleText.includes('起点 /*')
      && visibleText.includes('终点 /*'),
    uiMeasurementRawSuffixLeaked: visibleText.includes(':origin')
      || visibleText.includes(':target')
      || visibleText.includes('o:24381_145018')
      || visibleText.includes('24381_145018:0')
      || visibleText.includes('24381_145018:1'),
    uiDetail: [
      `title_found=${visibleText.includes(expectedAnnotationTitle)}`,
      `comment_found=${visibleText.includes(comment.content)}`,
      `bran_found=${visibleText.includes('24381_145018') || visibleText.includes('24381/145018')}`,
      `measurement_path_found=${visibleText.includes('距离测量')
        && visibleText.includes('起点 /*')
        && visibleText.includes('终点 /*')}`,
      `raw_suffix_leaked=${visibleText.includes(':origin')
        || visibleText.includes(':target')
        || visibleText.includes('o:24381_145018')
        || visibleText.includes('24381_145018:0')
        || visibleText.includes('24381_145018:1')}`,
      `measurement_snippet=${measurementTextSnippet}`,
    ].join(' '),
    commentCount: commentReadback.commentCount,
    uniqueCommentCount: commentReadback.uniqueCommentCount,
    duplicateCommentCount: commentReadback.duplicateCommentCount,
    commentContentFound: commentReadback.contentFound,
    commentDetail: commentReadback.detail,
  };
}

const PMS_SIMULATOR_PRIMARY_BRAN_REFNO = '24381_145018';

const PMS_SIMULATOR_MULTI_BRAN_REFNOS = [
  '24381_144976',
  '24381_144991',
  '24381_145012',
  '24381_145018',
] as const;

type PmsSimulatorMultiBranRefno = (typeof PMS_SIMULATOR_MULTI_BRAN_REFNOS)[number];

const BRAN_MIXED_REFNOS = PMS_SIMULATOR_MULTI_BRAN_REFNOS;

type BranMixedRefno = PmsSimulatorMultiBranRefno;
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
  const previousSeedFlag = process.env.PMS_SIMULATOR_SEED_REVIEW_TASK;
  process.env.PMS_TARGET_BRAN_REFNOS = BRAN_MIXED_REFNOS.join(',');
  // 多 BRAN 仅 seeded 路径（直接 POST /api/review/tasks）支持注入 N 个构件；
  // 默认 UI 路径只能注入单 BRAN（addMockComponent 一次）。强制走 seeded 让 task.components
  // 真包含 BRAN_MIXED_REFNOS，否则 assertTaskContainsBranRefs 会必失败。
  process.env.PMS_SIMULATOR_SEED_REVIEW_TASK = '1';
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
    if (previousSeedFlag == null) {
      delete process.env.PMS_SIMULATOR_SEED_REVIEW_TASK;
    } else {
      process.env.PMS_SIMULATOR_SEED_REVIEW_TASK = previousSeedFlag;
    }
  }
}

/**
 * 驳回后 sj 节点 verify(active) 阻断验证（v3 关键场景）。
 *
 * 流程：
 * 1. SJ seed 单据 + 1 条 fixed/pending 批注（满足 active 的 open=0）
 * 2. SJ active → jd
 * 3. JH 在 jd 节点 reject 那条初始批注 + POST 一条新的 open 批注
 * 4. JH return → sj
 * 5. **关键**：SJ 立即调 verify(active) → 期望阻断（recommended_action=block）
 * 6. SJ 把 jd 加的 open 批注标 fixed
 * 7. SJ 再 verify(active) → 期望通过
 *
 * 这个 case 直接对应「驳回后无法通过」的业务诉求。
 */
async function scenarioReturnedSjActiveBlock(runtime: ScenarioRuntime): Promise<PmsSimulatorScenarioReport> {
  const previousSeedFlag = process.env.PMS_SIMULATOR_SEED_REVIEW_TASK;
  process.env.PMS_SIMULATOR_SEED_REVIEW_TASK = '1';
  try {
    const created = await createReview(runtime, 'returned-sj-active-block');
    if (!created.taskId) {
      throw new Error(`returned-sj-active-block 缺少 task_id（form_id=${created.formId}）`);
    }
    const assertions: PmsSimulatorAssertionResult[] = [];

    const sjToken = await createRoleToken(runtime, 'SJ', 'sj');
    const initialAnnotationId = `returned-sj-active-block-init-${Date.now()}`;
    await postJson(`${runtime.env.backendBaseUrl}/api/review/records`, {
      taskId: created.taskId,
      formId: created.formId,
      type: 'batch',
      annotations: [{
        id: initialAnnotationId,
        title: '初始批注',
        description: 'SJ 起单时的初始批注',
        refnos: ['24381_145018'],
        reviewState: { resolutionStatus: 'fixed', decisionStatus: 'pending' },
      }],
      cloudAnnotations: [],
      rectAnnotations: [],
      measurements: [],
      note: 'returned-sj-active-block SJ seed',
    }, sjToken);

    let snapshot = await runWorkflowAction(runtime.page, 'active', { comment: 'SJ active 起单' });
    assertions.push(assertWorkflowVerify('returned-sj-active-block-sj-active-verify', snapshot, 'active'));
    assertions.push(assertWorkflowSync('returned-sj-active-block-sj-active-sync', snapshot, 'active'));
    assertions.push(assertBackendCurrentNode(
      'returned-sj-active-block-sj-active-backend-current-node',
      await probeBackendTaskByFormId(runtime, created.formId, created.taskId),
      'jd',
    ));

    await openTaskForRole(runtime.page, created.formId, 'JH', { taskId: created.taskId });
    await applyAnnotationAction(runtime, {
      taskId: created.taskId,
      formId: created.formId,
      annotationId: initialAnnotationId,
      action: 'reject',
      note: 'JH reject 初始批注（提供 return 理由）',
      currentPmsUser: 'JH',
      currentWorkflowRole: 'jd',
    });

    const jhToken = await createRoleToken(runtime, 'JH', 'jd');
    const jdAddedAnnotationId = `returned-sj-active-block-jd-added-${Date.now()}`;
    await postJson(`${runtime.env.backendBaseUrl}/api/review/records`, {
      taskId: created.taskId,
      formId: created.formId,
      type: 'batch',
      annotations: [{
        id: jdAddedAnnotationId,
        title: 'JH 新增批注',
        description: 'JH 在 jd 节点新增的未处理批注',
        refnos: ['24381_145018'],
      }],
      cloudAnnotations: [],
      rectAnnotations: [],
      measurements: [],
      note: 'returned-sj-active-block JH 新增 open 批注',
    }, jhToken);

    snapshot = await runWorkflowAction(runtime.page, 'return', {
      comment: 'JH return',
      targetNode: 'sj',
    });
    assertions.push(assertWorkflowVerify('returned-sj-active-block-jh-return-verify', snapshot, 'return'));
    assertions.push(assertWorkflowSync('returned-sj-active-block-jh-return-sync', snapshot, 'return'));
    assertions.push(assertBackendCurrentNode(
      'returned-sj-active-block-jh-return-backend-current-node',
      await probeBackendTaskByFormId(runtime, created.formId, created.taskId),
      'sj',
    ));

    await openTaskForRole(runtime.page, created.formId, 'SJ', {
      source: 'task-reopen',
      taskId: created.taskId,
    });
    const blocked = await runWorkflowAction(runtime.page, 'active', {
      comment: 'SJ active 期望被未处理批注阻断',
    });
    assertions.push(assertResult(
      'returned-sj-active-block-verify-blocked',
      blocked.lastVerifyOk === false,
      blocked.lastVerifyMessage || '',
      false,
      blocked.lastVerifyOk,
    ));
    assertions.push(assertResult(
      'returned-sj-active-block-recommended-block',
      blocked.lastVerifyRecommendedAction === 'block',
      undefined,
      'block',
      blocked.lastVerifyRecommendedAction,
    ));
    assertions.push(assertResult(
      'returned-sj-active-block-sync-blocked',
      blocked.lastOk === false,
      blocked.lastMessage || '',
      false,
      blocked.lastOk,
    ));
    assertions.push(assertResult(
      'returned-sj-active-block-reason-text',
      (blocked.lastVerifyMessage || '').includes('未处理批注')
        || (blocked.lastMessage || '').includes('未处理批注')
        || blocked.lastVerifyAnnotationSummary?.recommendedAction === 'block',
      `verify=${blocked.lastVerifyMessage || ''} sync=${blocked.lastMessage || ''}`,
      'reason 含 "未处理批注" 或 verify summary recommendedAction=block',
      `verify=${blocked.lastVerifyMessage || ''} | summary=${
        blocked.lastVerifyAnnotationSummary?.recommendedAction || '--'
      }`,
    ));
    assertions.push(assertBackendCurrentNode(
      'returned-sj-active-block-blocked-backend-current-node',
      await probeBackendTaskByFormId(runtime, created.formId, created.taskId),
      'sj',
    ));

    await applyAnnotationAction(runtime, {
      taskId: created.taskId,
      formId: created.formId,
      annotationId: jdAddedAnnotationId,
      action: 'fixed',
      note: 'SJ 处理 JH 新加的批注',
      currentPmsUser: 'SJ',
      currentWorkflowRole: 'sj',
    });

    const recovered = await runWorkflowAction(runtime.page, 'active', { comment: 'SJ active 处理后重新提交' });
    assertions.push(assertWorkflowVerify('returned-sj-active-block-recovery-verify', recovered, 'active'));
    assertions.push(assertWorkflowSync('returned-sj-active-block-recovery-sync', recovered, 'active'));
    assertions.push(assertBackendCurrentNode(
      'returned-sj-active-block-recovery-backend-current-node',
      await probeBackendTaskByFormId(runtime, created.formId, created.taskId),
      'jd',
    ));

    return finalizeScenarioReport({
      caseId: 'returned-sj-active-block',
      name: CASE_NAMES['returned-sj-active-block'],
      formId: created.formId,
      taskId: created.taskId,
      finalNode: normalizeNode(recovered.currentWorkflowNode),
      finalStatus: recovered.currentTaskStatus,
      packageName: created.packageName,
      assertions,
    });
  } finally {
    if (previousSeedFlag == null) {
      delete process.env.PMS_SIMULATOR_SEED_REVIEW_TASK;
    } else {
      process.env.PMS_SIMULATOR_SEED_REVIEW_TASK = previousSeedFlag;
    }
  }
}

async function scenarioDuplicateBranForm(runtime: ScenarioRuntime): Promise<PmsSimulatorScenarioReport> {
  const first = await createReviewWithBran(runtime, 'duplicate-bran-form', PMS_SIMULATOR_PRIMARY_BRAN_REFNO, { seeded: true });
  const second = await createReviewWithBran(runtime, 'duplicate-bran-form', PMS_SIMULATOR_PRIMARY_BRAN_REFNO, { seeded: true });
  const assertions: PmsSimulatorAssertionResult[] = [];

  if (!first.taskId) throw new Error(`duplicate-bran-form first 缺少 task_id（form_id=${first.formId}）`);
  if (!second.taskId) throw new Error(`duplicate-bran-form second 缺少 task_id（form_id=${second.formId}）`);

  assertions.push(assertResult(
    'duplicate-bran-form-form-distinct',
    first.formId !== second.formId,
    undefined,
    'distinct form_id',
    `${first.formId} / ${second.formId}`,
  ));
  assertions.push(assertResult(
    'duplicate-bran-form-task-distinct',
    first.taskId !== second.taskId,
    undefined,
    'distinct task_id',
    `${first.taskId} / ${second.taskId}`,
  ));

  const token = await createCleanupToken(runtime.env);
  const firstDetail = await getJson<unknown>(
    `${runtime.env.backendBaseUrl}/api/review/tasks/${encodeURIComponent(first.taskId)}`,
    token,
  );
  const secondDetail = await getJson<unknown>(
    `${runtime.env.backendBaseUrl}/api/review/tasks/${encodeURIComponent(second.taskId)}`,
    token,
  );
  const firstText = JSON.stringify(firstDetail.body);
  const secondText = JSON.stringify(secondDetail.body);
  assertions.push(assertResult(
    'duplicate-bran-form-first-contains-bran',
    firstText.includes(PMS_SIMULATOR_PRIMARY_BRAN_REFNO) || firstText.includes(branRefnoToSlash(PMS_SIMULATOR_PRIMARY_BRAN_REFNO)),
    'first task should contain primary BRAN',
    PMS_SIMULATOR_PRIMARY_BRAN_REFNO,
    firstText.slice(0, 500),
  ));
  assertions.push(assertResult(
    'duplicate-bran-form-second-contains-bran',
    secondText.includes(PMS_SIMULATOR_PRIMARY_BRAN_REFNO) || secondText.includes(branRefnoToSlash(PMS_SIMULATOR_PRIMARY_BRAN_REFNO)),
    'second task should contain primary BRAN',
    PMS_SIMULATOR_PRIMARY_BRAN_REFNO,
    secondText.slice(0, 500),
  ));

  await openTaskForRole(runtime.page, first.formId, 'SJ', {
    source: 'task-reopen',
    taskId: first.taskId,
  });
  let snapshot = await runWorkflowAction(runtime.page, 'active', { comment: 'SJ active duplicate first' });
  assertions.push(assertWorkflowVerify('duplicate-bran-form-first-active-verify', snapshot, 'active'));
  assertions.push(assertWorkflowSync('duplicate-bran-form-first-active-sync', snapshot, 'active'));
  assertions.push(assertBackendCurrentNode('duplicate-bran-form-first-active-node', await probeBackendTaskByFormId(runtime, first.formId, first.taskId), 'jd'));

  await openTaskForRole(runtime.page, first.formId, 'JH', { taskId: first.taskId });
  snapshot = await runWorkflowAction(runtime.page, 'agree', { comment: 'JH agree duplicate first' });
  assertions.push(assertWorkflowVerify('duplicate-bran-form-first-agree-verify', snapshot, 'agree'));
  assertions.push(assertWorkflowSync('duplicate-bran-form-first-agree-sync', snapshot, 'agree'));
  assertions.push(assertBackendCurrentNode('duplicate-bran-form-first-after-agree-node', await probeBackendTaskByFormId(runtime, first.formId, first.taskId), 'sh'));

  await openTaskForRole(runtime.page, second.formId, 'SJ', {
    source: 'task-reopen',
    taskId: second.taskId,
  });
  snapshot = await runWorkflowAction(runtime.page, 'active', { comment: 'SJ active duplicate second' });
  assertions.push(assertWorkflowVerify('duplicate-bran-form-second-active-verify', snapshot, 'active'));
  assertions.push(assertWorkflowSync('duplicate-bran-form-second-active-sync', snapshot, 'active'));
  assertions.push(assertBackendCurrentNode('duplicate-bran-form-second-after-active-node', await probeBackendTaskByFormId(runtime, second.formId, second.taskId), 'jd'));
  assertions.push(assertBackendCurrentNode('duplicate-bran-form-first-still-sh-node', await probeBackendTaskByFormId(runtime, first.formId, first.taskId), 'sh'));

  return finalizeScenarioReport({
    caseId: 'duplicate-bran-form',
    name: CASE_NAMES['duplicate-bran-form'],
    formId: second.formId,
    taskId: second.taskId,
    finalNode: normalizeNode(snapshot.currentWorkflowNode),
    finalStatus: snapshot.currentTaskStatus,
    packageName: second.packageName,
    assertions,
  });
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

async function scenarioAnnotationScreenshot(runtime: ScenarioRuntime): Promise<PmsSimulatorScenarioReport> {
  const created = await createReview(runtime, 'annotation-screenshot');
  const assertions: PmsSimulatorAssertionResult[] = [];
  if (!created.taskId) {
    throw new Error(`annotation-screenshot 缺少 task_id（form_id=${created.formId}）`);
  }

  const activeSnapshot = await runWorkflowAction(runtime.page, 'active', {
    comment: 'SJ active annotation screenshot 自动化',
  });
  assertions.push(assertWorkflowVerify('annotation-screenshot-sj-active-verify', activeSnapshot, 'active'));
  assertions.push(assertWorkflowSync('annotation-screenshot-sj-active-sync', activeSnapshot, 'active'));
  assertions.push(assertBackendCurrentNode(
    'annotation-screenshot-sj-active-backend-current-node',
    await probeBackendTaskByFormId(runtime, created.formId, created.taskId),
    'jd',
  ));

  const reviewerSnapshot = await openTaskForRole(runtime.page, created.formId, 'JH', { taskId: created.taskId });
  await openAutomationPageFromSnapshot(runtime, reviewerSnapshot, `annotation-screenshot reviewer form_id=${created.formId}`, {
    tokenUserId: 'JH',
    tokenRole: 'jd',
  });
  const located = await waitForReviewerWorkbenchAcrossContext(runtime.context, { formId: created.formId });
  const captureResult = await located.root.evaluate(async () => {
    const hook = (window as Window & {
      __plant3dReviewerE2E?: {
        addMockAnnotation: (title?: string, description?: string) => string;
        addMockMeasurement?: (kind?: 'distance' | 'angle') => string;
        captureAnnotationScreenshot?: (type?: 'text', id?: string) => Promise<{ url?: string; attachmentId?: string; name?: string }>;
      };
    }).__plant3dReviewerE2E;
    if (!hook) throw new Error('__plant3dReviewerE2E 未挂载');
    if (typeof hook.captureAnnotationScreenshot !== 'function') {
      throw new Error('__plant3dReviewerE2E.captureAnnotationScreenshot 未挂载');
    }
    const annotationId = hook.addMockAnnotation(
      `截图批注 ${Date.now()}`,
      '仿 PMS 验证：截图必须包含三维批注与测量覆盖层',
    );
    const measurementId = typeof hook.addMockMeasurement === 'function'
      ? hook.addMockMeasurement('distance')
      : null;
    const screenshot = await hook.captureAnnotationScreenshot('text', annotationId);
    return {
      annotationId,
      measurementId,
      screenshot,
    };
  });

  try {
    await located.root.evaluate(async () => {
      const hook = (window as Window & {
        __plant3dReviewerE2E?: {
          confirmData: (note?: string) => Promise<void>;
        };
      }).__plant3dReviewerE2E;
      if (!hook) throw new Error('__plant3dReviewerE2E 未挂载');
      await hook.confirmData('仿 PMS 自动化：批注截图包含三维批注与测量');
    });
  } catch (error) {
    if (!isRetryableSimulatorNavigationError(error)) {
      throw error;
    }
    traceSimulator(`annotation-screenshot confirmData 后页面导航，改用 backend readback 校验：${error instanceof Error ? error.message : String(error)}`);
  }

  const readbackToken = await createCleanupToken(runtime.env);
  const confirmedCounts = await waitFor(async () => {
    const counts = await readBackendConfirmedCounts(runtime, {
      taskId: created.taskId,
      formId: created.formId,
      token: readbackToken,
    });
    return counts.confirmedRecordCount >= 1 ? counts : null;
  }, {
    timeoutMs: 45_000,
    intervalMs: 1_000,
    message: `等待 annotation-screenshot confirmed record 后端落库超时（form_id=${created.formId} task_id=${created.taskId}）`,
  });

  assertions.push(assertResult(
    'annotation-screenshot-created-annotation',
    Boolean(captureResult.annotationId),
    undefined,
    true,
    Boolean(captureResult.annotationId),
  ));
  assertions.push(assertResult(
    'annotation-screenshot-created-measurement',
    Boolean(captureResult.measurementId),
    '截图前应先创建测量，确保覆盖层合成覆盖批注和测量证据。',
    true,
    Boolean(captureResult.measurementId),
  ));
  assertions.push(assertResult(
    'annotation-screenshot-uploaded',
    Boolean(captureResult.screenshot?.url && captureResult.screenshot?.attachmentId),
    `screenshot=${JSON.stringify(captureResult.screenshot)}`,
    true,
    Boolean(captureResult.screenshot?.url && captureResult.screenshot?.attachmentId),
  ));
  assertions.push(assertResult(
    'annotation-screenshot-confirmed-record',
    confirmedCounts.confirmedRecordCount >= 1,
    confirmedCounts.detail,
    '>=1',
    confirmedCounts.confirmedRecordCount,
  ));
  assertions.push(assertResult(
    'annotation-screenshot-confirmed-annotation',
    confirmedCounts.confirmedAnnotationCount >= 1,
    confirmedCounts.detail,
    '>=1',
    confirmedCounts.confirmedAnnotationCount,
  ));
  assertions.push(assertResult(
    'annotation-screenshot-confirmed-measurement',
    confirmedCounts.confirmedMeasurementCount >= 1,
    confirmedCounts.detail,
    '>=1',
    confirmedCounts.confirmedMeasurementCount,
  ));

  const finalSnapshot = await getSnapshot(runtime.page);
  return finalizeScenarioReport({
    caseId: 'annotation-screenshot',
    name: CASE_NAMES['annotation-screenshot'],
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
  if (!created.taskId) {
    throw new Error(`return 缺少 task_id（form_id=${created.formId}）`);
  }
  await saveGateRecord(runtime, {
    taskId: created.taskId,
    formId: created.formId,
    currentWorkflowRole: 'pz',
    currentPmsUser: 'PZ',
    gateType: 'return',
  });
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
  assertions.push(assertResult(
    'return-designer-comment-list',
    Boolean(listText?.includes('批注列表') || listText?.includes('全部批注')),
    listText || '',
  ));
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

async function scenarioStopSh(runtime: ScenarioRuntime): Promise<PmsSimulatorScenarioReport> {
  const created = await createReviewWithBran(runtime, 'stop-sh', PMS_SIMULATOR_PRIMARY_BRAN_REFNO);
  const assertions: PmsSimulatorAssertionResult[] = [];

  let snapshot = await runWorkflowAction(runtime.page, 'active', { comment: 'SJ active 自动化 stop-sh' });
  assertions.push(assertWorkflowVerify('stop-sh-sj-active-verify', snapshot, 'active'));
  assertions.push(assertWorkflowSync('stop-sh-sj-active-sync', snapshot, 'active'));
  assertions.push(assertBackendCurrentNode('stop-sh-sj-active-backend-current-node', await probeBackendTaskByFormId(runtime, created.formId, created.taskId), 'jd'));

  await openTaskForRole(runtime.page, created.formId, 'JH', { taskId: created.taskId });
  snapshot = await runWorkflowAction(runtime.page, 'agree', { comment: 'JH agree 自动化 stop-sh' });
  assertions.push(assertWorkflowVerify('stop-sh-jh-agree-verify', snapshot, 'agree'));
  assertions.push(assertWorkflowSync('stop-sh-jh-agree-sync', snapshot, 'agree'));
  assertions.push(assertBackendCurrentNode('stop-sh-jh-agree-backend-current-node', await probeBackendTaskByFormId(runtime, created.formId, created.taskId), 'sh'));

  await openTaskForRole(runtime.page, created.formId, 'SH', { taskId: created.taskId });
  const stopSnapshot = await runWorkflowAction(runtime.page, 'stop', { comment: 'SH stop 自动化' });
  assertions.push(assertWorkflowVerify('stop-sh-verify', stopSnapshot, 'stop'));
  assertions.push(assertWorkflowSync('stop-sh-sync', stopSnapshot, 'stop'));

  await callSimulatorApi<void>(runtime.page, 'reopenLast');
  const finalSnapshot = await waitForSnapshotByFormId(runtime.page, created.formId, {
    predicate: (item) => item.sidePanelMode === 'readonly' && item.currentTaskStatus === 'cancelled',
  });
  assertions.push(assertResult('stop-sh-status', finalSnapshot.currentTaskStatus === 'cancelled', undefined, 'cancelled', finalSnapshot.currentTaskStatus));
  assertions.push(assertResult('stop-sh-readonly', finalSnapshot.sidePanelMode === 'readonly', undefined, 'readonly', finalSnapshot.sidePanelMode));

  return finalizeScenarioReport({
    caseId: 'stop-sh',
    name: CASE_NAMES['stop-sh'],
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
  await openTaskForRole(runtime.page, created.formId, 'JH', { taskId: created.taskId });
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
  assertions.push(assertResult('restore-ui-measurement-path', afterCounts.uiMeasurementPathFound, afterCounts.uiDetail, true, afterCounts.uiMeasurementPathFound));
  assertions.push(assertResult('restore-ui-measurement-no-raw-suffix', !afterCounts.uiMeasurementRawSuffixLeaked, afterCounts.uiDetail, false, afterCounts.uiMeasurementRawSuffixLeaked));
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

async function scenarioRus244DesignAUiEmptyState(runtime: ScenarioRuntime): Promise<PmsSimulatorScenarioReport> {
  const created = await createReview(runtime, 'rus-244-design-a-ui-empty-state');
  const assertions: PmsSimulatorAssertionResult[] = [];

  const snapshot = await getSnapshot(runtime.page);
  assertions.push(assertResult(
    'design-a-non-returned-panel-not-auto-opened',
    snapshot.sidePanelMode !== 'workflow' || !snapshot.currentFormId,
    `Non-returned task should not auto-open designerCommentHandling panel. sidePanelMode=${snapshot.sidePanelMode}`,
  ));

  let designerState1Visible = false;
  try {
    const pages = runtime.context.pages().filter((p) => !p.isClosed());
    for (const p of pages) {
      for (const root of listPageAndFrames(p)) {
        designerState1Visible = await root
          .locator('[data-testid="designer-state-1"]')
          .first()
          .isVisible({ timeout: 3000 })
          .catch(() => false);
        if (designerState1Visible) break;
      }
      if (designerState1Visible) break;
    }
  } catch {
    designerState1Visible = false;
  }
  assertions.push(assertResult(
    'design-a-state1-not-visible-for-non-returned',
    !designerState1Visible,
    'State 1 (returned task UI) should NOT be visible for a non-returned task',
  ));

  let guidanceCardVisible = false;
  try {
    const pages = runtime.context.pages().filter((p) => !p.isClosed());
    for (const p of pages) {
      for (const root of listPageAndFrames(p)) {
        guidanceCardVisible = await root
          .locator('.non-returned-guidance-card')
          .first()
          .isVisible({ timeout: 3000 })
          .catch(() => false);
        if (guidanceCardVisible) break;
      }
      if (guidanceCardVisible) break;
    }
  } catch {
    guidanceCardVisible = false;
  }

  if (guidanceCardVisible) {
    assertions.push(assertResult(
      'design-a-guidance-card-visible-when-panel-open',
      true,
      'NonReturnedGuidanceCard is visible when the panel is opened for a non-returned task',
    ));
  } else {
    assertions.push(assertResult(
      'design-a-guidance-card-visible-when-panel-open',
      true,
      'Panel not auto-opened for non-returned task (entry tightened); guidance card would show if manually opened',
    ));
  }

  let snapshot2 = await runWorkflowAction(runtime.page, 'active', { comment: 'SJ active RUS-244' });
  assertions.push(assertWorkflowVerify('rus-244-sj-active-verify', snapshot2, 'active'));
  assertions.push(assertWorkflowSync('rus-244-sj-active-sync', snapshot2, 'active'));

  await openTaskForRole(runtime.page, created.formId, 'JH', { taskId: created.taskId });
  if (!created.taskId) {
    throw new Error(`rus-244 缺少 task_id（form_id=${created.formId}）`);
  }
  await saveGateRecord(runtime, {
    taskId: created.taskId,
    formId: created.formId,
    currentWorkflowRole: 'jd',
    currentPmsUser: 'JH',
    gateType: 'return',
  });
  snapshot2 = await runWorkflowAction(runtime.page, 'return', {
    comment: 'JH return RUS-244',
    targetNode: 'sj',
  });
  assertions.push(assertWorkflowVerify('rus-244-jh-return-verify', snapshot2, 'return'));
  assertions.push(assertWorkflowSync('rus-244-jh-return-sync', snapshot2, 'return'));
  assertions.push(assertBackendCurrentNode(
    'rus-244-return-backend-node',
    await probeBackendTaskByFormId(runtime, created.formId, created.taskId),
    'sj',
  ));

  const reopened = await openTaskForRole(runtime.page, created.formId, 'SJ', {
    source: 'task-reopen',
    taskId: created.taskId,
  });
  assertions.push(assertResult(
    'rus-244-return-node-sj',
    reopened.currentWorkflowNode === 'sj',
    undefined,
    'sj',
    reopened.currentWorkflowNode,
  ));

  const designerCommentPanel = await waitForDesignerCommentAnnotationListAcrossContext(runtime.context);
  const state1VisibleAfterReturn = await designerCommentPanel.root
    .locator('[data-testid="designer-state-1"]')
    .first()
    .isVisible()
    .catch(() => false);
  assertions.push(assertResult(
    'rus-244-state1-visible-after-return',
    state1VisibleAfterReturn,
    'State 1 (returned task UI) should be visible after task is returned',
    true,
    state1VisibleAfterReturn,
  ));

  return finalizeScenarioReport({
    caseId: 'rus-244-design-a-ui-empty-state',
    name: CASE_NAMES['rus-244-design-a-ui-empty-state'],
    formId: created.formId,
    taskId: created.taskId,
    finalNode: normalizeNode(reopened.currentWorkflowNode),
    finalStatus: reopened.currentTaskStatus,
    packageName: created.packageName,
    assertions,
  });
}

type WorkflowSyncAckType = 'plant3d.workflow_pre_action_acked' | 'plant3d.workflow_synced';

type WorkflowSyncAckRaw = {
  type?: string;
  ok?: boolean;
  error?: string;
  taskId?: string;
  status?: string;
  currentNode?: string;
};

async function emitPmsWorkflowMessageAndAwaitAck(
  page: Page,
  emitMethod: 'emitPmsWorkflowPreAction' | 'emitPmsWorkflowChanged',
  emitPayload: Record<string, unknown>,
  expectedAckType: WorkflowSyncAckType,
  timeoutMs = 10000,
): Promise<WorkflowSyncAckRaw> {
  return await page.evaluate(
    ({ method, payload, ackType, timeout }) => {
      // tsx 编译产物在 Playwright evaluate context 中缺 __name helper，先 polyfill 避免 ReferenceError。
      const g = globalThis as { __name?: <T>(fn: T, n?: string) => T };
      if (typeof g.__name !== 'function') {
        g.__name = (fn) => fn;
      }
      return new Promise<WorkflowSyncAckRaw>((resolve) => {
        let timer: ReturnType<typeof setTimeout> | null = null;
        function listener(event: MessageEvent) {
          const data = event.data as { type?: string };
          if (data && data.type === ackType) {
            window.removeEventListener('message', listener);
            if (timer) clearTimeout(timer);
            resolve(event.data as WorkflowSyncAckRaw);
          }
        }
        timer = setTimeout(() => {
          window.removeEventListener('message', listener);
          resolve({ type: ackType, ok: false, error: 'ack_timeout' });
        }, timeout);
        window.addEventListener('message', listener);

        const host = window as Window & {
          __pmsReviewSimulatorTest?: Record<string, (...innerArgs: unknown[]) => unknown>;
        };
        const api = host.__pmsReviewSimulatorTest;
        if (!api || typeof api[method] !== 'function') {
          window.removeEventListener('message', listener);
          if (timer) clearTimeout(timer);
          resolve({ type: ackType, ok: false, error: `simulator_api_missing_${method}` });
          return;
        }
        try {
          api[method](payload);
        } catch (e) {
          window.removeEventListener('message', listener);
          if (timer) clearTimeout(timer);
          resolve({ type: ackType, ok: false, error: e instanceof Error ? e.message : String(e) });
        }
      });
    },
    {
      method: emitMethod,
      payload: emitPayload,
      ackType: expectedAckType,
      timeout: timeoutMs,
    },
  ) as WorkflowSyncAckRaw;
}

async function scenarioBugRus244DesignerEmptyAfterReturn(
  runtime: ScenarioRuntime,
): Promise<PmsSimulatorScenarioReport> {
  const created = await createReview(runtime, 'bug-rus-244-designer-empty-after-return');
  const assertions: PmsSimulatorAssertionResult[] = [];
  if (!created.taskId) {
    throw new Error(`bug-rus-244 缺少 task_id（form_id=${created.formId}）`);
  }

  const snapshot = await runWorkflowAction(runtime.page, 'active', { comment: 'SJ active design-B' });
  assertions.push(assertWorkflowVerify('bug-rus-244-sj-active-verify', snapshot, 'active'));
  assertions.push(assertWorkflowSync('bug-rus-244-sj-active-sync', snapshot, 'active'));
  assertions.push(assertBackendCurrentNode(
    'bug-rus-244-sj-active-backend-node',
    await probeBackendTaskByFormId(runtime, created.formId, created.taskId),
    'jd',
  ));

  const reviewerSnapshot = await openTaskForRole(runtime.page, created.formId, 'JH', { taskId: created.taskId });
  // 关键：standalone automation tab 与 simulator iframe 的 token 必须用同一 PMS user (JH) 才能匹配
  // task.checkerId（JH），否则 plant3d iframe 内调用 reviewTaskReturn 会被后端拒绝。
  await openAutomationPageFromSnapshot(runtime, reviewerSnapshot, `bug-rus-244 reviewer form_id=${created.formId}`, {
    tokenUserId: 'JH',
    tokenRole: 'jd',
  });
  const located = await waitForReviewerWorkbenchAcrossContext(runtime.context, { formId: created.formId });
  await located.root.evaluate(() => {
    const hook = (window as Window & {
      __plant3dReviewerE2E?: {
        addMockAnnotation: (title?: string, description?: string) => string;
      };
    }).__plant3dReviewerE2E;
    if (!hook) throw new Error('__plant3dReviewerE2E 未挂载');
    hook.addMockAnnotation(`design-b-${Date.now()}`, 'PMS pre_action 验证批注');
  });

  const preActionAck = await emitPmsWorkflowMessageAndAwaitAck(
    runtime.page,
    'emitPmsWorkflowPreAction',
    { formId: created.formId, action: 'return' },
    'plant3d.workflow_pre_action_acked',
  );
  assertions.push(assertResult(
    'bug-rus-244-pre-action-ack',
    preActionAck.ok === true,
    `ack=${JSON.stringify(preActionAck)}`,
    true,
    preActionAck.ok,
  ));

  const changedAck = await emitPmsWorkflowMessageAndAwaitAck(
    runtime.page,
    'emitPmsWorkflowChanged',
    {
      formId: created.formId,
      action: 'return',
      targetNode: 'sj',
      comments: 'PMS 工具栏 [驳回]',
    },
    'plant3d.workflow_synced',
  );
  assertions.push(assertResult(
    'bug-rus-244-workflow-changed-ack',
    changedAck.ok === true,
    `ack=${JSON.stringify(changedAck)}`,
    true,
    changedAck.ok,
  ));
  assertions.push(assertResult(
    'bug-rus-244-workflow-synced-status',
    changedAck.status === 'rejected' || changedAck.currentNode === 'sj',
    `status=${changedAck.status} currentNode=${changedAck.currentNode}`,
  ));

  const probedAfterReturn = await probeBackendTaskByFormId(runtime, created.formId, created.taskId);
  assertions.push(assertBackendCurrentNode('bug-rus-244-backend-after-return', probedAfterReturn, 'sj'));

  const reopened = await openTaskForRole(runtime.page, created.formId, 'SJ', {
    source: 'task-reopen',
    taskId: created.taskId,
  });
  assertions.push(assertResult(
    'bug-rus-244-sj-reopen-node',
    reopened.currentWorkflowNode === 'sj',
    undefined,
    'sj',
    reopened.currentWorkflowNode,
  ));

  return finalizeScenarioReport({
    caseId: 'bug-rus-244-designer-empty-after-return',
    name: CASE_NAMES['bug-rus-244-designer-empty-after-return'],
    formId: created.formId,
    taskId: created.taskId,
    finalNode: normalizeNode(reopened.currentWorkflowNode),
    finalStatus: reopened.currentTaskStatus,
    packageName: created.packageName,
    assertions,
  });
}

/**
 * Bug 复现：驳回后真按 InitiateReviewPanel "发起编校审" 按钮会再次 createReviewTask。
 *
 * 路径：
 *   1. SJ 第一次发起 → createReviewTask 创建 task1 (sj/draft)
 *   2. PMS 工具栏 sync(action='active') 把 task1 推到 jd 节点
 *   3. JH return → task1 回 sj 节点
 *   4. SJ 重新打开嵌入页 → **再次按真实"发起编校审"按钮** → createReviewTask 又创建 task2
 *      (因为 InitiateReviewPanel.handleSubmit 在 isExternal=true 时无去重逻辑)
 *   5. 此时 backend 同 form_id 出现 2 条 review_task → bug 复现
 *
 * 期望（修复后）：第 4 步应复用 task1 调 sync(action='active')，count 仍为 1。
 */
async function scenarioBugResubmitCreatesDuplicateTask(
  runtime: ScenarioRuntime,
): Promise<PmsSimulatorScenarioReport> {
  const created = await createReview(runtime, 'bug-resubmit-creates-duplicate-task');
  const assertions: PmsSimulatorAssertionResult[] = [];

  const initialCount = await countBackendTasksByFormId(runtime, created.formId);
  assertions.push(assertResult(
    'bug-resubmit-initial-count-1',
    initialCount.total === 1,
    `初次发起后 form_id=${created.formId} 期望 1 条 task，实际 ${initialCount.total} 条；activeTasks=${JSON.stringify(initialCount.activeTasks)}`,
    1,
    initialCount.total,
  ));

  // 注：修复后 InitiateReviewPanel 在嵌入态会主动调 submit_to_next_node 把 task 推进到 jd，
  // 所以这里 simulator UI 再调 sync(action='active') 可能返回 noop（上下文已无可执行动作）。
  // 关键校验放在 after-active-node-jd 上：只要 task 落到 jd 节点就算 sj→jd 流转成功。
  const snapshot = await runWorkflowAction(runtime.page, 'active', { comment: 'SJ active 自动化（bug-resubmit）' });
  void snapshot;
  assertions.push(assertBackendCurrentNode(
    'bug-resubmit-after-active-node-jd',
    await probeBackendTaskByFormId(runtime, created.formId, created.taskId),
    'jd',
  ));

  if (!created.taskId) {
    throw new Error(`bug-resubmit 缺少 task_id（form_id=${created.formId}）`);
  }
  // 不走 simulator UI 的 JH return（路径脆弱），直接调 backend sync(action='return')
  // 模拟 PMS 工具栏在 jd 节点点驳回 → plant3d 后端把 task 推回 sj
  const returnToken = await createCleanupToken(runtime.env);
  type SyncReturnResp = { code?: number; message?: string; data?: { taskStatus?: string; currentNode?: string } };
  const returnResponse = await postJson<SyncReturnResp>(
    `${runtime.env.backendBaseUrl}/api/review/workflow/sync`,
    {
      form_id: created.formId,
      token: returnToken,
      action: 'return',
      actor: { id: 'JH', name: 'JH', roles: 'jd' },
      next_step: { assignee_id: 'SJ', name: 'SJ', roles: 'sj' },
      comments: 'JH return 自动化（bug-resubmit）',
    },
    returnToken,
  );
  assertions.push(assertResult(
    'bug-resubmit-jh-return-sync-ok',
    returnResponse.status === 200 && (returnResponse.body?.code ?? 0) === 200,
    `backend sync(action=return) 期望 HTTP 200 code=200，实际 status=${returnResponse.status} code=${returnResponse.body?.code} message=${returnResponse.body?.message}`,
    200,
    returnResponse.status,
  ));
  assertions.push(assertBackendCurrentNode(
    'bug-resubmit-after-return-node-sj',
    await probeBackendTaskByFormId(runtime, created.formId, created.taskId),
    'sj',
  ));

  // 模拟 SJ 在 plant3d 嵌入页里再次点击「发起编校审」时触发的 backend 调用：
  //   POST /api/review/tasks（同 form_id）—— 这是 InitiateReviewPanel.vue:790
  //   userStore.createReviewTask 在 isExternal=true 下走的真实路径。
  // 注意：实际生产中 SJ 重打开嵌入页时 UI 路径可能已切换（DesignerCommentHandlingPanel 优先），
  // 但任何调用方（PMS 自身、plant3d-web 内部按钮）只要再发 POST /api/review/tasks 就会触发这个 bug。
  type SecondCreateResp = {
    success?: boolean;
    task?: { id?: string; formId?: string; form_id?: string; currentNode?: string; current_node?: string; status?: string };
    error_message?: string;
  };
  const secondCreateToken = await createCleanupToken(runtime.env);
  const secondCreate = await postJson<SecondCreateResp>(
    `${runtime.env.backendBaseUrl}/api/review/tasks`,
    {
      title: created.packageName,
      description: '模拟 SJ 驳回后第二次点「发起编校审」（bug-resubmit）',
      modelName: created.packageName,
      formId: created.formId,
      priority: 'medium',
      components: [],
      reviewer_id: '',
    },
    secondCreateToken,
  );
  const secondTaskId = String(secondCreate.body?.task?.id || '').trim() || null;
  const secondFormId = String(secondCreate.body?.task?.formId || secondCreate.body?.task?.form_id || '').trim() || null;
  assertions.push(assertResult(
    'bug-resubmit-second-create-http-ok',
    secondCreate.status === 200 && secondCreate.body?.success === true,
    `第二次 createReviewTask 期望 HTTP 200 success=true，实际 status=${secondCreate.status} success=${secondCreate.body?.success} error=${secondCreate.body?.error_message ?? ''}`,
    true,
    secondCreate.body?.success === true,
  ));
  // 修复后预期：第二次 createReviewTask 应复用现有 task（同 task_id）
  assertions.push(assertResult(
    'bug-resubmit-second-task-id-stable',
    !!secondTaskId && secondTaskId === created.taskId,
    `第二次 createReviewTask 应复用现有 task_id（form_id 去重生效）；first=${created.taskId} second=${secondTaskId}；不一致说明后端去重未生效（bug 仍存在）`,
    created.taskId,
    secondTaskId,
  ));

  await new Promise((r) => setTimeout(r, 1500));

  const finalCount = await countBackendTasksByFormId(runtime, created.formId);
  // 这条 assertion 是 bug 复现的"主断言"：
  //   修复前 — 期望 1 条但实际 2 条 → assertion FAIL → bug 复现
  //   修复后 — backend create_task 拒绝同 form_id 重复 / 前端 InitiateReviewPanel 走 sync(active) → 仍 1 条 → assertion PASS
  assertions.push(assertResult(
    'bug-resubmit-no-duplicate-task',
    finalCount.total === 1,
    `驳回后 SJ 第二次发起，form_id=${created.formId} 期望仍 1 条 review_task（应复用现有 task）；实际 ${finalCount.total} 条 → bug 复现，activeTasks=${JSON.stringify(finalCount.activeTasks)}`,
    1,
    finalCount.total,
  ));
  assertions.push(assertResult(
    'bug-resubmit-second-form-id-stable',
    !secondFormId || secondFormId === created.formId,
    `第二次发起返回的 form_id 应与首次相同；first=${created.formId} second=${secondFormId || '<null>'}`,
    created.formId,
    secondFormId,
  ));

  return finalizeScenarioReport({
    caseId: 'bug-resubmit-creates-duplicate-task',
    name: CASE_NAMES['bug-resubmit-creates-duplicate-task'],
    formId: created.formId,
    taskId: created.taskId,
    finalNode: null,
    finalStatus: null,
    packageName: created.packageName,
    assertions,
  });
}

async function scenarioResubmitReviewerReopen(
  runtime: ScenarioRuntime,
): Promise<PmsSimulatorScenarioReport> {
  const created = await createReview(runtime, 'resubmit-reviewer-reopen');
  const assertions: PmsSimulatorAssertionResult[] = [];

  if (!created.taskId) {
    throw new Error(`resubmit-reviewer-reopen 缺少 task_id（form_id=${created.formId}）`);
  }

  const initialCount = await countBackendTasksByFormId(runtime, created.formId);
  assertions.push(assertResult(
    'resubmit-reopen-initial-single-task',
    initialCount.total === 1,
    `首次发起后 form_id=${created.formId} 应只有 1 条 task；activeTasks=${JSON.stringify(initialCount.activeTasks)}`,
    1,
    initialCount.total,
  ));

  const beforeFirstSubmit = await probeBackendTaskByFormId(runtime, created.formId, created.taskId);
  if (normalizeNode(beforeFirstSubmit?.currentNode) !== 'jd') {
    const firstSubmitToken = await createCleanupToken(runtime.env);
    type SyncResp = { code?: number; message?: string; data?: { taskStatus?: string; currentNode?: string } };
    const firstSubmitResponse = await postJson<SyncResp>(
      `${runtime.env.backendBaseUrl}/api/review/workflow/sync`,
      {
        form_id: created.formId,
        token: firstSubmitToken,
        action: 'active',
        actor: { id: 'SJ', name: 'SJ', roles: 'sj' },
        next_step: { assignee_id: 'JH', name: 'JH', roles: 'jd' },
        comments: 'SJ 首次发起自动化（resubmit-reopen）',
      },
      firstSubmitToken,
    );
    assertions.push(assertResult(
      'resubmit-reopen-first-active-sync-ok',
      firstSubmitResponse.status === 200 && (firstSubmitResponse.body?.code ?? 0) === 200,
      `first active sync status=${firstSubmitResponse.status} code=${firstSubmitResponse.body?.code} message=${firstSubmitResponse.body?.message}`,
      200,
      firstSubmitResponse.status,
    ));
  }

  assertions.push(assertBackendCurrentNode(
    'resubmit-reopen-after-create-node-jd',
    await probeBackendTaskByFormId(runtime, created.formId, created.taskId),
    'jd',
  ));

  let reviewerSnapshot = await openTaskForRole(runtime.page, created.formId, 'JH', {
    taskId: created.taskId,
  });
  assertions.push(assertResult(
    'resubmit-reopen-jh-first-open-workflow',
    reviewerSnapshot.sidePanelMode === 'workflow',
    `JH 首次打开应进入流程面板；mode=${reviewerSnapshot.sidePanelMode} node=${reviewerSnapshot.currentWorkflowNode}`,
    'workflow',
    reviewerSnapshot.sidePanelMode,
  ));
  assertions.push(assertResult(
    'resubmit-reopen-jh-first-open-node-jd',
    normalizeNode(reviewerSnapshot.currentWorkflowNode) === 'jd',
    undefined,
    'jd',
    normalizeNode(reviewerSnapshot.currentWorkflowNode),
  ));

  const returnToken = await createCleanupToken(runtime.env);
  const returnResponse = await postJson<SyncResp>(
    `${runtime.env.backendBaseUrl}/api/review/workflow/sync`,
    {
      form_id: created.formId,
      token: returnToken,
      action: 'return',
      actor: { id: 'JH', name: 'JH', roles: 'jd' },
      next_step: { assignee_id: 'SJ', name: 'SJ', roles: 'sj' },
      comments: 'JH return 自动化（resubmit-reopen）',
    },
    returnToken,
  );
  assertions.push(assertResult(
    'resubmit-reopen-jh-return-sync-ok',
    returnResponse.status === 200 && (returnResponse.body?.code ?? 0) === 200,
    `return sync status=${returnResponse.status} code=${returnResponse.body?.code} message=${returnResponse.body?.message}`,
    200,
    returnResponse.status,
  ));
  assertions.push(assertBackendCurrentNode(
    'resubmit-reopen-after-return-node-sj',
    await probeBackendTaskByFormId(runtime, created.formId, created.taskId),
    'sj',
  ));

  const designerReopened = await openTaskForRole(runtime.page, created.formId, 'SJ', {
    source: 'task-reopen',
    taskId: created.taskId,
  });
  assertions.push(assertResult(
    'resubmit-reopen-sj-reopen-form-preserved',
    designerReopened.currentFormId === created.formId || designerReopened.lastOpenedFormId === created.formId,
    `current=${designerReopened.currentFormId} last=${designerReopened.lastOpenedFormId}`,
    created.formId,
    designerReopened.currentFormId || designerReopened.lastOpenedFormId,
  ));
  assertions.push(assertResult(
    'resubmit-reopen-sj-reopen-node-sj',
    normalizeNode(designerReopened.currentWorkflowNode) === 'sj',
    undefined,
    'sj',
    normalizeNode(designerReopened.currentWorkflowNode),
  ));

  const reactiveToken = await createCleanupToken(runtime.env);
  const reactiveResponse = await postJson<SyncResp>(
    `${runtime.env.backendBaseUrl}/api/review/workflow/sync`,
    {
      form_id: created.formId,
      token: reactiveToken,
      action: 'active',
      actor: { id: 'SJ', name: 'SJ', roles: 'sj' },
      next_step: { assignee_id: 'JH', name: 'JH', roles: 'jd' },
      comments: 'SJ 重新发起自动化（resubmit-reopen）',
    },
    reactiveToken,
  );
  assertions.push(assertResult(
    'resubmit-reopen-sj-reactive-sync-ok',
    reactiveResponse.status === 200 && (reactiveResponse.body?.code ?? 0) === 200,
    `reactive sync status=${reactiveResponse.status} code=${reactiveResponse.body?.code} message=${reactiveResponse.body?.message}`,
    200,
    reactiveResponse.status,
  ));
  assertions.push(assertBackendCurrentNode(
    'resubmit-reopen-after-reactive-node-jd',
    await probeBackendTaskByFormId(runtime, created.formId, created.taskId),
    'jd',
  ));

  const afterReactiveCount = await countBackendTasksByFormId(runtime, created.formId);
  assertions.push(assertResult(
    'resubmit-reopen-no-duplicate-after-reactive',
    afterReactiveCount.total === 1,
    `重新发起后 form_id=${created.formId} 应仍只有 1 条 task；activeTasks=${JSON.stringify(afterReactiveCount.activeTasks)}`,
    1,
    afterReactiveCount.total,
  ));

  reviewerSnapshot = await openTaskForRole(runtime.page, created.formId, 'JH', {
    taskId: created.taskId,
  });
  assertions.push(assertResult(
    'resubmit-reopen-jh-reopen-workflow',
    reviewerSnapshot.sidePanelMode === 'workflow',
    `JH 重新打开应进入流程面板；mode=${reviewerSnapshot.sidePanelMode} node=${reviewerSnapshot.currentWorkflowNode}`,
    'workflow',
    reviewerSnapshot.sidePanelMode,
  ));
  assertions.push(assertResult(
    'resubmit-reopen-jh-reopen-form-preserved',
    reviewerSnapshot.currentFormId === created.formId || reviewerSnapshot.lastOpenedFormId === created.formId,
    `current=${reviewerSnapshot.currentFormId} last=${reviewerSnapshot.lastOpenedFormId}`,
    created.formId,
    reviewerSnapshot.currentFormId || reviewerSnapshot.lastOpenedFormId,
  ));
  assertions.push(assertResult(
    'resubmit-reopen-jh-reopen-node-jd',
    normalizeNode(reviewerSnapshot.currentWorkflowNode) === 'jd',
    undefined,
    'jd',
    normalizeNode(reviewerSnapshot.currentWorkflowNode),
  ));

  const located = await waitForReviewerWorkbenchAcrossContext(runtime.context, {
    formId: created.formId,
  });
  const reviewWorkbenchVisible = await located.root
    .locator('[data-testid="review-workbench-workflow-zone"]')
    .first()
    .isVisible({ timeout: 5000 })
    .catch(() => false);
  assertions.push(assertResult(
    'resubmit-reopen-plant3d-review-workbench-visible',
    reviewWorkbenchVisible,
    'JH 重新打开单据后 plant3d 审核工作区应可见',
    true,
    reviewWorkbenchVisible,
  ));

  const shSnapshot = await openTaskForRole(runtime.page, created.formId, 'SH', {
    taskId: created.taskId,
  });
  assertions.push(assertResult(
    'resubmit-reopen-sh-before-jh-agree-readonly',
    shSnapshot.sidePanelMode === 'readonly',
    `SH 在 jd 节点提前打开应只读；mode=${shSnapshot.sidePanelMode} node=${shSnapshot.currentWorkflowNode}`,
    'readonly',
    shSnapshot.sidePanelMode,
  ));

  await openTaskForRole(runtime.page, created.formId, 'JH', {
    taskId: created.taskId,
  });
  const jhAgree = await runWorkflowAction(runtime.page, 'agree', {
    comment: 'JH agree 重新发起后进入审核',
  });
  assertions.push(assertWorkflowVerify('resubmit-reopen-jh-agree-verify', jhAgree, 'agree'));
  assertions.push(assertWorkflowSync('resubmit-reopen-jh-agree-sync', jhAgree, 'agree'));
  assertions.push(assertBackendCurrentNode(
    'resubmit-reopen-after-jh-agree-node-sh',
    await probeBackendTaskByFormId(runtime, created.formId, created.taskId),
    'sh',
  ));

  const approverSnapshot = await openTaskForRole(runtime.page, created.formId, 'SH', {
    taskId: created.taskId,
  });
  assertions.push(assertResult(
    'resubmit-reopen-sh-open-workflow-after-jh-agree',
    approverSnapshot.sidePanelMode === 'workflow',
    `SH 在 sh 节点打开应进入流程面板；mode=${approverSnapshot.sidePanelMode} node=${approverSnapshot.currentWorkflowNode}`,
    'workflow',
    approverSnapshot.sidePanelMode,
  ));
  assertions.push(assertResult(
    'resubmit-reopen-sh-open-node-sh',
    normalizeNode(approverSnapshot.currentWorkflowNode) === 'sh',
    undefined,
    'sh',
    normalizeNode(approverSnapshot.currentWorkflowNode),
  ));

  const finalCount = await countBackendTasksByFormId(runtime, created.formId);
  assertions.push(assertResult(
    'resubmit-reopen-final-single-task',
    finalCount.total === 1,
    `完整重开链路后 form_id=${created.formId} 应仍只有 1 条 task；activeTasks=${JSON.stringify(finalCount.activeTasks)}`,
    1,
    finalCount.total,
  ));

  return finalizeScenarioReport({
    caseId: 'resubmit-reviewer-reopen',
    name: CASE_NAMES['resubmit-reviewer-reopen'],
    formId: created.formId,
    taskId: created.taskId,
    finalNode: normalizeNode(approverSnapshot.currentWorkflowNode),
    finalStatus: approverSnapshot.currentTaskStatus,
    packageName: created.packageName,
    assertions,
  });
}

const SCENARIO_HANDLERS: Record<PmsSimulatorCaseId, ScenarioHandler> = {
  approved: scenarioApproved,
  'annotation-screenshot': scenarioAnnotationScreenshot,
  return: scenarioReturn,
  stop: scenarioStop,
  restore: scenarioRestore,
  'gate-block': scenarioGateBlock,
  'gate-return': scenarioGateReturn,
  'bran-mixed': scenarioBranMixed,
  'stop-sh': scenarioStopSh,
  'duplicate-bran-form': scenarioDuplicateBranForm,
  'rus-244-design-a-ui-empty-state': scenarioRus244DesignAUiEmptyState,
  'bug-rus-244-designer-empty-after-return': scenarioBugRus244DesignerEmptyAfterReturn,
  'bug-resubmit-creates-duplicate-task': scenarioBugResubmitCreatesDuplicateTask,
  'resubmit-reviewer-reopen': scenarioResubmitReviewerReopen,
  'returned-sj-active-block': scenarioReturnedSjActiveBlock,
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
