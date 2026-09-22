<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch, type Ref } from 'vue';

import {
  Check,
  ChevronDown,
  ChevronRight,
  Cloud,
  Eye,
  EyeOff,
  Focus,
  GripVertical,
  MoreHorizontal,
  PanelRightOpen,
  RectangleHorizontal,
  Trash,
  Trash2,
  Type,
  X,
} from 'lucide-vue-next';

import { setAnnotationProcessingEntryTarget } from '@/components/review/annotationProcessingEntry';
import { isCanonicalReturnedTask } from '@/components/review/reviewTaskFilters';
import AnnotationColorPicker from '@/components/tools/AnnotationColorPicker.vue';
import { saveAnnotationBasicFields, saveAnnotationSeverity } from '@/composables/useAnnotationSeveritySync';
import { useAnnotationStyleStore } from '@/composables/useAnnotationStyleStore';
import { findNounByRefnoAcrossAllDbnos } from '@/composables/useDbnoInstancesDtxLoader';
import { ensurePanelAndActivate } from '@/composables/useDockApi';
import { useReviewStore } from '@/composables/useReviewStore';
import {
  type ActiveAnnotationContext,
  type AnnotationType,
  type AnyAnnotationRecord,
  getAnnotationMemberRefnos,
  useToolStore,
} from '@/composables/useToolStore';
import { useUserStore } from '@/composables/useUserStore';
import {
  ANNOTATION_SEVERITY_VALUES,
  canEditAnnotationSeverity,
  getAnnotationSeverityDisplay,
  type AnnotationSeverity,
  UserRole,
} from '@/types/auth';

/** 云线闸门被拦下的步骤，由 useDtxTools 外发，用于把对应步骤闪红 */
type CloudGateBlock = { step: 'target' | 'anchor'; at: number };

type ToolsApi = {
  ready: Ref<boolean>;
  statusText: Ref<string>;
  flyToAnnotation: (id: string) => void;
  removeAnnotation: (id: string) => void;
  flyToCloudAnnotation?: (id: string) => void;
  flyToRectAnnotation?: (id: string) => void;
  flyToObbAnnotation?: (id: string) => void;
  removeCloudAnnotation?: (id: string) => void;
  removeRectAnnotation?: (id: string) => void;
  removeObbAnnotation?: (id: string) => void;
  pendingCloudAnchor?: Ref<{ refno: string } | null>;
  clearPendingCloudAnchor?: () => void;
  rollbackCloudCreationStep?: () => boolean;
  cloudGateBlock?: Ref<CloudGateBlock | null>;
  highlightAnnotationTarget?: (refno: string) => void;
  selectionStore?: {
    selectedRefnos: Ref<string[]>;
  };
};

const props = defineProps<{
  tools: ToolsApi;
}>();

const store = useToolStore();
const styleStore = useAnnotationStyleStore();
const reviewStore = useReviewStore();

const drawerOpen = ref(false);
const drawerRef = ref<HTMLElement | null>(null);
const triggerRef = ref<HTMLElement | null>(null);
const severityMenuOpen = ref(false);
const severityMenuRef = ref<HTMLElement | null>(null);
const severityTriggerRef = ref<HTMLElement | null>(null);
const overlayRootRef = ref<HTMLElement | null>(null);
const overlayOffset = ref<{ x: number; y: number } | null>(null);
const dragState = ref<{ startX: number; startY: number; originX: number; originY: number } | null>(null);

const OVERLAY_POS_STORAGE_KEY = 'plant3d.annotationOverlayPos';

const overlayPositionStyle = computed(() => {
  if (!overlayOffset.value) return {};
  return {
    left: `${overlayOffset.value.x}px`,
    top: `${overlayOffset.value.y}px`,
    right: 'auto',
  };
});

const hasCustomOverlayPosition = computed(() => overlayOffset.value !== null);

function hexFromNumber(n: number): string {
  return '#' + n.toString(16).padStart(6, '0').toUpperCase();
}

function numberFromHex(hex: string): number {
  return parseInt(hex.replace('#', ''), 16);
}

const selectedAnnotationColor = computed({
  get() {
    const type = currentType.value;
    const kind = type === 'text' ? 'text' : type === 'cloud' ? 'cloud' : type === 'rect' ? 'rect' : 'cloud';
    return hexFromNumber(styleStore.style[kind].color);
  },
  set(hex: string) {
    const color = numberFromHex(hex);
    const type = currentType.value;
    const kind = type === 'text' ? 'text' : type === 'cloud' ? 'cloud' : type === 'rect' ? 'rect' : 'cloud';
    styleStore.updateStyle(kind, { color });
  },
});

const annotationModes = new Set([
  'annotation',
  'annotation_cloud',
  'annotation_rect',
]);

const isAnnotationMode = computed(() => annotationModes.has(store.toolMode.value));
const cloudTargetPicking = ref(false);
const isCloudCreationContext = computed(() => (
  store.toolMode.value === 'annotation_cloud' || cloudTargetPicking.value
));

const currentAnnotation = computed<ActiveAnnotationContext | null>(() => {
  return store.activeAnnotationContext.value;
});
const selectedModelRefnos = computed(() => props.tools.selectionStore?.selectedRefnos.value ?? []);
/** 模型元素 → 关联批注的反查，四类批注都算、只看 member 绑定（ADR-0049）。 */
type RelatedAnnotationEntry = { type: AnnotationType; record: AnyAnnotationRecord };
const relatedAnnotations = computed<RelatedAnnotationEntry[]>(() => (
  store.findAnnotationsByMemberRefnosAcrossTypes(selectedModelRefnos.value)
));

const isVisible = computed(() => {
  return isAnnotationMode.value ||
    cloudTargetPicking.value ||
    !!currentAnnotation.value ||
    relatedAnnotations.value.length > 0;
});

// 浮层可见性同步到 store：ViewerPanel 据此决定「待保存证据」停靠进本栈（footer slot）还是浮在右下角
watch(isVisible, (visible) => {
  store.setAnnotationOverlayVisible(visible);
}, { immediate: true });
onUnmounted(() => store.setAnnotationOverlayVisible(false));

const currentType = computed<AnnotationType | null>(() => {
  if (cloudTargetPicking.value) return 'cloud';
  switch (store.toolMode.value) {
    case 'annotation':
      return 'text';
    case 'annotation_cloud':
      return 'cloud';
    case 'annotation_rect':
      return 'rect';
    default:
      return currentAnnotation.value?.type ??
        (relatedAnnotations.value[0]?.type ?? null);
  }
});

const RELATED_TYPE_LABELS: Record<AnnotationType, string> = {
  text: '文字',
  cloud: '云线',
  rect: '矩形',
  obb: 'OBB',
};

const currentTypeRecords = computed(() => {
  if (!currentType.value) return [];
  return store.getAnnotationRecordsByType(currentType.value);
});

const currentTypeLabel = computed(() => {
  switch (currentType.value) {
    case 'text':
      return '文字批注';
    case 'cloud':
      return '云线批注';
    case 'rect':
      return '矩形批注';
    default:
      return '批注';
  }
});

const hasAnyAnnotations = computed(() => {
  return (
    store.annotations.value.length +
    store.cloudAnnotations.value.length +
    store.rectAnnotations.value.length
  ) > 0;
});

const hasHiddenAnnotations = computed(() => {
  return [
    ...store.annotations.value,
    ...store.cloudAnnotations.value,
    ...store.rectAnnotations.value,
  ].some((item) => !item.visible);
});

