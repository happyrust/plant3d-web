import { computed, ref } from 'vue';

import {
  DEFAULT_SGL_LOOK_PRESET,
  SGL_LOOK_PRESETS,
  parseSglLookPresetId,
  type SglLookPreset,
  type SglLookPresetId,
} from '@/viewer/e3dLook/sglLookPresets';

/**
 * 渲染模式（主界面三维查看器的「外观」）——ViewerPanel 与「设置 → 渲染模式」面板共用的一份状态。
 *
 * - `pbr`：web 自己的口径（three PBR 材质、品红选中 + OutlinePass 描边、可配显示主题）。
 * - `sgl`：E3D 外观（SGL DX11 复刻，docs/rendering/e3d-sgl-look-prototype.md）：光照公式 + 环境立方体贴图 +
 *   HLR 边线 + HBAO 伪阴影 + 背景渐变 + 4× MSAA，选中按 E3D 染色；再按 `preset` 选「出厂 E3D 3.1 / 本机真机」两套常量，
 *   四个子开关可在预设之上单独覆盖。
 *
 * localStorage 键沿用 ViewerPanel 一直在用的那组（`dtx_look*`），老会话的选择原样生效；
 * URL 参数（`?dtx_look=sgl&dtx_look_preset=factory&dtx_look_hlr=0…`）只覆盖本次、不落盘，见 `applyQueryOverrides`。
 */
export type RenderLookMode = 'pbr' | 'sgl';

export const RENDER_LOOK_STORAGE_KEYS = Object.freeze({
  mode: 'dtx_look',
  preset: 'dtx_look_preset',
  hlr: 'dtx_look_hlr',
  ao: 'dtx_look_ao',
  gradient: 'dtx_look_gradient',
  aa: 'dtx_look_aa',
} as const);

export interface RenderLookEffectToggle {
  key: 'hlr' | 'ao' | 'gradient' | 'aa';
  label: string;
  description: string;
}

/** 面板上四个子开关的文案（与 sglDx11 的开关一一对应） */
export const RENDER_LOOK_EFFECT_TOGGLES: readonly RenderLookEffectToggle[] = Object.freeze([
  {
    key: 'hlr',
    label: '边线',
    description: 'EnhancedEdges：按法线 / 深度差判边并去杂（HLRDeclutter），黑色轮廓线。',
  },
  {
    key: 'ao',
    label: '伪阴影',
    description: 'PseudoShadows：HBAO 环境光遮蔽 + 深度感知模糊，接触面 / 管口发暗。',
  },
  {
    key: 'gradient',
    label: '背景渐变',
    description: 'BackgroundGradient：背景色在上 → 端色（白）在下的纵向渐变。',
  },
  {
    key: 'aa',
    label: '抗锯齿',
    description: 'antiAlias：颜色通道 4× MSAA，边线按 4 个采样点判边取平均。',
  },
]);

function lsGet(key: string): string | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function lsSet(key: string, value: string): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(key, value);
  } catch {
    // ignore（隐私模式 / 配额）
  }
}

function parseMode(raw: string | null | undefined): RenderLookMode | null {
  if (raw === null || raw === undefined) return null;
  const v = String(raw).trim().toLowerCase();
  if (v === 'sgl') return 'sgl';
  if (v === 'pbr') return 'pbr';
  // 历史写法：任何非 sgl 的值都当 pbr（ViewerPanel 以前就是 `=== 'sgl'` 一刀切）
  return v.length > 0 ? 'pbr' : null;
}

function parseFlag(raw: string | null | undefined): boolean | null {
  if (raw === null || raw === undefined) return null;
  const v = String(raw).trim();
  if (v.length === 0) return null;
  return v !== '0';
}

const enabled = ref(false);
const preset = ref<SglLookPresetId>(DEFAULT_SGL_LOOK_PRESET);
const hlr = ref(SGL_LOOK_PRESETS[DEFAULT_SGL_LOOK_PRESET].hlr);
const ao = ref(SGL_LOOK_PRESETS[DEFAULT_SGL_LOOK_PRESET].ao);
const gradient = ref(SGL_LOOK_PRESETS[DEFAULT_SGL_LOOK_PRESET].gradient);
const aa = ref(SGL_LOOK_PRESETS[DEFAULT_SGL_LOOK_PRESET].antiAlias);

function applyPresetDefaults(id: SglLookPresetId): void {
  const p = SGL_LOOK_PRESETS[id];
  preset.value = id;
  hlr.value = p.hlr;
  ao.value = p.ao;
  gradient.value = p.gradient;
  aa.value = p.antiAlias;
}

/** 从 localStorage 读一遍（模块加载时跑一次；测试里 resetModules 后也会重新跑） */
function hydrateFromStorage(): void {
  enabled.value = false;
  applyPresetDefaults(DEFAULT_SGL_LOOK_PRESET);
  const mode = parseMode(lsGet(RENDER_LOOK_STORAGE_KEYS.mode));
  if (mode) enabled.value = mode === 'sgl';
  const presetId = parseSglLookPresetId(lsGet(RENDER_LOOK_STORAGE_KEYS.preset));
  if (presetId) applyPresetDefaults(presetId);
  const h = parseFlag(lsGet(RENDER_LOOK_STORAGE_KEYS.hlr));
  if (h !== null) hlr.value = h;
  const a = parseFlag(lsGet(RENDER_LOOK_STORAGE_KEYS.ao));
  if (a !== null) ao.value = a;
  const g = parseFlag(lsGet(RENDER_LOOK_STORAGE_KEYS.gradient));
  if (g !== null) gradient.value = g;
  const s = parseFlag(lsGet(RENDER_LOOK_STORAGE_KEYS.aa));
  if (s !== null) aa.value = s;
}

