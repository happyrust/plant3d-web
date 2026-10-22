import { describe, expect, it } from 'vitest';

import type { OutsideDiameterEvidence, Vec3Mm } from '@/composables/branParallelSpacing';

import {
  buildPipeRowGroupRecords,
  commitPipeRowDetection,
  confirmPipeRowGroup,
  isPipeRowRecord,
  pipeRowRecordId,
  pipeRowValueText,
  PIPE_ROW_OD_MISSING_WARNING,
} from '@/clearance/adapters/pipeRowRecords';
import { createClearanceRecord, type ClearanceRecord } from '@/clearance/domain/clearanceRecord';
import { detectPipeRows, type PipeRowRunInput } from '@/clearance/domain/pipeRowGeometry';
import { createComputationProvenance } from '@/measurement/domain/computationProvenance';

function fakeRun(
  branRefno: string,
  anchor: string,
  start: Vec3Mm,
  end: Vec3Mm,
  odMm: number | null = 200,
  odEvidence: OutsideDiameterEvidence = 'catalogue',
): PipeRowRunInput {
  const len = Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z);
  return {
    branRefno,
    run: {
      branRefno,
      start,
      end,
      direction: { x: (end.x - start.x) / len, y: (end.y - start.y) / len, z: (end.z - start.z) / len },
      lengthMm: len,
      segments: [{
        refno: anchor,
        order: 0,
        noun: 'TUBI',
        implicit: true,
        start,
        end,
        length_mm: len,
        outside_diameter_mm: odMm,
      }],
      outsideDiameterMm: odMm,
      odEvidence,
    },
  };
}

const OPTIONS = {
  sesnoByBran: { a: 11, b: 22 },
  computedAt: new Date('2026-10-19T00:00:00Z'),
};

function detectionOf(inputs: PipeRowRunInput[], alignMode: 'center' | 'bottom' = 'center') {
  return detectPipeRows(inputs, { alignMode, supportNormal: { x: 0, y: 0, z: 1 } });
}

function legacyRecord(id = 'clearance:x:y'): ClearanceRecord {
  return createClearanceRecord({
    id,
    kind: 'component-to-component',
    inputs: { sourceRefno: 'x', targetRefno: 'y', targetKind: 'any' },
    sourceNoun: 'BRAN',
    targetNoun: 'BRAN',
    provenance: createComputationProvenance({
      method: 'surface-to-surface',
      accuracyClass: 'exact-surface',
      coordinateSpace: 'design-world',
      source: { entityId: 'x' },
      target: { entityId: 'y' },
    }),
    snapshot: null,
    modelVersion: { sourceSesno: null, targetSesno: null },
    computedAt: '2026-10-19T00:00:00Z',
  });
}

