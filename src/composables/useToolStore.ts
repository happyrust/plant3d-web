import { computed, ref, watch } from 'vue';

import type { AnnotationComment } from '@/types/auth';

import { getOutputProjectFromUrl } from '@/lib/filesOutput';

export type ToolMode =
  | 'none'
  | 'measure_distance'
  | 'measure_angle'
  | 'xeokit_measure_distance'
  | 'xeokit_measure_angle'
  | 'measure_point_to_object'
  | 'measure_pipe_to_structure'
  | 'measure_pipe_to_pipe'
  | 'dimension_linear'
  | 'dimension_angle'
  | 'annotation'
  | 'annotation_cloud'
  | 'annotation_rect'
  | 'annotation_obb'
  | 'pick_query_center'
  | 'pick_refno';

export type AttributeDisplayMode = 'all' | 'general' | 'component' | 'uda';

export type Vec3 = [number, number, number];

export type MeasurementKind = 'distance' | 'angle';

export type MeasurementPoint = {
  entityId: string;
  worldPos: Vec3;
};

export type DistanceMeasurementRecord = {
  id: string;
  kind: 'distance';
  origin: MeasurementPoint;
  target: MeasurementPoint;
  visible: boolean;
  createdAt: number;
};

export type AngleMeasurementRecord = {
  id: string;
  kind: 'angle';
  origin: MeasurementPoint;
  corner: MeasurementPoint;
  target: MeasurementPoint;
  visible: boolean;
  createdAt: number;
};

export type MeasurementRecord = DistanceMeasurementRecord | AngleMeasurementRecord;

export type XeokitMeasurementKind = 'distance' | 'angle';

export type XeokitDistanceMeasurementRecord = {
  id: string;
  kind: 'distance';
  origin: MeasurementPoint;
  target: MeasurementPoint;
  visible: boolean;
  approximate: boolean;
  createdAt: number;
};

export type XeokitAngleMeasurementRecord = {
  id: string;
  kind: 'angle';
  origin: MeasurementPoint;
  corner: MeasurementPoint;
  target: MeasurementPoint;
  visible: boolean;
  approximate: boolean;
  createdAt: number;
};

export type XeokitMeasurementRecord = XeokitDistanceMeasurementRecord | XeokitAngleMeasurementRecord;

export type XeokitDistanceDraft = {
  id: string;
  kind: 'distance';
  origin: MeasurementPoint;
  target: MeasurementPoint;
  visible: boolean;
  approximate: true;
  createdAt: number;
};

export type XeokitAngleDraftStage = 'finding_corner' | 'finding_target';

export type XeokitAngleDraft = {
  id: string;
  kind: 'angle';
  origin: MeasurementPoint;
  corner: MeasurementPoint;
  target: MeasurementPoint;
  stage: XeokitAngleDraftStage;
  visible: boolean;
  approximate: true;
  createdAt: number;
};

export type XeokitHoverState = {
  visible: boolean;
  snapped: boolean;
  entityId: string | null;
  objectId: string | null;
  worldPos: Vec3 | null;
  canvasPos: { x: number; y: number } | null;
};

export type XeokitMarkerRole = 'origin' | 'corner' | 'target' | 'hover';

export type XeokitMarkerState = {
  visible: boolean;
  snapped: boolean;
  role: XeokitMarkerRole;
  worldPos: Vec3 | null;
  canvasPos: { x: number; y: number } | null;
};

export type XeokitPointerLensState = {
  visible: boolean;
  snapped: boolean;
  title: string;
  subtitle: string;
  canvasPos: { x: number; y: number } | null;
};

export type DimensionKind = 'linear_distance' | 'angle';

export type LinearDistanceDimensionRecord = {
  id: string;
  kind: 'linear_distance';
  origin: MeasurementPoint;
  target: MeasurementPoint;
  offset: number;
  direction: Vec3 | null;
  /** 文本在尺寸线上的位置（0..1，默认 0.5） */
  labelT?: number;
  /** SolveSpace 风格：文字自由拖拽偏移（世界坐标，相对于 labelT 基准位置） */
  labelOffsetWorld?: Vec3 | null;
  /** 参考尺寸（仅显示，不参与约束计算） */
  isReference?: boolean;
  textOverride?: string;
  visible: boolean;
  createdAt: number;
};

export type AngleDimensionRecord = {
  id: string;
  kind: 'angle';
  origin: MeasurementPoint;
  corner: MeasurementPoint;
  target: MeasurementPoint;
  offset: number;
  direction: Vec3 | null;
  /** 文本在圆弧上的位置（0..1，默认 0.5） */
  labelT?: number;
  /** SolveSpace 风格：文字自由拖拽偏移（世界坐标，相对于 labelT 基准位置） */
  labelOffsetWorld?: Vec3 | null;
  /** 参考尺寸（仅显示，不参与约束计算） */
  isReference?: boolean;
  /** 显示补角（minor/major 模式切换） */
  supplementary?: boolean;
  textOverride?: string;
  visible: boolean;
  createdAt: number;
};

export type DimensionRecord = LinearDistanceDimensionRecord | AngleDimensionRecord;

export type AnnotationRecord = {
  id: string;
  entityId: string;
  worldPos: Vec3;
  labelWorldPos?: Vec3;
  collapsed?: boolean;
  visible: boolean;
  glyph: string;
  title: string;
  description: string;
  createdAt: number;
  refno?: string; // 关联的对象参考号
  comments?: AnnotationComment[]; // 多角色意见列表
};

export type Obb = {
  center: Vec3;
  axes: [Vec3, Vec3, Vec3];
  halfSize: Vec3;
  corners: [Vec3, Vec3, Vec3, Vec3, Vec3, Vec3, Vec3, Vec3];
};

export type ObbAnnotationAnchor =
  | {
    kind: 'top_center';
  }
  | {
    kind: 'corner';
    cornerIndex: number;
  };

export type ObbAnnotationRecord = {
  id: string;
  objectIds: string[];
  obb: Obb;
  labelWorldPos: Vec3;
  anchor: ObbAnnotationAnchor;
  visible: boolean;
  title: string;
  description: string;
  createdAt: number;
  refnos?: string[]; // 关联的对象参考号列表
  comments?: AnnotationComment[]; // 多角色意见列表
};

export type CloudAnnotationRecord = {
  id: string;
  objectIds: string[];
  anchorWorldPos: Vec3;
  anchorRefno?: string;
  leaderEndWorldPos?: Vec3;
  screenOffset?: { x: number; y: number };
  cloudSize?: { width: number; height: number };
  visible: boolean;
  title: string;
  description: string;
  createdAt: number;
  refnos?: string[]; // 关联的对象参考号列表
  comments?: AnnotationComment[]; // 多角色意见列表
};

