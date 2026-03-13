import { beforeEach, describe, expect, it } from 'vitest';

import { computeCloudLayout, createRectAnnotationRecordFromObb, resolvePickedRefnoForFilter } from './useDtxTools';

import type { Obb } from './useToolStore';

describe('resolvePickedRefnoForFilter', () => {
  beforeEach(() => {
    // no-op: pure function tests only
  });

  it('点到 TUBI 且 noun 缺失时，仍尝试回溯 owner BRAN', () => {
    const findNoun = () => null;
    const findOwner = (refno: string) => refno === 'tubi_1' ? 'bran_1' : null;

    expect(resolvePickedRefnoForFilter('tubi_1', ['BRAN'], findNoun, findOwner)).toBe('bran_1');
  });

  it('owner refno 可解析但 owner noun 缺失时，仍应通过 BRAN 过滤', () => {
    const findNoun = (refno: string) => refno === 'tubi_3' ? 'TUBI' : null;
    const findOwner = (refno: string) => refno === 'tubi_3' ? 'bran_4' : null;

    expect(resolvePickedRefnoForFilter('tubi_3', ['BRAN'], findNoun, findOwner)).toBe('bran_4');
  });

  it('点到 TUBI 且无法回溯 owner BRAN 时，返回 null', () => {
    const findNoun = () => null;
    const findOwner = () => null;

    expect(resolvePickedRefnoForFilter('tubi_2', ['BRAN'], findNoun, findOwner)).toBeNull();
  });

  it('直接点到 BRAN 时，应保留当前 refno', () => {
    const findNoun = (refno: string) => refno === 'bran_3' ? 'BRAN' : null;
    const findOwner = () => 'bran_should_not_be_used';

    expect(resolvePickedRefnoForFilter('bran_3', ['BRAN'], findNoun, findOwner)).toBe('bran_3');
  });
});

describe('createRectAnnotationRecordFromObb', () => {
  it('creates an OBB-backed rectangle annotation anchored at the OBB center', () => {
    const obb: Obb = {
      center: [5, 6, 7],
      axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
      halfSize: [2, 3, 4],
      corners: [
        [3, 3, 3], [7, 3, 3], [7, 9, 3], [3, 9, 3],
        [3, 3, 11], [7, 3, 11], [7, 9, 11], [3, 9, 11],
      ],
    };

    const record = createRectAnnotationRecordFromObb({
      id: 'rect-1',
      objectIds: ['bran_1'],
      refnos: ['bran_1'],
      obb,
      title: '矩形批注 1',
      description: 'demo',
      createdAt: 123,
    });

    expect(record.objectIds).toEqual(['bran_1']);
    expect(record.refnos).toEqual(['bran_1']);
    expect(record.obb).toEqual(obb);
    expect(record.anchorWorldPos).toEqual([5, 6, 7]);
    expect(record.leaderEndWorldPos?.[0]).toBeCloseTo(8.500357124637429);
    expect(record.leaderEndWorldPos?.[1]).toBeCloseTo(9.500357124637429);
    expect(record.leaderEndWorldPos?.[2]).toBeCloseTo(9.423324163210527);
    expect(record.visible).toBe(true);
    expect(record.title).toBe('矩形批注 1');
  });
});

describe('computeCloudLayout', () => {
  it('keeps cloud size fixed in screen space and positions label off the cloud body', () => {
    const layout = computeCloudLayout(
      { x: 100, y: 80, visible: true, ndcZ: 0.2 },
      { x: 40, y: -10 },
      { width: 120, height: 60 },
    );

    expect(layout.markerX).toBe(140);
    expect(layout.markerY).toBe(70);
    expect(layout.cloudCenterX).toBe(140);
    expect(layout.cloudCenterY).toBe(70);
    expect(layout.labelX).toBe(218);
    expect(layout.labelY).toBe(70);
    expect(layout.labelAlign).toBe('left');
    expect(layout.cloudPath).toContain('M');
    expect(layout.cloudPath).toContain('Z');
  });

  it('falls back to a stable default offset and clamps oversized marquee dimensions', () => {
    const layout = computeCloudLayout(
      { x: 160, y: 90, visible: true, ndcZ: 0.3 },
      undefined,
      { width: 400, height: 12 },
    );

    expect(layout.markerX).toBe(296);
    expect(layout.markerY).toBe(48);
    expect(layout.cloudCenterX).toBe(296);
    expect(layout.cloudCenterY).toBe(48);
    expect(layout.labelX).toBe(424);
    expect(layout.labelY).toBe(48);
    expect(layout.labelAlign).toBe('left');
    expect(layout.cloudPath).toContain('406.0 48.0');
  });

  it('supports left-side labels when the cloud is offset left of the anchor', () => {
    const layout = computeCloudLayout(
      { x: 200, y: 120, visible: true, ndcZ: 0.1 },
      { x: -50, y: 20 },
      { width: 100, height: 50 },
    );

    expect(layout.labelAlign).toBe('right');
    expect(layout.cloudCenterX).toBe(150);
    expect(layout.cloudCenterY).toBe(140);
    expect(layout.labelX).toBe(82);
    expect(layout.labelY).toBe(140);
  });
});
