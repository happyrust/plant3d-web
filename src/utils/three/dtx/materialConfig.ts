import { Color } from 'three';

import type { DisplayTheme } from '@/composables/useDisplayThemeStore';

import { isPdmsColourRef, pdmsColourHex } from '@/viewer/e3dLook/pdmsColourTable';

export type MaterialConfigEntry = {
  name?: string
  /**
   * 颜色：`#rrggbb` / `0x…` / 数字 / CSS 颜色名，或 **PDMS 颜色** `pdms:<名|号>`（如 `pdms:lightgrey`、`pdms:271`，
   * 查 E3D 3.1 颜色表 `pdmsColourTable.ts`；注意 PDMS lightgrey = #bdbdbd，与 CSS lightgrey #d3d3d3 不是一回事）
   */
  color?: string | number
  metalness?: number
  roughness?: number
  opacity?: number
  hidden?: boolean
}

export type ThemeConfig = {
  name?: string
  ownerOverrides?: Record<string, MaterialConfigEntry>
  ownerSpecOverrides?: Record<string, Record<string, MaterialConfigEntry>>
  /**
   * E3D 风格：管路（owner 为 BRAN/HANG 或 noun 为 TUBI）按专业着色。
   * 键为 spec_value 字符串（"1"=PIPE "2"=ELEC "3"=INST "4"=HVAC "5"=CIVIL "6"=STRU）。
   */
  disciplineMaterials?: Record<string, MaterialConfigEntry>
  /**
   * E3D 风格：重点构件类型（VALV/FLAN/INST 等）的强调材质，优先于专业基色，
   * 使阀门/法兰/仪表在同色管路中保持可辨识（对齐 E3D autocolour 惯例）。
   */
  nounAccents?: Record<string, MaterialConfigEntry>
  /**
   * 主题基础材质：nounAccents / disciplineMaterials / owner 覆盖都没命中时用它，**压过** materialConfigs 的类型基色。
   * 对应 E3D 的「Add element colour」——出厂 E3D 3.1 autocolour 关、所有元素都画 lightgrey，
   * 就是一条只有 baseMaterial 的主题（`e3dFactory`）。
   */
  baseMaterial?: MaterialConfigEntry
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
  /**
   * 无主题（default）路径下按专业覆盖管路颜色；键为 spec_value 字符串。
   * spec_value: 0=未分类（不覆盖） 1=PIPE 2=ELEC 3=INST 4=HVAC 5=CIVIL 6=STRU
   */
  disciplineOverrides?: Record<string, string>
  /**
   * 无效直管的告警材质（gen-model `is_invalid_tubi`：长度 ≤ 0 / 两端重合等，plant-ui 画虚线，这里先画告警色实体，
   * plan 2026-09-06 Q2）。缺省琥珀色；不受主题 / 专业 / 类型基色影响，只让 instanceConfigs 的显式覆盖压过。
   */
  invalidTubiMaterial?: MaterialConfigEntry
  themes?: Record<string, ThemeConfig>
}

export type ResolvedMaterial = {
  color: Color
  metalness: number
  roughness: number
  opacity: number
  hidden: boolean
}

export const DEFAULT_CONFIG_URL = 'config/model-display.config.json';
export const LOCAL_STORAGE_KEY = 'dtx_material_config';

const DEFAULT_MATERIAL: MaterialConfigEntry = {
  color: '#90a4ae',
  metalness: 0.1,
  roughness: 0.5,
};

let cachedConfig: ModelDisplayConfig | null = null;
let cachedPromise: Promise<ModelDisplayConfig> | null = null;

export function normalizeNounKey(value: string): string {
  return String(value || '').trim().toUpperCase();
}

export function normalizeRefnoKey(value: string): string {
  return String(value || '').trim().replace('/', '_');
}

function clamp01(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(1, Math.max(0, value));
}

function parseColorToNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    // PDMS / E3D 颜色表：`pdms:lightgrey`、`pdms:271`
    if (isPdmsColourRef(trimmed)) {
      const hex = pdmsColourHex(trimmed);
      return hex === undefined ? null : hex;
    }
    if (trimmed.startsWith('#')) {
      const hex = trimmed.slice(1);
      if (hex.length === 6 || hex.length === 3) {
        return parseInt(hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex, 16);
      }
    }
    if (trimmed.startsWith('0x')) {
      const hex = trimmed.slice(2);
      if (hex.length > 0) return parseInt(hex, 16);
    }
  }
  return null;
}

