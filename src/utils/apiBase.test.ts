import { describe, expect, it } from 'vitest';

import { resolveBackendApiBaseUrl, resolveGenModelV1BaseUrl } from './apiBase';

describe('resolveGenModelV1BaseUrl（gen-model /api/v1，与旧后端地址互不影响）', () => {
  it('开发环境默认直连 :8022（gen-model CORS 已放开，不绕代理）', () => {
    expect(resolveGenModelV1BaseUrl({ isDev: true, browserOrigin: 'http://localhost:3101' }))
      .toBe('http://localhost:8022');
  });

  it('生产构建没配环境变量时走同源 /api/v1（base 为空），不生成 /gm 或 localhost', () => {
    expect(resolveGenModelV1BaseUrl({ isDev: false })).toBe('');
    const base = resolveGenModelV1BaseUrl({
      isDev: false,
      browserOrigin: 'https://plant.example.com',
    });
    expect(base).toBe('');
    expect(`${base}/api/v1/health`).toBe('/api/v1/health');
  });

  it('环境变量可以是绝对地址（去尾斜杠）或 /gm 一类相对前缀', () => {
    expect(resolveGenModelV1BaseUrl({ isDev: true, envBase: 'http://10.0.0.5:8022/' })).toBe('http://10.0.0.5:8022');
    expect(resolveGenModelV1BaseUrl({ isDev: true, envBase: '/gm/' })).toBe('/gm');
    expect(resolveGenModelV1BaseUrl({ isDev: false, envBase: 'https://gm.example.com' })).toBe('https://gm.example.com');
  });

  it('生产环境误注入 loopback 时从非本机页面退回同源；URL 显式覆盖仍优先', () => {
    expect(resolveGenModelV1BaseUrl({
      isDev: false,
      envBase: 'http://localhost:8022',
      browserOrigin: 'https://plant.example.com',
    })).toBe('');
    expect(resolveGenModelV1BaseUrl({
      isDev: false,
      envBase: 'http://localhost:8022',
      search: '?gm_backend_port=18082',
      browserOrigin: 'https://plant.example.com',
    })).toBe('http://localhost:18082');
  });

  it('URL 参数 gm_backend / gm_backend_port 压过环境变量，且不读旧后端的 backendPort', () => {
    expect(resolveGenModelV1BaseUrl({
      isDev: true,
      envBase: 'http://localhost:8022',
      search: '?backendPort=3100&gm_backend_port=18082',
    })).toBe('http://localhost:18082');
    expect(resolveGenModelV1BaseUrl({ isDev: true, search: '?gm_backend=18082' })).toBe('http://localhost:18082');
    expect(resolveGenModelV1BaseUrl({ isDev: true, search: '?gm_backend=http://192.168.1.9:8022/' })).toBe('http://192.168.1.9:8022');
    expect(resolveGenModelV1BaseUrl({ isDev: true, search: '?gm_backend=/gm' })).toBe('/gm');
    expect(resolveGenModelV1BaseUrl({ isDev: true, search: '?backendPort=3100' })).toBe('http://localhost:8022');
  });

  it('从局域网地址打开页面时，环境变量给的 loopback 地址折到 /gm（否则请求打到访问者电脑）', () => {
    expect(resolveGenModelV1BaseUrl({
      isDev: true,
      envBase: 'http://localhost:8022',
      browserOrigin: 'http://192.168.31.60:3101',
    })).toBe('/gm');
    // 人在 URL 里明确要的 loopback 不折：那是他此刻的意思
    expect(resolveGenModelV1BaseUrl({
      isDev: true,
      search: '?gm_backend_port=8022',
      browserOrigin: 'http://192.168.31.60:3101',
    })).toBe('http://localhost:8022');
  });

  it('非法值（非 http 协议 / 乱字符）忽略，落回默认', () => {
    expect(resolveGenModelV1BaseUrl({ isDev: true, envBase: 'ftp://x' })).toBe('http://localhost:8022');
    expect(resolveGenModelV1BaseUrl({ isDev: true, search: '?gm_backend=not a url' })).toBe('http://localhost:8022');
  });
});

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

  it('从局域网站点访问时不把 localhost 后端请求发到用户电脑', () => {
    expect(resolveBackendApiBaseUrl({
      envBase: 'http://localhost:3100',
      isDev: true,
      browserOrigin: 'http://192.168.31.60:3101',
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
