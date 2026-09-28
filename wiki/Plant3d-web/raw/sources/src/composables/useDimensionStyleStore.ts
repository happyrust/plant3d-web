import { reactive, watch } from 'vue';

/**
 * 尺寸标注样式配置
 *
 * 默认样式：红色、实心填充三角箭头、2px 线宽、无单位后缀、2 位小数。
 */

export type DimensionStyleConfig = {
  /** 线条颜色（hex） */
  lineColor: string;
  /** 悬停颜色（hex） */
  lineColorHover: string;
  /** 选中颜色（hex） */
  lineColorSelected: string;
  /** 线宽 px */
  lineWidth: number;
  /** 箭头样式：filled = 实心三角, open = V 形线段 */
  arrowStyle: 'filled' | 'open';
  /** 箭头长度 px */
  arrowSizePx: number;
  /** 箭头半角 ° */
  arrowAngleDeg: number;
  /** 界线超出 px */
  extensionOvershootPx: number;
  /** 文字高度 px */
  textCapHeightPx: number;
  /** 小数位数 */
  decimals: number;
  /** 单位后缀 */
  unit: string;
  /** 参考虚线段长 px */
  dashSizePx: number;
  /** 参考虚线间隔 px */
  gapSizePx: number;
  /** 文字背景遮挡 */
  showBackground: boolean;
};

const STORAGE_KEY = 'plant3d-web-dimension-style-v2';

export const DEFAULT_DIMENSION_STYLE: Readonly<DimensionStyleConfig> = {
  lineColor: '#EF4444',
  lineColorHover: '#F87171',
  lineColorSelected: '#DC2626',
  lineWidth: 2,
  arrowStyle: 'filled',
  arrowSizePx: 10,
  arrowAngleDeg: 20,
  extensionOvershootPx: 10,
  textCapHeightPx: 12,
  decimals: 2,
  unit: '',
  dashSizePx: 4,
  gapSizePx: 4,
  showBackground: true,
};

function loadPersisted(): DimensionStyleConfig {
  if (typeof localStorage === 'undefined') return { ...DEFAULT_DIMENSION_STYLE };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_DIMENSION_STYLE };
    const parsed = JSON.parse(raw) as Partial<DimensionStyleConfig>;
    return { ...DEFAULT_DIMENSION_STYLE, ...parsed };
  } catch {
    return { ...DEFAULT_DIMENSION_STYLE };
  }
}

const state = reactive<DimensionStyleConfig>(loadPersisted());

watch(
  () => ({ ...state }),
  (val) => {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(val));
    } catch {
      // ignore
    }
  },
  { deep: true },
);

export function useDimensionStyleStore() {
  function resetToDefaults() {
    Object.assign(state, DEFAULT_DIMENSION_STYLE);
  }

  function updateStyle(partial: Partial<DimensionStyleConfig>) {
    Object.assign(state, partial);
  }

  return {
    style: state,
    resetToDefaults,
    updateStyle,
  };
}
