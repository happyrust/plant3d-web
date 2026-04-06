import { computed, ref, watch } from 'vue';

import {
  authGetToken,
  reviewTaskCreate,
  reviewTaskGetList,
  reviewTaskGetById,
  reviewTaskUpdate,
  reviewTaskDelete,
  reviewTaskStartReview,
  reviewTaskApprove,
  reviewTaskCancel,
  reviewTaskSubmitToNext,
  reviewTaskReturn,
  reviewTaskGetWorkflow,
  type TokenRequest,
  type WorkflowHistoryResponse,
  userGetList,
  userGetCurrent,
  userGetReviewers,
  getReviewWebSocketUrl,
  getReviewUserWebSocketUrl,
  type ReviewTaskCreateRequest,
} from '@/api/reviewApi';
import { isCanonicalReturnedTask } from '@/components/review/reviewTaskFilters';
import {
  fromBackendRole,
  type ReviewComponent,
  type ReviewAttachment,
  type ReviewTask,
  type User,
  type WorkflowNode,
  type WorkflowStep,
  UserRole,
  UserStatus,
  toBackendRole,
} from '@/types/auth';

type UserPersistedState = {
  version: 3;
  currentUserId: string | null;
  useBackend: boolean;
  reviewTasks: ReviewTask[];
};

const STORAGE_KEY = 'plant3d-web-user-v3';
const STORAGE_KEY_V2 = 'plant3d-web-user-v2';
const STORAGE_KEY_V1 = 'plant3d-web-user-v1';
const DEFAULT_REVIEW_PROJECT_ID = 'debug-project';

const LOCAL_REVIEW_IDENTITY_ALIASES: Record<string, string> = {
  reviewer_001: 'user-002',
};

// 配置：是否使用后端 API
const USE_BACKEND = ref(true);

// 四段角色：编制(sj) -> 校核(jd) -> 审核(sh) -> 批准(pz)
const WORKFLOW_NODE_ORDER: WorkflowNode[] = ['sj', 'jd', 'sh', 'pz'];

function isKnownUserRole(role: string): role is UserRole {
  return (Object.values(UserRole) as string[]).includes(role);
}

function normalizeUserStatus(status: unknown): UserStatus {
  const value = typeof status === 'string' ? status : UserStatus.ACTIVE;
  return (Object.values(UserStatus) as string[]).includes(value)
    ? (value as UserStatus)
    : UserStatus.ACTIVE;
}

function normalizeUserDate(value: unknown): Date | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return value;

  const parsed = new Date(value as string | number);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

export function normalizeBackendUser(raw: Partial<User> & Record<string, unknown>): User {
  const id = String(raw.id || raw.username || '');
  const username = String(raw.username || raw.id || '');
  const email = String(raw.email || `${username || id || 'user'}@example.com`);
  const name = String(raw.name || raw.username || raw.id || '未命名用户');
  const rawRole = String(raw.role || UserRole.VIEWER).toLowerCase();
  const role = isKnownUserRole(rawRole) ? rawRole : fromBackendRole(rawRole);

  return {
    id,
    username,
    email,
    name,
    role,
    department: typeof raw.department === 'string' ? raw.department : undefined,
    phone: typeof raw.phone === 'string' ? raw.phone : undefined,
    status: normalizeUserStatus(raw.status),
    createdAt: normalizeUserDate(raw.createdAt || raw.created_at) || new Date(),
    updatedAt: normalizeUserDate(raw.updatedAt || raw.updated_at) || new Date(),
    lastLoginAt: normalizeUserDate(raw.lastLoginAt || raw.last_login_at),
  };
}

export function resolveReviewProjectIdFromSession(
  sessionStorageLike?: Pick<Storage, 'getItem'>,
): string {
  const storage = sessionStorageLike ?? (typeof sessionStorage !== 'undefined' ? sessionStorage : undefined);
  if (!storage) return DEFAULT_REVIEW_PROJECT_ID;

  try {
    const raw = storage.getItem('embed_mode_params');
    if (!raw) return DEFAULT_REVIEW_PROJECT_ID;
    const parsed = JSON.parse(raw) as {
      projectId?: string | null;
      verifiedClaims?: { projectId?: string | null } | null;
    };
    return parsed.verifiedClaims?.projectId?.trim() || parsed.projectId?.trim() || DEFAULT_REVIEW_PROJECT_ID;
  } catch {
    return DEFAULT_REVIEW_PROJECT_ID;
  }
}

export function buildSwitchUserTokenRequest(
  user: Pick<User, 'id' | 'role'>,
  projectId: string,
): TokenRequest {
  return {
    projectId,
    userId: LOCAL_REVIEW_IDENTITY_ALIASES[user.id] ?? user.id,
    role: toBackendRole(user.role),
  };
}

export function resolveEffectiveUserId(user: Pick<User, 'id'> | null | undefined): string | null {
  if (!user?.id) return null;
  return LOCAL_REVIEW_IDENTITY_ALIASES[user.id] ?? user.id;
}

export function isCheckerRole(role: UserRole | undefined): boolean {
  return role === UserRole.PROOFREADER || role === UserRole.REVIEWER;
}

export function isApproverRole(role: UserRole | undefined): boolean {
  return role === UserRole.MANAGER || role === UserRole.ADMIN;
}

export function getNextWorkflowNode(node?: WorkflowNode): WorkflowNode | null {
  const current = node ?? 'sj';
  const idx = WORKFLOW_NODE_ORDER.indexOf(current);
  if (idx < 0) return 'jd';
  const next = WORKFLOW_NODE_ORDER[idx + 1];
  return next ?? null;
}

