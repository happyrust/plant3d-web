import { describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick } from 'vue';

import AnnotationWorkspace, {
  type AnnotationWorkspaceTextCollapsePayload,
} from './AnnotationWorkspace.vue';

import type {
  AnnotationWorkspaceItem,
  AnnotationWorkspaceSummary,
} from './annotationWorkspaceModel';
import type { AnnotationType } from '@/composables/useToolStore';

vi.mock('./ReviewCommentsTimeline.vue', () => ({
  default: {
    name: 'ReviewCommentsTimelineStub',
    props: {
      annotationLabel: { type: String, default: '' },
      density: { type: String, default: 'normal' },
      screenshot: { type: Object, default: undefined },
    },
    template: '<div data-testid="timeline-stub" :data-density="density" :data-screenshot-url="screenshot?.url">{{ annotationLabel }}</div>',
  },
}));

function createItem(type: AnnotationType, id: string, title: string): AnnotationWorkspaceItem {
  return {
    id,
    type,
    title,
    description: `${title} 描述`,
    createdAt: 1710000000000,
    activityAt: 1710000000000,
    visible: true,
    refnos: [`REF-${id}`],
    formId: 'FORM-001',
    commentCount: 0,
    statusKey: 'pending',
    statusLabel: '待处理',
    statusTone: 'bg-slate-100 text-slate-700 border-slate-200',
    priority: 'low',
    priorityLabel: '未设置',
    priorityTone: 'bg-slate-100 text-slate-700 border-slate-200',
  };
}

const baseItems = [
  createItem('text', 'text-1', '文字批注 1'),
  createItem('cloud', 'cloud-1', '云线批注 1'),
  createItem('text', 'text-2', '文字批注 2'),
];

const baseSummary: AnnotationWorkspaceSummary = {
  total: 3,
  pending: 3,
  fixed: 0,
  rejected: 0,
  approved: 0,
  wontFix: 0,
  highPriority: 0,
};

async function mountWorkspace(options: {
  items?: AnnotationWorkspaceItem[];
  selectedAnnotation?: AnnotationWorkspaceItem | null;
  layout?: 'split' | 'list' | 'detail';
  showWorkflow?: boolean;
} = {}) {
  const collapseCalls: AnnotationWorkspaceTextCollapsePayload[] = [];
  const openCalls: AnnotationWorkspaceItem[] = [];
  const host = document.createElement('div');
  document.body.appendChild(host);

  const app = createApp({
    render: () => h(AnnotationWorkspace, {
      role: 'reviewer',
      items: options.items ?? baseItems,
      summary: baseSummary,
      activeFilter: 'all',
      selectedAnnotation: options.selectedAnnotation ?? baseItems[2],
      linkedMeasurements: [],
      confirmNote: '',
      unsavedAnnotationCount: 0,
      unsavedMeasurementCount: 0,
      canConfirm: false,
      confirmSaving: false,
      layout: options.layout ?? 'split',
      density: 'dock',
      showWorkflow: options.showWorkflow,
      onCollapseTextAnnotations: (payload: AnnotationWorkspaceTextCollapsePayload) => collapseCalls.push(payload),
      onOpenAnnotation: (item: AnnotationWorkspaceItem) => openCalls.push(item),
    }, {
      workflow: () => h('div', { 'data-testid': 'workflow-slot' }, '任务级流转'),
    }),
  });

  app.mount(host);
  await nextTick();

  return {
    host,
    collapseCalls,
    openCalls,
    unmount: () => {
      app.unmount();
      host.remove();
    },
  };
}

describe('AnnotationWorkspace', () => {
  it('收起全部和展开全部只作用于当前列表中的文字批注', async () => {
    const mounted = await mountWorkspace();

    const collapseButton = document.querySelector('[data-testid="annotation-collapse-all-text"]') as HTMLButtonElement | null;
    const expandButton = document.querySelector('[data-testid="annotation-expand-all-text"]') as HTMLButtonElement | null;
    expect(collapseButton?.disabled).toBe(false);
    expect(expandButton?.disabled).toBe(false);

    collapseButton?.click();
    expandButton?.click();

    expect(mounted.collapseCalls).toEqual([
      { mode: 'collapse-all', ids: ['text-1', 'text-2'], selectedId: 'text-2' },
      { mode: 'expand-all', ids: ['text-1', 'text-2'], selectedId: 'text-2' },
    ]);

    mounted.unmount();
  });

  it('只展开当前只在选中项为文字批注时可用，并只携带当前文字批注 id', async () => {
    const mounted = await mountWorkspace();

    const expandSelectedButton = document.querySelector('[data-testid="annotation-expand-selected-text"]') as HTMLButtonElement | null;
    expect(expandSelectedButton?.disabled).toBe(false);

    expandSelectedButton?.click();

    expect(mounted.collapseCalls).toEqual([
      { mode: 'expand-selected', ids: ['text-1', 'text-2'], selectedId: 'text-2' },
    ]);

    mounted.unmount();
  });

  it('选中项不是文字批注时，只展开当前禁用', async () => {
    const mounted = await mountWorkspace({ selectedAnnotation: baseItems[1] });

    const expandSelectedButton = document.querySelector('[data-testid="annotation-expand-selected-text"]') as HTMLButtonElement | null;
    expect(expandSelectedButton?.disabled).toBe(true);

    mounted.unmount();
  });

  it('右侧批注列表项双击仍进入批注详情', async () => {
    const mounted = await mountWorkspace();
    const row = document.querySelector('[data-testid="annotation-row-text-text-1"]') as HTMLElement | null;

    row?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));

    expect(mounted.openCalls).toEqual([expect.objectContaining({ id: 'text-1', type: 'text' })]);

    mounted.unmount();
  });

  it('按 showWorkflow 控制任务级流转区域是否渲染', async () => {
    const hidden = await mountWorkspace({ showWorkflow: false });
    expect(document.querySelector('[data-testid="workflow-slot"]')).toBeNull();
    hidden.unmount();

    const visible = await mountWorkspace({ showWorkflow: true });
    expect(document.querySelector('[data-testid="workflow-slot"]')).not.toBeNull();
    visible.unmount();
  });

  it('将选中批注的 screenshot 传给 ReviewCommentsTimeline', async () => {
    const withScreenshot: AnnotationWorkspaceItem = {
      ...baseItems[0],
      screenshot: {
        url: 'https://example.com/text-shot.png',
        attachmentId: 'att-text-shot',
        name: 'text-shot.png',
        capturedAt: 1777041600000,
      },
    };
    const mounted = await mountWorkspace({
      selectedAnnotation: withScreenshot,
      layout: 'detail',
    });

    const timeline = document.querySelector('[data-testid="timeline-stub"]');
    expect(timeline?.getAttribute('data-screenshot-url')).toBe('https://example.com/text-shot.png');

    mounted.unmount();
  });
});
