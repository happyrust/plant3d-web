import { computed, ref, watch } from 'vue';

export type ToolMode =
  | 'none'
  | 'measure_distance'
  | 'measure_angle'
  | 'annotation'
  | 'annotation_cloud'
  | 'annotation_rect'
  | 'annotation_obb'
  | 'pick_query_center';

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

export type AnnotationRecord = {
  id: string;
  entityId: string;
  worldPos: Vec3;
  visible: boolean;
  glyph: string;
  title: string;
  description: string;
  createdAt: number;
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
};

export type CloudAnnotationRecord = {
  id: string;
  points: MeasurementPoint[];
  visible: boolean;
  title: string;
  description: string;
  createdAt: number;
};

export type RectAnnotationRecord = {
  id: string;
  corners: [MeasurementPoint, MeasurementPoint, MeasurementPoint, MeasurementPoint];
  visible: boolean;
  title: string;
  description: string;
  createdAt: number;
};

export type PickedQueryCenter = {
  entityId: string;
  worldPos: Vec3;
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

const STORAGE_KEY_V1 = 'vue-xeokit-tools-v1';
const STORAGE_KEY_V2 = 'vue-xeokit-tools-v2';
const STORAGE_KEY_V3 = 'vue-xeokit-tools-v3';

function normalizeV1(parsed: PersistedStateV1): PersistedStateV3 {
  return {
    version: 3,
    measurements: Array.isArray(parsed.measurements) ? parsed.measurements : [],
    annotations: Array.isArray(parsed.annotations) ? parsed.annotations : [],
    obbAnnotations: [],
    cloudAnnotations: [],
    rectAnnotations: [],
  };
}

function normalizeV2(parsed: PersistedStateV2): PersistedStateV3 {
  return {
    version: 3,
    measurements: Array.isArray(parsed.measurements) ? parsed.measurements : [],
    annotations: Array.isArray(parsed.annotations) ? parsed.annotations : [],
    obbAnnotations: Array.isArray(parsed.obbAnnotations) ? parsed.obbAnnotations : [],
    cloudAnnotations: [],
    rectAnnotations: [],
  };
}

function normalizeV3(parsed: PersistedStateV3): PersistedStateV3 {
  return {
    version: 3,
    measurements: Array.isArray(parsed.measurements) ? parsed.measurements : [],
    annotations: Array.isArray(parsed.annotations) ? parsed.annotations : [],
    obbAnnotations: Array.isArray(parsed.obbAnnotations) ? parsed.obbAnnotations : [],
    cloudAnnotations: Array.isArray(parsed.cloudAnnotations) ? parsed.cloudAnnotations : [],
    rectAnnotations: Array.isArray(parsed.rectAnnotations) ? parsed.rectAnnotations : [],
  };
}

function loadPersisted(): PersistedStateV3 {
  if (typeof localStorage === 'undefined') {
    return { version: 3, measurements: [], annotations: [], obbAnnotations: [], cloudAnnotations: [], rectAnnotations: [] };
  }

  try {
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

  return { version: 3, measurements: [], annotations: [], obbAnnotations: [], cloudAnnotations: [], rectAnnotations: [] };
}

const persisted = loadPersisted();

const measurements = ref<MeasurementRecord[]>(persisted.measurements);
const annotations = ref<AnnotationRecord[]>(persisted.annotations);
const obbAnnotations = ref<ObbAnnotationRecord[]>(persisted.obbAnnotations);
const cloudAnnotations = ref<CloudAnnotationRecord[]>(persisted.cloudAnnotations);
const rectAnnotations = ref<RectAnnotationRecord[]>(persisted.rectAnnotations);

const activeTab = ref<'tree' | 'measurement' | 'annotation' | 'obb_annotation' | 'manager'>('tree');
const toolMode = ref<ToolMode>('none');

const activeAnnotationId = ref<string | null>(null);
const activeObbAnnotationId = ref<string | null>(null);
const activeCloudAnnotationId = ref<string | null>(null);
const activeRectAnnotationId = ref<string | null>(null);

const pickedQueryCenter = ref<PickedQueryCenter | null>(null);

const pendingObbEditId = ref<string | null>(null);

watch(
  () => ({
    measurements: measurements.value,
    annotations: annotations.value,
    obbAnnotations: obbAnnotations.value,
    cloudAnnotations: cloudAnnotations.value,
    rectAnnotations: rectAnnotations.value,
  }),
  (state) => {
    if (typeof localStorage === 'undefined') return;
    const payload: PersistedStateV3 = {
      version: 3,
      measurements: state.measurements,
      annotations: state.annotations,
      obbAnnotations: state.obbAnnotations,
      cloudAnnotations: state.cloudAnnotations,
      rectAnnotations: state.rectAnnotations,
    };
    try {
      localStorage.setItem(STORAGE_KEY_V3, JSON.stringify(payload));
    } catch {
      // ignore
    }
  },
  { deep: true }
);

function setToolMode(mode: ToolMode) {
  toolMode.value = mode;
}

function addMeasurement(rec: MeasurementRecord) {
  measurements.value = [...measurements.value, rec];
}

function updateMeasurementVisible(id: string, visible: boolean) {
  measurements.value = measurements.value.map((m) => (m.id === id ? { ...m, visible } : m));
}

function removeMeasurement(id: string) {
  measurements.value = measurements.value.filter((m) => m.id !== id);
}

function clearMeasurements() {
  measurements.value = [];
}

function addAnnotation(rec: AnnotationRecord) {
  annotations.value = [...annotations.value, rec];
  activeAnnotationId.value = rec.id;
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
  pendingObbEditId.value = rec.id;
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
  clearAnnotations();
  clearObbAnnotations();
  clearCloudAnnotations();
  clearRectAnnotations();
  toolMode.value = 'none';
}

function exportJSON(): string {
  const payload: PersistedStateV3 = {
    version: 3,
    measurements: measurements.value,
    annotations: annotations.value,
    obbAnnotations: obbAnnotations.value,
    cloudAnnotations: cloudAnnotations.value,
    rectAnnotations: rectAnnotations.value,
  };
  return JSON.stringify(payload, null, 2);
}

function importJSON(raw: string) {
  const parsed = JSON.parse(raw) as PersistedStateV1 | PersistedStateV2 | PersistedStateV3;
  if (!parsed || (parsed.version !== 1 && parsed.version !== 2 && parsed.version !== 3)) {
    throw new Error('Unsupported tools JSON format');
  }

  const v3 =
    parsed.version === 1
      ? normalizeV1(parsed)
      : parsed.version === 2
        ? normalizeV2(parsed)
        : normalizeV3(parsed);

  measurements.value = v3.measurements;
  annotations.value = v3.annotations;
  obbAnnotations.value = v3.obbAnnotations;
  cloudAnnotations.value = v3.cloudAnnotations;
  rectAnnotations.value = v3.rectAnnotations;

  activeAnnotationId.value = null;
  activeObbAnnotationId.value = null;
  activeCloudAnnotationId.value = null;
  activeRectAnnotationId.value = null;
  toolMode.value = 'none';
}

const measurementCount = computed(() => measurements.value.length);
const annotationCount = computed(() => annotations.value.length);
const obbAnnotationCount = computed(() => obbAnnotations.value.length);
const cloudAnnotationCount = computed(() => cloudAnnotations.value.length);
const rectAnnotationCount = computed(() => rectAnnotations.value.length);

const allItems = computed(() => {
  return {
    measurements: measurements.value,
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
    pendingObbEditId,

    measurements,
    annotations,
    obbAnnotations,
    cloudAnnotations,
    rectAnnotations,

    measurementCount,
    annotationCount,
    obbAnnotationCount,
    cloudAnnotationCount,
    rectAnnotationCount,
    allItems,

    setToolMode,

    addMeasurement,
    updateMeasurementVisible,
    removeMeasurement,
    clearMeasurements,

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

    exportJSON,
    importJSON,

    pickedQueryCenter,
    setPickedQueryCenter: (val: PickedQueryCenter | null) => {
      pickedQueryCenter.value = val;
    },
  };
}
