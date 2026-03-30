import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

function setSearch(search: string) {
  const s = String(search || '');
  const next = s === '' ? '/' : s.startsWith('?') ? s : `?${s}`;
  window.history.pushState({}, '', next);
}

describe('isAutoGenerationEnabled', () => {
  beforeEach(() => {
    setSearch('');
    vi.resetModules();
  });

  afterEach(() => {
    setSearch('');
    vi.resetModules();
  });

  it('defaults to false (auto generation disabled)', async () => {
    const { isAutoGenerationEnabled } = await import('@/composables/useModelGeneration');
    expect(isAutoGenerationEnabled()).toBe(false);
  });

  it('returns true when query dtx_enable_auto_generation=1', async () => {
    setSearch('?dtx_enable_auto_generation=1');
    const { isAutoGenerationEnabled } = await import('@/composables/useModelGeneration');
    expect(isAutoGenerationEnabled()).toBe(true);
  });

  it('does not accept legacy query skip_auto_gen=1', async () => {
    setSearch('?skip_auto_gen=1');
    const { isAutoGenerationEnabled } = await import('@/composables/useModelGeneration');
    expect(isAutoGenerationEnabled()).toBe(false);
  });

  it('does not accept legacy query dtx_skip_auto_generation=1', async () => {
    setSearch('?dtx_skip_auto_generation=1');
    const { isAutoGenerationEnabled } = await import('@/composables/useModelGeneration');
    expect(isAutoGenerationEnabled()).toBe(false);
  });
});
