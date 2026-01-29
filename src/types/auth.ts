// 用户认证和角色管理类型定义

// 批注意见/评论类型 - 用于多角色意见管理
export type AnnotationComment = {
  id: string;
  annotationId: string;          // 关联的批注ID
  annotationType: 'text' | 'cloud' | 'rect' | 'obb';  // 批注类型
  authorId: string;              // 作者用户ID
  authorName: string;            // 作者姓名
  authorRole: UserRole;          // 作者角色
  content: string;               // 意见内容
  replyToId?: string;            // 回复的评论ID（用于回复功能）
  createdAt: number;
  updatedAt?: number;
};

export enum UserRole {
  ADMIN = 'admin', // 系统管理员
  MANAGER = 'manager', // 项目管理员
  REVIEWER = 'reviewer', // 审核人员
  PROOFREADER = 'proofreader', // 校对人员
  DESIGNER = 'designer', // 设计人员
  VIEWER = 'viewer', // 查看者
}

export enum UserStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  SUSPENDED = 'suspended',
}

export type User = {
  id: string;
  username: string;
  email: string;
  name: string;
  avatar?: string;
  role: UserRole;
  department?: string;
  phone?: string;
  status: UserStatus;
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt?: Date;
};

export type ReviewAttachment = {
  id: string;
  name: string;
  url: string;
  size?: number;
  type?: string;
  mimeType?: string;
  uploadedAt: number;
};

// 工作流节点类型
export type WorkflowNode = 'sj' | 'jd' | 'sh' | 'pz';

// 工作流步骤
export type WorkflowStep = {
  node: WorkflowNode;
  action: 'submit' | 'return' | 'approve' | 'reject';
  operatorId: string;
  operatorName: string;
  comment?: string;
  timestamp: number;
};

// 工作流节点显示名称
export const WORKFLOW_NODE_NAMES: Record<WorkflowNode, string> = {
  sj: '编制',
  jd: '校对',
  sh: '审核',
  pz: '批准',
};

export type ReviewTask = {
  id: string;
  /** 三维校审/外部系统对齐用的单据号（后端返回 formId） */
  formId?: string;
  title: string;
  description: string;
  modelName: string;
  status: 'draft' | 'submitted' | 'in_review' | 'approved' | 'rejected' | 'cancelled';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  requesterId: string;
  requesterName: string;
  reviewerId: string;
  reviewerName: string;
  components: ReviewComponent[];
  attachments?: ReviewAttachment[];
  reviewComment?: string;
  createdAt: number;
  updatedAt: number;
  dueDate?: number;
  // 多级审批流程字段
  currentNode?: WorkflowNode;
  workflowHistory?: WorkflowStep[];
  returnReason?: string;
};

export type ReviewComponent = {
  id: string;
  name: string;
  refNo: string;
  type?: string;
};

// 角色检查函数
export function hasRole(user: User | null, role: UserRole): boolean {
  if (!user) return false;
  return user.role === role;
}

export function hasAnyRole(user: User | null, roles: UserRole[]): boolean {
  if (!user) return false;
  return roles.includes(user.role);
}

// ============================================================================
// 角色映射 (前后端转换)
// ============================================================================

// 后端角色代码映射
// sj: 设计（编）, jd: 校对（校）, sh: 审核（审）, pz: 批准, admin: 管理员
export const backendRoleMapping: Record<string, UserRole> = {
  'sj': UserRole.DESIGNER,
  'jd': UserRole.PROOFREADER,
  'sh': UserRole.REVIEWER,
  'pz': UserRole.MANAGER,  // 批准节点更接近“项目负责人/项目管理员”
  'admin': UserRole.ADMIN,
};

// 转换后端角色代码到前端 UserRole
export function fromBackendRole(backendRole: string): UserRole {
  return backendRoleMapping[backendRole.toLowerCase()] || UserRole.VIEWER;
}

// 转换前端 UserRole 到后端角色代码
export function toBackendRole(role: UserRole): string {
  const mapping: Partial<Record<UserRole, string>> = {
    [UserRole.DESIGNER]: 'sj',
    [UserRole.PROOFREADER]: 'jd',
    [UserRole.REVIEWER]: 'sh',
    [UserRole.MANAGER]: 'pz',
    [UserRole.ADMIN]: 'admin',
    // 注意：pz 通常是由特定的审批逻辑确定的，如果是导出当前用户的后端代码，映射到对应的缩写
  };
  return mapping[role] || 'viewer';
}

// 是否为设计人员
export function isDesigner(user: User | null): boolean {
  return hasRole(user, UserRole.DESIGNER);
}

// 是否为审核人员（包括审核员、校对员、管理员）
export function isReviewer(user: User | null): boolean {
  return hasAnyRole(user, [UserRole.ADMIN, UserRole.MANAGER, UserRole.REVIEWER, UserRole.PROOFREADER]);
}

// 获取角色显示名称
export function getRoleDisplayName(role: UserRole): string {
  const roleNames: Record<UserRole, string> = {
    [UserRole.ADMIN]: '系统管理员',
    [UserRole.MANAGER]: '项目管理员',
    [UserRole.REVIEWER]: '审核人员',
    [UserRole.PROOFREADER]: '校对人员',
    [UserRole.DESIGNER]: '设计人员',
    [UserRole.VIEWER]: '查看者',
  };
  return roleNames[role] || role;
}

// 获取状态显示名称
export function getStatusDisplayName(status: UserStatus): string {
  const statusNames: Record<UserStatus, string> = {
    [UserStatus.ACTIVE]: '正常',
    [UserStatus.INACTIVE]: '未激活',
    [UserStatus.SUSPENDED]: '已停用',
  };
  return statusNames[status] || status;
}

// 获取任务状态显示名称
export function getTaskStatusDisplayName(
  status: ReviewTask['status']
): { label: string; color: string } {
  const statusMap: Record<ReviewTask['status'], { label: string; color: string }> = {
    draft: { label: '草稿', color: 'bg-gray-100 text-gray-700' },
    submitted: { label: '待审核', color: 'bg-yellow-100 text-yellow-700' },
    in_review: { label: '审核中', color: 'bg-blue-100 text-blue-700' },
    approved: { label: '已通过', color: 'bg-green-100 text-green-700' },
    rejected: { label: '未通过', color: 'bg-red-100 text-red-700' },
    cancelled: { label: '已取消', color: 'bg-gray-100 text-gray-500' },
  };
  return statusMap[status] || { label: status, color: 'bg-gray-100 text-gray-700' };
}

// 获取优先级显示名称
export function getPriorityDisplayName(
  priority: ReviewTask['priority']
): { label: string; color: string } {
  const priorityMap: Record<ReviewTask['priority'], { label: string; color: string }> = {
    low: { label: '低', color: 'bg-gray-100 text-gray-600' },
    medium: { label: '中', color: 'bg-blue-100 text-blue-600' },
    high: { label: '高', color: 'bg-orange-100 text-orange-600' },
    urgent: { label: '紧急', color: 'bg-red-100 text-red-600' },
  };
  return priorityMap[priority] || { label: priority, color: 'bg-gray-100 text-gray-600' };
}
