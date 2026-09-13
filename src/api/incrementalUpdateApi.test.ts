import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('incrementalUpdateApi demo fallback gate', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('propagates the backend failure when development demo fallback is disabled', async () => {
    vi.stubEnv('VITE_INCREMENTAL_ALLOW_DEMO_FALLBACK', 'false');
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch incremental monitor'));
    vi.stubGlobal('fetch', fetchMock);

    const { loadIncrementalMonitor } = await import('./incrementalUpdateApi');

    await expect(loadIncrementalMonitor({ project: 'P' }))
      .rejects.toThrow('Failed to fetch incremental monitor');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
