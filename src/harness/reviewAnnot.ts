/**
 * Visual harness · 批注呈现面（#46/#47 token 迁移前后对比）
 *
 * 挂载 AnnotationTableView（wide + compact 两档）、AnnotationWorkspace（list 布局，
 * 展示选中行高亮）与 ReviewCommentsTimeline（normal + dock 两档），
 * 用 mock 批注数据覆盖不同 severity / 状态组合。
 *
 * 仅供 `vite --port 5192` 下人工 / 截图脚本访问 /harness/review-annot.html 使用，
 * 不参与生产构建入口。
 */
import '@/assets/tailwind.css';
import '@/assets/main.scss';

import { createApp, defineComponent, h } from 'vue';

import type { AnnotationWorkspaceItem, AnnotationWorkspaceSummary } from '@/components/review/annotationWorkspaceModel';

import AnnotationTableView from '@/components/review/AnnotationTableView.vue';
import AnnotationWorkspace from '@/components/review/AnnotationWorkspace.vue';
import ReviewCommentsTimeline from '@/components/review/ReviewCommentsTimeline.vue';
import { useToolStore } from '@/composables/useToolStore';
import { UserRole } from '@/types/auth';

const BASE_TS = new Date('2026-07-18T10:00:00+08:00').getTime();

const THUMB = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="56"><rect width="80" height="56" fill="#cbd5e1"/><path d="M8 44 L30 20 L46 36 L58 26 L72 44 Z" fill="#64748b"/></svg>',
);

function makeItem(partial: Partial<AnnotationWorkspaceItem> & { id: string; title: string }): AnnotationWorkspaceItem {
  return {
    type: 'text',
    description: '',
    createdAt: BASE_TS,
    activityAt: BASE_TS,
    visible: true,
    refnos: [],
    commentCount: 0,
    statusKey: 'pending',
    statusLabel: '待处理',
    statusTone: 'bg-slate-100 text-slate-700 border-slate-200',
    priority: 'medium',
    priorityLabel: '一般错误',
    priorityTone: 'bg-orange-100 text-orange-700 border-orange-200',
    ...partial,
  };
}

const items: AnnotationWorkspaceItem[] = [
  makeItem({
    id: 'row-active',
    title: '管道与桥架间距不足 120mm',
    description: '按管廊布置原则需保持 ≥120mm 净距，当前实测 84mm。',
    severity: 'principle',
    refnos: ['24381/145018'],
    commentCount: 3,
    thumbnailUrl: THUMB,
    statusKey: 'pending',
    statusLabel: '待处理',
    priority: 'urgent',
    priorityLabel: '原则错误',
    priorityTone: 'bg-rose-100 text-rose-700 border-rose-200',
  }),
  makeItem({
    id: 'row-edit',
    title: '阀门手轮朝向不便于操作',
    description: '建议调整阀门安装角度，预留检修通道。',
    severity: 'general',
    refnos: ['24381/145022'],
    commentCount: 1,
    statusKey: 'fixed',
    statusLabel: '已修改',
    statusTone: 'bg-blue-100 text-blue-700 border-blue-200',
    activityAt: BASE_TS + 3600_000,
  }),
  makeItem({
    id: 'row-saving',
    title: '标注文字与图面比例不符',
    severity: 'drawing',
    statusKey: 'approved',
    statusLabel: '已通过',
    statusTone: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    activityAt: BASE_TS + 7200_000,
  }),
  makeItem({
    id: 'row-rejected',
    title: '支吊架间距超出规范上限',
    description: '返回复核间距计算书。',
    severity: 'principle',
    statusKey: 'rejected',
    statusLabel: '已驳回',
    statusTone: 'bg-rose-100 text-rose-700 border-rose-200',
    commentCount: 5,
    activityAt: BASE_TS + 9000_000,
  }),
  makeItem({
    id: 'row-wontfix',
    title: '保温层颜色与图例不一致',
    statusKey: 'wont_fix',
    statusLabel: '不需解决',
    statusTone: 'bg-amber-100 text-amber-700 border-amber-200',
    activityAt: BASE_TS + 10_800_000,
  }),
  makeItem({
    id: 'row-unset',
    title: '设备基础预埋件位置待确认',
    activityAt: BASE_TS + 12_600_000,
  }),
];

