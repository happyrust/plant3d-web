import { describe, expect, it } from 'vitest';

import {
  compareModelUnitGeometry,
  geometrySnapshotsFromInstanceEntries,
  orderModelUnitVersionPair,
  type ModelUnitGeometrySnapshot,
} from './modelUnitVersionCompare';

function snapshot(refno: string, signature: string): ModelUnitGeometrySnapshot {
  return { refno, noun: 'PIPE', signature };
}

describe('modelUnitVersionCompare', () => {
  it('自动把较早提交放在 A、较新提交放在 B', () => {
    const older = { manifest_url: '/791/manifest.json', commit: { sesno: 791 } };
    const newer = { manifest_url: '/897/manifest.json', commit: { sesno: 897 } };

    expect(orderModelUnitVersionPair(newer, older)).toEqual([older, newer]);
  });

  it('按 refno 分类新增、删除、修改和未变几何', () => {
    const rows = compareModelUnitGeometry(
      [snapshot('1_1', 'same'), snapshot('1_2', 'old'), snapshot('1_3', 'gone')],
      [snapshot('1_1', 'same'), snapshot('1_2', 'new'), snapshot('1_4', 'added')],
    );

    expect(rows.map(({ refno, status }) => [refno, status])).toEqual([
      ['1_4', 'added'],
      ['1_3', 'deleted'],
      ['1_2', 'modified'],
      ['1_1', 'unchanged'],
    ]);
  });

  it('几何签名关注网格和矩阵，不受显示名称变化影响', () => {
    const entry = (name: string, x: number) => ({
      geo_hash: 'mesh-a',
      geo_index: 0,
      matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, 0, 0, 1],
      uniforms: { noun: 'PIPE', name },
    });

    const oldSnapshot = geometrySnapshotsFromInstanceEntries(new Map([['1_1', [entry('old', 0)]]]))[0];
    const renamedSnapshot = geometrySnapshotsFromInstanceEntries(new Map([['1_1', [entry('new', 0)]]]))[0];
    const movedSnapshot = geometrySnapshotsFromInstanceEntries(new Map([['1_1', [entry('new', 10)]]]))[0];

    expect(renamedSnapshot.signature).toBe(oldSnapshot.signature);
    expect(movedSnapshot.signature).not.toBe(oldSnapshot.signature);
  });
});
