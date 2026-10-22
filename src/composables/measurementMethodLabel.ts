import type {
  ComputationMethod,
  ComputationProvenance,
  ComputationWarning,
} from '@/measurement/domain/computationProvenance';

import { toLegacyApproximate } from '@/measurement/domain/computationProvenance';

/**
 * 近似方法必须说实话（#59 / 09-11 收敛计划 PR0.3）：结果旁边显示的是「怎么算出来的」，
 * 不是一句笼统的「近似」。`assertNever` 收尾——新 ComputationMethod 进来时这里编译不过，
 * 作者必须给它一句诚实的措辞，不许掉进「近似」兜底里把精确度含糊掉。
 */
export function computationMethodLabel(method: ComputationMethod): string {
  switch (method) {
    case 'semantic-point-pair':
      return '语义点精确距离';
    case 'point-to-triangle-mesh':
      return '点至表面距离';
    case 'surface-to-surface':
      return '实体外表面净距';
    case 'pipe-surface-clearance':
      return '外表面净距';
    case 'centerline-to-aabb':
      return '中心线至包围盒距离';
    case 'aabb-to-aabb':
      return '包围盒间距离';
    case 'sampled-object':
      return '估算最近距离';
    case 'pca-axis':
      return '估算轴线距离';
    case 'parallel-centerline':
      return '平行直段中心距';
    case 'pipe-row-center-distance':
      return '连排截面中心距';
    case 'pipe-row-derived-gap':
      return '连排外径推导间隔';
    case 'legacy-unknown':
      return '近似（口径未知）';
    default: {
      const _exhaustive: never = method;
      throw new Error(`unhandled computation method: ${String(_exhaustive)}`);
    }
  }
}

/**
 * 记录该显示的方法标签：有 provenance 按 method 说真话，精确方法返回 ''（不挂徽章）；
 * 没有 provenance 也返回 ''——是否兜底「近似」由调用方按记录自己的 `approximate` 标记决定，
 * 避免「持久记录在、但 provenance 未写」的旧数据被误标近似。
 */
export function measurementMethodBadge(provenance: ComputationProvenance | undefined | null): string {
  if (!provenance) return '';
  return toLegacyApproximate(provenance.accuracyClass) || provenance.method === 'legacy-unknown'
    ? computationMethodLabel(provenance.method)
    : '';
}

/** warnings 拼成一句可读的话，跟在数值后面，不替换数值本身。 */
export function computationWarningsText(warnings: readonly ComputationWarning[] | undefined | null): string {
  if (!warnings || warnings.length === 0) return '';
  return warnings
    .map(warning => (warning.message?.trim() ? warning.message.trim() : warning.code))
    .join('；');
}
