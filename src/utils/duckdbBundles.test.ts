import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getLocalDuckDBBundles, getLocalDuckDBExtensionRepository } from './duckdbBundles';

// `__DUCKDB_ASSET_VERSION__` 是 vite.config.ts 里 `define` 出来的构建期常量（DuckDB 资产内容哈希，
// 用作 `?v=` 缓存戳）。vitest 不注入 define 全局，这里用 stubGlobal 顶上。
const ASSET_VERSION = 'test-asset-version';

describe('duckdbBundles', () => {
  beforeEach(() => {
    vi.stubGlobal('__DUCKDB_ASSET_VERSION__', ASSET_VERSION);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('resolves DuckDB worker and wasm assets to absolute, version-stamped same-origin URLs', () => {
    window.history.replaceState(
      null,
      '',
      '/output_project=AvevaPlantSampleLoad20260606120455&show_dbnum=250160'
    );

    const bundles = getLocalDuckDBBundles();

    // DuckDB 从 blob worker 启动，根相对的 importScripts() 在那里无效，所以必须是完整同源 URL；
    // 每个资产都带内容哈希 `?v=`，换包后浏览器不会拿到旧 wasm/worker。
    expect(bundles.eh?.mainWorker).toBe(
      `http://localhost:3000/duckdb/duckdb-browser-eh.worker.js?v=${ASSET_VERSION}`
    );
    expect(bundles.eh?.mainModule).toBe(`http://localhost:3000/duckdb/duckdb-eh.wasm?v=${ASSET_VERSION}`);
    expect(bundles.coi?.pthreadWorker).toBe(
      `http://localhost:3000/duckdb/duckdb-browser-coi.pthread.worker.js?v=${ASSET_VERSION}`
    );
    expect(bundles.mvp?.mainModule).toBe(`http://localhost:3000/duckdb/duckdb-mvp.wasm?v=${ASSET_VERSION}`);
  });

  it('extension repository is an absolute same-origin URL without query/hash or trailing slash', () => {
    window.history.replaceState(null, '', '/?output_project=Sample&show_dbnum=1#x');

    expect(getLocalDuckDBExtensionRepository()).toBe('http://localhost:3000/duckdb/extensions');
  });
});
