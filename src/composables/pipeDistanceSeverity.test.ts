import { describe, expect, it } from 'vitest';

import { AnnotationMaterials } from '@/utils/three/annotation';

import {
  resolvePipeDistanceSeverity,
  resolvePipeDistanceSeverityVisuals,
  type PipeDistanceSeverity,
} from './pipeDistanceSeverity';

describe('resolvePipeDistanceSeverity', () => {
  it('< 100mm → critical', () => {
    expect(resolvePipeDistanceSeverity(0)).toBe<PipeDistanceSeverity>('critical');
    expect(resolvePipeDistanceSeverity(50)).toBe<PipeDistanceSeverity>('critical');
    expect(resolvePipeDistanceSeverity(99.9)).toBe<PipeDistanceSeverity>('critical');
  });

  it('[100, 300) → warning', () => {
    expect(resolvePipeDistanceSeverity(100)).toBe<PipeDistanceSeverity>('warning');
    expect(resolvePipeDistanceSeverity(200)).toBe<PipeDistanceSeverity>('warning');
    expect(resolvePipeDistanceSeverity(299.9)).toBe<PipeDistanceSeverity>('warning');
  });

  it('>= 300mm → safe', () => {
    expect(resolvePipeDistanceSeverity(300)).toBe<PipeDistanceSeverity>('safe');
    expect(resolvePipeDistanceSeverity(500)).toBe<PipeDistanceSeverity>('safe');
    expect(resolvePipeDistanceSeverity(99999)).toBe<PipeDistanceSeverity>('safe');
  });

  it('NaN / Infinity / negative → critical (fail-safe)', () => {
    expect(resolvePipeDistanceSeverity(Number.NaN)).toBe<PipeDistanceSeverity>('critical');
    expect(resolvePipeDistanceSeverity(-1)).toBe<PipeDistanceSeverity>('critical');
    expect(resolvePipeDistanceSeverity(Number.POSITIVE_INFINITY)).toBe<PipeDistanceSeverity>('safe');
  });
});

describe('resolvePipeDistanceSeverityVisuals', () => {
  const materials = new AnnotationMaterials();

  it('critical → 红橙背景 + ssDimensionDefault materialSet', () => {
    const v = resolvePipeDistanceSeverityVisuals('critical', materials);
    expect(v.backgroundColor).toBe(0xff3d00);
    expect(v.materialSet).toBe(materials.ssDimensionDefault);
  });

  it('warning → 默认橙背景 + orange materialSet', () => {
    const v = resolvePipeDistanceSeverityVisuals('warning', materials);
    expect(v.backgroundColor).toBe(0xff6b00);
    expect(v.materialSet).toBe(materials.orange);
  });

  it('safe → 暖白背景 + yellow materialSet', () => {
    const v = resolvePipeDistanceSeverityVisuals('safe', materials);
    expect(v.backgroundColor).toBe(0xffb74d);
    expect(v.materialSet).toBe(materials.yellow);
  });
});
