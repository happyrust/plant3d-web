import { describe, expect, it } from 'vitest';

import { resolvePassiveWorkflowMode, resolveWorkflowMode } from './workflowMode';

describe('workflowMode', () => {
  it('prefers verified workflow mode over query and storage fallbacks', () => {
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
    expect(resolvePassiveWorkflowMode({ verifiedWorkflowMode: 'manual' })).toBe(false);
    expect(resolvePassiveWorkflowMode({ verifiedWorkflowMode: 'internal' })).toBe(false);
  });
});