export type RectAnnotationRecord = {
  id: string;
  objectIds: string[];
  obb: Obb;
  anchorWorldPos: Vec3;
  leaderEndWorldPos?: Vec3;
  visible: boolean;
  title: string;
  description: string;
  createdAt: number;
  refnos?: string[];
  comments?: AnnotationComment[]; // 多角色意见列表
};

export type PickedQueryCenter = {
  entityId: string;
  worldPos: Vec3;
};

export type AnyAnnotationRecord =
  | AnnotationRecord
  | CloudAnnotationRecord
  | RectAnnotationRecord
  | ObbAnnotationRecord;

export type ActiveAnnotationContext = {
  type: AnnotationType;
  id: string;
  record: AnyAnnotationRecord;
};

// Ptset 可视化请求（用于跨组件通信）
export type PtsetVisualizationRequest = {
  refno: string;
  timestamp: number;
};

// MBD 管道标注请求（用于跨组件通信）
export type MbdPipeAnnotationRequest = {
  refno: string;
  timestamp: number;
};

type PersistedStateV1 = {
  version: 1;
  measurements: MeasurementRecord[];
  annotations: AnnotationRecord[];
};

type PersistedStateV2 = {
  version: 2;
  measurements: MeasurementRecord[];
  annotations: AnnotationRecord[];
  obbAnnotations: ObbAnnotationRecord[];
};

type PersistedStateV3 = {
  version: 3;
  measurements: MeasurementRecord[];
  annotations: AnnotationRecord[];
  obbAnnotations: ObbAnnotationRecord[];
  cloudAnnotations: CloudAnnotationRecord[];
  rectAnnotations: RectAnnotationRecord[];
};

type PersistedStateV4 = {
  version: 4;
  measurements: MeasurementRecord[];
  annotations: AnnotationRecord[];
  obbAnnotations: ObbAnnotationRecord[];
  cloudAnnotations: CloudAnnotationRecord[];
  rectAnnotations: RectAnnotationRecord[];
  dimensions: DimensionRecord[];
};

type PersistedStateV5 = {
  version: 5;
  measurements: MeasurementRecord[];
  annotations: AnnotationRecord[];
  obbAnnotations: ObbAnnotationRecord[];
  cloudAnnotations: CloudAnnotationRecord[];
  rectAnnotations: RectAnnotationRecord[];
  dimensions: DimensionRecord[];
  xeokitDistanceMeasurements: XeokitDistanceMeasurementRecord[];
  xeokitAngleMeasurements: XeokitAngleMeasurementRecord[];
};

const STORAGE_KEY_V1 = 'plant3d-web-tools-v1';
const STORAGE_KEY_V2 = 'plant3d-web-tools-v2';
const STORAGE_KEY_V3 = 'plant3d-web-tools-v3';
const STORAGE_KEY_V4 = 'plant3d-web-tools-v4';
const STORAGE_KEY_V5 = 'plant3d-web-tools-v5';
const DEFAULT_STORAGE_SCOPE = '__default__';

function getCurrentStorageScope(): string {
  if (typeof window === 'undefined') return DEFAULT_STORAGE_SCOPE;
  try {
    const params = new URLSearchParams(window.location.search);
    const project = getOutputProjectFromUrl() || params.get('project_id') || DEFAULT_STORAGE_SCOPE;
    const dbnum = params.get('show_dbnum') || '__all__';
    return `project=${project}|db=${dbnum}`;
  } catch {
    return DEFAULT_STORAGE_SCOPE;
  }
}

function withStorageScope(storageKey: string, scope = getCurrentStorageScope()): string {
  return `${storageKey}:${scope}`;
}

function normalizeAnnotationRecord(rec: AnnotationRecord): AnnotationRecord {
  return {
    ...rec,
    labelWorldPos: Array.isArray(rec.labelWorldPos) && rec.labelWorldPos.length === 3 ? rec.labelWorldPos : undefined,
    collapsed: rec.collapsed === true,
  };
}

function normalizeV1(parsed: PersistedStateV1): PersistedStateV5 {
  return {
    version: 5,
    measurements: Array.isArray(parsed.measurements) ? parsed.measurements : [],
    annotations: Array.isArray(parsed.annotations) ? parsed.annotations.map(normalizeAnnotationRecord) : [],
    obbAnnotations: [],
    cloudAnnotations: [],
    rectAnnotations: [],
    dimensions: [],
    xeokitDistanceMeasurements: [],
    xeokitAngleMeasurements: [],
  };
}

function normalizeV2(parsed: PersistedStateV2): PersistedStateV5 {
  return {
    version: 5,
    measurements: Array.isArray(parsed.measurements) ? parsed.measurements : [],
    annotations: Array.isArray(parsed.annotations) ? parsed.annotations.map(normalizeAnnotationRecord) : [],
    obbAnnotations: Array.isArray(parsed.obbAnnotations) ? parsed.obbAnnotations : [],
    cloudAnnotations: [],
    rectAnnotations: [],
    dimensions: [],
    xeokitDistanceMeasurements: [],
    xeokitAngleMeasurements: [],
  };
}

function normalizeV3(parsed: PersistedStateV3): PersistedStateV5 {
  return {
    version: 5,
    measurements: Array.isArray(parsed.measurements) ? parsed.measurements : [],
    annotations: Array.isArray(parsed.annotations) ? parsed.annotations.map(normalizeAnnotationRecord) : [],
    obbAnnotations: Array.isArray(parsed.obbAnnotations) ? parsed.obbAnnotations : [],
    cloudAnnotations: Array.isArray(parsed.cloudAnnotations) ? parsed.cloudAnnotations : [],
    rectAnnotations: Array.isArray(parsed.rectAnnotations) ? parsed.rectAnnotations : [],
    dimensions: [],
    xeokitDistanceMeasurements: [],
    xeokitAngleMeasurements: [],
  };
}

function normalizeV4(parsed: PersistedStateV4): PersistedStateV5 {
  return {
    version: 5,
    measurements: Array.isArray(parsed.measurements) ? parsed.measurements : [],
    annotations: Array.isArray(parsed.annotations) ? parsed.annotations.map(normalizeAnnotationRecord) : [],
    obbAnnotations: Array.isArray(parsed.obbAnnotations) ? parsed.obbAnnotations : [],
    cloudAnnotations: Array.isArray(parsed.cloudAnnotations) ? parsed.cloudAnnotations : [],
    rectAnnotations: Array.isArray(parsed.rectAnnotations) ? parsed.rectAnnotations : [],
    dimensions: Array.isArray(parsed.dimensions) ? parsed.dimensions : [],
    xeokitDistanceMeasurements: [],
    xeokitAngleMeasurements: [],
  };
}

