/**
 * Visual harness · 批注工具面板家族（#48 token 迁移前后对比）
 *
 * 挂载真实的 AnnotationPanel、AnnotationStylePanel、AnnotationCard 与
 * AnnotationOverlayBar（内含 AnnotationColorPicker，可在截图场景里点开色板），
 * 用 useToolStore / useReviewStore / useUserStore 的模块级状态注入 mock 批注
 * （覆盖 principle/general/drawing/未设置四档严重度、refno chip、最小化 chip、
 * 带截图与无截图云线）。API 由 shot runner 场景做网络 mock。
 *
 * 仅供 vite（端口 5191）下 /harness/annot-tools.html 人工 / 截图访问，
 * 不参与生产构建入口。
 */
import { createApp, defineComponent, h, ref } from 'vue';

import '@/assets/tailwind.css';

import AnnotationCard from '@/components/tools/AnnotationCard.vue';
import AnnotationOverlayBar from '@/components/tools/AnnotationOverlayBar.vue';
import AnnotationPanel from '@/components/tools/AnnotationPanel.vue';
import AnnotationStylePanel from '@/components/tools/AnnotationStylePanel.vue';
import { useReviewStore } from '@/composables/useReviewStore';
import {
  useToolStore,
  type AnnotationRecord,
  type CloudAnnotationRecord,
  type RectAnnotationRecord,
} from '@/composables/useToolStore';
import { useUserStore } from '@/composables/useUserStore';
import { UserRole } from '@/types/auth';

const BASE_TS = new Date('2026-07-18T10:00:00+08:00').getTime();

const THUMB = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="120"><rect width="320" height="120" fill="#cbd5e1"/><path d="M24 96 L96 40 L150 80 L204 56 L296 96 Z" fill="#64748b"/></svg>',
);

const store = useToolStore();
const reviewStore = useReviewStore();
const userStore = useUserStore();

const authorId = userStore.currentUser.value?.id ?? 'SJ';

/** 让「添加截图」入口与意见上下文可见：批注截图依赖 currentTask.id / formId */
reviewStore.currentTask.value = {
  id: 'harness-task-48',
  formId: 'harness-form-48',
  title: 'token 迁移视觉基线任务',
  status: 'reviewing',
} as never;

const textAnnotations: AnnotationRecord[] = [
  {
    id: 'txt-1',
    entityId: 'e-1',
    worldPos: [0, 0, 0],
    visible: true,
    glyph: 'A1',
    title: '管道净距不足，需复核',
    description: '与桥架间距实测 84mm，低于原则要求 120mm。',
    createdAt: BASE_TS,
    refno: '24381/145018',
    refnos: ['24381/145018'],
    severity: 'principle',
    authorId,
  },
  {
    id: 'txt-2',
    entityId: 'e-2',
    worldPos: [1, 0, 0],
    visible: true,
    glyph: 'A2',
    title: '阀门手轮朝向调整建议',
    description: '预留检修通道。',
    createdAt: BASE_TS + 1800_000,
    severity: 'general',
    authorId,
    collapsed: true,
  },
];

const cloudAnnotations: CloudAnnotationRecord[] = [
  {
    id: 'cloud-1',
    objectIds: ['o-1'],
    anchorWorldPos: [0, 0, 0],
    visible: true,
    title: '支吊架间距超规范',
    description: '返回复核间距计算书。',
    createdAt: BASE_TS + 3600_000,
    refnos: ['24381/145022'],
    severity: 'drawing',
    authorId,
    screenshot: {
      url: THUMB,
      attachmentId: 'att-1',
      name: 'shot.png',
      capturedAt: BASE_TS + 3700_000,
    },
  },
  {
    id: 'cloud-2',
    objectIds: ['o-2'],
    anchorWorldPos: [2, 0, 0],
    visible: true,
    title: '保温层颜色与图例不一致',
    description: '',
    createdAt: BASE_TS + 5400_000,
    authorId,
  },
];

const rectAnnotations: RectAnnotationRecord[] = [
  {
    id: 'rect-1',
    objectIds: ['o-3'],
    obb: {
      center: [0, 0, 0],
      axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
      halfSize: [1, 1, 1],
      corners: [
        [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
        [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
      ],
    },
    anchorWorldPos: [0, 0, 0],
    visible: false,
    title: '设备基础预埋件位置待确认',
    description: '',
    createdAt: BASE_TS + 7200_000,
    authorId,
  },
];

store.annotations.value = textAnnotations;
store.cloudAnnotations.value = cloudAnnotations;
store.rectAnnotations.value = rectAnnotations;
store.obbAnnotations.value = [];
// 激活云线批注 + 云线模式：让 OverlayBar 显示（含严重度下拉与色板）
store.activeCloudAnnotationId.value = 'cloud-1';
store.setToolMode('annotation_cloud');

const toolsApi = {
  ready: ref(true),
  statusText: ref('批注工具就绪（harness mock）'),
  flyToAnnotation: () => {},
  removeAnnotation: (id: string) => store.removeAnnotation(id),
  highlightAnnotationTarget: () => {},
  highlightAnnotationTargets: () => {},
  flyToCloudAnnotation: () => {},
  flyToRectAnnotation: () => {},
  flyToObbAnnotation: () => {},
  removeCloudAnnotation: (id: string) => store.removeCloudAnnotation(id),
  removeRectAnnotation: (id: string) => store.removeRectAnnotation(id),
  removeObbAnnotation: (id: string) => store.removeObbAnnotation(id),
};

// 把 OverlayBar 定位到右下空白区：色板向上弹出，默认 top-4 位置会被视口顶部裁掉
sessionStorage.setItem('plant3d.annotationOverlayPos', JSON.stringify({ x: 1290, y: 420 }));

createApp(AnnotationPanel, { tools: toolsApi }).mount('#app-panel');
createApp(AnnotationStylePanel).mount('#app-style');
createApp(AnnotationOverlayBar, { tools: toolsApi }).mount('#app-overlay');

/** AnnotationCard 三态：选中 / 未选中 / 带截图（含角色点） */
const CardsRoot = defineComponent({
  setup() {
    return () => h('div', { class: 'flex flex-col gap-3' }, [
      h(AnnotationCard, {
        record: textAnnotations[0],
        type: 'text',
        isActive: true,
        commentCount: 3,
        authorRole: UserRole.DESIGNER,
        authorName: '王设计师',
      }),
      h(AnnotationCard, {
        record: textAnnotations[1],
        type: 'text',
        isActive: false,
        authorRole: UserRole.PROOFREADER,
        authorName: '张校对员',
      }),
      h(AnnotationCard, {
        record: cloudAnnotations[0],
        type: 'cloud',
        isActive: false,
        commentCount: 1,
        authorRole: UserRole.REVIEWER,
        authorName: '李审核员',
        thumbnailUrl: THUMB,
      }),
    ]);
  },
});

createApp(CardsRoot).mount('#app-cards');
