/**
 * 批注处理动作（已修改 / 不需解决 / 同意 / 驳回）的状态与提交。
 *
 * ReviewCommentsTimeline 的处理区和设计侧行内展开区的 AnnotationDecisionForm 必须共用这一份
 * 门禁、备注必填规则、后端落库与本地回写，否则两处口径会漂移。
 */
import { computed, ref } from 'vue';

import type { AnnotationType } from '@/composables/useToolStore';

import {
  annotationReviewStateApply,
  annotationReviewStatesQuery,
  normalizeAnnotationReviewStateView,
  type AnnotationReviewStateView,
} from '@/api/reviewApi';
import { invalidateAnnotationReviewStatesCache } from '@/composables/useAnnotationReviewStateSync';
import { useReviewStore } from '@/composables/useReviewStore';
import { useToolStore } from '@/composables/useToolStore';
import { useUserStore } from '@/composables/useUserStore';
import { emitToast } from '@/ribbon/toastBus';
import {
  type AnnotationReviewAction,
  type AnnotationReviewState,
  getAnnotationReviewDisplay,
  getRoleDisplayName,
  UserRole,
} from '@/types/auth';

export type AnnotationReviewActionCompletedPayload = {
  action: AnnotationReviewAction;
  annotationType: AnnotationType;
  annotationId: string;
  state: AnnotationReviewState;
};

export type AnnotationReviewActionOptions = {
  annotationType: () => AnnotationType | null;
  annotationId: () => string | null;
  /** 调用方显式给的单据 / 任务上下文；两者都是 undefined 时退回 reviewStore.currentTask */
  contextFormId: () => string | null | undefined;
  contextTaskId: () => string | null | undefined;
  allowReviewActions: () => boolean;
  designerOnly: () => boolean;
  onCompleted: (payload: AnnotationReviewActionCompletedPayload) => void;
};

function normalizeContextString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

