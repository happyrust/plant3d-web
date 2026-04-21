import {
  authVerifyToken,
  clearAuthToken,
  getAuthToken,
  login,
  reviewTaskCancel,
  reviewTaskDelete,
  reviewTaskGetById,
  reviewTaskGetList,
  reviewTaskReturn,
  reviewTaskSubmitToNext,
  type ReviewAnnotationCheckResult,
  type ReviewTask,
} from '@/api/reviewApi';
import { resolvePassiveWorkflowMode, resolveWorkflowMode } from '@/components/review/workflowMode';
import {
  applyTokenPrimaryPmsLaunchUrl,
  buildTokenPrimaryPmsLaunchSearch,
  resolveDefaultSimulatorProjectId,
  resolvePmsLaunchFormId,
} from '@/debug/pmsReviewSimulatorLaunchPlan';
import { beginWorkflowVerifyCycle } from '@/debug/pmsReviewSimulatorState';
import {
  buildSimulatorAuthLoginRequest,
  buildSimulatorEmbedUrlPayload,
  buildSimulatorRuntimeWorkflowRole,
  resolveSimulatorInboxTaskVisibility,
  buildSimulatorWorkflowSyncPayload,
  deriveSimulatorSidePanelMode,
  resolveSimulatorWorkflowAccess,
  resolveSimulatorTaskAssignment,
  resolveSimulatorWorkflowAssignment,
  resolveSimulatorWorkflowMutationTargetRole,
  shouldUseSyncOnlyWorkflowAction,
  type WorkflowRole,
} from '@/debug/pmsReviewSimulatorWorkflow';
import { getBackendApiBaseUrl } from '@/utils/apiBase';

type SimulatorPmsUser = 'SJ' | 'JH' | 'SH' | 'PZ';
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

type WorkflowVerifyResponse = {
  code?: number;
  message?: string;
  data?: {
    passed?: boolean;
    action?: string;
    current_node?: string;
    currentNode?: string;
    task_status?: string;
    taskStatus?: string;
    next_step?: string;
    nextStep?: string;
    reason?: string;
    recommended_action?: string;
    recommendedAction?: string;
    [key: string]: unknown;
  };
  error_code?: string;
  errorCode?: string;
  annotation_check?: ReviewAnnotationCheckResult;
  annotationCheck?: ReviewAnnotationCheckResult;
  [key: string]: unknown;
};

type WorkflowSyncAction = 'query' | 'active' | 'agree' | 'return' | 'stop';
type WorkflowMutationAction = Exclude<WorkflowSyncAction, 'query'>;

function normalizeWorkflowVerifyRecommendedAction(
  value?: string | null,
): ReviewAnnotationCheckResult['recommendedAction'] | null {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'block' || normalized === 'return') return normalized;
  if (normalized === 'submit' || normalized === 'proceed') return 'submit';
  return null;
}

function normalizeWorkflowVerifyAnnotationCheck(
  raw?: ReviewAnnotationCheckResult | Record<string, unknown> | null,
): ReviewAnnotationCheckResult | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as Record<string, unknown>;
  const summaryRaw = candidate.summary && typeof candidate.summary === 'object'
    ? candidate.summary as Record<string, unknown>
    : {};
  const blockersRaw = Array.isArray(candidate.blockers) ? candidate.blockers : [];

  return {
    passed: candidate.passed === true,
    recommendedAction: normalizeWorkflowVerifyRecommendedAction(
      String(candidate.recommendedAction || candidate.recommended_action || ''),
    ) || 'block',
    currentNode: String(candidate.currentNode || candidate.current_node || ''),
    summary: {
      total: typeof summaryRaw.total === 'number' ? summaryRaw.total : 0,
      open: typeof summaryRaw.open === 'number' ? summaryRaw.open : 0,
      pendingReview: typeof summaryRaw.pendingReview === 'number'
        ? summaryRaw.pendingReview
        : typeof summaryRaw.pending_review === 'number'
          ? summaryRaw.pending_review
          : 0,
      approved: typeof summaryRaw.approved === 'number' ? summaryRaw.approved : 0,
      rejected: typeof summaryRaw.rejected === 'number' ? summaryRaw.rejected : 0,
    },
    blockers: blockersRaw.map((item) => {
      const blocker = item && typeof item === 'object'
        ? item as Record<string, unknown>
        : {};
      return {
        annotationId: String(blocker.annotationId || blocker.annotation_id || ''),
        annotationType: String(blocker.annotationType || blocker.annotation_type || ''),
        title: typeof blocker.title === 'string' && blocker.title.trim() ? blocker.title.trim() : undefined,
        description: typeof blocker.description === 'string' && blocker.description.trim()
          ? blocker.description.trim()
          : undefined,
        stateCode: String(blocker.stateCode || blocker.state_code || ''),
        stateLabel: String(blocker.stateLabel || blocker.state_label || ''),
        refnos: Array.isArray(blocker.refnos)
          ? blocker.refnos.filter((refno): refno is string => typeof refno === 'string')
          : [],
        updatedAt: typeof blocker.updatedAt === 'number'
          ? blocker.updatedAt
          : typeof blocker.updated_at === 'number'
            ? blocker.updated_at
            : undefined,
        updatedByName: typeof blocker.updatedByName === 'string' && blocker.updatedByName.trim()
          ? blocker.updatedByName.trim()
          : typeof blocker.updated_by_name === 'string' && blocker.updated_by_name.trim()
            ? blocker.updated_by_name.trim()
            : undefined,
        updatedByRole: typeof blocker.updatedByRole === 'string' && blocker.updatedByRole.trim()
          ? blocker.updatedByRole.trim()
          : typeof blocker.updated_by_role === 'string' && blocker.updated_by_role.trim()
            ? blocker.updated_by_role.trim()
            : undefined,
        note: typeof blocker.note === 'string' && blocker.note.trim() ? blocker.note.trim() : undefined,
      };
    }),
    message: String(candidate.message || ''),
  };
}

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
  skipPlatformTaskTransition?: boolean;
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
  workflowMode?: string;
  exp?: number;
  iat?: number;
};

type SimulatorProjectOption = {
  id: string;
  path: string;
  name: string;
  description: string;
};