function toThreeColor(value: unknown, fallback: string | number): Color {
  const num = parseColorToNumber(value);
  if (num !== null) return new Color(num);
  // 查不到的 pdms: 引用不要交给 three 当 CSS 颜色名解析，直接走兜底
  if (typeof value === 'string' && value.trim() && !isPdmsColourRef(value)) return new Color(value as string);
  const fallbackNum = parseColorToNumber(fallback);
  if (fallbackNum !== null) return new Color(fallbackNum);
  if (typeof fallback === 'string' && fallback.trim()) return new Color(fallback as string);
  return new Color('#90a4ae');
}

function normalizeMaterialMap(
  map?: Record<string, MaterialConfigEntry>
): Record<string, MaterialConfigEntry> {
  const out: Record<string, MaterialConfigEntry> = {};
  if (!map) return out;
  for (const [key, value] of Object.entries(map)) {
    const noun = normalizeNounKey(key);
    if (!noun) continue;
    out[noun] = { ...(value || {}) };
  }
  return out;
}

function normalizeOwnerSpecOverrides(
  map?: Record<string, Record<string, MaterialConfigEntry>>
): Record<string, Record<string, MaterialConfigEntry>> {
  const out: Record<string, Record<string, MaterialConfigEntry>> = {};
  if (!map) return out;
  for (const [ownerKey, specMap] of Object.entries(map)) {
    const owner = normalizeNounKey(ownerKey);
    if (!owner) continue;
    const normalizedSpecMap: Record<string, MaterialConfigEntry> = {};
    for (const [specKey, entry] of Object.entries(specMap || {})) {
      const spec = normalizeNounKey(specKey);
      if (!spec) continue;
      normalizedSpecMap[spec] = { ...(entry || {}) };
    }
    if (Object.keys(normalizedSpecMap).length > 0) {
      out[owner] = normalizedSpecMap;
    }
  }
  return out;
}

function normalizeDisciplineMaterials(
  map?: Record<string, MaterialConfigEntry>
): Record<string, MaterialConfigEntry> {
  const out: Record<string, MaterialConfigEntry> = {};
  if (!map) return out;
  for (const [key, value] of Object.entries(map)) {
    const spec = String(key ?? '').trim();
    if (!spec) continue;
    out[spec] = { ...(value || {}) };
  }
  return out;
}

function loadLocalConfig(): {
  nounConfigs?: Record<string, MaterialConfigEntry>
  instanceConfigs?: Record<string, MaterialConfigEntry>
  themes?: Record<string, ThemeConfig>
} | null {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      nounConfigs?: Record<string, MaterialConfigEntry>
      materialConfigs?: Record<string, MaterialConfigEntry>
      instanceConfigs?: Record<string, MaterialConfigEntry>
      themes?: Record<string, ThemeConfig>
    };
    return {
      nounConfigs: parsed.nounConfigs || parsed.materialConfigs,
      instanceConfigs: parsed.instanceConfigs || {},
      themes: parsed.themes || undefined,
    };
  } catch {
    return null;
  }
}

function normalizeDisplaySettings(input: ModelDisplayConfig['displaySettings']): ModelDisplayConfig['displaySettings'] {
  const hiddenNouns = (input?.hiddenNouns || [])
    .map((n) => normalizeNounKey(String(n || '')))
    .filter(Boolean);
  const hiddenRefnos = (input?.hiddenRefnos || [])
    .map((r) => normalizeRefnoKey(String(r || '')))
    .filter(Boolean);
  return {
    hiddenNouns,
    hiddenRefnos,
    defaultVisible: input?.defaultVisible ?? true,
  };
}

