import {
  clearAuthToken,
  getAuthToken,
  login,
  reviewTaskGetById,
  reviewTaskGetList,
  type ReviewTask,
} from '@/api/reviewApi';
import { getBackendApiBaseUrl } from '@/utils/apiBase';

type SimulatorRole = 'SJ' | 'JH' | 'SH' | 'PZ';

type WorkflowSyncResponse = {
  code?: number;
  message?: string;
  data?: {
    models?: string[];
    opinions?: unknown[];
    attachments?: unknown[];
    current_node?: string;
    currentNode?: string;
    task_status?: string;
    taskStatus?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

type WorkflowSyncAction = 'query' | 'active' | 'agree' | 'return' | 'stop';
type WorkflowMutationAction = Exclude<WorkflowSyncAction, 'query'>;

type EmbedUrlApiResponse = {
  code?: number;
  message?: string;
  data?: {
    relative_path?: string;
    relativePath?: string;
    token?: string;
    query?: {
      form_id?: string;
      formId?: string;
      is_reviewer?: boolean;
      isReviewer?: boolean;
    };
  };
  url?: string;
};

type ReviewListRow = {
  index: number;
  taskId: string;
  status: ReviewTask['status'];
  projectCode: string;
  projectName: string;
  title: string;
  version: string;
  formId: string | null;
  note: string;
  requesterName: string;
  createdDate: string;
  componentCount: number;
  task: ReviewTask;
};

type IframeSource = 'new' | 'task-view' | 'task-reopen' | 'last-form-reopen' | 'iframe-refresh-reopen';

type IframeMeta = {
  source: IframeSource;
  taskId: string | null;
  formId: string | null;
  openedAt: number;
  role: SimulatorRole;
};

type DiagnosticsState = {
  loadingTask: boolean;
  loadingWorkflow: boolean;
  taskDetail: ReviewTask | null;
  workflowSnapshot: WorkflowSyncResponse | null;
  error: string | null;
  lastRefreshedAt: number | null;
};

type SimulatorState = {
  currentRole: SimulatorRole;
  projectId: string;
  loadingList: boolean;
  listError: string | null;
  rows: ReviewListRow[];
  selectedTaskId: string | null;
  iframeUrl: string | null;
  iframeMeta: IframeMeta | null;
  embedToken: string | null;
  lastOpenedFormId: string | null;
  diagnostics: DiagnosticsState;
  workflowAction: {
    loading: boolean;
    lastAction: WorkflowMutationAction | null;
    lastOk: boolean | null;
    lastMessage: string | null;
    lastAt: number | null;
  };
};

const ROLE_CONTEXT: Record<SimulatorRole, { label: string; node: string }> = {
  SJ: { label: '编制', node: 'sj' },
  JH: { label: '校核', node: 'jd' },
  SH: { label: '审核', node: 'sh' },
  PZ: { label: '批准', node: 'pz' },
};

const STATUS_LABELS: Record<ReviewTask['status'], string> = {
  draft: '草稿',
  submitted: '待审核',
  in_review: '审核中',
  approved: '已通过',
  rejected: '已驳回',
  cancelled: '已取消',
};

const NODE_LABELS: Record<string, string> = {
  sj: '编制',
  jd: '校核',
  sh: '审核',
  pz: '批准',
};

const state: SimulatorState = {
  currentRole: 'SJ',
  projectId: resolveDefaultProjectId(),
  loadingList: false,
  listError: null,
  rows: [],
  selectedTaskId: null,
  iframeUrl: null,
  iframeMeta: null,
  embedToken: null,
  lastOpenedFormId: null,
  diagnostics: {
    loadingTask: false,
    loadingWorkflow: false,
    taskDetail: null,
    workflowSnapshot: null,
    error: null,
    lastRefreshedAt: null,
  },
  workflowAction: {
    loading: false,
    lastAction: null,
    lastOk: null,
    lastMessage: null,
    lastAt: null,
  },
};

let refs: {
  currentUserLabel: HTMLSpanElement;
  currentRoleLabel: HTMLSpanElement;
  roleButtons: HTMLDivElement;
  reopenLastBtn: HTMLButtonElement;
  lastFormLabel: HTMLSpanElement;
  createBtn: HTMLButtonElement;
  deleteBtn: HTMLButtonElement;
  editBtn: HTMLButtonElement;
  viewBtn: HTMLButtonElement;
  reopenBtn: HTMLButtonElement;
  refreshBtn: HTMLButtonElement;
  projectInput: HTMLInputElement;
  tableWrap: HTMLDivElement;
  tableSummary: HTMLSpanElement;
  modalEl: HTMLDivElement;
  modalTitle: HTMLSpanElement;
  modalReopenBtn: HTMLButtonElement;
  modalCloseBtn: HTMLButtonElement;
  iframeEl: HTMLIFrameElement;
  diagTaskBtn: HTMLButtonElement;
  diagWorkflowBtn: HTMLButtonElement;
  workflowCommentInput: HTMLTextAreaElement;
  workflowActionActiveBtn: HTMLButtonElement;
  workflowActionAgreeBtn: HTMLButtonElement;
  workflowActionReturnBtn: HTMLButtonElement;
  workflowActionStopBtn: HTMLButtonElement;
  workflowActionHint: HTMLDivElement;
  diagContent: HTMLDivElement;
};

function initRefs(): void {
  refs = {
    currentUserLabel: getEl<HTMLSpanElement>('current-user-label'),
    currentRoleLabel: getEl<HTMLSpanElement>('current-role-label'),
    roleButtons: getEl<HTMLDivElement>('role-buttons'),
    reopenLastBtn: getEl<HTMLButtonElement>('reopen-last-btn'),
    lastFormLabel: getEl<HTMLSpanElement>('last-form-label'),
    createBtn: getEl<HTMLButtonElement>('tool-create'),
    deleteBtn: getEl<HTMLButtonElement>('tool-delete'),
    editBtn: getEl<HTMLButtonElement>('tool-edit'),
    viewBtn: getEl<HTMLButtonElement>('tool-view'),
    reopenBtn: getEl<HTMLButtonElement>('tool-reopen'),
    refreshBtn: getEl<HTMLButtonElement>('tool-refresh'),
    projectInput: getEl<HTMLInputElement>('project-id-input'),
    tableWrap: getEl<HTMLDivElement>('table-wrap'),
    tableSummary: getEl<HTMLSpanElement>('table-summary'),
    modalEl: getEl<HTMLDivElement>('iframe-modal'),
    modalTitle: getEl<HTMLSpanElement>('modal-title'),
    modalReopenBtn: getEl<HTMLButtonElement>('modal-reopen-btn'),
    modalCloseBtn: getEl<HTMLButtonElement>('modal-close-btn'),
    iframeEl: getEl<HTMLIFrameElement>('review-iframe'),
    diagTaskBtn: getEl<HTMLButtonElement>('diag-task-btn'),
    diagWorkflowBtn: getEl<HTMLButtonElement>('diag-workflow-btn'),
    workflowCommentInput: getEl<HTMLTextAreaElement>('workflow-comment-input'),
    workflowActionActiveBtn: getEl<HTMLButtonElement>('workflow-action-active-btn'),
    workflowActionAgreeBtn: getEl<HTMLButtonElement>('workflow-action-agree-btn'),
    workflowActionReturnBtn: getEl<HTMLButtonElement>('workflow-action-return-btn'),
    workflowActionStopBtn: getEl<HTMLButtonElement>('workflow-action-stop-btn'),
    workflowActionHint: getEl<HTMLDivElement>('workflow-action-hint'),
    diagContent: getEl<HTMLDivElement>('diag-content'),
  };
}

function getEl<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`[pms-review-simulator] 缺少必要 DOM 节点: #${id}`);
  }
  return el as T;
}