export function statusFromNode(node: WorkflowNode): ReviewTask['status'] {
  switch (node) {
    case 'sj':
      return 'rejected';
    case 'jd':
      return 'submitted';
    case 'sh':
      return 'in_review';
    default:
      return 'in_review';
  }
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function normalizeWorkflowStep(raw: unknown): WorkflowStep | null {
  if (!raw || typeof raw !== 'object') return null;

  const record = raw as Record<string, unknown>;
  const node = typeof record.node === 'string' ? record.node : undefined;
  const action = typeof record.action === 'string' ? record.action : undefined;
  const timestamp = toNumber(record.timestamp);

  if (!node || !action || !timestamp) return null;

  return {
    node: node as WorkflowNode,
    action: action as WorkflowStep['action'],
    operatorId: typeof record.operatorId === 'string'
      ? record.operatorId
      : typeof record.operator_id === 'string'
        ? record.operator_id
        : '',
    operatorName: typeof record.operatorName === 'string'
      ? record.operatorName
      : typeof record.operator_name === 'string'
        ? record.operator_name
        : '',
    comment: typeof record.comment === 'string' ? record.comment : undefined,
    timestamp,
  };
}

function isNetworkFailure(error: unknown): boolean {
  if (error instanceof TypeError) return true;

  const message = typeof error === 'string'
    ? error
    : error instanceof Error
      ? error.message
      : '';

  const normalized = message.toLowerCase();
  return (
    normalized.includes('failed to fetch') ||
    normalized.includes('network') ||
    normalized.includes('networkerror')
  );
}

function applyLocalSubmitTransition(task: ReviewTask, comment?: string): ReviewTask {
  const fromNode = task.currentNode ?? 'sj';
  const nextNode = getNextWorkflowNode(fromNode);
  if (!nextNode) return task;

  const operatorId = currentUser.value?.id || 'local';
  const operatorName = currentUser.value?.name || '本地用户';

  const step: WorkflowStep = {
    node: fromNode,
    action: 'submit',
    operatorId,
    operatorName,
    comment,
    timestamp: Date.now(),
  };

  return {
    ...task,
    status: statusFromNode(nextNode),
    currentNode: nextNode,
    workflowHistory: [...(task.workflowHistory || []), step],
    returnReason: undefined,
    updatedAt: Date.now(),
  };
}

export function normalizeReviewTask(raw: unknown): ReviewTask | null {
  if (!raw || typeof raw !== 'object') return null;

  const record = raw as Record<string, unknown>;
  const id = typeof record.id === 'string' ? record.id.trim() : '';
  const title = typeof record.title === 'string' ? record.title : '';
  const description = typeof record.description === 'string' ? record.description : '';
  const modelName = typeof record.modelName === 'string'
    ? record.modelName
    : typeof record.model_name === 'string'
      ? record.model_name
      : '';
  const status = typeof record.status === 'string' ? record.status : 'draft';
  const priority = typeof record.priority === 'string' ? record.priority : 'medium';
  const requesterId = typeof record.requesterId === 'string'
    ? record.requesterId
    : typeof record.requester_id === 'string'
      ? record.requester_id
      : '';
  const requesterName = typeof record.requesterName === 'string'
    ? record.requesterName
    : typeof record.requester_name === 'string'
      ? record.requester_name
      : '';
  const reviewerId = typeof record.reviewerId === 'string'
    ? record.reviewerId
    : typeof record.reviewer_id === 'string'
      ? record.reviewer_id
      : typeof record.checkerId === 'string'
        ? record.checkerId
        : typeof record.checker_id === 'string'
          ? record.checker_id
          : '';
  const reviewerName = typeof record.reviewerName === 'string'
    ? record.reviewerName
    : typeof record.reviewer_name === 'string'
      ? record.reviewer_name
      : typeof record.checkerName === 'string'
        ? record.checkerName
        : typeof record.checker_name === 'string'
          ? record.checker_name
          : '';
  const fallbackReviewerId = currentUser.value?.id ?? 'unknown-reviewer';
  const fallbackReviewerName = currentUser.value?.name ?? '未知用户';
  const createdAt = toNumber(record.createdAt ?? record.created_at) ?? Date.now();
  const updatedAt = toNumber(record.updatedAt ?? record.updated_at) ?? createdAt;
  const checkerId = typeof record.checkerId === 'string'
    ? record.checkerId
    : typeof record.checker_id === 'string'
      ? record.checker_id
      : reviewerId;
  const checkerName = typeof record.checkerName === 'string'
    ? record.checkerName
    : typeof record.checker_name === 'string'
      ? record.checker_name
      : reviewerName;
  const approverId = typeof record.approverId === 'string'
    ? record.approverId
    : typeof record.approver_id === 'string'
      ? record.approver_id
      : undefined;
  const approverName = typeof record.approverName === 'string'
    ? record.approverName
    : typeof record.approver_name === 'string'
      ? record.approver_name
      : undefined;

  const validStatuses: ReviewTask['status'][] = ['draft', 'submitted', 'in_review', 'approved', 'rejected', 'cancelled'];
  const validPriorities: ReviewTask['priority'][] = ['low', 'medium', 'high', 'urgent'];
  if (!id || !title) {
    return null;
  }
  if (!validStatuses.includes(status as ReviewTask['status'])) return null;
  if (!validPriorities.includes(priority as ReviewTask['priority'])) return null;

  const workflowHistory = Array.isArray(record.workflowHistory ?? record.workflow_history)
    ? (record.workflowHistory ?? record.workflow_history as unknown[])
      .map((item) => normalizeWorkflowStep(item))
      .filter((item): item is WorkflowStep => item !== null)
    : undefined;

  return {
    id,
    formId: typeof record.formId === 'string'
      ? record.formId
      : typeof record.form_id === 'string'
        ? record.form_id
        : undefined,
    title,
    description,
    modelName: modelName || title,
    status: status as ReviewTask['status'],
    priority: priority as ReviewTask['priority'],
    requesterId: requesterId || currentUser.value?.id || 'unknown-requester',
    requesterName: requesterName || currentUser.value?.name || '未知用户',
    checkerId,
    checkerName,
    approverId,
    approverName,
    reviewerId: reviewerId || checkerId || fallbackReviewerId,
    reviewerName: reviewerName || checkerName || fallbackReviewerName,
    components: Array.isArray(record.components) ? record.components as ReviewComponent[] : [],
    attachments: Array.isArray(record.attachments) ? record.attachments as ReviewAttachment[] : undefined,
    reviewComment: typeof record.reviewComment === 'string'
      ? record.reviewComment
      : typeof record.review_comment === 'string'
        ? record.review_comment
        : undefined,
    createdAt,
    updatedAt,
    dueDate: toNumber(record.dueDate ?? record.due_date),
    currentNode: (typeof record.currentNode === 'string'
      ? record.currentNode
      : typeof record.current_node === 'string'
        ? record.current_node
        : undefined) as WorkflowNode | undefined,
    workflowHistory,
    returnReason: typeof record.returnReason === 'string'
      ? record.returnReason
      : typeof record.return_reason === 'string'
        ? record.return_reason
        : undefined,
  };
}

// 模拟用户数据（后端不可用时使用）
const mockUsers: User[] = [
  {
    id: 'designer_001',
    username: 'designer',
    email: 'designer@company.com',
    name: '王设计师',
    role: UserRole.DESIGNER,
    department: '设计部',
    phone: '13800138004',
    status: UserStatus.ACTIVE,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date(),
    lastLoginAt: new Date(),
  },
  {
    id: 'reviewer_001',
    username: 'reviewer',
    email: 'reviewer@company.com',
    name: '李审核员',
    role: UserRole.REVIEWER,
    department: '技术部',
    phone: '13800138002',
    status: UserStatus.ACTIVE,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date(),
    lastLoginAt: new Date(),
  },
  {
    id: 'proofreader_001',
    username: 'proofreader',
    email: 'proofreader@company.com',
    name: '张校对员',
    role: UserRole.PROOFREADER,
    department: '质量部',
    phone: '13800138003',
    status: UserStatus.ACTIVE,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date(),
    lastLoginAt: new Date(),
  },
  {
    id: 'manager_001',
    username: 'manager',
    email: 'manager@company.com',
    name: '陈经理',
    role: UserRole.MANAGER,
    department: '工程部',
    phone: '13800138001',
    status: UserStatus.ACTIVE,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date(),
    lastLoginAt: new Date(),
  },
  {
    id: 'admin_001',
    username: 'admin',
    email: 'admin@company.com',
    name: '系统管理员',
    role: UserRole.ADMIN,
    department: '信息技术部',
    phone: '13800138000',
    status: UserStatus.ACTIVE,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date(),
    lastLoginAt: new Date(),
  },
];

// 获取可分配的审核人员列表
const mockReviewerUsers = mockUsers.filter((u) =>
  [UserRole.ADMIN, UserRole.MANAGER, UserRole.REVIEWER, UserRole.PROOFREADER].includes(u.role)
);

function loadPersisted(): UserPersistedState {
  if (typeof localStorage === 'undefined') {
    return { version: 3, currentUserId: 'designer_001', useBackend: true, reviewTasks: [] };
  }

  try {
    // 尝试加载 V3
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as UserPersistedState;
      if (parsed.version === 3) {
        return {
          version: 3,
          currentUserId: parsed.currentUserId || 'designer_001',
          useBackend: parsed.useBackend ?? true,
          reviewTasks: Array.isArray(parsed.reviewTasks) ? parsed.reviewTasks : [],
        };
      }
    }

    // 兼容 V2
    const rawV2 = localStorage.getItem(STORAGE_KEY_V2);
    if (rawV2) {
      const parsed = JSON.parse(rawV2);
      if (parsed.version === 2) {
        return {
          version: 3,
          currentUserId: parsed.currentUserId || 'designer_001',
          useBackend: parsed.useBackend ?? true,
          reviewTasks: [], // V2 没有 reviewTasks
        };
      }
    }

    // 兼容 V1
    const rawV1 = localStorage.getItem(STORAGE_KEY_V1);
    if (rawV1) {
      const parsed = JSON.parse(rawV1);
      if (parsed.version === 1) {
        return {
          version: 3,
          currentUserId: parsed.currentUserId || 'designer_001',
          useBackend: true,
          reviewTasks: [],
        };
      }
    }
  } catch (e) {
    console.warn('[useUserStore] Failed to load persisted state:', e);
  }

  return { version: 3, currentUserId: 'designer_001', useBackend: true, reviewTasks: [] };
}

