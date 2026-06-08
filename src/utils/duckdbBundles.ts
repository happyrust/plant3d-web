import { selectBundle, type DuckDBBundle, type DuckDBBundles } from '@duckdb/duckdb-wasm';

const DUCKDB_ASSET_DIR = 'duckdb';

type DuckDBConnectionLike = {
  query(sql: string): Promise<unknown>
}

function baseUrl(): string {
  const base = import.meta.env.BASE_URL || '/';
  return base.endsWith('/') ? base : `${base}/`;
}

function assetUrl(fileName: string): string {
  const path = `${baseUrl()}${DUCKDB_ASSET_DIR}/${fileName}`;
  const href = globalThis.location?.href;
  const version = encodeURIComponent(__DUCKDB_ASSET_VERSION__);
  if (!href) return `${path}?v=${version}`;

  // DuckDB is bootstrapped from a blob worker; root-relative importScripts()
  // URLs are invalid there, so hand the worker fully qualified same-origin URLs.
  try {
    const url = new URL(path, href);
    url.searchParams.set('v', version);
    return url.toString();
  } catch {
    return `${path}?v=${version}`;
  }
}

export function getLocalDuckDBBundles(): DuckDBBundles {
  return {
    mvp: {
      mainModule: assetUrl('duckdb-mvp.wasm'),
      mainWorker: assetUrl('duckdb-browser-mvp.worker.js'),
    },
    eh: {
      mainModule: assetUrl('duckdb-eh.wasm'),
      mainWorker: assetUrl('duckdb-browser-eh.worker.js'),
    },
    coi: {
      mainModule: assetUrl('duckdb-coi.wasm'),
      mainWorker: assetUrl('duckdb-browser-coi.worker.js'),
      pthreadWorker: assetUrl('duckdb-browser-coi.pthread.worker.js'),
    },
  };
}

export async function selectLocalDuckDBBundle(): Promise<DuckDBBundle> {
  return await selectBundle(getLocalDuckDBBundles());
}

export function getLocalDuckDBExtensionRepository(): string {
  const path = `${baseUrl()}${DUCKDB_ASSET_DIR}/extensions`;
  const href = globalThis.location?.href;
  if (!href) return path.replace(/\/+$/, '');

  try {
    const url = new URL(path, href);
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/+$/, '');
  } catch {
    return path.replace(/\/+$/, '');
  }
}

function duckdbStringLiteral(value: string): string {
  return `'${value.replace(/'/g, '\'\'')}'`;
}

export async function configureLocalDuckDBExtensions(conn: DuckDBConnectionLike): Promise<void> {
  await conn.query(
    `SET custom_extension_repository = ${duckdbStringLiteral(getLocalDuckDBExtensionRepository())}`
  );
}