function resolveDefaultProjectId(): string {
  const search = new URLSearchParams(window.location.search);
  return (
    search.get('project_id')?.trim() ||
    search.get('output_project')?.trim() ||
    search.get('project')?.trim() ||
    'AvevaMarineSample'
  );
}

function toYmd(timestamp: number | undefined): string {
  if (!timestamp) return '--';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '--';
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, '0');
  const d = `${date.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function toDateTime(timestamp: number | null | undefined): string {
  if (!timestamp) return '--';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '--';
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, '0');
  const d = `${date.getDate()}`.padStart(2, '0');
  const hh = `${date.getHours()}`.padStart(2, '0');
  const mm = `${date.getMinutes()}`.padStart(2, '0');
  const ss = `${date.getSeconds()}`.padStart(2, '0');
  return `${y}-${m}-${d} ${hh}:${mm}:${ss}`;
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll('\'', '&#39;');
}

function statusLabel(status: ReviewTask['status']): string {
  return STATUS_LABELS[status] || status;
}

function normalizeText(value: string | undefined | null): string {
  const trimmed = value?.trim();
  return trimmed || '--';
}

function inferVersion(task: ReviewTask): string {
  if (Array.isArray(task.workflowHistory) && task.workflowHistory.length > 0) {
    return `v${task.workflowHistory.length}`;
  }
  if (task.updatedAt) {
    const date = new Date(task.updatedAt);
    if (!Number.isNaN(date.getTime())) {
      const mm = `${date.getMonth() + 1}`.padStart(2, '0');
      const dd = `${date.getDate()}`.padStart(2, '0');
      return `r${mm}${dd}`;
    }
  }
  return '--';
}

function toListRow(task: ReviewTask, index: number): ReviewListRow {
  const projectCode = state.projectId || '--';
  const projectName = normalizeText(task.modelName || state.projectId || undefined);
  const title = normalizeText(task.title);
  const noteRaw = task.reviewComment || task.description;
  const requester = normalizeText(task.requesterName || task.requesterId);
  const formId = task.formId?.trim() || null;

  return {
    index,
    taskId: task.id,
    status: task.status,
    projectCode,
    projectName,
    title,
    version: inferVersion(task),
    formId,
    note: normalizeText(noteRaw),
    requesterName: requester,
    createdDate: toYmd(task.createdAt),
    componentCount: Array.isArray(task.components) ? task.components.length : 0,
    task,
  };
}

function getSelectedRow(): ReviewListRow | null {
  if (!state.selectedTaskId) return null;
  return state.rows.find((row) => row.taskId === state.selectedTaskId) || null;
}

function resolveWorkflowContext(): { taskId: string | null; formId: string | null } {
  const selected = getSelectedRow();
  const detail = state.diagnostics.taskDetail;
  return {
    taskId: detail?.id || selected?.taskId || state.iframeMeta?.taskId || null,
    formId: detail?.formId?.trim() || selected?.formId || state.iframeMeta?.formId || null,
  };
}

function setSelectedTask(taskId: string | null): void {
  state.selectedTaskId = taskId;
  renderTable();
  renderActionStates();
  renderDiagnostics();
}

function renderRoleHeader(): void {
  refs.currentUserLabel.textContent = `当前用户：${state.currentRole}`;
  refs.currentRoleLabel.textContent = `当前角色：${ROLE_CONTEXT[state.currentRole].label}`;
  for (const btn of refs.roleButtons) {
    const role = btn.dataset.role as SimulatorRole | undefined;
    btn.classList.toggle('active', role === state.currentRole);
    btn.disabled = state.loadingList;
  }
}

function renderLastOpened(): void {
  refs.lastFormLabel.textContent = `最近打开：${state.lastOpenedFormId || '--'}`;
  refs.reopenLastBtn.disabled = !state.lastOpenedFormId;
}

function renderWorkflowActionHint(): void {
  const context = resolveWorkflowContext();
  const hasFormId = Boolean(context.formId);
  const action = state.workflowAction.lastAction;
  const actionText = action ? `action=${action}` : '';
  const timeText = toDateTime(state.workflowAction.lastAt);
  const base = !hasFormId
    ? '请选择带 form_id 的记录后再执行流程动作。'
    : state.workflowAction.loading
      ? `正在调用 workflow/sync ${actionText || ''}...`
      : state.workflowAction.lastMessage
        ? `${actionText ? `${actionText}：` : ''}${state.workflowAction.lastMessage}（${timeText}）`
        : '可执行 workflow/sync：active / agree / return / stop。';

  refs.workflowActionHint.textContent = base;
  refs.workflowActionHint.classList.remove('ok', 'fail');
  if (state.workflowAction.loading) return;
  if (state.workflowAction.lastOk === true) {
    refs.workflowActionHint.classList.add('ok');
  } else if (state.workflowAction.lastOk === false) {
    refs.workflowActionHint.classList.add('fail');
  }
}

function renderActionStates(): void {
  const selected = getSelectedRow();
  const context = resolveWorkflowContext();
  const hasFormId = Boolean(context.formId);
  const workflowActionDisabled = !hasFormId || state.workflowAction.loading;
  refs.viewBtn.disabled = !selected;
  refs.reopenBtn.disabled = !(selected && selected.formId);
  refs.modalReopenBtn.disabled = !state.iframeMeta;
  refs.diagTaskBtn.disabled = !selected;
  refs.diagWorkflowBtn.disabled = !(selected && selected.formId);
  refs.workflowActionActiveBtn.disabled = workflowActionDisabled;
  refs.workflowActionAgreeBtn.disabled = workflowActionDisabled;
  refs.workflowActionReturnBtn.disabled = workflowActionDisabled;
  refs.workflowActionStopBtn.disabled = workflowActionDisabled;
  refs.workflowCommentInput.disabled = state.workflowAction.loading;
  renderWorkflowActionHint();
}

function renderTable(): void {
  if (state.loadingList) {
    refs.tableWrap.innerHTML = '<div class="loading">正在加载真实校审任务列表…</div>';
    refs.tableSummary.textContent = '加载中';
    return;
  }

  if (state.listError) {
    refs.tableWrap.innerHTML = `<div class="error">列表加载失败：${escapeHtml(state.listError)}</div>`;
    refs.tableSummary.textContent = '加载失败';
    return;
  }

  if (state.rows.length === 0) {
    refs.tableWrap.innerHTML = '<div class="empty">暂无可展示校审记录（真实接口返回为空）</div>';
    refs.tableSummary.textContent = '0 条记录';
    return;
  }

  const rowsHtml = state.rows
    .map((row) => {
      const selectedClass = row.taskId === state.selectedTaskId ? 'selected' : '';
      return `
        <tr class="${selectedClass}" data-task-id="${escapeHtml(row.taskId)}">
          <td>${row.index}</td>
          <td>
            <span class="status-badge status-${escapeHtml(row.status)}">${escapeHtml(statusLabel(row.status))}</span>
          </td>
          <td>${escapeHtml(row.projectCode)}</td>
          <td>${escapeHtml(row.projectName)}</td>
          <td title="${escapeHtml(row.title)}">${escapeHtml(row.title)}</td>
          <td>${escapeHtml(row.version)}</td>
          <td>${escapeHtml(row.formId || '--')}</td>
          <td title="${escapeHtml(row.note)}">${escapeHtml(row.note)}</td>
          <td>${escapeHtml(row.requesterName)}</td>
          <td>${escapeHtml(row.createdDate)}</td>
        </tr>
      `;
    })
    .join('');

  refs.tableWrap.innerHTML = `
    <table>
      <thead>
        <tr>
          <th style="min-width:58px;">序号</th>
          <th style="min-width:84px;">状态</th>
          <th style="min-width:110px;">项目代码</th>
          <th style="min-width:140px;">项目名称</th>
          <th style="min-width:180px;">标题</th>
          <th style="min-width:70px;">版本</th>
          <th style="min-width:170px;">模型表单编号</th>
          <th style="min-width:180px;">备注</th>
          <th style="min-width:100px;">录入人</th>
          <th style="min-width:100px;">录入日期</th>
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>
  `;

  for (const tr of refs.tableWrap.querySelectorAll<HTMLTableRowElement>('tbody tr[data-task-id]')) {
    const taskId = tr.dataset.taskId || '';
    tr.addEventListener('click', () => {
      setSelectedTask(taskId);
    });
    tr.addEventListener('dblclick', async () => {
      await openBySelectedTask('task-view');
    });
  }

  refs.tableSummary.textContent = `${state.rows.length} 条记录（真实接口）`;
}

function renderIframeState(): void {
  if (!state.iframeMeta) {
    refs.modalTitle.textContent = '未打开校审页面';
    refs.modalEl.classList.remove('show');
    return;
  }

  const sourceLabel: Record<IframeSource, string> = {
    new: '新增打开',
    'task-view': '列表查看',
    'task-reopen': '按当前单据重开',
    'last-form-reopen': '按最近 form_id 重开',
    'iframe-refresh-reopen': '同角色刷新重开',
  };

  refs.modalTitle.textContent =
    `${sourceLabel[state.iframeMeta.source]} ｜ role=${state.iframeMeta.role}` +
    ` ｜ task=${state.iframeMeta.taskId || '--'}` +
    ` ｜ form=${state.iframeMeta.formId || '--'}` +
    ` ｜ ${toDateTime(state.iframeMeta.openedAt)}`;
  
  refs.modalEl.classList.add('show');
}

function summarizeWorkflowModels(workflowSnapshot: WorkflowSyncResponse | null): string[] {
  const models = workflowSnapshot?.data?.models;
  if (!Array.isArray(models)) return [];
  return models
    .map((item) => String(item).trim())
    .filter(Boolean);
}

function summarizeTaskRefnos(task: ReviewTask | null): string[] {
  if (!task || !Array.isArray(task.components)) return [];
  return task.components
    .map((comp) => String(comp.refNo || '').trim())
    .filter(Boolean);
}

function renderDiagnostics(): void {
  const selected = getSelectedRow();
  const detail = state.diagnostics.taskDetail;
  const workflow = state.diagnostics.workflowSnapshot;
  const taskRefnos = summarizeTaskRefnos(detail || selected?.task || null);
  const workflowModels = summarizeWorkflowModels(workflow);

  const missingInWorkflow = taskRefnos.filter((ref) => !workflowModels.includes(ref));
  const onlyInWorkflow = workflowModels.filter((ref) => !taskRefnos.includes(ref));

  const currentNodeRaw = detail?.currentNode || workflow?.data?.current_node || workflow?.data?.currentNode || '--';
  const currentNode = NODE_LABELS[String(currentNodeRaw).toLowerCase()] || String(currentNodeRaw || '--');
  const statusRaw = detail?.status || workflow?.data?.task_status || workflow?.data?.taskStatus || '--';

  const loadingTips = [
    state.diagnostics.loadingTask ? '任务详情查询中' : '',
    state.diagnostics.loadingWorkflow ? 'form_id 聚合查询中' : '',
  ]
    .filter(Boolean)
    .join('，');

  const diagnosisHints: string[] = [];
  if (taskRefnos.length > 0 && workflowModels.length > 0) {
    diagnosisHints.push('后端任务与 form_id 聚合都存在构件；若重进 iframe 后 UI 仍看不到构件，可归类为「类型1：前端重进未恢复」。');
  }
  if (taskRefnos.length > 0 && workflowModels.length === 0) {
    diagnosisHints.push('任务详情存在构件，但 form_id 聚合为空，可归类为「类型2：任务有构件但 form_id 聚合为空」。');
  }
  if (
    !state.diagnostics.loadingTask &&
    !state.diagnostics.loadingWorkflow &&
    !!(detail?.id || selected?.taskId || state.iframeMeta?.taskId) &&
    taskRefnos.length === 0 &&
    workflowModels.length === 0
  ) {
    diagnosisHints.push('页面有任务上下文但后端双视角均无构件，可归类为「类型3：页面看似成功但后端事实未落库」。');
  }

  refs.diagContent.innerHTML = `
    <div class="diag-card">
      <div class="diag-grid">
        <div class="diag-key">当前 role</div>
        <div class="diag-value">${escapeHtml(state.currentRole)}（${escapeHtml(ROLE_CONTEXT[state.currentRole].label)}）</div>
        <div class="diag-key">task_id</div>
        <div class="diag-value">${escapeHtml(detail?.id || selected?.taskId || '--')}</div>
        <div class="diag-key">form_id</div>
        <div class="diag-value">${escapeHtml(detail?.formId || selected?.formId || state.iframeMeta?.formId || '--')}</div>
        <div class="diag-key">task_status</div>
        <div class="diag-value">${escapeHtml(String(statusRaw || '--'))}</div>
        <div class="diag-key">current_node</div>
        <div class="diag-value">${escapeHtml(currentNode)}</div>
        <div class="diag-key">components 数</div>
        <div class="diag-value">${taskRefnos.length}</div>
        <div class="diag-key">workflow models 数</div>
        <div class="diag-value">${workflowModels.length}</div>
        <div class="diag-key">最近刷新</div>
        <div class="diag-value">${escapeHtml(toDateTime(state.diagnostics.lastRefreshedAt))}</div>
      </div>
    </div>

    ${loadingTips ? `<div class="diag-card">⏳ ${escapeHtml(loadingTips)}</div>` : ''}

    ${state.diagnostics.error ? `<div class="error">${escapeHtml(state.diagnostics.error)}</div>` : ''}

    ${state.workflowAction.lastAction
    ? `<div class="diag-card">
        <div><strong>最近 workflow/sync 动作</strong></div>
        <div>action=${escapeHtml(state.workflowAction.lastAction)}</div>
        <div>结果：${state.workflowAction.lastOk === null ? '处理中' : (state.workflowAction.lastOk ? '成功' : '失败')}</div>
        <div>信息：${escapeHtml(state.workflowAction.lastMessage || '--')}</div>
        <div>时间：${escapeHtml(toDateTime(state.workflowAction.lastAt))}</div>
      </div>`
    : ''}

    <div class="diag-card">
      <div><strong>task.components</strong></div>
      ${taskRefnos.length
    ? `<ul class="diag-list">${taskRefnos.slice(0, 20).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`
    : '<div>--</div>'}
    </div>

    <div class="diag-card">
      <div><strong>workflow models</strong></div>
      ${workflowModels.length
    ? `<ul class="diag-list">${workflowModels.slice(0, 20).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`
    : '<div>--</div>'}
    </div>

    <div class="diag-card">
      <div><strong>差异对照</strong></div>
      <div>task 有但 workflow 没有：${missingInWorkflow.length || 0}</div>
      ${missingInWorkflow.length
    ? `<ul class="diag-list">${missingInWorkflow.slice(0, 20).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`
    : ''}
      <div>workflow 有但 task 没有：${onlyInWorkflow.length || 0}</div>
      ${onlyInWorkflow.length
    ? `<ul class="diag-list">${onlyInWorkflow.slice(0, 20).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`
    : ''}
    </div>

    <div class="diag-card">
      <div><strong>问题归类提示（QA-T6）</strong></div>
      ${diagnosisHints.length
    ? `<ul class="diag-list">${diagnosisHints.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`
    : '<div>当前样本不足以自动归类，请先点击「查任务详情 / 查 form_id 聚合」，或切换到有构件的任务。</div>'}
    </div>
  `;
}

async function ensureRoleAuth(): Promise<void> {
  clearAuthToken();
  const ok = await login(
    state.projectId,
    state.currentRole,
    ROLE_CONTEXT[state.currentRole].node,
  );
  if (!ok) {
    throw new Error(
      `角色 ${state.currentRole} 获取鉴权 token 失败，请检查 /api/auth/token 或项目号配置`,
    );
  }
}

async function refreshList(): Promise<void> {
  state.loadingList = true;
  state.listError = null;
  renderRoleHeader();
  renderTable();

  try {
    await ensureRoleAuth();
    const response = await reviewTaskGetList({ limit: 5000, offset: 0 });
    if (!response.success) {
      throw new Error(response.error_message || '接口返回 success=false');
    }
    const tasks = Array.isArray(response.tasks) ? response.tasks : [];
    state.rows = tasks.map((task, index) => toListRow(task, index + 1));

    if (!state.rows.some((row) => row.taskId === state.selectedTaskId)) {
      state.selectedTaskId = null;
    }
  } catch (error) {
    state.rows = [];
    state.selectedTaskId = null;
    state.listError = error instanceof Error ? error.message : String(error);
  } finally {
    state.loadingList = false;
    renderRoleHeader();
    renderTable();
    renderActionStates();
    renderDiagnostics();
  }
}

function resetDiagnosticsState(): void {
  state.diagnostics.loadingTask = false;
  state.diagnostics.loadingWorkflow = false;
  state.diagnostics.taskDetail = null;
  state.diagnostics.workflowSnapshot = null;
  state.diagnostics.error = null;
  state.diagnostics.lastRefreshedAt = null;
}

async function fetchTaskDetail(taskId: string): Promise<void> {
  state.diagnostics.loadingTask = true;
  renderDiagnostics();
  try {
    const response = await reviewTaskGetById(taskId);
    if (!response.success || !response.task) {
      throw new Error(response.error_message || '任务详情为空');
    }
    state.diagnostics.taskDetail = response.task;
  } finally {
    state.diagnostics.loadingTask = false;
  }
}

function buildWorkflowSyncEndpoint(): string {
  const base = getBackendApiBaseUrl({ fallbackUrl: 'http://localhost:3100' }).replace(/\/$/, '');
  return `${base}/api/review/workflow/sync`;
}

function buildWorkflowSyncFallbackEndpoint(): string {
  const host = window.location.hostname || '127.0.0.1';
  return `http://${host}:3100/api/review/workflow/sync`;
}

