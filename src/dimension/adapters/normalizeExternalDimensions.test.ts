import { describe, expect, it } from 'vitest';

import {
  externalDimensionBounds,
  externalDimensionCategory,
  externalLayoutAuthority,
  normalizeExternalDimension,
  shouldFrameExternalDimensions,
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

describe('externalDimensionBounds', () => {
  /** An explicit record the way the MBD mapper builds them; only the geometry matters here. */
  function explicitRecord(layout: Record<string, unknown>): ExternalDimensionRecord {
    return {
      id: 'mbd-1',
      source: 'mbd',
      sourceLabel: 'MBD',
      role: 'external',
      layout: {
        id: 'mbd-1',
        role: 'external',
        labelPinned: true,
        formattedLabel: '',
        lines: [],
        arrowLines: [],
        labelAnchor: [0, 0, 0],
        ...layout,
      } as ExternalDimensionRecord['layout'],
    };
  }

  it('wraps every point an explicit record draws from, arcs by their radius', () => {
    const bounds = externalDimensionBounds([
      explicitRecord({
        labelAnchor: [1, 2, 3],
        lines: [{ from: [0, 0, 0], to: [4, 0, 0], part: 'dimension' }],
        arrowLines: [{ from: [0, 0, 0], to: [0, -1, 0] }],
        // The arc decides +Z: its centre plus the radius reaches past every other point.
        arcs: [{ center: [0, 0, 9], normal: [0, 0, 1], radiusM: 0.5 }],
        markers: [{ at: [0, 6, 0], shape: 'cross' }],
        texts: [{ text: 'x', anchor: [-2, 0, 0] }],
        tag: { style: 'card', lines: [], target: [0, 0, -7] },
        dimension3d: { from: [9, 0, 0], to: [0, 0, 8], direction: [0, 1, 0], surfaceM: 0, row: 0 },
      }),
    ]);

    expect(bounds).toEqual({ min: [-2, -1, -7], max: [9, 6, 9.5] });
  });

  it('takes the anchors of the normalized kinds and unions across records', () => {
    const radial: ExternalDimensionRecord = {
      ...linearRecord(true),
      id: 'ext-2',
      layout: {
        id: 'ext-2',
        kind: 'radial',
        role: 'external',
        labelPinned: true,
        center: [10, 10, 10],
        rim: [10, 12, 10],
        normal: [0, 0, 1],
        display: 'radius',
        placement: { leaderDirection: [1, 0, 0], labelDistanceM: 1 },
      },
    };
    const angular: ExternalDimensionRecord = {
      ...linearRecord(true),
      id: 'ext-3',
      layout: {
        id: 'ext-3',
        kind: 'angular',
        role: 'external',
        labelPinned: true,
        vertex: [-5, 0, 0],
        rayA: [100, 0, 0],
        rayB: [0, 100, 0],
        placement: { labelT: 0.5, arcChoice: 'minor' },
      },
    };

    // linear a/b = (0,1,0)/(1,1,0); the angular rays are not positions to frame.
    expect(externalDimensionBounds([linearRecord(true), radial, angular]))
      .toEqual({ min: [-5, 0, 0], max: [10, 12, 10] });
  });

  it('skips non-finite points and answers null when nothing is left', () => {
    expect(externalDimensionBounds([])).toBeNull();
    expect(externalDimensionBounds([
      explicitRecord({ labelAnchor: [Number.NaN, 0, 0] }),
    ])).toBeNull();
    expect(externalDimensionBounds([
      explicitRecord({
        labelAnchor: [Number.POSITIVE_INFINITY, 0, 0],
        lines: [{ from: [1, 1, 1], to: [Number.NaN, 2, 2], part: 'dimension' }],
      }),
    ])).toEqual({ min: [1, 1, 1], max: [1, 1, 1] });
  });
});

describe('shouldFrameExternalDimensions', () => {
  const empty = { sceneObjectCount: 0, recordCount: 12, sourceKey: '24384_2031', framedSourceKey: null };

  it('frames freshly loaded annotations only when the scene has no model at all', () => {
    expect(shouldFrameExternalDimensions(empty)).toBe(true);
    // With a model in the scene the camera belongs to the model.
    expect(shouldFrameExternalDimensions({ ...empty, sceneObjectCount: 1 })).toBe(false);
    // Nothing to frame: an empty or rejected package.
    expect(shouldFrameExternalDimensions({ ...empty, recordCount: 0 })).toBe(false);
  });

  it('frames one set of sources once: a re-sync of the same set leaves the camera alone', () => {
    expect(shouldFrameExternalDimensions({ ...empty, framedSourceKey: '24384_2031' })).toBe(false);
    expect(shouldFrameExternalDimensions({ ...empty, sourceKey: '24384_2031,24384_63', framedSourceKey: '24384_2031' }))
      .toBe(true);
  });
});