const currentTypeHasHidden = computed(() => {
  return currentTypeRecords.value.some((item) => !item.visible);
});

const currentTypeActionDisabled = computed(() => {
  return !currentType.value || currentTypeRecords.value.length === 0;
});

const currentActionDisabled = computed(() => !currentAnnotation.value);

const currentVisibilityLabel = computed(() => {
  return currentAnnotation.value?.record.visible ? '隐藏当前' : '显示当前';
});

const currentTypeVisibilityLabel = computed(() => {
  return currentTypeHasHidden.value ? '当前类型全部显示' : '当前类型全部隐藏';
});

const allVisibilityLabel = computed(() => {
  return hasHiddenAnnotations.value ? '全部显示' : '全部隐藏';
});

function setMode(mode: 'annotation' | 'annotation_cloud' | 'annotation_rect') {
  if (mode !== 'annotation_cloud' && cloudTargetPicking.value) {
    cloudTargetPicking.value = false;
    store.clearCloudTargetRefnos();
  }
  store.setToolMode(store.toolMode.value === mode ? 'none' : mode);
}

function resumeCloudCreation(refnos: string[] = []): void {
  if (refnos.length > 0) store.addCloudTargetRefnos(refnos);
  cloudTargetPicking.value = false;
  store.setToolMode('annotation_cloud');
}

function useCurrentCloudTargets(): void {
  store.addCloudTargetRefnos(props.tools.selectionStore?.selectedRefnos.value ?? []);
}

function getMatchedMemberRefnos(entry: RelatedAnnotationEntry): string[] {
  const selected = new Set(selectedModelRefnos.value);
  return getAnnotationMemberRefnos(entry.type, entry.record).filter((refno) => selected.has(refno));
}

/** 激活一条反查到的批注：只保留该类型的 active id、确保可见、飞到它。 */
function activateRelatedAnnotation(entry: RelatedAnnotationEntry): void {
  const { type, record } = entry;
  store.activeAnnotationId.value = type === 'text' ? record.id : null;
  store.activeCloudAnnotationId.value = type === 'cloud' ? record.id : null;
  store.activeRectAnnotationId.value = type === 'rect' ? record.id : null;
  store.activeObbAnnotationId.value = type === 'obb' ? record.id : null;
  switch (type) {
    case 'text':
      store.updateAnnotationVisible(record.id, true);
      props.tools.flyToAnnotation(record.id);
      return;
    case 'cloud':
      store.updateCloudAnnotationVisible(record.id, true);
      props.tools.flyToCloudAnnotation?.(record.id);
      return;
    case 'rect':
      store.updateRectAnnotationVisible(record.id, true);
      props.tools.flyToRectAnnotation?.(record.id);
      return;
    case 'obb':
      store.updateObbAnnotationVisible(record.id, true);
      props.tools.flyToObbAnnotation?.(record.id);
      return;
  }
}

/** 把当前选择层级翻译成拾取用的 noun 过滤：分支级上溯到 BRAN，元件级不过滤。 */
function cloudLevelNounFilter(): string[] {
  return store.cloudTargetLevel.value === 'branch' ? ['BRAN'] : [];
}

function startCloudTargetPick(mode: 'point' | 'box'): void {
  cloudTargetPicking.value = true;
  const start = mode === 'box' ? store.startBoxPickRefno : store.startPickRefno;
  start(cloudLevelNounFilter(), resumeCloudCreation, () => resumeCloudCreation());
}

// ==================== 云线三步向导 ====================

type CloudStepKey = 'target' | 'anchor' | 'outline';

const hasCloudTargets = computed(() => store.cloudTargetRefnos.value.length > 0);
const hasCloudAnchor = computed(() => !!props.tools.pendingCloudAnchor?.value);

/**
 * 画布正等着一次拖拽：云线锚点已就绪（下一步是拖轮廓）、矩形（OBB）框画、框选目标。
 * 这时栈底停靠的「待保存证据」要给画布让路——否则拖拽起点落在它上面会变成选中卡片里的文字，
 * 云线不出、也不报错（2026-09-21 真机复现，见 docs/verification/pms-3d-review-integration-e2e.md §5.1）。
 * 通过 footer 作用域插槽把这个状态交给停靠卡自己决定怎么让路。
 */
const canvasDragArmed = computed(() => {
  const mode = store.toolMode.value;
  if (mode === 'annotation_obb' || mode === 'pick_refno_box') return true;
  return mode === 'annotation_cloud' && hasCloudAnchor.value;
});

/**
 * “刚画完一条云线”的短暂完成态。画完后 useDtxTools 会立刻清空目标集合，
 * 三步向导会瞬间退回第 1 步，用户得不到任何“已创建”的反馈——这里补上闭环：
 * 检测云线数量增加 → 三步全绿 + 成功横幅 + 引导去保存，几秒后自动回到可继续绘制的空态。
 */
const justCreatedCloud = ref(false);
let justCreatedCloudTimer: ReturnType<typeof setTimeout> | null = null;
watch(
  () => store.cloudAnnotations.value.length,
  (next, prev) => {
    // 仅在云线创建上下文里、且数量确实增加时提示；避免“加载已有云线 / 删除云线”被误报为“刚创建”
    if (prev === undefined || next <= prev) return;
    if (!isCloudCreationContext.value) return;
    justCreatedCloud.value = true;
    lastCreatedCloudId.value = store.cloudAnnotations.value.at(-1)?.id ?? null;
    if (justCreatedCloudTimer) clearTimeout(justCreatedCloudTimer);
    justCreatedCloudTimer = setTimeout(() => {
      justCreatedCloud.value = false;
      justCreatedCloudTimer = null;
    }, 3500);
  },
);

// ==================== 第 3 步收尾：刚创建云线的错误类型 / 描述（审查项6） ====================

/**
 * Pencil 稿的第 3 步 = 画完后填错误类型 + 描述再保存，但主工具条的「错误类型」
 * 只对“当前选中批注”生效、描述又只能去场景内卡片或批注单里改——向导流程里没有
 * “第 3 步填写”的落点。这里把刚画完那条云线的详情表单内联进向导卡：
 * 从创建成功持续到用户开始选下一条的目标或退出云线上下文，期间随时可填。
 */
const lastCreatedCloudId = ref<string | null>(null);

watch(hasCloudTargets, (has) => {
  // 开始为下一条云线选目标：上一条的详情表单让位给向导主流程
  if (has) lastCreatedCloudId.value = null;
});
watch(isCloudCreationContext, (active) => {
  if (!active) lastCreatedCloudId.value = null;
});

const lastCreatedCloudRecord = computed(() => {
  const id = lastCreatedCloudId.value;
  if (!id) return null;
  return store.cloudAnnotations.value.find((r) => r.id === id) ?? null;
});

/** 详情表单可见：仍在云线上下文、这条云线还在（没被删）、且还没开始选下一条的目标 */
const showCloudDetailForm = computed(() => (
  isCloudCreationContext.value && !!lastCreatedCloudRecord.value && !hasCloudTargets.value
));

const lastCreatedSeverity = computed<AnnotationSeverity | undefined>(() => (
  (lastCreatedCloudRecord.value as { severity?: AnnotationSeverity } | null)?.severity
));

const canEditLastCreatedSeverity = computed<boolean>(() => {
  const rec = lastCreatedCloudRecord.value as { authorId?: string } | null;
  return !!rec && canEditAnnotationSeverity(userStore.currentUser.value, rec?.authorId);
});

