/**
 * 批注草稿的归属身份（scope）与异步回执守卫——交互方案 U0 的纯函数部分。
 *
 * 口径（docs/plans/2026-09-14-3d-annotation-interaction-redesign-proposal.md §3.6，决策 d-565）：
 * - 本机草稿按「项目 + canonical taskId + reviewRound + 当前用户」隔离；节点 / 流程修订 / `form_id` 只作上下文校验，**不进身份**。
 * - 未取得 taskId 的新建单据用独立 `draftSessionId` 顶替 taskId。
 * - 每次 scope 切换递增 `scopeEpoch`；截图 / 保存 / 高亮 / 相机等异步回执发布前先核对「属于当前 scope？」「epoch 仍是当时那个？」，
 *   A 任务迟到的结果只能归属 A，不能改 B。
 * - localStorage 容器仍是 V7 / V6，只给草稿 key 加 scope 命名空间；旧全局 key（`project=…|db=…` / `__default__`）**受控只读**：
 *   能认出项目就显示「未归属草稿（项目 x）」，认不出就「未归属草稿」，一律不默认导入。
 *
 * 这里没有 Vue、没有 localStorage 访问；运行时接线在 `src/composables/useAnnotationDraftSession.ts`。
 */

import type { WorkflowNode } from '@/types/auth';

export const ANNOTATION_SCOPE_VERSION = 1 as const;

/** scope key 的固定前缀；旧全局 key 没有它，一眼可辨 */
export const ANNOTATION_SCOPE_KEY_PREFIX = 'v1';

/** 与 `useToolStore.getCurrentStorageScope()` 兜底值同字面，旧 key 分类时要认得它 */
export const LEGACY_DEFAULT_STORAGE_SCOPE = '__default__';

const SEGMENT_SEPARATOR = '|';
const KV_SEPARATOR = '=';

export type AnnotationScope = {
  version: typeof ANNOTATION_SCOPE_VERSION;
  /** 项目（`output_project` / `project_id`），已 trim；拿不到项目时是 `LEGACY_DEFAULT_STORAGE_SCOPE` */
  projectId: string;
  /** canonical taskId；新建未获 taskId 时为 null，此时 `draftSessionId` 必有 */
  taskId: string | null;
  /** 未取得 taskId 的新建单据的会话身份；有 taskId 时为 null */
  draftSessionId: string | null;
  /** 校审轮次，非负整数；拿不到按 0（与 `useAnnotationReviewStateSync` 同口径） */
  reviewRound: number;
  /** 当前用户，已 trim；匿名 / 未登录一律 `anonymous`（不同人不共用草稿） */
  userId: string;
};

export type AnnotationScopeInput = {
  projectId?: string | null;
  taskId?: string | null;
  draftSessionId?: string | null;
  reviewRound?: number | string | null;
  userId?: string | null;
};

/** 不进身份、只作校验的上下文（方案 §3.6「节点 / 流程修订 / form_id 作上下文校验」） */
export type AnnotationScopeContext = {
  node?: WorkflowNode | null;
  workflowRevision?: number | null;
  formId?: string | null;
};

export type AnnotationScopeContextField = keyof AnnotationScopeContext;

export const ANONYMOUS_USER_ID = 'anonymous';

/** 通用字段归一：非字符串 / 空白 → null；其余 trim + NFC */
export function canonicalizeScopeSegment(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().normalize('NFC');
  return trimmed.length > 0 ? trimmed : null;
}

/** taskId 归一：trim + NFC；`task:` / `task-` 前缀原样保留（后端 id 就长这样），不做大小写折叠 */
export function canonicalizeTaskId(value: unknown): string | null {
  return canonicalizeScopeSegment(value);
}

