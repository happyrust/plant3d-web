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