const summary: AnnotationWorkspaceSummary = {
  total: items.length,
  pending: items.filter((i) => i.statusKey === 'pending').length,
  fixed: items.filter((i) => i.statusKey === 'fixed').length,
  rejected: items.filter((i) => i.statusKey === 'rejected').length,
  approved: items.filter((i) => i.statusKey === 'approved').length,
  wontFix: items.filter((i) => i.statusKey === 'wont_fix').length,
  highPriority: items.filter((i) => i.severity === 'principle').length,
};

function seedTimelineComments() {
  const store = useToolStore();
  const seed = [
    {
      id: 'hc-1',
      authorId: 'JH',
      authorName: '张校对员',
      authorRole: UserRole.PROOFREADER,
      content: '该处净距不满足管廊布置原则，请设计复核后调整走向。',
      createdAt: BASE_TS,
    },
    {
      id: 'hc-2',
      authorId: 'SJ',
      authorName: '王设计师',
      authorRole: UserRole.DESIGNER,
      content: '已调整支管标高 +150mm，重新出图，请复核。',
      createdAt: BASE_TS + 1800_000,
      replyToId: 'hc-1',
    },
    {
      id: 'hc-3',
      authorId: 'SH',
      authorName: '李审核员',
      authorRole: UserRole.REVIEWER,
      content: '复核通过，注意同步更新 ISO 图。',
      createdAt: BASE_TS + 3600_000,
    },
  ];
  for (const comment of seed) {
    store.addCommentToAnnotation('text', 'harness-annot-1', comment, null, null);
  }
}

const Section = defineComponent({
  props: {
    title: { type: String, required: true },
    width: { type: Number, required: true },
    sectionId: { type: String, required: true },
  },
  setup(props, { slots }) {
    return () => h('section', { class: 'harness-section', id: props.sectionId }, [
      h('h1', `${props.title}（${props.width}px）`),
      h('div', {
        style: { width: `${props.width}px`, height: props.sectionId.startsWith('table') ? '620px' : 'auto' },
        'data-shot': props.sectionId,
      }, slots.default?.()),
    ]);
  },
});

const HarnessRoot = defineComponent({
  setup() {
    seedTimelineComments();

    const tableProps = {
      items,
      currentAnnotationId: 'row-active',
      currentAnnotationType: 'text' as const,
      taskKey: 'HARNESS-46-47',
      subtitle: 'BRAN 24381/145018 · token 迁移视觉基线',
      canEditItem: (item: AnnotationWorkspaceItem) => item.id === 'row-edit' || item.id === 'row-saving',
      savingTitleKeys: ['text:row-saving'],
    };

    const timelineProps = {
      annotationType: 'text' as const,
      annotationId: 'harness-annot-1',
      annotationLabel: '管道与桥架间距不足 120mm',
      contextFormId: null,
      contextTaskId: null,
      allowReviewActions: true,
    };

    return () => h('div', [
      h(Section, { title: '批注表格 · wide 档（排序高亮 / 选中行 / 行内编辑）', width: 1150, sectionId: 'table-wide' }, {
        default: () => h(AnnotationTableView, tableProps),
      }),
      h(Section, { title: '批注表格 · compact 卡片档', width: 500, sectionId: 'table-compact' }, {
        default: () => h(AnnotationTableView, tableProps),
      }),
      h(Section, { title: '批注工作区 · list 布局（选中行高亮）', width: 720, sectionId: 'workspace-list' }, {
        default: () => h(AnnotationWorkspace, {
          role: 'designer' as const,
          items,
          summary,
          activeFilter: 'all' as const,
          selectedAnnotation: items[0] ?? null,
          linkedMeasurements: [],
          confirmNote: '',
          unsavedAnnotationCount: 0,
          unsavedMeasurementCount: 0,
          canConfirm: false,
          confirmSaving: false,
          layout: 'list' as const,
        }),
      }),
      h(Section, { title: '校审意见时间线 · normal 档', width: 640, sectionId: 'timeline-normal' }, {
        default: () => h(ReviewCommentsTimeline, { ...timelineProps, density: 'normal' as const }),
      }),
      h(Section, { title: '校审意见时间线 · dock 档', width: 520, sectionId: 'timeline-dock' }, {
        default: () => h(ReviewCommentsTimeline, { ...timelineProps, density: 'dock' as const }),
      }),
    ]);
  },
});

createApp(HarnessRoot).mount('#app');