describe('buildPipeRowGroupRecords', () => {
  it('每对相邻管生成两条记录：截面中心距 + 外径推导间隔，id 无序且带区段身份', () => {
    const inputs = [
      fakeRun('a', 'a~1', { x: 0, y: 0, z: 0 }, { x: 3000, y: 0, z: 0 }),
      fakeRun('b', 'b~1', { x: 0, y: 200, z: 0 }, { x: 3000, y: 200, z: 0 }),
    ];
    const detection = detectionOf(inputs);
    const records = buildPipeRowGroupRecords(detection.groups[0]!, OPTIONS);

    expect(records).toHaveLength(2);
    const [center, gap] = records;
    expect(center!.provenance.method).toBe('pipe-row-center-distance');
    expect(center!.snapshot?.distanceM).toBeCloseTo(0.2, 9);
    expect(center!.pipeRow?.metric).toBe('center-distance');
    expect(center!.pipeRow?.signedGapM).toBeNull();
    expect(center!.pipeRow?.section.normal).toEqual([1, 0, 0]);

    expect(gap!.provenance.method).toBe('pipe-row-derived-gap');
    // 200 间距 − (200+200)/2 = 0：名义接触 → snapshot null，有符号真值在 pipeRow.signedGapM
    expect(gap!.snapshot).toBeNull();
    expect(gap!.pipeRow?.signedGapM).toBeCloseTo(0, 9);

    const positiveGap = detectPipeRows([
      fakeRun('a', 'a~1', { x: 0, y: 0, z: 0 }, { x: 3000, y: 0, z: 0 }),
      fakeRun('b', 'b~1', { x: 0, y: 500, z: 0 }, { x: 3000, y: 500, z: 0 }),
    ], { alignMode: 'center' });
    const positiveRecords = buildPipeRowGroupRecords(positiveGap.groups[0]!, OPTIONS);
    const positiveGapRecord = positiveRecords.find(r => r.pipeRow?.metric === 'derived-gap')!;
    expect(positiveGapRecord.snapshot?.distanceM).toBeCloseTo(0.3, 9);
    // 名义表面点：source 是排内在先的 b（y=500），沿 C_b→C_a 各缩 100mm 半径 → 400 / 100
    expect(positiveGapRecord.snapshot?.sourcePoint[1]).toBeCloseTo(0.4, 9);
    expect(positiveGapRecord.snapshot?.targetPoint[1]).toBeCloseTo(0.1, 9);
    expect(positiveGapRecord.pipeRow?.signedGapM).toBeCloseTo(0.3, 9);

    expect(center!.id).toMatch(/^piperow:center:center-distance:a~1:b~1@/);
    expect(gap!.id).toMatch(/^piperow:center:derived-gap:a~1:b~1@/);
    // 对调身份不变
    const geomSection = detection.groups[0]!.pairs[0]!.section;
    expect(pipeRowRecordId('center', 'center-distance', 'b~1', 'a~1', geomSection)).toBe(center!.id);
    for (const record of records) {
      expect(isPipeRowRecord(record)).toBe(true);
      expect(record.modelVersion).toEqual({ sourceSesno: 22, targetSesno: 11 }); // source=排内在前者
    }
  });

  it('管底对齐的记录带两管的管底点（B = C − r·n，三维关键点用）；管中心成排没有这一格', () => {
    const inputs = [
      fakeRun('a', 'a~1', { x: 0, y: 0, z: 100 }, { x: 3000, y: 0, z: 100 }),
      fakeRun('b', 'b~1', { x: 0, y: 500, z: 150 }, { x: 3000, y: 500, z: 150 }, 300),
    ];
    const bottom = buildPipeRowGroupRecords(detectionOf(inputs, 'bottom').groups[0]!, OPTIONS);
    expect(bottom).toHaveLength(2);
    for (const record of bottom) {
      const points = record.pipeRow!.bottomPoints!.map(p => p.map(v => Math.round(v * 1000) / 1000 + 0));
      expect([...points].sort((p, q) => p[1]! - q[1]!)).toEqual([[1.5, 0, 0], [1.5, 0.5, 0]]);
    }
    const center = buildPipeRowGroupRecords(detectionOf(inputs, 'center').groups[0]!, OPTIONS);
    expect(center.some(record => record.pipeRow?.bottomPoints)).toBe(false);
  });

  it('缺可靠外径 → 推导间隔 snapshot null + signedGapM null + 缺证据警告；中心距不受影响', () => {
    const detection = detectionOf([
      fakeRun('a', 'a~1', { x: 0, y: 0, z: 0 }, { x: 3000, y: 0, z: 0 }, 200, 'catalogue'),
      fakeRun('b', 'b~1', { x: 0, y: 500, z: 0 }, { x: 3000, y: 500, z: 0 }, null, 'missing'),
    ]);
    const records = buildPipeRowGroupRecords(detection.groups[0]!, OPTIONS);
    const gap = records.find(r => r.pipeRow?.metric === 'derived-gap')!;
    const center = records.find(r => r.pipeRow?.metric === 'center-distance')!;
    expect(gap.snapshot).toBeNull();
    expect(gap.pipeRow?.signedGapM).toBeNull();
    expect(gap.provenance.warnings).toContainEqual(PIPE_ROW_OD_MISSING_WARNING);
    expect(center.snapshot?.distanceM).toBeCloseTo(0.5, 9);
  });
});

/** 按 id upsert 的内存记录库，形状同 ClearanceStore 的 records / upsertRecord / removeRecord。 */
function memoryStore() {
  const records: ClearanceRecord[] = [];
  return {
    records,
    upsertRecord: (record: ClearanceRecord) => {
      const i = records.findIndex(existing => existing.id === record.id);
      if (i >= 0) records[i] = record;
      else records.push(record);
    },
    removeRecord: (id: string) => {
      const i = records.findIndex(record => record.id === id);
      if (i >= 0) records.splice(i, 1);
    },
  };
}