/** reviewRound 归一：有限非负整数；字符串数字也认；其余一律 0 */
export function canonicalizeReviewRound(value: unknown): number {
  const n = typeof value === 'string' ? Number(value.trim()) : value;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

export class AnnotationScopeError extends Error {
  readonly code: 'missing-task-and-session';

  constructor(code: 'missing-task-and-session', message: string) {
    super(message);
    this.name = 'AnnotationScopeError';
    this.code = code;
  }
}

/**
 * 构造 scope。规则：
 * - 有 taskId 就按 taskId 归属，`draftSessionId` 置 null（即便传了也不并存——同一条草稿只有一个身份）；
 * - 没有 taskId 必须给 `draftSessionId`，两者都没有**抛错**——退回全局 scope 正是 G5「草稿串任务」的根因，不允许静默发生。
 */
export function buildAnnotationScope(input: AnnotationScopeInput): AnnotationScope {
  const taskId = canonicalizeTaskId(input.taskId);
  const draftSessionId = taskId ? null : canonicalizeScopeSegment(input.draftSessionId);
  if (!taskId && !draftSessionId) {
    throw new AnnotationScopeError(
      'missing-task-and-session',
      'annotationScope: 既没有 taskId 也没有 draftSessionId，拒绝退回全局 scope（G5 草稿串任务的根因）',
    );
  }
  return {
    version: ANNOTATION_SCOPE_VERSION,
    projectId: canonicalizeScopeSegment(input.projectId) ?? LEGACY_DEFAULT_STORAGE_SCOPE,
    taskId,
    draftSessionId,
    reviewRound: canonicalizeReviewRound(input.reviewRound),
    userId: canonicalizeScopeSegment(input.userId) ?? ANONYMOUS_USER_ID,
  };
}

/**
 * 新建未获 taskId 时的会话 id。`random` 可注入（测试用）；默认 `crypto.randomUUID`，没有就退到时间戳 + Math.random。
 */
export function createDraftSessionId(
  now: () => number = Date.now,
  random: () => string = defaultRandomToken,
): string {
  return `ds-${now().toString(36)}-${random()}`;
}

function defaultRandomToken(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID().replace(/-/g, '').slice(0, 12);
  return Math.random().toString(36).slice(2, 14);
}

function encodeSegment(value: string): string {
  return value
    .replace(/%/g, '%25')
    .replace(/\|/g, '%7C')
    .replace(/=/g, '%3D');
}

function decodeSegment(value: string): string {
  return value
    .replace(/%3D/gi, '=')
    .replace(/%7C/gi, '|')
    .replace(/%25/g, '%');
}

/**
 * 稳定的存储命名空间 key：`v1|project=<p>|task=<t>|round=<n>|user=<u>` 或 `v1|project=<p>|session=<s>|round=<n>|user=<u>`。
 * 字段顺序固定、逐段转义，`isSameAnnotationScope(a,b) ⇔ key(a) === key(b)`。
 */
export function annotationScopeKey(scope: AnnotationScope): string {
  const owner = scope.taskId
    ? `task${KV_SEPARATOR}${encodeSegment(scope.taskId)}`
    : `session${KV_SEPARATOR}${encodeSegment(scope.draftSessionId ?? '')}`;
  return [
    ANNOTATION_SCOPE_KEY_PREFIX,
    `project${KV_SEPARATOR}${encodeSegment(scope.projectId)}`,
    owner,
    `round${KV_SEPARATOR}${scope.reviewRound}`,
    `user${KV_SEPARATOR}${encodeSegment(scope.userId)}`,
  ].join(SEGMENT_SEPARATOR);
}

/** `annotationScopeKey` 的逆：不是 v1 形制、缺段、多段、round 非数字 → null（不猜） */
export function parseAnnotationScopeKey(key: string): AnnotationScope | null {
  if (typeof key !== 'string') return null;
  const parts = key.split(SEGMENT_SEPARATOR);
  if (parts.length !== 5 || parts[0] !== ANNOTATION_SCOPE_KEY_PREFIX) return null;
  const kv = new Map<string, string>();
  for (const part of parts.slice(1)) {
    const idx = part.indexOf(KV_SEPARATOR);
    if (idx <= 0) return null;
    kv.set(part.slice(0, idx), decodeSegment(part.slice(idx + 1)));
  }
  const project = kv.get('project');
  const round = kv.get('round');
  const user = kv.get('user');
  const task = kv.get('task');
  const session = kv.get('session');
  if (project === undefined || round === undefined || user === undefined) return null;
  if ((task === undefined) === (session === undefined)) return null;
  if (!/^\d+$/.test(round)) return null;
  const owner = task !== undefined ? { taskId: task, draftSessionId: null } : { taskId: null, draftSessionId: session ?? null };
  if (owner.taskId === '' || owner.draftSessionId === '') return null;
  return {
    version: ANNOTATION_SCOPE_VERSION,
    projectId: project,
    ...owner,
    reviewRound: Number(round),
    userId: user,
  };
}

export function isSameAnnotationScope(a: AnnotationScope | null | undefined, b: AnnotationScope | null | undefined): boolean {
  if (!a || !b) return a === b;
  return (
    a.projectId === b.projectId
    && a.taskId === b.taskId
    && a.draftSessionId === b.draftSessionId
    && a.reviewRound === b.reviewRound
    && a.userId === b.userId
  );
}

// ---------------------------------------------------------------------------
// 旧全局 key 的受控识别（方案 §3.6：认不出归属的显示「未归属草稿」，不默认导入）
// ---------------------------------------------------------------------------

export type StoredScopeKind = 'scoped' | 'legacy' | 'unknown';

export type LegacyStorageScope = {
  kind: 'legacy';
  /** `project=` 段能读出来就给（`__default__` 视为拿不到），否则 null */
  projectId: string | null;
  /** `db=` 段原文（`__all__` 视为无），否则 null */
  dbnum: string | null;
};

/** `useToolStore.getCurrentStorageScope()` 产出的旧形制：`project=<p>|db=<d>` 或 `__default__` */
export function parseLegacyStorageScope(key: string): LegacyStorageScope | null {
  if (typeof key !== 'string') return null;
  if (key === LEGACY_DEFAULT_STORAGE_SCOPE) return { kind: 'legacy', projectId: null, dbnum: null };
  const match = /^project=([^|]*)\|db=([^|]*)$/.exec(key);
  if (!match) return null;
  const project = match[1];
  const db = match[2];
  return {
    kind: 'legacy',
    projectId: project && project !== LEGACY_DEFAULT_STORAGE_SCOPE ? project : null,
    dbnum: db && db !== '__all__' ? db : null,
  };
}

export function classifyStoredScopeKey(key: string): StoredScopeKind {
  if (parseAnnotationScopeKey(key)) return 'scoped';
  if (parseLegacyStorageScope(key)) return 'legacy';
  return 'unknown';
}

/** 「未归属草稿」的展示文字（只读提示，不是导入动作） */
export function describeUnattributedDraft(legacy: LegacyStorageScope | null): string {
  if (legacy?.projectId) return `未归属草稿（项目 ${legacy.projectId}）`;
  return '未归属草稿';
}

// ---------------------------------------------------------------------------
// scopeEpoch 与异步回执守卫
// ---------------------------------------------------------------------------

/** 一次操作发起时盖的戳；回执回来时拿它对当前 scope 与 epoch */
export type AnnotationScopeStamp = {
  scopeKey: string;
  epoch: number;
};

export type ScopeStampVerdict =
  | { accept: true; reason: 'current' }
  | { accept: false; reason: 'no-scope' | 'scope-changed' | 'epoch-stale' };

/**
 * scope 切换时 epoch 怎么走：**同一 scope 不递增**（否则同任务里每次刷新都会把在途回执作废），
 * 换了 scope（含 null → 有）才 +1。
 */
export function nextScopeEpoch(
  prevEpoch: number,
  prevScope: AnnotationScope | null,
  nextScope: AnnotationScope,
): number {
  if (prevScope && isSameAnnotationScope(prevScope, nextScope)) return prevEpoch;
  return prevEpoch + 1;
}

export function stampForScope(scope: AnnotationScope, epoch: number): AnnotationScopeStamp {
  return { scopeKey: annotationScopeKey(scope), epoch };
}

/**
 * 回执能不能发布到当前 scope：key 与 epoch 都得对上。
 * 「同 key 不同 epoch」也拒——那是 A → B → A 来回切之后 A 的旧回执，不能当成这一次 A 的。
 */
export function judgeScopeStamp(
  stamp: AnnotationScopeStamp | null | undefined,
  currentScope: AnnotationScope | null,
  currentEpoch: number,
): ScopeStampVerdict {
  if (!stamp || !currentScope) return { accept: false, reason: 'no-scope' };
  if (stamp.scopeKey !== annotationScopeKey(currentScope)) return { accept: false, reason: 'scope-changed' };
  if (stamp.epoch !== currentEpoch) return { accept: false, reason: 'epoch-stale' };
  return { accept: true, reason: 'current' };
}

// ---------------------------------------------------------------------------
// 上下文校验（节点 / 流程修订 / form_id）
// ---------------------------------------------------------------------------

export type ScopeContextMismatch = {
  field: AnnotationScopeContextField;
  expected: string | number | null;
  actual: string | number | null;
};

/**
 * 期望上下文（草稿建立时记下的）与实际上下文（现在的任务）逐字段比：
 * 只比**两边都给了**的字段——一边没给不算不一致（U3 之前 workflowRevision 多半拿不到）。
 * 有任一不一致就该拒写并提示，而不是静默覆盖（方案 §3.6 / §6.2「节点变更后写入被拒」的客户端前置）。
 */
export function diffScopeContext(
  expected: AnnotationScopeContext | null | undefined,
  actual: AnnotationScopeContext | null | undefined,
): ScopeContextMismatch[] {
  if (!expected || !actual) return [];
  const out: ScopeContextMismatch[] = [];
  const expNode = expected.node ?? null;
  const actNode = actual.node ?? null;
  if (expNode !== null && actNode !== null && expNode !== actNode) {
    out.push({ field: 'node', expected: expNode, actual: actNode });
  }
  const expRev = normalizeRevision(expected.workflowRevision);
  const actRev = normalizeRevision(actual.workflowRevision);
  if (expRev !== null && actRev !== null && expRev !== actRev) {
    out.push({ field: 'workflowRevision', expected: expRev, actual: actRev });
  }
  const expForm = canonicalizeScopeSegment(expected.formId);
  const actForm = canonicalizeScopeSegment(actual.formId);
  if (expForm !== null && actForm !== null && expForm !== actForm) {
    out.push({ field: 'formId', expected: expForm, actual: actForm });
  }
  return out;
}

function normalizeRevision(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