function normalizeV5(parsed: PersistedStateV5): PersistedStateV5 {
  return {
    version: 5,
    measurements: Array.isArray(parsed.measurements) ? parsed.measurements : [],
    annotations: Array.isArray(parsed.annotations) ? parsed.annotations.map(normalizeAnnotationRecord) : [],
    obbAnnotations: Array.isArray(parsed.obbAnnotations) ? parsed.obbAnnotations : [],
    cloudAnnotations: Array.isArray(parsed.cloudAnnotations) ? parsed.cloudAnnotations : [],
    rectAnnotations: Array.isArray(parsed.rectAnnotations) ? parsed.rectAnnotations : [],
    dimensions: Array.isArray(parsed.dimensions) ? parsed.dimensions : [],
    xeokitDistanceMeasurements: Array.isArray(parsed.xeokitDistanceMeasurements) ? parsed.xeokitDistanceMeasurements : [],
    xeokitAngleMeasurements: Array.isArray(parsed.xeokitAngleMeasurements) ? parsed.xeokitAngleMeasurements : [],
  };
}

function loadPersisted(scope = getCurrentStorageScope()): PersistedStateV5 {
  if (typeof localStorage === 'undefined') {
    return {
      version: 5,
      measurements: [],
      annotations: [],
      obbAnnotations: [],
      cloudAnnotations: [],
      rectAnnotations: [],
      dimensions: [],
      xeokitDistanceMeasurements: [],
      xeokitAngleMeasurements: [],
    };
  }

  try {
    const rawV5 = localStorage.getItem(withStorageScope(STORAGE_KEY_V5, scope));
    if (rawV5) {
      const parsed = JSON.parse(rawV5) as PersistedStateV5;
      if (parsed && parsed.version === 5) {
        return normalizeV5(parsed);
      }
    }

    const rawV4 = localStorage.getItem(withStorageScope(STORAGE_KEY_V4, scope));
    if (rawV4) {
      const parsed = JSON.parse(rawV4) as PersistedStateV4;
      if (parsed && parsed.version === 4) {
        return normalizeV4(parsed);
      }
    }

    const rawV3 = localStorage.getItem(withStorageScope(STORAGE_KEY_V3, scope));
    if (rawV3) {
      const parsed = JSON.parse(rawV3) as PersistedStateV3;
      if (parsed && parsed.version === 3) {
        return normalizeV3(parsed);
      }
    }

    const rawV2 = localStorage.getItem(withStorageScope(STORAGE_KEY_V2, scope));
    if (rawV2) {
      const parsed = JSON.parse(rawV2) as PersistedStateV2;
      if (parsed && parsed.version === 2) {
        return normalizeV2(parsed);
      }
    }

    const rawV1 = localStorage.getItem(withStorageScope(STORAGE_KEY_V1, scope));
    if (rawV1) {
      const parsed = JSON.parse(rawV1) as PersistedStateV1;
      if (parsed && parsed.version === 1) {
        return normalizeV1(parsed);
      }
    }
  } catch {
    // ignore
  }

  return {
    version: 5,
    measurements: [],
    annotations: [],
    obbAnnotations: [],
    cloudAnnotations: [],
    rectAnnotations: [],
    dimensions: [],
    xeokitDistanceMeasurements: [],
    xeokitAngleMeasurements: [],
  };
}

const storageScope = ref(getCurrentStorageScope());
const persisted = loadPersisted(storageScope.value);

const measurements = ref<MeasurementRecord[]>(persisted.measurements);
const annotations = ref<AnnotationRecord[]>(persisted.annotations);
const obbAnnotations = ref<ObbAnnotationRecord[]>(persisted.obbAnnotations);
const cloudAnnotations = ref<CloudAnnotationRecord[]>(persisted.cloudAnnotations);
const rectAnnotations = ref<RectAnnotationRecord[]>(persisted.rectAnnotations);
const dimensions = ref<DimensionRecord[]>(persisted.dimensions);
const xeokitDistanceMeasurements = ref<XeokitDistanceMeasurementRecord[]>(persisted.xeokitDistanceMeasurements);
const xeokitAngleMeasurements = ref<XeokitAngleMeasurementRecord[]>(persisted.xeokitAngleMeasurements);

const activeTab = ref<'tree' | 'measurement' | 'annotation' | 'obb_annotation' | 'manager' | 'properties'>('tree');
const toolMode = ref<ToolMode>('none');

// Attribute display state
const attributeDisplayMode = ref<AttributeDisplayMode>('all');
const compareMode = ref<boolean>(false);

const activeAnnotationId = ref<string | null>(null);
const activeObbAnnotationId = ref<string | null>(null);
const activeCloudAnnotationId = ref<string | null>(null);
const activeRectAnnotationId = ref<string | null>(null);
const activeMeasurementId = ref<string | null>(null);
const activeDimensionId = ref<string | null>(null);
const activeXeokitMeasurementId = ref<string | null>(null);
const measurementDetailsDrawerOpen = ref(false);

const pickedQueryCenter = ref<PickedQueryCenter | null>(null);

// Ptset 可视化请求
const ptsetVisualizationRequest = ref<PtsetVisualizationRequest | null>(null);
// MBD 管道标注请求
const mbdPipeAnnotationRequest = ref<MbdPipeAnnotationRequest | null>(null);

// ── 通用 refno 拾取模式 ──
const pickRefnoFilter = ref<string[]>([]);       // noun 过滤列表（如 ['BRAN']），空=不过滤
const pickedRefnos = ref<string[]>([]);           // 已拾取的 refno 列表
const pickRefnoCallback = ref<((refnos: string[]) => void) | null>(null); // 确认回调

const pendingObbEditId = ref<string | null>(null);
const pendingTextAnnotationEditId = ref<string | null>(null);
const pendingCloudAnnotationEditId = ref<string | null>(null);
const pendingRectAnnotationEditId = ref<string | null>(null);
const pendingDimensionEditId = ref<string | null>(null);