describe('commitPipeRowDetection', () => {
  it('只摘除本次锚点范围内同模式的旧连排记录，其他测量结果保留', () => {
    const detection = detectionOf([
      fakeRun('a', 'a~1', { x: 0, y: 0, z: 0 }, { x: 3000, y: 0, z: 0 }),
      fakeRun('b', 'b~1', { x: 0, y: 200, z: 0 }, { x: 3000, y: 200, z: 0 }),
    ]);
    const store: ClearanceRecord[] = [];
    const upsertRecord = (r: ClearanceRecord) => { store.push(r); };
    const removeRecord = (id: string) => {
      const i = store.findIndex(r => r.id === id);
      if (i >= 0) store.splice(i, 1);
    };
    const options = { ...OPTIONS, computedAt: new Date('2026-10-19T00:00:00Z') };

    const first = commitPipeRowDetection({
      groups: detection.groups,
      anchorScope: ['a~1', 'b~1'],
      alignMode: 'center',
      records: store,
      upsertRecord,
      removeRecord,
      options,
    });
    expect(first).toHaveLength(2);
    expect(store).toHaveLength(2);

    // 其他测量结果（非连排）混入不动
    store.push(legacyRecord());
    // 重跑同范围：旧连排记录被整组替换，不叠加
    const second = commitPipeRowDetection({
      groups: detection.groups,
      anchorScope: ['a~1', 'b~1'],
      alignMode: 'center',
      records: store,
      upsertRecord,
      removeRecord,
      options,
    });
    expect(second).toHaveLength(2);
    expect(store).toHaveLength(3);
    expect(store.filter(r => r.id === 'clearance:x:y')).toHaveLength(1);
    // bottom 模式的记录不被 center 模式提交摘除
    const bottomDetection = detectPipeRows([
      fakeRun('a', 'a~1', { x: 0, y: 0, z: 10 }, { x: 3000, y: 0, z: 10 }, 20),
      fakeRun('b', 'b~1', { x: 0, y: 40, z: 40 }, { x: 3000, y: 40, z: 40 }, 80),
    ], { alignMode: 'bottom', supportNormal: { x: 0, y: 0, z: 1 } });
    commitPipeRowDetection({
      groups: bottomDetection.groups,
      anchorScope: ['a~1', 'b~1'],
      alignMode: 'bottom',
      records: store,
      upsertRecord,
      removeRecord,
      options,
    });
    expect(store.filter(r => r.pipeRow?.alignMode === 'center')).toHaveLength(2);
    expect(store.filter(r => r.pipeRow?.alignMode === 'bottom')).toHaveLength(2);
  });

  it('先构造再动库：构造中途抛错时旧记录一条不少', () => {
    const inputs = [
      fakeRun('a', 'a~1', { x: 0, y: 0, z: 0 }, { x: 3000, y: 0, z: 0 }),
      fakeRun('b', 'b~1', { x: 0, y: 200, z: 0 }, { x: 3000, y: 200, z: 0 }),
    ];
    const memory = memoryStore();
    const commit = (options: typeof OPTIONS) => commitPipeRowDetection({
      groups: detectionOf(inputs).groups,
      anchorScope: ['a~1', 'b~1'],
      alignMode: 'center',
      ...memory,
      options,
    });
    commit(OPTIONS);
    const before = [...memory.records];
    expect(before).toHaveLength(2);

    expect(() => commit({ ...OPTIONS, computedAt: new Date(Number.NaN) })).toThrow(RangeError);
    expect(memory.records).toEqual(before);
  });

  it('多解 / 分组不完整的排不出正式记录；成员上的旧记录不摘，改标 stale 等人工确认', () => {
    const a = fakeRun('a', 'a~1', { x: 0, y: 0, z: 0 }, { x: 3000, y: 0, z: 0 });
    const b = fakeRun('b', 'b~1', { x: 0, y: 200, z: 0 }, { x: 3000, y: 200, z: 0 });
    const memory = memoryStore();
    commitPipeRowDetection({
      groups: detectionOf([a, b]).groups,
      anchorScope: ['a~1', 'b~1'],
      alignMode: 'center',
      ...memory,
      options: OPTIONS,
    });
    const confirmedIds = memory.records.map(r => r.id);
    expect(confirmedIds).toHaveLength(2);

    // 再补两根成 2×2 网格：横竖两种分法同样合理，排都标多解
    const grid = detectionOf([
      a,
      b,
      fakeRun('a', 'a~2', { x: 0, y: 0, z: 200 }, { x: 3000, y: 0, z: 200 }),
      fakeRun('b', 'b~2', { x: 0, y: 200, z: 200 }, { x: 3000, y: 200, z: 200 }),
    ]);
    expect(grid.groups.length).toBeGreaterThan(0);
    expect(grid.groups.every(group => group.ambiguous)).toBe(true);
    const created = commitPipeRowDetection({
      groups: grid.groups,
      anchorScope: ['a~1', 'b~1', 'a~2', 'b~2'],
      alignMode: 'center',
      ...memory,
      options: OPTIONS,
    });
    expect(created).toEqual([]);
    expect(memory.records.map(r => r.id)).toEqual(confirmedIds);
    expect(memory.records.every(r => r.status === 'stale')).toBe(true);
  });
});