async function resolveWorkflowSyncToken(formId: string): Promise<string> {
  const normalizedFormId = formId.trim();
  if (state.embedToken && state.iframeMeta?.formId === normalizedFormId) {
    return state.embedToken;
  }

  const embedUrl = await requestEmbedUrl(state.projectId, state.currentRole, normalizedFormId);
  const token = extractTokenFromUrl(embedUrl);
  if (!token) {
    throw new Error('无法为 workflow/sync 自动获取 token（embed-url 缺少 user_token）');
  }
  state.embedToken = token;
  return token;
}

async function postWorkflowSync(
  endpoint: string,
  payload: Record<string, unknown>,
  headers: Record<string, string>,
): Promise<WorkflowSyncResponse> {
  const resp = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`workflow/sync HTTP ${resp.status}: ${text}`);
  }

  const json = (await resp.json()) as WorkflowSyncResponse;
  if (typeof json.code === 'number' && json.code !== 0 && json.code !== 200) {
    throw new Error(json.message || `workflow/sync code=${json.code}`);
  }
  return json;
}

async function requestWorkflowSync(
  formId: string,
  action: WorkflowSyncAction,
  comments = '',
): Promise<WorkflowSyncResponse> {
  const endpoint = buildWorkflowSyncEndpoint();
  const fallbackEndpoint = buildWorkflowSyncFallbackEndpoint();
  const actorNode = ROLE_CONTEXT[state.currentRole].node;
  const token = await resolveWorkflowSyncToken(formId);
  const authToken = getAuthToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }

  const payload = {
    form_id: formId,
    token,
    action,
    actor: {
      id: state.currentRole,
      name: state.currentRole,
      roles: actorNode,
    },
    comments,
  };

  try {
    return await postWorkflowSync(endpoint, payload, headers);
  } catch (primaryError) {
    const shouldRetryOnFallback = (
      endpoint !== fallbackEndpoint &&
      primaryError instanceof Error &&
      /401|unauthorized/i.test(primaryError.message)
    );
    if (!shouldRetryOnFallback) {
      throw primaryError;
    }
    return await postWorkflowSync(fallbackEndpoint, payload, headers);
  }
}

