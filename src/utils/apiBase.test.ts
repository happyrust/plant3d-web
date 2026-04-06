import { describe, expect, it } from 'vitest';

import { resolveBackendApiBaseUrl } from './apiBase';

describe('resolveBackendApiBaseUrl', () => {
  it('在开发环境将 localhost 后端折叠为同源代理，避免与 127.0.0.1 页面跨域', () => {
    expect(resolveBackendApiBaseUrl({
      envBase: 'http://localhost:3100',
      isDev: true,
      browserOrigin: 'http://127.0.0.1:3101',
    })).toBe('');
  });

  it('在开发环境将 127.0.0.1 后端折叠为同源代理，避免与 localhost 页面跨域', () => {
    expect(resolveBackendApiBaseUrl({
      envBase: 'http://127.0.0.1:3100',
      isDev: true,
      browserOrigin: 'http://localhost:3101',
    })).toBe('');
  });

  it('在开发环境无浏览器 origin 时保留本地绝对地址，便于脚本直接调用', () => {
    expect(resolveBackendApiBaseUrl({
      envBase: 'http://localhost:3100/',
      isDev: true,
      browserOrigin: null,
    })).toBe('http://localhost:3100');
  });

  it('在开发环境保留远端 API 地址', () => {
    expect(resolveBackendApiBaseUrl({
      envBase: 'https://api.example.com/',
      isDev: true,
      browserOrigin: 'http://127.0.0.1:3101',
    })).toBe('https://api.example.com');
  });
});
