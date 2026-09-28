import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, shallowRef } from 'vue';

import ReviewAuxData from './ReviewAuxData.vue';

import type { ReviewTask } from '@/types/auth';

const currentTask = shallowRef<ReviewTask | null>(null);
const currentUser = shallowRef<{ id?: string } | null>({ id: 'reviewer-1' });

const reviewGetAuxDataMock = vi.fn();
const reviewGetCollisionDataMock = vi.fn();

type ViewerStub = {
  scene?: {
    getAABB?: (ids: string[]) => unknown;
    setObjectsHighlighted?: (ids: string[], highlighted: boolean) => void;
    highlightedObjectIds?: string[];
  };
  cameraFlight?: {
    flyTo?: (options: { aabb?: unknown; fit?: boolean; duration?: number }) => void;
  };
};

const viewerRef = shallowRef<ViewerStub | null>(null);

vi.mock('@/composables/useReviewStore', () => ({
  useReviewStore: () => ({ currentTask }),
}));

vi.mock('@/composables/useUserStore', () => ({
  useUserStore: () => ({ currentUser }),
}));

vi.mock('@/composables/useViewerContext', () => ({
  useViewerContext: () => ({ viewerRef }),
}));

vi.mock('@/api/reviewApi', () => ({
  AUX_DATA_DEFAULT_AUTH: {
    uCode: 'ZY',
    uKey: 'swbz-token-e74fbea2427981f918d314d6583c3d24',
  },
  reviewGetAuxData: (...args: unknown[]) => reviewGetAuxDataMock(...args),
  reviewGetCollisionData: (...args: unknown[]) => reviewGetCollisionDataMock(...args),
}));

function createTask(overrides: Partial<ReviewTask> = {}): ReviewTask {
  return {
    id: 'task-1',
    formId: 'FORM-001',
    title: '任务一',
    description: 'desc',
    modelName: 'Demo Model',
    status: 'in_review',
    priority: 'medium',
    requesterId: 'designer-1',
    requesterName: '设计人',
    reviewerId: 'checker-1',
    reviewerName: '旧审核字段',
    checkerId: 'checker-1',
    checkerName: '校核人',
    approverId: 'approver-1',
    approverName: '审核人',
    components: [{ id: 'comp-1', name: '阀门', refNo: 'V-01' }],
    createdAt: 1710000000000,
    updatedAt: 1710000000000,
    currentNode: 'jd',
    ...overrides,
  };
}

async function flushUi() {
  await vi.dynamicImportSettled();
  await nextTick();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await nextTick();
}

function mountReviewAuxData() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const app = createApp({ render: () => h(ReviewAuxData) });
  app.mount(host);
  return {
    host,
    unmount: () => {
      app.unmount();
      host.remove();
    },
  };
}

describe('ReviewAuxData', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    currentTask.value = createTask();
    currentUser.value = { id: 'reviewer-1' };
    reviewGetAuxDataMock.mockReset();
    reviewGetCollisionDataMock.mockReset();
    reviewGetAuxDataMock.mockResolvedValue({
      code: 0,
      message: 'ok',
      page: 1,
      page_size: 100,
      total: 1,
      data: { collision: [], quality: [], otverification: [], rules: [] },
    });
    reviewGetCollisionDataMock.mockResolvedValue({
      success: true,
      data: [],
      total: 0,
    });
    viewerRef.value = null;

    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem: vi.fn(() => null),
        setItem: vi.fn(),
        removeItem: vi.fn(),
      },
      configurable: true,
    });

    Object.defineProperty(globalThis, 'sessionStorage', {
      value: {
        getItem: vi.fn((key: string) => key === 'embed_mode_params'
          ? JSON.stringify({ projectId: 'project-embed-1' })
          : null),
        setItem: vi.fn(),
        removeItem: vi.fn(),
      },
      configurable: true,
    });
  });

  it('builds aux-data requests from active task context and session project id', async () => {
    const mounted = mountReviewAuxData();
    await flushUi();

    const button = Array.from(mounted.host.querySelectorAll('button')).find((node) =>
      node.textContent?.includes('获取当前任务辅助数据')
    ) as HTMLButtonElement;
    button.click();
    await flushUi();

    expect(reviewGetAuxDataMock).toHaveBeenCalledWith(
      expect.objectContaining({
        project_id: 'project-embed-1',
        form_id: 'FORM-001',
        requester_id: 'reviewer-1',
        model_refnos: ['V-01'],
      }),
      expect.any(Object),
    );
    expect(document.body.textContent).toContain('当前任务上下文完整');

    mounted.unmount();
  });

  it('shows an explicit degraded message when formId or project context is missing', async () => {
    currentTask.value = createTask({ formId: undefined });
    Object.defineProperty(globalThis, 'sessionStorage', {
      value: {
        getItem: vi.fn(() => null),
        setItem: vi.fn(),
        removeItem: vi.fn(),
      },
      configurable: true,
    });

    const mounted = mountReviewAuxData();
    await flushUi();

    expect(document.body.textContent).toContain('缺少关键上下文');
    expect(document.body.textContent).toContain('project_id / formId');

    const button = Array.from(mounted.host.querySelectorAll('button')).find((node) =>
      node.textContent?.includes('获取当前任务辅助数据')
    ) as HTMLButtonElement;
    expect(button.disabled).toBe(true);

    mounted.unmount();
  });

  it('clears stale state when switching tasks and safely highlights viewer objects', async () => {
    const setObjectsHighlighted = vi.fn();
    const flyTo = vi.fn();
    viewerRef.value = {
      scene: {
        getAABB: vi.fn((ids: string[]) => ids[0] === 'OBJ-1' ? [0, 0, 0, 1, 1, 1] : null),
        setObjectsHighlighted,
        highlightedObjectIds: ['STALE-1'],
      },
      cameraFlight: { flyTo },
    };

    reviewGetCollisionDataMock.mockResolvedValue({
      success: true,
      total: 1,
      data: [{
        ObjectOneLoc: 'A',
        ObjectOne: 'OBJ-1',
        ObjectTowLoc: 'B',
        ObjectTow: 'OBJ-2',
        ErrorMsg: '碰撞',
        ObjectOneMajor: 'pipe',
        ObjectTwoMajor: 'steel',
        CheckUsr: 'checker',
        CheckDate: '2026-03-18',
        ErrorStatus: 'new',
      }],
    });

    const mounted = mountReviewAuxData();
    await flushUi();

    const collisionButton = Array.from(mounted.host.querySelectorAll('button')).find((node) =>
      node.textContent?.trim() === '查询'
    ) as HTMLButtonElement;
    collisionButton.click();
    await flushUi();

    const actionButtons = mounted.host.querySelectorAll('button[title="高亮碰撞构件"], button[title="定位到碰撞位置"]');
    (actionButtons[0] as HTMLButtonElement).click();
    (actionButtons[1] as HTMLButtonElement).click();

    expect(setObjectsHighlighted).toHaveBeenCalledWith(['STALE-1'], false);
    expect(setObjectsHighlighted).toHaveBeenCalledWith(['OBJ-1'], true);
    expect(flyTo).toHaveBeenCalledWith(expect.objectContaining({ fit: true, duration: 0.8 }));

    currentTask.value = createTask({ id: 'task-2', formId: 'FORM-002', components: [{ id: 'comp-2', name: '法兰', refNo: 'F-02' }] });
    await flushUi();

    expect(document.body.textContent).toContain('formId=FORM-002');
    expect(document.body.textContent).not.toContain('total=1');

    mounted.unmount();
  });
});