async function setLastCreatedSeverity(next: AnnotationSeverity | undefined): Promise<void> {
  const rec = lastCreatedCloudRecord.value;
  if (!rec || !canEditLastCreatedSeverity.value) return;
  const task = reviewStore.currentTask.value;
  await saveAnnotationSeverity('cloud', rec.id, next, {
    formId: task?.formId ?? null,
    taskId: task?.id ?? null,
  });
}

/** 描述草稿本地编辑、失焦保存；只在换了另一条云线时重置，避免保存回写把正在输入的内容冲掉 */
const lastCreatedDescriptionDraft = ref('');
watch(() => lastCreatedCloudRecord.value?.id ?? null, (id) => {
  lastCreatedDescriptionDraft.value = id
    ? ((lastCreatedCloudRecord.value as { description?: string } | null)?.description ?? '')
    : '';
});

async function saveLastCreatedDescription(): Promise<void> {
  const rec = lastCreatedCloudRecord.value;
  if (!rec) return;
  const next = lastCreatedDescriptionDraft.value.trim();
  if (next === ((rec as { description?: string }).description ?? '').trim()) return;
  const task = reviewStore.currentTask.value;
  await saveAnnotationBasicFields('cloud', rec.id, { description: next }, {
    formId: task?.formId ?? null,
    taskId: task?.id ?? null,
  });
}

/**
 * 三步状态机在 useDtxTools 里是隐式的（目标集合 → 锚点 → 拖框），
 * 这里把它显式画出来，否则用户只能靠试错发现自己缺了哪一步。
 */
const cloudSteps = computed<{ key: CloudStepKey; index: number; label: string; done: boolean; active: boolean }[]>(() => {
  if (justCreatedCloud.value) {
    // 刚画完：三步全部标记完成，配合成功横幅给出明确的“这条已成”反馈
    return [
      { key: 'target', index: 1, label: '关联元素', done: true, active: false },
      { key: 'anchor', index: 2, label: '选锚点', done: true, active: false },
      { key: 'outline', index: 3, label: '画轮廓', done: true, active: false },
    ];
  }
  const targetDone = hasCloudTargets.value;
  const anchorDone = targetDone && hasCloudAnchor.value;
  return [
    { key: 'target', index: 1, label: '关联元素', done: targetDone, active: !targetDone },
    { key: 'anchor', index: 2, label: '选锚点', done: anchorDone, active: targetDone && !anchorDone },
    { key: 'outline', index: 3, label: '画轮廓', done: false, active: anchorDone },
  ];
});

/** 唯一文案源：工具层 statusText 已按模式给出完整指引，这里不再另写一套 */
const cloudHintText = computed(() => props.tools.statusText.value?.trim() || '');

/**
 * 顶部状态条。云线创建态下留空——那时向导条和提示行已经在讲同一件事，
 * 两处并排显示只会互相争抢注意力。批注条数不在这里重复，它属于右侧校审面板。
 */
const toolbarStatusText = computed(() => {
  if (isCloudCreationContext.value || !isAnnotationMode.value) return '';
  return cloudHintText.value;
});

const flashedCloudStep = ref<CloudStepKey | null>(null);
let flashTimer: ReturnType<typeof setTimeout> | null = null;

watch(
  () => props.tools.cloudGateBlock?.value?.at ?? null,
  (at) => {
    const block = props.tools.cloudGateBlock?.value;
    if (at === null || !block) return;
    flashedCloudStep.value = block.step;
    if (flashTimer) clearTimeout(flashTimer);
    flashTimer = setTimeout(() => {
      flashedCloudStep.value = null;
      flashTimer = null;
    }, 1400);
  },
);

function cloudStepClass(step: { key: CloudStepKey; done: boolean; active: boolean }): string {
  if (flashedCloudStep.value === step.key) return 'border-destructive bg-destructive/10 text-destructive animate-pulse';
  if (step.done) return 'border-success/40 bg-success/10 text-success';
  if (step.active) return 'border-primary bg-primary/10 text-primary';
  return 'border-border text-muted-foreground';
}

/** 回到第 2 步：只清锚点，保留已关联的目标元素 */
function stepBackToAnchor(): void {
  props.tools.clearPendingCloudAnchor?.();
}

/** noun 代码到中文名，便于用户直接看懂选中的是什么构件，而不是只看到参考号 */
const CLOUD_TARGET_NOUN_LABELS: Record<string, string> = {
  VALV: '阀门', BEND: '弯头', ELBO: '弯头', COUP: '管接', TEE: '三通',
  TUBI: '管段', PIPE: '管道', BRAN: '分支', HANG: '支吊架', FLAN: '法兰',
  ATTA: '附件', REDU: '异径管', GASK: '垫片', INST: '仪表', OLET: '支管台',
  PCOM: '元件', FTUB: '柔管', CAP: '管帽',
};

/** 选中构件的可读名称（中文类型）；查不到 noun 时回退到“构件”。 */
function cloudTargetName(refno: string): string {
  const noun = findNounByRefnoAcrossAllDbnos(refno);
  if (!noun) return '构件';
  return CLOUD_TARGET_NOUN_LABELS[noun.toUpperCase()] ?? noun;
}

/** 裸 refno 对用户没有意义，能查到 noun 就带上，便于核对选没选对（用于 tooltip / 定位提示） */
function cloudTargetLabel(refno: string): string {
  const noun = findNounByRefnoAcrossAllDbnos(refno);
  if (!noun) return refno;
  const zh = CLOUD_TARGET_NOUN_LABELS[noun.toUpperCase()] ?? noun;
  return `${zh} ${refno}`;
}

function locateCloudTarget(refno: string): void {
  props.tools.highlightAnnotationTarget?.(refno);
}

function openAnnotationPanel(): void {
  const currentTask = reviewStore.currentTask.value;
  const currentUser = userStore.currentUser.value;
  const shouldUseDesignerPanel = (
    currentUser?.role === UserRole.DESIGNER ||
    (currentTask ? isCanonicalReturnedTask(currentTask) : false)
  );

  if (currentAnnotation.value) {
    const record = currentAnnotation.value.record as { formId?: string } | null;
    setAnnotationProcessingEntryTarget({
      annotationId: currentAnnotation.value.id,
      annotationType: currentAnnotation.value.type,
      formId: record?.formId ?? currentTask?.formId ?? null,
    });
  }

  ensurePanelAndActivate(shouldUseDesignerPanel ? 'designerCommentHandling' : 'review');
}

function flyCurrent(): void {
  if (!currentAnnotation.value) return;
  switch (currentAnnotation.value.type) {
    case 'text':
      props.tools.flyToAnnotation(currentAnnotation.value.id);
      return;
    case 'cloud':
      props.tools.flyToCloudAnnotation?.(currentAnnotation.value.id);
      return;
    case 'rect':
      props.tools.flyToRectAnnotation?.(currentAnnotation.value.id);
      return;
    case 'obb':
      props.tools.flyToObbAnnotation?.(currentAnnotation.value.id);
  }
}

function toggleCurrentVisible(): void {
  if (!currentAnnotation.value) return;
  switch (currentAnnotation.value.type) {
    case 'text':
      store.updateAnnotationVisible(currentAnnotation.value.id, !currentAnnotation.value.record.visible);
      return;
    case 'cloud':
      store.updateCloudAnnotationVisible(currentAnnotation.value.id, !currentAnnotation.value.record.visible);
      return;
    case 'rect':
      store.updateRectAnnotationVisible(currentAnnotation.value.id, !currentAnnotation.value.record.visible);
      return;
    case 'obb':
      store.updateObbAnnotationVisible(currentAnnotation.value.id, !currentAnnotation.value.record.visible);
  }
}

