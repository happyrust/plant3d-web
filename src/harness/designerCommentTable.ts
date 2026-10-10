/**
 * Visual harness · 设计端「批注处理」面板方案 A（docs/plans/2026-10-10-designer-comment-table-inline-processing-plan.md）
 *
 * 挂载真实 DesignerCommentHandlingPanel：种子三张退回单（看顶部切换器）、当前单五种处理状态的批注。
 * 面板宿主尺寸取 URL 参数 `w` / `h`（默认 1200×900），用来核对窄面板、矮面板下底栏是否可达。
 * URL 参数 `state`：`annotated`（默认，有批注）/ `empty`（当前单没有批注）/ `error`（退回单据加载失败）。
 *
 * 仅供 `node scripts/visual-baseline/shot.mjs harness/designer-comment-table.html` 使用，不参与生产构建入口。
 */
import '@/assets/tailwind.css';
import '@/assets/main.scss';

import { createApp, h, nextTick } from 'vue';

import type { ReviewTask } from '@/types/auth';

import DesignerCommentHandlingPanel from '@/components/review/DesignerCommentHandlingPanel.vue';
import { useReviewStore } from '@/composables/useReviewStore';
import { useToolStore, type AnnotationRecord } from '@/composables/useToolStore';
import { useUserStore } from '@/composables/useUserStore';

const BASE_TS = new Date('2026-09-24T14:15:00+08:00').getTime();
const HOUR = 3_600_000;

function returnedTask(task: Partial<ReviewTask> & Pick<ReviewTask, 'id' | 'title'>): ReviewTask {
  return {
    formId: `FORM-${task.id}`,
    description: `模型数据包：${task.title}`,
    modelName: task.title,
    status: 'draft',
    priority: 'medium',
    requesterId: 'SJ',
    requesterName: '王设计师',
    checkerId: 'JH',
    checkerName: '张校对员',
    reviewerId: 'JH',
    reviewerName: '张校对员',
    components: [{ id: 'c1', name: 'SP-207', refNo: '=24381/145018' }],
    createdAt: BASE_TS - 24 * HOUR,
    updatedAt: BASE_TS,
    currentNode: 'sj',
    ...task,
  };
}

const tasks: ReviewTask[] = [
  returnedTask({
    id: 'harness-e2e-0924',
    title: 'E2E-PMS-SEND-0924-1415',
    returnReason: '驳回：清理 2c5b0ffe 送审开关自测遗留单，退回 SJ',
    workflowHistory: [
      { node: 'sj', action: 'submit', operatorId: 'SJ', operatorName: '王设计师', timestamp: BASE_TS - 20 * HOUR },
      { node: 'jd', action: 'return', operatorId: 'JH', operatorName: '张校对员', comment: '驳回：清理 2c5b0ffe 送审开关自测遗留单，退回 SJ', timestamp: BASE_TS },
    ],
  }),
  returnedTask({
    id: 'harness-accept-0928',
    title: 'ACCEPT-20260928-152353-TC2',
    priority: 'high',
    returnReason: '校对驳回：请处理批注后重提（线上验收）',
    workflowHistory: [],
  }),
  returnedTask({
    id: 'harness-pms-0921',
    title: 'PMS-SEND-0921-0930',
    priority: 'urgent',
    returnReason: '审核退回：支架选型需按新版规格书复核',
    workflowHistory: [
      { node: 'sh', action: 'return', operatorId: 'SH', operatorName: '李审核员', comment: '审核退回：支架选型需按新版规格书复核', timestamp: BASE_TS - 72 * HOUR },
    ],
  }),
];

const params = new URLSearchParams(location.search);
const width = Number(params.get('w')) || 1200;
const height = Number(params.get('h')) || 900;
const state = params.get('state') ?? 'annotated';

const userStore = useUserStore();
userStore.setUseBackend(false);
if (state === 'error') {
  userStore.reviewTasks.value = [];
  userStore.error.value = '加载任务列表失败：网络连接超时';
} else {
  userStore.reviewTasks.value = tasks;
}

type ReviewStateLike = AnnotationRecord['reviewState'];

const reviewStates: Record<string, ReviewStateLike> = {
  open: undefined,
  rejected: { resolutionStatus: 'open', decisionStatus: 'rejected', history: [] },
  fixed: { resolutionStatus: 'fixed', decisionStatus: 'pending', history: [] },
  wontFix: { resolutionStatus: 'wont_fix', decisionStatus: 'pending', history: [] },
  agreed: { resolutionStatus: 'fixed', decisionStatus: 'agreed', history: [] },
};

function makeTextAnnotation(partial: Partial<AnnotationRecord> & Pick<AnnotationRecord, 'id' | 'title'>): AnnotationRecord {
  // formId 不在 AnnotationRecord 类型里，按单据收敛时由 annotationWorkspaceModel 直接读记录上的这个字段
  const record: AnnotationRecord & { formId?: string } = {
    entityId: 'harness-entity',
    worldPos: [0, 0, 0],
    visible: true,
    glyph: 'A',
    description: '',
    createdAt: BASE_TS,
    refnos: ['24381/145018'],
    formId: tasks[0]!.formId,
    ...partial,
  };
  return record;
}

const seededAnnotations = [
  makeTextAnnotation({ id: 'h-a1', title: '/B1-PIPE-0012 与钢结构梁 BM-3 碰撞', description: '净距不足 50mm，建议整体抬高 150mm。', severity: 'principle', reviewState: reviewStates.open, createdAt: BASE_TS + 7 * HOUR }),
  makeTextAnnotation({ id: 'h-a2', title: '阀门 V-1023 手轮朝向不便操作', description: '手轮朝向检修通道反侧。', severity: 'general', reviewState: reviewStates.rejected, createdAt: BASE_TS + 6 * HOUR }),
  makeTextAnnotation({ id: 'h-a3', title: '支吊架 SP-207 缺少编号标注', severity: 'general', reviewState: reviewStates.open, createdAt: BASE_TS + 5 * HOUR }),
  makeTextAnnotation({ id: 'h-a4', title: 'EL+4.500 标高标注字号过小', severity: 'drawing', reviewState: reviewStates.fixed, createdAt: BASE_TS + 4 * HOUR }),
  makeTextAnnotation({ id: 'h-a5', title: '保温层厚度与规格书不一致', reviewState: reviewStates.wontFix, createdAt: BASE_TS + 3 * HOUR }),
  makeTextAnnotation({ id: 'h-a6', title: '泵 P-201 出口缺少止回阀', severity: 'principle', reviewState: reviewStates.open, createdAt: BASE_TS + 2 * HOUR }),
  makeTextAnnotation({ id: 'h-a7', title: '仪表 PT-305 取压口位置与 PID 不符', severity: 'general', reviewState: reviewStates.agreed, createdAt: BASE_TS + HOUR }),
];

createApp({
  render: () => h('div', {
    class: 'panel-host',
    style: { width: `${width}px`, height: `${height}px` },
  }, [h(DesignerCommentHandlingPanel)]),
}).mount('#app');

// 面板挂载后草稿容器才按当前任务切到 scope key；先种批注会落进旧容器、被当成「未归属草稿」
void (async () => {
  if (state === 'error') return;
  await useReviewStore().setCurrentTask(tasks[0]!).catch(() => undefined);
  await nextTick();
  useToolStore().annotations.value = state === 'empty' ? [] : seededAnnotations;
})();
