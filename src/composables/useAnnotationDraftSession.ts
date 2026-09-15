import { computed, shallowRef, type ComputedRef, type ShallowRef } from 'vue';

import {
  annotationScopeKey,
  judgeScopeStamp,
  nextScopeEpoch,
  stampForScope,
  type AnnotationScope,
  type AnnotationScopeStamp,
  type ScopeStampVerdict,
} from '@/review/domain/annotationScope';

/**
 * 批注草稿会话——交互方案 U0「真实保存反馈 + 任务隔离」的状态机。
 *
 * 口径（docs/plans/2026-09-14-3d-annotation-interaction-redesign-proposal.md §3.6 / §6.1，决策 d-565 #4）：
 * - 三个维度分开算、分开显示，不压进一个 status：**本机**（localStorage 写到哪个修订）、**云端草稿**（U3 的 PATCH 发到 / ACK 到哪个修订）、
 *   **正式确认**（`/records` 确认到哪个修订）。
 * - 「已保存」只在服务器对应修订 ACK 后才叫云端已保存；localStorage 写入只算「本机已存」。
 * - 修订 7 的 ACK 到达时用户已编辑到 8：ACK 照记（`ackRevision = 7`），界面继续显示「有未同步修改」——ACK 不会被丢，也不会被当成 8 的。
 * - 没有后端草稿能力（U3 之前）时 `remote.capability = 'unavailable'`，只做「可靠的本机草稿 + 明确未落库提示」，不假装云端已存。
 * - 切 scope（换任务 / 换轮次 / 换用户 / 新建单据）= 整个状态重置 + epoch 递增；带旧 stamp 的回执一律拒收（`judgeScopeStamp`）。
 *
 * 纯函数（`createDraftSessionState` / `applyDraftSessionEvent` / `deriveDraftSaveStatus`）无 Vue 依赖，可单测；
 * `createAnnotationDraftSession()` 只是把它们包成响应式对象。**本文件不接 UI、不碰 localStorage、不发请求。**
 */

export type DraftRemoteCapability = 'unavailable' | 'available';

export type DraftSessionRemoteState = {
  capability: DraftRemoteCapability;
  /** 最近一次发出去的本机修订与其 mutationId；ACK / 失败回来要对得上 */
  sentRevision: number | null;
  sentMutationId: string | null;
  inFlight: boolean;
  /** 服务端已 ACK 的本机修订（单调不减） */
  ackRevision: number | null;
  /** 服务端草稿身份（U3 `draft_id / draft_revision`） */
  draftId: string | null;
  draftRevision: number | null;
  lastError: string | null;
};

export type DraftSessionState = {
  version: 1;
  /** 空串 = 尚未进入任何 scope */
  scopeKey: string;
  epoch: number;
  /** 本机编辑修订：每次编辑 +1；0 = 进入 scope 后还没编辑过 */
  localRevision: number;
  /** 最近一次成功写入本机存储的修订（单调不减） */
  persistedLocalRevision: number;
  /** 本机写入失败时的修订；成功写入 ≥ 它之后清掉 */
  localWriteFailedAtRevision: number | null;
  localWriteError: string | null;
  remote: DraftSessionRemoteState;
  /** 最近一次正式确认（`/records`）对应的本机修订（单调不减） */
  confirmedRevision: number | null;
  confirmedAt: number | null;
  updatedAt: number;
};

export type DraftSessionEvent =
  | { type: 'reset'; scopeKey: string; epoch: number; at: number; remoteCapability?: DraftRemoteCapability }
  | { type: 'edit'; at: number }
  | { type: 'local-persisted'; revision: number; at: number }
  | { type: 'local-persist-failed'; revision: number; error: string | null; at: number }
  | { type: 'remote-capability'; capability: DraftRemoteCapability; at: number }
  | { type: 'remote-sent'; revision: number; mutationId: string; at: number }
  | {
    type: 'remote-acked';
    revision: number;
    mutationId: string;
    draftId: string | null;
    draftRevision: number | null;
    at: number;
  }
  | { type: 'remote-failed'; revision: number; mutationId: string; error: string | null; at: number }
  | { type: 'confirmed'; revision: number; at: number };

export type DraftLocalStatus = 'clean' | 'unsaved' | 'saved' | 'write-failed';
export type DraftRemoteStatus = 'unavailable' | 'never-sent' | 'saving' | 'saved' | 'behind' | 'failed';
export type DraftConfirmStatus = 'never' | 'up-to-date' | 'has-unconfirmed-changes';

