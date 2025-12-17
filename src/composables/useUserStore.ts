import { computed, ref, watch } from 'vue';

import {
  type ReviewComponent,
  type ReviewTask,
  type User,
  UserRole,
  UserStatus,
} from '@/types/auth';

type UserPersistedState = {
  version: 1;
  currentUserId: string | null;
  reviewTasks: ReviewTask[];
};

const STORAGE_KEY = 'plant3d-web-user-v1';

// 模拟用户数据
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
const reviewerUsers = mockUsers.filter((u) =>
  [UserRole.ADMIN, UserRole.MANAGER, UserRole.REVIEWER, UserRole.PROOFREADER].includes(u.role)
);

function loadPersisted(): UserPersistedState {
  if (typeof localStorage === 'undefined') {
    return { version: 1, currentUserId: 'designer_001', reviewTasks: [] };
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as UserPersistedState;
      if (parsed.version === 1) {
        return parsed;
      }
    }
  } catch (e) {
    console.warn('[useUserStore] Failed to load persisted state:', e);
  }

  // 默认登录为设计人员
  return { version: 1, currentUserId: 'designer_001', reviewTasks: [] };
}

function savePersisted(state: UserPersistedState): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('[useUserStore] Failed to save persisted state:', e);
  }
}

// 全局状态
const persistedState = loadPersisted();
const currentUserId = ref<string | null>(persistedState.currentUserId);
const reviewTasks = ref<ReviewTask[]>(persistedState.reviewTasks);

// 计算属性
const currentUser = computed<User | null>(() => {
  if (!currentUserId.value) return null;
  return mockUsers.find((u) => u.id === currentUserId.value) || null;
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

const availableUsers = computed(() => mockUsers);

const availableReviewers = computed(() => reviewerUsers);

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

// 持久化
watch(
  [currentUserId, reviewTasks],
  () => {
    savePersisted({
      version: 1,
      currentUserId: currentUserId.value,
      reviewTasks: reviewTasks.value,
    });
  },
  { deep: true }
);

// 切换用户
function switchUser(userId: string): void {
  const user = mockUsers.find((u) => u.id === userId);
  if (user) {
    currentUserId.value = userId;
    console.log(`[useUserStore] Switched to user: ${user.name} (${user.role})`);
  }
}

// 创建提资单（设计人员发起）
function createReviewTask(data: {
  title: string;
  description: string;
  modelName: string;
  reviewerId: string;
  priority: ReviewTask['priority'];
  components: ReviewComponent[];
  dueDate?: number;
}): ReviewTask {
  const user = currentUser.value;
  if (!user) throw new Error('No user logged in');

  const reviewer = mockUsers.find((u) => u.id === data.reviewerId);
  if (!reviewer) throw new Error('Reviewer not found');

  const task: ReviewTask = {
    id: `task-${Date.now()}`,
    title: data.title,
    description: data.description,
    modelName: data.modelName,
    status: 'submitted',
    priority: data.priority,
    requesterId: user.id,
    requesterName: user.name,
    reviewerId: data.reviewerId,
    reviewerName: reviewer.name,
    components: data.components,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    dueDate: data.dueDate,
  };

  reviewTasks.value = [...reviewTasks.value, task];
  console.log('[useUserStore] Created review task:', task.title);
  return task;
}

// 更新任务状态
function updateTaskStatus(
  taskId: string,
  status: ReviewTask['status'],
  comment?: string
): void {
  const index = reviewTasks.value.findIndex((t) => t.id === taskId);
  if (index === -1) return;

  const task = reviewTasks.value[index];
  if (!task) return;
  
  const updated: ReviewTask = { 
    ...task, 
    id: task.id, // Explicitly ensure id is not undefined
    title: task.title, // Explicitly ensure title is not undefined
    description: task.description, // Explicitly ensure description is not undefined
    modelName: task.modelName, // Explicitly ensure modelName is not undefined
    requesterId: task.requesterId, // Explicitly ensure requesterId is not undefined
    requesterName: task.requesterName, // Explicitly ensure requesterName is not undefined
    reviewerId: task.reviewerId, // Explicitly ensure reviewerId is not undefined
    reviewerName: task.reviewerName, // Explicitly ensure reviewerName is not undefined
    components: task.components, // Explicitly ensure components is not undefined
    status, 
    updatedAt: Date.now(),
    reviewComment: comment
  };
  reviewTasks.value = [
    ...reviewTasks.value.slice(0, index),
    updated,
    ...reviewTasks.value.slice(index + 1),
  ];
  console.log(`[useUserStore] Updated task ${taskId} status to: ${status}`);
}

// 删除任务
function deleteTask(taskId: string): void {
  reviewTasks.value = reviewTasks.value.filter((t) => t.id !== taskId);
}

// 获取任务详情
function getTask(taskId: string): ReviewTask | undefined {
  return reviewTasks.value.find((t) => t.id === taskId);
}

// 导出store
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

    // 方法
    switchUser,
    createReviewTask,
    updateTaskStatus,
    deleteTask,
    getTask,
  };
}
