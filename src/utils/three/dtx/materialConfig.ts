import { Color } from 'three'

export type MaterialConfigEntry = {
  name?: string
  color?: string | number
  metalness?: number
  roughness?: number
  opacity?: number
  hidden?: boolean
}

export type ModelDisplayConfig = {
  version?: string
  description?: string
  lastModified?: string
  displaySettings?: {
    hiddenNouns?: string[]
    hiddenRefnos?: string[]
    defaultVisible?: boolean
  }
  defaultMaterial?: MaterialConfigEntry
  materialConfigs?: Record<string, MaterialConfigEntry>
  instanceConfigs?: Record<string, MaterialConfigEntry>
  /** spec_value (专业) → 颜色覆盖；如 { "3": "#4CAF50", "4": "#FF9800" } */
  disciplineOverrides?: Record<string, string>
}

export type ResolvedMaterial = {
  color: Color
  metalness: number
  roughness: number
  hidden: boolean
}

export const DEFAULT_CONFIG_URL = 'config/model-display.config.json'
export const LOCAL_STORAGE_KEY = 'dtx_material_config'

const DEFAULT_MATERIAL: MaterialConfigEntry = {
  color: '#90a4ae',
  metalness: 0.1,
  roughness: 0.5,
}

let cachedConfig: ModelDisplayConfig | null = null
let cachedPromise: Promise<ModelDisplayConfig> | null = null

export function normalizeNounKey(value: string): string {
  return String(value || '').trim().toUpperCase()
}

export function normalizeRefnoKey(value: string): string {
  return String(value || '').trim().replace('/', '_')
}

function clamp01(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.min(1, Math.max(0, value))
}

function parseColorToNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed.startsWith('#')) {
      const hex = trimmed.slice(1)
      if (hex.length === 6 || hex.length === 3) {
        return parseInt(hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex, 16)
      }
    }
    if (trimmed.startsWith('0x')) {
      const hex = trimmed.slice(2)
      if (hex.length > 0) return parseInt(hex, 16)
    }
  }
  return null
}

function toThreeColor(value: unknown, fallback: string | number): Color {
  const num = parseColorToNumber(value)
  if (num !== null) return new Color(num)
  if (typeof value === 'string' && value.trim()) return new Color(value as string)
  const fallbackNum = parseColorToNumber(fallback)
  if (fallbackNum !== null) return new Color(fallbackNum)
  if (typeof fallback === 'string' && fallback.trim()) return new Color(fallback as string)
  return new Color('#90a4ae')
}

function normalizeMaterialMap(
  map?: Record<string, MaterialConfigEntry>
): Record<string, MaterialConfigEntry> {
  const out: Record<string, MaterialConfigEntry> = {}
  if (!map) return out
  for (const [key, value] of Object.entries(map)) {
    const noun = normalizeNounKey(key)
    if (!noun) continue
    out[noun] = { ...(value || {}) }
  }
  return out
}

function loadLocalConfig(): {
  nounConfigs?: Record<string, MaterialConfigEntry>
  instanceConfigs?: Record<string, MaterialConfigEntry>
} | null {
  if (typeof window === 'undefined' || !window.localStorage) return null
  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as {
      nounConfigs?: Record<string, MaterialConfigEntry>
      materialConfigs?: Record<string, MaterialConfigEntry>
      instanceConfigs?: Record<string, MaterialConfigEntry>
    }
    return {
      nounConfigs: parsed.nounConfigs || parsed.materialConfigs,
      instanceConfigs: parsed.instanceConfigs || {},
    }
  } catch {
    return null
  }
}

function normalizeDisplaySettings(input: ModelDisplayConfig['displaySettings']): ModelDisplayConfig['displaySettings'] {
  const hiddenNouns = (input?.hiddenNouns || [])
    .map((n) => normalizeNounKey(String(n || '')))
    .filter(Boolean)
  const hiddenRefnos = (input?.hiddenRefnos || [])
    .map((r) => normalizeRefnoKey(String(r || '')))
    .filter(Boolean)
  return {
    hiddenNouns,
    hiddenRefnos,
    defaultVisible: input?.defaultVisible ?? true,
  }
}

function mergeConfigs(fileConfig: ModelDisplayConfig, localConfig: ReturnType<typeof loadLocalConfig>): ModelDisplayConfig {
  const baseMaterialConfigs = normalizeMaterialMap(fileConfig.materialConfigs)
  const localMaterialConfigs = normalizeMaterialMap(localConfig?.nounConfigs)
  const mergedMaterialConfigs = {
    ...baseMaterialConfigs,
    ...localMaterialConfigs,
  }
  const instanceConfigs = {
    ...(fileConfig.instanceConfigs || {}),
    ...(localConfig?.instanceConfigs || {}),
  }

  return {
    ...fileConfig,
    displaySettings: normalizeDisplaySettings(fileConfig.displaySettings),
    defaultMaterial: {
      ...DEFAULT_MATERIAL,
      ...(fileConfig.defaultMaterial || {}),
    },
    materialConfigs: mergedMaterialConfigs,
    instanceConfigs,
  }
}

export async function loadModelDisplayConfig(options: { url?: string; force?: boolean } = {}): Promise<ModelDisplayConfig> {
  if (!options.force && cachedConfig) return cachedConfig
  if (!options.force && cachedPromise) return cachedPromise

  const url = options.url || DEFAULT_CONFIG_URL
  cachedPromise = (async () => {
    let fileConfig: ModelDisplayConfig = {}
    try {
      const res = await fetch(url, { cache: 'no-cache' })
      if (res.ok) {
        fileConfig = await res.json()
      }
    } catch {
      fileConfig = {}
    }

    const localConfig = loadLocalConfig()
    const merged = mergeConfigs(fileConfig, localConfig)
    cachedConfig = merged
    cachedPromise = null
    return merged
  })()

  return cachedPromise
}

