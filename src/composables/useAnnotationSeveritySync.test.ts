import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/api/reviewApi', () => ({
  annotationSeverityUpdate: vi.fn(),
}));

vi.mock('@/ribbon/toastBus', () => ({
  emitToast: vi.fn(),
}));

const mockRecords = [
  { id: 'a1', type: 'text', severity: 'normal' as string | undefined },
];

const mockUpdateSeverity = vi.fn();

vi.mock('@/composables/useToolStore', () => ({
  useToolStore: () => ({
    getAnnotationRecordsByType: () => mockRecords,
    updateAnnotationSeverity: mockUpdateSeverity,
  }),
}));

import { saveAnnotationSeverity } from './useAnnotationSeveritySync';
import { annotationSeverityUpdate } from '@/api/reviewApi';
import { emitToast } from '@/ribbon/toastBus';

describe('saveAnnotationSeverity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRecords[0].severity = 'normal';
  });

  it('returns true and updates store on backend success', async () => {
    vi.mocked(annotationSeverityUpdate).mockResolvedValue({ success: true, severity: 'severe' });

    const result = await saveAnnotationSeverity('text', 'a1', 'severe');

    expect(result).toBe(true);
    expect(mockUpdateSeverity).toHaveBeenCalledWith('text', 'a1', 'severe');
    expect(emitToast).not.toHaveBeenCalled();
  });

  it('rolls back and returns false on backend rejection', async () => {
    vi.mocked(annotationSeverityUpdate).mockResolvedValue({ success: false, error_message: 'denied' });

    const result = await saveAnnotationSeverity('text', 'a1', 'critical');

    expect(result).toBe(false);
    expect(mockUpdateSeverity).toHaveBeenCalledTimes(2);
    expect(mockUpdateSeverity).toHaveBeenLastCalledWith('text', 'a1', 'normal');
    expect(emitToast).toHaveBeenCalledWith(expect.objectContaining({ level: 'error' }));
  });

  it('rolls back and returns false on network error', async () => {
    vi.mocked(annotationSeverityUpdate).mockRejectedValue(new Error('Network error'));

    const result = await saveAnnotationSeverity('text', 'a1', 'suggestion');

    expect(result).toBe(false);
    expect(mockUpdateSeverity).toHaveBeenLastCalledWith('text', 'a1', 'normal');
    expect(emitToast).toHaveBeenCalledWith(expect.objectContaining({ level: 'error' }));
  });

  it('suppresses toast when silent option is set', async () => {
    vi.mocked(annotationSeverityUpdate).mockResolvedValue({ success: false });

    await saveAnnotationSeverity('text', 'a1', 'severe', { silent: true });

    expect(emitToast).not.toHaveBeenCalled();
  });
});
