import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isDimensionFlagEnabled } from './flags';

function createStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: key => values.get(key) ?? null,
    key: index => [...values.keys()][index] ?? null,
    removeItem: key => values.delete(key),
    setItem: (key, value) => values.set(key, String(value)),
  };
}

describe('dimension development flags', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: createStorage(),
    });
    window.localStorage.clear();
    window.history.replaceState({}, '', '/');
    vi.stubEnv('VITE_DIMENSION_V2_DEV', '');
    vi.stubEnv('VITE_DIMENSION_V2_CUTOVER', '');
    vi.stubEnv('PROD', false);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('prefers an explicit local override over the Vite environment', () => {
    vi.stubEnv('VITE_DIMENSION_V2_DEV', 'true');
    window.localStorage.setItem('dimension.flag.DIMENSION_V2_DEV', 'false');

    expect(isDimensionFlagEnabled('DIMENSION_V2_DEV')).toBe(false);
  });

  it('uses the Vite environment when no local override exists', () => {
    vi.stubEnv('VITE_DIMENSION_V2_DEV', '1');

    expect(isDimensionFlagEnabled('DIMENSION_V2_DEV')).toBe(true);
  });

  it('allows the demo query only outside production', () => {
    window.history.replaceState({}, '', '/?dimension_demo=1');

    expect(isDimensionFlagEnabled('DIMENSION_V2_DEV')).toBe(true);

    vi.stubEnv('PROD', true);
    expect(isDimensionFlagEnabled('DIMENSION_V2_DEV')).toBe(false);
  });

  it('does not let the demo query override an explicit cutover setting', () => {
    window.history.replaceState({}, '', '/?dimension_demo=1');
    vi.stubEnv('VITE_DIMENSION_V2_CUTOVER', 'false');

    expect(isDimensionFlagEnabled('DIMENSION_V2_CUTOVER')).toBe(false);
  });

  it('keeps development and production cutover disabled by default', () => {
    expect(isDimensionFlagEnabled('DIMENSION_V2_DEV')).toBe(false);
    expect(isDimensionFlagEnabled('DIMENSION_V2_CUTOVER')).toBe(false);
  });
});
