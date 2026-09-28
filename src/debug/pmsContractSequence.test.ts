import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  formatSequenceSummary,
  runSequence,
  type PmsContractSequenceOptions,
} from '../../scripts/pms-contract-sequence';

type JsonBody = Record<string, unknown>;

function createJsonResponse(status: number, body: JsonBody): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

function createSequenceFetchMock(responses: { status: number; body: JsonBody }[]) {
  const queue = [...responses];
  return vi.fn(async () => {
    const next = queue.shift();
    if (!next) {
      throw new Error('fetch mock 队列已耗尽');
    }
    return createJsonResponse(next.status, next.body);
  });
}

const DEFAULT_OPTIONS: PmsContractSequenceOptions = {
  base: 'http://127.0.0.1:3100',
  projectId: 'AvevaMarineSample',
  user: 'SJ',
  workflowMode: 'external',
  verbose: false,
};

describe('runSequence', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('workflow/verify 返回 passed=false 时应记为失败', async () => {
    const fetchMock = createSequenceFetchMock([
      {
        status: 200,
        body: { code: 200, data: { token: 'BEARER-TOKEN' } },
      },
      {
        status: 200,
        body: {
          code: 200,
          data: {
            token: 'WORKFLOW-TOKEN',
            form_id: 'FORM-VERIFY-BLOCKED',
          },
        },
      },
      {
        status: 200,
        body: {
          success: true,
          task: {
            id: 'task-seed-1',
            formId: 'FORM-VERIFY-BLOCKED',
          },
        },
      },
      {
        status: 200,
        body: {
          code: 200,
          data: {
            passed: false,
            reason: '当前仍有待确认批注',
            recommended_action: 'block',
          },
        },
      },
      {
        status: 200,
        body: { code: 200, data: { form_id: 'FORM-VERIFY-BLOCKED' } },
      },
      {
        status: 200,
        body: { code: 200, data: { queued: true } },
      },
      {
        status: 200,
        body: { code: 200, success: true },
      },
    ]);
    vi.stubGlobal('fetch', fetchMock);

    const results = await runSequence(DEFAULT_OPTIONS);
    const verifyStep = results.find((item) => item.step === 'workflow/verify');

    expect(verifyStep?.ok).toBe(false);
    expect(verifyStep?.passed).toBe(false);
    expect(formatSequenceSummary(DEFAULT_OPTIONS, results)).toContain('[workflow/verify] FAIL HTTP 200');
  });

  it('query、cache、delete 的 401/404 不得记为通过', async () => {
    const fetchMock = createSequenceFetchMock([
      {
        status: 200,
        body: { code: 200, data: { token: 'BEARER-TOKEN' } },
      },
      {
        status: 200,
        body: {
          code: 200,
          data: {
            token: 'WORKFLOW-TOKEN',
            form_id: 'FORM-STRICT-STATUS',
          },
        },
      },
      {
        status: 200,
        body: {
          success: true,
          task: {
            id: 'task-seed-2',
            formId: 'FORM-STRICT-STATUS',
          },
        },
      },
      {
        status: 200,
        body: {
          code: 200,
          data: {
            passed: true,
            reason: '验证通过，可继续流转',
            recommended_action: 'proceed',
          },
        },
      },
      {
        status: 401,
        body: { code: 401, message: 'unauthorized' },
      },
      {
        status: 404,
        body: { code: 404, message: 'not found' },
      },
      {
        status: 404,
        body: { code: 404, message: 'delete miss' },
      },
    ]);
    vi.stubGlobal('fetch', fetchMock);

    const results = await runSequence(DEFAULT_OPTIONS);

    expect(results.find((item) => item.step === 'workflow/sync(query)')?.ok).toBe(false);
    expect(results.find((item) => item.step === 'cache/preload')?.ok).toBe(false);
    expect(results.find((item) => item.step === 'delete')?.ok).toBe(false);
  });
});
