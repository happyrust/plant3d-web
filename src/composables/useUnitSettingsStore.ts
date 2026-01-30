import { computed, ref, watch } from 'vue'

export type LengthUnit = 'm' | 'cm' | 'mm'
export type ModelUnit = 'mm' | 'm' | 'raw'
export type PtsetDisplayPolicy = 'follow_backend' | 'use_display_unit'

type PersistedStateV1 = {
  version: 1
  modelUnit: ModelUnit
  displayUnit: LengthUnit
  precision: number
  recenter: boolean
  clip: boolean
  autoFitOnLoad: boolean
  ptsetDisplayPolicy: PtsetDisplayPolicy
}

const STORAGE_KEY = 'plant3d-web-unit-settings-v1'

function clampInt(n: number, min: number, max: number): number {
  const v = Math.floor(Number(n))
  if (!Number.isFinite(v)) return min
  return Math.max(min, Math.min(max, v))
}

function loadPersisted(): PersistedStateV1 {
  const defaults: PersistedStateV1 = {
    version: 1,
    // 现状：DTX 默认按 mm 源数据归一化到 m
    modelUnit: 'mm',
    // 现状：UI 多处默认按 m（一期保持一致）
    displayUnit: 'm',
    precision: 2,
    recenter: true,
    clip: true,
    autoFitOnLoad: true,
    ptsetDisplayPolicy: 'use_display_unit',
  }

  if (typeof localStorage === 'undefined') return defaults
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaults
    const parsed = JSON.parse(raw) as Partial<PersistedStateV1>
    if (parsed.version !== 1) return defaults

    const modelUnit: ModelUnit = parsed.modelUnit === 'm' || parsed.modelUnit === 'raw' ? parsed.modelUnit : 'mm'
    const displayUnit: LengthUnit = parsed.displayUnit === 'cm' || parsed.displayUnit === 'mm' ? parsed.displayUnit : 'm'
    const precision = clampInt(parsed.precision ?? defaults.precision, 0, 6)
    const recenter = parsed.recenter ?? defaults.recenter
    const clip = parsed.clip ?? defaults.clip
    const autoFitOnLoad = parsed.autoFitOnLoad ?? defaults.autoFitOnLoad
    const ptsetDisplayPolicy: PtsetDisplayPolicy = parsed.ptsetDisplayPolicy === 'follow_backend' ? 'follow_backend' : 'use_display_unit'

    return {
      version: 1,
      modelUnit,
      displayUnit,
      precision,
      recenter,
      clip,
      autoFitOnLoad,
      ptsetDisplayPolicy,
    }
  } catch {
    return defaults
  }
}

// 全局状态（单例 store）
const persisted = loadPersisted()
const modelUnit = ref<ModelUnit>(persisted.modelUnit)
const displayUnit = ref<LengthUnit>(persisted.displayUnit)
const precision = ref<number>(persisted.precision)
const recenter = ref<boolean>(persisted.recenter)
const clip = ref<boolean>(persisted.clip)
const autoFitOnLoad = ref<boolean>(persisted.autoFitOnLoad)
const ptsetDisplayPolicy = ref<PtsetDisplayPolicy>(persisted.ptsetDisplayPolicy)

watch(
  () => ({
    version: 1,
    modelUnit: modelUnit.value,
    displayUnit: displayUnit.value,
    precision: clampInt(precision.value, 0, 6),
    recenter: recenter.value,
    clip: clip.value,
    autoFitOnLoad: autoFitOnLoad.value,
    ptsetDisplayPolicy: ptsetDisplayPolicy.value,
  }),
  (state) => {
    if (typeof localStorage === 'undefined') return
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch {
      // ignore
    }
  },
  { deep: true }
)

export function useUnitSettingsStore() {
  const modelUnitValue = computed(() => modelUnit.value)
  const displayUnitValue = computed(() => displayUnit.value)
  const precisionValue = computed(() => clampInt(precision.value, 0, 6))
  const recenterValue = computed(() => recenter.value)
  const clipValue = computed(() => clip.value)
  const autoFitOnLoadValue = computed(() => autoFitOnLoad.value)
  const ptsetDisplayPolicyValue = computed(() => ptsetDisplayPolicy.value)

  function setModelUnit(v: ModelUnit) {
    modelUnit.value = v
  }

  function setDisplayUnit(v: LengthUnit) {
    displayUnit.value = v
  }

  function setPrecision(v: number) {
    precision.value = clampInt(v, 0, 6)
  }

  function setRecenter(v: boolean) {
    recenter.value = v
  }

  function setClip(v: boolean) {
    clip.value = v
  }

  function setAutoFitOnLoad(v: boolean) {
    autoFitOnLoad.value = v
  }

  function setPtsetDisplayPolicy(v: PtsetDisplayPolicy) {
    ptsetDisplayPolicy.value = v
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
  }
}

