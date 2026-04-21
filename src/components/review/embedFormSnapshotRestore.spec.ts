import { describe, expect, it, vi } from 'vitest';

import {
  mergeSnapshotAttachmentsIntoTask,
  restoreEmbedFormSnapshot,
  restoreEmbedFormSnapshotContext,
} from './embedFormSnapshotRestore';

import { UserRole, type ReviewTask } from '@/types/auth';

describe('restoreEmbedFormSnapshot', () => {
  it('按 workflow/sync 快照恢复模型 refno 与批注评论', async () => {
    const importTools = vi.fn();
    const syncTools = vi.fn();
    const request = vi.fn().mockResolvedValue({
      code: 200,
      message: 'success',
      data: {
        models: ['24381_147608'],
        records: [
          {
            id: 'record-1',
            taskId: 'task-1',
            type: 'batch',
            annotations: [
              {
                id: 'anno-text-1',
                entityId: 'entity-1',
                worldPos: [1, 2, 3],
                visible: true,
                glyph: '1',
                title: '文字批注',
                description: '',
                createdAt: 1,
              },
            ],
            cloudAnnotations: [],
            rectAnnotations: [],
            obbAnnotations: [],
            measurements: [
              {
                id: 'measure-1',
                kind: 'distance',
                origin: { entityId: 'a', worldPos: [0, 0, 0] },
                target: { entityId: 'b', worldPos: [1, 0, 0] },
                visible: true,
                createdAt: 2,
              },
            ],
            note: '历史批注',
            confirmedAt: '2026-03-30 20:00:00',
          },
        ],
        annotationComments: [
          {
            id: 'comment-1',
            annotationId: 'anno-text-1',
            annotationType: 'text',
            authorId: 'JH',
            authorName: 'JH',
            authorRole: 'jd',
            content: '请复核',
            createdAt: '2026-03-30 20:01:00',
          },
        ],
        attachments: [
          {
            id: 'att-1',
            public_url: '/files/review_attachments/att-1.png',
            description: '流程截图',
            file_ext: '.png',
          },
        ],
      },
    });

    const result = await restoreEmbedFormSnapshot({
      formId: 'FORM-1',
      token: 'token-1',
      actor: {
        id: 'JH',
        name: 'JH',
        roles: 'jd',
      },
      request,
      importTools,
      syncTools,
    });

    expect(request).toHaveBeenCalledWith({
      formId: 'FORM-1',
      token: 'token-1',
      actor: {
        id: 'JH',
        name: 'JH',
        roles: 'jd',
      },
    });
    expect(result.modelRefnos).toEqual(['24381_147608']);
    expect(result.recordCount).toBe(1);
    expect(result.attachmentCount).toBe(1);
    expect(result.attachments).toEqual([
      expect.objectContaining({
        id: 'att-1',
        url: '/files/review_attachments/att-1.png',
        name: '流程截图',
      }),
    ]);
    expect(importTools).toHaveBeenCalledTimes(1);
    expect(syncTools).toHaveBeenCalledTimes(1);

    const payload = JSON.parse(importTools.mock.calls[0][0] as string) as {
      annotations: { comments?: { authorRole: UserRole; content: string }[] }[];
      measurements: unknown[];
      xeokitDistanceMeasurements: { approximate?: boolean }[];
    };
    expect(payload.measurements).toEqual([]);
    expect(payload.xeokitDistanceMeasurements).toEqual([
      expect.objectContaining({ approximate: false }),
    ]);
    expect(payload.annotations[0]?.comments?.[0]).toEqual(expect.objectContaining({
      authorRole: UserRole.PROOFREADER,
      content: '请复核',
    }));
  });

  it('当新单据没有历史记录时，也会下发空快照以清空旧批注', async () => {
    const importTools = vi.fn();
    const syncTools = vi.fn();
    const request = vi.fn().mockResolvedValue({
      code: 200,
      message: 'success',
      data: {
        models: [],
        records: [],
        annotationComments: [],
        attachments: [],
      },
    });

    const result = await restoreEmbedFormSnapshot({
      formId: 'FORM-EMPTY',
      token: 'token-empty',
      actor: {
        id: 'SJ',
        name: 'SJ',
        roles: 'sj',
      },
      request,
      importTools,
      syncTools,
    });

    expect(result.recordCount).toBe(0);
    expect(importTools).toHaveBeenCalledTimes(1);
    expect(syncTools).toHaveBeenCalledTimes(1);
    expect(JSON.parse(importTools.mock.calls[0][0] as string)).toEqual({
      version: 5,
      measurements: [],
      annotations: [],
      obbAnnotations: [],
      cloudAnnotations: [],
      rectAnnotations: [],
      dimensions: [],
      xeokitDistanceMeasurements: [],
      xeokitAngleMeasurements: [],
    });
  });

  it('连续从旧单据切到空白新单据时，后一次快照会覆盖并清空前一次批注', async () => {
    const importTools = vi.fn();
    const syncTools = vi.fn();
    const request = vi.fn()
      .mockResolvedValueOnce({
        code: 200,
        message: 'success',
        data: {
          models: ['24381_147608'],
          records: [
            {
              id: 'record-old',
              taskId: 'task-old',
              type: 'batch',
              annotations: [
                {
                  id: 'anno-old-1',
                  entityId: 'entity-old-1',
                  worldPos: [1, 2, 3],
                  visible: true,
                  glyph: '1',
                  title: '旧单批注',
                  description: '',
                  createdAt: 1,
                },
              ],
              cloudAnnotations: [],
              rectAnnotations: [],
              obbAnnotations: [],
              measurements: [],
              note: '旧单记录',
              confirmedAt: '2026-03-30 20:00:00',
            },
          ],
          annotationComments: [],
          attachments: [],
        },
      })
      .mockResolvedValueOnce({
        code: 200,
        message: 'success',
        data: {
          models: [],
          records: [],
          annotationComments: [],
          attachments: [],
        },
      });

    await restoreEmbedFormSnapshot({
      formId: 'FORM-OLD',
      token: 'token-old',
      actor: {
        id: 'SJ',
        name: 'SJ',
        roles: 'sj',
      },
      request,
      importTools,
      syncTools,
    });

    await restoreEmbedFormSnapshot({
      formId: 'FORM-NEW',
      token: 'token-new',
      actor: {
        id: 'SJ',
        name: 'SJ',
        roles: 'sj',
      },
      request,
      importTools,
      syncTools,
    });

    expect(importTools).toHaveBeenCalledTimes(2);
    expect(JSON.parse(importTools.mock.calls[0][0] as string)).toEqual(expect.objectContaining({
      annotations: [
        expect.objectContaining({
          id: 'anno-old-1',
          title: '旧单批注',
        }),
      ],
    }));
    expect(JSON.parse(importTools.mock.calls[1][0] as string)).toEqual({
      version: 5,
      measurements: [],
      annotations: [],
      obbAnnotations: [],
      cloudAnnotations: [],
      rectAnnotations: [],
      dimensions: [],
      xeokitDistanceMeasurements: [],
      xeokitAngleMeasurements: [],
    });
  });

  it('workflow-sync 空记录仍通过统一 snapshot 层下发空 payload 清空场景', async () => {
    const importTools = vi.fn();
    const request = vi.fn().mockResolvedValue({
      code: 200,
      message: 'success',
      data: {
        models: [],
        records: [],
        annotationComments: [],
        attachments: [],
      },
    });

    await restoreEmbedFormSnapshot({
      formId: 'FORM-CLEAR',
      token: 'token-clear',
      actor: {
        id: 'SJ',
        name: 'SJ',
        roles: 'sj',
      },
      request,
      importTools,
    });

    expect(importTools).toHaveBeenCalledWith(JSON.stringify({
      version: 5,
      measurements: [],
      annotations: [],
      obbAnnotations: [],
      cloudAnnotations: [],
      rectAnnotations: [],
      dimensions: [],
      xeokitDistanceMeasurements: [],
      xeokitAngleMeasurements: [],
    }));
  });

  it('merges snapshot attachments into restored task for readonly reopen surfaces', () => {
    const task: ReviewTask = {
      id: 'task-1',
      formId: 'FORM-1',
      title: '流程单',
      description: 'desc',
      modelName: '模型',
      status: 'approved',
      priority: 'medium',
      requesterId: 'SJ',
      requesterName: 'SJ',
      checkerId: 'JH',
      checkerName: 'JH',
      approverId: 'PZ',
      approverName: 'PZ',
      reviewerId: 'JH',
      reviewerName: 'JH',
      components: [],
      attachments: [],
      createdAt: 1,
      updatedAt: 1,
      currentNode: 'pz',
    };

    const merged = mergeSnapshotAttachmentsIntoTask(task, [
      {
        id: 'att-2',
        name: 'approved-shot.png',
        url: '/files/review_attachments/att-2.png',
        uploadedAt: 2,
      },
    ]);

    expect(merged).not.toBe(task);
    expect(merged.attachments).toEqual([
      expect.objectContaining({
        id: 'att-2',
        name: 'approved-shot.png',
        url: '/files/review_attachments/att-2.png',
      }),
    ]);
  });

  it('通过共享 helper 合并附件并回写当前任务', async () => {
    const request = vi.fn().mockResolvedValue({
      code: 200,
      message: 'success',
      data: {
        models: ['24381_147608'],
        records: [],
        annotationComments: [],
        attachments: [
          {
            id: 'att-context-1',
            public_url: '/files/review_attachments/att-context-1.png',
            description: '上下文附件',
            file_ext: '.png',
          },
        ],
      },
    });
    const task: ReviewTask = {
      id: 'task-context-1',
      formId: 'FORM-CONTEXT-1',
      title: '流程单',
      description: 'desc',
      modelName: '模型',
      status: 'approved',
      priority: 'medium',
      requesterId: 'SJ',
      requesterName: 'SJ',
      checkerId: 'JH',
      checkerName: 'JH',
      approverId: 'PZ',
      approverName: 'PZ',
      reviewerId: 'JH',
      reviewerName: 'JH',
      components: [],
      attachments: [],
      createdAt: 1,
      updatedAt: 1,
      currentNode: 'pz',
    };
    const updateTask = vi.fn();

    const result = await restoreEmbedFormSnapshotContext({
      formId: 'FORM-CONTEXT-1',
      token: 'token-context-1',
      actor: {
        id: 'JH',
        name: 'JH',
        roles: 'jd',
      },
      request,
      task,
      updateTask,
    });

    expect(result.task).toEqual(expect.objectContaining({
      attachments: [
        expect.objectContaining({
          id: 'att-context-1',
          name: '上下文附件',
        }),
      ],
    }));
    expect(updateTask).toHaveBeenCalledWith(expect.objectContaining({
      attachments: [
        expect.objectContaining({
          id: 'att-context-1',
        }),
      ],
    }));
  });
});
