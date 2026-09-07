import { computed, ref, watch } from 'vue';

export type LengthUnit = 'm' | 'cm' | 'mm'
export type ModelUnit = 'mm' | 'm' | 'raw'
export type PtsetDisplayPolicy = 'follow_backend' | 'use_display_unit'

type PersistedStateV2 = {
  version: 2
  modelUnit: ModelUnit
  displayUnit: LengthUnit
  precision: number
  recenter: boolean
  clip: boolean
  autoFitOnLoad: boolean
  ptsetDisplayPolicy: PtsetDisplayPolicy
}

const STORAGE_KEY_V1 = 'plant3d-web-unit-settings-v1';
const STORAGE_KEY_V2 = 'plant3d-web-unit-settings-v2';

function clampInt(n: number, min: number, max: number): number {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, v));
}

function loadPersisted(): PersistedStateV2 {
  const defaults: PersistedStateV2 = {
    version: 2,
    // 现状：DTX 默认按 mm 源数据归一化到 m
    modelUnit: 'mm',
    // E3D 工程惯例：距离默认按 mm 整数显示（V2 起）。
    displayUnit: 'mm',
    precision: 0,
    recenter: true,
    clip: true,
    autoFitOnLoad: true,
    ptsetDisplayPolicy: 'use_display_unit',
  };

  if (typeof localStorage === 'undefined') return defaults;
  try {
    const rawV2 = localStorage.getItem(STORAGE_KEY_V2);
    const raw = rawV2 ?? localStorage.getItem(STORAGE_KEY_V1);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<PersistedStateV2> & { version?: number };
    if (parsed.version !== 1 && parsed.version !== 2) return defaults;

    const modelUnit: ModelUnit = parsed.modelUnit === 'm' || parsed.modelUnit === 'raw' ? parsed.modelUnit : 'mm';
    const recenter = parsed.recenter ?? defaults.recenter;
    const clip = parsed.clip ?? defaults.clip;
    const autoFitOnLoad = parsed.autoFitOnLoad ?? defaults.autoFitOnLoad;
    const ptsetDisplayPolicy: PtsetDisplayPolicy = parsed.ptsetDisplayPolicy === 'follow_backend' ? 'follow_backend' : 'use_display_unit';

    // V1 → V2 迁移：显示单位一次性切到 E3D 默认 mm + 0 位小数，用户之后可改回并持久化。
    const displayUnit: LengthUnit = rawV2
      ? (parsed.displayUnit === 'cm' || parsed.displayUnit === 'm' ? parsed.displayUnit : 'mm')
      : 'mm';
    const precision = rawV2
      ? clampInt(parsed.precision ?? defaults.precision, 0, 6)
      : 0;

    return {
      version: 2,
      modelUnit,
      displayUnit,
      precision,
      recenter,
      clip,
      autoFitOnLoad,
      ptsetDisplayPolicy,
    };
  } catch {
    return defaults;
  }
}

// 全局状态（单例 store）
const persisted = loadPersisted();
const modelUnit = ref<ModelUnit>(persisted.modelUnit);
const displayUnit = ref<LengthUnit>(persisted.displayUnit);
const precision = ref<number>(persisted.precision);
const recenter = ref<boolean>(persisted.recenter);
const clip = ref<boolean>(persisted.clip);
const autoFitOnLoad = ref<boolean>(persisted.autoFitOnLoad);
const ptsetDisplayPolicy = ref<PtsetDisplayPolicy>(persisted.ptsetDisplayPolicy);

watch(
  () => ({
    version: 2,
    modelUnit: modelUnit.value,
    displayUnit: displayUnit.value,
    precision: clampInt(precision.value, 0, 6),
    recenter: recenter.value,
    clip: clip.value,
    autoFitOnLoad: autoFitOnLoad.value,
    ptsetDisplayPolicy: ptsetDisplayPolicy.value,
  }),
  (state) => {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(STORAGE_KEY_V2, JSON.stringify(state));
    } catch {
      // ignore
    }
  },
  { deep: true }
);

export function useUnitSettingsStore() {
  const modelUnitValue = computed(() => modelUnit.value);
  const displayUnitValue = computed(() => displayUnit.value);
  const precisionValue = computed(() => clampInt(precision.value, 0, 6));
  const recenterValue = computed(() => recenter.value);
  const clipValue = computed(() => clip.value);
  const autoFitOnLoadValue = computed(() => autoFitOnLoad.value);
  const ptsetDisplayPolicyValue = computed(() => ptsetDisplayPolicy.value);

  function setModelUnit(v: ModelUnit) {
    modelUnit.value = v;
  }

  function setDisplayUnit(v: LengthUnit) {
    displayUnit.value = v;
  }

  function setPrecision(v: number) {
    precision.value = clampInt(v, 0, 6);
  }

  function setRecenter(v: boolean) {
    recenter.value = v;
  }

  function setClip(v: boolean) {
    clip.value = v;
  }

  function setAutoFitOnLoad(v: boolean) {
    autoFitOnLoad.value = v;
  }

  function setPtsetDisplayPolicy(v: PtsetDisplayPolicy) {
    ptsetDisplayPolicy.value = v;
  }

  return {
    modelUnit: modelUnitValue,
    displayUnit: displayUnitValue,
    precision: precisionValue,
    recenter: recenterValue,
    clip: clipValue,
    autoFitOnLoad: autoFitOnLoadValue,
    ptsetDisplayPolicy: ptsetDisplayPolicyValue,
    setModelUnit,
    setDisplayUnit,
    setPrecision,
    setRecenter,
    setClip,
    setAutoFitOnLoad,
    setPtsetDisplayPolicy,
  };
}

