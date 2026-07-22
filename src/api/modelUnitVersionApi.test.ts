import { afterEach, describe, expect, it, vi } from 'vitest';

import { listModelUnitCommits } from './modelUnitVersionApi';

vi.mock('@/api/genModelTaskApi', () => ({ getBaseUrl: () => 'http://model.test/' }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('modelUnitVersionApi', () => {
  it('按参考号列出模型提交并按 sesno 升序返回', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      data: [
        { manifest_url: '/897/manifest.json', commit: { sesno: 897 } },
        { manifest_url: '/791/manifest.json', commit: { sesno: 791 } },
      ],
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const commits = await listModelUnitCommits(7997, '24381/145018');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://model.test/api/model/units/24381_145018/versions?dbnum=7997',
    );
    expect(commits.map((item) => item.commit.sesno)).toEqual([791, 897]);
  });
});
