import { describe, expect, it } from 'vitest';

import fullCoverageFixture from '../../fixtures/mbd-v2/full-coverage.json';
import { DEFAULT_DIMENSION_FORMAT } from '../kernel/format';
import { createTestFont, createTestProjector } from '../kernel/testUtils';
import { SOLVESPACE_DIMENSION_THEME } from '../kernel/theme';
import { layoutViewport } from '../kernel/viewport/layoutViewport';

import { parseMbdV2PipeData } from './mbdV2Contract';
import { mbdV2ToExternalRecords } from './mbdV2ExternalAnnotations';
import {
  externalDimensionCategory,
  normalizeExternalDimension,
} from './normalizeExternalDimensions';

import type { MbdV2PipeData } from './mbdV2Contract';
import type { ExplicitLayoutInput } from '../kernel/types';

function fixtureData(): MbdV2PipeData {
  const parsed = parseMbdV2PipeData(fullCoverageFixture);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.data;
}

function explicitLayout(
  result: ReturnType<typeof mbdV2ToExternalRecords>,
  id: string,
): ExplicitLayoutInput {
  const record = result.records.find(item => item.id === id);
  if (!record) throw new Error(`record ${id} not mapped`);
  return record.layout as ExplicitLayoutInput;
}

describe('mbdV2ToExternalRecords', () => {
  it('maps every renderable primitive kind and diagnoses the rest', () => {
    const result = mbdV2ToExternalRecords(fixtureData());

    expect(result.records.map(record => record.id)).toEqual([
      'dim-segment-1',
      'dim-ref-2',
      'label-1',
      'leader-1',
      'aid-line-1',
      'aid-point-1',
      'aid-text-1',
      'weld-shop-1',
      'weld-field-2',
      'slope-1',
    ]);
    expect(result.skipped).toEqual([
      { id: 'dim-suppressed-3', reason: 'suppressed: overlap' },
      {
        id: 'angle-1',
        reason: 'contract-incomplete: angle_dim geometry is not yet defined '
          + 'by the rs-mbd Phase 0 contract',
      },
      {
        id: 'aid-arc-1',
        reason: 'contract-incomplete: aid_arc geometry is not yet defined '
          + 'by the rs-mbd Phase 0 contract',
      },
      {
        id: 'aid-circle-1',
        reason: 'contract-incomplete: aid_circle geometry is not yet defined '
          + 'by the rs-mbd Phase 0 contract',
      },
    ]);
    expect(result.records.every(record => record.source === 'mbd')).toBe(true);
  });

  it('categorises dimensions vs annotation primitives (ADR 0041)', () => {
    const result = mbdV2ToExternalRecords(fixtureData());
    const byCategory = new Map(
      result.records.map(record => [
        record.id,
        externalDimensionCategory(record),
      ]),
    );

    expect(byCategory.get('dim-segment-1')).toBe('dimension');
    expect(byCategory.get('dim-ref-2')).toBe('dimension');
    for (const id of [
      'label-1',
      'leader-1',
      'aid-line-1',
      'aid-point-1',
      'aid-text-1',
      'weld-shop-1',
      'weld-field-2',
      'slope-1',
    ]) {
      expect(byCategory.get(id)).toBe('annotation');
    }
  });

  it('maps linear dims with superset geometry and reference role', () => {
    const result = mbdV2ToExternalRecords(fixtureData());

    const rich = explicitLayout(result, 'dim-segment-1');
    expect(rich.formattedLabel).toBe('1250');
    expect(rich.labelAnchor).toEqual([0.625, 0.2, 0]);
    expect(rich.lines.map(line => line.part)).toEqual([
      'dimension',
      'extension',
      'extension',
    ]);
    expect(rich.arrowLines).toHaveLength(2);

    const reference = result.records.find(record => record.id === 'dim-ref-2')!;
    expect(reference.role).toBe('external-reference');
    const referenceLayout = reference.layout as ExplicitLayoutInput;
    expect(referenceLayout.labelAnchor).toEqual([0, 0.4, 0]);
  });

  it('splits multi-line labels into stacked texts', () => {
    const layout = explicitLayout(mbdV2ToExternalRecords(fixtureData()), 'label-1');

    expect(layout.formattedLabel).toBe('BRAN /24381-145712');
    expect(layout.texts).toEqual([
      {
        text: 'DN100 PSPEC A1A',
        anchor: [1.4, 0.3, 0],
        stackIndex: 1,
      },
    ]);
  });

  it('assembles weld and slope symbols from kernel primitives (ADR 0042)', () => {
    const result = mbdV2ToExternalRecords(fixtureData());

    const shop = explicitLayout(result, 'weld-shop-1');
    expect(shop.markers).toEqual([
      { at: [0.3, 0, 0], shape: 'circle', radiusPx: 5 },
    ]);

    const field = explicitLayout(result, 'weld-field-2');
    expect(field.markers).toEqual([
      { at: [0.9, 0, 0], shape: 'circle', radiusPx: 5 },
      { at: [0.9, 0, 0], shape: 'cross', radiusPx: 5 },
    ]);

    const slope = explicitLayout(result, 'slope-1');
    expect(slope.formattedLabel).toBe('i=1.0%');
    expect(slope.lines).toHaveLength(1);
    expect(slope.arrowLines).toHaveLength(2);

    const aidLine = explicitLayout(result, 'aid-line-1');
    expect(aidLine.lines[0]).toMatchObject({ style: 'dash-dot' });

    const aidPoint = explicitLayout(result, 'aid-point-1');
    expect(aidPoint.markers).toEqual([
      { at: [0.5, 0, 0], shape: 'cross' },
    ]);
  });

  it('skips duplicate primitive ids instead of throwing downstream', () => {
    const data = fixtureData();
    const duplicated: MbdV2PipeData = {
      ...data,
      primitives: [
        data.primitives[0]!,
        data.primitives[0]!,
      ],
    };

    const result = mbdV2ToExternalRecords(duplicated);

    expect(result.records).toHaveLength(1);
    expect(result.skipped).toEqual([
      {
        id: 'dim-segment-1',
        reason: 'Duplicate primitive id within MBD payload',
      },
    ]);
  });

  it('produces records the shared kernel can lay out end to end', () => {
    const result = mbdV2ToExternalRecords(fixtureData());
    const batch = layoutViewport(
      result.records.map(normalizeExternalDimension),
      {
        projector: createTestProjector(),
        font: createTestFont(),
        theme: SOLVESPACE_DIMENSION_THEME,
        format: DEFAULT_DIMENSION_FORMAT,
      },
      new Map(),
    );

    expect(batch.layouts).toHaveLength(result.records.length);
    expect(batch.layouts.every(layout => layout.labelPinned)).toBe(true);
    const weldLayout = batch.layouts.find(
      layout => layout.dimensionId === 'weld-field-2',
    )!;
    expect(
      weldLayout.primitives.filter(primitive => primitive.kind === 'marker'),
    ).toHaveLength(2);
  });
});
