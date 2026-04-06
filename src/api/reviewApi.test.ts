import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  authVerifyToken,
  getReviewUserWebSocketUrl,
  getReviewWebSocketUrl,
  reviewGetEmbedUrl,
  reviewRecordCreate,
  reviewWorkflowSyncQuery,
  normalizeReviewTask,
  normalizeReviewAttachment,
  normalizeAnnotationComment,
} from './reviewApi';

describe('reviewApi base url defaults', () => {
  function expectBackendFetch(fetchMock: ReturnType<typeof vi.fn>, path: string, body?: string) {
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(new RegExp(`(?:http://localhost:3100)?${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)),
      expect.objectContaining({
        method: 'POST',
        ...(body ? { body } : {}),
      })
    );
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv('MODE', 'test');
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
    });
  });

  it('disables review websocket urls when no explicit websocket base is configured', () => {
    expect(getReviewWebSocketUrl()).toBeNull();
    expect(getReviewUserWebSocketUrl('reviewer_001')).toBeNull();
  });

  it('builds review websocket urls from an explicit websocket base', () => {
    vi.stubEnv('VITE_REVIEW_WS_BASE_URL', 'http://review-web.local');

    expect(getReviewWebSocketUrl()).toBe('ws://review-web.local/ws/review');
    expect(getReviewUserWebSocketUrl('reviewer_001')).toBe(
      'ws://review-web.local/ws/review/user/reviewer_001'
    );
  });

  it('uses 3100 default backend when building embed url', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        code: 200,
        message: 'ok',
        data: {
          token: 'token-1',
          relative_path: '/review/embed',
          query: { form_id: 'FORM-1' },
          lineage: { form_id: 'FORM-1', task_id: null, current_node: null, status: null },
        },
      }), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await reviewGetEmbedUrl('project-1', 'user-1');
    const url = new URL(result.url);

    expectBackendFetch(fetchMock, '/api/review/embed-url');
    expect(url.searchParams.get('user_token')).toBe('token-1');
    expect(url.searchParams.get('form_id')).toBe('FORM-1');
    expect(url.searchParams.get('output_project')).toBeNull();
    expect(url.searchParams.get('workflow_mode')).toBeNull();
    expect(url.searchParams.get('project_id')).toBeNull();
    expect(url.searchParams.get('user_id')).toBeNull();
  });

  it('passes workflow_role as the primary field and role as a compatibility field when requesting embed url', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        code: 200,
        message: 'ok',
        data: {
          token: 'token-role',
          relative_path: '/review/embed',
          query: { form_id: 'FORM-ROLE' },
        },
      }), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);

    await reviewGetEmbedUrl('project-1', 'user-1', 'jd');

    expectBackendFetch(
      fetchMock,
      '/api/review/embed-url',
      JSON.stringify({ project_id: 'project-1', user_id: 'user-1', workflow_role: 'jd', role: 'jd' })
    );
  });

  it('tolerates lineage metadata in embed-url payloads for existing tasks', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        code: 200,
        message: 'ok',
        data: {
          token: 'token-2',
          relative_path: '/review/embed',
          query: { form_id: 'FORM-LINEAGE' },
          lineage: {
            form_id: 'FORM-LINEAGE',
            task_id: 'task-form-lineage',
            current_node: 'jd',
            status: 'in_review',
          },
          task: {
            id: 'task-form-lineage',
            form_id: 'FORM-LINEAGE',
            current_node: 'jd',
            status: 'in_review',
          },
        },
      }), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await reviewGetEmbedUrl('project-2', 'user-2');

    const url = new URL(result.url);
    expect(url.searchParams.get('user_token')).toBe('token-2');
    expect(url.searchParams.get('form_id')).toBe('FORM-LINEAGE');
    expect(url.searchParams.get('output_project')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not leak project identity into embed URL query', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        code: 200,
        message: 'ok',
        data: {
          token: 'token-ams',
          relative_path: '/review/embed',
          query: { form_id: 'FORM-AMS' },
        },
      }), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await reviewGetEmbedUrl('AvevaMarineSample', 'user-ams');

    const url = new URL(result.url);
    expect(url.searchParams.get('project_id')).toBeNull();
    expect(url.searchParams.get('output_project')).toBeNull();
    expect(url.searchParams.get('user_id')).toBeNull();
    expect(url.searchParams.get('user_role')).toBeNull();
    expect(url.searchParams.get('form_id')).toBe('FORM-AMS');
    expect(url.searchParams.get('user_token')).toBe('token-ams');
  });

  it('sanitizes direct backend embed url to token-primary query params', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        code: 200,
        message: 'ok',
        url: 'http://review-web.local/review/3d-view?form_id=FORM-DIRECT&user_token=token-direct&user_id=SJ&user_role=sj&workflow_role=jd&role=sh&project_id=legacy-project&workflow_mode=external',
      }), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await reviewGetEmbedUrl('AvevaMarineSample', 'SJ', 'sj');

    const url = new URL(result.url);
    expect(url.origin).toBe('http://review-web.local');
    expect(url.pathname).toBe('/review/3d-view');
    expect(url.searchParams.get('form_id')).toBe('FORM-DIRECT');
    expect(url.searchParams.get('user_token')).toBe('token-direct');
    expect(url.searchParams.get('workflow_mode')).toBeNull();
    expect(url.searchParams.get('output_project')).toBeNull();
    expect(url.searchParams.get('user_id')).toBeNull();
    expect(url.searchParams.get('user_role')).toBeNull();
    expect(url.searchParams.get('workflow_role')).toBeNull();
    expect(url.searchParams.get('role')).toBeNull();
    expect(url.searchParams.get('project_id')).toBeNull();
  });

  it('uses 3100 default backend when verifying token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        code: 0,
        message: 'ok',
        data: { valid: true },
      }), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);

    await authVerifyToken('token-verify');

    expectBackendFetch(fetchMock, '/api/auth/verify');
  });

  it('verifies embed token without sending form_id lineage hints', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        code: 0,
        message: 'ok',
        data: { valid: true },
      }), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);

    await authVerifyToken('token-verify');

    expectBackendFetch(
      fetchMock,
      '/api/auth/verify',
      JSON.stringify({ token: 'token-verify' })
    );
  });

  it('normalizes snake_case verify claims for embed trusted identity', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        code: 0,
        message: 'ok',
        data: {
          valid: true,
          claims: {
            project_id: 'AvevaMarineSample',
            user_id: 'JH',
            role: 'sj',
            workflow_mode: 'external',
            exp: 1774949170,
            iat: 1774862770,
          },
        },
      }), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await authVerifyToken('token-verify');

    expect(result.data?.claims).toEqual({
      projectId: 'AvevaMarineSample',
      userId: 'JH',
      role: 'sj',
      workflowMode: 'external',
      exp: 1774949170,
      iat: 1774862770,
    });
  });

  it('includes stable form lineage when creating confirmed records', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        success: true,
        record: {
          id: 'record-1',
          taskId: 'task-1',
          formId: 'FORM-LINEAGE-1',
          type: 'batch',
          annotations: [],
          cloudAnnotations: [],
          rectAnnotations: [],
          measurements: [],
          note: 'ok',
          confirmedAt: 1700000000000,
        },
      }), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);

    await reviewRecordCreate({
      taskId: 'task-1',
      formId: 'FORM-LINEAGE-1',
      type: 'batch',
      annotations: [],
      cloudAnnotations: [],
      rectAnnotations: [],
      measurements: [],
      note: 'ok',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/review\/records$/),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          taskId: 'task-1',
          formId: 'FORM-LINEAGE-1',
          type: 'batch',
          annotations: [],
          cloudAnnotations: [],
          rectAnnotations: [],
          measurements: [],
          note: 'ok',
        }),
      })
    );
  });

  it('uses attachment description as visible name when workflow/sync only returns description fields', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        code: 200,
        message: 'success',
        data: {
          records: [],
          annotation_comments: [],
          attachments: [
            {
              id: 'att-desc-1',
              description: 'AUTO-ATTACHMENT-LABEL',
              route_url: '/files/review_attachments/att-desc-1.png',
              public_url: 'http://127.0.0.1:3100/files/review_attachments/att-desc-1.png',
              file_ext: '.png',
            },
          ],
          current_node: 'pz',
          task_status: 'approved',
          form_status: 'approved',
        },
      }), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await reviewWorkflowSyncQuery({
      formId: 'FORM-ATTACH-1',
      token: 'token-attachment',
      actor: {
        id: 'PZ',
        name: 'PZ',
        roles: 'pz',
      },
    });

    expect(result.data?.attachments).toEqual([
      expect.objectContaining({
        id: 'att-desc-1',
        name: 'AUTO-ATTACHMENT-LABEL',
        url: expect.stringContaining('/files/review_attachments/att-desc-1.png'),
      }),
    ]);
  });
});

describe('normalizeReviewTask', () => {
  it('normalizes a task with camelCase fields', () => {
    const raw = {
      id: 'task-1',
      title: 'Test',
      description: 'Desc',
      modelName: 'Model A',
      status: 'draft',
      priority: 'high',
      requesterId: 'u1',
      requesterName: 'User1',
      checkerId: 'c1',
      checkerName: 'Checker1',
      approverId: 'a1',
      approverName: 'Approver1',
      components: [],
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
      currentNode: 'sj',
    };

    const task = normalizeReviewTask(raw);
    expect(task.id).toBe('task-1');
    expect(task.title).toBe('Test');
    expect(task.status).toBe('draft');
    expect(task.priority).toBe('high');
    expect(task.checkerId).toBe('c1');
    expect(task.checkerName).toBe('Checker1');
    expect(task.approverId).toBe('a1');
    expect(task.approverName).toBe('Approver1');
    expect(task.currentNode).toBe('sj');
  });

  it('normalizes a task with snake_case fields (backend format)', () => {
    const raw = {
      id: 'task-2',
      title: 'Backend task',
      model_name: 'Model B',
      status: 'in_review',
      priority: 'medium',
      requester_id: 'u2',
      requester_name: 'User2',
      checker_id: 'c2',
      checker_name: 'Checker2',
      approver_id: 'a2',
      approver_name: 'Approver2',
      components: [],
      created_at: 1700000000000,
      updated_at: 1700000000000,
      current_node: 'sh',
    };

    const task = normalizeReviewTask(raw);
    expect(task.modelName).toBe('Model B');
    expect(task.status).toBe('in_review');
    expect(task.checkerId).toBe('c2');
    expect(task.approverId).toBe('a2');
    expect(task.currentNode).toBe('sh');
    // reviewer 兼容映射到 checker
    expect(task.reviewerId).toBe('c2');
  });

  it('falls back to reviewer_id when checker_id is missing', () => {
    const raw = {
      id: 'task-3',
      title: 'Legacy',
      reviewer_id: 'r1',
      reviewer_name: 'OldReviewer',
      components: [],
      created_at: 1700000000000,
      updated_at: 1700000000000,
    };

    const task = normalizeReviewTask(raw);
    expect(task.checkerId).toBe('r1');
    expect(task.checkerName).toBe('OldReviewer');
    expect(task.reviewerId).toBe('r1');
  });

  it('preserves explicit checker and approver semantics with stable component payload fields', () => {
    const task = normalizeReviewTask({
      id: 'task-payload',
      form_id: 'FORM-PAYLOAD',
      checker_id: 'checker-1',
      checker_name: 'Checker One',
      approver_id: 'approver-1',
      approver_name: 'Approver One',
      reviewer_id: 'legacy-reviewer',
      components: [
        { id: 'comp-1', refNo: '100_1', name: 'Pump-01', type: 'Pump' },
        { id: 'comp-2', refNo: '100_2', name: 'Valve-01' },
      ],
    });

    expect(task.formId).toBe('FORM-PAYLOAD');
    expect(task.checkerId).toBe('checker-1');
    expect(task.checkerName).toBe('Checker One');
    expect(task.approverId).toBe('approver-1');
    expect(task.approverName).toBe('Approver One');
    expect(task.reviewerId).toBe('checker-1');
    expect(task.components).toEqual([
      { id: 'comp-1', refNo: '100_1', name: 'Pump-01', type: 'Pump' },
      { id: 'comp-2', refNo: '100_2', name: 'Valve-01' },
    ]);
  });

  it('preserves shared handoff context from backend lineage payloads', () => {
    const createdAt = '2024-06-15T12:00:00.000Z';
    const updatedAt = '2024-06-15T13:00:00.000Z';
    const task = normalizeReviewTask({
      id: 'task-handoff-1',
      form_id: 'FORM-HANDOFF-1',
      title: 'Designer to reviewer handoff',
      model_name: 'Pipe Rack',
      requester_id: 'designer-1',
      requester_name: 'Designer One',
      checker_id: 'checker-1',
      checker_name: 'Checker One',
      approver_id: 'approver-1',
      approver_name: 'Approver One',
      status: 'submitted',
      current_node: 'jd',
      components: [
        { id: 'comp-1', refNo: '100_1', name: 'Pipe-100', type: 'Pipe' },
      ],
      workflow_history: [
        {
          node: 'sj',
          action: 'submit',
          operatorId: 'designer-1',
          operatorName: 'Designer One',
          timestamp: 1718452800000,
        },
      ],
      attachments: [
        {
          file_id: 'att-1',
          file_name: 'handoff.pdf',
          download_url: '/files/review_attachments/att-1.pdf',
          file_size: 512,
        },
      ],
      created_at: createdAt,
      updated_at: updatedAt,
    });

    expect(task.id).toBe('task-handoff-1');
    expect(task.formId).toBe('FORM-HANDOFF-1');
    expect(task.requesterId).toBe('designer-1');
    expect(task.checkerId).toBe('checker-1');
    expect(task.approverId).toBe('approver-1');
    expect(task.currentNode).toBe('jd');
    expect(task.status).toBe('submitted');
    expect(task.components).toEqual([
      { id: 'comp-1', refNo: '100_1', name: 'Pipe-100', type: 'Pipe' },
    ]);
    expect(task.workflowHistory).toEqual([
      {
        node: 'sj',
        action: 'submit',
        operatorId: 'designer-1',
        operatorName: 'Designer One',
        timestamp: 1718452800000,
      },
    ]);
    expect(task.attachments).toEqual([
      {
        id: 'att-1',
        name: 'handoff.pdf',
        url: '/files/review_attachments/att-1.pdf',
        size: 512,
        type: undefined,
        mimeType: undefined,
        uploadedAt: expect.any(Number),
      },
    ]);
    expect(task.attachments?.[0]?.uploadedAt).toBeGreaterThan(0);
    expect(task.createdAt).toBe(new Date(createdAt).getTime());
    expect(task.updatedAt).toBe(new Date(updatedAt).getTime());
  });

  it('defaults to correct values for missing fields', () => {
    const task = normalizeReviewTask({});
    expect(task.id).toBe('');
    expect(task.status).toBe('draft');
    expect(task.priority).toBe('medium');
    expect(task.currentNode).toBe('sj');
    expect(task.components).toEqual([]);
    expect(task.createdAt).toBeGreaterThan(0);
  });

  it('normalizes invalid status/priority to defaults', () => {
    const task = normalizeReviewTask({
      status: 'invalid_status',
      priority: 'super_urgent',
    });
    expect(task.status).toBe('draft');
    expect(task.priority).toBe('medium');
  });

  it('normalizes valid workflow nodes', () => {
    for (const node of ['sj', 'jd', 'sh', 'pz']) {
      const task = normalizeReviewTask({ current_node: node });
      expect(task.currentNode).toBe(node);
    }
  });

  it('defaults invalid workflow node to sj', () => {
    const task = normalizeReviewTask({ current_node: 'invalid' });
    expect(task.currentNode).toBe('sj');
  });

  it('handles form_id and formId', () => {
    const t1 = normalizeReviewTask({ formId: 'f1' });
    expect(t1.formId).toBe('f1');

    const t2 = normalizeReviewTask({ form_id: 'f2' });
    expect(t2.formId).toBe('f2');
  });

  it('normalizes timestamps from string ISO dates', () => {
    const task = normalizeReviewTask({
      created_at: '2024-06-15T12:00:00.000Z',
      updated_at: '2024-06-15T13:00:00.000Z',
    });
    expect(task.createdAt).toBe(new Date('2024-06-15T12:00:00.000Z').getTime());
    expect(task.updatedAt).toBe(new Date('2024-06-15T13:00:00.000Z').getTime());
  });

  it('normalizes timestamps from seconds to milliseconds', () => {
    const task = normalizeReviewTask({
      created_at: 1700000000,
    });
    expect(task.createdAt).toBe(1700000000000);
  });
});

describe('normalizeReviewAttachment', () => {
  it('normalizes standard attachment', () => {
    const raw = {
      id: 'att-1',
      name: 'file.pdf',
      url: 'https://example.com/file.pdf',
      size: 12345,
      mimeType: 'application/pdf',
      uploaded_at: 1700000000000,
    };

    const att = normalizeReviewAttachment(raw);
    expect(att.id).toBe('att-1');
    expect(att.name).toBe('file.pdf');
    expect(att.url).toBe('https://example.com/file.pdf');
    expect(att.size).toBe(12345);
    expect(att.mimeType).toBe('application/pdf');
  });

  it('handles alternative field names', () => {
    const raw = {
      file_id: 'att-2',
      file_name: 'drawing.dwg',
      download_url: 'https://example.com/drawing.dwg',
      file_size: 54321,
    };

    const att = normalizeReviewAttachment(raw);
    expect(att.id).toBe('att-2');
    expect(att.name).toBe('drawing.dwg');
    expect(att.url).toBe('https://example.com/drawing.dwg');
    expect(att.size).toBe(54321);
  });
});

describe('normalizeAnnotationComment', () => {
  it('normalizes a comment with camelCase', () => {
    const raw = {
      id: 'c1',
      annotationId: 'a1',
      annotationType: 'text',
      authorId: 'u1',
      authorName: 'Author',
      authorRole: 'reviewer',
      content: 'Comment text',
      createdAt: 1700000000000,
    };

    const comment = normalizeAnnotationComment(raw);
    expect(comment.id).toBe('c1');
    expect(comment.annotationId).toBe('a1');
    expect(comment.annotationType).toBe('text');
    expect(comment.content).toBe('Comment text');
  });

  it('normalizes a comment with snake_case', () => {
    const raw = {
      id: 'c2',
      annotation_id: 'a2',
      annotation_type: 'cloud',
      author_id: 'u2',
      author_name: 'Author2',
      author_role: 'proofreader',
      content: 'Cloud note',
      created_at: '2024-06-15T12:00:00.000Z',
    };

    const comment = normalizeAnnotationComment(raw);
    expect(comment.annotationId).toBe('a2');
    expect(comment.annotationType).toBe('cloud');
    expect(comment.createdAt).toBe(new Date('2024-06-15T12:00:00.000Z').getTime());
  });

  it('defaults invalid annotation type to text', () => {
    const comment = normalizeAnnotationComment({
      id: 'c3',
      annotation_type: 'invalid_type',
    });
    expect(comment.annotationType).toBe('text');
  });
});
