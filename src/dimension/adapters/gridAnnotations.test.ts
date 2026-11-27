import { describe, expect, it, vi } from 'vitest';

import { ExternalDimensionRegistry } from '../services/externalDimensionRegistry';

import {
  collectSupportedGrids,
  GridAnnotationSource,
  layoutGridAnnotations,
} from './gridAnnotations';

import type { ExternalDimensionRecord } from './normalizeExternalDimensions';

const plane = {
  id: 'b',
  noun: 'GRIDPL' as const,
  origin: [0, 0, 0] as const,
  axisU: [2, 0, 0] as const,
  axisV: [0, 1, 0] as const,
};
const cylinder = {
  id: 'a',
  noun: 'GRIDCY' as const,
  origin: [0, 0, 1] as const,
  axis: [0, 0, 1] as const,
  radiusM: 0.5,
};

function otherRecord(): ExternalDimensionRecord {
  return {
    id: 'measurement:1',
    source: 'measurement',
    sourceLabel: '测量',
    role: 'external',
    layout: {
      id: 'measurement:1',
      kind: 'linear',
      role: 'external',
      labelPinned: true,
      a: [0, 0, 0],
      b: [1, 0, 0],
      placement: { offsetM: 0.1, labelT: 0.5, side: 1 },
    },
  };
}

describe('grid annotations (#78)', () => {
  it('keeps only supported nouns and sorts them by id', () => {
    expect(collectSupportedGrids([
      plane,
      { id: 'wall', noun: 'WALL' },
      { id: 'flat', noun: 'GRIDPL', origin: [0, 0, 0], axisU: [1, 0, 0], axisV: [2, 0, 0] },
      cylinder,
    ]).map(item => item.id)).toEqual(['a', 'b']);
  });

  it('lays a facing plane out as a linear dimension and skips an edge-on plane', () => {
    const facing = layoutGridAnnotations([plane], { forward: [0, 0, -1] });
    expect(facing).toHaveLength(1);
    expect(facing[0]).toMatchObject({
      id: 'grid:b',
      source: 'grid',
      sourceLabel: 'GRIDPL',
      role: 'external',
      layoutAuthority: 'solver',
      layout: {
        kind: 'linear',
        role: 'external',
        labelPinned: true,
        a: [0, 0, 0],
        b: [2, 0, 0],
      },
    });
    expect(layoutGridAnnotations([plane], { forward: [0, 1, 0] })).toEqual([]);
  });

  it('lays a cylinder out as a radius and keeps the value when the view changes', () => {
    const front = layoutGridAnnotations([cylinder], { forward: [0, 0, -1] });
    const side = layoutGridAnnotations([cylinder], { forward: [1, 0, 0] });
    expect(front[0]?.layout).toMatchObject({
      kind: 'radial',
      display: 'radius',
      center: [0, 0, 1],
    });
    const frontLayout = front[0]?.layout;
    const sideLayout = side[0]?.layout;
    if (!frontLayout || !('rim' in frontLayout) || !sideLayout || !('rim' in sideLayout)) {
      throw new Error('expected radial grid annotations');
    }
    expect(frontLayout.rim[0]).toBeCloseTo(0);
    const offset = [
      sideLayout.rim[0] - cylinder.origin[0],
      sideLayout.rim[1] - cylinder.origin[1],
      sideLayout.rim[2] - cylinder.origin[2],
    ];
    expect(Math.hypot(offset[0] ?? 0, offset[1] ?? 0, offset[2] ?? 0)).toBeCloseTo(0.5);
    expect(sideLayout.placement.leaderDirection).not.toEqual(frontLayout.placement.leaderDirection);
  });

  it('rebuilds the registry source when the draw list or the view changes and clears it without touching other sources', () => {
    const registry = new ExternalDimensionRegistry();
    registry.replaceSource('measurement', [otherRecord()]);
    const source = new GridAnnotationSource(records => registry.replaceSource('grid', records));

    source.setDrawList([plane, cylinder, { id: 'nope', noun: 'EQUI' }]);
    source.setView({ forward: [0, 0, -1] });
    expect(registry.snapshot.records.filter(record => record.source === 'grid').map(record => record.id))
      .toEqual(['grid:a', 'grid:b']);

    source.setView({ forward: [0, 1, 0] });
    expect(registry.snapshot.records.filter(record => record.source === 'grid').map(record => record.id))
      .toEqual(['grid:a']);

    source.clear();
    expect(registry.snapshot.records.map(record => record.id)).toEqual(['measurement:1']);
  });

  it('publishes nothing while there is no grid to draw, however often the view changes (#197)', () => {
    const publish = vi.fn();
    const source = new GridAnnotationSource(publish);

    source.setView({ forward: [0, 0, -1] });
    source.setView({ forward: [0.3, 0, -1] });
    source.setDrawList([{ id: 'nope', noun: 'EQUI' }]);
    source.setView(null);
    source.clear();

    expect(publish).not.toHaveBeenCalled();
  });

  it('republishes only when the records change (#197)', () => {
    const publish = vi.fn();
    const source = new GridAnnotationSource(publish);

    source.setDrawList([plane]);
    expect(publish).not.toHaveBeenCalled();

    source.setView({ forward: [0, 0, -1] });
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish.mock.calls[0]?.[0]).toHaveLength(1);

    // 同一条视线、同一份绘制列表再来一遍，记录没变，不重发。
    source.setView({ forward: [0, 0, -1] });
    source.setView({ forward: [0, 0, -2] });
    source.setDrawList([plane]);
    expect(publish).toHaveBeenCalledTimes(1);

    // 转到侧看：记录没了，撤下一次；继续侧着转不再发。
    source.setView({ forward: [0, 1, 0] });
    expect(publish).toHaveBeenCalledTimes(2);
    expect(publish.mock.calls[1]?.[0]).toEqual([]);
    source.setView({ forward: [1, 1, 0] });
    expect(publish).toHaveBeenCalledTimes(2);
  });
});