const currentXeokitDistanceDraft = ref<XeokitDistanceDraft | null>(null);
const currentXeokitAngleDraft = ref<XeokitAngleDraft | null>(null);
const xeokitHoverState = ref<XeokitHoverState>({
  visible: false,
  snapped: false,
  entityId: null,
  objectId: null,
  worldPos: null,
  canvasPos: null,
});
const xeokitMarkerState = ref<XeokitMarkerState>({
  visible: false,
  snapped: false,
  role: 'hover',
  worldPos: null,
  canvasPos: null,
});
const xeokitPointerLensState = ref<XeokitPointerLensState>({
  visible: false,
  snapped: false,
  title: '',
  subtitle: '',
  canvasPos: null,
});

function resetTransientUiState() {
  activeAnnotationId.value = null;
  activeObbAnnotationId.value = null;
  activeCloudAnnotationId.value = null;
  activeRectAnnotationId.value = null;
  activeMeasurementId.value = null;
  activeDimensionId.value = null;
  activeXeokitMeasurementId.value = null;
  measurementDetailsDrawerOpen.value = false;
  pickedQueryCenter.value = null;
  pickRefnoFilter.value = [];
  pickedRefnos.value = [];
  pickRefnoCallback.value = null;
  pendingObbEditId.value = null;
  pendingTextAnnotationEditId.value = null;
  pendingCloudAnnotationEditId.value = null;
  pendingRectAnnotationEditId.value = null;
  pendingDimensionEditId.value = null;
  currentXeokitDistanceDraft.value = null;
  currentXeokitAngleDraft.value = null;
  xeokitHoverState.value = {
    visible: false,
    snapped: false,
    entityId: null,
    objectId: null,
    worldPos: null,
    canvasPos: null,
  };
  xeokitMarkerState.value = {
    visible: false,
    snapped: false,
    role: 'hover',
    worldPos: null,
    canvasPos: null,
  };
  xeokitPointerLensState.value = {
    visible: false,
    snapped: false,
    title: '',
    subtitle: '',
    canvasPos: null,
  };
  toolMode.value = 'none';
}

function applyPersistedState(state: PersistedStateV5) {
  measurements.value = state.measurements;
  annotations.value = state.annotations;
  obbAnnotations.value = state.obbAnnotations;
  cloudAnnotations.value = state.cloudAnnotations;
  rectAnnotations.value = state.rectAnnotations;
  dimensions.value = state.dimensions;
  xeokitDistanceMeasurements.value = state.xeokitDistanceMeasurements;
  xeokitAngleMeasurements.value = state.xeokitAngleMeasurements;
  resetTransientUiState();
}

function refreshPersistedScope() {
  const nextScope = getCurrentStorageScope();
  if (nextScope === storageScope.value) return;
  storageScope.value = nextScope;
  applyPersistedState(loadPersisted(nextScope));
}

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', refreshPersistedScope);
  window.addEventListener('modelProjectChanged', refreshPersistedScope as EventListener);
}

watch(
  () => ({
    measurements: measurements.value,
    annotations: annotations.value,
    obbAnnotations: obbAnnotations.value,
    cloudAnnotations: cloudAnnotations.value,
    rectAnnotations: rectAnnotations.value,
    dimensions: dimensions.value,
    xeokitDistanceMeasurements: xeokitDistanceMeasurements.value,
    xeokitAngleMeasurements: xeokitAngleMeasurements.value,
  }),
  (state) => {
    if (typeof localStorage === 'undefined') return;
    const payload: PersistedStateV5 = {
      version: 5,
      measurements: state.measurements,
      annotations: state.annotations,
      obbAnnotations: state.obbAnnotations,
      cloudAnnotations: state.cloudAnnotations,
      rectAnnotations: state.rectAnnotations,
      dimensions: state.dimensions,
      xeokitDistanceMeasurements: state.xeokitDistanceMeasurements,
      xeokitAngleMeasurements: state.xeokitAngleMeasurements,
    };
    try {
      localStorage.setItem(withStorageScope(STORAGE_KEY_V5, storageScope.value), JSON.stringify(payload));
    } catch {
      // ignore
    }
  },
  { deep: true }
);

function setToolMode(mode: ToolMode) {
  toolMode.value = mode;
  // 退出 pick_refno 时清理状态
  if (mode !== 'pick_refno') {
    pickRefnoFilter.value = [];
    pickRefnoCallback.value = null;
    // 注意：pickedRefnos 不在此处清理，由调用方决定
  }
}

/**
 * 启动通用 refno 拾取模式
 * @param nounFilter noun 类型过滤数组（如 ['BRAN']），空数组=不过滤
 * @param onConfirm  用户按 Enter 确认后的回调
 */
function startPickRefno(nounFilter: string[], onConfirm?: (refnos: string[]) => void) {
  pickedRefnos.value = [];
  pickRefnoFilter.value = nounFilter.map(n => n.toUpperCase());
  pickRefnoCallback.value = onConfirm ?? null;
  toolMode.value = 'pick_refno';
}

function addPickedRefno(refno: string) {
  if (!pickedRefnos.value.includes(refno)) {
    pickedRefnos.value = [...pickedRefnos.value, refno];
  }
}

function removePickedRefno(refno: string) {
  pickedRefnos.value = pickedRefnos.value.filter(r => r !== refno);
}

function confirmPickRefno() {
  const cb = pickRefnoCallback.value;
  const result = [...pickedRefnos.value];
  toolMode.value = 'none';
  // 回调在重置后执行，避免副作用干扰
  cb?.(result);
}

function cancelPickRefno() {
  pickedRefnos.value = [];
  toolMode.value = 'none';
}

function setAttributeDisplayMode(mode: AttributeDisplayMode) {
  attributeDisplayMode.value = mode;
}

function setCompareMode(enabled: boolean) {
  compareMode.value = enabled;
}

function addMeasurement(rec: MeasurementRecord) {
  measurements.value = [...measurements.value, rec];
  activeMeasurementId.value = rec.id;
}

function updateMeasurementVisible(id: string, visible: boolean) {
  measurements.value = measurements.value.map((m) => (m.id === id ? { ...m, visible } : m));
}

function removeMeasurement(id: string) {
  measurements.value = measurements.value.filter((m) => m.id !== id);
  if (activeMeasurementId.value === id) {
    activeMeasurementId.value = null;
  }
}

function clearMeasurements() {
  measurements.value = [];
  activeMeasurementId.value = null;
}

function addXeokitDistanceMeasurement(rec: XeokitDistanceMeasurementRecord) {
  xeokitDistanceMeasurements.value = [...xeokitDistanceMeasurements.value, rec];
  activeXeokitMeasurementId.value = rec.id;
}

