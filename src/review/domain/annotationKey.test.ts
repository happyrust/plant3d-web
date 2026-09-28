import { describe, expect, it } from 'vitest';

import {
  ANNOTATION_KEY_LENGTH,
  ANNOTATION_KEY_VERSION,
  computeAnnotationKeyV1,
  isAnnotationKeyConsistent,
  resolveAnnotationKey,
  type AnnotationKeyInput,
} from './annotationKey';

const baseInput: AnnotationKeyInput = {
  annotationType: 'text',
  taskId: 'task-001',
  geometry: { kind: 'text', anchor: [1.0, 2.0, 3.0] },
  content: '主泵上方管线碰撞',
};

describe('computeAnnotationKeyV1', () => {
  it('exposes current version tag', () => {
    expect(ANNOTATION_KEY_VERSION).toBe('v1');
  });

  it('yields deterministic key for the same input', async () => {
    const k1 = await computeAnnotationKeyV1(baseInput);
    const k2 = await computeAnnotationKeyV1({ ...baseInput });
    expect(k1).toBe(k2);
    expect(k1).toHaveLength(ANNOTATION_KEY_LENGTH);
  });

  it('differs when annotationType differs', async () => {
    const k1 = await computeAnnotationKeyV1(baseInput);
    const k2 = await computeAnnotationKeyV1({
      ...baseInput,
      annotationType: 'cloud',
      geometry: { kind: 'cloud', points: [[1, 2, 3]] },
    });
    expect(k1).not.toBe(k2);
  });

  it('differs when taskId differs', async () => {
    const k1 = await computeAnnotationKeyV1(baseInput);
    const k2 = await computeAnnotationKeyV1({ ...baseInput, taskId: 'task-002' });
    expect(k1).not.toBe(k2);
  });

  it('normalizes content casing and surrounding whitespace', async () => {
    const k1 = await computeAnnotationKeyV1({ ...baseInput, content: ' Hello ' });
    const k2 = await computeAnnotationKeyV1({ ...baseInput, content: 'hello' });
    expect(k1).toBe(k2);
  });

  it('rounds geometry coordinates to 4 decimals', async () => {
    const k1 = await computeAnnotationKeyV1({
      ...baseInput,
      geometry: { kind: 'text', anchor: [1.00001, 2.00001, 3.00001] },
    });
    const k2 = await computeAnnotationKeyV1({
      ...baseInput,
      geometry: { kind: 'text', anchor: [1, 2, 3] },
    });
    expect(k1).toBe(k2);
  });

  it('distinguishes rect vs obb with same center/size', async () => {
    const rect = await computeAnnotationKeyV1({
      ...baseInput,
      annotationType: 'rect',
      geometry: { kind: 'rect', center: [0, 0, 0], size: [1, 1, 1] },
    });
    const obb = await computeAnnotationKeyV1({
      ...baseInput,
      annotationType: 'obb',
      geometry: { kind: 'obb', center: [0, 0, 0], size: [1, 1, 1] },
    });
    expect(rect).not.toBe(obb);
  });

  it('handles missing content as empty', async () => {
    const k1 = await computeAnnotationKeyV1({ ...baseInput, content: undefined });
    const k2 = await computeAnnotationKeyV1({ ...baseInput, content: '' });
    expect(k1).toBe(k2);
  });

  it('returns hex string of expected length', async () => {
    const k = await computeAnnotationKeyV1(baseInput);
    expect(k).toMatch(/^[0-9a-f]+$/);
    expect(k).toHaveLength(ANNOTATION_KEY_LENGTH);
  });
});

describe('resolveAnnotationKey', () => {
  it('returns null when backend key is absent', () => {
    expect(resolveAnnotationKey(null)).toBeNull();
    expect(resolveAnnotationKey(undefined)).toBeNull();
    expect(resolveAnnotationKey('')).toBeNull();
    expect(resolveAnnotationKey('   ')).toBeNull();
  });

  it('returns trimmed backend key when present', () => {
    expect(resolveAnnotationKey('  abc  ')).toBe('abc');
  });
});

describe('isAnnotationKeyConsistent', () => {
  it('treats missing v2 as consistent', () => {
    expect(isAnnotationKeyConsistent('abc123', null)).toBe(true);
  });

  it('matches identical keys', () => {
    expect(isAnnotationKeyConsistent('abc123', 'abc123')).toBe(true);
  });

  it('matches when v2 key starts with v1 prefix', () => {
    expect(isAnnotationKeyConsistent('abc123', 'abc123-extra')).toBe(true);
  });

  it('flags mismatch otherwise', () => {
    expect(isAnnotationKeyConsistent('abc123', 'xyz999')).toBe(false);
  });
});