async function fetchWorkflowQuery(formId: string): Promise<void> {
  state.diagnostics.loadingWorkflow = true;
  renderDiagnostics();
  try {
    state.diagnostics.workflowSnapshot = await requestWorkflowSync(formId, 'query');
  } finally {
    state.diagnostics.loadingWorkflow = false;
  }
}

async function executeWorkflowAction(action: WorkflowMutationAction): Promise<void> {
  const context = resolveWorkflowContext();
  const formId = context.formId?.trim();
  if (!formId) {
    state.workflowAction.lastAction = action;
    state.workflowAction.lastOk = false;
    state.workflowAction.lastMessage = '缺少 form_id，无法执行 workflow/sync 动作。';
    state.workflowAction.lastAt = Date.now();
    state.diagnostics.error = state.workflowAction.lastMessage;
    renderActionStates();
    renderDiagnostics();
    return;
  }

  const comments = refs.workflowCommentInput.value.trim();
  state.workflowAction.loading = true;
  state.workflowAction.lastAction = action;
  state.workflowAction.lastOk = null;
  state.workflowAction.lastMessage = null;
  renderActionStates();

  try {
    await ensureRoleAuth();
    state.diagnostics.workflowSnapshot = await requestWorkflowSync(formId, action, comments);
    state.workflowAction.lastOk = true;
    state.workflowAction.lastMessage = '接口调用成功';
    state.diagnostics.error = null;
    await refreshDiagnosticsSnapshot({ taskId: context.taskId, formId });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    state.workflowAction.lastOk = false;
    state.workflowAction.lastMessage = message;
    state.diagnostics.error = `workflow/sync(${action}) 失败：${message}`;
    renderDiagnostics();
  } finally {
    state.workflowAction.loading = false;
    state.workflowAction.lastAt = Date.now();
    renderActionStates();
    renderDiagnostics();
  }
}