function updateXeokitDistanceMeasurement(id: string, patch: Partial<XeokitDistanceMeasurementRecord>) {
  xeokitDistanceMeasurements.value = xeokitDistanceMeasurements.value.map((m) => (m.id === id ? { ...m, ...patch } : m));
}

function addXeokitAngleMeasurement(rec: XeokitAngleMeasurementRecord) {
  xeokitAngleMeasurements.value = [...xeokitAngleMeasurements.value, rec];
  activeXeokitMeasurementId.value = rec.id;
}

function updateXeokitAngleMeasurement(id: string, patch: Partial<XeokitAngleMeasurementRecord>) {
  xeokitAngleMeasurements.value = xeokitAngleMeasurements.value.map((m) => (m.id === id ? { ...m, ...patch } : m));
}

function updateXeokitMeasurementVisible(id: string, visible: boolean) {
  let updated = false;
  xeokitDistanceMeasurements.value = xeokitDistanceMeasurements.value.map((m) => {
    if (m.id !== id) return m;
    updated = true;
    return { ...m, visible };
  });
  if (updated) return;
  xeokitAngleMeasurements.value = xeokitAngleMeasurements.value.map((m) => (m.id === id ? { ...m, visible } : m));
}

function removeXeokitMeasurement(id: string) {
  const prevDistanceLength = xeokitDistanceMeasurements.value.length;
  xeokitDistanceMeasurements.value = xeokitDistanceMeasurements.value.filter((m) => m.id !== id);
  if (xeokitDistanceMeasurements.value.length !== prevDistanceLength) {
    if (activeXeokitMeasurementId.value === id) {
      activeXeokitMeasurementId.value = null;
    }
    return;
  }

  xeokitAngleMeasurements.value = xeokitAngleMeasurements.value.filter((m) => m.id !== id);
  if (activeXeokitMeasurementId.value === id) {
    activeXeokitMeasurementId.value = null;
  }
}

function clearXeokitMeasurements() {
  xeokitDistanceMeasurements.value = [];
  xeokitAngleMeasurements.value = [];
  activeXeokitMeasurementId.value = null;
  measurementDetailsDrawerOpen.value = false;
}

function setMeasurementDetailsDrawerOpen(open: boolean) {
  measurementDetailsDrawerOpen.value = open;
}

function toggleMeasurementDetailsDrawerOpen() {
  measurementDetailsDrawerOpen.value = !measurementDetailsDrawerOpen.value;
}

function setCurrentXeokitDistanceDraft(draft: XeokitDistanceDraft | null) {
  currentXeokitDistanceDraft.value = draft ? { ...draft } : null;
}

function setCurrentXeokitAngleDraft(draft: XeokitAngleDraft | null) {
  currentXeokitAngleDraft.value = draft ? { ...draft } : null;
}

function clearCurrentXeokitDraft() {
  currentXeokitDistanceDraft.value = null;
  currentXeokitAngleDraft.value = null;
}

function setXeokitHoverState(state: XeokitHoverState) {
  xeokitHoverState.value = { ...state };
}

function setXeokitMarkerState(state: XeokitMarkerState) {
  xeokitMarkerState.value = { ...state };
}

function setXeokitPointerLensState(state: XeokitPointerLensState) {
  xeokitPointerLensState.value = { ...state };
}

function addDimension(rec: DimensionRecord) {
  dimensions.value = [...dimensions.value, rec];
  activeDimensionId.value = rec.id;
}

function updateDimension(id: string, patch: Partial<DimensionRecord>) {
  dimensions.value = dimensions.value.map((d) => (d.id === id ? ({ ...d, ...patch } as DimensionRecord) : d));
}

function updateDimensionVisible(id: string, visible: boolean) {
  updateDimension(id, { visible } as Partial<DimensionRecord>);
}

function removeDimension(id: string) {
  dimensions.value = dimensions.value.filter((d) => d.id !== id);
  if (activeDimensionId.value === id) {
    activeDimensionId.value = null;
  }
}

function clearDimensions() {
  dimensions.value = [];
  activeDimensionId.value = null;
}

function addAnnotation(rec: AnnotationRecord) {
  annotations.value = [...annotations.value, normalizeAnnotationRecord(rec)];
  activeAnnotationId.value = rec.id;
  pendingTextAnnotationEditId.value = rec.id;
}

function updateAnnotation(id: string, patch: Partial<AnnotationRecord>) {
  annotations.value = annotations.value.map((a) => (a.id === id ? { ...a, ...patch } : a));
}

function updateAnnotationVisible(id: string, visible: boolean) {
  updateAnnotation(id, { visible });
}

function removeAnnotation(id: string) {
  annotations.value = annotations.value.filter((a) => a.id !== id);
  if (activeAnnotationId.value === id) {
    activeAnnotationId.value = null;
  }
}

function clearAnnotations() {
  annotations.value = [];
  activeAnnotationId.value = null;
  pendingTextAnnotationEditId.value = null;
}

function addObbAnnotation(rec: ObbAnnotationRecord) {
  obbAnnotations.value = [...obbAnnotations.value, rec];
  activeObbAnnotationId.value = rec.id;
  // 不再自动弹出编辑框，用户点击图钉后再编辑
}

function updateObbAnnotation(id: string, patch: Partial<ObbAnnotationRecord>) {
  obbAnnotations.value = obbAnnotations.value.map((a) => (a.id === id ? { ...a, ...patch } : a));
}

function updateObbAnnotationVisible(id: string, visible: boolean) {
  updateObbAnnotation(id, { visible });
}

function removeObbAnnotation(id: string) {
  obbAnnotations.value = obbAnnotations.value.filter((a) => a.id !== id);
  if (activeObbAnnotationId.value === id) {
    activeObbAnnotationId.value = null;
  }
}

function clearObbAnnotations() {
  obbAnnotations.value = [];
  activeObbAnnotationId.value = null;
  pendingObbEditId.value = null;
}

function addCloudAnnotation(rec: CloudAnnotationRecord) {
  cloudAnnotations.value = [...cloudAnnotations.value, rec];
  activeCloudAnnotationId.value = rec.id;
  pendingCloudAnnotationEditId.value = rec.id;
}

function updateCloudAnnotation(id: string, patch: Partial<CloudAnnotationRecord>) {
  cloudAnnotations.value = cloudAnnotations.value.map((a) => (a.id === id ? { ...a, ...patch } : a));
}

function updateCloudAnnotationVisible(id: string, visible: boolean) {
  updateCloudAnnotation(id, { visible });
}

