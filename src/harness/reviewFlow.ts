// Throwaway harness: mount the review-workflow leftover panels with mock data
// for before/after token-migration screenshots (see scripts/pen-preview/review-flow-shot.mjs).
import { createApp, h } from 'vue';

import '@/assets/tailwind.css';

import type { TimelineStep } from '@/components/review/WorkflowTimeline.vue';
import type { ReviewTask } from '@/types/auth';

import CollisionResultList from '@/components/review/CollisionResultList.vue';
import DesignerTaskList from '@/components/review/DesignerTaskList.vue';
import RoleSwitcher from '@/components/review/RoleSwitcher.vue';
import TaskContextSection from '@/components/review/sections/TaskContextSection.vue';
import WorkflowReturnDialog from '@/components/review/WorkflowReturnDialog.vue';
import WorkflowTimeline from '@/components/review/WorkflowTimeline.vue';
import { useUserStore } from '@/composables/useUserStore';

const now = Date.now();
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

// ---- WorkflowTimeline: cover submit / approve / return / reject / default dots ----
const timelineHistory: TimelineStep[] = [
  { node: 'sj', action: 'submit', operatorId: 'SJ', operatorName: '王设计师', comment: '首次提交，请校核', timestamp: now - 3 * DAY },
  { node: 'jd', action: 'return', operatorId: 'JH', operatorName: '张校对员', comment: '标高标注缺失，退回修改', timestamp: now - 2 * DAY },
  { node: 'sj', action: 'submit', operatorId: 'SJ', operatorName: '王设计师', timestamp: now - 1 * DAY },
  { node: 'jd', action: 'approve', operatorId: 'JH', operatorName: '张校对员', comment: '校核通过', timestamp: now - 6 * HOUR },
  { node: 'sh', action: 'reject', operatorId: 'SH', operatorName: '李审核员', comment: '管径不符合规范', timestamp: now - 2 * HOUR },
  { node: 'sh', action: 'transfer', operatorId: 'PZ', operatorName: '赵批准人', timestamp: now - 1 * HOUR },
];

createApp({
  render: () => h(WorkflowTimeline, { currentNode: 'sh', history: timelineHistory }),
}).mount('#app-timeline');

// ---- RoleSwitcher: role identity badge colors (functional, must stay) ----
createApp(RoleSwitcher).mount('#app-role');

// ---- CollisionResultList: status pill variants + expanded error detail ----
const collisionItems = [
  {
    ObjectOne: '/PIPE-100-A', ObjectOneLoc: 'E 1200 N 300 U 2100', ObjectOneMajor: '管道',
    ObjectTow: '/STL-BEAM-01', ObjectTowLoc: 'E 1210 N 300 U 2080', ObjectTwoMajor: '结构',
    ErrorMsg: '硬碰撞：管道与钢梁交叠 42mm', CheckUsr: 'SJ', CheckDate: '2026-07-18', ErrorStatus: '新',
  },
  {
    ObjectOne: '/HVAC-DUCT-3', ObjectOneLoc: 'E 800 N 120 U 2600', ObjectOneMajor: '暖通',
    ObjectTow: '/CABLE-TRAY-7', ObjectTowLoc: 'E 805 N 118 U 2590', ObjectTwoMajor: '电气',
    ErrorMsg: '软碰撞：保温层间隙不足', CheckUsr: 'JH', CheckDate: '2026-07-17', UpUsr: 'SJ', UpTime: '2026-07-18', ErrorStatus: '已解决',
  },
  {
    ObjectOne: '/EQUIP-P101', ObjectOneLoc: 'E 300 N 40 U 100', ObjectOneMajor: '设备',
    ObjectTow: '/PIPE-050-B', ObjectTowLoc: 'E 310 N 42 U 120', ObjectTwoMajor: '管道',
    ErrorMsg: '维护空间侵入', CheckUsr: 'SH', CheckDate: '2026-07-16', ErrorStatus: '已忽略',
  },
  {
    ObjectOne: '/PLATFORM-2F', ObjectOneLoc: 'E 900 N 500 U 4000', ObjectOneMajor: '结构',
    ObjectTow: '/PIPE-200-C', ObjectTowLoc: 'E 910 N 505 U 3990', ObjectTwoMajor: '管道',
    ErrorMsg: '待复核碰撞', CheckUsr: 'PZ', CheckDate: '2026-07-15', ErrorStatus: '待确认',
  },
];