export type DraftSaveStatus = {
  local: DraftLocalStatus;
  remote: DraftRemoteStatus;
  confirmed: DraftConfirmStatus;
  /** 本机修订领先于「已 ACK 的云端修订」（云端可用时）或领先于「已确认修订」（云端不可用时） */
  hasUnsyncedChanges: boolean;
  /** 给三行状态用的文字；remote 在云端不可用时为 null（那一行不显示，不假装） */
  labels: { local: string; remote: string | null; confirmed: string };
};

export function createDraftSessionState(scopeKey = '', epoch = 0, at = 0, remoteCapability: DraftRemoteCapability = 'unavailable'): DraftSessionState {
  return {
    version: 1,
    scopeKey,
    epoch,
    localRevision: 0,
    persistedLocalRevision: 0,
    localWriteFailedAtRevision: null,
    localWriteError: null,
    remote: {
      capability: remoteCapability,
      sentRevision: null,
      sentMutationId: null,
      inFlight: false,
      ackRevision: null,
      draftId: null,
      draftRevision: null,
      lastError: null,
    },
    confirmedRevision: null,
    confirmedAt: null,
    updatedAt: at,
  };
}

function isKnownRevision(state: DraftSessionState, revision: number): boolean {
  return Number.isInteger(revision) && revision >= 1 && revision <= state.localRevision;
}

/**
 * 纯 reducer。不可能的事件（修订号超过本机修订、回执对不上在途 mutationId、倒退的 ACK / 确认）**原样返回旧状态**，
 * 不抛、不猜——上游拿 `===` 就能知道有没有被采纳。
 */
export function applyDraftSessionEvent(state: DraftSessionState, event: DraftSessionEvent): DraftSessionState {
  switch (event.type) {
    case 'reset':
      return createDraftSessionState(event.scopeKey, event.epoch, event.at, event.remoteCapability ?? state.remote.capability);

    case 'edit':
      return { ...state, localRevision: state.localRevision + 1, updatedAt: event.at };

    case 'local-persisted': {
      if (!isKnownRevision(state, event.revision)) return state;
      if (event.revision < state.persistedLocalRevision) return state;
      const clearsFailure = state.localWriteFailedAtRevision !== null && event.revision >= state.localWriteFailedAtRevision;
      return {
        ...state,
        persistedLocalRevision: event.revision,
        localWriteFailedAtRevision: clearsFailure ? null : state.localWriteFailedAtRevision,
        localWriteError: clearsFailure ? null : state.localWriteError,
        updatedAt: event.at,
      };
    }

    case 'local-persist-failed': {
      if (!isKnownRevision(state, event.revision)) return state;
      // 已经成功存过更新的修订，这条失败是陈旧的
      if (event.revision <= state.persistedLocalRevision) return state;
      return {
        ...state,
        localWriteFailedAtRevision: event.revision,
        localWriteError: event.error ?? null,
        updatedAt: event.at,
      };
    }

    case 'remote-capability': {
      if (state.remote.capability === event.capability) return state;
      return { ...state, remote: { ...state.remote, capability: event.capability }, updatedAt: event.at };
    }

    case 'remote-sent': {
      if (state.remote.capability !== 'available') return state;
      if (!isKnownRevision(state, event.revision)) return state;
      return {
        ...state,
        remote: {
          ...state.remote,
          sentRevision: event.revision,
          sentMutationId: event.mutationId,
          inFlight: true,
          lastError: null,
        },
        updatedAt: event.at,
      };
    }

    case 'remote-acked': {
      if (!isKnownRevision(state, event.revision)) return state;
      // 只认在途那一发；别的 mutationId 是更早一发的迟到回执，不能拿来推进 ack
      if (state.remote.sentMutationId !== event.mutationId) return state;
      const ackRevision = Math.max(state.remote.ackRevision ?? 0, event.revision);
      return {
        ...state,
        remote: {
          ...state.remote,
          inFlight: false,
          ackRevision,
          draftId: event.draftId ?? state.remote.draftId,
          draftRevision: event.draftRevision ?? state.remote.draftRevision,
          lastError: null,
        },
        updatedAt: event.at,
      };
    }

    case 'remote-failed': {
      if (state.remote.sentMutationId !== event.mutationId) return state;
      return {
        ...state,
        remote: { ...state.remote, inFlight: false, lastError: event.error ?? '保存失败' },
        updatedAt: event.at,
      };
    }

    case 'confirmed': {
      if (!isKnownRevision(state, event.revision)) return state;
      if (state.confirmedRevision !== null && event.revision < state.confirmedRevision) return state;
      return { ...state, confirmedRevision: event.revision, confirmedAt: event.at, updatedAt: event.at };
    }

    default:
      return state;
  }
}

