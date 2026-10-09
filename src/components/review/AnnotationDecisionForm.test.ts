import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, ref } from 'vue';

import { UserRole } from '@/types/auth';

const currentUser = ref<{ id: string; name: string; role: UserRole } | null>(null);
const reviewState = ref<unknown>(undefined);
const annotationReviewStateApplyMock = vi.fn(async (_payload: unknown) => ({
  success: true,
  state: { resolutionStatus: 'fixed', decisionStatus: 'pending', updatedAt: 1710000000000, history: [] },
}));
const setAnnotationReviewStateMock = vi.fn((_type: string, _id: string, state: unknown) => {
  reviewState.value = state;
  return true;
});
const emitToastMock = vi.fn();

vi.mock('@/api/reviewApi', () => ({
  annotationReviewStateApply: (payload: unknown) => annotationReviewStateApplyMock(payload),
  annotationReviewStatesQuery: vi.fn(async () => ({ success: true, states: [] })),
  normalizeAnnotationReviewStateView: (view: Record<string, unknown>) => ({
    resolutionStatus: view.resolutionStatus,
    decisionStatus: view.decisionStatus,
    note: view.note,
    updatedAt: view.updatedAt,
    history: Array.isArray(view.history) ? view.history : [],
  }),
}));

vi.mock('@/composables/useReviewStore', () => ({
  useReviewStore: () => ({ currentTask: { value: null } }),
}));

vi.mock('@/composables/useToolStore', () => ({
  useToolStore: () => ({
    getAnnotationReviewState: () => reviewState.value,
    setAnnotationReviewState: (type: string, id: string, state: unknown) => setAnnotationReviewStateMock(type, id, state),
    applyAnnotationReviewAction: vi.fn(() => null),
  }),
}));

vi.mock('@/composables/useUserStore', () => ({
  useUserStore: () => ({ currentUser }),
}));

vi.mock('@/composables/useAnnotationReviewStateSync', () => ({
  invalidateAnnotationReviewStatesCache: vi.fn(),
}));

vi.mock('@/ribbon/toastBus', () => ({ emitToast: (...args: unknown[]) => emitToastMock(...args) }));

const unmounts: (() => void)[] = [];

async function flushUi() {
  await nextTick();
  await Promise.resolve();
  await nextTick();
}

async function mountForm(props: Record<string, unknown> = {}) {
  const { default: AnnotationDecisionForm } = await import('./AnnotationDecisionForm.vue');
  const annotationId = ref<string>('annot-1');
  const completedSpy = vi.fn();
  const host = document.createElement('div');
  document.body.appendChild(host);
  const app = createApp({
    render: () => h(AnnotationDecisionForm, {
      annotationType: 'text',
      annotationId: annotationId.value,
      contextFormId: 'FORM-1',
      contextTaskId: 'task-1',
      onReviewActionCompleted: completedSpy,
      ...props,
    }),
  });
  app.mount(host);
  await flushUi();
  unmounts.push(() => {
    app.unmount();
    host.remove();
  });
  return { annotationId, completedSpy };
}

function query<T extends HTMLElement = HTMLElement>(testId: string): T | null {
  return document.querySelector<T>(`[data-testid="${testId}"]`);
}

function typeNote(text: string) {
  const textarea = query<HTMLTextAreaElement>('annotation-decision-note')!;
  textarea.value = text;
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('AnnotationDecisionForm', () => {
  beforeEach(() => {
    currentUser.value = { id: 'designer-1', name: '设计甲', role: UserRole.DESIGNER };
    reviewState.value = undefined;
    annotationReviewStateApplyMock.mockClear();
    setAnnotationReviewStateMock.mockClear();
    emitToastMock.mockClear();
  });

  afterEach(() => {
    unmounts.splice(0).forEach((unmount) => unmount());
    document.body.innerHTML = '';
  });

  it('选「已修改」后可保存：按单据上下文落库、回写状态并透传完成事件', async () => {
    const { completedSpy } = await mountForm();
    const submit = query<HTMLButtonElement>('annotation-decision-submit')!;
    expect(submit.disabled).toBe(true);
    expect(submit.textContent).toContain('保存并处理下一条');

    query<HTMLButtonElement>('annotation-decision-fixed')!.click();
    await flushUi();
    expect(query('annotation-decision-fixed')?.getAttribute('aria-checked')).toBe('true');
    expect(submit.disabled).toBe(false);

    typeNote('已补充 SP-207 编号');
    submit.click();
    await flushUi();

    expect(annotationReviewStateApplyMock).toHaveBeenCalledWith(expect.objectContaining({
      formId: 'FORM-1',
      taskId: 'task-1',
      annotationId: 'annot-1',
      annotationType: 'text',
      action: 'fixed',
      note: '已补充 SP-207 编号',
    }));
    expect(setAnnotationReviewStateMock).toHaveBeenCalled();
    expect(completedSpy).toHaveBeenCalledWith(expect.objectContaining({ action: 'fixed', annotationId: 'annot-1' }));
    expect(query('annotation-decision-fixed')?.getAttribute('aria-checked')).toBe('false');
    expect(query<HTMLTextAreaElement>('annotation-decision-note')?.value).toBe('');
  });

  it('「不需解决」没填原因时不能保存并提示必填，填了才放行', async () => {
    await mountForm();

    query<HTMLButtonElement>('annotation-decision-wont-fix')!.click();
    await flushUi();
    expect(query<HTMLButtonElement>('annotation-decision-submit')?.disabled).toBe(true);
    expect(query('annotation-decision-note-hint')?.textContent).toContain('需先填写原因');
    expect(query<HTMLTextAreaElement>('annotation-decision-note')?.placeholder).toContain('必填');

    typeNote('规格书已更新，以模型为准');
    await flushUi();
    expect(query('annotation-decision-note-hint')).toBeNull();
    expect(query<HTMLButtonElement>('annotation-decision-submit')?.disabled).toBe(false);
  });

  it('有单据但没匹配到内部任务时提示且不能保存', async () => {
    await mountForm({ contextTaskId: null });

    query<HTMLButtonElement>('annotation-decision-fixed')!.click();
    await flushUi();

    expect(query('annotation-decision-context-warning')?.textContent).toContain('未匹配到内部任务');
    expect(query<HTMLButtonElement>('annotation-decision-submit')?.disabled).toBe(true);
  });

  it('非设计角色不渲染处理表单', async () => {
    currentUser.value = { id: 'checker-1', name: '校对甲', role: UserRole.PROOFREADER };
    await mountForm();

    expect(query('annotation-decision-form')).toBeNull();
  });

  it('切换到另一条批注时清空已选结论和说明', async () => {
    const { annotationId } = await mountForm();
    query<HTMLButtonElement>('annotation-decision-wont-fix')!.click();
    typeNote('先写一半');
    await flushUi();

    annotationId.value = 'annot-2';
    await flushUi();

    expect(query('annotation-decision-wont-fix')?.getAttribute('aria-checked')).toBe('false');
    expect(query<HTMLTextAreaElement>('annotation-decision-note')?.value).toBe('');
  });
});
