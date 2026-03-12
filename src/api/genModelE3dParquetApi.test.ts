import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { queryMock, registerFileURLMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  registerFileURLMock: vi.fn(),
}));

vi.mock('@duckdb/duckdb-wasm', () => {
  class ConsoleLogger {}

  class AsyncDuckDB {
    async instantiate() {
      return undefined;
    }

    async connect() {
      return {
        query: queryMock,
      };
    }

    async registerFileURL(...args: unknown[]) {
      return await registerFileURLMock(...args);
    }
  }

  return {
    DuckDBDataProtocol: {
      HTTP: 'http',
    },
    getJsDelivrBundles: () => ({
      mock: {
        mainWorker: 'worker.js',
        mainModule: 'duckdb.wasm',
        pthreadWorker: 'pthread.js',
      },
    }),
    selectBundle: async (bundles: Record<string, unknown>) => bundles.mock,
    ConsoleLogger,
    AsyncDuckDB,
  };
});

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

describe('genModelE3dParquetApi project switching', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    queryMock.mockResolvedValue({
      toArray: () => [
        {
          refno: '200/1',
          name: 'Pipe Node',
          noun: 'PIPE',
          owner: null,
          children_count: 0,
        },
      ],
    });
    registerFileURLMock.mockResolvedValue(undefined);

    vi.stubGlobal(
      'Worker',
      class {
        terminate() {
          return undefined;
        }
      } as unknown as typeof Worker
    );
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/files/output/project-a/scene_tree/db_meta_info.json')) {
        return Promise.resolve(
          jsonResponse({
            db_files: {
              '1': { dbnum: 1 },
            },
            ref0_to_dbnum: {
              '100': 1,
            },
          })
        );
      }
      if (url.endsWith('/files/output/project-b/scene_tree/db_meta_info.json')) {
        return Promise.resolve(
          jsonResponse({
            db_files: {
              '1': { dbnum: 1 },
            },
            ref0_to_dbnum: {
              '200': 1,
            },
          })
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    }));

    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:duckdb-worker');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('reloads db meta and tree file bindings when the active project changes', async () => {
    const filesOutput = await import('@/lib/filesOutput');
    const api = await import('./genModelE3dParquetApi');

    filesOutput.setCurrentProjectPath('project-a');
    const first = await api.e3dParquetGetNode('100/1');

    filesOutput.setCurrentProjectPath('project-b');
    const second = await api.e3dParquetGetNode('200/1');

    expect(first.success).toBe(true);
    expect(second.success).toBe(true);

    const fetchMock = vi.mocked(fetch);
    expect(fetchMock).toHaveBeenCalledWith('/files/output/project-a/scene_tree/db_meta_info.json');
    expect(fetchMock).toHaveBeenCalledWith('/files/output/project-b/scene_tree/db_meta_info.json');

    const treeRegistrations = registerFileURLMock.mock.calls.filter(
      ([localName]) => localName === 'e3d_pdms_tree_1.parquet'
    );
    expect(treeRegistrations).toHaveLength(2);
    expect(String(treeRegistrations[0]?.[1])).toContain('/files/output/project-a/scene_tree_parquet/pdms_tree_1.parquet');
    expect(String(treeRegistrations[1]?.[1])).toContain('/files/output/project-b/scene_tree_parquet/pdms_tree_1.parquet');
  });
});