export function deriveDraftSaveStatus(state: DraftSessionState): DraftSaveStatus {
  const local = deriveLocalStatus(state);
  const remote = deriveRemoteStatus(state);
  const confirmed = deriveConfirmStatus(state);
  const hasUnsyncedChanges = state.remote.capability === 'available'
    ? state.localRevision > (state.remote.ackRevision ?? 0)
    : state.localRevision > (state.confirmedRevision ?? 0);
  return {
    local,
    remote,
    confirmed,
    hasUnsyncedChanges,
    labels: {
      local: LOCAL_LABELS[local],
      remote: remote === 'unavailable' ? null : REMOTE_LABELS[remote],
      confirmed: confirmLabel(state, confirmed),
    },
  };
}

function deriveLocalStatus(state: DraftSessionState): DraftLocalStatus {
  if (state.localRevision === 0) return 'clean';
  if (state.localWriteFailedAtRevision !== null && state.persistedLocalRevision < state.localWriteFailedAtRevision) return 'write-failed';
  return state.persistedLocalRevision >= state.localRevision ? 'saved' : 'unsaved';
}

function deriveRemoteStatus(state: DraftSessionState): DraftRemoteStatus {
  const r = state.remote;
  if (r.capability !== 'available') return 'unavailable';
  if (r.inFlight) return 'saving';
  if (r.lastError !== null) return 'failed';
  if (r.ackRevision === null) return 'never-sent';
  return r.ackRevision >= state.localRevision ? 'saved' : 'behind';
}

function deriveConfirmStatus(state: DraftSessionState): DraftConfirmStatus {
  if (state.confirmedRevision === null) return 'never';
  return state.confirmedRevision >= state.localRevision ? 'up-to-date' : 'has-unconfirmed-changes';
}

const LOCAL_LABELS: Record<DraftLocalStatus, string> = {
  clean: '本机 · 无改动',
  unsaved: '本机 · 未存',
  saved: '本机已存 · 未落库',
  'write-failed': '本机写入失败',
};

const REMOTE_LABELS: Record<Exclude<DraftRemoteStatus, 'unavailable'>, string> = {
  'never-sent': '云端草稿 · 未发送',
  saving: '云端草稿 · 保存中',
  saved: '云端草稿 · 已保存 · 未确认',
  behind: '云端草稿 · 有未同步修改',
  failed: '云端草稿 · 保存失败',
};

function confirmLabel(state: DraftSessionState, status: DraftConfirmStatus): string {
  if (status === 'never') return '未确认';
  const rev = state.confirmedRevision ?? 0;
  return status === 'up-to-date' ? `已确认到修订 ${rev}` : `已确认到修订 ${rev} · 有未确认修改`;
}

// ---------------------------------------------------------------------------
// 响应式外壳（不接 UI）
// ---------------------------------------------------------------------------

/**
 * 数据类回执（截图引用、保存失败的回滚）该落到哪（方案 §3.6「A 任务截图上传返回时用户已在 B，只能归属 A」）：
 * - `current`：出发时的 scope 就是现在这个（epoch 变了也算——数据回执说的是「记录 X 的截图」，来回切一趟不改变这个事实）→ 写内存；
 * - `other-scope`：现在在别的 scope / 已离开校审上下文 → 写进出发时那个 scope 的本机容器（`scopeKey` 就是它的存储作用域字串），不碰当前内存；
 * - `unscoped`：出发时就没有 scope（开关关 / 面板没开）→ 照旧写内存。
 */
export type DataReceiptRoute =
  | { kind: 'current' }
  | { kind: 'other-scope'; scopeKey: string }
  | { kind: 'unscoped' };

export type AnnotationDraftSession = {
  state: ShallowRef<DraftSessionState>;
  status: ComputedRef<DraftSaveStatus>;
  scope: ShallowRef<AnnotationScope | null>;
  /**
   * 进入 scope：同一 scope 幂等（不重置、不递增 epoch），换 scope 整体重置 + epoch+1。
   * 返回这次进入之后的 stamp，供随后发起的异步操作盖戳。
   */
  enterScope: (scope: AnnotationScope, opts?: { at?: number; remoteCapability?: DraftRemoteCapability }) => AnnotationScopeStamp;
  /** 离开（登出 / 关闭校审）：清空到「无 scope」，epoch 仍递增，旧回执照样拒收 */
  leaveScope: (at?: number) => void;
  currentStamp: () => AnnotationScopeStamp | null;
  judge: (stamp: AnnotationScopeStamp | null | undefined) => ScopeStampVerdict;
  /**
   * 带戳派发：戳不是当前 scope / epoch 的一律丢弃并返回对应 verdict；戳对了才进 reducer。
   * `stamp` 传 null 表示「当前 scope 的同步操作」（比如用户此刻的编辑），不做戳校验。
   */
  dispatch: (event: DraftSessionEvent, stamp?: AnnotationScopeStamp | null) => ScopeStampVerdict;
  /** 便捷：当前 scope 内一次编辑；返回新的本机修订号（0 = 没有 scope，未记） */
  markEdited: (at?: number) => number;
  /**
   * 瞬态回执（相机 / 高亮 / 选择 / 提示 / 状态重拉）还能不能发布：出发时没 scope 照旧放行；有 scope 必须 key 与 epoch 都对——
   * A → B → A 之后 A 的旧回执也不算（用户的视角意图已经重置）。
   */
  isTransientReceiptCurrent: (stamp: AnnotationScopeStamp | null | undefined) => boolean;
  /** 数据类回执落点，见 `DataReceiptRoute` */
  routeDataReceipt: (stamp: AnnotationScopeStamp | null | undefined) => DataReceiptRoute;
};