function mergeThemes(
  fileThemes?: Record<string, ThemeConfig>,
  localThemes?: Record<string, ThemeConfig>
): Record<string, ThemeConfig> | undefined {
  if (!fileThemes && !localThemes) return undefined;
  const merged: Record<string, ThemeConfig> = {};
  for (const [key, value] of Object.entries(fileThemes || {})) {
    merged[key] = {
      ...value,
      ownerOverrides: normalizeMaterialMap(value.ownerOverrides),
      ownerSpecOverrides: normalizeOwnerSpecOverrides(value.ownerSpecOverrides),
      disciplineMaterials: normalizeDisciplineMaterials(value.disciplineMaterials),
      nounAccents: normalizeMaterialMap(value.nounAccents),
    };
  }
  for (const [key, localTheme] of Object.entries(localThemes || {})) {
    const base = merged[key] || {};
    const baseOwnerSpecOverrides = normalizeOwnerSpecOverrides(base.ownerSpecOverrides);
    const localOwnerSpecOverrides = normalizeOwnerSpecOverrides(localTheme.ownerSpecOverrides);
    const mergedOwnerSpecOverrides: Record<string, Record<string, MaterialConfigEntry>> = {
      ...baseOwnerSpecOverrides,
    };
    for (const [ownerKey, specMap] of Object.entries(localOwnerSpecOverrides)) {
      mergedOwnerSpecOverrides[ownerKey] = {
        ...(baseOwnerSpecOverrides[ownerKey] || {}),
        ...specMap,
      };
    }
    merged[key] = {
      ...base,
      ...localTheme,
      ownerOverrides: {
        ...(base.ownerOverrides || {}),
        ...normalizeMaterialMap(localTheme.ownerOverrides),
      },
      ownerSpecOverrides: mergedOwnerSpecOverrides,
      disciplineMaterials: {
        ...(base.disciplineMaterials || {}),
        ...normalizeDisciplineMaterials(localTheme.disciplineMaterials),
      },
      nounAccents: {
        ...(base.nounAccents || {}),
        ...normalizeMaterialMap(localTheme.nounAccents),
      },
      ...(localTheme.baseMaterial || base.baseMaterial
        ? { baseMaterial: { ...(base.baseMaterial || {}), ...(localTheme.baseMaterial || {}) } }
        : {}),
    };
  }
  return Object.keys(merged).length > 0 ? merged : undefined;
}

function mergeConfigs(fileConfig: ModelDisplayConfig, localConfig: ReturnType<typeof loadLocalConfig>): ModelDisplayConfig {
  const baseMaterialConfigs = normalizeMaterialMap(fileConfig.materialConfigs);
  const localMaterialConfigs = normalizeMaterialMap(localConfig?.nounConfigs);
  const mergedMaterialConfigs = {
    ...baseMaterialConfigs,
    ...localMaterialConfigs,
  };
  const instanceConfigs = {
    ...(fileConfig.instanceConfigs || {}),
    ...(localConfig?.instanceConfigs || {}),
  };
  const themes = mergeThemes(fileConfig.themes, localConfig?.themes);

  return {
    ...fileConfig,
    displaySettings: normalizeDisplaySettings(fileConfig.displaySettings),
    defaultMaterial: {
      ...DEFAULT_MATERIAL,
      ...(fileConfig.defaultMaterial || {}),
    },
    materialConfigs: mergedMaterialConfigs,
    instanceConfigs,
    themes,
  };
}

export async function loadModelDisplayConfig(options: { url?: string; force?: boolean } = {}): Promise<ModelDisplayConfig> {
  if (!options.force && cachedConfig) return cachedConfig;
  if (!options.force && cachedPromise) return cachedPromise;

  const url = options.url || DEFAULT_CONFIG_URL;
  cachedPromise = (async () => {
    let fileConfig: ModelDisplayConfig = {};
    try {
      const res = await fetch(url, { cache: 'no-cache' });
      if (res.ok) {
        fileConfig = await res.json();
      }
    } catch {
      fileConfig = {};
    }

    const localConfig = loadLocalConfig();
    const merged = mergeConfigs(fileConfig, localConfig);
    cachedConfig = merged;
    cachedPromise = null;
    return merged;
  })();

  return cachedPromise;
}

export function clearModelDisplayConfigCache(): void {
  cachedConfig = null;
  cachedPromise = null;
}

export function saveLocalMaterialConfig(payload: {
  nounConfigs: Record<string, MaterialConfigEntry>
  instanceConfigs?: Record<string, MaterialConfigEntry>
  themes?: Record<string, ThemeConfig>
}): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  const safePayload: Record<string, unknown> = {
    nounConfigs: normalizeMaterialMap(payload.nounConfigs),
    instanceConfigs: payload.instanceConfigs || {},
  };
  if (payload.themes && Object.keys(payload.themes).length > 0) {
    safePayload.themes = payload.themes;
  }
  window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(safePayload));
  clearModelDisplayConfigCache();
}