function removeCloudAnnotation(id: string) {
  cloudAnnotations.value = cloudAnnotations.value.filter((a) => a.id !== id);
  if (activeCloudAnnotationId.value === id) {
    activeCloudAnnotationId.value = null;
  }
  if (pendingCloudAnnotationEditId.value === id) {
    pendingCloudAnnotationEditId.value = null;
  }
}

function clearCloudAnnotations() {
  cloudAnnotations.value = [];
  activeCloudAnnotationId.value = null;
  pendingCloudAnnotationEditId.value = null;
}

function addRectAnnotation(rec: RectAnnotationRecord) {
  rectAnnotations.value = [...rectAnnotations.value, rec];
  activeRectAnnotationId.value = rec.id;
  pendingRectAnnotationEditId.value = rec.id;
}

function updateRectAnnotation(id: string, patch: Partial<RectAnnotationRecord>) {
  rectAnnotations.value = rectAnnotations.value.map((a) => (a.id === id ? { ...a, ...patch } : a));
}

function updateRectAnnotationVisible(id: string, visible: boolean) {
  updateRectAnnotation(id, { visible });
}

function removeRectAnnotation(id: string) {
  rectAnnotations.value = rectAnnotations.value.filter((a) => a.id !== id);
  if (activeRectAnnotationId.value === id) {
    activeRectAnnotationId.value = null;
  }
  if (pendingRectAnnotationEditId.value === id) {
    pendingRectAnnotationEditId.value = null;
  }
}

function clearRectAnnotations() {
  rectAnnotations.value = [];
  activeRectAnnotationId.value = null;
  pendingRectAnnotationEditId.value = null;
}

function getAnnotationRecordsByType(type: AnnotationType): AnyAnnotationRecord[] {
  switch (type) {
    case 'text':
      return annotations.value;
    case 'cloud':
      return cloudAnnotations.value;
    case 'rect':
      return rectAnnotations.value;
    case 'obb':
      return obbAnnotations.value;
  }
}

function setAnnotationTypeVisible(type: AnnotationType, visible: boolean) {
  switch (type) {
    case 'text':
      annotations.value.forEach((item) => updateAnnotationVisible(item.id, visible));
      return;
    case 'cloud':
      cloudAnnotations.value.forEach((item) => updateCloudAnnotationVisible(item.id, visible));
      return;
    case 'rect':
      rectAnnotations.value.forEach((item) => updateRectAnnotationVisible(item.id, visible));
      return;
    case 'obb':
      obbAnnotations.value.forEach((item) => updateObbAnnotationVisible(item.id, visible));
  }
}

function clearAnnotationType(type: AnnotationType) {
  switch (type) {
    case 'text':
      clearAnnotations();
      return;
    case 'cloud':
      clearCloudAnnotations();
      return;
    case 'rect':
      clearRectAnnotations();
      return;
    case 'obb':
      clearObbAnnotations();
  }
}

function setAllAnnotationsVisible(visible: boolean) {
  setAnnotationTypeVisible('text', visible);
  setAnnotationTypeVisible('cloud', visible);
  setAnnotationTypeVisible('rect', visible);
  setAnnotationTypeVisible('obb', visible);
}

function clearAllAnnotations() {
  clearAnnotations();
  clearCloudAnnotations();
  clearRectAnnotations();
  clearObbAnnotations();
}

function clearAll() {
  clearMeasurements();
  clearXeokitMeasurements();
  clearDimensions();
  clearAllAnnotations();
  clearCurrentXeokitDraft();
  setXeokitHoverState({
    visible: false,
    snapped: false,
    entityId: null,
    objectId: null,
    worldPos: null,
    canvasPos: null,
  });
  setXeokitMarkerState({
    visible: false,
    snapped: false,
    role: 'hover',
    worldPos: null,
    canvasPos: null,
  });
  setXeokitPointerLensState({
    visible: false,
    snapped: false,
    title: '',
    subtitle: '',
    canvasPos: null,
  });
  toolMode.value = 'none';
}

// ==================== 评论/意见管理函数 ====================

export type AnnotationType = 'text' | 'cloud' | 'rect' | 'obb';

/**
 * 为批注添加评论/意见
 */
