import { describe, expect, it } from 'vitest';

import {
  computationMethodLabel,
  computationWarningsText,
  measurementMethodBadge,
} from './measurementMethodLabel';

import { createComputationProvenance } from '@/measurement/domain/computationProvenance';

describe('computationMethodLabel（#59 诚实措辞）', () => {
  it('近似方法逐个给出具体说法，不叫「净距」也不笼统「近似」', () => {
    expect(computationMethodLabel('sampled-object')).toBe('估算最近距离');
    expect(computationMethodLabel('pca-axis')).toBe('估算轴线距离');
    expect(computationMethodLabel('centerline-to-aabb')).toBe('中心线至包围盒距离');
    expect(computationMethodLabel('aabb-to-aabb')).toBe('包围盒间距离');
    expect(computationMethodLabel('legacy-unknown')).toBe('近似（口径未知）');
  });

  it('精确方法各自的说法', () => {
    expect(computationMethodLabel('pipe-surface-clearance')).toBe('外表面净距');
    expect(computationMethodLabel('surface-to-surface')).toBe('实体外表面净距');
    expect(computationMethodLabel('semantic-point-pair')).toBe('语义点精确距离');
    expect(computationMethodLabel('point-to-triangle-mesh')).toBe('点至表面距离');
    expect(computationMethodLabel('parallel-centerline')).toBe('平行直段中心距');
  });
});

describe('measurementMethodBadge', () => {
  it('近似类 provenance 返回方法标签', () => {
    const provenance = createComputationProvenance({
      method: 'sampled-object',
      accuracyClass: 'approximate-sampled',
      coordinateSpace: 'design-world',
      source: { entityId: 'a' },
      target: { entityId: 'b' },
    });
    expect(measurementMethodBadge(provenance)).toBe('估算最近距离');
  });

  it('精确类 provenance 不挂徽章', () => {
    const provenance = createComputationProvenance({
      method: 'surface-to-surface',
      accuracyClass: 'exact-surface',
      coordinateSpace: 'design-world',
      source: { entityId: 'a' },
      target: { entityId: 'b' },
    });
    expect(measurementMethodBadge(provenance)).toBe('');
  });

  it('没有 provenance 返回空串——兜底「近似」由调用方按记录 approximate 标记决定', () => {
    expect(measurementMethodBadge(undefined)).toBe('');
    expect(measurementMethodBadge(null)).toBe('');
  });
});

describe('computationWarningsText', () => {
  it('空 warnings 返回空串', () => {
    expect(computationWarningsText(undefined)).toBe('');
    expect(computationWarningsText([])).toBe('');
  });

  it('拼接 message，message 空白时退回 code', () => {
    expect(
      computationWarningsText([
        { code: 'SAMPLE_UNDER_DENSE', message: '采样密度不足' },
        { code: 'LEGACY_PROVENANCE_UNKNOWN', message: '  ' },
      ]),
    ).toBe('采样密度不足；LEGACY_PROVENANCE_UNKNOWN');
  });
});
