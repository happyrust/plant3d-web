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
  jd: '校核',
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
  /** 校核人（第二段） */
  checkerId?: string;
  checkerName?: string;
  /** 审核人（第三段） */
  approverId?: string;
  approverName?: string;
  /**
   * @deprecated 兼容旧字段：历史数据中 reviewer 语义等同校核人。
   * 新流程请优先使用 checkerId/approverId。
   */
  reviewerId: string;
  /** @deprecated 请使用 checkerName/approverName */
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

// 角色统一配色主题 — 供所有批注/意见 UI 引用
export type RoleThemeConfig = {
  label: string;       // 单字标签: 设/校/审/管/查
  textColor: string;   // 标签文字色
  bgColor: string;     // 标签底色
  barColor: string;    // timeline 消息左侧竖条颜色
  dotColor: string;    // 列表中的角色圆点色
  columnBorder: string; // 三栏视图边框色
  columnBg: string;     // 三栏视图底色
  columnHeader: string; // 三栏视图头部底色
};

export const ROLE_THEME: Record<UserRole, RoleThemeConfig> = {
  [UserRole.DESIGNER]:    { label: '设', textColor: '#1E3A8A', bgColor: '#EFF6FF', barColor: '#93C5FD', dotColor: '#3B82F6', columnBorder: '#93C5FD', columnBg: '#EFF6FF', columnHeader: '#DBEAFE' },
  [UserRole.PROOFREADER]: { label: '校', textColor: '#3F6212', bgColor: '#ECFCCB', barColor: '#BEF264', dotColor: '#22C55E', columnBorder: '#BEF264', columnBg: '#ECFCCB', columnHeader: '#D9F99D' },
  [UserRole.REVIEWER]:    { label: '审', textColor: '#9A3412', bgColor: '#FFEDD5', barColor: '#FDBA74', dotColor: '#F97316', columnBorder: '#FDBA74', columnBg: '#FFEDD5', columnHeader: '#FED7AA' },
  [UserRole.MANAGER]:     { label: '管', textColor: '#7C2D12', bgColor: '#FFF7ED', barColor: '#FED7AA', dotColor: '#EA580C', columnBorder: '#FED7AA', columnBg: '#FFF7ED', columnHeader: '#FFEDD5' },
  [UserRole.ADMIN]:       { label: '管', textColor: '#991B1B', bgColor: '#FEF2F2', barColor: '#FCA5A5', dotColor: '#EF4444', columnBorder: '#FCA5A5', columnBg: '#FEF2F2', columnHeader: '#FECACA' },
  [UserRole.VIEWER]:      { label: '查', textColor: '#374151', bgColor: '#F3F4F6', barColor: '#D1D5DB', dotColor: '#6B7280', columnBorder: '#D1D5DB', columnBg: '#F3F4F6', columnHeader: '#E5E7EB' },
};

export function getRoleTheme(role: UserRole): RoleThemeConfig {
  return ROLE_THEME[role] || ROLE_THEME[UserRole.VIEWER];
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