export function normalizeColorString(value: unknown, fallback: string = DEFAULT_MATERIAL.color as string): string {
  // PDMS 颜色引用保留语义写法（导出后还能看出是 E3D 的哪个颜色名），查不到才落成兜底 hex
  if (typeof value === 'string' && isPdmsColourRef(value)) {
    const hex = pdmsColourHex(value);
    return hex === undefined ? fallback : `pdms:${value.trim().slice(5).trim().toLowerCase()}`;
  }
  const num = parseColorToNumber(value);
  if (num !== null) {
    return `#${num.toString(16).padStart(6, '0')}`;
  }
  if (typeof value === 'string' && value.trim()) {
    const trimmed = value.trim();
    if (trimmed.startsWith('#')) return trimmed;
    if (trimmed.startsWith('0x')) {
      const hex = trimmed.slice(2);
      if (hex) return `#${hex.padStart(6, '0')}`;
    }
    if (/^[0-9a-fA-F]{6}$/.test(trimmed)) return `#${trimmed.toLowerCase()}`;
  }
  return fallback;
}

export function buildHiddenNounSet(config: ModelDisplayConfig): Set<string> {
  const list = config.displaySettings?.hiddenNouns || [];
  return new Set(list.map((n) => normalizeNounKey(String(n || ''))).filter(Boolean));
}

export function buildHiddenRefnoSet(config: ModelDisplayConfig): Set<string> {
  const list = config.displaySettings?.hiddenRefnos || [];
  return new Set(list.map((r) => normalizeRefnoKey(String(r || ''))).filter(Boolean));
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
  };
  const materialConfigs = config.materialConfigs || {};
  const instanceConfigs = config.instanceConfigs || {};
  const disciplineOverrides = config.disciplineOverrides || {};

  const nounKey = normalizeNounKey(noun);
  const refnoKey = normalizeRefnoKey(refno);
  const instConfig = instanceConfigs[refnoKey];
  const nounConfig = nounKey ? materialConfigs[nounKey] : undefined;
  const chosen: MaterialConfigEntry = instConfig || nounConfig || defaultMaterial;

  const fallbackColor =
    defaultMaterial.color !== undefined ? defaultMaterial.color : (DEFAULT_MATERIAL.color ?? '#90a4ae');
  let colorValue = chosen.color ?? fallbackColor;
  // 按专业覆盖颜色：spec_value 1=PIPE 2=ELEC 3=INST 4=HVAC 5=CIVIL 6=STRU（0=未分类，不覆盖）
  if (spec_value != null && spec_value > 0 && disciplineOverrides[String(spec_value)]) {
    colorValue = disciplineOverrides[String(spec_value)];
  }
  const baseMetalness = typeof defaultMaterial.metalness === 'number' ? defaultMaterial.metalness : 0.1;
  const baseRoughness = typeof defaultMaterial.roughness === 'number' ? defaultMaterial.roughness : 0.5;
  const baseOpacity = typeof defaultMaterial.opacity === 'number' ? defaultMaterial.opacity : 1;
  const metalness = clamp01(
    typeof chosen.metalness === 'number' ? chosen.metalness : baseMetalness,
    baseMetalness
  );
  const roughness = clamp01(
    typeof chosen.roughness === 'number' ? chosen.roughness : baseRoughness,
    baseRoughness
  );
  const opacity = clamp01(
    typeof chosen.opacity === 'number' ? chosen.opacity : baseOpacity,
    baseOpacity
  );
  const hidden = Boolean(chosen.hidden) || opacity <= 0;

  return {
    color: toThreeColor(colorValue, fallbackColor),
    metalness,
    roughness,
    opacity,
    hidden,
  };
}

/** spec_value -> 主题 ownerSpecOverrides 键（0/未知 -> UNKNOWN） */
const SPEC_VALUE_KEY_MAP: Record<number, string> = {
  1: 'PIPE',
  2: 'ELEC',
  3: 'INST',
  4: 'HVAC',
  5: 'CIVIL',
  6: 'STRU',
};

/** 管路元素判定：这些 owner 下的构件（以及 TUBI 本身）参与专业着色 */
const PIPING_ROUTE_OWNER_NOUNS = new Set(['BRAN', 'HANG']);

function normalizeSpecOverrideKey(specValue?: number | null): string {
  if (specValue == null) return 'UNKNOWN';
  return SPEC_VALUE_KEY_MAP[specValue] ?? 'UNKNOWN';
}

