import { computed, ref, watch } from 'vue';

import type { AnnotationComment } from '@/types/auth';

export type ToolMode =
  | 'none'
  | 'measure_distance'
  | 'measure_angle'
  | 'measure_point_to_object'
  | 'dimension_linear'
  | 'dimension_angle'
  | 'annotation'
  | 'annotation_cloud'
  | 'annotation_rect'
  | 'annotation_obb'
  | 'pick_query_center';

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
  visible: boolean;
  title: string;
  description: string;
  createdAt: number;
  refnos?: string[]; // 关联的对象参考号列表
  comments?: AnnotationComment[]; // 多角色意见列表
};

export type RectAnnotationRecord = {
  id: string;
  corners: [MeasurementPoint, MeasurementPoint, MeasurementPoint, MeasurementPoint];
  visible: boolean;
  title: string;
  description: string;
  createdAt: number;
  comments?: AnnotationComment[]; // 多角色意见列表
};

export type PickedQueryCenter = {
  entityId: string;
  worldPos: Vec3;
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

const STORAGE_KEY_V1 = 'plant3d-web-tools-v1';
const STORAGE_KEY_V2 = 'plant3d-web-tools-v2';
const STORAGE_KEY_V3 = 'plant3d-web-tools-v3';
const STORAGE_KEY_V4 = 'plant3d-web-tools-v4';

function normalizeV1(parsed: PersistedStateV1): PersistedStateV4 {
  return {
    version: 4,
    measurements: Array.isArray(parsed.measurements) ? parsed.measurements : [],
    annotations: Array.isArray(parsed.annotations) ? parsed.annotations : [],
    obbAnnotations: [],
    cloudAnnotations: [],
    rectAnnotations: [],
    dimensions: [],
  };
}

function normalizeV2(parsed: PersistedStateV2): PersistedStateV4 {
  return {
    version: 4,
    measurements: Array.isArray(parsed.measurements) ? parsed.measurements : [],
    annotations: Array.isArray(parsed.annotations) ? parsed.annotations : [],
    obbAnnotations: Array.isArray(parsed.obbAnnotations) ? parsed.obbAnnotations : [],
    cloudAnnotations: [],
    rectAnnotations: [],
    dimensions: [],
  };
}

function normalizeV3(parsed: PersistedStateV3): PersistedStateV4 {
  return {
    version: 4,
    measurements: Array.isArray(parsed.measurements) ? parsed.measurements : [],
    annotations: Array.isArray(parsed.annotations) ? parsed.annotations : [],
    obbAnnotations: Array.isArray(parsed.obbAnnotations) ? parsed.obbAnnotations : [],
    cloudAnnotations: Array.isArray(parsed.cloudAnnotations) ? parsed.cloudAnnotations : [],
    rectAnnotations: Array.isArray(parsed.rectAnnotations) ? parsed.rectAnnotations : [],
    dimensions: [],
  };
}

function normalizeV4(parsed: PersistedStateV4): PersistedStateV4 {
  return {
    version: 4,
    measurements: Array.isArray(parsed.measurements) ? parsed.measurements : [],
    annotations: Array.isArray(parsed.annotations) ? parsed.annotations : [],
    obbAnnotations: Array.isArray(parsed.obbAnnotations) ? parsed.obbAnnotations : [],
    cloudAnnotations: Array.isArray(parsed.cloudAnnotations) ? parsed.cloudAnnotations : [],
    rectAnnotations: Array.isArray(parsed.rectAnnotations) ? parsed.rectAnnotations : [],
    dimensions: Array.isArray(parsed.dimensions) ? parsed.dimensions : [],
  };
}

function loadPersisted(): PersistedStateV4 {
  if (typeof localStorage === 'undefined') {
    return { version: 4, measurements: [], annotations: [], obbAnnotations: [], cloudAnnotations: [], rectAnnotations: [], dimensions: [] };
  }

  try {
    const rawV4 = localStorage.getItem(STORAGE_KEY_V4);
    if (rawV4) {
      const parsed = JSON.parse(rawV4) as PersistedStateV4;
      if (parsed && parsed.version === 4) {
        return normalizeV4(parsed);
      }
    }

    const rawV3 = localStorage.getItem(STORAGE_KEY_V3);
    if (rawV3) {
      const parsed = JSON.parse(rawV3) as PersistedStateV3;
      if (parsed && parsed.version === 3) {
        return normalizeV3(parsed);
      }
    }

    const rawV2 = localStorage.getItem(STORAGE_KEY_V2);
    if (rawV2) {
      const parsed = JSON.parse(rawV2) as PersistedStateV2;
      if (parsed && parsed.version === 2) {
        return normalizeV2(parsed);
      }
    }

    const rawV1 = localStorage.getItem(STORAGE_KEY_V1);
    if (rawV1) {
      const parsed = JSON.parse(rawV1) as PersistedStateV1;
      if (parsed && parsed.version === 1) {
        return normalizeV1(parsed);
      }
    }
  } catch {
    // ignore
  }

  return { version: 4, measurements: [], annotations: [], obbAnnotations: [], cloudAnnotations: [], rectAnnotations: [], dimensions: [] };
}

const persisted = loadPersisted();

const measurements = ref<MeasurementRecord[]>(persisted.measurements);
const annotations = ref<AnnotationRecord[]>(persisted.annotations);
const obbAnnotations = ref<ObbAnnotationRecord[]>(persisted.obbAnnotations);
const cloudAnnotations = ref<CloudAnnotationRecord[]>(persisted.cloudAnnotations);
const rectAnnotations = ref<RectAnnotationRecord[]>(persisted.rectAnnotations);
const dimensions = ref<DimensionRecord[]>(persisted.dimensions);

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

const pickedQueryCenter = ref<PickedQueryCenter | null>(null);

// Ptset 可视化请求
const ptsetVisualizationRequest = ref<PtsetVisualizationRequest | null>(null);
// MBD 管道标注请求
const mbdPipeAnnotationRequest = ref<MbdPipeAnnotationRequest | null>(null);

const pendingObbEditId = ref<string | null>(null);
const pendingTextAnnotationEditId = ref<string | null>(null);
const pendingDimensionEditId = ref<string | null>(null);

watch(
  () => ({
    measurements: measurements.value,
    annotations: annotations.value,
    obbAnnotations: obbAnnotations.value,
    cloudAnnotations: cloudAnnotations.value,
    rectAnnotations: rectAnnotations.value,
    dimensions: dimensions.value,
  }),
  (state) => {
    if (typeof localStorage === 'undefined') return;
    const payload: PersistedStateV4 = {
      version: 4,
      measurements: state.measurements,
      annotations: state.annotations,
      obbAnnotations: state.obbAnnotations,
      cloudAnnotations: state.cloudAnnotations,
      rectAnnotations: state.rectAnnotations,
      dimensions: state.dimensions,
    };
    try {
      localStorage.setItem(STORAGE_KEY_V4, JSON.stringify(payload));
    } catch {
      // ignore
    }
  },
  { deep: true }
);

function setToolMode(mode: ToolMode) {
  toolMode.value = mode;
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
  annotations.value = [...annotations.value, rec];
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
}

function addCloudAnnotation(rec: CloudAnnotationRecord) {
  cloudAnnotations.value = [...cloudAnnotations.value, rec];
  activeCloudAnnotationId.value = rec.id;
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
}

function clearCloudAnnotations() {
  cloudAnnotations.value = [];
  activeCloudAnnotationId.value = null;
}

function addRectAnnotation(rec: RectAnnotationRecord) {
  rectAnnotations.value = [...rectAnnotations.value, rec];
  activeRectAnnotationId.value = rec.id;
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
}

function clearRectAnnotations() {
  rectAnnotations.value = [];
  activeRectAnnotationId.value = null;
}

function clearAll() {
  clearMeasurements();
  clearDimensions();
  clearAnnotations();
  clearObbAnnotations();
  clearCloudAnnotations();
  clearRectAnnotations();
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
  const payload: PersistedStateV4 = {
    version: 4,
    measurements: measurements.value,
    annotations: annotations.value,
    obbAnnotations: obbAnnotations.value,
    cloudAnnotations: cloudAnnotations.value,
    rectAnnotations: rectAnnotations.value,
    dimensions: dimensions.value,
  };
  return JSON.stringify(payload, null, 2);
}

function importJSON(raw: string) {
  const parsed = JSON.parse(raw) as PersistedStateV1 | PersistedStateV2 | PersistedStateV3 | PersistedStateV4;
  if (!parsed || (parsed.version !== 1 && parsed.version !== 2 && parsed.version !== 3 && parsed.version !== 4)) {
    throw new Error('Unsupported tools JSON format');
  }

  const v4 =
    parsed.version === 1
      ? normalizeV1(parsed)
      : parsed.version === 2
        ? normalizeV2(parsed)
        : parsed.version === 3
          ? normalizeV3(parsed)
          : normalizeV4(parsed);

  measurements.value = v4.measurements;
  annotations.value = v4.annotations;
  obbAnnotations.value = v4.obbAnnotations;
  cloudAnnotations.value = v4.cloudAnnotations;
  rectAnnotations.value = v4.rectAnnotations;
  dimensions.value = v4.dimensions;

  activeAnnotationId.value = null;
  activeObbAnnotationId.value = null;
  activeCloudAnnotationId.value = null;
  activeRectAnnotationId.value = null;
  activeMeasurementId.value = null;
  activeDimensionId.value = null;
  pendingDimensionEditId.value = null;
  toolMode.value = 'none';
}

const measurementCount = computed(() => measurements.value.length);
const annotationCount = computed(() => annotations.value.length);
const obbAnnotationCount = computed(() => obbAnnotations.value.length);
const cloudAnnotationCount = computed(() => cloudAnnotations.value.length);
const rectAnnotationCount = computed(() => rectAnnotations.value.length);
const dimensionCount = computed(() => dimensions.value.length);

const allItems = computed(() => {
  return {
    measurements: measurements.value,
    dimensions: dimensions.value,
    annotations: annotations.value,
    obbAnnotations: obbAnnotations.value,
    cloudAnnotations: cloudAnnotations.value,
    rectAnnotations: rectAnnotations.value,
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
    pendingObbEditId,
    pendingTextAnnotationEditId,
    pendingDimensionEditId,

    measurements,
    dimensions,
    annotations,
    obbAnnotations,
    cloudAnnotations,
    rectAnnotations,

    measurementCount,
    dimensionCount,
    annotationCount,
    obbAnnotationCount,
    cloudAnnotationCount,
    rectAnnotationCount,
    allItems,

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

    addDimension,
    updateDimension,
    updateDimensionVisible,
    removeDimension,
    clearDimensions,

    addAnnotation,
    updateAnnotation,
    updateAnnotationVisible,
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
  };
}
