import { describe, expect, it } from 'vitest';

import { getLocalDuckDBBundles } from './duckdbBundles';

describe('duckdbBundles', () => {
  it('resolves DuckDB worker and wasm assets to absolute browser URLs', () => {
    window.history.replaceState(
      null,
      '',
      '/output_project=AvevaPlantSampleLoad20260606120455&show_dbnum=250160'
    );

    const bundles = getLocalDuckDBBundles();

    expect(bundles.eh?.mainWorker).toBe(
      'http://localhost:3000/duckdb/duckdb-browser-eh.worker.js'
    );
    expect(bundles.eh?.mainModule).toBe('http://localhost:3000/duckdb/duckdb-eh.wasm');
    expect(bundles.coi?.pthreadWorker).toBe(
      'http://localhost:3000/duckdb/duckdb-browser-coi.pthread.worker.js'
    );
  });
});