type PmsLaunchPlan = {
  modelUrlPath: string;
  modelUrlSearch: URLSearchParams;
  modelUrlSummary: string;
  modelUrlFormId: string | null;
  queryFormId: string | null;
  requestedPmsUserId: string;
  requestedWorkflowRole: WorkflowRole;
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

type SimulatorTestRowSummary = {
  index: number;
  taskId: string;
  formId: string | null;
  title: string;
  status: ReviewTask['status'];
  currentNode: string | null;
  requesterName: string;
  componentCount: number;
  selected: boolean;
};

type SimulatorVerifyAnnotationSummary = {
  passed: boolean;
  recommendedAction: ReviewAnnotationCheckResult['recommendedAction'];
  currentNode: string;
  summary: ReviewAnnotationCheckResult['summary'];
  blockerCount: number;
  message: string;
};

type IframeSource = 'new' | 'task-view' | 'task-reopen' | 'last-form-reopen' | 'iframe-refresh-reopen';

type IframeMeta = {
  source: IframeSource;
  taskId: string | null;
  formId: string | null;
  openedAt: number;
  workflowRole: WorkflowRole;
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

type WorkflowVerifyState = {
  loading: boolean;
  lastAction: WorkflowMutationAction | null;
  lastOk: boolean | null;
  lastMessage: string | null;
  lastErrorCode: string | null;
  lastRecommendedAction: ReviewAnnotationCheckResult['recommendedAction'] | null;
  lastAt: number | null;
  lastAnnotationCheck: ReviewAnnotationCheckResult | null;
};

type SimulatorState = {
  currentPmsUser: SimulatorPmsUser;
  projectId: string;
  availableProjects: SimulatorProjectOption[];
  loadingProjects: boolean;
  projectsError: string | null;
  loadingList: boolean;
  deletingList: boolean;
  listError: string | null;
  rows: ReviewListRow[];
  selectedTaskId: string | null;
  selectedTaskIds: string[];
  iframeUrl: string | null;
  iframeMeta: IframeMeta | null;
  embedToken: string | null;
  lastOpenedFormId: string | null;
  diagnostics: DiagnosticsState;
  workflowAction: WorkflowResultState;
  workflowVerify: WorkflowVerifyState;
  sidePanelMode: SidePanelMode;
  sidePanelDraftComment: string;
  workflowNodeRaw: string | null;
  workflowDialog: WorkflowDialogState;
  platformEmbedWorkflowMode: string;
  platformEmbedToken: string;
  platformEmbedExtraParameters: string;
  platformWorkflowMetadata: string;
  /** 与真实 PMS 一致：iframe URL 附带 user_id（HumanCode）及 form_id（等同 ModelUrl 血缘） */
  pmsLikeIframeQuery: boolean;
};

type SimulatorTestSnapshot = {
  currentRole: SimulatorPmsUser;
  currentPmsUser: SimulatorPmsUser;
  currentWorkflowRole: WorkflowRole;
  workflowRoleSource: string;
  workflowNextStep: string | null;
  taskCurrentNode: string | null;
  workflowCurrentNode: string | null;
  currentWorkflowNode: string | null;
  currentFormId: string | null;
  currentTaskStatus: string;
  iframeSource: IframeSource | null;
  defaultAssignedPmsUser: SimulatorPmsUser;
  matchesDefaultAssignee: boolean;
  taskAssignedUserId: string | null;
  taskAssignmentSource: string;
  matchesTaskAssignee: boolean;
  canMutateWorkflow: boolean;
  accessDecisionSource: string;
  accessDecisionReason: string;
  projectId: string;
  iframeUrl: string | null;
  lastOpenedFormId: string | null;
  selectedTaskId: string | null;
  selectedFormId: string | null;
  rowCount: number;
  diagnosticsError: string | null;
  sidePanelMode: SidePanelMode;
  workflowDialogOpen: boolean;
  workflowDialogAction: WorkflowMutationAction | null;
  lastAction: WorkflowMutationAction | null;
  lastOk: boolean | null;
  lastMessage: string | null;
  lastActionAt: number | null;
  lastVerifyAction: WorkflowMutationAction | null;
  lastVerifyOk: boolean | null;
  lastVerifyMessage: string | null;
  lastVerifyAt: number | null;
  lastVerifyErrorCode: string | null;
  lastVerifyRecommendedAction: ReviewAnnotationCheckResult['recommendedAction'] | null;
  lastVerifyAnnotationSummary: SimulatorVerifyAnnotationSummary | null;
  lastVerifyAnnotationCheck: ReviewAnnotationCheckResult | null;
  passiveWorkflowMode: boolean;
};

type SimulatorTestApi = {
  openNew: () => Promise<void>;
  reopenLast: () => Promise<void>;
  switchRole: (role: SimulatorPmsUser) => Promise<void>;
  refreshList: () => Promise<void>;
  listRows: () => SimulatorTestRowSummary[];
  selectTask: (taskId: string) => void;
  selectTaskByFormId: (formId: string) => boolean;
  openSelected: (source?: 'task-view' | 'task-reopen') => Promise<void>;
  setDraftComment: (comment: string) => void;
  openWorkflowAction: (action: WorkflowMutationAction) => void;
  setWorkflowDialogTargetNode: (targetNode: string | null) => void;
  setWorkflowDialogComment: (comment: string) => void;
  confirmWorkflowDialog: () => Promise<void>;
  getSnapshot: () => SimulatorTestSnapshot;
};

type SimulatorPersistedIframeMeta = {
  source: IframeSource;
  taskId: string | null;
  formId: string | null;
  workflowRole?: WorkflowRole | null;
};

type SimulatorPersistedSession = {
  version: 1 | 2;
  currentPmsUser?: SimulatorPmsUser;
  currentRole?: SimulatorPmsUser;
  projectId: string;
  selectedTaskId: string | null;
  lastOpenedFormId: string | null;
  iframeMeta: SimulatorPersistedIframeMeta | null;
};

const PMS_USER_CONTEXT: Record<SimulatorPmsUser, { label: string }> = {
  SJ: { label: 'SJ' },
  JH: { label: 'JH' },
  SH: { label: 'SH' },
  PZ: { label: 'PZ' },
};

const STATUS_LABELS: Record<ReviewTask['status'], string> = {
  draft: '草稿',
  submitted: '待处理',
  in_review: '审核中',
  approved: '已通过',
  rejected: '已驳回',
  cancelled: '已取消',
};

const NODE_LABELS: Record<string, string> = {
  sj: '编制',
  jd: '校对',
  sh: '审核',
  pz: '批准',
};

const WORKFLOW_NODE_ORDER = ['sj', 'jd', 'sh', 'pz'] as const;
const WORKFLOW_MUTATION_ACTIONS: WorkflowMutationAction[] = ['active', 'agree', 'return', 'stop'];
let PASSIVE_WORKFLOW_MODE = resolvePassiveWorkflowMode();
const SIMULATOR_SESSION_STORAGE_KEY = 'pms-review-simulator-session-v1';
const PMS_LIKE_IFRAME_QUERY_STORAGE_KEY = 'pms_simulator_pms_like_iframe';

function readPmsLikeIframeQueryPreference(): boolean {
  try {
    const v = localStorage.getItem(PMS_LIKE_IFRAME_QUERY_STORAGE_KEY);
    if (v === '1' || v === 'true') return true;
  } catch {
    // ignore
  }
  return false;
}

const IFRAME_SOURCE_LABELS: Record<IframeSource, string> = {
  new: '新增打开',
  'task-view': '列表查看',
  'task-reopen': '按当前单据重开',
  'last-form-reopen': '按最近 form_id 重开',
  'iframe-refresh-reopen': '同角色刷新重开',
};

function isSimulatorDebugUiEnabled(): boolean {
  if (import.meta.env.DEV) return true;

  try {
    const search = new URLSearchParams(window.location.search);
    if (search.get('debug_ui') === '1') return true;
  } catch {
    // ignore
  }

  try {
    if (localStorage.getItem('plant3d_debug_ui') === '1') return true;
  } catch {
    // ignore
  }

  try {
    if (sessionStorage.getItem('plant3d_debug_ui') === '1') return true;
  } catch {
    // ignore
  }

  return false;
}

function isWorkflowMutationAction(value: unknown): value is WorkflowMutationAction {
  return typeof value === 'string' && WORKFLOW_MUTATION_ACTIONS.includes(value as WorkflowMutationAction);
}

function readPersistedSimulatorSession(): SimulatorPersistedSession | null {
  if (typeof sessionStorage === 'undefined') return null;

  try {
    const raw = sessionStorage.getItem(SIMULATOR_SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SimulatorPersistedSession>;
    if (parsed.version !== 1 && parsed.version !== 2) return null;

    const currentPmsUser = parsed.currentPmsUser || parsed.currentRole;
    if (!currentPmsUser || !PMS_USER_CONTEXT[currentPmsUser]) {
      return null;
    }

    return {
      version: 2,
      currentPmsUser,
      projectId: String(parsed.projectId || '').trim() || resolveDefaultProjectId(),
      selectedTaskId: String(parsed.selectedTaskId || '').trim() || null,
      lastOpenedFormId: String(parsed.lastOpenedFormId || '').trim() || null,
      iframeMeta: parsed.iframeMeta
        ? {
          source: parsed.iframeMeta.source || 'iframe-refresh-reopen',
          taskId: String(parsed.iframeMeta.taskId || '').trim() || null,
          formId: String(parsed.iframeMeta.formId || '').trim() || null,
          workflowRole: parsed.iframeMeta.workflowRole || null,
        }
        : null,
    };
  } catch {
    return null;
  }
}

const persistedSimulatorSession = readPersistedSimulatorSession();

const state: SimulatorState = {
  currentPmsUser: persistedSimulatorSession?.currentPmsUser || 'SJ',
  projectId: persistedSimulatorSession?.projectId || resolveDefaultProjectId(),
  availableProjects: [],
  loadingProjects: false,
  projectsError: null,
  loadingList: false,
  deletingList: false,
  listError: null,
  rows: [],
  selectedTaskId: persistedSimulatorSession?.selectedTaskId || null,
  selectedTaskIds: persistedSimulatorSession?.selectedTaskId ? [persistedSimulatorSession.selectedTaskId] : [],
  iframeUrl: null,
  iframeMeta: null,
  embedToken: null,
  lastOpenedFormId: persistedSimulatorSession?.lastOpenedFormId || null,
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
  workflowVerify: {
    loading: false,
    lastAction: null,
    lastOk: null,
    lastMessage: null,
    lastErrorCode: null,
    lastRecommendedAction: null,
    lastAt: null,
    lastAnnotationCheck: null,
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
  platformEmbedWorkflowMode: '',
  platformEmbedToken: '',
  platformEmbedExtraParameters: '',
  platformWorkflowMetadata: '',
  pmsLikeIframeQuery: readPmsLikeIframeQueryPreference(),
};

function persistSimulatorSession(): void {
  if (typeof sessionStorage === 'undefined') return;

  const payload: SimulatorPersistedSession = {
    version: 2,
    currentPmsUser: state.currentPmsUser,
    projectId: state.projectId,
    selectedTaskId: state.selectedTaskId,
    lastOpenedFormId: state.lastOpenedFormId,
    iframeMeta: state.iframeMeta
      ? {
        source: state.iframeMeta.source,
        taskId: state.iframeMeta.taskId,
        formId: state.iframeMeta.formId,
        workflowRole: state.iframeMeta.workflowRole,
      }
      : null,
  };

  try {
    sessionStorage.setItem(SIMULATOR_SESSION_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // ignore
  }
}

let refs: {
  body: HTMLBodyElement;
  currentUserLabel: HTMLSpanElement;
  currentPmsUserLabel: HTMLSpanElement;
  roleButtons: HTMLDivElement;
  reopenLastBtn: HTMLButtonElement;
  lastFormLabel: HTMLSpanElement;
  createBtn: HTMLButtonElement;
  deleteBtn: HTMLButtonElement;
  editBtn: HTMLButtonElement;
  viewBtn: HTMLButtonElement;
  reopenBtn: HTMLButtonElement;
  refreshBtn: HTMLButtonElement;
  projectInput: HTMLSelectElement;
  projectStatus: HTMLSpanElement;
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

function toSimulatorTestRowSummary(row: ReviewListRow): SimulatorTestRowSummary {
  return {
    index: row.index,
    taskId: row.taskId,
    formId: row.formId,
    title: row.title,
    status: row.status,
    currentNode: normalizeWorkflowNodeId(row.task.currentNode),
    requesterName: row.requesterName,
    componentCount: row.componentCount,
    selected: row.taskId === state.selectedTaskId,
  };
}

function buildSimulatorVerifyAnnotationSummary(
  annotationCheck: ReviewAnnotationCheckResult | null,
): SimulatorVerifyAnnotationSummary | null {
  if (!annotationCheck) return null;
  return {
    passed: annotationCheck.passed,
    recommendedAction: annotationCheck.recommendedAction,
    currentNode: annotationCheck.currentNode,
    summary: annotationCheck.summary,
    blockerCount: annotationCheck.blockers.length,
    message: annotationCheck.message,
  };
}

function buildSimulatorTestSnapshot(): SimulatorTestSnapshot {
  const workflowRoleState = resolveCurrentWorkflowRoleState();
  const accessState = resolveWorkflowAccessState(workflowRoleState);
  const selectedRow = getSelectedRow();
  const context = resolveWorkflowContext();
  return {
    currentRole: state.currentPmsUser,
    currentPmsUser: state.currentPmsUser,
    currentWorkflowRole: workflowRoleState.workflowRole,
    workflowRoleSource: workflowRoleState.source,
    workflowNextStep: deriveWorkflowNextStepRaw(),
    taskCurrentNode: deriveTaskCurrentNodeRaw(),
    workflowCurrentNode: deriveWorkflowCurrentNodeRaw(),
    currentWorkflowNode: deriveWorkflowNodeRaw(),
    currentFormId: context.formId,
    currentTaskStatus: getCurrentTaskStatus(),
    iframeSource: state.iframeMeta?.source || null,
    defaultAssignedPmsUser: accessState.assignment.defaultAssignedPmsUser,
    matchesDefaultAssignee: accessState.assignment.matchesCurrentPmsUser,
    taskAssignedUserId: accessState.taskAssignment.assignedUserId,
    taskAssignmentSource: accessState.taskAssignment.source,
    matchesTaskAssignee: accessState.taskAssignment.matchesCurrentPmsUser,
    canMutateWorkflow: accessState.access.canMutateWorkflow,
    accessDecisionSource: accessState.access.decisionSource,
    accessDecisionReason: accessState.access.reason,
    projectId: state.projectId,
    iframeUrl: state.iframeUrl,
    lastOpenedFormId: state.lastOpenedFormId,
    selectedTaskId: state.selectedTaskId,
    selectedFormId: selectedRow?.formId || null,
    rowCount: state.rows.length,
    diagnosticsError: state.diagnostics.error,
    sidePanelMode: state.sidePanelMode,
    workflowDialogOpen: state.workflowDialog.open,
    workflowDialogAction: state.workflowDialog.action,
    lastAction: state.workflowAction.lastAction,
    lastOk: state.workflowAction.lastOk,
    lastMessage: state.workflowAction.lastMessage,
    lastActionAt: state.workflowAction.lastAt,
    lastVerifyAction: state.workflowVerify.lastAction,
    lastVerifyOk: state.workflowVerify.lastOk,
    lastVerifyMessage: state.workflowVerify.lastMessage,
    lastVerifyAt: state.workflowVerify.lastAt,
    lastVerifyErrorCode: state.workflowVerify.lastErrorCode,
    lastVerifyRecommendedAction: state.workflowVerify.lastRecommendedAction,
    lastVerifyAnnotationSummary: buildSimulatorVerifyAnnotationSummary(state.workflowVerify.lastAnnotationCheck),
    lastVerifyAnnotationCheck: state.workflowVerify.lastAnnotationCheck,
    passiveWorkflowMode: PASSIVE_WORKFLOW_MODE,
  };
}

function exposeSimulatorTestApi(): void {
  const host = window as Window & {
    __pmsReviewSimulatorTest?: SimulatorTestApi;
  };

  host.__pmsReviewSimulatorTest = {
    openNew: async () => {
      await openIframe({ source: 'new' });
    },
    reopenLast: async () => {
      await reopenLastForm();
    },
    switchRole: async (role: SimulatorPmsUser) => {
      await handleRoleSwitch(role);
    },
    refreshList: async () => {
      await refreshList();
    },
    listRows: () => state.rows.map((row) => toSimulatorTestRowSummary(row)),
    selectTask: (taskId: string) => {
      setSelectedTask(taskId);
    },
    selectTaskByFormId: (formId: string) => {
      const normalizedFormId = formId.trim();
      const row = state.rows.find((item) => item.formId === normalizedFormId) || null;
      setSelectedTask(row?.taskId || null);
      return Boolean(row);
    },
    openSelected: async (source: 'task-view' | 'task-reopen' = 'task-view') => {
      await openBySelectedTask(source);
    },
    setDraftComment: (comment: string) => {
      state.sidePanelDraftComment = comment;
      renderSidePanelState();
    },
    openWorkflowAction: (action: WorkflowMutationAction) => {
      openWorkflowDialog(action);
    },
    setWorkflowDialogTargetNode: (targetNode: string | null) => {
      state.workflowDialog.targetNode = normalizeWorkflowNodeId(targetNode);
      renderWorkflowDialogState();
    },
    setWorkflowDialogComment: (comment: string) => {
      state.workflowDialog.comment = comment;
      renderWorkflowDialogState();
    },
    confirmWorkflowDialog: async () => {
      await confirmWorkflowDialog();
    },
    getSnapshot: () => buildSimulatorTestSnapshot(),
  };
}

function initRefs(): void {
  refs = {
    body: document.body,
    currentUserLabel: getEl<HTMLSpanElement>('current-user-label'),
    currentPmsUserLabel: getEl<HTMLSpanElement>('current-role-label'),
    roleButtons: getEl<HTMLDivElement>('role-buttons'),
    reopenLastBtn: getEl<HTMLButtonElement>('reopen-last-btn'),
    lastFormLabel: getEl<HTMLSpanElement>('last-form-label'),
    createBtn: getEl<HTMLButtonElement>('tool-create'),
    deleteBtn: getEl<HTMLButtonElement>('tool-delete'),
    editBtn: getEl<HTMLButtonElement>('tool-edit'),
    viewBtn: getEl<HTMLButtonElement>('tool-view'),
    reopenBtn: getEl<HTMLButtonElement>('tool-reopen'),
    refreshBtn: getEl<HTMLButtonElement>('tool-refresh'),
    projectInput: getEl<HTMLSelectElement>('project-id-input'),
    projectStatus: getEl<HTMLSpanElement>('project-id-status'),
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
  return resolveDefaultSimulatorProjectId(window.location.search);
}

function getAvailableProjectPaths(): string[] {
  return state.availableProjects.map((project) => project.path);
}

function resolveEffectiveProjectId(preferredProjectId?: string | null): string {
  const normalizedPreferred = preferredProjectId?.trim() || null;
  const availablePaths = getAvailableProjectPaths();
  if (normalizedPreferred && availablePaths.includes(normalizedPreferred)) {
    return normalizedPreferred;
  }
  return resolveDefaultSimulatorProjectId(window.location.search, availablePaths);
}

function renderProjectOptions(): void {
  const selectedProjectId = resolveEffectiveProjectId(state.projectId);
  const fallbackOption = selectedProjectId
    ? [{
      id: selectedProjectId,
      path: selectedProjectId,
      name: selectedProjectId,
      description: '',
    }]
    : [];
  const options = state.availableProjects.length > 0 ? state.availableProjects : fallbackOption;

  refs.projectInput.innerHTML = options
    .map((project) => {
      const selected = project.path === selectedProjectId ? ' selected' : '';
      const description = project.description ? ` title="${escapeHtml(project.description)}"` : '';
      return `<option value="${escapeHtml(project.path)}"${selected}${description}>${escapeHtml(project.name || project.path)}</option>`;
    })
    .join('');

  refs.projectInput.disabled = state.loadingProjects || options.length === 0;
  refs.projectInput.value = selectedProjectId;
  state.projectId = selectedProjectId;

  const selectedProject = options.find((project) => project.path === selectedProjectId) || null;
  const statusParts: string[] = [];
  if (state.loadingProjects) {
    statusParts.push('项目列表加载中…');
  } else if (state.projectsError) {
    statusParts.push(`项目列表失败：${state.projectsError}`);
  } else if (options.length > 0) {
    statusParts.push(`项目列表 ${options.length} 项`);
  }
  if (selectedProject?.description) {
    statusParts.push(selectedProject.description);
  }
  refs.projectStatus.textContent = statusParts.join(' ｜ ') || '未解析项目列表';
  refs.projectStatus.title = refs.projectStatus.textContent;
}

function normalizeProjectOption(item: Record<string, unknown>): SimulatorProjectOption | null {
  const path = String(item.name || '').trim();
  if (!path) return null;
  return {
    id: String(item.id || path).trim() || path,
    path,
    name: String(item.name || path).trim() || path,
    description: String(item.notes || item.env || '').trim(),
  };
}

async function loadAvailableProjects(): Promise<void> {
  state.loadingProjects = true;
  state.projectsError = null;
  renderProjectOptions();
  renderActionStates();

  try {
    const response = await fetch('/api/projects');
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }
    const data = await response.json() as { items?: Record<string, unknown>[] };
    const items = Array.isArray(data.items) ? data.items : [];
    state.availableProjects = items
      .map((item) => normalizeProjectOption(item))
      .filter((item): item is SimulatorProjectOption => item !== null);
  } catch (error) {
    state.availableProjects = [];
    state.projectsError = error instanceof Error ? error.message : String(error);
  } finally {
    state.loadingProjects = false;
    state.projectId = resolveEffectiveProjectId(state.projectId);
    persistSimulatorSession();
    renderProjectOptions();
    renderActionStates();
    renderDiagnostics();
    renderSidePanelState();
  }
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

function inboxSubmittedLabelForWorkflowRole(role: WorkflowRole): string {
  if (role === 'jd') return '待校对';
  if (role === 'sh') return '待审核';
  if (role === 'pz') return '待批准';
  return STATUS_LABELS.submitted;
}

function formatWorkflowRoleForDisplay(role: WorkflowRole | null, source: string): string {
  if (!role || source === 'user-default') {
    return `待 workflow 返回（${source}）`;
  }
  return `${role}（${NODE_LABELS[role]} ｜ ${source}）`;
}

function normalizeDiagnosticWorkflowRole(raw: unknown): WorkflowRole | null {
  return normalizeWorkflowNodeId(raw);
}

function formatDiagnosticWorkflowRole(raw: unknown, fallback = '--'): string {
  const normalizedRole = normalizeDiagnosticWorkflowRole(raw);
  return normalizedRole ? `${normalizedRole}（${NODE_LABELS[normalizedRole]}）` : fallback;
}

function buildLaunchRoleConsistencyText(options: {
  requestedRole: WorkflowRole | null;
  tokenRole: WorkflowRole | null;
  iframeRole: WorkflowRole | null;
  workflowCurrentNodeRole: WorkflowRole | null;
}): string {
  const chainRoles = [options.requestedRole, options.tokenRole, options.iframeRole].filter(
    (role): role is WorkflowRole => Boolean(role),
  );
  const uniqueChainRoles = Array.from(new Set(chainRoles));
  const chainSummary = uniqueChainRoles.length > 0
    ? uniqueChainRoles.map((role) => `${role}（${NODE_LABELS[role]}）`).join(' -> ')
    : '待启动链返回';

  if (!options.workflowCurrentNodeRole) {
    return `${chainSummary} ｜ workflow 当前节点待返回`;
  }

  if (uniqueChainRoles.length === 0) {
    return `workflow 当前节点=${options.workflowCurrentNodeRole}（${NODE_LABELS[options.workflowCurrentNodeRole]}）`;
  }

  if (uniqueChainRoles.some((role) => role !== options.workflowCurrentNodeRole)) {
    return `${chainSummary} ｜ workflow 当前节点=${options.workflowCurrentNodeRole}（${NODE_LABELS[options.workflowCurrentNodeRole]}） ｜ 入口角色与当前节点不一致`;
  }

  return `${chainSummary} ｜ workflow 当前节点=${options.workflowCurrentNodeRole}（${NODE_LABELS[options.workflowCurrentNodeRole]}） ｜ 一致`;
}

function resolveStatusWorkflowRole(taskCurrentNode?: string | null): WorkflowRole | null {
  return normalizeWorkflowNodeId(taskCurrentNode);
}

function statusLabel(status: ReviewTask['status'], taskCurrentNode?: string | null): string {
  if (status === 'submitted') {
    return inboxSubmittedLabelForWorkflowRole(resolveStatusWorkflowRole(taskCurrentNode) || 'sj');
  }
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

function getSelectedRows(): ReviewListRow[] {
  if (!state.selectedTaskIds.length) return [];
  const selectedIdSet = new Set(state.selectedTaskIds);
  return state.rows.filter((row) => selectedIdSet.has(row.taskId));
}

function resolveCurrentWorkflowRoleState(): { workflowRole: WorkflowRole; source: string } {
  const taskCurrentNode = deriveTaskCurrentNodeRaw();
  const workflowNextStep = deriveWorkflowNextStepRaw();
  const workflowCurrentNode = deriveWorkflowCurrentNodeRaw();
  const hasResolvedRuntimeNode = Boolean(workflowNextStep || workflowCurrentNode || taskCurrentNode);
  const launchPlanRole = state.iframeMeta && !hasResolvedRuntimeNode
    ? state.diagnostics.launchPlan?.tokenClaims?.role || null
    : null;
  const iframeRole = state.iframeMeta && !hasResolvedRuntimeNode
    ? state.iframeMeta.workflowRole || null
    : null;
  return buildSimulatorRuntimeWorkflowRole({
    currentPmsUser: state.currentPmsUser,
    workflowNextStep,
    workflowCurrentNode,
    taskCurrentNode,
    launchPlanRole,
    iframeWorkflowRole: iframeRole,
    iframeSource: state.iframeMeta?.source || null,
    hasIframe: Boolean(state.iframeMeta),
  });
}

function getCurrentWorkflowRole(): WorkflowRole {
  return resolveCurrentWorkflowRoleState().workflowRole;
}

function resolveWorkflowAccessState(
  workflowRoleState = resolveCurrentWorkflowRoleState(),
): {
  assignment: ReturnType<typeof resolveSimulatorWorkflowAssignment>;
  taskAssignment: ReturnType<typeof resolveSimulatorTaskAssignment>;
  access: ReturnType<typeof resolveSimulatorWorkflowAccess>;
} {
  const currentTask = state.diagnostics.taskDetail || getSelectedRow()?.task || null;
  const launchPlan = state.diagnostics.launchPlan;
  const tokenClaimRole = normalizeWorkflowNodeId(launchPlan?.tokenClaims?.role || null);
  const currentPmsWorkflowRole = launchPlan?.requestedWorkflowRole || tokenClaimRole || state.iframeMeta?.workflowRole || null;
  const assignment = resolveSimulatorWorkflowAssignment({
    currentPmsUser: state.currentPmsUser,
    currentWorkflowRole: workflowRoleState.workflowRole,
  });
  const taskAssignment = resolveSimulatorTaskAssignment({
    currentPmsUser: state.currentPmsUser,
    currentWorkflowRole: workflowRoleState.workflowRole,
    requesterId: currentTask?.requesterId,
    checkerId: currentTask?.checkerId,
    reviewerId: currentTask?.reviewerId,
    approverId: currentTask?.approverId,
  });
  const access = resolveSimulatorWorkflowAccess({
    iframeSource: state.iframeMeta?.source || null,
    taskStatus: currentTask?.status || state.diagnostics.workflowSnapshot?.data?.task_status || null,
    currentPmsUserId: launchPlan?.requestedPmsUserId || state.currentPmsUser,
    currentPmsWorkflowRole,
    workflowNextStepUserId: deriveWorkflowNextStepAssigneeIdRaw(),
    workflowNextStepRole: deriveWorkflowNextStepRaw(),
  });

  return {
    assignment,
    taskAssignment,
    access,
  };
}

function isTaskSelected(taskId: string): boolean {
  return state.selectedTaskIds.includes(taskId);
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
  return '三维校审单';
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

  if (normalized === 'jh' || normalized.includes('/jh')) return 'sh';
  if (normalized.includes('sj') || normalized.includes('编制')) return 'sj';
  if (normalized.includes('jd') || normalized.includes('校对') || normalized.includes('校核')) return 'jd';
  if (normalized.includes('sh') || normalized.includes('审核')) return 'sh';
  if (normalized.includes('pz') || normalized.includes('批准')) return 'pz';
  return null;
}

function filterTasksForSimulatorInbox(tasks: ReviewTask[]): ReviewTask[] {
  return tasks.filter((task) => resolveSimulatorInboxTaskVisibility({
    currentPmsUser: state.currentPmsUser,
    taskStatus: task.status,
    taskCurrentNode: task.currentNode,
    requesterId: task.requesterId,
    checkerId: task.checkerId,
    reviewerId: task.reviewerId,
    approverId: task.approverId,
  }));
}

function getNodeLabel(raw: unknown): string {
  const normalized = normalizeWorkflowNodeId(raw);
  if (normalized) return NODE_LABELS[normalized];
  const text = String(raw || '').trim();
  return text || '--';
}

function deriveTaskCurrentNodeRaw(): string | null {
  return normalizeWorkflowNodeId(state.diagnostics.taskDetail?.currentNode)
    || normalizeWorkflowNodeId(getSelectedRow()?.task.currentNode)
    || null;
}

function deriveWorkflowCurrentNodeRaw(): string | null {
  return normalizeWorkflowNodeId(state.diagnostics.workflowSnapshot?.data?.current_node)
    || normalizeWorkflowNodeId(state.diagnostics.workflowSnapshot?.data?.currentNode)
    || null;
}

function getWorkflowNextStepPayload(): Record<string, unknown> | null {
  const nextStep = state.diagnostics.workflowSnapshot?.data?.next_step
    ?? state.diagnostics.workflowSnapshot?.data?.nextStep
    ?? null;
  return nextStep && typeof nextStep === 'object'
    ? nextStep as Record<string, unknown>
    : null;
}

function deriveWorkflowNextStepRaw(): string | null {
  const nextStepPayload = getWorkflowNextStepPayload();
  return normalizeWorkflowNodeId(nextStepPayload?.roles as string | undefined)
    || normalizeWorkflowNodeId(nextStepPayload?.role as string | undefined)
    || normalizeWorkflowNodeId(state.diagnostics.workflowSnapshot?.data?.next_step)
    || normalizeWorkflowNodeId(state.diagnostics.workflowSnapshot?.data?.nextStep)
    || null;
}

function deriveWorkflowNextStepAssigneeIdRaw(): string | null {
  const nextStepPayload = getWorkflowNextStepPayload();
  const assigneeId = String(
    nextStepPayload?.assignee_id
    ?? nextStepPayload?.assigneeId
    ?? nextStepPayload?.user_id
    ?? nextStepPayload?.userId
    ?? nextStepPayload?.id
    ?? nextStepPayload?.name
    ?? '',
  ).trim();
  return assigneeId || null;
}

function deriveWorkflowNodeRaw(): string | null {
  return (
    deriveTaskCurrentNodeRaw() ||
    deriveWorkflowCurrentNodeRaw() ||
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
  const context = resolveWorkflowContext();
  const workflowRoleState = resolveCurrentWorkflowRoleState();
  const accessState = resolveWorkflowAccessState(workflowRoleState);
  return deriveSimulatorSidePanelMode({
    passiveWorkflowMode: PASSIVE_WORKFLOW_MODE,
    currentPmsUser: state.currentPmsUser,
    currentWorkflowRole: workflowRoleState.workflowRole,
    canMutateWorkflow: accessState.access.canMutateWorkflow,
    hasIframe: Boolean(state.iframeMeta),
    iframeSource: state.iframeMeta?.source || null,
    taskId: context.taskId,
    formId: context.formId,
  });
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

function resolveWorkflowMutationNextStep(
  action: WorkflowMutationAction,
  currentWorkflowRole: WorkflowRole,
  targetNode: string | null,
): {
  assigneeId: string;
  name: string;
  roles: WorkflowRole;
} | null {
  const targetRole = resolveSimulatorWorkflowMutationTargetRole({
    action,
    currentWorkflowRole,
    targetNode,
  });
  if (!targetRole) {
    return null;
  }

  const assignment = resolveSimulatorWorkflowAssignment({
    currentPmsUser: state.currentPmsUser,
    currentWorkflowRole: targetRole,
  });
  const assigneeId = assignment.defaultAssignedPmsUser;
  return {
    assigneeId,
    name: assigneeId,
    roles: targetRole,
  };
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
  state.selectedTaskIds = taskId ? [taskId] : [];
  persistSimulatorSession();
  renderTable();
  renderActionStates();
  renderDiagnostics();
  renderSidePanelState();
}

function toggleTaskSelection(taskId: string, checked: boolean): void {
  const selectedIdSet = new Set(state.selectedTaskIds);
  if (checked) {
    selectedIdSet.add(taskId);
  } else {
    selectedIdSet.delete(taskId);
  }

  state.selectedTaskIds = state.rows
    .map((row) => row.taskId)
    .filter((rowTaskId) => selectedIdSet.has(rowTaskId));
  state.selectedTaskId = state.selectedTaskIds[0] || null;
  persistSimulatorSession();
  renderTable();
  renderActionStates();
  renderDiagnostics();
  renderSidePanelState();
}

function setAllTaskSelection(checked: boolean): void {
  state.selectedTaskIds = checked ? state.rows.map((row) => row.taskId) : [];
  state.selectedTaskId = state.selectedTaskIds[0] || null;
  persistSimulatorSession();
  renderTable();
  renderActionStates();
  renderDiagnostics();
  renderSidePanelState();
}

function renderRoleHeader(): void {
  const workflowRoleState = resolveCurrentWorkflowRoleState();
  refs.currentUserLabel.textContent = `当前用户：${state.currentPmsUser}`;
  refs.currentPmsUserLabel.textContent = `当前工作流角色：${formatWorkflowRoleForDisplay(workflowRoleState.workflowRole, workflowRoleState.source)}`;
  for (const btn of Array.from(refs.roleButtons.querySelectorAll<HTMLButtonElement>('button[data-role]'))) {
    const role = btn.dataset.role as SimulatorPmsUser | undefined;
    btn.classList.toggle('active', role === state.currentPmsUser);
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
  const workflowRoleState = resolveCurrentWorkflowRoleState();
  const currentWorkflowRole = workflowRoleState.workflowRole;
  const accessState = resolveWorkflowAccessState(workflowRoleState);
  const hintAction: WorkflowMutationAction = state.sidePanelMode === 'workflow' ? 'agree' : 'active';
  const syncDrivenAction = shouldUseSyncOnlyWorkflowAction({
    passiveWorkflowMode: PASSIVE_WORKFLOW_MODE,
    currentPmsUser: state.currentPmsUser,
    currentWorkflowRole,
    sidePanelMode: state.sidePanelMode,
    action: action || hintAction,
  });

  if (PASSIVE_WORKFLOW_MODE) {
    if (!accessState.access.canMutateWorkflow && state.iframeMeta?.source !== 'new') {
      refs.workflowActionHint.textContent = accessState.access.reason;
      return;
    }

    refs.workflowActionHint.textContent = !hasFormId
      ? '请先在嵌入页保存编校审数据，待 form_id 回填后再回到 PMS 面板执行 workflow/sync。'
      : state.workflowAction.loading || state.workflowDialog.submitting
        ? `正在执行 workflow/sync ${action || hintAction}...`
        : state.workflowAction.lastMessage
          ? `${actionText ? `${actionText}：` : ''}${state.workflowAction.lastMessage}（${timeText}）`
          : syncDrivenAction
            ? state.sidePanelMode === 'initiate'
              ? '当前为外部流程模式；送审提交直接通过 workflow/sync active 驱动，不会先推进内部任务状态。'
              : '当前为外部流程模式；同意 / 驳回 / 终止均直接通过 workflow/sync 驱动，不会先推进内部任务状态。'
            : '当前为外部流程模式；当前上下文仅用于查看与排查。';
    return;
  }

  if (!accessState.access.canMutateWorkflow && state.iframeMeta?.source !== 'new') {
    refs.workflowActionHint.textContent = accessState.access.reason;
    return;
  }

  const base = !hasFormId
    ? '当前记录缺少 form_id；如为新增态，可先在右侧发起面板填写说明。'
    : state.workflowAction.loading || state.workflowDialog.submitting
      ? `正在处理平台任务流转 + workflow/sync ${actionText || ''}...`
      : state.workflowAction.lastMessage
        ? `${actionText ? `${actionText}：` : ''}${state.workflowAction.lastMessage}（${timeText}）`
        : '右侧面板按钮仅打开确认层；确认后会先推进平台任务，再同步 workflow/sync。';

  refs.workflowActionHint.textContent = base;
}

function renderActionStates(): void {
  const selected = getSelectedRow();
  const selectedRows = getSelectedRows();
  const context = resolveWorkflowContext();
  const hasFormId = Boolean(context.formId);
  const workflowBusy = state.workflowAction.loading || state.workflowDialog.submitting;
  const listBusy = state.loadingList || state.deletingList || state.loadingProjects;
  const hasProject = Boolean(state.projectId);
  const workflowRoleState = resolveCurrentWorkflowRoleState();
  const currentWorkflowRole = workflowRoleState.workflowRole;
  const accessState = resolveWorkflowAccessState(workflowRoleState);
  const syncDrivenInitiate = shouldUseSyncOnlyWorkflowAction({
    passiveWorkflowMode: PASSIVE_WORKFLOW_MODE,
    currentPmsUser: state.currentPmsUser,
    currentWorkflowRole,
    sidePanelMode: state.sidePanelMode,
    action: 'active',
  });

  refs.createBtn.disabled = listBusy || !hasProject;
  refs.deleteBtn.disabled = listBusy || selectedRows.length === 0;
  refs.viewBtn.disabled = listBusy || selectedRows.length !== 1 || !selected;
  refs.reopenBtn.disabled = listBusy || selectedRows.length !== 1 || !(selected && selected.formId);
  refs.modalReopenBtn.disabled = !state.iframeMeta;
  refs.diagTaskBtn.disabled = listBusy || selectedRows.length !== 1 || !selected;
  refs.diagWorkflowBtn.disabled = listBusy || selectedRows.length !== 1 || !(selected && selected.formId);

  refs.sidePanelCommentInput.disabled =
    workflowBusy
    || state.sidePanelMode !== 'initiate'
    || !accessState.access.canMutateWorkflow;
  refs.sidePanelCommentWorkflow.disabled =
    workflowBusy
    || state.sidePanelMode !== 'workflow'
    || !accessState.access.canMutateWorkflow;
  refs.panelActionActiveBtn.disabled =
    workflowBusy
    || state.sidePanelMode !== 'initiate'
    || !accessState.access.canMutateWorkflow
    || (PASSIVE_WORKFLOW_MODE ? (!syncDrivenInitiate || !hasFormId) : false);
  refs.panelActionAgreeBtn.disabled =
    workflowBusy
    || state.sidePanelMode !== 'workflow'
    || !hasFormId
    || !accessState.access.canMutateWorkflow;
  refs.panelActionReturnBtn.disabled =
    workflowBusy
    || state.sidePanelMode !== 'workflow'
    || !hasFormId
    || !accessState.access.canMutateWorkflow;
  refs.panelActionStopBtn.disabled =
    workflowBusy
    || state.sidePanelMode !== 'workflow'
    || !hasFormId
    || !accessState.access.canMutateWorkflow;

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
      const checkedAttr = isTaskSelected(row.taskId) ? ' checked' : '';
      return `
        <tr class="${selectedClass}" data-task-id="${escapeHtml(row.taskId)}">
          <td class="checkbox-cell">
            <input type="checkbox" data-select-task-id="${escapeHtml(row.taskId)}"${checkedAttr} />
          </td>
          <td>${row.index}</td>
          <td>
            <span class="status-badge status-${escapeHtml(row.status)}">${escapeHtml(statusLabel(row.status, row.task.currentNode))}</span>
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
          <th style="min-width:44px;" class="checkbox-cell">
            <input type="checkbox" id="select-all-tasks" ${state.rows.length > 0 && state.selectedTaskIds.length === state.rows.length ? 'checked' : ''} />
          </th>
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

  const selectAll = refs.tableWrap.querySelector<HTMLInputElement>('#select-all-tasks');
  selectAll?.addEventListener('click', (event) => {
    event.stopPropagation();
  });
  selectAll?.addEventListener('change', () => {
    setAllTaskSelection(Boolean(selectAll.checked));
  });

  for (const tr of refs.tableWrap.querySelectorAll<HTMLTableRowElement>('tbody tr[data-task-id]')) {
    const taskId = tr.dataset.taskId || '';
    const checkbox = tr.querySelector<HTMLInputElement>('input[data-select-task-id]');
    checkbox?.addEventListener('click', (event) => {
      event.stopPropagation();
    });
    checkbox?.addEventListener('change', () => {
      toggleTaskSelection(taskId, Boolean(checkbox.checked));
    });
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

  refs.modalTitle.textContent = `${IFRAME_SOURCE_LABELS[state.iframeMeta.source]} ｜ workflow_role=${state.iframeMeta.workflowRole}`;
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
  const workflowRoleState = resolveCurrentWorkflowRoleState();
  const currentWorkflowRole = workflowRoleState.workflowRole;
  refs.currentUserLabel.textContent = `当前用户：${state.currentPmsUser}`;
  refs.currentPmsUserLabel.textContent = `当前工作流角色：${formatWorkflowRoleForDisplay(currentWorkflowRole, workflowRoleState.source)}`;
  const workflowNextStep = deriveWorkflowNextStepRaw();
  const taskCurrentNode = deriveTaskCurrentNodeRaw();
  const selected = getSelectedRow();
  const detail = state.diagnostics.taskDetail;
  const currentTask = detail || selected?.task || null;
  const accessState = resolveWorkflowAccessState(workflowRoleState);
  const { taskAssignment, access } = accessState;
  const workflowTitle = state.diagnostics.workflowSnapshot?.data?.title || state.diagnostics.workflowSnapshot?.title;
  const context = resolveWorkflowContext();
  const title = workflowTitle || detail?.title || selected?.title || '三维校审单';
  const note = detail?.reviewComment || detail?.description || selected?.note || '--';
  const requester = detail?.requesterName || detail?.requesterId || selected?.requesterName || '--';
  const createdAt = detail?.createdAt || selected?.task.createdAt;
  const nodeLabel = getNodeLabel(state.workflowNodeRaw);
  const taskNodeLabel = getNodeLabel(taskCurrentNode);
  const workflowNextStepLabel = getNodeLabel(workflowNextStep);
  const workflowNextStepAssigneeId = deriveWorkflowNextStepAssigneeIdRaw();
  const statusText = statusLabel(
    (detail?.status || selected?.status || 'draft') as ReviewTask['status'],
    detail?.currentNode || selected?.task.currentNode || state.workflowNodeRaw,
  );
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
      ? (PASSIVE_WORKFLOW_MODE ? '送审信息面板' : '发起信息面板')
      : state.sidePanelMode === 'workflow'
        ? '流程处理面板'
        : '只读上下文面板';
  refs.sidePanelBadge.textContent =
    state.sidePanelMode === 'initiate'
      ? (PASSIVE_WORKFLOW_MODE ? '送审态' : '发起态')
      : state.sidePanelMode === 'workflow'
        ? '流程态'
        : '只读';
  refs.sidePanelSubtitle.textContent =
    PASSIVE_WORKFLOW_MODE
      ? state.sidePanelMode === 'initiate'
        ? '请先在嵌入页保存编校审数据，再回到 PMS 面板执行 workflow/sync active 送审提交。'
        : state.sidePanelMode === 'workflow'
          ? '当前为外部流程模式；同意 / 驳回 / 终止均通过 workflow/sync 驱动，右侧面板仅维护草稿意见。'
          : access.reason
      : state.sidePanelMode === 'initiate'
        ? '右侧面板承载发起说明、构件概览与发起动作，点击按钮后进入确认层。'
        : state.sidePanelMode === 'workflow'
          ? '同意 / 驳回 / 终止均在第二层确认框中提交，右侧面板仅维护草稿意见。'
          : access.canMutateWorkflow
            ? '当前上下文仅展示任务与流程快照，不允许直接修改后端状态。'
            : `${access.reason}`;

  refs.panelMetaTaskId.textContent = context.taskId || '--';
  refs.panelMetaFormId.textContent = context.formId || state.iframeMeta?.formId || '--';
  refs.panelMetaNode.textContent = `外部目标=${workflowNextStepLabel} ｜ 内部任务=${taskNodeLabel} ｜ 当前节点=${nodeLabel}`;
  refs.panelMetaStatus.textContent = statusText;
  refs.panelMetaSource.textContent = state.iframeMeta ? IFRAME_SOURCE_LABELS[state.iframeMeta.source] : '--';
  refs.panelMetaRole.textContent = `${state.currentPmsUser} ｜ 当前工作流角色=${formatWorkflowRoleForDisplay(currentWorkflowRole, workflowRoleState.source)} ｜ workflow next_step=${workflowNextStepAssigneeId || '--'} / ${workflowNextStepLabel} ｜ 任务指派=${taskAssignment.assignedUserId || '--'}（${taskAssignment.source}） ｜ 指派命中=${taskAssignment.matchesCurrentPmsUser ? '是' : '否'} ｜ 可推进=${access.canMutateWorkflow ? '是' : '否'}（${access.decisionSource}）`;

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
    `当前 PMS 用户：${state.currentPmsUser}`,
    `当前工作流角色：${formatWorkflowRoleForDisplay(currentWorkflowRole, workflowRoleState.source)}`,
    `role 来源：${workflowRoleState.source}`,
    `workflow next_step：${workflowNextStepAssigneeId || '--'}（${workflowNextStepLabel}）`,
    `内部任务当前节点：${taskNodeLabel}`,
    `任务指派：${taskAssignment.assignedUserId || '--'}（${taskAssignment.source}）`,
    `任务指派命中：${taskAssignment.matchesCurrentPmsUser ? '是' : '否'}`,
    `流程可推进：${access.canMutateWorkflow ? '是' : '否'}（${access.decisionSource}）`,
    `判定原因：${access.reason}`,
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
    PASSIVE_WORKFLOW_MODE
      ? state.sidePanelMode === 'initiate'
        ? '当前为外部流程模式；发起/送审通过 workflow/sync active 驱动，可关闭、刷新重开或切换用户继续排查。'
        : state.sidePanelMode === 'workflow'
          ? '当前为外部流程模式；流程推进通过 workflow/sync 驱动，可关闭、刷新重开或切换用户继续排查。'
          : `${access.reason}`
      : state.sidePanelMode === 'readonly'
        ? access.canMutateWorkflow
          ? '当前不可变更后端状态；可关闭、刷新重开或切换角色继续排查。'
          : `${access.reason}`
        : '诊断区仅镜像最近提交 payload 与聚合快照，authoritative 输入位于右侧面板与确认层。';

  renderActionStates();
  void currentTask;
}

function renderWorkflowDialogState(): void {
  const action = state.workflowDialog.action;
  const isReturn = action === 'return';
  const workflowRoleState = resolveCurrentWorkflowRoleState();
  const currentWorkflowRole = workflowRoleState.workflowRole;
  const accessState = resolveWorkflowAccessState(workflowRoleState);
  const syncDrivenAction = action
    ? shouldUseSyncOnlyWorkflowAction({
      passiveWorkflowMode: PASSIVE_WORKFLOW_MODE,
      currentPmsUser: state.currentPmsUser,
      currentWorkflowRole,
      sidePanelMode: state.sidePanelMode,
      action,
    })
    : false;
  const actionText: Record<WorkflowMutationAction, string> = {
    active: PASSIVE_WORKFLOW_MODE ? '送审提交' : '发起',
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
    PASSIVE_WORKFLOW_MODE
      ? action === 'active'
        ? '确认以当前说明执行 workflow/sync active；本次不会先推进内部任务状态。'
        : action === 'agree'
          ? '确认以当前意见执行 workflow/sync agree；外部流程将通过 workflow/sync 推进。'
          : action === 'return'
            ? '请选择回退节点并确认驳回原因；将直接通过 workflow/sync return 驱动外部流程。'
            : action === 'stop'
              ? '终止属于破坏性动作；将直接通过 workflow/sync stop 驱动外部流程。'
              : '请确认本次 workflow/sync 提交内容。'
      : action === 'active'
        ? '确认先推进平台任务，再以当前发起说明执行 workflow/sync active。'
        : action === 'agree'
          ? '确认先推进平台任务，再以当前意见执行 workflow/sync agree。'
          : action === 'return'
            ? '请选择回退节点并确认驳回原因；会先驳回平台任务，再同步 workflow/sync，目标节点会编码进 comments。'
            : action === 'stop'
              ? '终止属于破坏性动作；会先取消平台任务，再同步 workflow/sync stop。'
              : '请确认本次 workflow/sync 提交内容。';

  const warning =
    action === 'stop'
      ? '终止将中断当前流程，请确认原因已填写完整，并知悉这会影响后续审签。'
      : action === 'return'
        ? '退回不新增后端字段，目标节点会编码进 comments payload。'
        : PASSIVE_WORKFLOW_MODE && syncDrivenAction
          ? `当前 ${actionText[action || 'active']} 将直接调用 workflow/sync，不再先推进内部任务状态。`
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
    state.workflowDialog.error || (!accessState.access.canMutateWorkflow ? accessState.access.reason : '确认后才会执行真实 workflow/sync 请求。');
  refs.workflowDialogFeedback.classList.remove('ok', 'fail');
  if (state.workflowDialog.error) {
    refs.workflowDialogFeedback.classList.add('fail');
  }
}

function renderDiagnostics(): void {
  const selected = getSelectedRow();
  const detail = state.diagnostics.taskDetail;
  const workflow = state.diagnostics.workflowSnapshot;
  const workflowRoleState = resolveCurrentWorkflowRoleState();
  const workflowNextStep = deriveWorkflowNextStepRaw();
  const taskCurrentNode = deriveTaskCurrentNodeRaw();
  const taskRefnos = summarizeTaskRefnos(detail || selected?.task || null);
  const workflowModels = summarizeWorkflowModels(workflow);

  const missingInWorkflow = taskRefnos.filter((ref) => !workflowModels.includes(ref));
  const onlyInWorkflow = workflowModels.filter((ref) => !taskRefnos.includes(ref));

  const currentNodeRaw = detail?.currentNode || workflow?.data?.current_node || workflow?.data?.currentNode || '--';
  const currentNode = getNodeLabel(currentNodeRaw);
  const workflowNextStepLabel = getNodeLabel(workflowNextStep);
  const workflowNextStepAssigneeId = deriveWorkflowNextStepAssigneeIdRaw();
  const taskCurrentNodeLabel = getNodeLabel(taskCurrentNode);
  const statusRaw = detail?.status || workflow?.data?.task_status || workflow?.data?.taskStatus || '--';
  const workflowTitle = workflow?.data?.title || workflow?.title || detail?.title || selected?.title || '三维校审单';
  const accessState = resolveWorkflowAccessState(workflowRoleState);
  const { assignment, taskAssignment, access } = accessState;
  const launchPlan = state.diagnostics.launchPlan;
  const tokenClaimProjectId = launchPlan?.tokenClaims?.projectId?.trim() || null;
  const tokenClaimFormId = launchPlan?.tokenClaims?.formId?.trim() || null;
  const tokenClaimUserId = launchPlan?.tokenClaims?.userId?.trim() || null;
  const tokenClaimRoleRaw = launchPlan?.tokenClaims?.role?.trim() || null;
  const modelUrlFormId = launchPlan?.modelUrlFormId || null;
  const queryFormId = launchPlan?.queryFormId || null;
  const queryVsModelDiff = Boolean(queryFormId && modelUrlFormId && queryFormId !== modelUrlFormId);
  const availableProjectPaths = getAvailableProjectPaths();
  const tokenProjectMatched = Boolean(tokenClaimProjectId && availableProjectPaths.includes(tokenClaimProjectId));
  const launchRequestedRole = launchPlan?.requestedWorkflowRole || null;
  const tokenClaimRole = normalizeDiagnosticWorkflowRole(tokenClaimRoleRaw);
  const iframeWorkflowRole = state.iframeMeta?.workflowRole || null;
  const workflowCurrentNodeRole = normalizeDiagnosticWorkflowRole(
    workflow?.data?.current_node || workflow?.data?.currentNode || detail?.currentNode || null,
  );
  const launchRoleConsistencyText = buildLaunchRoleConsistencyText({
    requestedRole: launchRequestedRole,
    tokenRole: tokenClaimRole,
    iframeRole: iframeWorkflowRole,
    workflowCurrentNodeRole,
  });

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
  const verifyAnnotationSummary = summarizeVerifyAnnotationCheck(state.workflowVerify.lastAnnotationCheck);

  refs.diagContent.innerHTML = `
    <div class="diag-card">
      <div class="diag-grid">
        <div class="diag-key">当前 PMS 用户</div>
        <div class="diag-value">${escapeHtml(state.currentPmsUser)}</div>
        <div class="diag-key">当前工作流角色</div>
        <div class="diag-value">${escapeHtml(formatWorkflowRoleForDisplay(workflowRoleState.workflowRole, workflowRoleState.source))}</div>
        <div class="diag-key">外部流程目标节点</div>
        <div class="diag-value">${escapeHtml(workflowNextStepLabel)}</div>
        <div class="diag-key">workflow next_step 用户</div>
        <div class="diag-value">${escapeHtml(workflowNextStepAssigneeId || '--')}</div>
        <div class="diag-key">内部任务当前节点</div>
        <div class="diag-value">${escapeHtml(taskCurrentNodeLabel)}</div>
        <div class="diag-key">任务真实指派</div>
        <div class="diag-value">${escapeHtml(taskAssignment.assignedUserId || '--')}（${escapeHtml(taskAssignment.source)}）</div>
        <div class="diag-key">任务指派命中</div>
        <div class="diag-value">${taskAssignment.matchesCurrentPmsUser ? '是' : '否'}</div>
        <div class="diag-key">流程可推进</div>
        <div class="diag-value">${access.canMutateWorkflow ? '是' : '否'}（${escapeHtml(access.decisionSource)}）</div>
        <div class="diag-key">判定原因</div>
        <div class="diag-value">${escapeHtml(access.reason)}</div>
        <div class="diag-key">task_id</div>
        <div class="diag-value">${escapeHtml(detail?.id || selected?.taskId || '--')}</div>
        <div class="diag-key">form_id</div>
        <div class="diag-value">${escapeHtml(detail?.formId || selected?.formId || state.iframeMeta?.formId || '--')}</div>
        <div class="diag-key">任务发起人</div>
        <div class="diag-value">${escapeHtml(detail?.requesterId || selected?.task.requesterId || '--')}</div>
        <div class="diag-key">任务校核人</div>
        <div class="diag-value">${escapeHtml(detail?.checkerId || selected?.task.checkerId || selected?.task.reviewerId || '--')}</div>
        <div class="diag-key">任务审核人</div>
        <div class="diag-value">${escapeHtml(detail?.approverId || selected?.task.approverId || '--')}</div>
        <div class="diag-key">当前模型项目</div>
        <div class="diag-value">${escapeHtml(state.projectId || '--')}</div>
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
        <div class="diag-key">最近 verify</div>
        <div class="diag-value">${escapeHtml(state.workflowVerify.lastAction || '--')} ｜ ${state.workflowVerify.lastOk === null ? '--' : state.workflowVerify.lastOk ? '通过' : '拦截'}</div>
        <div class="diag-key">verify error_code</div>
        <div class="diag-value">${escapeHtml(state.workflowVerify.lastErrorCode || '--')}</div>
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
          <div>拼链模式：${state.pmsLikeIframeQuery ? '真实 PMS（URL 含 user_id + form_id）' : 'token-primary（仅 user_token + output_project）'}</div>
          <div>PMS 入口用户：${escapeHtml(launchPlan.requestedPmsUserId || '--')}</div>
          <div>PMS 入口角色：${escapeHtml(formatDiagnosticWorkflowRole(launchRequestedRole))}</div>
          <div>token claims user_id：${escapeHtml(tokenClaimUserId || '--')}</div>
          <div>token claims role：${escapeHtml(formatDiagnosticWorkflowRole(tokenClaimRoleRaw))}</div>
          <div>iframe 打开角色：${escapeHtml(formatDiagnosticWorkflowRole(iframeWorkflowRole))}</div>
          <div>workflow 当前节点：${escapeHtml(formatDiagnosticWorkflowRole(workflowCurrentNodeRole, currentNode))}</div>
          <div>角色一致性：${escapeHtml(launchRoleConsistencyText)}</div>
          <div>query form_id：${escapeHtml(queryFormId || '--')}</div>
          <div>ModelUrl form_id：${escapeHtml(modelUrlFormId || '--')}${queryVsModelDiff ? ' <strong>（与 query 不一致）</strong>' : ''}</div>
          <div>token claims form_id：${escapeHtml(tokenClaimFormId || '--')}</div>
          <div>token claims project_id：${escapeHtml(tokenClaimProjectId || '--')}${tokenClaimProjectId ? tokenProjectMatched ? ' <strong>（命中项目列表）</strong>' : ' <strong>（未命中项目列表）</strong>' : ''}</div>
          <div>可用项目列表：${escapeHtml(availableProjectPaths.join(', ') || '--')}</div>
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

    ${state.workflowVerify.lastAction
    ? `<div class="diag-card">
          <div><strong>最近 workflow/verify 预校验</strong></div>
          <div>action=${escapeHtml(state.workflowVerify.lastAction)}</div>
          <div>结果：${state.workflowVerify.lastOk === null ? '处理中' : state.workflowVerify.lastOk ? '通过' : '拦截'}</div>
          <div>原因：${escapeHtml(state.workflowVerify.lastMessage || '--')}</div>
          <div>error_code：${escapeHtml(state.workflowVerify.lastErrorCode || '--')}</div>
          <div>annotation_check：${escapeHtml(verifyAnnotationSummary)}</div>
          <div>时间：${escapeHtml(toDateTime(state.workflowVerify.lastAt))}</div>
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
  const workflowRole = getCurrentWorkflowRole();
  const authRequest = buildSimulatorAuthLoginRequest({
    projectId: state.projectId,
    currentPmsUser: state.currentPmsUser,
    currentWorkflowRole: workflowRole,
  });
  clearAuthToken();
  const ok = await login(
    authRequest.projectId,
    authRequest.userId,
    authRequest.role,
  );
  if (!ok) {
    throw new Error(
      `PMS 用户 ${state.currentPmsUser}（workflowRole=${workflowRole}）获取鉴权 token 失败，请检查 /api/auth/token 或项目号配置`,
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
    const scopedTasks = filterTasksForSimulatorInbox(tasks);
    state.rows = scopedTasks.map((task, index) => toListRow(task, index + 1));
    const availableTaskIds = new Set(state.rows.map((row) => row.taskId));
    state.selectedTaskIds = state.selectedTaskIds.filter((taskId) => availableTaskIds.has(taskId));
    if (state.selectedTaskId && !availableTaskIds.has(state.selectedTaskId)) {
      state.selectedTaskId = null;
    }
    if (!state.selectedTaskId && state.selectedTaskIds.length > 0) {
      state.selectedTaskId = state.selectedTaskIds[0];
    }
  } catch (error) {
    state.rows = [];
    state.selectedTaskId = null;
    state.selectedTaskIds = [];
    state.listError = error instanceof Error ? error.message : String(error);
  } finally {
    state.loadingList = false;
    persistSimulatorSession();
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

async function deleteTasks(taskIds: string[]): Promise<void> {
  const normalizedTaskIds = Array.from(new Set(taskIds.map((taskId) => taskId.trim()).filter(Boolean)));
  if (!normalizedTaskIds.length) return;

  const taskIdSet = new Set(normalizedTaskIds);
  const selectedRows = state.rows.filter((row) => taskIdSet.has(row.taskId));
  const label = normalizedTaskIds.length === 1
    ? `确认删除单据「${selectedRows[0]?.title || normalizedTaskIds[0]}」吗？`
    : `确认删除选中的 ${normalizedTaskIds.length} 条单据吗？`;
  const details = normalizedTaskIds.length === state.rows.length
    ? '将清空当前列表全部记录，并同步删除数据库中的真实任务数据。'
    : '该操作会同步删除数据库中的真实任务数据，删除后不可恢复。';

  if (!window.confirm(`${label}\n${details}`)) {
    return;
  }

  state.deletingList = true;
  state.listError = null;
  renderActionStates();
  renderTable();

  try {
    await ensureRoleAuth();
    for (const taskId of normalizedTaskIds) {
      const response = await reviewTaskDelete(taskId);
      if (!response.success) {
        throw new Error(response.error_message || `删除任务失败: ${taskId}`);
      }
    }

    if (state.iframeMeta?.taskId && taskIdSet.has(state.iframeMeta.taskId)) {
      closeIframe();
    }

    if (state.diagnostics.taskDetail?.id && taskIdSet.has(state.diagnostics.taskDetail.id)) {
      resetDiagnosticsState();
    }

    state.selectedTaskId = null;
    state.selectedTaskIds = [];
    await refreshList();
  } catch (error) {
    state.listError = error instanceof Error ? error.message : String(error);
  } finally {
    state.deletingList = false;
    renderActionStates();
    renderTable();
    renderDiagnostics();
    renderSidePanelState();
  }
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

function buildWorkflowVerifyEndpoint(): string {
  const base = getBackendApiBaseUrl({ fallbackUrl: 'http://localhost:3100' }).replace(/\/$/, '');
  return `${base}/api/review/workflow/verify`;
}

function buildWorkflowSyncFallbackEndpoint(): string {
  const host = window.location.hostname || '127.0.0.1';
  return `http://${host}:3100/api/review/workflow/sync`;
}

function buildWorkflowVerifyFallbackEndpoint(): string {
  const host = window.location.hostname || '127.0.0.1';
  return `http://${host}:3100/api/review/workflow/verify`;
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

async function postWorkflowRequest<T extends { code?: number; message?: string }>(
  endpoint: string,
  payload: Record<string, unknown>,
  headers: Record<string, string>,
  actionName: 'workflow/sync' | 'workflow/verify',
): Promise<T> {
  const resp = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`${actionName} HTTP ${resp.status}: ${text}`);
  }

  const json = (await resp.json()) as T;
  if (typeof json.code === 'number' && json.code !== 0 && json.code !== 200) {
    throw new Error(json.message || `${actionName} code=${json.code}`);
  }
  return json;
}

function buildWorkflowMutationPayload(
  formId: string,
  action: WorkflowSyncAction,
  comments = '',
  targetNode: string | null = null,
): Promise<{
  payload: Record<string, unknown>;
  headers: Record<string, string>;
}> {
  return (async () => {
    const currentWorkflowRole = getCurrentWorkflowRole();
    const token = await resolveWorkflowSyncToken(formId);
    const authToken = getAuthToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (authToken) {
      headers.Authorization = `Bearer ${authToken}`;
    }

    let parsedMetadata: Record<string, unknown> | null = null;
    if (state.platformWorkflowMetadata.trim()) {
      try {
        parsedMetadata = JSON.parse(state.platformWorkflowMetadata.trim());
      } catch {
        // ignore invalid JSON — will be omitted
      }
    }

    return {
      payload: buildSimulatorWorkflowSyncPayload({
        formId,
        token,
        action,
        comments,
        currentPmsUser: state.currentPmsUser,
        currentWorkflowRole,
        nextStep: action === 'query' ? null : resolveWorkflowMutationNextStep(action, currentWorkflowRole, targetNode),
        metadata: parsedMetadata,
      }),
      headers,
    };
  })();
}

async function requestWorkflowSync(
  formId: string,
  action: WorkflowSyncAction,
  comments = '',
  targetNode: string | null = null,
): Promise<WorkflowSyncResponse> {
  const endpoint = buildWorkflowSyncEndpoint();
  const fallbackEndpoint = buildWorkflowSyncFallbackEndpoint();
  const { payload, headers } = await buildWorkflowMutationPayload(formId, action, comments, targetNode);

  try {
    const response = await postWorkflowRequest<WorkflowSyncResponse>(
      endpoint,
      payload,
      headers,
      'workflow/sync',
    );
    return attachWorkflowTitle(response);
  } catch (primaryError) {
    const shouldRetryOnFallback =
      endpoint !== fallbackEndpoint &&
      primaryError instanceof Error &&
      /401|unauthorized/i.test(primaryError.message);
    if (!shouldRetryOnFallback) {
      throw primaryError;
    }
    const fallbackResponse = await postWorkflowRequest<WorkflowSyncResponse>(
      fallbackEndpoint,
      payload,
      headers,
      'workflow/sync',
    );
    return attachWorkflowTitle(fallbackResponse);
  }
}

async function requestWorkflowVerify(
  formId: string,
  action: WorkflowMutationAction,
  comments = '',
  targetNode: string | null = null,
): Promise<WorkflowVerifyResponse> {
  const endpoint = buildWorkflowVerifyEndpoint();
  const fallbackEndpoint = buildWorkflowVerifyFallbackEndpoint();
  const { payload, headers } = await buildWorkflowMutationPayload(formId, action, comments, targetNode);

  try {
    return await postWorkflowRequest<WorkflowVerifyResponse>(
      endpoint,
      payload,
      headers,
      'workflow/verify',
    );
  } catch (primaryError) {
    const shouldRetryOnFallback =
      endpoint !== fallbackEndpoint &&
      primaryError instanceof Error &&
      /401|unauthorized/i.test(primaryError.message);
    if (!shouldRetryOnFallback) {
      throw primaryError;
    }
    return await postWorkflowRequest<WorkflowVerifyResponse>(
      fallbackEndpoint,
      payload,
      headers,
      'workflow/verify',
    );
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

async function applyPlatformTaskWorkflowTransition(
  taskId: string,
  action: WorkflowMutationAction,
  comment: string,
  targetNode: string | null,
): Promise<void> {
  let response;
  switch (action) {
    case 'active':
    case 'agree':
      response = await reviewTaskSubmitToNext(taskId, comment || undefined);
      break;
    case 'return':
      response = await reviewTaskReturn(taskId, targetNode || 'sj', comment || '驳回');
      break;
    case 'stop':
      response = await reviewTaskCancel(taskId, comment || '终止');
      break;
    default:
      response = null;
      break;
  }

  if (response && !response.success) {
    throw new Error(response.error_message || '平台任务流转失败');
  }
}

function summarizeVerifyAnnotationCheck(
  annotationCheck: ReviewAnnotationCheckResult | null,
): string {
  if (!annotationCheck) {
    return '--';
  }
  return [
    `recommended=${annotationCheck.recommendedAction}`,
    `current=${annotationCheck.currentNode || '--'}`,
    `open=${annotationCheck.summary.open}`,
    `pending=${annotationCheck.summary.pendingReview}`,
    `rejected=${annotationCheck.summary.rejected}`,
    `blockers=${annotationCheck.blockers.length}`,
  ].join(' ｜ ');
}

function updateWorkflowVerifyState(
  action: WorkflowMutationAction,
  result: {
    ok: boolean;
    message: string;
    errorCode?: string | null;
    recommendedAction?: ReviewAnnotationCheckResult['recommendedAction'] | null;
    annotationCheck?: ReviewAnnotationCheckResult | null;
  },
): void {
  state.workflowVerify.lastAction = action;
  state.workflowVerify.lastOk = result.ok;
  state.workflowVerify.lastMessage = result.message;
  state.workflowVerify.lastErrorCode = result.errorCode?.trim() || null;
  state.workflowVerify.lastRecommendedAction = result.recommendedAction || null;
  state.workflowVerify.lastAnnotationCheck = result.annotationCheck || null;
  state.workflowVerify.lastAt = Date.now();
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
  const workflowRoleState = resolveCurrentWorkflowRoleState();
  const currentWorkflowRole = workflowRoleState.workflowRole;
  const accessState = resolveWorkflowAccessState(workflowRoleState);
  const syncDrivenAction = shouldUseSyncOnlyWorkflowAction({
    passiveWorkflowMode: PASSIVE_WORKFLOW_MODE,
    currentPmsUser: state.currentPmsUser,
    currentWorkflowRole,
    sidePanelMode: state.sidePanelMode,
    action,
  });
  if (!accessState.access.canMutateWorkflow) {
    state.workflowAction.lastAction = action;
    state.workflowAction.lastOk = false;
    state.workflowAction.lastMessage = accessState.access.reason;
    state.workflowAction.lastAt = Date.now();
    state.workflowAction.lastSubmittedWorkflowComment = buildWorkflowCommentPayload(action, comment, targetNode);
    state.workflowAction.lastReturnTargetNode = action === 'return' ? normalizeWorkflowNodeId(targetNode) : null;
    state.diagnostics.error = accessState.access.reason;
    renderActionStates();
    renderDiagnostics();
    renderSidePanelState();
    throw new Error(accessState.access.reason);
  }
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
  state.workflowVerify = beginWorkflowVerifyCycle(state.workflowVerify, action);
  renderActionStates();
  renderSidePanelState();

  try {
    await ensureRoleAuth();
    if (taskId && !overrides?.skipPlatformTaskTransition && !syncDrivenAction) {
      await applyPlatformTaskWorkflowTransition(taskId, action, comment, targetNode);
      await refreshList();
    }

    const verifyResponse = await requestWorkflowVerify(formId, action, payloadComment, targetNode);
    const verifyReason = String(
      verifyResponse.data?.reason
      || verifyResponse.message
      || 'workflow/verify 未返回明确结果'
    ).trim();
    const verifyErrorCode = String(
      verifyResponse.errorCode
      || verifyResponse.error_code
      || ''
    ).trim() || null;
    const verifyAnnotationCheck = normalizeWorkflowVerifyAnnotationCheck(
      (verifyResponse.annotationCheck || verifyResponse.annotation_check || null) as
        | ReviewAnnotationCheckResult
        | Record<string, unknown>
        | null,
    );
    const verifyRecommendedAction = normalizeWorkflowVerifyRecommendedAction(
      String(verifyResponse.data?.recommendedAction || verifyResponse.data?.recommended_action || ''),
    ) || verifyAnnotationCheck?.recommendedAction || null;
    const verifyPassed = verifyResponse.data?.passed === true;
    updateWorkflowVerifyState(action, {
      ok: verifyPassed,
      message: verifyReason,
      errorCode: verifyErrorCode,
      recommendedAction: verifyRecommendedAction,
      annotationCheck: verifyAnnotationCheck,
    });
    if (!verifyPassed) {
      const blockedMessage = [
        `workflow/verify 拦截：${verifyReason}`,
        verifyErrorCode ? `error_code=${verifyErrorCode}` : '',
        verifyAnnotationCheck ? summarizeVerifyAnnotationCheck(verifyAnnotationCheck) : '',
      ]
        .filter(Boolean)
        .join(' ｜ ');
      state.workflowAction.lastOk = false;
      state.workflowAction.lastMessage = blockedMessage;
      state.diagnostics.error = blockedMessage;
      renderDiagnostics();
      throw new Error(blockedMessage);
    }

    state.diagnostics.workflowSnapshot = await requestWorkflowSync(formId, action, payloadComment, targetNode);
    state.workflowAction.lastOk = true;
    state.workflowAction.lastMessage = syncDrivenAction
      ? `workflow/sync ${action} 提交成功（外部流程驱动，未推进内部任务状态）`
      : '接口调用成功';
    state.diagnostics.error = null;
    await refreshDiagnosticsSnapshot({ taskId, formId });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (state.workflowVerify.lastOk === null) {
      updateWorkflowVerifyState(action, {
        ok: false,
        message,
        errorCode: null,
        recommendedAction: null,
        annotationCheck: null,
      });
    }
    state.workflowAction.lastOk = false;
    state.workflowAction.lastMessage = message;
    state.diagnostics.error = /workflow\/verify/.test(message)
      ? message
      : `workflow/sync(${action}) 失败：${message}`;
    renderDiagnostics();
  } finally {
    state.workflowAction.loading = false;
    state.workflowAction.lastAt = Date.now();
    state.workflowVerify.loading = false;
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
  if (state.iframeMeta) {
    const resolvedRole = resolveCurrentWorkflowRoleState().workflowRole;
    state.iframeMeta = {
      ...state.iframeMeta,
      taskId: taskId || state.iframeMeta.taskId,
      formId: formId || state.iframeMeta.formId,
      workflowRole: resolvedRole,
    };
    persistSimulatorSession();
  }
  renderDiagnostics();
  renderSidePanelState();
}

async function requestEmbedUrlData(
  projectId: string,
  preferredFormId?: string | null,
): Promise<EmbedUrlApiResponse> {
  const base = getBackendApiBaseUrl({ fallbackUrl: 'http://localhost:3100' }).replace(/\/$/, '');
  const token = getAuthToken();
  const workflowRole = getCurrentWorkflowRole();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  let parsedExtraParameters: Record<string, unknown> | null = null;
  if (state.platformEmbedExtraParameters.trim()) {
    try {
      parsedExtraParameters = JSON.parse(state.platformEmbedExtraParameters.trim());
    } catch {
      // ignore invalid JSON — will be omitted
    }
  }
  const payload = buildSimulatorEmbedUrlPayload({
    projectId,
    currentPmsUser: state.currentPmsUser,
    currentWorkflowRole: workflowRole,
    preferredFormId,
    workflowMode: state.platformEmbedWorkflowMode || null,
    token: state.platformEmbedToken || token || null,
    extraParameters: parsedExtraParameters,
  });

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
  const response = await requestEmbedUrlData(state.projectId, preferredFormId);
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

  const query = data?.query || {};
  const queryFormId = (query.form_id || query.formId || '').trim() || null;
  const preferred = preferredFormId?.trim() || null;
  const directFormId = directQuery.get('form_id')?.trim() || null;

  const token = data?.token?.trim() || directQuery.get('user_token')?.trim() || '';
  if (!token) {
    throw new Error('embed-url 返回缺少 token');
  }

  const tokenClaims = await verifyLaunchToken(token);
  const tokenClaimFormId = tokenClaims?.formId?.trim() || null;
  const modelUrlFormId = resolvePmsLaunchFormId({
    preferredFormId: preferred,
    queryFormId,
    directFormId,
    tokenClaimFormId,
  });

  const modelUrlSearch = buildTokenPrimaryPmsLaunchSearch({
    directQuery,
    outputProject: state.projectId,
  });

  const finalUrl = new URL(modelUrlPath, window.location.origin);
  finalUrl.search = modelUrlSearch.toString();
  applyTokenPrimaryPmsLaunchUrl(finalUrl, {
    token,
    formId: modelUrlFormId,
    pmsUserId: state.currentPmsUser,
    includePmsUserId: state.pmsLikeIframeQuery,
  });

  return {
    modelUrlPath,
    modelUrlSearch,
    modelUrlSummary: buildModelUrlSummary(modelUrlPath, modelUrlSearch),
    modelUrlFormId,
    queryFormId,
    requestedPmsUserId: state.currentPmsUser,
    requestedWorkflowRole: workflowRole,
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

async function verifyLaunchToken(token: string): Promise<TokenVerifyClaims | null> {
  try {
    const response = await authVerifyToken(token);
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
    refs.modalSubtitle.textContent = state.pmsLikeIframeQuery
      ? '阶段 1/2：embed-url（等同 GetZyModelUrl+GetZyModeInfo 合一）；阶段 2/2：拼装 iframe（含 user_token、user_id、form_id，贴近真实 PMS 拼链）'
      : '阶段 1/2：embed-url → path/query；阶段 2/2：token-primary 保留 user_token + output_project，必要时补 form_id（不带 URL user_id）';
    const launchPlan = await buildPmsLaunchPlan(formId);
    state.diagnostics.launchPlan = launchPlan;
    const url = launchPlan.finalUrl;
    state.iframeUrl = url;
    state.embedToken = launchPlan.token;

    const finalFormId = launchPlan.modelUrlFormId || formId || extractFormIdFromUrl(url);
    const workflowRole = getCurrentWorkflowRole();
    state.iframeMeta = {
      source: params.source,
      taskId: taskId || null,
      formId: finalFormId,
      workflowRole,
      openedAt: Date.now(),
    };
    if (finalFormId) {
      state.lastOpenedFormId = finalFormId;
    }

    if (params.source === 'new') {
      state.sidePanelDraftComment = '';
    }

    persistSimulatorSession();
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

async function restorePersistedIframeIfNeeded(): Promise<void> {
  const persisted = persistedSimulatorSession?.iframeMeta;
  if (!persisted) return;

  const restoredTaskId = persisted.taskId?.trim() || null;
  if (restoredTaskId && state.rows.some((row) => row.taskId === restoredTaskId)) {
    state.selectedTaskId = restoredTaskId;
  }
  persistSimulatorSession();

  const restoredFormId = persisted.formId?.trim() || state.lastOpenedFormId || null;
  if (!restoredFormId) return;

  await openIframe({
    source: 'iframe-refresh-reopen',
    taskId: restoredTaskId,
    formId: restoredFormId,
  });
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
  persistSimulatorSession();
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
  const matchedRow = state.rows.find((row) => row.formId === state.lastOpenedFormId) || null;
  const fallbackRow = matchedRow || (state.rows.length === 1 ? state.rows[0] : null);
  if (fallbackRow) {
    state.selectedTaskId = fallbackRow.taskId;
    state.selectedTaskIds = [fallbackRow.taskId];
    renderTable();
  }
  await openIframe({
    source: 'last-form-reopen',
    formId: state.lastOpenedFormId,
    taskId: fallbackRow?.taskId || state.iframeMeta?.taskId || null,
  });
}

async function handleRoleSwitch(role: SimulatorPmsUser): Promise<void> {
  if (role === state.currentPmsUser) return;
  state.currentPmsUser = role;
  state.sidePanelDraftComment = '';
  closeIframe();
  state.selectedTaskId = null;
  state.selectedTaskIds = [];
  resetDiagnosticsState();
  renderTable();
  renderDiagnostics();
  renderSidePanelState();
  persistSimulatorSession();
  await refreshList();
}

function openWorkflowDialog(action: WorkflowMutationAction): void {
  const workflowRoleState = resolveCurrentWorkflowRoleState();
  const currentWorkflowRole = workflowRoleState.workflowRole;
  const accessState = resolveWorkflowAccessState(workflowRoleState);
  const syncDrivenAction = shouldUseSyncOnlyWorkflowAction({
    passiveWorkflowMode: PASSIVE_WORKFLOW_MODE,
    currentPmsUser: state.currentPmsUser,
    currentWorkflowRole,
    sidePanelMode: state.sidePanelMode,
    action,
  });

  if (!accessState.access.canMutateWorkflow) {
    state.workflowAction.lastAction = action;
    state.workflowAction.lastOk = false;
    state.workflowAction.lastMessage = accessState.access.reason;
    state.workflowAction.lastAt = Date.now();
    state.diagnostics.error = accessState.access.reason;
    renderActionStates();
    renderDiagnostics();
    renderSidePanelState();
    return;
  }

  if (PASSIVE_WORKFLOW_MODE && !syncDrivenAction) {
    state.workflowAction.lastAction = action;
    state.workflowAction.lastOk = false;
    state.workflowAction.lastMessage = '当前为外部流程模式；当前上下文未形成可执行的 workflow/sync 动作。';
    state.workflowAction.lastAt = Date.now();
    state.diagnostics.error = state.workflowAction.lastMessage;
    renderActionStates();
    renderDiagnostics();
    renderSidePanelState();
    return;
  }

  const context = resolveWorkflowContext();
  if (PASSIVE_WORKFLOW_MODE && syncDrivenAction && !context.formId) {
    state.workflowAction.lastAction = action;
    state.workflowAction.lastOk = false;
    state.workflowAction.lastMessage = '缺少 form_id，请先在嵌入页保存编校审数据后再执行 workflow/sync。';
    state.workflowAction.lastAt = Date.now();
    state.diagnostics.error = state.workflowAction.lastMessage;
    renderActionStates();
    renderDiagnostics();
    renderSidePanelState();
    return;
  }

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
    if (state.workflowAction.lastOk === true) {
      closeWorkflowDialog();
    } else {
      state.workflowDialog.error = state.workflowAction.lastMessage || '当前动作未完成。';
      renderWorkflowDialogState();
    }
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
  await executeWorkflowAction(message.action, comments, targetNode, {
    taskId,
    formId,
    skipPlatformTaskTransition: true,
  });
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
  renderProjectOptions();
  window.addEventListener('message', handleWindowMessage);

  for (const btn of Array.from(refs.roleButtons.querySelectorAll<HTMLButtonElement>('button[data-role]'))) {
    btn.addEventListener('click', async () => {
      const role = btn.dataset.role as SimulatorPmsUser | undefined;
      if (!role) return;
      await handleRoleSwitch(role);
    });
  }

  refs.projectInput.addEventListener('change', async () => {
    state.projectId = resolveEffectiveProjectId(refs.projectInput.value);
    renderProjectOptions();
    persistSimulatorSession();
    closeIframe();
    await refreshList();
  });

  refs.createBtn.addEventListener('click', async () => {
    await openIframe({ source: 'new' });
  });

  refs.deleteBtn.addEventListener('click', async () => {
    const selectedTaskIds = [...state.selectedTaskIds];
    if (!selectedTaskIds.length) {
      if (!state.rows.length) return;
      await deleteTasks(state.rows.map((row) => row.taskId));
      return;
    }
    await deleteTasks(selectedTaskIds);
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

  const platformToggle = document.getElementById('platform-params-toggle');
  const platformBody = document.getElementById('platform-params-body');
  if (platformToggle && platformBody) {
    platformToggle.addEventListener('click', () => {
      const isHidden = platformBody.style.display === 'none';
      platformBody.style.display = isHidden ? 'grid' : 'none';
      const arrow = platformToggle.querySelector('span');
      if (arrow) {
        arrow.textContent = arrow.textContent.replace(/^[▸▾]/, isHidden ? '▾' : '▸');
      }
    });
  }

  const platformWorkflowModeEl = document.getElementById('platform-workflow-mode') as HTMLSelectElement | null;
  const platformEmbedTokenEl = document.getElementById('platform-embed-token') as HTMLInputElement | null;
  const platformExtraParamsEl = document.getElementById('platform-extra-params') as HTMLTextAreaElement | null;
  const platformWorkflowMetadataEl = document.getElementById('platform-workflow-metadata') as HTMLTextAreaElement | null;
  const platformCacheBtn = document.getElementById('platform-cache-preload-btn') as HTMLButtonElement | null;
  const platformDeleteBtn = document.getElementById('platform-delete-btn') as HTMLButtonElement | null;
  const platformApiFeedback = document.getElementById('platform-api-feedback') as HTMLSpanElement | null;

  const platformModeWarning = document.getElementById('platform-mode-warning') as HTMLDivElement | null;

  function applyWorkflowModeSwitch(modeValue: string): void {
    state.platformEmbedWorkflowMode = modeValue;
    const effectiveMode = modeValue
      ? resolveWorkflowMode({ verifiedWorkflowMode: modeValue })
      : resolveWorkflowMode();
    PASSIVE_WORKFLOW_MODE = effectiveMode === 'external';

    if (platformModeWarning) {
      if (modeValue && modeValue !== 'external') {
        platformModeWarning.hidden = false;
        platformModeWarning.textContent =
          `⚠ 当前 workflow_mode="${modeValue}"（非 external）：与真实 PMS 默认行为不一致，仅用于验证 plant3d 内部按钮流程。`;
      } else {
        platformModeWarning.hidden = true;
      }
    }

    renderSidePanelState();
    renderDiagnostics();
  }

  platformWorkflowModeEl?.addEventListener('change', () => {
    applyWorkflowModeSwitch(platformWorkflowModeEl.value);
  });

  const pmsLikeIframeEl = document.getElementById('pms-like-iframe-query') as HTMLInputElement | null;
  if (pmsLikeIframeEl) {
    pmsLikeIframeEl.checked = state.pmsLikeIframeQuery;
    pmsLikeIframeEl.addEventListener('change', () => {
      state.pmsLikeIframeQuery = pmsLikeIframeEl.checked;
      try {
        localStorage.setItem(PMS_LIKE_IFRAME_QUERY_STORAGE_KEY, state.pmsLikeIframeQuery ? '1' : '0');
      } catch {
        // ignore
      }
      renderDiagnostics();
    });
  }

  platformEmbedTokenEl?.addEventListener('input', () => {
    state.platformEmbedToken = platformEmbedTokenEl.value;
  });
  platformExtraParamsEl?.addEventListener('input', () => {
    state.platformEmbedExtraParameters = platformExtraParamsEl.value;
  });
  platformWorkflowMetadataEl?.addEventListener('input', () => {
    state.platformWorkflowMetadata = platformWorkflowMetadataEl.value;
  });

  function updatePlatformApiButtons(): void {
    const hasToken = Boolean(state.embedToken?.trim());
    if (platformCacheBtn) platformCacheBtn.disabled = !hasToken;
    if (platformDeleteBtn) platformDeleteBtn.disabled = !hasToken && !state.lastOpenedFormId;
    if (platformApiFeedback) {
      platformApiFeedback.textContent = hasToken ? `token 就绪（${state.embedToken!.slice(0, 12)}…）` : 'token 可用后启用';
    }
  }

  const updateBtnsInterval = setInterval(updatePlatformApiButtons, 2000);
  void updateBtnsInterval;

  platformCacheBtn?.addEventListener('click', async () => {
    if (!state.embedToken?.trim()) return;
    const base = getBackendApiBaseUrl({ fallbackUrl: 'http://localhost:3100' }).replace(/\/$/, '');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const authToken = getAuthToken();
    if (authToken) headers.Authorization = `Bearer ${authToken}`;
    const body = JSON.stringify({
      project_id: state.projectId,
      initiator: state.currentPmsUser,
      token: state.embedToken,
    });
    try {
      const resp = await fetch(`${base}/api/review/cache/preload`, { method: 'POST', headers, body });
      const result = await resp.json().catch(() => ({ code: resp.status }));
      if (platformApiFeedback) {
        platformApiFeedback.textContent = `cache/preload → ${resp.status} code=${result.code ?? '?'}`;
        platformApiFeedback.style.color = resp.ok ? 'var(--success)' : 'var(--danger)';
      }
    } catch (error) {
      if (platformApiFeedback) {
        platformApiFeedback.textContent = `cache/preload 失败：${error instanceof Error ? error.message : String(error)}`;
        platformApiFeedback.style.color = 'var(--danger)';
      }
    }
  });

  platformDeleteBtn?.addEventListener('click', async () => {
    const formIds: string[] = [];
    if (state.lastOpenedFormId) formIds.push(state.lastOpenedFormId);
    if (!formIds.length) return;
    const confirmed = confirm(`确认调用平台 DELETE 接口删除 form_ids=[${formIds.join(', ')}]？此操作不可撤销。`);
    if (!confirmed) return;
    const base = getBackendApiBaseUrl({ fallbackUrl: 'http://localhost:3100' }).replace(/\/$/, '');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const authToken = getAuthToken();
    if (authToken) headers.Authorization = `Bearer ${authToken}`;
    const body = JSON.stringify({
      form_ids: formIds,
      operator_id: state.currentPmsUser,
      token: state.embedToken || '',
    });
    try {
      const resp = await fetch(`${base}/api/review/delete`, { method: 'POST', headers, body });
      const result = await resp.json().catch(() => ({ code: resp.status }));
      if (platformApiFeedback) {
        platformApiFeedback.textContent = `delete → ${resp.status} code=${result.code ?? '?'}`;
        platformApiFeedback.style.color = resp.ok ? 'var(--success)' : 'var(--danger)';
      }
    } catch (error) {
      if (platformApiFeedback) {
        platformApiFeedback.textContent = `delete 失败：${error instanceof Error ? error.message : String(error)}`;
        platformApiFeedback.style.color = 'var(--danger)';
      }
    }
  });
}

function initCdpEnvPresets(): void {
  const query = new URLSearchParams(window.location.search);

  function readPreset(queryAliases: string[], localStorageKey?: string): string {
    for (const alias of queryAliases) {
      const v = query.get(alias);
      if (v?.trim()) return v.trim();
    }
    if (localStorageKey) {
      try {
        const v = localStorage.getItem(localStorageKey);
        if (v?.trim()) return v.trim();
      } catch { /* ignore */ }
    }
    return '';
  }

  const branRefno = readPreset(['bran_refno', 'PMS_TARGET_BRAN_REFNO'], 'pms_target_bran_refno');
  const packageName = readPreset(['package_name', 'PMS_MOCK_PACKAGE_NAME'], 'pms_mock_package_name');
  const embedSite = readPreset(['embed_site', 'PMS_EMBEDDED_SITE_SUBSTRING'], 'pms_embedded_site_substring');

  const branEl = document.getElementById('platform-env-bran') as HTMLInputElement | null;
  const packageEl = document.getElementById('platform-env-package') as HTMLInputElement | null;
  const embedSiteEl = document.getElementById('platform-env-embed-site') as HTMLInputElement | null;
  const cdpModeEl = document.getElementById('platform-env-cdp-mode') as HTMLInputElement | null;

  if (branEl && branRefno) branEl.value = branRefno;
  if (packageEl && packageName) packageEl.value = packageName;
  if (embedSiteEl && embedSite) embedSiteEl.value = embedSite;
  if (cdpModeEl) cdpModeEl.value = state.platformEmbedWorkflowMode || 'external';
}

async function bootstrap(): Promise<void> {
  if (document.readyState === 'loading') {
    await new Promise<void>((resolve) => {
      document.addEventListener('DOMContentLoaded', () => resolve(), { once: true });
    });
  }

  if (!isSimulatorDebugUiEnabled()) {
    document.body.innerHTML = `
      <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;background:#eef2f6;color:#21364d;font-family:'Microsoft YaHei','PingFang SC','SimSun',sans-serif;">
        <div style="max-width:560px;width:100%;background:#ffffff;border:1px solid #d7e0ea;border-radius:8px;padding:28px 24px;box-shadow:0 12px 32px rgba(13,39,64,0.08);">
          <div style="font-size:20px;font-weight:700;">PMS 调试模拟器已受限</div>
          <div style="margin-top:12px;font-size:14px;line-height:1.7;color:#4c6278;">
            当前环境默认不开放此调试页面。需要显式开启时，请使用 <code>?debug_ui=1</code>，
            或在浏览器存储中设置 <code>plant3d_debug_ui=1</code> 后再访问。
          </div>
        </div>
      </div>
    `;
    return;
  }

  await new Promise((resolve) => setTimeout(resolve, 100));

  initRefs();
  bindEvents();

  const initialWorkflowMode = resolveWorkflowMode();
  state.platformEmbedWorkflowMode = initialWorkflowMode;
  PASSIVE_WORKFLOW_MODE = initialWorkflowMode === 'external';
  const platformWorkflowModeEl = document.getElementById('platform-workflow-mode') as HTMLSelectElement | null;
  if (platformWorkflowModeEl) {
    platformWorkflowModeEl.value = initialWorkflowMode;
  }

  initCdpEnvPresets();

  renderRoleHeader();
  renderLastOpened();
  renderActionStates();
  resetDiagnosticsState();
  renderDiagnostics();
  renderIframeState();
  renderSidePanelState();
  renderWorkflowDialogState();
  await loadAvailableProjects();
  await refreshList();
  await restorePersistedIframeIfNeeded();
  exposeSimulatorTestApi();
  (window as Window & {
    __pmsReviewSimulatorReady?: boolean;
    __pmsReviewSimulatorTest?: SimulatorTestApi;
  }).__pmsReviewSimulatorReady = true;
}

void bootstrap();
