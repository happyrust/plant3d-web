import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/api/reviewApi', () => ({
  annotationSeverityUpdate: vi.fn(),
  annotationBasicFieldsUpdate: vi.fn(),
}));

vi.mock('@/ribbon/toastBus', () => ({
  emitToast: vi.fn(),
}));

const mockRecords = [
  { id: 'a1', type: 'text', severity: 'general' as string | undefined, title: '旧标题', description: '旧描述' },
];

const mockUpdateSeverity = vi.fn();
const mockUpdateBasicFields = vi.fn();
const mockPatchPersistedAnnotationInScope = vi.fn(() => true);

vi.mock('@/composables/useToolStore', () => ({
  useToolStore: () => ({
    getAnnotationRecordsByType: () => mockRecords,
    updateAnnotationSeverity: mockUpdateSeverity,
    updateAnnotationBasicFields: mockUpdateBasicFields,
    patchPersistedAnnotationInScope: mockPatchPersistedAnnotationInScope,
  }),
}));

import { resetAnnotationDraftSessionForTests, useAnnotationDraftSession } from './useAnnotationDraftSession';
import { saveAnnotationBasicFields, saveAnnotationSeverity } from './useAnnotationSeveritySync';

import { annotationBasicFieldsUpdate, annotationSeverityUpdate } from '@/api/reviewApi';
import { annotationScopeKey, buildAnnotationScope } from '@/review/domain/annotationScope';
import { emitToast } from '@/ribbon/toastBus';

describe('saveAnnotationSeverity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAnnotationDraftSessionForTests();
    mockRecords[0].severity = 'general';
    mockRecords[0].title = '旧标题';
    mockRecords[0].description = '旧描述';
  });

  it('U0 回执守卫：请求期间切了任务，回滚写进出发时那个 scope 的容器、不碰当前任务内存、不弹提示', async () => {
    const session = useAnnotationDraftSession();
    const scopeA = buildAnnotationScope({ projectId: 'p', taskId: 'task-A', userId: 'JH' });
    const scopeB = buildAnnotationScope({ projectId: 'p', taskId: 'task-B', userId: 'JH' });
    session.enterScope(scopeA);

    const rejectRef: { current: ((err: Error) => void) | null } = { current: null };
    vi.mocked(annotationSeverityUpdate).mockImplementation(() => new Promise((_resolve, rej) => {
      rejectRef.current = rej;
    }));

    const pending = saveAnnotationSeverity('text', 'a1', 'principle');
    expect(mockUpdateSeverity).toHaveBeenCalledWith('text', 'a1', 'principle');
    // 请求还在飞，用户切到 B
    session.enterScope(scopeB);
    rejectRef.current?.(new Error('Network error'));

    expect(await pending).toBe(false);
    expect(mockUpdateSeverity).toHaveBeenCalledTimes(1);
    expect(mockPatchPersistedAnnotationInScope).toHaveBeenCalledWith(annotationScopeKey(scopeA), 'text', 'a1', { severity: 'general' });
    expect(emitToast).not.toHaveBeenCalled();
    session.leaveScope();
  });

  it('U0 回执守卫：A → B → A 之后回执到达，仍是 A 就回滚内存（epoch 变了不影响数据类回执）', async () => {
    const session = useAnnotationDraftSession();
    const scopeA = buildAnnotationScope({ projectId: 'p', taskId: 'task-A', userId: 'JH' });
    const scopeB = buildAnnotationScope({ projectId: 'p', taskId: 'task-B', userId: 'JH' });
    session.enterScope(scopeA);

    const rejectRef: { current: ((err: Error) => void) | null } = { current: null };
    vi.mocked(annotationSeverityUpdate).mockImplementation(() => new Promise((_resolve, rej) => {
      rejectRef.current = rej;
    }));

    const pending = saveAnnotationSeverity('text', 'a1', 'principle');
    session.enterScope(scopeB);
    session.enterScope(scopeA);
    rejectRef.current?.(new Error('Network error'));

    expect(await pending).toBe(false);
    expect(mockUpdateSeverity).toHaveBeenLastCalledWith('text', 'a1', 'general');
    expect(mockPatchPersistedAnnotationInScope).not.toHaveBeenCalled();
    expect(emitToast).toHaveBeenCalledWith(expect.objectContaining({ level: 'error' }));
    session.leaveScope();
  });

  it('returns true and updates store on backend success', async () => {
    vi.mocked(annotationSeverityUpdate).mockResolvedValue({ success: true, severity: 'principle' });

    const result = await saveAnnotationSeverity('text', 'a1', 'principle', {
      formId: 'FORM-001',
      taskId: 'task-1',
    });

    expect(result).toBe(true);
    expect(mockUpdateSeverity).toHaveBeenCalledWith('text', 'a1', 'principle');
    expect(annotationSeverityUpdate).toHaveBeenCalledWith('a1', 'text', 'principle', {
      formId: 'FORM-001',
      taskId: 'task-1',
    });
    expect(emitToast).not.toHaveBeenCalled();
  });

  it('rolls back and returns false on backend rejection', async () => {
    vi.mocked(annotationSeverityUpdate).mockResolvedValue({ success: false, error_message: 'denied' });

    const result = await saveAnnotationSeverity('text', 'a1', 'drawing');

    expect(result).toBe(false);
    expect(mockUpdateSeverity).toHaveBeenCalledTimes(2);
    expect(mockUpdateSeverity).toHaveBeenLastCalledWith('text', 'a1', 'general');
    expect(emitToast).toHaveBeenCalledWith(expect.objectContaining({ level: 'error' }));
  });

  it('rolls back and returns false on network error', async () => {
    vi.mocked(annotationSeverityUpdate).mockRejectedValue(new Error('Network error'));

    const result = await saveAnnotationSeverity('text', 'a1', 'principle');

    expect(result).toBe(false);
    expect(mockUpdateSeverity).toHaveBeenLastCalledWith('text', 'a1', 'general');
    expect(emitToast).toHaveBeenCalledWith(expect.objectContaining({ level: 'error' }));
  });

  it('suppresses toast when silent option is set', async () => {
    vi.mocked(annotationSeverityUpdate).mockResolvedValue({ success: false });

    await saveAnnotationSeverity('text', 'a1', 'principle', { silent: true });

    expect(emitToast).not.toHaveBeenCalled();
  });

  it('saves basic fields with form/task context', async () => {
    vi.mocked(annotationBasicFieldsUpdate).mockResolvedValue({ success: true, title: '新标题' });

    const result = await saveAnnotationBasicFields('text', 'a1', { title: '新标题' }, {
      formId: 'FORM-001',
      taskId: 'task-1',
    });

    expect(result).toBe(true);
    expect(mockUpdateBasicFields).toHaveBeenCalledWith('text', 'a1', { title: '新标题' });
    expect(annotationBasicFieldsUpdate).toHaveBeenCalledWith('a1', 'text', { title: '新标题' }, {
      formId: 'FORM-001',
      taskId: 'task-1',
    });
  });

  it('rolls back basic fields on backend rejection', async () => {
    vi.mocked(annotationBasicFieldsUpdate).mockResolvedValue({ success: false, error_message: 'denied' });

    const result = await saveAnnotationBasicFields('text', 'a1', { title: '新标题' });

    expect(result).toBe(false);
    expect(mockUpdateBasicFields).toHaveBeenCalledTimes(2);
    expect(mockUpdateBasicFields).toHaveBeenLastCalledWith('text', 'a1', {
      title: '旧标题',
      description: '旧描述',
    });
    expect(emitToast).toHaveBeenCalledWith(expect.objectContaining({ level: 'error' }));
  });
});