function deleteCurrent(): void {
  if (!currentAnnotation.value) return;
  switch (currentAnnotation.value.type) {
    case 'text':
      props.tools.removeAnnotation(currentAnnotation.value.id);
      return;
    case 'cloud':
      if (props.tools.removeCloudAnnotation) {
        props.tools.removeCloudAnnotation(currentAnnotation.value.id);
      } else {
        store.removeCloudAnnotation(currentAnnotation.value.id);
      }
      return;
    case 'rect':
      if (props.tools.removeRectAnnotation) {
        props.tools.removeRectAnnotation(currentAnnotation.value.id);
      } else {
        store.removeRectAnnotation(currentAnnotation.value.id);
      }
      return;
    case 'obb':
      if (props.tools.removeObbAnnotation) {
        props.tools.removeObbAnnotation(currentAnnotation.value.id);
      } else {
        store.removeObbAnnotation(currentAnnotation.value.id);
      }
  }
}

function toggleCurrentTypeVisible(): void {
  if (!currentType.value || currentTypeRecords.value.length === 0) return;
  store.setAnnotationTypeVisible(currentType.value, currentTypeHasHidden.value);
}

function clearCurrentType(): void {
  if (!currentType.value) return;
  store.clearAnnotationType(currentType.value);
}

function toggleAllVisible(): void {
  if (!hasAnyAnnotations.value) return;
  store.setAllAnnotationsVisible(hasHiddenAnnotations.value);
}

function clearAll(): void {
  store.clearAllAnnotations();
}

// ==================== 严重度 ====================

const userStore = useUserStore();

const SEVERITY_QUICK_BUCKETS: { key: AnnotationSeverity; label: string; dotClass: string }[] = [
  { key: 'principle', label: '原则错误 ×', dotClass: 'bg-red-500' },
  { key: 'general', label: '一般错误 △', dotClass: 'bg-orange-500' },
  { key: 'drawing', label: '图面错误 ○', dotClass: 'bg-blue-500' },
];

/** 当前选中批注的严重度（undefined 表示未设置） */
const currentSeverity = computed<AnnotationSeverity | undefined>(() => {
  return (currentAnnotation.value?.record as { severity?: AnnotationSeverity } | null)?.severity;
});

/** 当前选中批注是否允许当前用户改严重度 */
const canEditCurrentSeverity = computed<boolean>(() => {
  const rec = currentAnnotation.value?.record as { authorId?: string } | null;
  return !!currentAnnotation.value && canEditAnnotationSeverity(userStore.currentUser.value, rec?.authorId);
});

/** 当前类型中允许当前用户批量改严重度的记录数（用于按钮状态/提示） */
const currentTypeEditableCount = computed<number>(() => {
  const user = userStore.currentUser.value;
  if (!user) return 0;
  return currentTypeRecords.value.filter((r) => canEditAnnotationSeverity(user, (r as { authorId?: string }).authorId)).length;
});

const batchActionDisabled = computed<boolean>(() => {
  if (currentTypeActionDisabled.value) return true;
  return currentTypeEditableCount.value === 0;
});

async function setCurrentSeverity(next: AnnotationSeverity | undefined): Promise<void> {
  const ctx = currentAnnotation.value;
  if (!ctx) return;
  if (!canEditCurrentSeverity.value) return;
  const task = reviewStore.currentTask.value;
  await saveAnnotationSeverity(ctx.type, ctx.id, next, {
    formId: task?.formId ?? null,
    taskId: task?.id ?? null,
  });
}

async function batchSetCurrentTypeSeverity(next: AnnotationSeverity | undefined): Promise<void> {
  const type = currentType.value;
  if (!type) return;
  const user = userStore.currentUser.value;
  if (!user) return;
  const task = reviewStore.currentTask.value;
  const ctx = {
    formId: task?.formId ?? null,
    taskId: task?.id ?? null,
  };
  const records = store.getAnnotationRecordsByType(type);
  const editableIds = records
    .filter((r) => canEditAnnotationSeverity(user, (r as { authorId?: string }).authorId))
    .map((r) => (r as { id: string }).id);
  // 串行 await 避免触发并发提示风暴；批量入口本就低频。
  for (const id of editableIds) {
    await saveAnnotationSeverity(type, id, next, ctx);
  }
}

function exitAnnotation(): void {
  cloudTargetPicking.value = false;
  store.setToolMode('none');
}

function toggleDrawer(): void {
  drawerOpen.value = !drawerOpen.value;
  if (drawerOpen.value) severityMenuOpen.value = false;
}

function closeDrawer(): void {
  drawerOpen.value = false;
}

function toggleSeverityMenu(): void {
  if (!canEditCurrentSeverity.value) return;
  severityMenuOpen.value = !severityMenuOpen.value;
  if (severityMenuOpen.value) drawerOpen.value = false;
}

function closeSeverityMenu(): void {
  severityMenuOpen.value = false;
}

async function pickSeverityFromMenu(next: AnnotationSeverity | undefined): Promise<void> {
  closeSeverityMenu();
  await setCurrentSeverity(next);
}

function ensureOverlayOffsetFromDom(): { x: number; y: number } {
  const el = overlayRootRef.value;
  if (!el) return { x: 16, y: 16 };
  const rect = el.getBoundingClientRect();
  return { x: rect.left, y: rect.top };
}

function persistOverlayOffset(): void {
  if (!overlayOffset.value) return;
  try {
    sessionStorage.setItem(OVERLAY_POS_STORAGE_KEY, JSON.stringify(overlayOffset.value));
  } catch {
    // ignore quota / private mode
  }
}

function onDragHandlePointerDown(event: PointerEvent): void {
  if (event.button !== 0) return;
  const pos = overlayOffset.value ?? ensureOverlayOffsetFromDom();
  overlayOffset.value = pos;
  dragState.value = {
    startX: event.clientX,
    startY: event.clientY,
    originX: pos.x,
    originY: pos.y,
  };
  (event.currentTarget as HTMLElement | null)?.setPointerCapture(event.pointerId);
  event.preventDefault();
}

function onDragPointerMove(event: PointerEvent): void {
  if (!dragState.value) return;
  const dx = event.clientX - dragState.value.startX;
  const dy = event.clientY - dragState.value.startY;
  const maxX = Math.max(8, window.innerWidth - 120);
  const maxY = Math.max(8, window.innerHeight - 48);
  overlayOffset.value = {
    x: Math.min(maxX, Math.max(8, dragState.value.originX + dx)),
    y: Math.min(maxY, Math.max(8, dragState.value.originY + dy)),
  };
}

function endDrag(): void {
  if (!dragState.value) return;
  dragState.value = null;
  persistOverlayOffset();
}

function handleClickOutside(event: PointerEvent): void {
  const target = event.target as Node;
  if (severityMenuOpen.value) {
    if (!severityMenuRef.value?.contains(target) && !severityTriggerRef.value?.contains(target)) {
      closeSeverityMenu();
    }
  }
  if (!drawerOpen.value) return;
  if (drawerRef.value?.contains(target)) return;
  if (triggerRef.value?.contains(target)) return;
  closeDrawer();
}

function consumeEscape(event: KeyboardEvent): void {
  event.preventDefault();
  event.stopImmediatePropagation();
}

