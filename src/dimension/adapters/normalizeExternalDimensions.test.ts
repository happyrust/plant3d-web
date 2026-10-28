import { describe, expect, it } from 'vitest';

import {
  externalDimensionCategory,
  externalLayoutAuthority,
  normalizeExternalDimension,
} from './normalizeExternalDimensions';

import type {
  ExternalDimensionRecord,
  ExternalLayoutAuthority,
} from './normalizeExternalDimensions';

/** A minimal linear external record; `layoutAuthority` only when given. */
function linearRecord(
  labelPinned: boolean,
  layoutAuthority?: ExternalLayoutAuthority,
): ExternalDimensionRecord {
  return {
    id: 'ext-1',
    source: 'bran-clearance',
    sourceLabel: 'BRAN',
    role: 'external-reference',
    ...(layoutAuthority ? { layoutAuthority } : {}),
    layout: {
      id: 'layout-id-is-overridden',
      kind: 'linear',
      role: 'external',
      labelPinned,
      a: [0, 1, 0],
      b: [1, 1, 0],
      placement: { offsetM: 0.2, labelT: 0.5, side: 1 },
    },
  };
}

describe('externalLayoutAuthority', () => {
  it('derives solver from a pinned layout when the field is omitted', () => {
    const record = linearRecord(true);

    expect(externalLayoutAuthority(record)).toBe('solver');
    expect(normalizeExternalDimension(record).labelPinned).toBe(true);
  });

  it('derives screen from an unpinned layout when the field is omitted', () => {
    const record = linearRecord(false);

    expect(externalLayoutAuthority(record)).toBe('screen');
    expect(normalizeExternalDimension(record).labelPinned).toBe(false);
  });

  it('lets an explicit \'screen\' override a pinned layout', () => {
    const record = linearRecord(true, 'screen');

    expect(externalLayoutAuthority(record)).toBe('screen');
    expect(normalizeExternalDimension(record).labelPinned).toBe(false);
  });

  it('lets an explicit \'solver\' override an unpinned layout', () => {
    const record = linearRecord(false, 'solver');

    expect(externalLayoutAuthority(record)).toBe('solver');
    expect(normalizeExternalDimension(record).labelPinned).toBe(true);
  });
});

describe('normalizeExternalDimension', () => {
  it('keeps the record id and role over the layout copy and leaves the geometry alone', () => {
    const normalized = normalizeExternalDimension(linearRecord(false));

    expect(normalized).toMatchObject({
      id: 'ext-1',
      role: 'external-reference',
      kind: 'linear',
      labelPinned: false,
      a: [0, 1, 0],
      b: [1, 1, 0],
      placement: { offsetM: 0.2, labelT: 0.5, side: 1 },
    });
  });
});

describe('externalDimensionCategory', () => {
  it('defaults to \'dimension\' and honours an explicit \'annotation\'', () => {
    expect(externalDimensionCategory(linearRecord(false))).toBe('dimension');
    expect(externalDimensionCategory({ ...linearRecord(false), category: 'annotation' }))
      .toBe('annotation');
  });
});