async function refreshDiagnosticsSnapshot(params?: {
  taskId?: string | null;
  formId?: string | null;
}): Promise<void> {
  const selected = getSelectedRow();
  const taskId = params?.taskId ?? selected?.taskId ?? null;
  const formId = params?.formId ?? selected?.formId ?? state.iframeMeta?.formId ?? null;

  const errors: string[] = [];
  state.diagnostics.error = null;

  if (taskId) {
    try {
      await fetchTaskDetail(taskId);
    } catch (error) {
      errors.push(`任务详情：${error instanceof Error ? error.message : String(error)}`);
    }
  } else {
    state.diagnostics.taskDetail = null;
  }

  if (formId) {
    try {
      await fetchWorkflowQuery(formId);
    } catch (error) {
      errors.push(`form_id 聚合：${error instanceof Error ? error.message : String(error)}`);
      state.diagnostics.workflowSnapshot = null;
    }
  } else {
    state.diagnostics.workflowSnapshot = null;
  }

  state.diagnostics.error = errors.length ? errors.join('；') : null;
  state.diagnostics.lastRefreshedAt = Date.now();
  renderDiagnostics();
}

async function requestEmbedUrl(
  projectId: string,
  userId: string,
  preferredFormId?: string | null,
): Promise<string> {
  const base = getBackendApiBaseUrl({ fallbackUrl: 'http://localhost:3100' }).replace(/\/$/, '');
  const token = getAuthToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const payload: Record<string, unknown> = {
    project_id: projectId,
    user_id: userId,
  };
  if (preferredFormId?.trim()) {
    payload.form_id = preferredFormId.trim();
  }

  const resp = await fetch(`${base}/api/review/embed-url`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`embed-url HTTP ${resp.status}: ${text}`);
  }

  const json = (await resp.json()) as EmbedUrlApiResponse;
  if (json.url) {
    return json.url;
  }
  if (typeof json.code === 'number' && json.code !== 0 && json.code !== 200) {
    throw new Error(json.message || `embed-url code=${json.code}`);
  }

  const data = json.data;
  if (!data?.token) {
    throw new Error('embed-url 返回缺少 token');
  }
  const relativePath = data.relative_path || data.relativePath || '';
  if (!relativePath) {
    throw new Error('embed-url 返回缺少 relative_path');
  }

  const query = data.query || {};
  const responseFormId = query.form_id || query.formId || '';
  const parsedFormId = preferredFormId?.trim() || responseFormId;
  const origin = window.location.origin.replace(/\/$/, '');
  const cleanPath = relativePath.startsWith('/') ? relativePath : `/${relativePath}`;
  const params = new URLSearchParams();
  params.set('user_token', data.token);
  if (parsedFormId) params.set('form_id', parsedFormId);
  params.set('user_id', userId);
  params.set('project_id', projectId);
  params.set('output_project', projectId);

  return `${origin}${cleanPath}?${params.toString()}`;
}

