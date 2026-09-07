/**
 * Visual harness · 双胞胎面板之设计端批注处理（#46/#47 token 迁移前后对比）
 *
 * 挂载真实 DesignerCommentHandlingPanel：种子 userStore（mock 模式 + 一条已退回单）、
 * reviewStore.currentTask、toolStore 五种处理状态的文字/云线/矩形批注，
 * 覆盖已退回徽章 / 退回意见卡 / 分组徽章 / 列表行 hover·选中态 / 暗色确认页脚 CTA。
 *
 * 仅供 `npx vite --port 5192 --strictPort` 下 /harness/review-twins.html 使用，
 * 不参与生产构建入口。（ReviewPanel 本轮无模板改动，不在此页挂载。）
 */
import '@/assets/tailwind.css';
import '@/assets/main.scss';

import { createApp, defineComponent, h } from 'vue';

import type { ReviewTask } from '@/types/auth';

import DesignerCommentHandlingPanel from '@/components/review/DesignerCommentHandlingPanel.vue';
import { useReviewStore } from '@/composables/useReviewStore';
import { useToolStore, type AnnotationRecord, type CloudAnnotationRecord, type RectAnnotationRecord } from '@/composables/useToolStore';
import { useUserStore } from '@/composables/useUserStore';

const BASE_TS = new Date('2026-07-18T10:00:00+08:00').getTime();
const HOUR = 3_600_000;

const returnedTask: ReviewTask = {
  id: 'twin-task-returned',
  formId: 'FORM-TWIN-46',
  title: '设备基础调整校审（退回处理）',
  description: '基础尺寸与土建条件不符，请逐条处理校核批注后重新提交。',
  modelName: 'AvevaMarineSample',
  status: 'rejected',
  priority: 'urgent',
  requesterId: 'SJ',
  requesterName: '王设计师',
  checkerId: 'JH',
  checkerName: '张校对员',
  approverId: 'SH',
  approverName: '李审核员',
  reviewerId: 'JH',
  reviewerName: '张校对员',
  components: [
    { id: 'c1', name: 'PIPE-100-A', refNo: '=24381/145018' },
    { id: 'c2', name: 'FOUND-P101', refNo: '=24381/145030' },
  ],
  createdAt: BASE_TS - 48 * HOUR,
  updatedAt: BASE_TS - 2 * HOUR,
  currentNode: 'sj',
  returnReason: '基础尺寸与土建条件不符：预埋件定位偏差 60mm，请核对土建图后调整。',
  workflowHistory: [
    { node: 'sj', action: 'submit', operatorId: 'SJ', operatorName: '王设计师', timestamp: BASE_TS - 40 * HOUR },
    { node: 'jd', action: 'return', operatorId: 'JH', operatorName: '张校对员', comment: '基础尺寸与土建条件不符', timestamp: BASE_TS - 6 * HOUR },
  ],
};

const userStore = useUserStore();
userStore.setUseBackend(false);
userStore.reviewTasks.value = [returnedTask];

const reviewStore = useReviewStore();
void reviewStore.setCurrentTask(returnedTask);

type ReviewStateLike = AnnotationRecord['reviewState'];

const reviewStates: Record<string, ReviewStateLike> = {
  open: undefined,
  rejected: { resolutionStatus: 'open', decisionStatus: 'rejected', history: [] },
  fixed: { resolutionStatus: 'fixed', decisionStatus: 'pending', history: [] },
  wontFix: { resolutionStatus: 'wont_fix', decisionStatus: 'pending', history: [] },
  agreed: { resolutionStatus: 'fixed', decisionStatus: 'agreed', history: [] },
};

function makeTextAnnotation(partial: Partial<AnnotationRecord> & Pick<AnnotationRecord, 'id' | 'title'>): AnnotationRecord {
  return {
    entityId: 'harness-entity',
    worldPos: [0, 0, 0],
    visible: true,
    glyph: 'A',
    description: '',
    createdAt: BASE_TS,
    refnos: ['24381/145018'],
    ...partial,
  };
}

const toolStore = useToolStore();
toolStore.annotations.value = [
  makeTextAnnotation({
    id: 'twin-a1',
    title: '预埋件定位与土建图不符',
    description: '实测偏差 60mm，超出允许值。',
    severity: 'principle',
    reviewState: reviewStates.open,
    createdAt: BASE_TS + 5 * HOUR,
  }),
  makeTextAnnotation({
    id: 'twin-a2',
    title: '基础顶标高标注缺失',
    description: '请补充基础顶标高与找平层说明。',
    severity: 'general',
    reviewState: reviewStates.fixed,
    createdAt: BASE_TS + 4 * HOUR,
  }),
  makeTextAnnotation({
    id: 'twin-a3',
    title: '图面尺寸线压字',
    severity: 'drawing',
    reviewState: reviewStates.rejected,
    createdAt: BASE_TS + 3 * HOUR,
  }),
];
toolStore.cloudAnnotations.value = [
  {
    ...(makeTextAnnotation({ id: 'twin-c1', title: '地脚螺栓群与管廊柱肢干涉' }) as object),
    reviewState: reviewStates.wontFix,
    severity: 'general',
    createdAt: BASE_TS + 2 * HOUR,
  } as unknown as CloudAnnotationRecord,
];
toolStore.rectAnnotations.value = [
  {
    ...(makeTextAnnotation({ id: 'twin-r1', title: '设备基础倒角样式确认' }) as object),
    reviewState: reviewStates.agreed,
    severity: 'drawing',
    createdAt: BASE_TS + 1 * HOUR,
  } as unknown as RectAnnotationRecord,
];

const HarnessRoot = defineComponent({
  setup() {
    return () => h('section', { class: 'harness-section', id: 'twins' }, [
      h('h1', '设计端批注处理面板（1500px）'),
      h('div', {
        style: { width: '1500px', height: '940px' },
        'data-shot': 'designer-comment-panel',
      }, [h(DesignerCommentHandlingPanel)]),
    ]);
  },
});

createApp(HarnessRoot).mount('#app');