describe('confirmPipeRowGroup', () => {
  it('人工确认待定的排：按同一构造生成记录、保留判定警告，并替换这排成员上留着的 stale 旧记录', () => {
    const run = (bran: string, y: number, z: number, x1: number, od: number, evidence: OutsideDiameterEvidence) =>
      fakeRun(bran, `${bran}~1`, { x: 0, y, z }, { x: x1, y, z }, od, evidence);
    const memory = memoryStore();
    commitPipeRowDetection({
      groups: detectionOf([run('a', 0, 10, 2000, 20, 'catalogue'), run('b', 40, 40, 2000, 80, 'catalogue')], 'bottom').groups,
      anchorScope: ['a~1', 'b~1'],
      alignMode: 'bottom',
      ...memory,
      options: OPTIONS,
    });
    expect(memory.records).toHaveLength(2);

    // 这次外径来自旧服务端成员外径：管底归排是估算，排待确认，旧记录改标 stale
    const held = detectionOf([run('a', 0, 10, 3000, 20, 'legacy-member'), run('b', 40, 40, 3000, 80, 'legacy-member')], 'bottom');
    expect(held.groups[0]!.estimatedGrouping).toBe(true);
    expect(commitPipeRowDetection({ groups: held.groups, anchorScope: ['a~1', 'b~1'], alignMode: 'bottom', ...memory, options: OPTIONS })).toEqual([]);
    expect(memory.records.every(r => r.status === 'stale')).toBe(true);

    const confirmed = confirmPipeRowGroup({ group: held.groups[0]!, ...memory, options: OPTIONS });
    expect(confirmed).toHaveLength(2);
    expect(memory.records.map(r => r.id).sort()).toEqual(confirmed.map(r => r.id).sort());
    expect(memory.records.every(r => r.status === 'current')).toBe(true);
    const gap = memory.records.find(r => r.pipeRow?.metric === 'derived-gap')!;
    expect(gap.provenance.warnings.map(w => w.code)).toEqual(['pipe_row_estimated_grouping', 'pipe_row_od_legacy']);
    expect(gap.provenance.accuracyClass).toBe('derived-nominal');
  });
});

describe('pipeRowValueText', () => {
  it('中心距与推导间隔各说各的：名义接触按容差、名义重叠带单位、估算外径带 ≈、缺外径如实说', () => {
    const records = (yB: number, odB: number | null, evidence: OutsideDiameterEvidence) => buildPipeRowGroupRecords(detectionOf([
      fakeRun('a', 'a~1', { x: 0, y: 0, z: 0 }, { x: 3000, y: 0, z: 0 }),
      fakeRun('b', 'b~1', { x: 0, y: yB, z: 0 }, { x: 3000, y: yB, z: 0 }, odB, evidence),
    ]).groups[0]!, OPTIONS);
    expect(records(500, 200, 'catalogue').map(pipeRowValueText)).toEqual(['500 mm', '300 mm']);
    const touching = records(200.3, 200, 'catalogue');
    expect(touching.map(pipeRowValueText)).toEqual(['200 mm', '名义接触']);
    expect(touching[1]!.snapshot).toBeNull();
    expect(records(188, 200, 'bore-estimate').map(pipeRowValueText)).toEqual(['188 mm', '≈名义重叠 12 mm']);
    expect(records(500, null, 'missing').map(pipeRowValueText)).toEqual(['500 mm', '缺外径']);
  });
});
