import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  probeSpatialQueryRadius,
  resolveSpatialQueryRealBranConfig,
} from '../../e2e/helpers/spatialQueryRealBran';

type MockResponseInit = {
  status: number;
  body?: string;
};

function createMockResponse(init: MockResponseInit) {
  return {
    ok: () => init.status >= 200 && init.status < 300,
    status: () => init.status,
    text: async () => init.body ?? '',
  };
}

afterEach(() => {
  delete process.env.SPATIAL_QUERY_E2E_REFNO;
  delete process.env.SPATIAL_QUERY_E2E_RADII;
  delete process.env.SPATIAL_QUERY_E2E_NOUNS;
  delete process.env.SPATIAL_QUERY_E2E_SKIP_BACKEND_PREP;
});

describe('spatialQueryRealBran helper', () => {
  beforeEach(() => {
    process.env.SPATIAL_QUERY_E2E_SKIP_BACKEND_PREP = '1';
  });

  it('应解析默认环境并生成斜杠 refno', () => {
    const config = resolveSpatialQueryRealBranConfig();

    expect(config.refno).toBe('24381_145018');
    expect(config.refnoSlash).toBe('24381/145018');
    expect(config.radii).toEqual([5000, 10000, 20000]);
    expect(config.nouns).toEqual(['PIPE', 'BRAN']);
    expect(config.url).toBe('/?output_project=AvevaMarineSample');
  });

  it('应选择首个满足条件的半径', async () => {
    process.env.SPATIAL_QUERY_E2E_REFNO = '24381/145018';
    process.env.SPATIAL_QUERY_E2E_RADII = '5000,10000';
    process.env.SPATIAL_QUERY_E2E_NOUNS = 'pipe,bran';

    const config = resolveSpatialQueryRealBranConfig();
    const request = {
      get: async (path: string) => {
        if (path.includes('distance=5000')) {
          return createMockResponse({
            status: 200,
            body: JSON.stringify({
              success: true,
              truncated: false,
              results: [
                { refno: '24381_145018', noun: 'BRAN' },
              ],
            }),
          });
        }
        return createMockResponse({
          status: 200,
          body: JSON.stringify({
            success: true,
            truncated: false,
            results: [
              { refno: '24381_145018', noun: 'BRAN' },
              { refno: '24381_145019', noun: 'PIPE' },
            ],
          }),
        });
      },
    };

    const result = await probeSpatialQueryRadius(request as any, config);

    expect(config.refno).toBe('24381_145018');
    expect(config.nouns).toEqual(['PIPE', 'BRAN']);
    expect(result.selectedRadius).toBe(10000);
    expect(result.attempts).toHaveLength(2);
    expect(result.selectedAttempt.nonSelfResults).toBe(1);
  });

  it('预检失败时应带出每个半径的诊断信息', async () => {
    const config = resolveSpatialQueryRealBranConfig();
    const request = {
      get: async () => createMockResponse({
        status: 500,
        body: '',
      }),
    };

    await expect(probeSpatialQueryRadius(request as any, config)).rejects.toThrow(
      /radius=5000 status=500 ok=false total=0 non_self=0 truncated=false error=HTTP 500 body=<empty>/,
    );
  });

  it('若树节点存在但空间结果为空，应提示可能缺 inst_relate 或索引数据', async () => {
    process.env.SPATIAL_QUERY_E2E_REFNO = '24381_199999';
    const config = resolveSpatialQueryRealBranConfig();
    let callIndex = 0;
    const request = {
      get: async (path: string) => {
        callIndex += 1;
        if (path.includes('/api/e3d/node/')) {
          return createMockResponse({
            status: 200,
            body: JSON.stringify({
              success: true,
              node: { refno: '24381_199999', noun: 'BRAN' },
            }),
          });
        }
        if (path.includes('/api/e3d/subtree-refnos/')) {
          return createMockResponse({
            status: 200,
            body: JSON.stringify({
              success: true,
              refnos: ['24381_145018', '24381_145019'],
              truncated: false,
            }),
          });
        }
        return createMockResponse({
          status: 200,
          body: JSON.stringify({
            success: true,
            truncated: false,
            results: [],
          }),
        });
      },
    };

    await expect(probeSpatialQueryRadius(request as any, config)).rejects.toThrow(
      /E3D 树节点存在且子树共有 2 个 refno，但空间查询结果为空；本地可能缺 inst_relate 或 instances\/spatial_index 产物/,
    );
    expect(callIndex).toBeGreaterThan(0);
  });

  it('若服务端 refno 预检为空但 MBD 分支数据存在，应回退为 UI 中心查询半径', async () => {
    const config = resolveSpatialQueryRealBranConfig();
    const request = {
      get: async (path: string) => {
        if (path.includes('/api/e3d/node/')) {
          return createMockResponse({
            status: 200,
            body: JSON.stringify({
              success: true,
              node: { refno: '24381_145018', noun: 'BRAN' },
            }),
          });
        }
        if (path.includes('/api/e3d/subtree-refnos/')) {
          return createMockResponse({
            status: 200,
            body: JSON.stringify({
              success: true,
              refnos: ['24381_145018', '24381_145019'],
              truncated: false,
            }),
          });
        }
        if (path.includes('/api/mbd/pipe/')) {
          return createMockResponse({
            status: 200,
            body: JSON.stringify({
              success: true,
              data: {
                segments: [{ id: 'seg:24381_145018:0' }],
                fittings: [{ id: 'fitting:24381_145019' }],
              },
            }),
          });
        }
        return createMockResponse({
          status: 200,
          body: JSON.stringify({
            success: true,
            truncated: false,
            results: [],
          }),
        });
      },
    };

    const result = await probeSpatialQueryRadius(request as any, config);
    expect(result.selectedRadius).toBe(20000);
    expect(result.selectedAttempt.totalResults).toBe(0);
    expect(result.attempts).toHaveLength(3);
  });

  it('已知真实 branch fixture 在空间结果为空时不应依赖在线 MBD 接口', async () => {
    process.env.SPATIAL_QUERY_E2E_REFNO = '24381_145712';
    const config = resolveSpatialQueryRealBranConfig();
    let mbdCalls = 0;
    const request = {
      get: async (path: string) => {
        if (path.includes('/api/e3d/node/')) {
          return createMockResponse({
            status: 200,
            body: JSON.stringify({
              success: true,
              node: { refno: '24381_145712', noun: 'BRAN' },
            }),
          });
        }
        if (path.includes('/api/e3d/subtree-refnos/')) {
          return createMockResponse({
            status: 200,
            body: JSON.stringify({
              success: true,
              refnos: ['24381_145712', '24381_145714'],
              truncated: false,
            }),
          });
        }
        if (path.includes('/api/mbd/pipe/')) {
          mbdCalls += 1;
          return createMockResponse({ status: 500, body: '' });
        }
        return createMockResponse({
          status: 200,
          body: JSON.stringify({
            success: true,
            truncated: false,
            results: [],
          }),
        });
      },
    };

    const result = await probeSpatialQueryRadius(request as any, config);
    expect(result.selectedRadius).toBe(20000);
    expect(mbdCalls).toBe(0);
  });
});
