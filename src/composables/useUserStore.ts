import { computed, ref, watch } from 'vue';

import {
  reviewTaskCreate,
  reviewTaskGetList,
  reviewTaskGetById,
  reviewTaskUpdate,
  reviewTaskDelete,
  reviewTaskStartReview,
  reviewTaskApprove,
  reviewTaskReject,
  reviewTaskCancel,
  reviewTaskSubmitToNext,
  reviewTaskReturn,
  reviewTaskGetWorkflow,
  type WorkflowHistoryResponse,
  userGetList,
  userGetCurrent,
  userGetReviewers,
  getReviewWebSocketUrl,
  type ReviewTaskCreateRequest,
} from '@/api/reviewApi';
import {
  type ReviewComponent,
  type ReviewAttachment,
  type ReviewTask,
  type User,
  type WorkflowNode,
  type WorkflowStep,
  UserRole,
  UserStatus,
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

// 配置：是否使用后端 API
const USE_BACKEND = ref(true);

const WORKFLOW_NODE_ORDER: WorkflowNode[] = ['sj', 'jd', 'sh', 'pz'];

function getNextWorkflowNode(node?: WorkflowNode): WorkflowNode | null {
  const current = node ?? 'sj';
  const idx = WORKFLOW_NODE_ORDER.indexOf(current);
  if (idx < 0) return 'jd';
  const next = WORKFLOW_NODE_ORDER[idx + 1];
  return next ?? null;
}

function statusFromNode(node: WorkflowNode): ReviewTask['status'] {
  switch (node) {
    case 'sj':
      return 'draft';
    case 'jd':
      return 'submitted';
    case 'sh':
    case 'pz':
      return 'in_review';
  }
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
const currentUserId = ref<string | null>(persistedState.currentUserId);
const reviewTasks = ref<ReviewTask[]>(persistedState.reviewTasks);
const users = ref<User[]>(mockUsers);
const reviewerUsers = ref<User[]>(mockReviewerUsers);
const loading = ref(false);
const error = ref<string | null>(null);

// WebSocket 连接状态
const wsConnected = ref(false);
const wsError = ref<string | null>(null);
let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectCount = 0;
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

const availableUsers = computed(() => users.value);

const availableReviewers = computed(() => reviewerUsers.value);

// 当前用户的待审核任务（作为审核人员）
const pendingReviewTasks = computed(() => {
  if (!currentUser.value) return [];
  return reviewTasks.value.filter(
    (t) =>
      t.reviewerId === currentUser.value!.id &&
      (t.status === 'submitted' || t.status === 'in_review')
  );
});

// 当前用户发起的任务（作为设计人员）
const myInitiatedTasks = computed(() => {
  if (!currentUser.value) return [];
  return reviewTasks.value.filter((t) => t.requesterId === currentUser.value!.id);
});

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
      users.value = response.users;
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
      reviewerUsers.value = response.users;
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

  try {
    const response = await userGetCurrent();
    if (response.success && response.user) {
      currentUserId.value = response.user.id;
      // 确保用户在列表中
      const existingIndex = users.value.findIndex((u) => u.id === response.user!.id);
      if (existingIndex >= 0) {
        users.value[existingIndex] = response.user;
      } else {
        users.value.push(response.user);
      }
    }
  } catch (e) {
    console.warn('[useUserStore] Failed to load current user:', e);
  }
}

function switchUser(userId: string): void {
  const user = users.value.find((u) => u.id === userId);
  if (user) {
    currentUserId.value = userId;
    console.log(`[useUserStore] Switched to user: ${user.name} (${user.role})`);
    // 重新加载任务
    loadReviewTasks();
    // 重新连接 WebSocket
    connectWebSocket();
  }
}

// ============ 任务管理 ============

async function loadReviewTasks(): Promise<void> {
  if (!USE_BACKEND.value) return;

  loading.value = true;
  error.value = null;
  try {
    const response = await reviewTaskGetList();
    if (response.success) {
      reviewTasks.value = response.tasks;
    } else {
      throw new Error(response.error_message || '加载任务列表失败');
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : '加载任务列表失败';
  } finally {
    loading.value = false;
  }
}

async function createReviewTask(data: {
  title: string;
  description: string;
  modelName: string;
  reviewerId: string;
  priority: ReviewTask['priority'];
  components: ReviewComponent[];
  dueDate?: number;
  formId?: string;
  attachments?: ReviewAttachment[];
}): Promise<ReviewTask> {
  const user = currentUser.value;
  if (!user) throw new Error('No user logged in');

  if (USE_BACKEND.value) {
    loading.value = true;
    error.value = null;
    try {
      const request: ReviewTaskCreateRequest = {
        title: data.title,
        description: data.description,
        modelName: data.modelName,
        reviewerId: data.reviewerId,
        formId: data.formId,
        priority: data.priority,
        components: data.components,
        dueDate: data.dueDate,
        attachments: data.attachments,
      };

      const response = await reviewTaskCreate(request);
      if (response.success && response.task) {
        reviewTasks.value = [...reviewTasks.value, response.task];
        console.log('[useUserStore] Created review task:', response.task.title);
        return response.task;
      } else {
        // 后端返回失败，回退到本地模式
        console.warn('[useUserStore] Backend failed, falling back to local mode:', response.error_message);
      }
    } catch (e) {
      // 后端调用异常，回退到本地模式
      console.warn('[useUserStore] Backend error, falling back to local mode:', e);
    } finally {
      loading.value = false;
    }
  }

  // 本地模式
  const reviewer = users.value.find((u) => u.id === data.reviewerId);
  if (!reviewer) throw new Error('Reviewer not found');

  const task: ReviewTask = {
    id: `task-${Date.now()}`,
    formId: data.formId,
    title: data.title,
    description: data.description,
    modelName: data.modelName,
    status: 'draft',
    priority: data.priority,
    requesterId: user.id,
    requesterName: user.name,
    reviewerId: data.reviewerId,
    reviewerName: reviewer.name,
    components: data.components,
    attachments: data.attachments,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    dueDate: data.dueDate,
    currentNode: 'sj',
    workflowHistory: [],
  };

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
        case 'in_review':
          response = await reviewTaskStartReview(taskId);
          break;
        case 'approved':
          response = await reviewTaskApprove(taskId, comment);
          break;
        case 'rejected':
          response = await reviewTaskReject(taskId, comment || '');
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
    status,
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
        reviewTasks.value = reviewTasks.value.map((t) => (t.id === taskId ? response.task! : t));
      } else {
        await loadReviewTasks();
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : '更新任务附件失败';
      throw e;
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
      error.value = e instanceof Error ? e.message : '提交到下一节点失败';
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
  const nextNode = getNextWorkflowNode(fromNode);
  if (!nextNode) return;

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

  const updated: ReviewTask = {
    ...task,
    status: statusFromNode(nextNode),
    currentNode: nextNode,
    workflowHistory: [...(task.workflowHistory || []), step],
    returnReason: undefined,
    updatedAt: Date.now(),
  };

  reviewTasks.value = [
    ...reviewTasks.value.slice(0, idx),
    updated,
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

  const url = getReviewWebSocketUrl();

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
      if (currentUserId.value && reconnectCount < MAX_RECONNECT) {
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
}

function handleWebSocketMessage(message: {
  type: string;
  data: unknown;
  timestamp: string;
}) {
  switch (message.type) {
    case 'task_created':
    case 'task_updated':
    case 'task_submitted':
    case 'task_approved':
    case 'task_rejected':
    case 'task_cancelled': {
      // 刷新任务列表
      loadReviewTasks();
      break;
    }
  }
}

// ============ 初始化 ============

async function initialize(): Promise<void> {
  if (USE_BACKEND.value) {
    await Promise.all([
      loadUsers(),
      loadReviewers(),
      loadCurrentUser(),
      loadReviewTasks(),
    ]);
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
    availableUsers,
    availableReviewers,
    reviewTasks,
    pendingReviewTasks,
    myInitiatedTasks,
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
  };
}
