import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/api/reviewApi', () => ({
  annotationSeverityUpdate: vi.fn(),
  annotationBasicFieldsUpdate: vi.fn(),
  annotationScreenshotUpdate: vi.fn(),
}));

vi.mock('@/ribbon/toastBus', () => ({
  emitToast: vi.fn(),
}));

const mockRecords = [
  {
    id: 'a1',
    type: 'text',
    severity: 'general' as string | undefined,
    title: '旧标题',
    description: '旧描述',
    screenshot: { url: '/old.png', attachmentId: 'att-old' },
  },
];

const mockUpdateSeverity = vi.fn();
const mockUpdateBasicFields = vi.fn();
const mockSetAnnotationScreenshot = vi.fn();
const mockClearAnnotationScreenshot = vi.fn();

vi.mock('@/composables/useToolStore', () => ({
  useToolStore: () => ({
    getAnnotationRecordsByType: () => mockRecords,
    updateAnnotationSeverity: mockUpdateSeverity,
    updateAnnotationBasicFields: mockUpdateBasicFields,
    setAnnotationScreenshot: mockSetAnnotationScreenshot,
    clearAnnotationScreenshot: mockClearAnnotationScreenshot,
  }),
}));

import { saveAnnotationBasicFields, saveAnnotationScreenshot, saveAnnotationSeverity } from './useAnnotationSeveritySync';

import { annotationBasicFieldsUpdate, annotationScreenshotUpdate, annotationSeverityUpdate } from '@/api/reviewApi';
import { emitToast } from '@/ribbon/toastBus';

describe('saveAnnotationSeverity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRecords[0].severity = 'general';
    mockRecords[0].title = '旧标题';
    mockRecords[0].description = '旧描述';
    mockRecords[0].screenshot = { url: '/old.png', attachmentId: 'att-old' };
    mockSetAnnotationScreenshot.mockReturnValue(true);
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

  it('saves screenshot with form/task context and keeps optimistic store update on backend success', async () => {
    vi.mocked(annotationScreenshotUpdate).mockResolvedValue({
      success: true,
      screenshot: { url: '/new.png', attachmentId: 'att-new', name: 'new.png', capturedAt: 1777041600000 },
    });

    const next = { url: '/new.png', attachmentId: 'att-new', name: 'new.png', capturedAt: 1777041600000 };
    const result = await saveAnnotationScreenshot('text', 'a1', next, {
      formId: 'FORM-001',
      taskId: 'task-1',
    });

    expect(result).toBe(true);
    expect(mockSetAnnotationScreenshot).toHaveBeenCalledWith('text', 'a1', next);
    expect(annotationScreenshotUpdate).toHaveBeenCalledWith('a1', 'text', next, {
      formId: 'FORM-001',
      taskId: 'task-1',
    });
    expect(emitToast).not.toHaveBeenCalled();
  });

  it('keeps pending annotation screenshot locally when persist is false', async () => {
    const next = { url: '/pending.png', attachmentId: 'att-pending' };

    const result = await saveAnnotationScreenshot('text', 'a1', next, {
      formId: 'FORM-001',
      taskId: 'task-1',
      persist: false,
    });

    expect(result).toBe(true);
    expect(mockSetAnnotationScreenshot).toHaveBeenCalledWith('text', 'a1', next);
    expect(annotationScreenshotUpdate).not.toHaveBeenCalled();
    expect(emitToast).not.toHaveBeenCalled();
  });

  it('rolls screenshot back when backend rejects the patch', async () => {
    vi.mocked(annotationScreenshotUpdate).mockResolvedValue({ success: false, error_message: 'denied' });

    const result = await saveAnnotationScreenshot('text', 'a1', { url: '/new.png', attachmentId: 'att-new' });

    expect(result).toBe(false);
    expect(mockSetAnnotationScreenshot).toHaveBeenCalledTimes(2);
    expect(mockSetAnnotationScreenshot).toHaveBeenLastCalledWith('text', 'a1', {
      url: '/old.png',
      attachmentId: 'att-old',
    });
    expect(emitToast).toHaveBeenCalledWith(expect.objectContaining({ level: 'error' }));
  });
});