/**
 * Esc 分层退出：弹层 → 拾取子模式 → 云线创建步骤 → 批注工具，一次按键只退一层。
 * 每层都吞掉事件，否则同一次按键会穿透到 ViewerPanel 的全局 Esc，一次退两层。
 *
 * 云线那一层与 ViewerPanel 调的是工具层同一个函数：两处监听都挂在 window 上，
 * 注册先后取决于挂载时序，谁先跑都只回退一步，且都吞事件挡住另一处。
 */
function handleWindowKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return;

  if (severityMenuOpen.value) {
    consumeEscape(event);
    closeSeverityMenu();
    return;
  }
  if (drawerOpen.value) {
    consumeEscape(event);
    closeDrawer();
    return;
  }
  if (cloudTargetPicking.value) {
    consumeEscape(event);
    store.cancelPickRefno();
    return;
  }
  if (!isAnnotationMode.value) return;

  const target = event.target as HTMLElement | null;
  const tag = target?.tagName?.toLowerCase() ?? '';
  const isEditable =
    tag === 'input' ||
    tag === 'textarea' ||
    tag === 'select' ||
    target?.isContentEditable === true;
  if (isEditable) return;

  if (props.tools.rollbackCloudCreationStep?.()) {
    consumeEscape(event);
    return;
  }

  consumeEscape(event);
  exitAnnotation();
}

watch(
  () => [
    store.annotations.value.length,
    store.cloudAnnotations.value.length,
    store.rectAnnotations.value.length,
  ],
  () => {
    if (currentAnnotation.value) return;
    if (!hasAnyAnnotations.value) {
      store.activeAnnotationId.value = null;
      store.activeCloudAnnotationId.value = null;
      store.activeRectAnnotationId.value = null;
    }
  },
);

onMounted(() => {
  try {
    const raw = sessionStorage.getItem(OVERLAY_POS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { x?: number; y?: number };
      if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
        overlayOffset.value = { x: parsed.x, y: parsed.y };
      }
    }
  } catch {
    // ignore corrupt storage
  }
  window.addEventListener('keydown', handleWindowKeydown);
  document.addEventListener('pointerdown', handleClickOutside);
  window.addEventListener('pointermove', onDragPointerMove);
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);
});

onUnmounted(() => {
  if (flashTimer) clearTimeout(flashTimer);
  if (justCreatedCloudTimer) clearTimeout(justCreatedCloudTimer);
  window.removeEventListener('keydown', handleWindowKeydown);
  document.removeEventListener('pointerdown', handleClickOutside);
  window.removeEventListener('pointermove', onDragPointerMove);
  window.removeEventListener('pointerup', endDrag);
  window.removeEventListener('pointercancel', endDrag);
});
</script>