async function buildEmbedUrl(preferredFormId?: string | null): Promise<string> {
  const raw = await requestEmbedUrl(state.projectId, state.currentRole, preferredFormId);
  const parsed = new URL(raw, window.location.origin);

  parsed.searchParams.set('user_id', state.currentRole);
  parsed.searchParams.set('project_id', state.projectId);
  parsed.searchParams.set('output_project', state.projectId);

  const formId = preferredFormId?.trim();
  if (formId) {
    parsed.searchParams.set('form_id', formId);
  }

  return parsed.toString();
}

function extractFormIdFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url, window.location.origin);
    return parsed.searchParams.get('form_id')?.trim() || null;
  } catch {
    return null;
  }
}

function extractTokenFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url, window.location.origin);
    return parsed.searchParams.get('user_token')?.trim() || null;
  } catch {
    return null;
  }
}

async function openIframe(params: {
  source: IframeSource;
  taskId?: string | null;
  formId?: string | null;
}): Promise<void> {
  const { taskId, formId } = params;

  try {
    await ensureRoleAuth();
    refs.modalTitle.textContent = '正在生成嵌入地址…';
    const url = await buildEmbedUrl(formId);
    state.iframeUrl = url;
    state.embedToken = extractTokenFromUrl(url);

    const finalFormId = formId || extractFormIdFromUrl(url);
    state.iframeMeta = {
      source: params.source,
      taskId: taskId || null,
      formId: finalFormId,
      role: state.currentRole,
      openedAt: Date.now(),
    };
    if (finalFormId) {
      state.lastOpenedFormId = finalFormId;
    }

    refs.iframeEl.src = url;
    renderLastOpened();
    renderIframeState();
    renderActionStates();

    await refreshDiagnosticsSnapshot({ taskId, formId: finalFormId });
  } catch (error) {
    state.diagnostics.error = `打开 iframe 失败：${error instanceof Error ? error.message : String(error)}`;
    renderDiagnostics();
    renderIframeState();
  }
}