function savePersisted(state: Partial<UserPersistedState> & { version: 3 }): void {
  if (typeof localStorage === 'undefined') return;
  try {
    // 合并现有状态
    const current = loadPersisted();
    const merged: UserPersistedState = {
      version: 3,
      currentUserId: state.currentUserId ?? current.currentUserId,
      useBackend: state.useBackend ?? current.useBackend,
      reviewTasks: state.reviewTasks ?? current.reviewTasks,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
  } catch (e) {
    console.warn('[useUserStore] Failed to save persisted state:', e);
  }
}

// 全局状态
const persistedState = loadPersisted();
USE_BACKEND.value = persistedState.useBackend;
const currentUserId = ref<string | null>(persistedState.currentUserId);
const reviewTasks = ref<ReviewTask[]>(persistedState.reviewTasks);
const users = ref<User[]>(mockUsers);
const reviewerUsers = ref<User[]>(mockReviewerUsers);
const loading = ref(false);
const error = ref<string | null>(null);
const backendCurrentUserResolved = ref(false);

// WebSocket 连接状态
const wsConnected = ref(false);
const wsError = ref<string | null>(null);
let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectCount = 0;
let wsUserId: string | null = null;
let refreshPromise: Promise<void> | null = null;
const MAX_RECONNECT = 5;
const RECONNECT_DELAY = 3000;

// 计算属性
const currentUser = computed<User | null>(() => {
  if (!currentUserId.value) return null;
  return users.value.find((u) => u.id === currentUserId.value) || null;
});

const isDesigner = computed(() => {
  return currentUser.value?.role === UserRole.DESIGNER;
});

const isReviewer = computed(() => {
  const role = currentUser.value?.role;
  return (
    role === UserRole.ADMIN ||
    role === UserRole.MANAGER ||
    role === UserRole.REVIEWER ||
    role === UserRole.PROOFREADER
  );
});

const isChecker = computed(() => isCheckerRole(currentUser.value?.role));
const isApprover = computed(() => isApproverRole(currentUser.value?.role));

const availableUsers = computed(() => users.value);

const availableReviewers = computed(() => reviewerUsers.value);
const availableCheckers = computed(() => reviewerUsers.value.filter((u) => isCheckerRole(u.role)));
const availableApprovers = computed(() => reviewerUsers.value.filter((u) => isApproverRole(u.role)));

const reviewerInboxStatuses: ReviewTask['status'][] = ['submitted', 'in_review', 'approved', 'rejected'];

// 当前用户的待审核任务（作为审核人员）
const pendingReviewTasks = computed(() => {
  if (!currentUser.value) return [];
  const uid = resolveEffectiveUserId(currentUser.value);
  if (!uid) return [];
  return reviewTasks.value.filter((t) => {
    const node = t.currentNode ?? 'sj';
    const checkerId = resolveEffectiveUserId({ id: t.checkerId || t.reviewerId });
    const approverId = resolveEffectiveUserId(t.approverId ? { id: t.approverId } : null);

    if (isChecker.value) {
      return checkerId === uid && node === 'jd' && reviewerInboxStatuses.includes(t.status);
    }
    if (isApprover.value) {
      return approverId === uid
        && (node === 'sh' || node === 'pz')
        && reviewerInboxStatuses.includes(t.status);
    }
    return false;
  });
});

// 当前用户发起的任务（作为设计人员）
const myInitiatedTasks = computed(() => {
  if (!currentUser.value) return [];
  return reviewTasks.value.filter((t) => t.requesterId === currentUser.value!.id);
});

const returnedInitiatedTasks = computed(() => myInitiatedTasks.value.filter((task) => isCanonicalReturnedTask(task)));

// 持久化 currentUserId
watch(
  currentUserId,
  () => {
    savePersisted({
      version: 3,
      currentUserId: currentUserId.value,
      useBackend: USE_BACKEND.value,
      reviewTasks: reviewTasks.value,
    });
  }
);

// 持久化 reviewTasks
watch(
  reviewTasks,
  (tasks) => {
    savePersisted({
      version: 3,
      currentUserId: currentUserId.value,
      useBackend: USE_BACKEND.value,
      reviewTasks: tasks,
    });
  },
  { deep: true }
);

// ============ 用户管理 ============

async function loadUsers(): Promise<void> {
  if (!USE_BACKEND.value) {
    users.value = mockUsers;
    return;
  }

  loading.value = true;
  error.value = null;
  try {
    const response = await userGetList();
    if (response.success && response.users) {
      users.value = response.users.map((user) => normalizeBackendUser(user as Partial<User> & Record<string, unknown>));
    } else {
      throw new Error(response.error_message || '加载用户列表失败');
    }
  } catch (e) {
    console.warn('[useUserStore] Failed to load users, using mock data:', e);
    users.value = mockUsers;
  } finally {
    loading.value = false;
  }
}

async function loadReviewers(): Promise<void> {
  if (!USE_BACKEND.value) {
    reviewerUsers.value = mockReviewerUsers;
    return;
  }

  loading.value = true;
  try {
    const response = await userGetReviewers();
    if (response.success && response.users) {
      reviewerUsers.value = response.users.map((user) => normalizeBackendUser(user as Partial<User> & Record<string, unknown>));
    } else {
      reviewerUsers.value = mockReviewerUsers;
    }
  } catch (e) {
    console.warn('[useUserStore] Failed to load reviewers, using mock data:', e);
    reviewerUsers.value = mockReviewerUsers;
  } finally {
    loading.value = false;
  }
}

async function loadCurrentUser(): Promise<void> {
  if (!USE_BACKEND.value) return;

  backendCurrentUserResolved.value = false;
  try {
    const response = await userGetCurrent();
    if (response.success && response.user) {
      const normalizedUser = normalizeBackendUser(response.user as Partial<User> & Record<string, unknown>);
      // Prefer the locally selected alias when the backend returns the canonical id,
      // so computed role gates still point at the correct frontend identity.
      const existingUser = users.value.find((u) => resolveEffectiveUserId(u) === normalizedUser.id);
      const effectiveUserId = existingUser?.id ?? normalizedUser.id;
      currentUserId.value = effectiveUserId;

      const mergedUser = existingUser
        ? {
          ...existingUser,
          ...normalizedUser,
          id: effectiveUserId,
          role: existingUser.role,
        }
        : normalizedUser;

      // 确保用户在列表中
      const existingIndex = users.value.findIndex((u) => u.id === effectiveUserId);
      if (existingIndex >= 0) {
        users.value[existingIndex] = mergedUser;
      } else {
        users.value.push(mergedUser);
      }
      backendCurrentUserResolved.value = true;
    }
  } catch (e) {
    console.warn('[useUserStore] Failed to load current user:', e);
  }
}

function clearCurrentUserSelection(): void {
  disconnectWebSocket();
  backendCurrentUserResolved.value = false;
  currentUserId.value = null;
  reviewTasks.value = [];
}

async function switchUser(userId: string): Promise<void> {
  const user = users.value.find((u) => u.id === userId);
  if (!user) return;

  if (USE_BACKEND.value) {
    try {
      const projectId = resolveReviewProjectIdFromSession();
      await authGetToken(buildSwitchUserTokenRequest(user, projectId));
      await loadCurrentUser();
    } catch (e) {
      console.warn('[useUserStore] Failed to switch backend auth user:', e);
      return;
    }
  } else {
    currentUserId.value = userId;
  }

  currentUserId.value = userId;
  console.log(`[useUserStore] Switched to user: ${user.name} (${user.role})`);
  await loadReviewTasks();
  connectWebSocket();
}

// ============ 任务管理 ============

async function loadReviewTasks(): Promise<void> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    if (!USE_BACKEND.value) return;

    loading.value = true;
    error.value = null;
    try {
      const effectiveUserId = resolveEffectiveUserId(currentUser.value);
      const queryRole = currentUser.value?.role;
      const requesterId = currentUser.value?.role === UserRole.DESIGNER
        ? resolveEffectiveUserId(currentUser.value)
        : undefined;
      const response = await reviewTaskGetList(
        isCheckerRole(queryRole)
          ? { checkerId: effectiveUserId ?? undefined }
          : isApproverRole(queryRole)
            ? { approverId: effectiveUserId ?? undefined }
            : requesterId
              ? { requesterId }
              : undefined
      );
      if (response.success) {
        const normalizedTasks = (response.tasks || [])
          .map((task) => normalizeReviewTask(task))
          .filter((task): task is ReviewTask => task !== null);

        // Designer queries fetch the requester-scoped slice, so merge it to retain any task state
        // that arrived via websocket or local transitions until the backend reflects it.
        if (currentUser.value?.role === UserRole.DESIGNER) {
          const preservedDesignerTasks = reviewTasks.value.filter((task) => task.requesterId === currentUser.value?.id);
          const mergedTasks = new Map<string, ReviewTask>();

          for (const task of preservedDesignerTasks) {
            mergedTasks.set(task.id, task);
          }
          for (const task of normalizedTasks) {
            const existingTask = mergedTasks.get(task.id);
            mergedTasks.set(task.id, existingTask ? { ...existingTask, ...task } : task);
          }

          reviewTasks.value = Array.from(mergedTasks.values()).sort((a, b) => b.updatedAt - a.updatedAt);
        } else {
          reviewTasks.value = normalizedTasks;
        }
      } else {
        throw new Error(response.error_message || '加载任务列表失败');
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : '加载任务列表失败';
    } finally {
      loading.value = false;
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

async function createReviewTask(data: {
  title: string;
  description: string;
  modelName: string;
  checkerId: string;
  approverId: string;
  priority: ReviewTask['priority'];
  components: ReviewComponent[];
  dueDate?: number;
  formId?: string;
  attachments?: ReviewAttachment[];
}): Promise<ReviewTask> {
  const user = currentUser.value;
  if (!user) throw new Error('No user logged in');

  const buildLocalTask = (): ReviewTask => {
    const checker = users.value.find((u) => u.id === data.checkerId);
    if (!checker) throw new Error('Checker not found');
    const approver = users.value.find((u) => u.id === data.approverId);
    if (!approver) throw new Error('Approver not found');

    return {
      id: `task-${Date.now()}`,
      formId: data.formId,
      title: data.title,
      description: data.description,
      modelName: data.modelName,
      status: 'draft',
      priority: data.priority,
      requesterId: user.id,
      requesterName: user.name,
      checkerId: data.checkerId,
      checkerName: checker.name,
      approverId: data.approverId,
      approverName: approver.name,
      reviewerId: data.checkerId,
      reviewerName: checker.name,
      components: data.components,
      attachments: data.attachments,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      dueDate: data.dueDate,
      currentNode: 'sj',
      workflowHistory: [],
    };
  };

  if (USE_BACKEND.value) {
    loading.value = true;
    error.value = null;
    try {
      const request: ReviewTaskCreateRequest = {
        title: data.title,
        description: data.description,
        modelName: data.modelName,
        checkerId: data.checkerId,
        approverId: data.approverId,
        reviewerId: data.checkerId,
        formId: data.formId,
        priority: data.priority,
        components: data.components,
        dueDate: data.dueDate,
        attachments: data.attachments,
      };

      const response = await reviewTaskCreate(request);
      if (response.success && response.task) {
        const normalizedTask = normalizeReviewTask(response.task);
        if (!normalizedTask) {
          throw new Error('创建提资单返回了无效任务数据');
        }
        reviewTasks.value = [...reviewTasks.value, normalizedTask];
        console.log('[useUserStore] Created review task:', normalizedTask.title);
        return normalizedTask;
      }
      throw new Error(response.error_message || '创建提资单失败');
    } catch (e) {
      const message = e instanceof Error ? e.message : '创建提资单失败';

      if (!isNetworkFailure(e)) {
        error.value = message;
        throw e instanceof Error ? e : new Error(message);
      }

      console.warn(
        '[useUserStore] Create review task failed, fallback to local mock data due network issue:',
        message
      );
      const localTask = buildLocalTask();
      reviewTasks.value = [...reviewTasks.value, localTask];
      console.log('[useUserStore] Created review task (local fallback):', localTask.title);
      return localTask;
    } finally {
      loading.value = false;
    }
  }

  // 本地模式
  const task = buildLocalTask();
  reviewTasks.value = [...reviewTasks.value, task];
  console.log('[useUserStore] Created review task (local):', task.title);
  return task;
}

async function updateTaskStatus(
  taskId: string,
  status: ReviewTask['status'],
  comment?: string
): Promise<void> {
  if (USE_BACKEND.value) {
    loading.value = true;
    error.value = null;
    try {
      let response;
      switch (status) {
        case 'submitted':
          response = await reviewTaskSubmitToNext(taskId, comment);
          break;
        case 'in_review':
          response = await reviewTaskStartReview(taskId);
          break;
        case 'approved':
          response = await reviewTaskApprove(taskId, comment);
          break;
        case 'rejected':
          response = await reviewTaskReturn(taskId, 'sj', comment || '驳回');
          break;
        case 'cancelled':
          response = await reviewTaskCancel(taskId, comment);
          break;
        default:
          response = await reviewTaskUpdate(taskId, {});
      }

      if (!response.success) {
        throw new Error(response.error_message || '更新任务状态失败');
      }

      // 刷新任务列表
      await loadReviewTasks();
      console.log(`[useUserStore] Updated task ${taskId} status to: ${status}`);
    } catch (e) {
      error.value = e instanceof Error ? e.message : '更新任务状态失败';
      throw e;
    } finally {
      loading.value = false;
    }
    return;
  }

  // 本地模式
  const index = reviewTasks.value.findIndex((t) => t.id === taskId);
  if (index === -1) return;

  const task = reviewTasks.value[index];
  if (!task) return;

  const updated: ReviewTask = {
    ...task,
    status: status === 'rejected' ? 'draft' : status,
    currentNode: status === 'rejected' ? 'sj' : task.currentNode,
    updatedAt: Date.now(),
    reviewComment: comment,
  };
  reviewTasks.value = [
    ...reviewTasks.value.slice(0, index),
    updated,
    ...reviewTasks.value.slice(index + 1),
  ];
  console.log(`[useUserStore] Updated task ${taskId} status to: ${status}`);
}

async function updateTaskAttachments(taskId: string, attachments: ReviewAttachment[]): Promise<void> {
  if (USE_BACKEND.value) {
    loading.value = true;
    error.value = null;
    try {
      const response = await reviewTaskUpdate(taskId, { attachments });
      if (!response.success) {
        throw new Error(response.error_message || '更新任务附件失败');
      }

      if (response.task) {
        const normalizedTask = normalizeReviewTask(response.task);
        if (normalizedTask) {
          reviewTasks.value = reviewTasks.value.map((t) => (t.id === taskId ? normalizedTask : t));
        }
      } else {
        await loadReviewTasks();
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : '更新任务附件失败';

      if (!isNetworkFailure(e)) {
        error.value = message;
        throw e instanceof Error ? e : new Error(message);
      }

      console.warn(
        '[useUserStore] updateTaskAttachments failed, fallback to local attachments on network issue:',
        message
      );

      const idx = reviewTasks.value.findIndex((t) => t.id === taskId);
      const task = idx >= 0 ? reviewTasks.value[idx] : null;
      if (!task) {
        return;
      }

      const updated: ReviewTask = {
        ...task,
        attachments,
        updatedAt: Date.now(),
      };
      reviewTasks.value = [
        ...reviewTasks.value.slice(0, idx),
        updated,
        ...reviewTasks.value.slice(idx + 1),
      ];
      return;
    } finally {
      loading.value = false;
    }
    return;
  }

  const index = reviewTasks.value.findIndex((t) => t.id === taskId);
  if (index === -1) return;
  const task = reviewTasks.value[index];
  if (!task) return;

  const updated: ReviewTask = {
    ...task,
    attachments,
    updatedAt: Date.now(),
  };
  reviewTasks.value = [
    ...reviewTasks.value.slice(0, index),
    updated,
    ...reviewTasks.value.slice(index + 1),
  ];
}

async function submitTaskToNextNode(taskId: string, comment?: string): Promise<void> {
  if (USE_BACKEND.value) {
    loading.value = true;
    error.value = null;
    try {
      const response = await reviewTaskSubmitToNext(taskId, comment);
      if (!response.success) {
        throw new Error(response.error_message || '提交到下一节点失败');
      }
      await loadReviewTasks();
    } catch (e) {
      const message = e instanceof Error ? e.message : '提交到下一节点失败';

      if (!isNetworkFailure(e)) {
        error.value = message;
        throw e instanceof Error ? e : new Error(message);
      }

      const idx = reviewTasks.value.findIndex((t) => t.id === taskId);
      const task = idx >= 0 ? reviewTasks.value[idx] : null;
      if (!task) {
        console.warn(
          '[useUserStore] Submit task fallback skipped: local task not found:',
          taskId
        );
        return;
      }

      const fallback = applyLocalSubmitTransition(task, comment);
      if (fallback === task) {
        return;
      }

      console.warn(
        '[useUserStore] submitTaskToNextNode failed, fallback to local state on network issue:',
        message
      );
      reviewTasks.value = [
        ...reviewTasks.value.slice(0, idx),
        fallback,
        ...reviewTasks.value.slice(idx + 1),
      ];
      return;
    } finally {
      loading.value = false;
    }
    return;
  }

  const idx = reviewTasks.value.findIndex((t) => t.id === taskId);
  const task = idx >= 0 ? reviewTasks.value[idx] : null;
  if (!task) return;

  const fromNode = task.currentNode ?? 'sj';
  const nextNode = getNextWorkflowNode(fromNode);
  if (!nextNode) return;

  const fallback = applyLocalSubmitTransition(task, comment);
  if (fallback === task) return;

  reviewTasks.value = [
    ...reviewTasks.value.slice(0, idx),
    fallback,
    ...reviewTasks.value.slice(idx + 1),
  ];
}

async function returnTaskToNode(taskId: string, targetNode: WorkflowNode, reason: string): Promise<void> {
  if (USE_BACKEND.value) {
    loading.value = true;
    error.value = null;
    try {
      const response = await reviewTaskReturn(taskId, targetNode, reason);
      if (!response.success) {
        throw new Error(response.error_message || '驳回失败');
      }
      await loadReviewTasks();
    } catch (e) {
      error.value = e instanceof Error ? e.message : '驳回失败';
      throw e;
    } finally {
      loading.value = false;
    }
    return;
  }

  const idx = reviewTasks.value.findIndex((t) => t.id === taskId);
  const task = idx >= 0 ? reviewTasks.value[idx] : null;
  if (!task) return;

  const fromNode = task.currentNode ?? 'sj';
  const operatorId = currentUser.value?.id || 'local';
  const operatorName = currentUser.value?.name || '本地用户';

  const step: WorkflowStep = {
    node: fromNode,
    action: 'return',
    operatorId,
    operatorName,
    comment: reason,
    timestamp: Date.now(),
  };

  const updated: ReviewTask = {
    ...task,
    status: statusFromNode(targetNode),
    currentNode: targetNode,
    workflowHistory: [...(task.workflowHistory || []), step],
    returnReason: reason,
    reviewComment: reason,
    updatedAt: Date.now(),
  };

  reviewTasks.value = [
    ...reviewTasks.value.slice(0, idx),
    updated,
    ...reviewTasks.value.slice(idx + 1),
  ];
}

async function getTaskWorkflowHistory(taskId: string): Promise<WorkflowHistoryResponse> {
  if (USE_BACKEND.value) {
    return await reviewTaskGetWorkflow(taskId);
  }

  const task = reviewTasks.value.find((t) => t.id === taskId);
  const currentNode = task?.currentNode ?? 'sj';
  const currentNodeName =
    currentNode === 'sj' ? '编制' : currentNode === 'jd' ? '校对' : currentNode === 'sh' ? '审核' : '批准';

  return {
    success: true,
    currentNode,
    currentNodeName,
    history: (task?.workflowHistory || []) as unknown as WorkflowHistoryResponse['history'],
  };
}

async function deleteTask(taskId: string): Promise<void> {
  if (USE_BACKEND.value) {
    loading.value = true;
    error.value = null;
    try {
      const response = await reviewTaskDelete(taskId);
      if (!response.success) {
        throw new Error(response.error_message || '删除任务失败');
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : '删除任务失败';
      throw e;
    } finally {
      loading.value = false;
    }
  }

  reviewTasks.value = reviewTasks.value.filter((t) => t.id !== taskId);
}

async function getTask(taskId: string): Promise<ReviewTask | undefined> {
  // 先从本地查找
  const local = reviewTasks.value.find((t) => t.id === taskId);
  if (local) return local;

  if (USE_BACKEND.value) {
    try {
      const response = await reviewTaskGetById(taskId);
      if (response.success && response.task) {
        return response.task;
      }
    } catch (e) {
      console.error('[useUserStore] Failed to get task:', e);
    }
  }

  return undefined;
}

// ============ WebSocket 连接 ============

function connectWebSocket() {
  if (!USE_BACKEND.value) return;
  if (ws) return;

  const effectiveUserId = resolveEffectiveUserId(currentUser.value);
  const url = effectiveUserId ? getReviewUserWebSocketUrl(effectiveUserId) : getReviewWebSocketUrl();
  if (!url) {
    wsConnected.value = false;
    wsError.value = null;
    return;
  }

  wsUserId = effectiveUserId;

  try {
    ws = new WebSocket(url);

    ws.onopen = () => {
      wsConnected.value = true;
      wsError.value = null;
      reconnectCount = 0;
      console.log('[useUserStore] WebSocket connected');
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        handleWebSocketMessage(message);
      } catch (e) {
        console.error('[useUserStore] Failed to parse WebSocket message:', e);
      }
    };

    ws.onerror = () => {
      wsError.value = 'WebSocket 连接错误';
    };

    ws.onclose = () => {
      wsConnected.value = false;
      ws = null;

      // 自动重连
      if (wsUserId && reconnectCount < MAX_RECONNECT) {
        reconnectCount++;
        wsError.value = `连接断开，${RECONNECT_DELAY / 1000}秒后重试 (${reconnectCount}/${MAX_RECONNECT})`;
        reconnectTimer = setTimeout(() => {
          connectWebSocket();
        }, RECONNECT_DELAY);
      }
    };
  } catch (e) {
    console.error('[useUserStore] Failed to connect WebSocket:', e);
  }
}

function disconnectWebSocket() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (ws) {
    ws.close();
    ws = null;
  }
  wsConnected.value = false;
  reconnectCount = 0;
  wsUserId = null;
}

function handleWebSocketMessage(message: {
  type: string;
  data: unknown;
  timestamp: string;
}) {
  switch (message.type) {
    case 'task_created': {
      // 新任务通常影响跨角色列表可见性，直接全量刷新。
      loadReviewTasks();
      break;
    }
    case 'task_updated':
    case 'task_submitted':
    case 'task_approved':
    case 'task_rejected':
    case 'task_cancelled': {
      const payloadTask = extractTaskFromWebSocketMessage(message.data);
      if (payloadTask) {
        upsertReviewTask(payloadTask);
      } else {
        loadReviewTasks();
      }
      break;
    }
  }
}

function extractTaskFromWebSocketMessage(data: unknown): ReviewTask | null {
  if (!data || typeof data !== 'object') return null;

  const payload = data as Record<string, unknown>;
  const candidate = payload.task && typeof payload.task === 'object'
    ? payload.task as Record<string, unknown>
    : payload;

  return normalizeReviewTask(candidate);
}

function upsertReviewTask(task: ReviewTask): void {
  const currentId = currentUser.value?.id;
  const effectiveCurrentId = resolveEffectiveUserId(currentUser.value);

  const belongsToDesigner = !!currentId && task.requesterId === currentId;
  const belongsToChecker = !!effectiveCurrentId
    && resolveEffectiveUserId({ id: task.checkerId || task.reviewerId }) === effectiveCurrentId;
  const belongsToApprover = !!effectiveCurrentId
    && resolveEffectiveUserId(task.approverId ? { id: task.approverId } : null) === effectiveCurrentId;

  const isRelevant = belongsToDesigner || belongsToChecker || belongsToApprover;
  const existingIndex = reviewTasks.value.findIndex((item) => item.id === task.id);

  if (!isRelevant) {
    if (existingIndex >= 0) {
      reviewTasks.value = reviewTasks.value.filter((item) => item.id !== task.id);
    }
    return;
  }

  if (existingIndex >= 0) {
    reviewTasks.value = reviewTasks.value.map((item) => (item.id === task.id ? task : item));
    return;
  }

  reviewTasks.value = [task, ...reviewTasks.value];
}

// ============ 外部用户同步（嵌入模式） ============

type EmbedUserOptions = {
  verified?: boolean;
};

function setEmbedUser(externalUserId: string, externalWorkflowRole?: string, options?: EmbedUserOptions): void {
  if (!externalUserId) return;

  const resolvedRole = externalWorkflowRole ? fromBackendRole(externalWorkflowRole) : undefined;
  const verified = options?.verified === true;

  if (!verified && USE_BACKEND.value && backendCurrentUserResolved.value && currentUser.value) {
    console.log(`[useUserStore] 嵌入模式：保留后端当前用户 ${currentUser.value.id}，外部 actor=${externalUserId}, workflowRole=${resolvedRole ?? 'unknown'}`);
    return;
  }

  const existing = users.value.find((u) => u.id === externalUserId || u.username === externalUserId);
  if (existing) {
    if (resolvedRole && existing.role !== resolvedRole) {
      existing.role = resolvedRole;
    }
    currentUserId.value = existing.id;
    console.log(`[useUserStore] 嵌入模式：已切换到已有用户 ${existing.id} (${existing.name}), workflowRole=${existing.role}`);
    return;
  }

  const syntheticUser = normalizeBackendUser({
    id: externalUserId,
    username: externalUserId,
    name: externalUserId,
    role: resolvedRole || UserRole.DESIGNER,
  });
  users.value = [...users.value, syntheticUser];
  currentUserId.value = syntheticUser.id;
  console.log(`[useUserStore] 嵌入模式：已创建并切换到外部用户 ${syntheticUser.id}, workflowRole=${syntheticUser.role}${verified ? ' (verified)' : ''}`);
}

// ============ 初始化 ============

async function initialize(): Promise<void> {
  if (USE_BACKEND.value) {
    await loadUsers();
    await loadReviewers();
    await loadCurrentUser();
    await loadReviewTasks();
    connectWebSocket();
  }
}

// ============ 配置 ============

function setUseBackend(use: boolean) {
  USE_BACKEND.value = use;
  savePersisted({
    version: 3,
    currentUserId: currentUserId.value,
    useBackend: use,
    reviewTasks: use ? [] : reviewTasks.value,
  });

  if (use) {
    initialize();
  } else {
    backendCurrentUserResolved.value = false;
    disconnectWebSocket();
    users.value = mockUsers;
    reviewerUsers.value = mockReviewerUsers;
    reviewTasks.value = [];
  }
}

// 导出 store
export function useUserStore() {
  return {
    // 状态
    currentUser,
    currentUserId,
    isDesigner,
    isReviewer,
    isChecker,
    isApprover,
    availableUsers,
    availableReviewers,
    availableCheckers,
    availableApprovers,
    reviewTasks,
    pendingReviewTasks,
    myInitiatedTasks,
    returnedInitiatedTasks,
    loading,
    error,

    // WebSocket 状态
    wsConnected,
    wsError,

    // 配置
    useBackend: USE_BACKEND,
    setUseBackend,

    // 用户方法
    loadUsers,
    loadReviewers,
    loadCurrentUser,
    clearCurrentUserSelection,
    switchUser,

    // 任务方法
    loadReviewTasks,
    createReviewTask,
    updateTaskStatus,
    updateTaskAttachments,
    submitTaskToNextNode,
    returnTaskToNode,
    getTaskWorkflowHistory,
    deleteTask,
    getTask,

    // WebSocket
    connectWebSocket,
    disconnectWebSocket,

    // 初始化
    initialize,

    // 嵌入模式
    setEmbedUser,
  };
}