export function clearModelDisplayConfigCache(): void {
  cachedConfig = null
  cachedPromise = null
}

export function saveLocalMaterialConfig(payload: {
  nounConfigs: Record<string, MaterialConfigEntry>
  instanceConfigs?: Record<string, MaterialConfigEntry>
}): void {
  if (typeof window === 'undefined' || !window.localStorage) return
  const safePayload = {
    nounConfigs: normalizeMaterialMap(payload.nounConfigs),
    instanceConfigs: payload.instanceConfigs || {},
  }
  window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(safePayload))
  clearModelDisplayConfigCache()
}

export function normalizeColorString(value: unknown, fallback: string = DEFAULT_MATERIAL.color as string): string {
  const num = parseColorToNumber(value)
  if (num !== null) {
    return `#${num.toString(16).padStart(6, '0')}`
  }
  if (typeof value === 'string' && value.trim()) {
    const trimmed = value.trim()
    if (trimmed.startsWith('#')) return trimmed
    if (trimmed.startsWith('0x')) {
      const hex = trimmed.slice(2)
      if (hex) return `#${hex.padStart(6, '0')}`
    }
    if (/^[0-9a-fA-F]{6}$/.test(trimmed)) return `#${trimmed.toLowerCase()}`
  }
  return fallback
}

export function buildHiddenNounSet(config: ModelDisplayConfig): Set<string> {
  const list = config.displaySettings?.hiddenNouns || []
  return new Set(list.map((n) => normalizeNounKey(String(n || ''))).filter(Boolean))
}

export function buildHiddenRefnoSet(config: ModelDisplayConfig): Set<string> {
  const list = config.displaySettings?.hiddenRefnos || []
  return new Set(list.map((r) => normalizeRefnoKey(String(r || ''))).filter(Boolean))
}

export function resolveMaterialForInstance(
  config: ModelDisplayConfig,
  refno: string,
  noun: string,
  spec_value?: number | null
): ResolvedMaterial {
  const defaultMaterial: MaterialConfigEntry = {
    ...DEFAULT_MATERIAL,
    ...(config.defaultMaterial || {}),
  }
  const materialConfigs = config.materialConfigs || {}
  const instanceConfigs = config.instanceConfigs || {}
  const disciplineOverrides = config.disciplineOverrides || {}

  const nounKey = normalizeNounKey(noun)
  const refnoKey = normalizeRefnoKey(refno)
  const instConfig = instanceConfigs[refnoKey]
  const nounConfig = nounKey ? materialConfigs[nounKey] : undefined
  const chosen: MaterialConfigEntry = instConfig || nounConfig || defaultMaterial

  const fallbackColor =
    defaultMaterial.color !== undefined ? defaultMaterial.color : (DEFAULT_MATERIAL.color ?? '#90a4ae')
  let colorValue = chosen.color ?? fallbackColor
  // 按专业覆盖颜色：spec_value 0=PIPE, 3=INST, 4=HVAC 等
  if (spec_value != null && disciplineOverrides[String(spec_value)]) {
    colorValue = disciplineOverrides[String(spec_value)]
  }
  const baseMetalness = typeof defaultMaterial.metalness === 'number' ? defaultMaterial.metalness : 0.1
  const baseRoughness = typeof defaultMaterial.roughness === 'number' ? defaultMaterial.roughness : 0.5
  const metalness = clamp01(
    typeof chosen.metalness === 'number' ? chosen.metalness : baseMetalness,
    baseMetalness
  )
  const roughness = clamp01(
    typeof chosen.roughness === 'number' ? chosen.roughness : baseRoughness,
    baseRoughness
  )
  const hidden = Boolean(chosen.hidden) || (typeof chosen.opacity === 'number' && chosen.opacity <= 0)

  return {
    color: toThreeColor(colorValue, fallbackColor),
    metalness,
    roughness,
    hidden,
  }
}

export function buildExportConfig(config: ModelDisplayConfig): ModelDisplayConfig {
  const baseDisplay = normalizeDisplaySettings(config.displaySettings)
  const materialConfigs = config.materialConfigs || {}
  const hiddenNouns: string[] = []

  const exportedMaterialConfigs: Record<string, MaterialConfigEntry> = {}
  for (const [noun, entry] of Object.entries(materialConfigs)) {
    const color = normalizeColorString(entry.color)
    const metalness = typeof entry.metalness === 'number' ? entry.metalness : undefined
    const roughness = typeof entry.roughness === 'number' ? entry.roughness : undefined
    const next: MaterialConfigEntry = {
      ...entry,
      color,
      metalness,
      roughness,
    }
    exportedMaterialConfigs[noun] = next
    if (next.hidden || (typeof next.opacity === 'number' && next.opacity <= 0)) {
      hiddenNouns.push(noun)
    }
  }

  return {
    version: config.version || '1.0',
    description: config.description || 'model-display.config.json',
    lastModified: new Date().toISOString().slice(0, 10),
    displaySettings: {
      ...baseDisplay,
      hiddenNouns,
    },
    defaultMaterial: {
      ...DEFAULT_MATERIAL,
      ...(config.defaultMaterial || {}),
      color: normalizeColorString(config.defaultMaterial?.color),
    },
    materialConfigs: exportedMaterialConfigs,
  }
}
