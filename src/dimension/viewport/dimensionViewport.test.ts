import { describe, expect, it, vi } from 'vitest';
import { Group } from 'three';

import { normalizeExternalDimension } from '../adapters/normalizeExternalDimensions';
import { normalizeUserDimension } from '../adapters/normalizeUserDimensions';
import {
  emptyDimensionDocument,
  linearRecord,
  projectedRecord,
} from '../domain/testFixtures';
import { DEFAULT_DIMENSION_FORMAT } from '../kernel/format';
import { createTestFont, createTestProjector } from '../kernel/testUtils';
import { SOLVESPACE_DIMENSION_THEME } from '../kernel/theme';

import { DimensionViewport } from './dimensionViewport';

import type { ExternalDimensionRecord } from '../adapters/normalizeExternalDimensions';
function createViewport() {
  const scene = new Group();
  const callbacks: FrameRequestCallback[] = [];
  const cancelled: number[] = [];
  const requestRender = vi.fn();
  const viewport = new DimensionViewport({
    scene,
    font: createTestFont(),
    theme: SOLVESPACE_DIMENSION_THEME,
    format: DEFAULT_DIMENSION_FORMAT,
    requestFrame: callback => {
      callbacks.push(callback);
      return callbacks.length;
    },
    cancelFrame: id => cancelled.push(id),
    requestRender,
  });
  const flush = () => callbacks.shift()?.(performance.now());
  return {
    callbacks,
    cancelled,
    flush,
    requestRender,
    scene,
    viewport,
  };
}

describe('dimension input normalization', () => {
  it('derives invalid and approximate semantic roles without leaking metadata', () => {
    const approximate = normalizeUserDimension(linearRecord({
      authorId: 'private-author',
      a: {
        snapshot: [0, 0, 0],
        accuracy: 'approximate',
        semanticRef: { source: 'model-surface', refno: 'secret-refno' },
      },
    }));
    const invalid = normalizeUserDimension(linearRecord({
      validity: 'invalid',
      a: { snapshot: [0, 0, 0], accuracy: 'approximate' },
    }));

    expect(approximate).toMatchObject({
      id: 'linear-1',
      kind: 'linear',
      role: 'approximate',
      labelPinned: false,
    });
    expect(approximate).not.toHaveProperty('authorId');
    expect(approximate).not.toHaveProperty('semanticRef');
    expect(invalid).toMatchObject({ role: 'invalid' });
  });

  it('keeps records with unresolved anchors list-only', () => {
    expect(normalizeUserDimension(linearRecord({
      a: { snapshot: null, accuracy: 'exact' },
    }))).toBeNull();
  });

  it('resolves design and semantic projection axes from snapshots', () => {
    expect(normalizeUserDimension(projectedRecord())).toMatchObject({
      axis: [1, 0, 0],
    });
    expect(normalizeUserDimension(projectedRecord({
      axis: {
        kind: 'semantic-direction',
        snapshot: [0, 1, 0],
        semanticRef: { source: 'direction', candidateId: 'direction-1' },
      },
    }))).toMatchObject({ axis: [0, 1, 0] });
  });

  it('forces external identity and role while dropping source metadata', () => {
    const record: ExternalDimensionRecord = {
      id: 'external-1',
      source: 'mbd',
      sourceLabel: 'MBD private source',
      role: 'external-reference',
      layout: {
        id: 'untrusted-id',
        kind: 'linear',
        role: 'normal',
        labelPinned: false,
        a: [0, 0, 0],
        b: [1, 0, 0],
        placement: { offsetM: 0.2, labelT: 0.5, side: 1 },
      },
    };

    const normalized = normalizeExternalDimension(record);

    expect(normalized).toMatchObject({
      id: 'external-1',
      role: 'external-reference',
    });
    expect(normalized).not.toHaveProperty('source');
    expect(normalized).not.toHaveProperty('sourceLabel');
  });
});

describe('DimensionViewport', () => {
  it('coalesces document and camera changes into one layout and paint', () => {
    const harness = createViewport();
    harness.viewport.setProjector(createTestProjector());
    harness.viewport.setDocument(emptyDimensionDocument([linearRecord()]));

    expect(harness.callbacks).toHaveLength(1);
    harness.flush();

    expect(harness.viewport.getLayouts().map(layout => layout.dimensionId))
      .toEqual(['linear-1']);
    expect(harness.scene.children).toHaveLength(1);
    expect(harness.requestRender).toHaveBeenCalled();
    expect(harness.callbacks).toHaveLength(0);
  });

  it('keeps hover and temporary external hiding local to the viewport', () => {
    const harness = createViewport();
    const external: ExternalDimensionRecord = {
      id: 'external-1',
      source: 'bran-clearance',
      sourceLabel: 'Clearance',
      role: 'external',
      layout: {
        id: 'external-1',
        kind: 'linear',
        role: 'external',
        labelPinned: false,
        a: [0, 1, 0],
        b: [1, 1, 0],
        placement: { offsetM: 0.2, labelT: 0.5, side: 1 },
      },
    };
    harness.viewport.setProjector(createTestProjector());
    harness.viewport.setDocument(emptyDimensionDocument([linearRecord()]));
    harness.viewport.setExternalDimensions([external]);
    harness.viewport.setHover('linear-1');
    harness.viewport.setExternalHidden('external-1', true);
    harness.flush();

    expect(harness.viewport.getLayouts().map(layout => layout.dimensionId))
      .toEqual(['linear-1']);
    expect(harness.viewport.isExternalHidden('external-1')).toBe(true);
  });

  it('uses the current layouts for hit testing and clears on disposal', () => {
    const harness = createViewport();
    harness.viewport.setProjector(createTestProjector());
    harness.viewport.setDocument(emptyDimensionDocument([linearRecord()]));
    harness.flush();
    const layout = harness.viewport.getLayouts()[0];
    const region = layout.hitRegions[0];
    const point = region.kind === 'segment'
      ? region.from
      : [region.rect.x, region.rect.y] as const;

    expect(harness.viewport.hitTest(point, 3)?.dimensionId).toBe('linear-1');

    harness.viewport.invalidate('camera');
    harness.viewport.dispose();
    expect(harness.cancelled).toEqual([1]);
    expect(harness.scene.children).toHaveLength(0);
  });

  it('converts a screen drag into a semantic linear placement', () => {
    const harness = createViewport();
    harness.viewport.setProjector(createTestProjector());

    expect(harness.viewport.placementAtScreen(
      linearRecord(),
      { x: 275, y: 150 },
    )).toEqual({
      offsetM: 0.5,
      labelT: 0.75,
      side: -1,
    });
  });
});
