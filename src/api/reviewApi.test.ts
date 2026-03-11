import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  authVerifyToken,
  getReviewUserWebSocketUrl,
  getReviewWebSocketUrl,
  reviewGetEmbedUrl,
  normalizeReviewTask,
  normalizeReviewAttachment,
  normalizeAnnotationComment,
} from './reviewApi';

describe('reviewApi base url defaults', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
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

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3100/api/review/embed-url',
      expect.objectContaining({ method: 'POST' })
    );
    expect(result.url).toContain('form_id=FORM-1');
    expect(result.url).toContain('project_id=project-1');
    expect(result.url).toContain('output_project=project-1');
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

    expect(result.url).toContain('form_id=FORM-LINEAGE');
    expect(result.url).toContain('output_project=project-2');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('includes output_project parameter matching project_id in embed URL', async () => {
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

    expect(result.url).toContain('project_id=AvevaMarineSample');
    expect(result.url).toContain('output_project=AvevaMarineSample');
    
    const url = new URL(result.url);
    expect(url.searchParams.get('project_id')).toBe('AvevaMarineSample');
    expect(url.searchParams.get('output_project')).toBe('AvevaMarineSample');
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

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3100/api/auth/verify',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('passes form_id when verifying embed token lineage', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        code: 0,
        message: 'ok',
        data: { valid: true },
      }), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);

    await authVerifyToken('token-verify', 'FORM-EMBED-1');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3100/api/auth/verify',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ token: 'token-verify', form_id: 'FORM-EMBED-1' }),
      })
    );
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