<template>
  <div v-if="isVisible"
    ref="overlayRootRef"
    data-testid="annotation-overlay-root"
    class="pointer-events-none fixed z-[940] flex justify-end"
    :class="hasCustomOverlayPosition ? '' : 'right-4 top-4'"
    :style="overlayPositionStyle">
    <!-- 栈容器本身不接 pointer 事件，只由各张卡片自己接：这样某张卡（如画布等拖拽时的停靠「待保存证据」）
         放行 pointer-events 后，事件能一路穿到底下的画布，而不是被容器兜住；卡片上的事件仍会冒泡到这里被 .stop -->
    <div class="pointer-events-none flex max-h-[calc(100vh-2rem)] flex-col items-end gap-2"
      @pointerdown.stop
      @wheel.stop>
      <!-- 卡片内容区：多卡叠加超出视口时在内部滚动，避免小屏把底部“待保存证据”卡顶出屏幕（审查风险4） -->
      <div v-if="toolbarStatusText || relatedAnnotations.length > 0 || isCloudCreationContext"
        data-testid="annotation-overlay-scroll"
        class="pointer-events-auto flex min-h-0 flex-col items-end gap-2 overflow-y-auto overflow-x-hidden pr-0.5">
        <!-- 当前工具与操作指引（条数属于右侧校审面板，这里不重复） -->
        <div v-if="toolbarStatusText"
          data-testid="annotation-overlay-status"
          class="hidden max-w-[min(34rem,calc(100vw-2rem))] items-center gap-1.5 rounded-lg border border-border bg-muted/50 px-2.5 py-1 text-[11px] text-muted-foreground md:flex">
          <span class="shrink-0 font-medium text-foreground">{{ currentTypeLabel }}</span>
          <span class="shrink-0 opacity-40">·</span>
          <span class="truncate">{{ toolbarStatusText }}；Esc 退出</span>
        </div>

        <!-- 反查覆盖四类批注（ADR-0049）；data-testid 沿用 annotation-related-cloud* 旧名，避免既有用例改名 -->
        <div v-if="relatedAnnotations.length > 0"
          data-testid="annotation-related-clouds"
          class="w-[min(34rem,calc(100vw-2rem))] rounded-xl border border-border bg-background/95 p-2.5 shadow-lg backdrop-blur">
          <div class="mb-2 flex items-center justify-between gap-2">
            <span class="text-xs font-semibold">当前模型关联批注</span>
            <span class="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] text-primary">
              {{ relatedAnnotations.length }} 条
            </span>
          </div>
          <div class="max-h-40 space-y-1 overflow-auto">
            <button v-for="entry in relatedAnnotations"
              :key="`${entry.type}:${entry.record.id}`"
              type="button"
              :data-testid="`annotation-related-cloud-${entry.record.id}`"
              :data-annotation-type="entry.type"
              class="flex w-full items-center gap-2 rounded-lg border border-transparent px-2 py-1.5 text-left hover:border-border hover:bg-muted"
              :title="`定位并查看 ${entry.record.title || '未命名批注'}`"
              @click="activateRelatedAnnotation(entry)">
              <Cloud class="h-3.5 w-3.5 shrink-0 text-primary" />
              <span class="min-w-0 flex-1">
                <span class="block truncate text-xs font-medium">
                  <span class="mr-1 rounded bg-muted px-1 text-[10px] text-muted-foreground">{{ RELATED_TYPE_LABELS[entry.type] }}</span>{{ entry.record.title || '未命名批注' }}
                </span>
                <span class="block truncate font-mono text-[10px] text-muted-foreground">
                  {{ getMatchedMemberRefnos(entry).join('、') }}
                </span>
              </span>
              <Focus class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            </button>
          </div>
        </div>

        <div v-if="isCloudCreationContext"
          data-testid="annotation-cloud-targets"
          class="w-fit min-w-[22rem] max-w-[min(34rem,calc(100vw-2rem))] rounded-xl border border-border bg-background/95 p-2.5 shadow-lg backdrop-blur">
          <!-- 三步向导：把隐式状态机显式化 -->
          <div data-testid="annotation-cloud-stepper" class="mb-2 flex items-center gap-1">
            <template v-for="(step, i) in cloudSteps" :key="step.key">
              <div :data-testid="`annotation-cloud-step-${step.key}`"
                :data-state="step.done ? 'done' : step.active ? 'active' : 'todo'"
                class="inline-flex items-center gap-1 rounded-md border px-1.5 py-1 text-[11px] font-medium transition-colors"
                :class="cloudStepClass(step)">
                <Check v-if="step.done" class="h-3 w-3 shrink-0" />
                <span v-else class="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border text-[9px] leading-none">
                  {{ step.index }}
                </span>
                <span>{{ step.label }}</span>
              </div>
              <ChevronRight v-if="i < cloudSteps.length - 1" class="h-3 w-3 shrink-0 text-muted-foreground/50" />
            </template>
            <button v-if="hasCloudAnchor && !justCreatedCloud"
              type="button"
              data-testid="annotation-cloud-step-back"
              class="ml-auto rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
              title="清除锚点，回到第 2 步重新选"
              @click="stepBackToAnchor">
              重选锚点
            </button>
          </div>

          <!-- 刚画完一条云线的成功反馈：补齐“画完 → 确认 → 保存”闭环，避免用户误以为没成功 -->
          <div v-if="justCreatedCloud"
            data-testid="annotation-cloud-created"
            class="mb-2 flex items-start gap-1.5 rounded-lg border border-success/40 bg-success/10 px-2.5 py-1.5 text-[11px] text-success">
            <Check class="mt-px h-3.5 w-3.5 shrink-0" />
            <span>云线已创建（共 {{ store.cloudAnnotations.value.length }} 条）。请在下方填写错误类型与描述，再到「待保存证据」保存。</span>
          </div>

          <!-- 第 3 步收尾（审查项6）：错误类型 + 描述直接在向导卡里填，不必先去场景里点选云线 -->
          <div v-if="showCloudDetailForm"
            data-testid="annotation-cloud-detail-form"
            class="mb-2 rounded-lg border border-border bg-muted/30 p-2">
            <div class="mb-1.5 flex items-center justify-between gap-2">
              <span class="text-[11px] font-semibold">刚创建云线的详情</span>
              <span class="truncate font-mono text-[10px] text-muted-foreground">{{ lastCreatedCloudId }}</span>
            </div>
            <div class="flex flex-wrap items-center gap-1" data-testid="annotation-cloud-detail-severity">
              <span class="mr-0.5 text-[11px] text-muted-foreground">错误类型</span>
              <button v-for="bucket in SEVERITY_QUICK_BUCKETS"
                :key="bucket.key"
                type="button"
                :data-testid="'annotation-cloud-detail-severity-' + bucket.key"
                class="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                :class="lastCreatedSeverity === bucket.key
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-input text-muted-foreground hover:bg-muted hover:text-foreground'"
                :disabled="!canEditLastCreatedSeverity"
                @click="setLastCreatedSeverity(bucket.key)">
                <span class="h-2 w-2 rounded-full" :class="bucket.dotClass" />
                <span>{{ bucket.label }}</span>
              </button>
              <button v-if="lastCreatedSeverity"
                type="button"
                data-testid="annotation-cloud-detail-severity-clear"
                class="rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
                @click="setLastCreatedSeverity(undefined)">
                清除
              </button>
            </div>
            <textarea v-model="lastCreatedDescriptionDraft"
              data-testid="annotation-cloud-detail-description"
              rows="2"
              placeholder="描述（选填）：这条云线标记了什么问题…"
              class="mt-1.5 w-full resize-none rounded-md border border-input bg-background px-2 py-1 text-xs outline-none placeholder:text-muted-foreground/60 focus:border-primary"
              @blur="saveLastCreatedDescription" />
            <p class="mt-1 text-[10px] text-muted-foreground">填完到下方「待保存证据」保存；也可直接继续选目标画下一条。</p>
          </div>

          <!-- 选择层级：控制点选/框选拿到的是单个元件还是整条分支（对应问题 2/4） -->
          <div class="mb-2 flex flex-wrap items-center gap-2" data-testid="annotation-cloud-level">
            <span class="text-[11px] font-medium text-muted-foreground">选择层级</span>
            <div class="inline-flex overflow-hidden rounded-md border border-input">
              <button type="button"
                data-testid="annotation-cloud-level-element"
                class="px-2 py-1 text-[11px] transition-colors"
                :class="store.cloudTargetLevel.value === 'element'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted'"
                @click="store.setCloudTargetLevel('element')">
                元件
              </button>
              <button type="button"
                data-testid="annotation-cloud-level-branch"
                class="border-l border-input px-2 py-1 text-[11px] transition-colors"
                :class="store.cloudTargetLevel.value === 'branch'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted'"
                @click="store.setCloudTargetLevel('branch')">
                分支
              </button>
            </div>
            <span class="text-[10px] text-muted-foreground">
              {{ store.cloudTargetLevel.value === 'branch' ? '点选 / 框选上溯到整条 BRAN' : '可选到单个元件（COUP / BEND / VALV…）' }}
            </span>
          </div>

          <div class="flex flex-wrap items-center gap-1.5">
            <span class="mr-1 text-xs font-semibold">关联元素 {{ store.cloudTargetRefnos.value.length }}</span>
            <button type="button"
              data-testid="annotation-cloud-target-current"
              class="rounded-md border border-input px-2 py-1 text-[11px] hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
              :disabled="(props.tools.selectionStore?.selectedRefnos.value.length ?? 0) === 0"
              @click="useCurrentCloudTargets">
              使用当前选择
            </button>
            <button type="button"
              data-testid="annotation-cloud-target-pick"
              class="rounded-md border border-input px-2 py-1 text-[11px] hover:bg-muted"
              @click="startCloudTargetPick('point')">
              点选目标
            </button>
            <button type="button"
              data-testid="annotation-cloud-target-box"
              class="rounded-md border border-input px-2 py-1 text-[11px] hover:bg-muted"
              @click="startCloudTargetPick('box')">
              框选目标
            </button>
            <button type="button"
              data-testid="annotation-cloud-target-clear"
              class="ml-auto rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
              :disabled="store.cloudTargetRefnos.value.length === 0"
              @click="store.clearCloudTargetRefnos">
              清空
            </button>
          </div>
          <div v-if="store.cloudTargetRefnos.value.length > 0" class="mt-2 flex max-h-24 flex-wrap gap-1 overflow-auto">
            <span v-for="refno in store.cloudTargetRefnos.value"
              :key="refno"
              class="inline-flex max-w-full items-center gap-1 rounded-md bg-primary/10 py-1 pl-2 pr-0.5 text-primary">
              <button type="button"
                :data-testid="`annotation-cloud-target-locate-${refno}`"
                class="flex max-w-[15rem] items-center gap-1.5 rounded hover:underline"
                :title="`定位到 ${cloudTargetLabel(refno)}`"
                @click="locateCloudTarget(refno)">
                <span class="shrink-0 text-[11px] font-medium">{{ cloudTargetName(refno) }}</span>
                <span class="truncate font-mono text-[10px] text-primary/60">{{ refno }}</span>
              </button>
              <button type="button"
                :data-testid="`annotation-cloud-target-remove-${refno}`"
                class="rounded p-0.5 hover:bg-primary/15"
                :aria-label="`移除 ${refno}`"
                @click="store.removeCloudTargetRefno(refno)">
                <X class="h-3 w-3" />
              </button>
            </span>
          </div>
          <p v-if="cloudHintText && !justCreatedCloud"
            data-testid="annotation-cloud-hint"
            class="mt-2 text-[11px]"
            :class="hasCloudTargets ? 'text-muted-foreground' : 'text-amber-600'">
            {{ cloudHintText }}；Esc {{ cloudTargetPicking ? '返回云线工具' : '退出云线批注' }}
          </p>
        </div>
      </div>

      <!-- 主工具栏（跟随主题色，可拖拽；固定在栈底不随卡片区滚动，抽屉/错误类型菜单不会被裁剪） -->
      <div class="pointer-events-auto relative flex items-center gap-1 rounded-xl border border-border bg-background/90 px-2 py-1.5 shadow-lg backdrop-blur"
        data-testid="annotation-overlay-bar">
        <button type="button"
          data-testid="annotation-overlay-drag-handle"
          class="inline-flex h-8 w-6 cursor-grab items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:cursor-grabbing"
          title="拖动工具栏"
          aria-label="拖动工具栏"
          @pointerdown.stop="onDragHandlePointerDown">
          <GripVertical class="h-3.5 w-3.5" />
        </button>

        <div class="mx-0.5 h-4 w-px bg-border" />

        <!-- 批注模式切换组 -->
        <button type="button"
          data-testid="annotation-overlay-mode-text"
          class="inline-flex h-8 w-8 items-center justify-center rounded-lg text-sm transition-colors"
          :class="store.toolMode.value === 'annotation'
            ? 'bg-primary/10 text-primary shadow-sm ring-1 ring-primary/20'
            : 'text-muted-foreground hover:bg-muted hover:text-foreground'"
          title="文字批注"
          aria-label="文字批注"
          @click="setMode('annotation')">
          <Type class="h-3.5 w-3.5" />
        </button>

        <button type="button"
          data-testid="annotation-overlay-mode-cloud"
          class="inline-flex h-8 w-8 items-center justify-center rounded-lg text-sm transition-colors"
          :class="store.toolMode.value === 'annotation_cloud'
            ? 'bg-primary/10 text-primary shadow-sm ring-1 ring-primary/20'
            : 'text-muted-foreground hover:bg-muted hover:text-foreground'"
          title="云线批注"
          aria-label="云线批注"
          @click="setMode('annotation_cloud')">
          <Cloud class="h-3.5 w-3.5" />
        </button>

        <button type="button"
          data-testid="annotation-overlay-mode-rect"
          class="inline-flex h-8 w-8 items-center justify-center rounded-lg text-sm transition-colors"
          :class="store.toolMode.value === 'annotation_rect'
            ? 'bg-primary/10 text-primary shadow-sm ring-1 ring-primary/20'
            : 'text-muted-foreground hover:bg-muted hover:text-foreground'"
          title="矩形批注"
          aria-label="矩形批注"
          @click="setMode('annotation_rect')">
          <RectangleHorizontal class="h-3.5 w-3.5" />
        </button>

        <!-- 颜色选择器 -->
        <AnnotationColorPicker v-model="selectedAnnotationColor" />

        <!-- 当前批注错误类型：向下弹出，避免被画布/面板遮挡 -->
        <template v-if="currentAnnotation">
          <div class="mx-0.5 h-4 w-px bg-border" />
          <div data-testid="annotation-overlay-toolbar-severity"
            class="relative"
            :class="!canEditCurrentSeverity ? 'opacity-40' : ''">
            <button ref="severityTriggerRef"
              type="button"
              data-testid="annotation-overlay-toolbar-severity-trigger"
              class="inline-flex h-8 max-w-[7.5rem] items-center gap-1 rounded-lg border border-input bg-background px-2 text-[11px] font-medium transition-colors hover:bg-muted disabled:pointer-events-none"
              :disabled="!canEditCurrentSeverity"
              :title="canEditCurrentSeverity ? '选择错误类型' : '当前角色不可修改错误类型'"
              @click.stop="toggleSeverityMenu">
              <span v-if="currentSeverity"
                class="truncate"
                :class="getAnnotationSeverityDisplay(currentSeverity).color + ' rounded px-1'">
                {{ getAnnotationSeverityDisplay(currentSeverity).symbol }}
                {{ getAnnotationSeverityDisplay(currentSeverity).label }}
              </span>
              <span v-else class="truncate text-muted-foreground">错误类型</span>
              <ChevronDown class="h-3 w-3 shrink-0 opacity-60"
                :class="severityMenuOpen ? 'rotate-180' : ''" />
            </button>
            <Transition enter-active-class="transition duration-150 ease-out"
              enter-from-class="-translate-y-1 scale-95 opacity-0"
              enter-to-class="translate-y-0 scale-100 opacity-100"
              leave-active-class="transition duration-100 ease-in"
              leave-from-class="translate-y-0 scale-100 opacity-100"
              leave-to-class="-translate-y-1 scale-95 opacity-0">
              <div v-if="severityMenuOpen"
                ref="severityMenuRef"
                data-testid="annotation-overlay-toolbar-severity-menu"
                class="absolute left-0 top-full z-[960] mt-1 min-w-[9.5rem] overflow-hidden rounded-lg border border-border bg-background/98 py-1 shadow-xl backdrop-blur"
                @pointerdown.stop>
                <button v-for="bucket in SEVERITY_QUICK_BUCKETS"
                  :key="bucket.key"
                  type="button"
                  :data-testid="'annotation-overlay-toolbar-severity-' + bucket.key"
                  class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-muted"
                  :class="currentSeverity === bucket.key ? 'bg-primary/10 text-primary' : 'text-foreground'"
                  @click="pickSeverityFromMenu(bucket.key)">
                  <span class="inline-block h-2 w-2 rounded-full" :class="bucket.dotClass" />
                  <span>{{ bucket.label }}</span>
                </button>
                <button type="button"
                  data-testid="annotation-overlay-toolbar-severity-clear"
                  class="flex w-full items-center gap-2 border-t border-border px-3 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-40"
                  :disabled="!currentSeverity"
                  @click="pickSeverityFromMenu(undefined)">
                  清除错误类型
                </button>
              </div>
            </Transition>
          </div>
        </template>

        <div class="mx-0.5 h-4 w-px bg-border" />

        <!-- 更多操作触发器 -->
        <button ref="triggerRef"
          type="button"
          data-testid="annotation-overlay-more"
          class="inline-flex h-8 w-8 items-center justify-center rounded-lg text-sm transition-colors"
          :class="drawerOpen
            ? 'bg-muted text-foreground'
            : 'text-muted-foreground hover:bg-muted hover:text-foreground'"
          title="更多操作"
          aria-label="更多操作"
          @click="toggleDrawer">
          <MoreHorizontal class="h-3.5 w-3.5" />
        </button>

        <div class="mx-0.5 h-4 w-px bg-border" />

        <!-- 打开批注单：此处只做跳转，落库在校审面板的「确认当前数据」 -->
        <button type="button"
          data-testid="annotation-overlay-details-toggle"
          class="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
          title="打开批注单（保存请在校审面板确认当前数据）"
          aria-label="打开批注单"
          @click="openAnnotationPanel">
          <PanelRightOpen class="h-3.5 w-3.5" />
          <span>打开批注单</span>
        </button>

        <!-- 抽屉弹出菜单 (向上) -->
        <Transition enter-active-class="transition duration-150 ease-out"
          enter-from-class="translate-y-2 scale-95 opacity-0"
          enter-to-class="translate-y-0 scale-100 opacity-100"
          leave-active-class="transition duration-100 ease-in"
          leave-from-class="translate-y-0 scale-100 opacity-100"
          leave-to-class="translate-y-2 scale-95 opacity-0">
          <div v-if="drawerOpen"
            ref="drawerRef"
            data-testid="annotation-overlay-drawer"
            class="absolute bottom-full right-0 mb-2 min-w-[180px] overflow-hidden rounded-xl border border-border bg-background/95 shadow-xl backdrop-blur">
            <!-- 当前批注操作 -->
            <div class="border-b border-border px-3 pb-1 pt-2">
              <div class="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">当前批注</div>
              <button type="button"
                data-testid="annotation-overlay-fly-current"
                class="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-xs transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-40"
                :disabled="currentActionDisabled"
                title="定位当前"
                aria-label="定位当前"
                @click="flyCurrent">
                <Focus class="h-3.5 w-3.5 shrink-0" />
                <span>定位当前</span>
              </button>
              <button type="button"
                data-testid="annotation-overlay-current-visibility"
                class="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-xs transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-40"
                :disabled="currentActionDisabled"
                :title="currentVisibilityLabel"
                :aria-label="currentVisibilityLabel"
                @click="toggleCurrentVisible">
                <component :is="currentAnnotation?.record.visible ? EyeOff : Eye" class="h-3.5 w-3.5 shrink-0" />
                <span>{{ currentVisibilityLabel }}</span>
              </button>
              <button type="button"
                data-testid="annotation-overlay-delete-current"
                class="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-xs text-destructive transition-colors hover:bg-destructive/10 disabled:pointer-events-none disabled:opacity-40"
                :disabled="currentActionDisabled"
                title="删除当前"
                aria-label="删除当前"
                @click="deleteCurrent">
                <Trash2 class="h-3.5 w-3.5 shrink-0" />
                <span>删除当前</span>
              </button>

              <!-- 当前批注严重度快捷 -->
              <div data-testid="annotation-overlay-current-severity"
                class="mt-1 rounded-lg border border-dashed border-border/60 px-2 py-1.5"
                :class="currentActionDisabled ? 'opacity-40' : ''">
                <div class="mb-1 flex items-center justify-between text-[10px] text-muted-foreground">
                  <span>错误类型</span>
                  <span v-if="currentSeverity" class="font-medium"
                    :class="getAnnotationSeverityDisplay(currentSeverity).color + ' border rounded px-1'">
                    {{ getAnnotationSeverityDisplay(currentSeverity).symbol }} {{ getAnnotationSeverityDisplay(currentSeverity).label }}
                  </span>
                  <span v-else>未设置</span>
                </div>
                <div class="flex gap-1">
                  <button v-for="bucket in SEVERITY_QUICK_BUCKETS"
                    :key="bucket.key"
                    type="button"
                    :data-testid="'annotation-overlay-severity-' + bucket.key"
                    class="inline-flex flex-1 items-center justify-center gap-1 rounded border px-1 py-0.5 text-[10px] transition-colors disabled:pointer-events-none disabled:opacity-40"
                    :class="currentSeverity === bucket.key ? 'border-primary bg-primary/10 text-primary' : 'border-input hover:bg-muted'"
                    :disabled="!canEditCurrentSeverity"
                    :title="bucket.label"
                    @click="setCurrentSeverity(bucket.key)">
                    <span class="inline-block h-1.5 w-1.5 rounded-full" :class="bucket.dotClass" />
                    {{ bucket.label }}
                  </button>
                  <button type="button"
                    data-testid="annotation-overlay-severity-clear"
                    class="inline-flex items-center justify-center rounded border border-input px-1 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-40"
                    :disabled="!canEditCurrentSeverity || !currentSeverity"
                    title="清除错误类型"
                    @click="setCurrentSeverity(undefined)">
                    ✕
                  </button>
                </div>
              </div>
            </div>

            <!-- 批量操作 -->
            <div class="px-3 pb-2 pt-1">
              <div class="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">批量操作</div>
              <button type="button"
                data-testid="annotation-overlay-type-visibility"
                class="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-xs transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-40"
                :disabled="currentTypeActionDisabled"
                :title="currentTypeVisibilityLabel"
                :aria-label="currentTypeVisibilityLabel"
                @click="toggleCurrentTypeVisible">
                <component :is="currentTypeHasHidden ? Eye : EyeOff" class="h-3.5 w-3.5 shrink-0" />
                <span>{{ currentTypeVisibilityLabel }}</span>
              </button>
              <button type="button"
                data-testid="annotation-overlay-type-clear"
                class="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-xs text-destructive transition-colors hover:bg-destructive/10 disabled:pointer-events-none disabled:opacity-40"
                :disabled="currentTypeActionDisabled"
                title="清空当前类型"
                aria-label="清空当前类型"
                @click="clearCurrentType">
                <Trash2 class="h-3.5 w-3.5 shrink-0" />
                <span>清空当前类型</span>
              </button>
              <button type="button"
                data-testid="annotation-overlay-all-visibility"
                class="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-xs transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-40"
                :disabled="!hasAnyAnnotations"
                :title="allVisibilityLabel"
                :aria-label="allVisibilityLabel"
                @click="toggleAllVisible">
                <component :is="hasHiddenAnnotations ? Eye : EyeOff" class="h-3.5 w-3.5 shrink-0" />
                <span>{{ allVisibilityLabel }}</span>
              </button>
              <button type="button"
                data-testid="annotation-overlay-clear-all"
                class="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-xs text-destructive transition-colors hover:bg-destructive/10 disabled:pointer-events-none disabled:opacity-40"
                :disabled="!hasAnyAnnotations"
                title="清空全部批注"
                aria-label="清空全部批注"
                @click="clearAll">
                <Trash class="h-3.5 w-3.5 shrink-0" />
                <span>清空全部批注</span>
              </button>

              <!-- 当前类型批量严重度 -->
              <div data-testid="annotation-overlay-batch-severity"
                class="mt-1 rounded-lg border border-dashed border-border/60 px-2 py-1.5"
                :class="batchActionDisabled ? 'opacity-40' : ''">
                <div class="mb-1 flex items-center justify-between text-[10px] text-muted-foreground">
                  <span>当前类型批量错误类型</span>
                  <span class="font-medium">可改 {{ currentTypeEditableCount }}/{{ currentTypeRecords.length }}</span>
                </div>
                <div class="flex gap-1">
                  <button v-for="bucket in SEVERITY_QUICK_BUCKETS"
                    :key="bucket.key"
                    type="button"
                    :data-testid="'annotation-overlay-batch-severity-' + bucket.key"
                    class="inline-flex flex-1 items-center justify-center gap-1 rounded border border-input px-1 py-0.5 text-[10px] transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-40"
                    :disabled="batchActionDisabled"
                    :title="'批量设为' + bucket.label"
                    @click="batchSetCurrentTypeSeverity(bucket.key)">
                    <span class="inline-block h-1.5 w-1.5 rounded-full" :class="bucket.dotClass" />
                    {{ bucket.label }}
                  </button>
                  <button type="button"
                    data-testid="annotation-overlay-batch-severity-clear"
                    class="inline-flex items-center justify-center rounded border border-input px-1 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-40"
                    :disabled="batchActionDisabled"
                    title="批量清除错误类型"
                    @click="batchSetCurrentTypeSeverity(undefined)">
                    ✕
                  </button>
                </div>
              </div>
            </div>
          </div>
        </Transition>
      </div>

      <!-- 栈底停靠位：批注上下文中由 ViewerPanel 注入「待保存证据」面板，避免右上/右下两处浮层重叠。
           画布等拖拽（canvasDragArmed）时整块放行 pointer 事件，拖拽落到底下的画布上；停靠卡按插槽参数自行降级显示 -->
      <div v-if="$slots.footer"
        data-testid="annotation-overlay-footer"
        :data-canvas-drag-armed="canvasDragArmed ? 'true' : undefined"
        :class="canvasDragArmed ? 'pointer-events-none' : 'pointer-events-auto'">
        <slot name="footer" :canvas-drag-armed="canvasDragArmed" />
      </div>
    </div>
  </div>
</template>