/** 将单条配置转成 ResolvedMaterial（与主题覆盖同一套兜底：metalness 0.1 / roughness 0.5 / opacity 1） */
function resolveEntryMaterial(config: ModelDisplayConfig, entry: MaterialConfigEntry): ResolvedMaterial {
  const fallbackColor = config.defaultMaterial?.color ?? DEFAULT_MATERIAL.color ?? '#90a4ae';
  const colorValue = entry.color ?? fallbackColor;
  return {
    color: toThreeColor(colorValue, fallbackColor),
    metalness: clamp01(typeof entry.metalness === 'number' ? entry.metalness : 0.1, 0.1),
    roughness: clamp01(typeof entry.roughness === 'number' ? entry.roughness : 0.5, 0.5),
    opacity: clamp01(typeof entry.opacity === 'number' ? entry.opacity : 1, 1),
    hidden: Boolean(entry.hidden),
  };
}

/** 无效直管告警材质的缺省：琥珀色实体（Tailwind amber-500），与任何主题的管路色都拉得开 */
export const DEFAULT_INVALID_TUBI_MATERIAL: MaterialConfigEntry = {
  name: '无效直管（告警）',
  color: '#f59e0b',
  metalness: 0.1,
  roughness: 0.5,
  opacity: 1,
};

/**
 * 无效直管的材质：`instanceConfigs[refno]` 显式覆盖仍最高（人指定了颜色就听人的），否则 `invalidTubiMaterial`
 * 合并缺省告警材质——不看主题、专业、类型基色（告警就是要跳出来）。
 */
export function resolveInvalidTubiMaterial(config: ModelDisplayConfig, refno?: string): ResolvedMaterial {
  const refnoKey = refno ? normalizeRefnoKey(refno) : '';
  const instConfig = refnoKey ? config.instanceConfigs?.[refnoKey] : undefined;
  if (instConfig) return resolveEntryMaterial(config, instConfig);
  return resolveEntryMaterial(config, { ...DEFAULT_INVALID_TUBI_MATERIAL, ...(config.invalidTubiMaterial ?? {}) });
}

export function resolveThemeOwnerOverride(
  config: ModelDisplayConfig,
  theme: DisplayTheme,
  ownerNoun: string,
  specValue?: number | null,
): MaterialConfigEntry | undefined {
  if (theme === 'default' || !ownerNoun) return undefined;
  const themeConfig = config.themes?.[theme];
  const key = normalizeNounKey(ownerNoun);
  if (!key) return undefined;
  const specKey = normalizeSpecOverrideKey(specValue);
  const specOverride = themeConfig?.ownerSpecOverrides?.[key]?.[specKey];
  if (specOverride) return specOverride;
  return themeConfig?.ownerOverrides?.[key];
}

/**
 * 主题材质解析顺序（E3D 规则）：
 * 1. instanceConfigs[refno]        —— 显式按元素覆盖，最高优先级（对应 E3D 对单个元素 COLOUR）
 * 2. theme.nounAccents[noun]       —— 重点构件强调色（阀门/法兰/仪表等）
 * 3. theme.disciplineMaterials     —— 管路元素按专业着色（spec_value > 0 时）
 * 4. theme.ownerSpecOverrides / ownerOverrides —— 旧版 owner 覆盖（design3d 主题）
 * 5. theme.baseMaterial            —— 主题基础材质（E3D「Add element colour」；e3dFactory 主题全靠它 → lightgrey）
 * 6. materialConfigs[noun] / defaultMaterial   —— 类型基色兜底
 */
export function resolveMaterialWithTheme(
  config: ModelDisplayConfig,
  refno: string,
  noun: string,
  ownerNoun: string,
  theme: DisplayTheme,
  specValue?: number | null,
): ResolvedMaterial {
  const refnoKey = normalizeRefnoKey(refno);
  const instConfig = config.instanceConfigs?.[refnoKey];
  if (instConfig) {
    return resolveEntryMaterial(config, instConfig);
  }

  const nounKey = normalizeNounKey(noun);
  const ownerKey = normalizeNounKey(ownerNoun);
  const isPipingRoute = PIPING_ROUTE_OWNER_NOUNS.has(ownerKey) || nounKey === 'TUBI';
  const themeConfig = theme !== 'default' ? config.themes?.[theme] : undefined;

  if (themeConfig) {
    const accent = nounKey ? themeConfig.nounAccents?.[nounKey] : undefined;
    if (accent) {
      return resolveEntryMaterial(config, accent);
    }

    if (isPipingRoute && specValue != null && specValue > 0) {
      const discipline = themeConfig.disciplineMaterials?.[String(specValue)];
      if (discipline) {
        return resolveEntryMaterial(config, discipline);
      }
    }

    const override = resolveThemeOwnerOverride(config, theme, ownerNoun, specValue);
    if (override) {
      return resolveEntryMaterial(config, override);
    }

    if (themeConfig.baseMaterial) {
      return resolveEntryMaterial(config, themeConfig.baseMaterial);
    }
  }

  // 类型基色兜底；disciplineOverrides 仅对管路元素生效，避免设备/结构被专业色污染
  return resolveMaterialForInstance(config, refno, noun, isPipingRoute ? specValue : null);
}

