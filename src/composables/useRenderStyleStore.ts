import { ref } from 'vue';

import type { BackgroundMode } from '@/viewer/dtx/DtxViewer';

/**
 * 绘制样式（渲染风格）：与配色主题正交——主题改「颜色」，样式改「怎么画」
 * （光照/高光/平涂/透明度/边线/背景一整套预设）。
 */
export type RenderStyle = 'e3d' | 'engineering' | 'pbr' | 'wireframe' | 'xray';

export type RenderStylePreset = {
  mode: RenderStyle;
  label: string;
  /** 弹层色点预览色 */
  colorHint: string;
  /** ribbon 图标名 */
  icon: string;
  /** PBR 高光缩放：1=原样，越小越哑光（E3D ≈ 0.1） */
  specularScale: number;
  /** 平涂度：0=正常光照，1=纯色无光照 */
  flatness: number;
  /** 全局不透明度缩放：<1 全部走透明通道（X-ray），0=填充全隐只剩边线（线框） */
  opacityScale: number;
  /** 场景灯强度（ambient / 主光 dir0 / 补光 dir1） */
  lighting: { ambient: number; dir0: number; dir1: number };
  /** 边线预设：开关 / 阈值角 / 颜色 */
  edges: { enabled: boolean; thresholdAngle: number; color: number };
  /** 附带场景背景；undefined = 不动用户背景 */
  background?: BackgroundMode;
};

export const RENDER_STYLE_PRESETS: RenderStylePreset[] = [
  {
    // E3D 三维视图观感：深色渐变底 + 哑光近平涂着色 + 构件轮廓细边线
    mode: 'e3d',
    label: 'E3D',
    colorHint: '#1e293b',
    icon: 'palette',
    specularScale: 0.08,
    flatness: 0.55,
    opacityScale: 1,
    lighting: { ambient: 0.55, dir0: 0.6, dir1: 0.28 },
    edges: { enabled: true, thresholdAngle: 20, color: 0x0f172a },
    background: 'gradient_dark',
  },
  {
    // 既有「工程视图」口径（docs/plans/2026-02-27-cad-render-final-params.md）：PBR + 浅灰工程底
    mode: 'engineering',
    label: '工程图',
    colorHint: '#94a3b8',
    icon: 'ruler',
    specularScale: 1,
    flatness: 0,
    opacityScale: 1,
    lighting: { ambient: 0.26, dir0: 1.15, dir1: 0.5 },
    edges: { enabled: false, thresholdAngle: 20, color: 0x4b5563 },
    background: 'gradient_engineering_gray',
  },
  {
    mode: 'pbr',
    label: '写实 PBR',
    colorHint: '#f59e0b',
    icon: 'zap',
    specularScale: 1.5,
    flatness: 0,
    opacityScale: 1,
    lighting: { ambient: 0.22, dir0: 1.4, dir1: 0.55 },
    edges: { enabled: false, thresholdAngle: 20, color: 0x4b5563 },
    background: 'gradient_solidworks',
  },
  {
    // 填充全隐（opacityScale=0），只留全密度边线
    mode: 'wireframe',
    label: '线框',
    colorHint: '#475569',
    icon: 'spline',
    specularScale: 0,
    flatness: 0,
    opacityScale: 0,
    lighting: { ambient: 0.26, dir0: 1.15, dir1: 0.5 },
    edges: { enabled: true, thresholdAngle: 1, color: 0x334155 },
    background: 'solid_light',
  },
  {
    mode: 'xray',
    label: 'X-ray',
    colorHint: '#67e8f9',
    icon: 'eye',
    specularScale: 0.35,
    flatness: 0.2,
    opacityScale: 0.35,
    lighting: { ambient: 0.4, dir0: 1.0, dir1: 0.4 },
    edges: { enabled: false, thresholdAngle: 20, color: 0x4b5563 },
    background: 'solid_light',
  },
];

const STORAGE_KEY = 'viewer_render_style';
const DEFAULT_STYLE: RenderStyle = 'e3d';

function isRenderStyle(value: string | null): value is RenderStyle {
  return value === 'e3d' || value === 'engineering' || value === 'pbr' || value === 'wireframe' || value === 'xray';
}

function loadPersistedStyle(): RenderStyle {
  if (typeof window === 'undefined' || !window.localStorage || typeof window.localStorage.getItem !== 'function') {
    return DEFAULT_STYLE;
  }
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (isRenderStyle(raw)) return raw;
  return DEFAULT_STYLE;
}

const currentStyle = ref<RenderStyle>(loadPersistedStyle());

export function getRenderStylePreset(mode: RenderStyle): RenderStylePreset {
  return RENDER_STYLE_PRESETS.find((p) => p.mode === mode) ?? RENDER_STYLE_PRESETS[0]!;
}

export function useRenderStyleStore() {
  const isE3dStyle = () => currentStyle.value === 'e3d';

  function setRenderStyle(mode: RenderStyle) {
    currentStyle.value = mode;
    if (
      typeof window !== 'undefined'
      && window.localStorage
      && typeof window.localStorage.setItem === 'function'
    ) {
      window.localStorage.setItem(STORAGE_KEY, mode);
    }
  }

  return {
    currentStyle,
    isE3dStyle,
    presets: RENDER_STYLE_PRESETS,
    setRenderStyle,
  };
}
