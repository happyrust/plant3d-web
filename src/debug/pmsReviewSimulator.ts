import {
  authVerifyToken,
  clearAuthToken,
  getAuthToken,
  login,
  reviewTaskGetById,
  reviewTaskGetList,
  type ReviewTask,
} from '@/api/reviewApi';
import { getBackendApiBaseUrl } from '@/utils/apiBase';

type SimulatorRole = 'SJ' | 'JH' | 'SH' | 'PZ';
type SidePanelMode = 'initiate' | 'workflow' | 'readonly';

type WorkflowSyncResponse = {
  code?: number;
  message?: string;
  title?: string;
  data?: {
    title?: string;
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
type EmbeddedWorkflowActionMessage = {
  type: 'plant3d.workflow_action';
  action: WorkflowMutationAction;
  formId?: string;
  taskId?: string;
  comments?: string;
  targetNode?: string;
  source?: string;
};

type WorkflowExecuteOverrides = {
  taskId?: string | null;
  formId?: string | null;
};

type WorkflowDialogState = {
  open: boolean;
  action: WorkflowMutationAction | null;
  comment: string;
  targetNode: string | null;
  submitting: boolean;
  error: string | null;
};

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

type TokenVerifyClaims = {
  projectId?: string;
  userId?: string;
  formId?: string;
  role?: string;
  exp?: number;
  iat?: number;
};

type PmsLaunchPlan = {
  modelUrlPath: string;
  modelUrlSearch: URLSearchParams;
  modelUrlSummary: string;
  modelUrlFormId: string | null;
  queryFormId: string | null;
  token: string;
  tokenSummary: string;
  tokenClaims: TokenVerifyClaims | null;
  finalUrl: string;
  finalUrlSummary: string;
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
  launchPlan: PmsLaunchPlan | null;
  error: string | null;
  lastRefreshedAt: number | null;
};

type WorkflowResultState = {
  loading: boolean;
  lastAction: WorkflowMutationAction | null;
  lastOk: boolean | null;
  lastMessage: string | null;
  lastAt: number | null;
  lastSubmittedWorkflowComment: string | null;
  lastReturnTargetNode: string | null;
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
  workflowAction: WorkflowResultState;
  sidePanelMode: SidePanelMode;
  sidePanelDraftComment: string;
  workflowNodeRaw: string | null;
  workflowDialog: WorkflowDialogState;
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

const WORKFLOW_NODE_ORDER = ['sj', 'jd', 'sh', 'pz'] as const;
const WORKFLOW_MUTATION_ACTIONS: WorkflowMutationAction[] = ['active', 'agree', 'return', 'stop'];

const IFRAME_SOURCE_LABELS: Record<IframeSource, string> = {
  new: '新增打开',
  'task-view': '列表查看',
  'task-reopen': '按当前单据重开',
  'last-form-reopen': '按最近 form_id 重开',
  'iframe-refresh-reopen': '同角色刷新重开',
};

function isWorkflowMutationAction(value: unknown): value is WorkflowMutationAction {
  return typeof value === 'string' && WORKFLOW_MUTATION_ACTIONS.includes(value as WorkflowMutationAction);
}

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
    launchPlan: null,
    error: null,
    lastRefreshedAt: null,
  },
  workflowAction: {
    loading: false,
    lastAction: null,
    lastOk: null,
    lastMessage: null,
    lastAt: null,
    lastSubmittedWorkflowComment: null,
    lastReturnTargetNode: null,
  },
  sidePanelMode: 'readonly',
  sidePanelDraftComment: '',
  workflowNodeRaw: null,
  workflowDialog: {
    open: false,
    action: null,
    comment: '',
    targetNode: null,
    submitting: false,
    error: null,
  },
};

let refs: {
  body: HTMLBodyElement;
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
  modalTitle: HTMLDivElement;
  modalSubtitle: HTMLDivElement;
  modalReopenBtn: HTMLButtonElement;
  modalCloseBtn: HTMLButtonElement;
  iframeEl: HTMLIFrameElement;
  iframeBlocker: HTMLDivElement;
  diagTaskBtn: HTMLButtonElement;
  diagWorkflowBtn: HTMLButtonElement;
  workflowActionHint: HTMLSpanElement;
  diagContent: HTMLDivElement;
  sidePanelTitle: HTMLSpanElement;
  sidePanelBadge: HTMLSpanElement;
  sidePanelSubtitle: HTMLDivElement;
  panelMetaTaskId: HTMLDivElement;
  panelMetaFormId: HTMLDivElement;
  panelMetaNode: HTMLDivElement;
  panelMetaStatus: HTMLDivElement;
  panelMetaSource: HTMLDivElement;
  panelMetaRole: HTMLDivElement;
  panelProjectId: HTMLDivElement;
  panelTitleText: HTMLDivElement;
  panelNoteText: HTMLDivElement;
  panelRequesterText: HTMLDivElement;
  panelCreatedText: HTMLDivElement;
  panelComponentList: HTMLUListElement;
  panelAttachmentList: HTMLUListElement;
  panelInitiateSection: HTMLElement;
  panelWorkflowSection: HTMLElement;
  panelReadonlySection: HTMLElement;
  sidePanelCommentInput: HTMLTextAreaElement;
  sidePanelCommentWorkflow: HTMLTextAreaElement;
  sidePanelReadonlyComment: HTMLTextAreaElement;
  panelActionActiveBtn: HTMLButtonElement;
  panelActionAgreeBtn: HTMLButtonElement;
  panelActionReturnBtn: HTMLButtonElement;
  panelActionStopBtn: HTMLButtonElement;
  panelLastAction: HTMLDivElement;
  panelLastTarget: HTMLDivElement;
  panelLastPayload: HTMLDivElement;
  panelLastResult: HTMLDivElement;
  panelFeedback: HTMLDivElement;
  panelFooterText: HTMLDivElement;
  workflowDialog: HTMLDivElement;
  workflowDialogTitle: HTMLDivElement;
  workflowDialogSubtitle: HTMLDivElement;
  workflowDialogWarning: HTMLDivElement;
  workflowDialogTargetField: HTMLDivElement;
  workflowDialogTargetSelect: HTMLSelectElement;
  workflowDialogComment: HTMLTextAreaElement;
  workflowDialogPayload: HTMLTextAreaElement;
  workflowDialogFeedback: HTMLDivElement;
  workflowDialogCancelBtn: HTMLButtonElement;
  workflowDialogConfirmBtn: HTMLButtonElement;
};

function initRefs(): void {
  refs = {
    body: document.body,
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
    modalTitle: getEl<HTMLDivElement>('modal-title'),
    modalSubtitle: getEl<HTMLDivElement>('modal-subtitle'),
    modalReopenBtn: getEl<HTMLButtonElement>('modal-reopen-btn'),
    modalCloseBtn: getEl<HTMLButtonElement>('modal-close-btn'),
    iframeEl: getEl<HTMLIFrameElement>('review-iframe'),
    iframeBlocker: getEl<HTMLDivElement>('iframe-blocker'),
    diagTaskBtn: getEl<HTMLButtonElement>('diag-task-btn'),
    diagWorkflowBtn: getEl<HTMLButtonElement>('diag-workflow-btn'),
    workflowActionHint: getEl<HTMLSpanElement>('workflow-action-hint'),
    diagContent: getEl<HTMLDivElement>('diag-content'),
    sidePanelTitle: getEl<HTMLSpanElement>('side-panel-title'),
    sidePanelBadge: getEl<HTMLSpanElement>('side-panel-badge'),
    sidePanelSubtitle: getEl<HTMLDivElement>('side-panel-subtitle'),
    panelMetaTaskId: getEl<HTMLDivElement>('panel-meta-task-id'),
    panelMetaFormId: getEl<HTMLDivElement>('panel-meta-form-id'),
    panelMetaNode: getEl<HTMLDivElement>('panel-meta-node'),
    panelMetaStatus: getEl<HTMLDivElement>('panel-meta-status'),
    panelMetaSource: getEl<HTMLDivElement>('panel-meta-source'),
    panelMetaRole: getEl<HTMLDivElement>('panel-meta-role'),
    panelProjectId: getEl<HTMLDivElement>('panel-project-id'),
    panelTitleText: getEl<HTMLDivElement>('panel-title-text'),
    panelNoteText: getEl<HTMLDivElement>('panel-note-text'),
    panelRequesterText: getEl<HTMLDivElement>('panel-requester-text'),
    panelCreatedText: getEl<HTMLDivElement>('panel-created-text'),
    panelComponentList: getEl<HTMLUListElement>('panel-component-list'),
    panelAttachmentList: getEl<HTMLUListElement>('panel-attachment-list'),
    panelInitiateSection: getEl<HTMLElement>('panel-initiate-section'),
    panelWorkflowSection: getEl<HTMLElement>('panel-workflow-section'),
    panelReadonlySection: getEl<HTMLElement>('panel-readonly-section'),
    sidePanelCommentInput: getEl<HTMLTextAreaElement>('side-panel-comment-input'),
    sidePanelCommentWorkflow: getEl<HTMLTextAreaElement>('side-panel-comment-workflow'),
    sidePanelReadonlyComment: getEl<HTMLTextAreaElement>('side-panel-readonly-comment'),
    panelActionActiveBtn: getEl<HTMLButtonElement>('panel-action-active-btn'),
    panelActionAgreeBtn: getEl<HTMLButtonElement>('panel-action-agree-btn'),
    panelActionReturnBtn: getEl<HTMLButtonElement>('panel-action-return-btn'),
    panelActionStopBtn: getEl<HTMLButtonElement>('panel-action-stop-btn'),
    panelLastAction: getEl<HTMLDivElement>('panel-last-action'),
    panelLastTarget: getEl<HTMLDivElement>('panel-last-target'),
    panelLastPayload: getEl<HTMLDivElement>('panel-last-payload'),
    panelLastResult: getEl<HTMLDivElement>('panel-last-result'),
    panelFeedback: getEl<HTMLDivElement>('panel-feedback'),
    panelFooterText: getEl<HTMLDivElement>('panel-footer-text'),
    workflowDialog: getEl<HTMLDivElement>('workflow-dialog'),
    workflowDialogTitle: getEl<HTMLDivElement>('workflow-dialog-title'),
    workflowDialogSubtitle: getEl<HTMLDivElement>('workflow-dialog-subtitle'),
    workflowDialogWarning: getEl<HTMLDivElement>('workflow-dialog-warning'),
    workflowDialogTargetField: getEl<HTMLDivElement>('workflow-dialog-target-field'),
    workflowDialogTargetSelect: getEl<HTMLSelectElement>('workflow-dialog-target-select'),
    workflowDialogComment: getEl<HTMLTextAreaElement>('workflow-dialog-comment'),
    workflowDialogPayload: getEl<HTMLTextAreaElement>('workflow-dialog-payload'),
    workflowDialogFeedback: getEl<HTMLDivElement>('workflow-dialog-feedback'),
    workflowDialogCancelBtn: getEl<HTMLButtonElement>('workflow-dialog-cancel-btn'),
    workflowDialogConfirmBtn: getEl<HTMLButtonElement>('workflow-dialog-confirm-btn'),
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

function resolveWorkflowTitleFallback(): string {
  const selected = getSelectedRow();
  const detailTitle = state.diagnostics.taskDetail?.title?.trim();
  const selectedTitle = selected?.title?.trim();
  const panelTitle = refs?.panelTitleText?.textContent?.trim();
  return detailTitle || selectedTitle || panelTitle || '三维校审单';
}

function attachWorkflowTitle(response: WorkflowSyncResponse): WorkflowSyncResponse {
  const responseTitle = typeof response.title === 'string' ? response.title.trim() : '';
  const dataTitle = typeof response.data?.title === 'string' ? response.data.title.trim() : '';
  const title = dataTitle || responseTitle || resolveWorkflowTitleFallback();
  return {
    ...response,
    title,
    data: {
      ...(response.data || {}),
      title,
    },
  };
}

function normalizeWorkflowNodeId(raw: unknown): string | null {
  const normalized = String(raw || '')
    .trim()
    .toLowerCase();
  if (!normalized) return null;

  if (normalized.includes('sj') || normalized.includes('编制')) return 'sj';
  if (normalized.includes('jd') || normalized.includes('jh') || normalized.includes('校核')) return 'jd';
  if (normalized.includes('sh') || normalized.includes('审核')) return 'sh';
  if (normalized.includes('pz') || normalized.includes('批准')) return 'pz';
  return null;
}

function getNodeLabel(raw: unknown): string {
  const normalized = normalizeWorkflowNodeId(raw);
  if (normalized) return NODE_LABELS[normalized];
  const text = String(raw || '').trim();
  return text || '--';
}

function deriveWorkflowNodeRaw(): string | null {
  return (
    normalizeWorkflowNodeId(state.diagnostics.taskDetail?.currentNode) ||
    normalizeWorkflowNodeId(state.diagnostics.workflowSnapshot?.data?.current_node) ||
    normalizeWorkflowNodeId(state.diagnostics.workflowSnapshot?.data?.currentNode) ||
    null
  );
}

function getCurrentTaskStatus(): string {
  return String(
    state.diagnostics.taskDetail?.status ||
      state.diagnostics.workflowSnapshot?.data?.task_status ||
      state.diagnostics.workflowSnapshot?.data?.taskStatus ||
      '--',
  );
}

function deriveSidePanelMode(): SidePanelMode {
  if (state.iframeMeta?.source === 'new') {
    return 'initiate';
  }

  const context = resolveWorkflowContext();
  if (!context.taskId && state.iframeMeta) {
    return 'readonly';
  }

  const currentNode = deriveWorkflowNodeRaw();
  if (state.currentRole === 'SJ' && currentNode === 'sj') {
    return 'initiate';
  }

  if (state.currentRole === 'SJ' && !context.formId) {
    return 'initiate';
  }

  if (context.formId) {
    return 'workflow';
  }

  return state.iframeMeta ? 'readonly' : 'readonly';
}

function getReturnTargetOptions(): { value: string; label: string }[] {
  const currentNode = state.workflowNodeRaw;
  if (!currentNode) return [];
  const currentIndex = WORKFLOW_NODE_ORDER.indexOf(currentNode as (typeof WORKFLOW_NODE_ORDER)[number]);
  if (currentIndex <= 0) return [];
  return WORKFLOW_NODE_ORDER.slice(0, currentIndex).map((node) => ({
    value: node,
    label: `${node} ${NODE_LABELS[node]}`,
  }));
}

function buildWorkflowCommentPayload(
  action: WorkflowMutationAction,
  comment: string,
  targetNode: string | null,
): string {
  const trimmed = comment.trim();
  if (action !== 'return') {
    return trimmed;
  }
  const normalizedTarget = normalizeWorkflowNodeId(targetNode);
  if (!normalizedTarget) {
    return trimmed;
  }
  const label = NODE_LABELS[normalizedTarget];
  return `[return->${normalizedTarget} ${label}] ${trimmed}`.trim();
}

function getSelectedReturnTargetLabel(): string {
  const normalizedTarget = normalizeWorkflowNodeId(state.workflowAction.lastReturnTargetNode);
  return normalizedTarget ? `${normalizedTarget} ${NODE_LABELS[normalizedTarget]}` : '--';
}

function collectComponentRefs(): string[] {
  const detail = state.diagnostics.taskDetail;
  const selected = getSelectedRow();
  const task = detail || selected?.task || null;
  if (!task || !Array.isArray(task.components)) return [];
  return task.components
    .map((comp) => String(comp.refNo || '').trim())
    .filter(Boolean);
}

function collectAttachmentLabels(): string[] {
  const attachments = state.diagnostics.workflowSnapshot?.data?.attachments;
  if (!Array.isArray(attachments) || attachments.length === 0) {
    return ['附件占位：沿用 workflow/sync 返回，当前无额外后端字段'];
  }
  return attachments.slice(0, 10).map((item, index) => {
    if (typeof item === 'string') {
      return item.trim() || `附件 ${index + 1}`;
    }
    try {
      return JSON.stringify(item);
    } catch {
      return `附件 ${index + 1}`;
    }
  });
}

function setSelectedTask(taskId: string | null): void {
  state.selectedTaskId = taskId;
  renderTable();
  renderActionStates();
  renderDiagnostics();
  renderSidePanelState();
}

function renderRoleHeader(): void {
  refs.currentUserLabel.textContent = `当前用户：${state.currentRole}`;
  refs.currentRoleLabel.textContent = `当前角色：${ROLE_CONTEXT[state.currentRole].label}`;
  for (const btn of Array.from(refs.roleButtons.querySelectorAll<HTMLButtonElement>('button[data-role]'))) {
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
    ? '当前记录缺少 form_id；如为新增态，可先在右侧发起面板填写说明。'
    : state.workflowAction.loading || state.workflowDialog.submitting
      ? `正在处理 workflow/sync ${actionText || ''}...`
      : state.workflowAction.lastMessage
        ? `${actionText ? `${actionText}：` : ''}${state.workflowAction.lastMessage}（${timeText}）`
        : '右侧面板按钮仅打开确认层；真实提交在第二层确认框执行。';

  refs.workflowActionHint.textContent = base;
}

function renderActionStates(): void {
  const selected = getSelectedRow();
  const context = resolveWorkflowContext();
  const hasFormId = Boolean(context.formId);
  const workflowBusy = state.workflowAction.loading || state.workflowDialog.submitting;

  refs.viewBtn.disabled = !selected;
  refs.reopenBtn.disabled = !(selected && selected.formId);
  refs.modalReopenBtn.disabled = !state.iframeMeta;
  refs.diagTaskBtn.disabled = !selected;
  refs.diagWorkflowBtn.disabled = !(selected && selected.formId);

  refs.sidePanelCommentInput.disabled = workflowBusy || state.sidePanelMode !== 'initiate';
  refs.sidePanelCommentWorkflow.disabled = workflowBusy || state.sidePanelMode !== 'workflow';
  refs.panelActionActiveBtn.disabled = workflowBusy || state.sidePanelMode !== 'initiate';
  refs.panelActionAgreeBtn.disabled = workflowBusy || state.sidePanelMode !== 'workflow' || !hasFormId;
  refs.panelActionReturnBtn.disabled = workflowBusy || state.sidePanelMode !== 'workflow' || !hasFormId;
  refs.panelActionStopBtn.disabled = workflowBusy || state.sidePanelMode !== 'workflow' || !hasFormId;

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
    refs.modalSubtitle.textContent = '请从任务列表或新增入口打开校审页面。';
    refs.modalEl.classList.remove('show');
    refs.modalEl.setAttribute('aria-hidden', 'true');
    refs.body.classList.remove('modal-open');
    return;
  }

  refs.modalTitle.textContent = `${IFRAME_SOURCE_LABELS[state.iframeMeta.source]} ｜ role=${state.iframeMeta.role}`;
  refs.modalSubtitle.textContent =
    `task=${state.iframeMeta.taskId || '--'} ｜ form=${state.iframeMeta.formId || '--'} ｜ ${toDateTime(state.iframeMeta.openedAt)}`;
  refs.modalEl.classList.add('show');
  refs.modalEl.setAttribute('aria-hidden', 'false');
  refs.body.classList.add('modal-open');
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

function renderListContent(target: HTMLElement, items: string[], fallback: string): void {
  target.innerHTML = '';
  const values = items.length ? items : [fallback];
  values.forEach((item) => {
    const li = document.createElement('li');
    li.textContent = item;
    target.appendChild(li);
  });
}

function renderSidePanelState(): void {
  state.workflowNodeRaw = deriveWorkflowNodeRaw();
  state.sidePanelMode = state.iframeMeta ? deriveSidePanelMode() : 'readonly';

  const selected = getSelectedRow();
  const detail = state.diagnostics.taskDetail;
  const workflowTitle = state.diagnostics.workflowSnapshot?.data?.title || state.diagnostics.workflowSnapshot?.title;
  const context = resolveWorkflowContext();
  const currentTask = detail || selected?.task || null;
  const title = workflowTitle || detail?.title || selected?.title || '三维校审单';
  const note = detail?.reviewComment || detail?.description || selected?.note || '--';
  const requester = detail?.requesterName || detail?.requesterId || selected?.requesterName || '--';
  const createdAt = detail?.createdAt || selected?.task.createdAt;
  const nodeLabel = getNodeLabel(state.workflowNodeRaw);
  const statusText = statusLabel((detail?.status || selected?.status || 'draft') as ReviewTask['status']);
  const components = collectComponentRefs();
  const attachments = collectAttachmentLabels();
  const latestPayload = state.workflowAction.lastSubmittedWorkflowComment || '--';
  const latestResult = state.workflowAction.lastOk === null
    ? '--'
    : state.workflowAction.lastOk
      ? '成功'
      : '失败';

  refs.sidePanelTitle.textContent =
    state.sidePanelMode === 'initiate'
      ? '发起信息面板'
      : state.sidePanelMode === 'workflow'
        ? '流程处理面板'
        : '只读上下文面板';
  refs.sidePanelBadge.textContent =
    state.sidePanelMode === 'initiate'
      ? '发起态'
      : state.sidePanelMode === 'workflow'
        ? '流程态'
        : '只读';
  refs.sidePanelSubtitle.textContent =
    state.sidePanelMode === 'initiate'
      ? '右侧面板承载发起说明、构件概览与发起动作，点击按钮后进入确认层。'
      : state.sidePanelMode === 'workflow'
        ? '同意 / 驳回 / 终止均在第二层确认框中提交，右侧面板仅维护草稿意见。'
        : '当前上下文仅展示任务与流程快照，不允许直接修改后端状态。';

  refs.panelMetaTaskId.textContent = context.taskId || '--';
  refs.panelMetaFormId.textContent = context.formId || state.iframeMeta?.formId || '--';
  refs.panelMetaNode.textContent = nodeLabel;
  refs.panelMetaStatus.textContent = statusText;
  refs.panelMetaSource.textContent = state.iframeMeta ? IFRAME_SOURCE_LABELS[state.iframeMeta.source] : '--';
  refs.panelMetaRole.textContent = `${state.currentRole} / ${ROLE_CONTEXT[state.currentRole].label}`;

  refs.panelProjectId.textContent = state.projectId || '--';
  refs.panelTitleText.textContent = title;
  document.title = title || '三维校审单';
  refs.panelNoteText.textContent = note;
  refs.panelRequesterText.textContent = normalizeText(requester);
  refs.panelCreatedText.textContent = toYmd(createdAt);

  renderListContent(refs.panelComponentList, components, '当前任务暂无构件清单');
  renderListContent(refs.panelAttachmentList, attachments, '当前流程快照未返回附件');

  refs.panelInitiateSection.hidden = state.sidePanelMode !== 'initiate';
  refs.panelWorkflowSection.hidden = state.sidePanelMode !== 'workflow';
  refs.panelReadonlySection.hidden = state.sidePanelMode !== 'readonly';

  const shouldSyncInitiate = document.activeElement !== refs.sidePanelCommentInput;
  const shouldSyncWorkflow = document.activeElement !== refs.sidePanelCommentWorkflow;
  if (state.sidePanelMode === 'initiate' && shouldSyncInitiate) {
    refs.sidePanelCommentInput.value = state.sidePanelDraftComment;
  }
  if (state.sidePanelMode === 'workflow' && shouldSyncWorkflow) {
    refs.sidePanelCommentWorkflow.value = state.sidePanelDraftComment;
  }

  refs.sidePanelReadonlyComment.value = [
    `当前角色：${state.currentRole}（${ROLE_CONTEXT[state.currentRole].label}）`,
    `当前节点：${nodeLabel}`,
    `任务状态：${statusText}`,
    `最近反馈：${state.workflowAction.lastMessage || state.diagnostics.error || '暂无'}`,
    `form_id：${context.formId || '--'}`,
  ].join('\n');

  refs.panelLastAction.textContent = state.workflowAction.lastAction || '--';
  refs.panelLastTarget.textContent = getSelectedReturnTargetLabel();
  refs.panelLastPayload.textContent = latestPayload;
  refs.panelLastResult.textContent = latestResult;
  refs.panelFeedback.textContent =
    state.workflowAction.lastMessage || state.diagnostics.error || '尚未发起 workflow/sync。';
  refs.panelFeedback.classList.remove('ok', 'fail');
  if (state.workflowAction.lastOk === true) {
    refs.panelFeedback.classList.add('ok');
  } else if (state.workflowAction.lastOk === false || state.diagnostics.error) {
    refs.panelFeedback.classList.add('fail');
  }

  refs.panelFooterText.textContent =
    state.sidePanelMode === 'readonly'
      ? '当前不可变更后端状态；可关闭、刷新重开或切换角色继续排查。'
      : '诊断区仅镜像最近提交 payload 与聚合快照，authoritative 输入位于右侧面板与确认层。';

  renderActionStates();
  void currentTask;
}

function renderWorkflowDialogState(): void {
  const action = state.workflowDialog.action;
  const isReturn = action === 'return';
  const actionText: Record<WorkflowMutationAction, string> = {
    active: '发起',
    agree: '同意',
    return: '驳回',
    stop: '终止',
  };

  refs.workflowDialog.classList.toggle('show', state.workflowDialog.open);
  refs.workflowDialog.setAttribute('aria-hidden', state.workflowDialog.open ? 'false' : 'true');
  refs.iframeBlocker.hidden = !state.workflowDialog.open;
  refs.workflowDialogTargetField.hidden = !isReturn;

  const dialogTitle = action ? `${actionText[action]}确认` : '流程确认';
  refs.workflowDialogTitle.textContent = dialogTitle;
  refs.workflowDialogSubtitle.textContent =
    action === 'active'
      ? '确认以当前发起说明执行 workflow/sync active。'
      : action === 'agree'
        ? '确认以当前意见执行 workflow/sync agree。'
        : action === 'return'
          ? '请选择回退节点并确认驳回原因；目标节点会编码进 comments。'
          : action === 'stop'
            ? '终止属于破坏性动作，需再次确认终止原因。'
            : '请确认本次 workflow/sync 提交内容。';

  const warning =
    action === 'stop'
      ? '终止将中断当前流程，请确认原因已填写完整，并知悉这会影响后续审签。'
      : action === 'return'
        ? '退回不新增后端字段，目标节点会编码进 comments payload。'
        : '';
  refs.workflowDialogWarning.hidden = !warning;
  refs.workflowDialogWarning.textContent = warning;

  if (isReturn) {
    const options = getReturnTargetOptions();
    refs.workflowDialogTargetSelect.innerHTML = '';
    options.forEach((option) => {
      const opt = document.createElement('option');
      opt.value = option.value;
      opt.textContent = option.label;
      refs.workflowDialogTargetSelect.appendChild(opt);
    });
    if (options.length > 0) {
      const currentTarget = normalizeWorkflowNodeId(state.workflowDialog.targetNode) || options[0].value;
      refs.workflowDialogTargetSelect.value = currentTarget;
      state.workflowDialog.targetNode = currentTarget;
    } else {
      state.workflowDialog.targetNode = null;
    }
  } else {
    refs.workflowDialogTargetSelect.innerHTML = '';
  }

  refs.workflowDialogComment.value = state.workflowDialog.comment;
  refs.workflowDialogComment.disabled = state.workflowDialog.submitting;
  refs.workflowDialogTargetSelect.disabled = state.workflowDialog.submitting;
  refs.workflowDialogCancelBtn.disabled = state.workflowDialog.submitting;
  refs.workflowDialogConfirmBtn.disabled = state.workflowDialog.submitting || !action;
  refs.workflowDialogConfirmBtn.textContent = state.workflowDialog.submitting ? '提交中...' : '确认提交';
  refs.workflowDialogPayload.value = action
    ? buildWorkflowCommentPayload(action, state.workflowDialog.comment, state.workflowDialog.targetNode)
    : '';
  refs.workflowDialogFeedback.textContent =
    state.workflowDialog.error || '确认后才会执行真实 workflow/sync 请求。';
  refs.workflowDialogFeedback.classList.remove('ok', 'fail');
  if (state.workflowDialog.error) {
    refs.workflowDialogFeedback.classList.add('fail');
  }
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
  const currentNode = getNodeLabel(currentNodeRaw);
  const statusRaw = detail?.status || workflow?.data?.task_status || workflow?.data?.taskStatus || '--';
  const workflowTitle = workflow?.data?.title || workflow?.title || detail?.title || selected?.title || '三维校审单';
  const launchPlan = state.diagnostics.launchPlan;
  const tokenClaimFormId = launchPlan?.tokenClaims?.formId?.trim() || null;
  const modelUrlFormId = launchPlan?.modelUrlFormId || null;
  const queryFormId = launchPlan?.queryFormId || null;
  const queryVsModelDiff = Boolean(queryFormId && modelUrlFormId && queryFormId !== modelUrlFormId);
  const tokenVsModelDiff = Boolean(tokenClaimFormId && modelUrlFormId && tokenClaimFormId !== modelUrlFormId);

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
        <div class="diag-key">title</div>
        <div class="diag-value">${escapeHtml(workflowTitle)}</div>
        <div class="diag-key">task_status</div>
        <div class="diag-value">${escapeHtml(String(statusRaw || '--'))}</div>
        <div class="diag-key">current_node</div>
        <div class="diag-value">${escapeHtml(currentNode)}</div>
        <div class="diag-key">最近 action</div>
        <div class="diag-value">${escapeHtml(state.workflowAction.lastAction || '--')}</div>
        <div class="diag-key">回退目标</div>
        <div class="diag-value">${escapeHtml(getSelectedReturnTargetLabel())}</div>
        <div class="diag-key">最终 comments</div>
        <div class="diag-value">${escapeHtml(state.workflowAction.lastSubmittedWorkflowComment || '--')}</div>
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

    ${launchPlan
    ? `<div class="diag-card">
          <div><strong>PMS 风格启动链</strong></div>
          <div>query form_id：${escapeHtml(queryFormId || '--')}</div>
          <div>ModelUrl form_id：${escapeHtml(modelUrlFormId || '--')}${queryVsModelDiff ? ' <strong>（与 query 不一致）</strong>' : ''}</div>
          <div>token claims form_id：${escapeHtml(tokenClaimFormId || '--')}${tokenVsModelDiff ? ' <strong>（与 ModelUrl 不一致）</strong>' : ''}</div>
          <div>ModelUrl 片段：${escapeHtml(launchPlan.modelUrlSummary)}</div>
          <div>token 摘要：${escapeHtml(launchPlan.tokenSummary)}</div>
          <div>最终 iframe src：${escapeHtml(launchPlan.finalUrlSummary)}</div>
        </div>`
    : ''}

    ${state.workflowAction.lastAction
    ? `<div class="diag-card">
          <div><strong>最近 workflow/sync 动作</strong></div>
          <div>action=${escapeHtml(state.workflowAction.lastAction)}</div>
          <div>结果：${state.workflowAction.lastOk === null ? '处理中' : state.workflowAction.lastOk ? '成功' : '失败'}</div>
          <div>信息：${escapeHtml(state.workflowAction.lastMessage || '--')}</div>
          <div>payload：${escapeHtml(state.workflowAction.lastSubmittedWorkflowComment || '--')}</div>
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
    renderSidePanelState();
  }
}

function resetDiagnosticsState(): void {
  state.diagnostics.loadingTask = false;
  state.diagnostics.loadingWorkflow = false;
  state.diagnostics.taskDetail = null;
  state.diagnostics.workflowSnapshot = null;
  state.diagnostics.launchPlan = null;
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

  const launchPlan = await buildPmsLaunchPlan(normalizedFormId);
  const token = launchPlan.token;
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
    const response = await postWorkflowSync(endpoint, payload, headers);
    return attachWorkflowTitle(response);
  } catch (primaryError) {
    const shouldRetryOnFallback =
      endpoint !== fallbackEndpoint &&
      primaryError instanceof Error &&
      /401|unauthorized/i.test(primaryError.message);
    if (!shouldRetryOnFallback) {
      throw primaryError;
    }
    const fallbackResponse = await postWorkflowSync(fallbackEndpoint, payload, headers);
    return attachWorkflowTitle(fallbackResponse);
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

async function executeWorkflowAction(
  action: WorkflowMutationAction,
  comment: string,
  targetNode: string | null,
  overrides?: WorkflowExecuteOverrides,
): Promise<void> {
  const context = resolveWorkflowContext();
  const taskId = overrides?.taskId?.trim() || context.taskId;
  const formId = overrides?.formId?.trim() || context.formId?.trim();
  if (!formId) {
    state.workflowAction.lastAction = action;
    state.workflowAction.lastOk = false;
    state.workflowAction.lastMessage = '缺少 form_id，无法执行 workflow/sync 动作。';
    state.workflowAction.lastAt = Date.now();
    state.workflowAction.lastSubmittedWorkflowComment = buildWorkflowCommentPayload(action, comment, targetNode);
    state.workflowAction.lastReturnTargetNode = action === 'return' ? normalizeWorkflowNodeId(targetNode) : null;
    state.diagnostics.error = state.workflowAction.lastMessage;
    renderActionStates();
    renderDiagnostics();
    renderSidePanelState();
    return;
  }

  const payloadComment = buildWorkflowCommentPayload(action, comment, targetNode);
  state.workflowAction.loading = true;
  state.workflowAction.lastAction = action;
  state.workflowAction.lastOk = null;
  state.workflowAction.lastMessage = null;
  state.workflowAction.lastSubmittedWorkflowComment = payloadComment;
  state.workflowAction.lastReturnTargetNode = action === 'return' ? normalizeWorkflowNodeId(targetNode) : null;
  renderActionStates();
  renderSidePanelState();

  try {
    await ensureRoleAuth();
    state.diagnostics.workflowSnapshot = await requestWorkflowSync(formId, action, payloadComment);
    state.workflowAction.lastOk = true;
    state.workflowAction.lastMessage = '接口调用成功';
    state.diagnostics.error = null;
    await refreshDiagnosticsSnapshot({ taskId, formId });
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
    renderSidePanelState();
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
  renderSidePanelState();
}

async function requestEmbedUrlData(
  projectId: string,
  userId: string,
  preferredFormId?: string | null,
): Promise<EmbedUrlApiResponse> {
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

  return (await resp.json()) as EmbedUrlApiResponse;
}

async function buildPmsLaunchPlan(preferredFormId?: string | null): Promise<PmsLaunchPlan> {
  const response = await requestEmbedUrlData(state.projectId, state.currentRole, preferredFormId);
  if (typeof response.code === 'number' && response.code !== 0 && response.code !== 200) {
    throw new Error(response.message || `embed-url code=${response.code}`);
  }

  const directUrl = response.url ? new URL(response.url, window.location.origin) : null;
  const data = response.data;
  const relativePathRaw = data?.relative_path || data?.relativePath || directUrl?.pathname || '';
  if (!relativePathRaw) {
    throw new Error('embed-url 返回缺少 relative_path');
  }

  const modelUrlPath = relativePathRaw.startsWith('/') ? relativePathRaw : `/${relativePathRaw}`;
  const directQuery = directUrl ? new URLSearchParams(directUrl.search) : new URLSearchParams();
  const modelUrlSearch = new URLSearchParams();
  for (const [key, value] of directQuery.entries()) {
    if (key !== 'user_token' && key !== 'user_id') {
      modelUrlSearch.set(key, value);
    }
  }

  const query = data?.query || {};
  const queryFormId = (query.form_id || query.formId || '').trim() || null;
  const preferred = preferredFormId?.trim() || null;
  const directFormId = directQuery.get('form_id')?.trim() || null;
  const modelUrlFormId = preferred || queryFormId || directFormId || null;
  if (modelUrlFormId) {
    modelUrlSearch.set('form_id', modelUrlFormId);
  }
  modelUrlSearch.set('project_id', state.projectId);
  modelUrlSearch.set('output_project', state.projectId);
  modelUrlSearch.set('user_role', ROLE_CONTEXT[state.currentRole].node);

  const token = data?.token?.trim() || directQuery.get('user_token')?.trim() || '';
  if (!token) {
    throw new Error('embed-url 返回缺少 token');
  }

  const finalUrl = new URL(modelUrlPath, window.location.origin);
  finalUrl.search = modelUrlSearch.toString();
  finalUrl.searchParams.set('user_token', token);
  finalUrl.searchParams.set('user_id', state.currentRole);

  const tokenClaims = await verifyLaunchToken(token, modelUrlFormId);

  return {
    modelUrlPath,
    modelUrlSearch,
    modelUrlSummary: buildModelUrlSummary(modelUrlPath, modelUrlSearch),
    modelUrlFormId,
    queryFormId,
    token,
    tokenSummary: summarizeToken(token),
    tokenClaims,
    finalUrl: finalUrl.toString(),
    finalUrlSummary: summarizeUrlForDiagnostics(finalUrl),
  };
}

function summarizeUrlForDiagnostics(url: URL | string): string {
  try {
    const parsed = url instanceof URL ? new URL(url.toString()) : new URL(url, window.location.origin);
    const params = new URLSearchParams(parsed.search);
    const token = params.get('user_token');
    if (token) {
      params.set('user_token', `${token.slice(0, 12)}...(${token.length})`);
    }
    parsed.search = params.toString();
    return parsed.toString();
  } catch {
    return String(url);
  }
}

function summarizeToken(token: string): string {
  const trimmed = token.trim();
  if (!trimmed) return '--';
  return `${trimmed.slice(0, 16)}...(${trimmed.length})`;
}

async function verifyLaunchToken(token: string, formId?: string | null): Promise<TokenVerifyClaims | null> {
  try {
    const response = await authVerifyToken(token, formId?.trim() || undefined);
    if (response.data?.valid) {
      return response.data.claims || null;
    }
  } catch (error) {
    console.warn('[pms-review-simulator] token verify failed', error);
  }
  return null;
}

function buildModelUrlSummary(relativePath: string, search: URLSearchParams): string {
  const path = relativePath.startsWith('/') ? relativePath : `/${relativePath}`;
  const rendered = search.toString();
  return rendered ? `${path}?${rendered}` : path;
}

function extractFormIdFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url, window.location.origin);
    return parsed.searchParams.get('form_id')?.trim() || null;
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
    refs.modalTitle.textContent = '正在模拟 PMS 两段式启动…';
    refs.modalSubtitle.textContent = '阶段 1/2：获取 ModelUrl；阶段 2/2：获取 token 并本地拼装 iframe src';
    const launchPlan = await buildPmsLaunchPlan(formId);
    state.diagnostics.launchPlan = launchPlan;
    const url = launchPlan.finalUrl;
    state.iframeUrl = url;
    state.embedToken = launchPlan.token;

    const finalFormId = launchPlan.modelUrlFormId || formId || extractFormIdFromUrl(url);
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

    if (params.source === 'new') {
      state.sidePanelDraftComment = '';
    }

    refs.iframeEl.src = url;
    renderLastOpened();
    closeWorkflowDialog();
    renderIframeState();
    renderActionStates();
    renderSidePanelState();

    await refreshDiagnosticsSnapshot({ taskId, formId: finalFormId });
  } catch (error) {
    state.diagnostics.error = `打开 iframe 失败：${error instanceof Error ? error.message : String(error)}`;
    renderDiagnostics();
    renderIframeState();
    renderSidePanelState();
  }
}

function closeWorkflowDialog(): void {
  state.workflowDialog.open = false;
  state.workflowDialog.action = null;
  state.workflowDialog.comment = '';
  state.workflowDialog.targetNode = null;
  state.workflowDialog.submitting = false;
  state.workflowDialog.error = null;
  renderWorkflowDialogState();
}

function closeIframe(): void {
  closeWorkflowDialog();
  state.iframeUrl = null;
  state.iframeMeta = null;
  state.embedToken = null;
  state.sidePanelMode = 'readonly';
  refs.iframeEl.src = 'about:blank';
  refs.modalEl.classList.remove('show');
  renderIframeState();
  renderActionStates();
  renderSidePanelState();
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
  state.sidePanelDraftComment = '';
  closeIframe();
  await refreshList();
}

function openWorkflowDialog(action: WorkflowMutationAction): void {
  const context = resolveWorkflowContext();
  if (action !== 'active' && !context.formId) {
    state.workflowAction.lastAction = action;
    state.workflowAction.lastOk = false;
    state.workflowAction.lastMessage = '缺少 form_id，无法进入确认提交。';
    state.workflowAction.lastAt = Date.now();
    state.diagnostics.error = state.workflowAction.lastMessage;
    renderActionStates();
    renderDiagnostics();
    renderSidePanelState();
    return;
  }

  const defaultComment = state.sidePanelDraftComment.trim();
  const returnOptions = getReturnTargetOptions();
  state.workflowDialog.open = true;
  state.workflowDialog.action = action;
  state.workflowDialog.comment = defaultComment;
  state.workflowDialog.targetNode = action === 'return' ? returnOptions[returnOptions.length - 1]?.value || null : null;
  state.workflowDialog.submitting = false;
  state.workflowDialog.error = null;
  renderWorkflowDialogState();
  renderActionStates();
}

async function confirmWorkflowDialog(): Promise<void> {
  const action = state.workflowDialog.action;
  if (!action) return;

  const comment = state.workflowDialog.comment.trim();
  const targetNode = action === 'return' ? normalizeWorkflowNodeId(state.workflowDialog.targetNode) : null;

  if (action === 'return' && !targetNode) {
    state.workflowDialog.error = '请选择退回目标节点。';
    renderWorkflowDialogState();
    return;
  }

  state.workflowDialog.submitting = true;
  state.workflowDialog.error = null;
  renderWorkflowDialogState();

  try {
    await executeWorkflowAction(action, comment, targetNode);
    state.sidePanelDraftComment = comment;
    closeWorkflowDialog();
  } catch (error) {
    state.workflowDialog.error = error instanceof Error ? error.message : String(error);
    renderWorkflowDialogState();
  } finally {
    state.workflowDialog.submitting = false;
    renderWorkflowDialogState();
  }
}

function parseEmbeddedWorkflowActionMessage(data: unknown): EmbeddedWorkflowActionMessage | null {
  if (!data || typeof data !== 'object') return null;
  const message = data as Partial<EmbeddedWorkflowActionMessage>;
  if (message.type !== 'plant3d.workflow_action') return null;
  if (!isWorkflowMutationAction(message.action)) return null;
  return {
    type: 'plant3d.workflow_action',
    action: message.action,
    formId: typeof message.formId === 'string' ? message.formId : undefined,
    taskId: typeof message.taskId === 'string' ? message.taskId : undefined,
    comments: typeof message.comments === 'string' ? message.comments : undefined,
    targetNode: typeof message.targetNode === 'string' ? message.targetNode : undefined,
    source: typeof message.source === 'string' ? message.source : undefined,
  };
}

async function handleEmbeddedWorkflowAction(message: EmbeddedWorkflowActionMessage): Promise<void> {
  const taskId = message.taskId?.trim() || null;
  const formId = message.formId?.trim() || null;
  const comments = message.comments?.trim() || '';
  const targetNode = message.action === 'return' ? normalizeWorkflowNodeId(message.targetNode) : null;

  if (state.iframeMeta) {
    state.iframeMeta = {
      ...state.iframeMeta,
      taskId: taskId || state.iframeMeta.taskId,
      formId: formId || state.iframeMeta.formId,
    };
  }
  if (formId) {
    state.lastOpenedFormId = formId;
  }
  if (comments) {
    state.sidePanelDraftComment = comments;
  }

  renderLastOpened();
  renderSidePanelState();
  await executeWorkflowAction(message.action, comments, targetNode, { taskId, formId });
}

function handleWindowMessage(event: MessageEvent): void {
  if (!state.iframeMeta) return;
  const iframeWindow = refs.iframeEl.contentWindow;
  if (!iframeWindow || event.source !== iframeWindow) return;

  const message = parseEmbeddedWorkflowActionMessage(event.data);
  if (!message) return;
  void handleEmbeddedWorkflowAction(message);
}

function bindEvents(): void {
  refs.projectInput.value = state.projectId;
  window.addEventListener('message', handleWindowMessage);

  for (const btn of Array.from(refs.roleButtons.querySelectorAll<HTMLButtonElement>('button[data-role]'))) {
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

  refs.sidePanelCommentInput.addEventListener('input', () => {
    state.sidePanelDraftComment = refs.sidePanelCommentInput.value;
    if (state.workflowDialog.open && state.workflowDialog.action === 'active') {
      state.workflowDialog.comment = state.sidePanelDraftComment;
      renderWorkflowDialogState();
    }
  });

  refs.sidePanelCommentWorkflow.addEventListener('input', () => {
    state.sidePanelDraftComment = refs.sidePanelCommentWorkflow.value;
    if (state.workflowDialog.open && state.workflowDialog.action && state.workflowDialog.action !== 'active') {
      state.workflowDialog.comment = state.sidePanelDraftComment;
      renderWorkflowDialogState();
    }
  });

  refs.panelActionActiveBtn.addEventListener('click', () => {
    openWorkflowDialog('active');
  });

  refs.panelActionAgreeBtn.addEventListener('click', () => {
    openWorkflowDialog('agree');
  });

  refs.panelActionReturnBtn.addEventListener('click', () => {
    openWorkflowDialog('return');
  });

  refs.panelActionStopBtn.addEventListener('click', () => {
    openWorkflowDialog('stop');
  });

  refs.workflowDialogComment.addEventListener('input', () => {
    state.workflowDialog.comment = refs.workflowDialogComment.value;
    renderWorkflowDialogState();
  });

  refs.workflowDialogTargetSelect.addEventListener('change', () => {
    state.workflowDialog.targetNode = refs.workflowDialogTargetSelect.value || null;
    renderWorkflowDialogState();
  });

  refs.workflowDialogCancelBtn.addEventListener('click', () => {
    closeWorkflowDialog();
  });

  refs.workflowDialogConfirmBtn.addEventListener('click', async () => {
    await confirmWorkflowDialog();
  });

  refs.modalEl.querySelector('[data-close="iframe-modal"]')?.addEventListener('click', () => {
    if (state.workflowDialog.open) return;
    closeIframe();
  });

  refs.workflowDialog.querySelector('[data-close="workflow-dialog"]')?.addEventListener('click', () => {
    closeWorkflowDialog();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (state.workflowDialog.open) {
      closeWorkflowDialog();
      event.preventDefault();
      return;
    }
    if (state.iframeMeta) {
      closeIframe();
      event.preventDefault();
    }
  });
}

async function bootstrap(): Promise<void> {
  if (document.readyState === 'loading') {
    await new Promise<void>((resolve) => {
      document.addEventListener('DOMContentLoaded', () => resolve(), { once: true });
    });
  }

  await new Promise((resolve) => setTimeout(resolve, 100));

  initRefs();
  bindEvents();
  renderRoleHeader();
  renderLastOpened();
  renderActionStates();
  resetDiagnosticsState();
  renderDiagnostics();
  renderIframeState();
  renderSidePanelState();
  renderWorkflowDialogState();
  await refreshList();
  (window as Window & { __pmsReviewSimulatorReady?: boolean }).__pmsReviewSimulatorReady = true;
}

void bootstrap();