export function buildExportConfig(config: ModelDisplayConfig): ModelDisplayConfig {
  const baseDisplay = normalizeDisplaySettings(config.displaySettings);
  const materialConfigs = config.materialConfigs || {};
  const hiddenNouns: string[] = [];

  const exportedMaterialConfigs: Record<string, MaterialConfigEntry> = {};
  for (const [noun, entry] of Object.entries(materialConfigs)) {
    const color = normalizeColorString(entry.color);
    const metalness = typeof entry.metalness === 'number' ? entry.metalness : undefined;
    const roughness = typeof entry.roughness === 'number' ? entry.roughness : undefined;
    const next: MaterialConfigEntry = {
      ...entry,
      color,
      metalness,
      roughness,
    };
    exportedMaterialConfigs[noun] = next;
    if (next.hidden || (typeof next.opacity === 'number' && next.opacity <= 0)) {
      hiddenNouns.push(noun);
    }
  }

  const exportedThemes: Record<string, ThemeConfig> = {};
  for (const [themeKey, themeConfig] of Object.entries(config.themes || {})) {
    const exportedOverrides: Record<string, MaterialConfigEntry> = {};
    for (const [ownerKey, entry] of Object.entries(themeConfig.ownerOverrides || {})) {
      exportedOverrides[ownerKey] = {
        ...entry,
        color: normalizeColorString(entry.color),
      };
    }
    const exportedOwnerSpecOverrides: Record<string, Record<string, MaterialConfigEntry>> = {};
    for (const [ownerKey, specMap] of Object.entries(themeConfig.ownerSpecOverrides || {})) {
      const exportedSpecMap: Record<string, MaterialConfigEntry> = {};
      for (const [specKey, entry] of Object.entries(specMap || {})) {
        exportedSpecMap[specKey] = {
          ...entry,
          color: normalizeColorString(entry.color),
        };
      }
      exportedOwnerSpecOverrides[ownerKey] = exportedSpecMap;
    }
    const exportedDisciplineMaterials: Record<string, MaterialConfigEntry> = {};
    for (const [specKey, entry] of Object.entries(themeConfig.disciplineMaterials || {})) {
      exportedDisciplineMaterials[specKey] = {
        ...entry,
        color: normalizeColorString(entry.color),
      };
    }
    const exportedNounAccents: Record<string, MaterialConfigEntry> = {};
    for (const [nounKey, entry] of Object.entries(themeConfig.nounAccents || {})) {
      exportedNounAccents[nounKey] = {
        ...entry,
        color: normalizeColorString(entry.color),
      };
    }
    exportedThemes[themeKey] = {
      ...themeConfig,
      ownerOverrides: exportedOverrides,
      ownerSpecOverrides: exportedOwnerSpecOverrides,
      ...(Object.keys(exportedDisciplineMaterials).length > 0
        ? { disciplineMaterials: exportedDisciplineMaterials }
        : {}),
      ...(Object.keys(exportedNounAccents).length > 0 ? { nounAccents: exportedNounAccents } : {}),
      ...(themeConfig.baseMaterial
        ? {
          baseMaterial: {
            ...themeConfig.baseMaterial,
            ...(themeConfig.baseMaterial.color !== undefined
              ? { color: normalizeColorString(themeConfig.baseMaterial.color) }
              : {}),
          },
        }
        : {}),
    };
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
    ...(config.disciplineOverrides && Object.keys(config.disciplineOverrides).length > 0
      ? { disciplineOverrides: { ...config.disciplineOverrides } }
      : {}),
    // 无效直管告警材质是文件级配置（没有本地编辑入口），导出时原样带上，否则一轮「导出 → 覆盖文件」就把它丢了
    ...(config.invalidTubiMaterial
      ? {
        invalidTubiMaterial: {
          ...config.invalidTubiMaterial,
          ...(config.invalidTubiMaterial.color !== undefined
            ? { color: normalizeColorString(config.invalidTubiMaterial.color, DEFAULT_INVALID_TUBI_MATERIAL.color as string) }
            : {}),
        },
      }
      : {}),
    ...(Object.keys(exportedThemes).length > 0 ? { themes: exportedThemes } : {}),
  };
}