export function useAnnotationReviewAction(options: AnnotationReviewActionOptions) {
  const store = useToolStore();
  const reviewStore = useReviewStore();
  const userStore = useUserStore();

  const actionNote = ref('');
  const selectedReviewAction = ref<AnnotationReviewAction | null>(null);
  const actionSubmitting = ref(false);

  /**
   * 集中计算评论 / 处理动作的上下文：
   * - 调用方显式传入的 `contextFormId / contextTaskId` 优先；
   * - 都未提供时（调用方未明确）退回 `reviewStore.currentTask` 兜底，保持向后兼容；
   * - 正式 `formId` 存在但 `taskId` 缺失时仍要求显式表态，避免假成功。
   *
   * 该 computed 是读取后端、加载 store、写入与本地降级的唯一上下文来源。
   */
  const commentContext = computed(() => {
    const contextFormId = options.contextFormId();
    const contextTaskId = options.contextTaskId();
    if (contextFormId !== undefined || contextTaskId !== undefined) {
      return {
        formId: normalizeContextString(contextFormId),
        taskId: normalizeContextString(contextTaskId),
      };
    }
    const task = reviewStore.currentTask.value;
    return {
      formId: normalizeContextString(task?.formId ?? null),
      taskId: normalizeContextString(task?.id ?? null),
    };
  });

  const currentUser = computed(() => userStore.currentUser.value);

  const reviewState = computed(() => {
    const annotationType = options.annotationType();
    const annotationId = options.annotationId();
    if (!annotationType || !annotationId) return null;
    return store.getAnnotationReviewState(annotationType, annotationId);
  });

  const reviewDisplay = computed(() => (
    reviewState.value ? getAnnotationReviewDisplay(reviewState.value) : null
  ));

  const canDesignHandle = computed(() => {
    const role = currentUser.value?.role;
    return role === UserRole.DESIGNER || role === UserRole.ADMIN;
  });

  const canReviewDecide = computed(() => {
    if (options.designerOnly()) return false;
    const role = currentUser.value?.role;
    return role === UserRole.PROOFREADER
      || role === UserRole.REVIEWER
      || role === UserRole.MANAGER
      || role === UserRole.ADMIN;
  });

  const canDecisionAct = computed(() => {
    return canReviewDecide.value && reviewState.value?.resolutionStatus !== 'open';
  });

  const showReviewActions = computed(() => {
    if (options.allowReviewActions() === false) return false;
    const role = currentUser.value?.role;
    if (!role) return false;
    if (options.designerOnly()) {
      return canDesignHandle.value;
    }
    return [
      UserRole.DESIGNER,
      UserRole.PROOFREADER,
      UserRole.REVIEWER,
      UserRole.MANAGER,
      UserRole.ADMIN,
    ].includes(role);
  });

  /**
   * 处理动作提交门禁。
   *
   * 设计原则：
   * - 任何正式流程动作都必须同时具备 `formId + taskId`，否则直接屏蔽提交，
   *   避免无任务上下文写本地状态再被当作流转依据；
   * - 没有 `formId` 的纯草稿（例如外部入口未匹配到单据）允许本地处理，
   *   但是否暴露按钮仍由调用方通过 `allowReviewActions` 决定。
   */
  const hasFormalReviewContext = computed(() => (
    !!commentContext.value.formId && !!commentContext.value.taskId
  ));
  const isLocalDraftReviewContext = computed(() => !commentContext.value.formId);
  const canSubmitReviewAction = computed(() => (
    options.allowReviewActions() !== false
    && (hasFormalReviewContext.value || isLocalDraftReviewContext.value)
  ));
  const reviewContextWarning = computed(() => {
    if (options.allowReviewActions() === false) return null;
    if (!commentContext.value.formId) return null;
    if (commentContext.value.taskId) return null;
    return '未匹配到内部任务，不能保存处理状态';
  });

  /** 「不需解决」与「驳回」必须说明原因（applyReviewAction 里会拦）；占位符与提示要与这条校验说一样的话。 */
  const reviewActionNoteRequired = computed(() => (
    selectedReviewAction.value === 'wont_fix' || selectedReviewAction.value === 'reject'
  ));
  const reviewActionNoteMissing = computed(() => (
    reviewActionNoteRequired.value && !actionNote.value.trim()
  ));

  /**
   * 备注占位符随所选动作变化：选了必填动作就明说「必填」，没选时把两种口径都写出来，
   * 不再一律写「可选」（09-21 真机：设计点「不需解决」直接提交，被 toast 拦下才知道要填原因）。
   * 前缀「处理备注」/「决定备注」保持不变，自动化按 placeholder 子串定位不受影响。
   */
  const reviewActionPlaceholder = computed(() => {
    if (canDesignHandle.value) {
      switch (selectedReviewAction.value) {
        case 'wont_fix':
          return '处理备注（必填：为什么不需解决，依据是什么）';
        case 'fixed':
          return '处理备注（可选，例如修改说明）';
        default:
          return '处理备注（已修改可不填；不需解决必填原因）';
      }
    }
    if (canReviewDecide.value) {
      switch (selectedReviewAction.value) {
        case 'reject':
          return '决定备注（必填：驳回原因，设计要按这个重新处理）';
        case 'agree':
          return '决定备注（可选，例如同意理由）';
        default:
          return '决定备注（同意可不填；驳回必填原因）';
      }
    }
    return '输入意见...';
  });

  const reviewActionNoteRequiredHint = computed(() => {
    if (!reviewActionNoteMissing.value) return null;
    return selectedReviewAction.value === 'wont_fix'
      ? '「不需解决」需先填写原因，才能提交处理结果'
      : '「驳回」需先填写驳回原因，才能提交确认结果';
  });

  const reviewActionHint = computed(() => {
    if (!currentUser.value) return '登录后可参与该批注的处理和讨论。';
    if (canDesignHandle.value) return '设计人员可将批注标记为已修改或不需解决，动作会记录在时间线中。';
    if (canReviewDecide.value && !canDecisionAct.value) {
      return '请等待设计人员先标记为已修改或不需解决，然后再做同意或驳回。';
    }
    if (canReviewDecide.value) return '校对/审核人员可对设计处理结果执行同意或驳回，并继续补充意见。';
    return `当前角色为${getRoleDisplayName(currentUser.value.role)}，仅可查看处理状态与讨论。`;
  });

  const reviewActionSubmitLabel = computed(() => (
    canDesignHandle.value ? '提交处理结果' : '提交确认结果'
  ));

  function canSelectReviewAction(action: AnnotationReviewAction): boolean {
    if (action === 'fixed' || action === 'wont_fix') return canDesignHandle.value;
    if (action === 'agree' || action === 'reject') return canDecisionAct.value;
    return false;
  }

  function selectReviewAction(action: AnnotationReviewAction) {
    if (!canSelectReviewAction(action)) return;
    selectedReviewAction.value = action;
  }

  function reset() {
    actionNote.value = '';
    selectedReviewAction.value = null;
  }

  async function resolvePersistedReviewState(params: {
    formId: string;
    taskId: string;
    annotationId: string;
    annotationType: AnnotationType;
    actionResponseState?: AnnotationReviewStateView;
  }) {
    if (params.actionResponseState) {
      return normalizeAnnotationReviewStateView(params.actionResponseState);
    }

    const queryResp = await annotationReviewStatesQuery({
      formId: params.formId,
      taskId: params.taskId,
    });
    const matched = queryResp.states?.find((state) => (
      state.annotationId === params.annotationId && state.annotationType === params.annotationType
    ));
    return matched ? normalizeAnnotationReviewStateView(matched) : null;
  }

  async function applyReviewAction(action: AnnotationReviewAction) {
    const annotationType = options.annotationType();
    const annotationId = options.annotationId();
    if (!annotationType || !annotationId) return;
    const user = currentUser.value;
    if (!user) return;

    if (options.allowReviewActions() === false) return;

    if ((action === 'fixed' || action === 'wont_fix') && !canDesignHandle.value) return;
    if ((action === 'agree' || action === 'reject') && !canDecisionAct.value) return;

    const note = actionNote.value.trim();
    if (action === 'wont_fix' && !note) {
      emitToast({ message: '请填写不需解决原因', level: 'warning' });
      return;
    }
    if (action === 'reject' && !note) {
      emitToast({ message: '请填写驳回原因', level: 'warning' });
      return;
    }

    const ctx = commentContext.value;
    const formId = ctx.formId;
    const taskId = ctx.taskId;

    // 正式上下文必须同时具备 formId + taskId 才允许后端落库；
    // 仅 formId 没有 taskId（例如外部入口未匹配到内部任务）属于"无内部任务"状态，
    // 不再走本地 applyAnnotationReviewAction 假成功，避免本地状态被当作流转依据。
    if (formId && !taskId) {
      emitToast({ message: '未匹配到内部任务，不能保存处理状态', level: 'warning' });
      return;
    }

    let persistedState: ReturnType<typeof normalizeAnnotationReviewStateView> | null = null;

    if (formId && taskId) {
      actionSubmitting.value = true;
      try {
        const resp = await annotationReviewStateApply({
          formId,
          taskId,
          annotationId,
          annotationType: annotationType as 'text' | 'cloud' | 'rect' | 'obb',
          action,
          note: note || undefined,
        });
        if (!resp.success) {
          emitToast({ message: resp.errorMessage || '更新批注处理状态失败', level: 'error' });
          return;
        }
        // 服务端状态刚变：作废 syncAnnotationReviewStates 短窗里这张单据的旧回包，免得面板紧接着 sync 把旧状态写回来
        invalidateAnnotationReviewStatesCache(formId);
        persistedState = await resolvePersistedReviewState({
          formId,
          taskId,
          annotationId,
          annotationType,
          actionResponseState: resp.state,
        });
        if (!persistedState) {
          emitToast({ message: '处理状态已提交，请刷新后查看最新状态', level: 'warning' });
          return;
        }
      } catch (err) {
        emitToast({
          message: err instanceof Error ? err.message : '更新批注处理状态失败',
          level: 'error',
        });
        return;
      } finally {
        actionSubmitting.value = false;
      }
    }

    const nextState = persistedState
      ? (store.setAnnotationReviewState(annotationType, annotationId, persistedState) ? persistedState : null)
      : store.applyAnnotationReviewAction(annotationType, annotationId, {
        action,
        actor: user,
        note,
      });

    if (!nextState) {
      emitToast({ message: '更新批注处理状态失败', level: 'error' });
      return;
    }

    reset();
    const successMessageMap: Record<AnnotationReviewAction, string> = {
      fixed: '批注已标记为已修改',
      wont_fix: '批注已标记为不需解决',
      agree: '已同意该批注处理结果',
      reject: '已驳回该批注处理结果',
    };
    emitToast({
      message: successMessageMap[action],
      level: 'success',
    });
    options.onCompleted({
      action,
      annotationType,
      annotationId,
      state: nextState,
    });
  }

  async function submitSelectedReviewAction() {
    if (!selectedReviewAction.value || actionSubmitting.value) return;
    await applyReviewAction(selectedReviewAction.value);
  }

  return {
    commentContext,
    currentUser,
    actionNote,
    selectedReviewAction,
    actionSubmitting,
    reviewState,
    reviewDisplay,
    showReviewActions,
    canSubmitReviewAction,
    reviewContextWarning,
    canDesignHandle,
    canReviewDecide,
    canDecisionAct,
    reviewActionNoteRequired,
    reviewActionNoteMissing,
    reviewActionPlaceholder,
    reviewActionNoteRequiredHint,
    reviewActionHint,
    reviewActionSubmitLabel,
    canSelectReviewAction,
    selectReviewAction,
    submitSelectedReviewAction,
    applyReviewAction,
    reset,
  };
}
