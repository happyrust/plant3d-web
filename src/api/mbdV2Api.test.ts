import { describe, expect, it } from 'vitest';

import { resolveMbdApiBaseUrl } from './mbdV2Api';

describe('resolveMbdApiBaseUrl', () => {
  it('uses a dedicated MBD backend port without redirecting the other APIs', () => {
    expect(resolveMbdApiBaseUrl({
      search: '?backendPort=3101&mbdBackendPort=18084',
      envBase: '',
      browserHostname: '127.0.0.1',
    })).toBe('http://127.0.0.1:18084');
  });

  it('uses the dedicated environment base when no query override exists', () => {
    expect(resolveMbdApiBaseUrl({
      search: '',
      envBase: 'http://localhost:18084/',
      browserHostname: '127.0.0.1',
    })).toBe('http://localhost:18084');
  });

  it('falls back to the normal backend when no dedicated MBD backend exists', () => {
    expect(resolveMbdApiBaseUrl({
      search: '?backendPort=3101',
      envBase: '',
      browserHostname: '127.0.0.1',
    })).toBe('');
  });
});