function closeIframe(): void {
  state.iframeUrl = null;
  state.iframeMeta = null;
  state.embedToken = null;
  refs.iframeEl.src = 'about:blank';
  refs.modalEl.classList.remove('show');
  renderIframeState();
  renderActionStates();
}

async function openBySelectedTask(source: IframeSource): Promise<void> {
  const selected = getSelectedRow();
  if (!selected) return;
  await openIframe({
    source,
    taskId: selected.taskId,
    formId: selected.formId,
  });
}

async function reopenLastForm(): Promise<void> {
  if (!state.lastOpenedFormId) return;
  await openIframe({
    source: 'last-form-reopen',
    formId: state.lastOpenedFormId,
    taskId: getSelectedRow()?.taskId || state.iframeMeta?.taskId || null,
  });
}

async function handleRoleSwitch(role: SimulatorRole): Promise<void> {
  if (role === state.currentRole) return;
  state.currentRole = role;
  closeIframe();
  await refreshList();
}

function bindEvents(): void {
  refs.projectInput.value = state.projectId;

  for (const btn of refs.roleButtons) {
    btn.addEventListener('click', async () => {
      const role = btn.dataset.role as SimulatorRole | undefined;
      if (!role) return;
      await handleRoleSwitch(role);
    });
  }

  refs.projectInput.addEventListener('change', async () => {
    state.projectId = refs.projectInput.value.trim() || resolveDefaultProjectId();
    refs.projectInput.value = state.projectId;
    closeIframe();
    await refreshList();
  });

  refs.projectInput.addEventListener('keydown', async (event) => {
    if (event.key !== 'Enter') return;
    state.projectId = refs.projectInput.value.trim() || resolveDefaultProjectId();
    refs.projectInput.value = state.projectId;
    closeIframe();
    await refreshList();
  });

  refs.createBtn.addEventListener('click', async () => {
    await openIframe({ source: 'new' });
  });

  refs.viewBtn.addEventListener('click', async () => {
    await openBySelectedTask('task-view');
  });

  refs.reopenBtn.addEventListener('click', async () => {
    await openBySelectedTask('task-reopen');
  });

  refs.refreshBtn.addEventListener('click', async () => {
    await refreshList();
    if (state.iframeMeta) {
      await refreshDiagnosticsSnapshot({
        taskId: state.iframeMeta.taskId,
        formId: state.iframeMeta.formId,
      });
    }
  });

  refs.reopenLastBtn.addEventListener('click', async () => {
    await reopenLastForm();
  });

  refs.modalCloseBtn.addEventListener('click', () => {
    closeIframe();
  });

  refs.modalReopenBtn.addEventListener('click', async () => {
    if (!state.iframeMeta) return;
    await openIframe({
      source: 'iframe-refresh-reopen',
      taskId: state.iframeMeta.taskId,
      formId: state.iframeMeta.formId,
    });
  });

  refs.diagTaskBtn.addEventListener('click', async () => {
    const selected = getSelectedRow();
    if (!selected) return;
    await refreshDiagnosticsSnapshot({ taskId: selected.taskId, formId: selected.formId });
  });

  refs.diagWorkflowBtn.addEventListener('click', async () => {
    const selected = getSelectedRow();
    if (!selected?.formId) return;
    await refreshDiagnosticsSnapshot({ taskId: selected.taskId, formId: selected.formId });
  });

  refs.workflowActionActiveBtn.addEventListener('click', async () => {
    await executeWorkflowAction('active');
  });

  refs.workflowActionAgreeBtn.addEventListener('click', async () => {
    await executeWorkflowAction('agree');
  });

  refs.workflowActionReturnBtn.addEventListener('click', async () => {
    await executeWorkflowAction('return');
  });

  refs.workflowActionStopBtn.addEventListener('click', async () => {
    await executeWorkflowAction('stop');
  });
}

async function bootstrap(): Promise<void> {
  // 等待 DOM 完全加载
  if (document.readyState === 'loading') {
    await new Promise(resolve => {
      document.addEventListener('DOMContentLoaded', resolve);
    });
  }
  
  // 额外等待一下确保所有元素都已渲染
  await new Promise(resolve => setTimeout(resolve, 100));
  
  initRefs();
  bindEvents();
  renderRoleHeader();
  renderLastOpened();
  renderActionStates();
  resetDiagnosticsState();
  renderDiagnostics();
  renderIframeState();
  await refreshList();
  (window as Window & { __pmsReviewSimulatorReady?: boolean }).__pmsReviewSimulatorReady = true;
}

void bootstrap();