hydrateFromStorage();

export function useRenderLookStore() {
  const mode = computed<RenderLookMode>(() => (enabled.value ? 'sgl' : 'pbr'));
  const currentPreset = computed<Readonly<SglLookPreset>>(() => SGL_LOOK_PRESETS[preset.value]);
  /** 四个子开关有没有偏离当前预设的出厂位 */
  const isModifiedFromPreset = computed(() => {
    const p = SGL_LOOK_PRESETS[preset.value];
    return hlr.value !== p.hlr || ao.value !== p.ao || gradient.value !== p.gradient || aa.value !== p.antiAlias;
  });

  function setEnabled(next: boolean): void {
    enabled.value = next;
    lsSet(RENDER_LOOK_STORAGE_KEYS.mode, next ? 'sgl' : 'pbr');
  }

  function setMode(next: RenderLookMode): void {
    setEnabled(next === 'sgl');
  }

  /** 切预设：光照常量换掉，四个子开关回到该预设的出厂位 */
  function setPreset(id: SglLookPresetId): void {
    applyPresetDefaults(id);
    persistPresetAndToggles();
  }

  function persistPresetAndToggles(): void {
    lsSet(RENDER_LOOK_STORAGE_KEYS.preset, preset.value);
    lsSet(RENDER_LOOK_STORAGE_KEYS.hlr, hlr.value ? '1' : '0');
    lsSet(RENDER_LOOK_STORAGE_KEYS.ao, ao.value ? '1' : '0');
    lsSet(RENDER_LOOK_STORAGE_KEYS.gradient, gradient.value ? '1' : '0');
    lsSet(RENDER_LOOK_STORAGE_KEYS.aa, aa.value ? '1' : '0');
  }

  function setHlr(next: boolean): void {
    hlr.value = next;
    lsSet(RENDER_LOOK_STORAGE_KEYS.hlr, next ? '1' : '0');
  }

  function setAo(next: boolean): void {
    ao.value = next;
    lsSet(RENDER_LOOK_STORAGE_KEYS.ao, next ? '1' : '0');
  }

  function setGradient(next: boolean): void {
    gradient.value = next;
    lsSet(RENDER_LOOK_STORAGE_KEYS.gradient, next ? '1' : '0');
  }

  function setAa(next: boolean): void {
    aa.value = next;
    lsSet(RENDER_LOOK_STORAGE_KEYS.aa, next ? '1' : '0');
  }

  function setEffect(key: RenderLookEffectToggle['key'], next: boolean): void {
    switch (key) {
      case 'hlr':
        setHlr(next);
        return;
      case 'ao':
        setAo(next);
        return;
      case 'gradient':
        setGradient(next);
        return;
      case 'aa':
        setAa(next);
        return;
      default:
        return;
    }
  }

  function getEffect(key: RenderLookEffectToggle['key']): boolean {
    switch (key) {
      case 'hlr':
        return hlr.value;
      case 'ao':
        return ao.value;
      case 'gradient':
        return gradient.value;
      case 'aa':
        return aa.value;
      default:
        return false;
    }
  }

  /** 四个子开关回到当前预设的出厂位（预设本身不变） */
  function resetToPresetDefaults(): void {
    setPreset(preset.value);
  }

  /**
   * URL 参数只覆盖本次会话、不落盘：`?dtx_look=sgl|pbr`、`dtx_look_preset=factory|machine`（同时把四个子开关
   * 归到该预设的出厂位）、`dtx_look_hlr / dtx_look_ao / dtx_look_gradient / dtx_look_aa`（`0` 关，其它开）。
   */
  function applyQueryOverrides(q: URLSearchParams): void {
    const mode = parseMode(q.get(RENDER_LOOK_STORAGE_KEYS.mode));
    if (mode) enabled.value = mode === 'sgl';
    const presetId = parseSglLookPresetId(q.get(RENDER_LOOK_STORAGE_KEYS.preset));
    if (presetId) applyPresetDefaults(presetId);
    const h = parseFlag(q.get(RENDER_LOOK_STORAGE_KEYS.hlr));
    if (h !== null) hlr.value = h;
    const a = parseFlag(q.get(RENDER_LOOK_STORAGE_KEYS.ao));
    if (a !== null) ao.value = a;
    const g = parseFlag(q.get(RENDER_LOOK_STORAGE_KEYS.gradient));
    if (g !== null) gradient.value = g;
    const s = parseFlag(q.get(RENDER_LOOK_STORAGE_KEYS.aa));
    if (s !== null) aa.value = s;
  }

  return {
    enabled,
    mode,
    preset,
    currentPreset,
    hlr,
    ao,
    gradient,
    aa,
    isModifiedFromPreset,
    setEnabled,
    setMode,
    setPreset,
    setHlr,
    setAo,
    setGradient,
    setAa,
    setEffect,
    getEffect,
    resetToPresetDefaults,
    applyQueryOverrides,
    hydrateFromStorage,
  };
}
