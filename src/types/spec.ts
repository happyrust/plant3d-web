/**
 * 专业枚举类型，对应后端的 SiteSpecValue
 */
export enum SiteSpecValue {
  Unknown = 0,  // 未知或其他
  Pipe = 1,     // 管道系统
  Elec = 2,     // 电气系统
  Inst = 3,     // 仪表系统
  Hvac = 4,     // 暖通空调系统
}

export const SITE_SPEC_OPTIONS = [
  { value: SiteSpecValue.Pipe, label: '管道系统' },
  { value: SiteSpecValue.Elec, label: '电气系统' },
  { value: SiteSpecValue.Inst, label: '仪表系统' },
  { value: SiteSpecValue.Hvac, label: '暖通空调系统' },
] as const;

/**
 * 专业选项（含 Unknown/未分类），用于筛选器面板。
 * shortLabel 用于 chip 紧凑展示，fullLabel 用于 tooltip / aria-label。
 */
export const SITE_SPEC_OPTIONS_WITH_UNKNOWN = [
  { value: SiteSpecValue.Pipe, label: '管道', fullLabel: '管道系统' },
  { value: SiteSpecValue.Elec, label: '电气', fullLabel: '电气系统' },
  { value: SiteSpecValue.Inst, label: '仪表', fullLabel: '仪表系统' },
  { value: SiteSpecValue.Hvac, label: '暖通', fullLabel: '暖通空调系统' },
  { value: SiteSpecValue.Unknown, label: '其他', fullLabel: '未分类 / 其他' },
] as const;

/**
 * 专业徽章配色：用于结果列表、chip、统计条等跨组件统一的视觉语言。
 * - Pipe  → 蓝  (blue-100 / blue-700)
 * - Elec  → 黄  (amber-100 / amber-800)
 * - Inst  → 绿  (emerald-100 / emerald-800)
 * - Hvac  → 紫  (violet-100 / violet-700)
 * - Unknown → 灰 (gray-100 / gray-500)
 */
export type SpecBadgeStyle = {
  bg: string;
  fg: string;
  border: string;
};

export const SPEC_BADGE_STYLES: Record<SiteSpecValue, SpecBadgeStyle> = {
  [SiteSpecValue.Pipe]: { bg: '#DBEAFE', fg: '#1D4ED8', border: '#BFDBFE' },
  [SiteSpecValue.Elec]: { bg: '#FEF3C7', fg: '#92400E', border: '#FDE68A' },
  [SiteSpecValue.Inst]: { bg: '#D1FAE5', fg: '#065F46', border: '#A7F3D0' },
  [SiteSpecValue.Hvac]: { bg: '#EDE9FE', fg: '#6D28D9', border: '#DDD6FE' },
  [SiteSpecValue.Unknown]: { bg: '#F3F4F6', fg: '#6B7280', border: '#E5E7EB' },
};

export function getSpecBadgeStyle(specValue: number | string): SpecBadgeStyle {
  const value = typeof specValue === 'string' ? parseInt(specValue, 10) : specValue;
  return SPEC_BADGE_STYLES[value] ?? SPEC_BADGE_STYLES[SiteSpecValue.Unknown];
}

/**
 * 获取专业名称
 */
export function getSpecValueName(specValue: number | string): string {
  const value = typeof specValue === 'string' ? parseInt(specValue, 10) : specValue;
  
  switch (value) {
    case SiteSpecValue.Unknown:
      return '未知或其他';
    case SiteSpecValue.Pipe:
      return '管道系统';
    case SiteSpecValue.Elec:
      return '电气系统';
    case SiteSpecValue.Inst:
      return '仪表系统';
    case SiteSpecValue.Hvac:
      return '暖通空调系统';
    default:
      return `未知专业(${value})`;
  }
}

/**
 * 获取专业简称
 */
export function getSpecValueShortName(specValue: number | string): string {
  const value = typeof specValue === 'string' ? parseInt(specValue, 10) : specValue;
  
  switch (value) {
    case SiteSpecValue.Unknown:
      return '未知';
    case SiteSpecValue.Pipe:
      return '管道';
    case SiteSpecValue.Elec:
      return '电气';
    case SiteSpecValue.Inst:
      return '仪表';
    case SiteSpecValue.Hvac:
      return '暖通';
    default:
      return `未知(${value})`;
  }
}