function addCommentToAnnotation(
  annotationType: AnnotationType,
  annotationId: string,
  comment: Omit<AnnotationComment, 'id' | 'annotationId' | 'annotationType' | 'createdAt'>
): AnnotationComment | null {
  const newComment: AnnotationComment = {
    id: `comment_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    annotationId,
    annotationType,
    ...comment,
    createdAt: Date.now(),
  };

  switch (annotationType) {
    case 'text': {
      const annotation = annotations.value.find((a) => a.id === annotationId);
      if (!annotation) return null;
      const comments = annotation.comments || [];
      updateAnnotation(annotationId, { comments: [...comments, newComment] });
      break;
    }
    case 'cloud': {
      const annotation = cloudAnnotations.value.find((a) => a.id === annotationId);
      if (!annotation) return null;
      const comments = annotation.comments || [];
      updateCloudAnnotation(annotationId, { comments: [...comments, newComment] });
      break;
    }
    case 'rect': {
      const annotation = rectAnnotations.value.find((a) => a.id === annotationId);
      if (!annotation) return null;
      const comments = annotation.comments || [];
      updateRectAnnotation(annotationId, { comments: [...comments, newComment] });
      break;
    }
    case 'obb': {
      const annotation = obbAnnotations.value.find((a) => a.id === annotationId);
      if (!annotation) return null;
      const comments = annotation.comments || [];
      updateObbAnnotation(annotationId, { comments: [...comments, newComment] });
      break;
    }
  }

  return newComment;
}

/**
 * 覆盖批注评论列表（用于后端同步）
 */
function setAnnotationComments(
  annotationType: AnnotationType,
  annotationId: string,
  comments: AnnotationComment[]
): boolean {
  switch (annotationType) {
    case 'text': {
      const annotation = annotations.value.find((a) => a.id === annotationId);
      if (!annotation) return false;
      updateAnnotation(annotationId, { comments });
      return true;
    }
    case 'cloud': {
      const annotation = cloudAnnotations.value.find((a) => a.id === annotationId);
      if (!annotation) return false;
      updateCloudAnnotation(annotationId, { comments });
      return true;
    }
    case 'rect': {
      const annotation = rectAnnotations.value.find((a) => a.id === annotationId);
      if (!annotation) return false;
      updateRectAnnotation(annotationId, { comments });
      return true;
    }
    case 'obb': {
      const annotation = obbAnnotations.value.find((a) => a.id === annotationId);
      if (!annotation) return false;
      updateObbAnnotation(annotationId, { comments });
      return true;
    }
  }
  return false;
}

/**
 * 更新批注中的某条评论
 */
function updateAnnotationComment(
  annotationType: AnnotationType,
  annotationId: string,
  commentId: string,
  patch: Partial<Pick<AnnotationComment, 'content' | 'updatedAt'>>
): boolean {
  const updateComments = (comments: AnnotationComment[] | undefined): AnnotationComment[] | undefined => {
    if (!comments) return undefined;
    return comments.map((c) =>
      c.id === commentId ? { ...c, ...patch, updatedAt: Date.now() } : c
    );
  };

  switch (annotationType) {
    case 'text': {
      const annotation = annotations.value.find((a) => a.id === annotationId);
      if (!annotation) return false;
      updateAnnotation(annotationId, { comments: updateComments(annotation.comments) });
      return true;
    }
    case 'cloud': {
      const annotation = cloudAnnotations.value.find((a) => a.id === annotationId);
      if (!annotation) return false;
      updateCloudAnnotation(annotationId, { comments: updateComments(annotation.comments) });
      return true;
    }
    case 'rect': {
      const annotation = rectAnnotations.value.find((a) => a.id === annotationId);
      if (!annotation) return false;
      updateRectAnnotation(annotationId, { comments: updateComments(annotation.comments) });
      return true;
    }
    case 'obb': {
      const annotation = obbAnnotations.value.find((a) => a.id === annotationId);
      if (!annotation) return false;
      updateObbAnnotation(annotationId, { comments: updateComments(annotation.comments) });
      return true;
    }
  }
  return false;
}

/**
 * 删除批注中的某条评论
 */
function removeAnnotationComment(
  annotationType: AnnotationType,
  annotationId: string,
  commentId: string
): boolean {
  const filterComments = (comments: AnnotationComment[] | undefined): AnnotationComment[] | undefined => {
    if (!comments) return undefined;
    return comments.filter((c) => c.id !== commentId);
  };

  switch (annotationType) {
    case 'text': {
      const annotation = annotations.value.find((a) => a.id === annotationId);
      if (!annotation) return false;
      updateAnnotation(annotationId, { comments: filterComments(annotation.comments) });
      return true;
    }
    case 'cloud': {
      const annotation = cloudAnnotations.value.find((a) => a.id === annotationId);
      if (!annotation) return false;
      updateCloudAnnotation(annotationId, { comments: filterComments(annotation.comments) });
      return true;
    }
    case 'rect': {
      const annotation = rectAnnotations.value.find((a) => a.id === annotationId);
      if (!annotation) return false;
      updateRectAnnotation(annotationId, { comments: filterComments(annotation.comments) });
      return true;
    }
    case 'obb': {
      const annotation = obbAnnotations.value.find((a) => a.id === annotationId);
      if (!annotation) return false;
      updateObbAnnotation(annotationId, { comments: filterComments(annotation.comments) });
      return true;
    }
  }
  return false;
}

/**
 * 获取批注的所有评论
 */
function getAnnotationComments(
  annotationType: AnnotationType,
  annotationId: string
): AnnotationComment[] {
  switch (annotationType) {
    case 'text': {
      const annotation = annotations.value.find((a) => a.id === annotationId);
      return annotation?.comments || [];
    }
    case 'cloud': {
      const annotation = cloudAnnotations.value.find((a) => a.id === annotationId);
      return annotation?.comments || [];
    }
    case 'rect': {
      const annotation = rectAnnotations.value.find((a) => a.id === annotationId);
      return annotation?.comments || [];
    }
    case 'obb': {
      const annotation = obbAnnotations.value.find((a) => a.id === annotationId);
      return annotation?.comments || [];
    }
  }
  return [];
}

function exportJSON(): string {
  const payload: PersistedStateV5 = {
    version: 5,
    measurements: measurements.value,
    annotations: annotations.value,
    obbAnnotations: obbAnnotations.value,
    cloudAnnotations: cloudAnnotations.value,
    rectAnnotations: rectAnnotations.value,
    dimensions: dimensions.value,
    xeokitDistanceMeasurements: xeokitDistanceMeasurements.value,
    xeokitAngleMeasurements: xeokitAngleMeasurements.value,
  };
  return JSON.stringify(payload, null, 2);
}

function importJSON(raw: string) {
  const parsed = JSON.parse(raw) as PersistedStateV1 | PersistedStateV2 | PersistedStateV3 | PersistedStateV4 | PersistedStateV5;
  if (!parsed || (parsed.version !== 1 && parsed.version !== 2 && parsed.version !== 3 && parsed.version !== 4 && parsed.version !== 5)) {
    throw new Error('Unsupported tools JSON format');
  }

  const v5 =
    parsed.version === 1
      ? normalizeV1(parsed)
      : parsed.version === 2
        ? normalizeV2(parsed)
        : parsed.version === 3
          ? normalizeV3(parsed)
          : parsed.version === 4
            ? normalizeV4(parsed)
            : normalizeV5(parsed);

  measurements.value = v5.measurements;
  annotations.value = v5.annotations;
  obbAnnotations.value = v5.obbAnnotations;
  cloudAnnotations.value = v5.cloudAnnotations;
  rectAnnotations.value = v5.rectAnnotations;
  dimensions.value = v5.dimensions;
  xeokitDistanceMeasurements.value = v5.xeokitDistanceMeasurements;
  xeokitAngleMeasurements.value = v5.xeokitAngleMeasurements;

  activeAnnotationId.value = null;
  activeObbAnnotationId.value = null;
  activeCloudAnnotationId.value = null;
  activeRectAnnotationId.value = null;
  activeMeasurementId.value = null;
  activeDimensionId.value = null;
  activeXeokitMeasurementId.value = null;
  measurementDetailsDrawerOpen.value = false;
  pendingTextAnnotationEditId.value = null;
  pendingCloudAnnotationEditId.value = null;
  pendingObbEditId.value = null;
  pendingRectAnnotationEditId.value = null;
  pendingDimensionEditId.value = null;
  clearCurrentXeokitDraft();
  toolMode.value = 'none';
}

const measurementCount = computed(() => measurements.value.length);
const annotationCount = computed(() => annotations.value.length);
const obbAnnotationCount = computed(() => obbAnnotations.value.length);
const cloudAnnotationCount = computed(() => cloudAnnotations.value.length);
const rectAnnotationCount = computed(() => rectAnnotations.value.length);
const dimensionCount = computed(() => dimensions.value.length);
const xeokitMeasurementCount = computed(() => xeokitDistanceMeasurements.value.length + xeokitAngleMeasurements.value.length);
const activeAnnotationContext = computed<ActiveAnnotationContext | null>(() => {
  const mode = toolMode.value;
  const byMode: { mode: ToolMode; type: AnnotationType; id: string | null; records: AnyAnnotationRecord[] }[] = [
    { mode: 'annotation', type: 'text', id: activeAnnotationId.value, records: annotations.value },
    { mode: 'annotation_cloud', type: 'cloud', id: activeCloudAnnotationId.value, records: cloudAnnotations.value },
    { mode: 'annotation_rect', type: 'rect', id: activeRectAnnotationId.value, records: rectAnnotations.value },
    { mode: 'annotation_obb', type: 'obb', id: activeObbAnnotationId.value, records: obbAnnotations.value },
  ];
  const currentByMode = byMode.find((item) => item.mode === mode);
  if (currentByMode?.id) {
    const record = currentByMode.records.find((item) => item.id === currentByMode.id);
    if (record) {
      return {
        type: currentByMode.type,
        id: currentByMode.id,
        record,
      };
    }
  }

  const fallback: { type: AnnotationType; id: string | null; records: AnyAnnotationRecord[] }[] = [
    { type: 'text', id: activeAnnotationId.value, records: annotations.value },
    { type: 'cloud', id: activeCloudAnnotationId.value, records: cloudAnnotations.value },
    { type: 'rect', id: activeRectAnnotationId.value, records: rectAnnotations.value },
    { type: 'obb', id: activeObbAnnotationId.value, records: obbAnnotations.value },
  ];
  for (const item of fallback) {
    if (!item.id) continue;
    const record = item.records.find((entry) => entry.id === item.id);
    if (record) {
      return {
        type: item.type,
        id: item.id,
        record,
      };
    }
  }
  return null;
});
const allXeokitMeasurements = computed<XeokitMeasurementRecord[]>(() => {
  return [...xeokitDistanceMeasurements.value, ...xeokitAngleMeasurements.value];
});

const allItems = computed(() => {
  return {
    measurements: measurements.value,
    dimensions: dimensions.value,
    annotations: annotations.value,
    obbAnnotations: obbAnnotations.value,
    cloudAnnotations: cloudAnnotations.value,
    rectAnnotations: rectAnnotations.value,
    xeokitDistanceMeasurements: xeokitDistanceMeasurements.value,
    xeokitAngleMeasurements: xeokitAngleMeasurements.value,
  };
});

export function useToolStore() {
  return {
    activeTab,
    toolMode,
    activeAnnotationId,
    activeObbAnnotationId,
    activeCloudAnnotationId,
    activeRectAnnotationId,
    activeMeasurementId,
    activeDimensionId,
    activeXeokitMeasurementId,
    measurementDetailsDrawerOpen,
    pendingObbEditId,
    pendingTextAnnotationEditId,
    pendingCloudAnnotationEditId,
    pendingRectAnnotationEditId,
    pendingDimensionEditId,

    measurements,
    xeokitDistanceMeasurements,
    xeokitAngleMeasurements,
    dimensions,
    annotations,
    obbAnnotations,
    cloudAnnotations,
    rectAnnotations,

    measurementCount,
    xeokitMeasurementCount,
    dimensionCount,
    annotationCount,
    obbAnnotationCount,
    cloudAnnotationCount,
    rectAnnotationCount,
    allItems,
    allXeokitMeasurements,
    activeAnnotationContext,

    setToolMode,

    // Attribute display functions
    attributeDisplayMode,
    compareMode,
    setAttributeDisplayMode,
    setCompareMode,

    addMeasurement,
    updateMeasurementVisible,
    removeMeasurement,
    clearMeasurements,

    addXeokitDistanceMeasurement,
    updateXeokitDistanceMeasurement,
    addXeokitAngleMeasurement,
    updateXeokitAngleMeasurement,
    updateXeokitMeasurementVisible,
    removeXeokitMeasurement,
    clearXeokitMeasurements,
    setMeasurementDetailsDrawerOpen,
    toggleMeasurementDetailsDrawerOpen,
    currentXeokitDistanceDraft,
    currentXeokitAngleDraft,
    setCurrentXeokitDistanceDraft,
    setCurrentXeokitAngleDraft,
    clearCurrentXeokitDraft,
    xeokitHoverState,
    setXeokitHoverState,
    xeokitMarkerState,
    setXeokitMarkerState,
    xeokitPointerLensState,
    setXeokitPointerLensState,

    addDimension,
    updateDimension,
    updateDimensionVisible,
    removeDimension,
    clearDimensions,

    addAnnotation,
    updateAnnotation,
    updateAnnotationVisible,
    setAnnotationTypeVisible,
    removeAnnotation,
    clearAnnotations,

    addObbAnnotation,
    updateObbAnnotation,
    updateObbAnnotationVisible,
    removeObbAnnotation,
    clearObbAnnotations,

    addCloudAnnotation,
    updateCloudAnnotation,
    updateCloudAnnotationVisible,
    removeCloudAnnotation,
    clearCloudAnnotations,

    addRectAnnotation,
    updateRectAnnotation,
    updateRectAnnotationVisible,
    removeRectAnnotation,
    clearRectAnnotations,
    clearAnnotationType,
    clearAllAnnotations,
    setAllAnnotationsVisible,
    getAnnotationRecordsByType,

    clearAll,

    // 评论/意见管理
    addCommentToAnnotation,
    setAnnotationComments,
    updateAnnotationComment,
    removeAnnotationComment,
    getAnnotationComments,

    exportJSON,
    importJSON,

    pickedQueryCenter,
    setPickedQueryCenter: (val: PickedQueryCenter | null) => {
      pickedQueryCenter.value = val;
    },

    // Ptset 可视化
    ptsetVisualizationRequest,
    requestPtsetVisualization: (refno: string) => {
      ptsetVisualizationRequest.value = { refno, timestamp: Date.now() };
    },
    clearPtsetVisualizationRequest: () => {
      ptsetVisualizationRequest.value = null;
    },

    // MBD 管道标注
    mbdPipeAnnotationRequest,
    requestMbdPipeAnnotation: (refno: string) => {
      mbdPipeAnnotationRequest.value = { refno, timestamp: Date.now() };
    },
    clearMbdPipeAnnotationRequest: () => {
      mbdPipeAnnotationRequest.value = null;
    },

    // ── 通用 refno 拾取 ──
    pickRefnoFilter,
    pickedRefnos,
    pickRefnoCallback,
    startPickRefno,
    addPickedRefno,
    removePickedRefno,
    confirmPickRefno,
    cancelPickRefno,
  };
}