createApp({
  render: () => h(CollisionResultList, { items: collisionItems, total: 12 }),
}).mount('#app-collision');

// ---- TaskContextSection: high priority -> orange badge (design color under test) ----
const contextTask: ReviewTask = {
  id: 'task-ctx-1',
  formId: 'FORM-2026-0719',
  title: '压缩机区管廊碰撞复查',
  description: '针对 D 区管廊与压缩机基础的碰撞复查任务。',
  modelName: 'AvevaMarineSample',
  status: 'in_review',
  priority: 'high',
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
    { id: 'c2', name: 'STL-BEAM-01', refNo: '=24381/145019' },
  ],
  createdAt: now - 5 * DAY,
  updatedAt: now - HOUR,
  currentNode: 'sh',
};

createApp({
  render: () => h(TaskContextSection, { task: contextTask, loading: false }),
}).mount('#app-context');

// ---- DesignerTaskList: seed store (mock mode) with one task per status bucket ----
const userStore = useUserStore();
userStore.setUseBackend(false);

function makeTask(partial: Partial<ReviewTask> & Pick<ReviewTask, 'id' | 'title' | 'status' | 'priority'>): ReviewTask {
  return {
    formId: `FORM-${partial.id}`,
    description: '演示任务描述：管道与结构专业交叉复查。',
    modelName: 'AvevaMarineSample',
    requesterId: 'SJ',
    requesterName: '王设计师',
    checkerId: 'JH',
    checkerName: '张校对员',
    approverId: 'SH',
    approverName: '李审核员',
    reviewerId: 'JH',
    reviewerName: '张校对员',
    components: [{ id: 'c1', name: 'PIPE-100-A', refNo: '=24381/145018' }],
    createdAt: now - 4 * DAY,
    updatedAt: now - 2 * HOUR,
    currentNode: 'jd',
    ...partial,
  };
}

userStore.reviewTasks.value = [
  makeTask({ id: 't-draft', title: '新装置区初版模型自查', status: 'draft', priority: 'low', currentNode: 'sj', updatedAt: now - 6 * HOUR }),
  makeTask({ id: 't-submitted', title: 'D 区管廊补强校审', status: 'submitted', priority: 'high', updatedAt: now - 5 * HOUR }),
  makeTask({ id: 't-review', title: '压缩机基础碰撞复查', status: 'in_review', priority: 'medium', currentNode: 'sh', updatedAt: now - 4 * HOUR }),
  makeTask({ id: 't-approved', title: '泵区管道坡度修订', status: 'approved', priority: 'medium', currentNode: 'pz', updatedAt: now - 3 * HOUR }),
  makeTask({
    id: 't-rejected', title: '设备基础调整校审', status: 'rejected', priority: 'urgent', currentNode: 'sj',
    returnReason: '基础尺寸与土建条件不符，请核对后重新提交。',
    workflowHistory: [
      { node: 'sj', action: 'submit', operatorId: 'SJ', operatorName: '王设计师', timestamp: now - 2 * DAY },
      { node: 'jd', action: 'return', operatorId: 'JH', operatorName: '张校对员', comment: '基础尺寸与土建条件不符', timestamp: now - 1 * DAY },
    ],
    updatedAt: now - 1 * HOUR,
  }),
  makeTask({ id: 't-cancelled', title: '旧版本布置图核查（作废）', status: 'cancelled', priority: 'low', updatedAt: now - 2 * DAY }),
];

createApp(DesignerTaskList).mount('#app-designer');

// ---- WorkflowReturnDialog: only when ?dialog=1 (teleported fullscreen overlay) ----
if (new URLSearchParams(window.location.search).get('dialog') === '1') {
  createApp({
    render: () =>
      h(WorkflowReturnDialog, {
        visible: true,
        currentNode: 'sh',
        loading: false,
        'onUpdate:visible': () => {},
        onConfirm: () => {},
      }),
  }).mount(document.body.appendChild(document.createElement('div')));
}
