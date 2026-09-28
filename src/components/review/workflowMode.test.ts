import { afterEach, describe, expect, it, vi } from 'vitest';

import { resolvePassiveWorkflowMode, resolveWorkflowMode } from './workflowMode';

describe('workflowMode', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('defaults to external mode even when compatibility sources request internal mode', () => {
    expect(resolveWorkflowMode({
      verifiedWorkflowMode: 'manual',
      search: '?workflow_mode=internal',
      sessionStorageLike: { getItem: () => 'manual' },
      localStorageLike: { getItem: () => 'internal' },
      embedParams: { workflowMode: 'manual', externalWorkflowMode: false },
    })).toBe('external');
    expect(resolvePassiveWorkflowMode({ verifiedWorkflowMode: 'manual' })).toBe(true);
  });

  it('prefers verified workflow mode over query and storage fallbacks', () => {
    vi.stubEnv('VITE_REVIEW_ENABLE_INTERNAL_WORKFLOW_MODE', '1');

    expect(resolveWorkflowMode({
      verifiedWorkflowMode: 'manual',
      search: '?workflow_mode=external',
      sessionStorageLike: { getItem: () => 'external' },
      localStorageLike: { getItem: () => 'external' },
      embedParams: { workflowMode: 'external', externalWorkflowMode: true },
    })).toBe('manual');
  });

  it('falls back to external mode when claims and compatibility sources are absent', () => {
    expect(resolveWorkflowMode()).toBe('external');
    expect(resolvePassiveWorkflowMode()).toBe(true);
  });

  it('treats manual/internal as active workflow modes', () => {
    vi.stubEnv('VITE_REVIEW_ENABLE_INTERNAL_WORKFLOW_MODE', 'true');

    expect(resolvePassiveWorkflowMode({ verifiedWorkflowMode: 'manual' })).toBe(false);
    expect(resolvePassiveWorkflowMode({ verifiedWorkflowMode: 'internal' })).toBe(false);
  });
});
