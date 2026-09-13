import { describe, expect, it } from 'vitest';

import { isDevOnlyFallbackEnabled } from './runtimeFallback';

describe('isDevOnlyFallbackEnabled', () => {
  it('fails closed in production regardless of configuration', () => {
    expect(isDevOnlyFallbackEnabled({ isDev: false })).toBe(false);
    expect(isDevOnlyFallbackEnabled({ isDev: false, configured: 'true' })).toBe(false);
  });

  it('defaults to enabled only in development', () => {
    expect(isDevOnlyFallbackEnabled({ isDev: true })).toBe(true);
  });

  it('allows development fallback to be explicitly disabled', () => {
    expect(isDevOnlyFallbackEnabled({ isDev: true, configured: 'false' })).toBe(false);
    expect(isDevOnlyFallbackEnabled({ isDev: true, configured: 'unexpected' })).toBe(false);
  });
});