export function createAnnotationDraftSession(now: () => number = Date.now): AnnotationDraftSession {
  const state = shallowRef<DraftSessionState>(createDraftSessionState());
  const scope = shallowRef<AnnotationScope | null>(null);
  const status = computed(() => deriveDraftSaveStatus(state.value));

  function currentStamp(): AnnotationScopeStamp | null {
    return scope.value ? stampForScope(scope.value, state.value.epoch) : null;
  }

  function judge(stamp: AnnotationScopeStamp | null | undefined): ScopeStampVerdict {
    return judgeScopeStamp(stamp, scope.value, state.value.epoch);
  }

  function enterScope(next: AnnotationScope, opts?: { at?: number; remoteCapability?: DraftRemoteCapability }): AnnotationScopeStamp {
    const at = opts?.at ?? now();
    const epoch = nextScopeEpoch(state.value.epoch, scope.value, next);
    if (epoch === state.value.epoch && scope.value) {
      // 同一 scope：幂等，只允许更新云端能力
      if (opts?.remoteCapability && opts.remoteCapability !== state.value.remote.capability) {
        state.value = applyDraftSessionEvent(state.value, { type: 'remote-capability', capability: opts.remoteCapability, at });
      }
      return stampForScope(next, epoch);
    }
    scope.value = next;
    state.value = applyDraftSessionEvent(state.value, {
      type: 'reset',
      scopeKey: annotationScopeKey(next),
      epoch,
      at,
      remoteCapability: opts?.remoteCapability ?? state.value.remote.capability,
    });
    return stampForScope(next, epoch);
  }

  function leaveScope(at: number = now()): void {
    const epoch = state.value.epoch + 1;
    scope.value = null;
    state.value = applyDraftSessionEvent(state.value, { type: 'reset', scopeKey: '', epoch, at });
  }

  function dispatch(event: DraftSessionEvent, stamp?: AnnotationScopeStamp | null): ScopeStampVerdict {
    if (!scope.value) return { accept: false, reason: 'no-scope' };
    if (stamp) {
      const verdict = judge(stamp);
      if (!verdict.accept) return verdict;
    }
    state.value = applyDraftSessionEvent(state.value, event);
    return { accept: true, reason: 'current' };
  }

  function markEdited(at: number = now()): number {
    if (!scope.value) return 0;
    state.value = applyDraftSessionEvent(state.value, { type: 'edit', at });
    return state.value.localRevision;
  }

  function isTransientReceiptCurrent(stamp: AnnotationScopeStamp | null | undefined): boolean {
    if (!stamp) return true;
    return judge(stamp).accept;
  }

  function routeDataReceipt(stamp: AnnotationScopeStamp | null | undefined): DataReceiptRoute {
    if (!stamp) return { kind: 'unscoped' };
    const verdict = judge(stamp);
    if (verdict.accept || verdict.reason === 'epoch-stale') return { kind: 'current' };
    return { kind: 'other-scope', scopeKey: stamp.scopeKey };
  }

  return {
    state,
    status,
    scope,
    enterScope,
    leaveScope,
    currentStamp,
    judge,
    dispatch,
    markEdited,
    isTransientReceiptCurrent,
    routeDataReceipt,
  };
}

let shared: AnnotationDraftSession | null = null;

/** 应用级单例（U0 接线时由 ReviewPanel / 工具层共用）；测试用 `createAnnotationDraftSession()` 各自建。 */
export function useAnnotationDraftSession(): AnnotationDraftSession {
  if (!shared) shared = createAnnotationDraftSession();
  return shared;
}

/** 测试 / 排障：丢掉单例，下次 `useAnnotationDraftSession()` 重建 */
export function resetAnnotationDraftSessionForTests(): void {
  shared = null;
}
