/**
 * 「E3D 外观」预设：一套光照常量 + 后处理开关 + 背景色，对应两台不同口径的 E3D 3.1。
 *
 * - `e3d31-factory`：出厂 E3D 3.1。PML `gphviewopt.default()` 走完后的视图：边线 ON、伪阴影(HBAO) ON、
 *   背景渐变 ON、光照 `{Ka 0.7, Kd 0, Ks 0, Kr 0.8, Kse 0}`（无漫反射 / 高光，体积感靠环境立方体贴图反射），
 *   背景 `grey` #828282、渐变端色 = 白。
 * - `sgl-machine`：本机那台经修补脚本启动的 E3D 3.1 真机（没跑 PML 视图默认）：边线 / AO / 渐变全关，
 *   光照落在 SGL 的 C++ 默认 `{0.5, 0.8, 0.3, 0.35, 64}`，背景纯灰 #828282。
 *
 * 依据：`D:\ida_scratch\plant3\render\REPORT-2026-09-20-E3D渲染管线分析-第二轮.md` §2 / §6，
 * 以及 `docs/rendering/e3d-sgl-look-prototype.md` §5.1 / §5.2。
 */

import { SGL_DEFAULT_LIGHT, SGL_E3D31_VIEW_DEFAULT_LIGHT, type SglSceneLightParams } from './sglLookMaterial';
import {
  E3D_BACKGROUND_GREY,
  E3D_GRADIENT_BOTTOM_T,
  E3D_GRADIENT_TOP_T,
  type SglLookPipelineParams
} from './sglLookPipeline';

import type { DisplayTheme } from '@/composables/useDisplayThemeStore';

export type SglLookPresetId = 'e3d31-factory' | 'sgl-machine';

export interface SglLookPreset {
  id: SglLookPresetId;
  /** 面板上的短名 */
  label: string;
  description: string;
  /** 写进策略 1 的 Ka/Kd/Ks/Kr/Kse/LampDir */
  light: Readonly<SglSceneLightParams>;
  /** SGL_ENHANCED_EDGES */
  hlr: boolean;
  /** SGL_PSEUDO_SHADOWS（HBAO） */
  ao: boolean;
  /** SGL_BACKGROUND_GRADIENT */
  gradient: boolean;
  /** 背景色（渐变时在上；纯色时整屏） */
  background: number;
  /** 渐变端色（在下） */
  gradientEnd: number;
  /**
   * 元素颜色走哪套显示主题：两台 E3D 都是 autocolour 关、Add element colour = lightgrey，
   * 即 `e3dFactory`（所有元素 #bdbdbd，`model-display.config.json` themes.e3dFactory.baseMaterial）。
   */
  displayTheme: DisplayTheme;
}

export const SGL_LOOK_PRESETS: Readonly<Record<SglLookPresetId, Readonly<SglLookPreset>>> = Object.freeze({
  'e3d31-factory': Object.freeze({
    id: 'e3d31-factory' as const,
    label: '出厂 E3D 3.1',
    description:
      'PML gphviewopt 出厂视图：边线 / 伪阴影 / 渐变全开，光照 0.7·颜色 + 0.8·环境立方体反射（无漫反射、无高光），背景 grey→白渐变，元素一色 lightgrey。',
    light: SGL_E3D31_VIEW_DEFAULT_LIGHT,
    hlr: true,
    ao: true,
    gradient: true,
    background: E3D_BACKGROUND_GREY,
    gradientEnd: 0xffffff,
    displayTheme: 'e3dFactory',
  }),
  'sgl-machine': Object.freeze({
    id: 'sgl-machine' as const,
    label: '本机真机',
    description:
      '本机修补启动的 E3D 3.1（未跑 PML 视图默认）：边线 / 伪阴影 / 渐变全关，SGL C++ 默认光照 0.5/0.8 Blinn-Phong + 0.35 反射，背景纯灰 #828282，元素一色 lightgrey。',
    light: SGL_DEFAULT_LIGHT,
    hlr: false,
    ao: false,
    gradient: false,
    background: E3D_BACKGROUND_GREY,
    gradientEnd: 0xffffff,
    displayTheme: 'e3dFactory',
  }),
});

/** 未指定时的默认预设：按出厂 E3D 3.1 */
export const DEFAULT_SGL_LOOK_PRESET: SglLookPresetId = 'e3d31-factory';

export function isSglLookPresetId(value: unknown): value is SglLookPresetId {
  return value === 'e3d31-factory' || value === 'sgl-machine';
}

/** 面板 / URL 里的短写：`factory` | `machine`（也接受完整 id） */
export function parseSglLookPresetId(raw: string | null | undefined): SglLookPresetId | null {
  if (raw === null || raw === undefined) return null;
  const v = String(raw).trim().toLowerCase();
  if (v === 'factory' || v === 'e3d31' || v === 'e3d31-factory') return 'e3d31-factory';
  if (v === 'machine' || v === 'sgl' || v === 'sgl-machine') return 'sgl-machine';
  return null;
}

/** 把预设的开关与背景色写进管线参数（HBAO / HLR 的数值参数不动） */
export function applySglLookPresetToPipelineParams(params: SglLookPipelineParams, preset: Readonly<SglLookPreset>): void {
  params.hlr.enabled = preset.hlr;
  params.ao.enabled = preset.ao;
  params.background.gradient = preset.gradient;
  params.background.top.setHex(preset.background);
  params.background.bottom.setHex(preset.gradientEnd);
  params.background.flat.setHex(preset.background);
  params.background.gradientTopT = E3D_GRADIENT_TOP_T;
  params.background.gradientBottomT = E3D_GRADIENT_BOTTOM_T;
  params.legacyMode = false;
}
