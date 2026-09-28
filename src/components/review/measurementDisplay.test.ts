import { describe, expect, it } from 'vitest';

import {
  formatMeasurementEntityId,
  formatMeasurementPath,
  normalizeMeasurementEntityId,
} from './measurementDisplay';

describe('measurementDisplay', () => {
  it('formats common refno-like entity ids for display', () => {
    expect(formatMeasurementEntityId('24381_145018')).toBe('24381/145018');
    expect(formatMeasurementEntityId('24381/145018')).toBe('24381/145018');
    expect(formatMeasurementEntityId('o:24381_145018:0')).toBe('24381/145018');
    expect(formatMeasurementEntityId('pe:=24381/145018')).toBe('24381/145018');
    expect(formatMeasurementEntityId('<24381/145018>')).toBe('24381/145018');
    expect(formatMeasurementEntityId('⟨24381/145018⟩')).toBe('24381/145018');
  });

  it('keeps unknown ids readable without over-normalizing', () => {
    expect(normalizeMeasurementEntityId('object-abc')).toBe('object-abc');
    expect(formatMeasurementEntityId('object-abc')).toBe('object-abc');
    expect(formatMeasurementEntityId('')).toBe('-');
    expect(formatMeasurementEntityId(null)).toBe('-');
  });

  it('formats distance and angle measurement paths with normalized point ids', () => {
    expect(formatMeasurementPath({
      kind: 'distance',
      origin: { entityId: 'o:24381_145018:0' },
      target: { entityId: '24381_145019' },
    })).toBe('起点 24381/145018 -> 终点 24381/145019');

    expect(formatMeasurementPath({
      kind: 'angle',
      origin: { entityId: 'pe:=24381/145018' },
      corner: { entityId: '<24381/145019>' },
      target: { entityId: '24381_145020' },
    })).toBe('起点 24381/145018 -> 拐点 24381/145019 -> 终点 24381/145020');
  });
});
