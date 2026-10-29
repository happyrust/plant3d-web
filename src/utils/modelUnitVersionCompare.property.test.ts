import { describe, expect, it } from 'vitest';

import fc from 'fast-check';

import { compareModelUnitGeometry, type ModelUnitGeometrySnapshot } from './modelUnitVersionCompare';

const snapshotArb: fc.Arbitrary<ModelUnitGeometrySnapshot> = fc.record({
  refno: fc.tuple(fc.integer({ min: 1, max: 9999 }), fc.integer({ min: 1, max: 9999 })).map(([a, b]) => `${a}_${b}`),
  noun: fc.constantFrom('BRAN', 'EQUI', 'SUPPO', 'HANG'),
  signature: fc.stringMatching(/^[0-9a-f]{8,16}$/),
});

/** 同一 refno 至多一条（真实帧就是按 refno 索引的） */
const frameArb = fc.uniqueArray(snapshotArb, { minLength: 0, maxLength: 20, selector: (s) => s.refno });

describe('Property 23: 自比较全为未变', () => {
  // Feature: model-version-timeline-scrub, Property 23: 自比较全为未变
  it('compareModelUnitGeometry(x, x) 的每一行都是未变，且行数与 refno 数一致', () => {
    fc.assert(
      fc.property(frameArb, (frame) => {
        const diff = compareModelUnitGeometry(frame, frame);
        expect(diff).toHaveLength(frame.length);
        for (const row of diff) {
          expect(row.status).toBe('unchanged');
        }
        // refno 一一对应，noun 取原值
        expect(new Set(diff.map((r) => r.refno))).toEqual(new Set(frame.map((s) => s.refno)));
        for (const row of diff) {
          expect(row.noun).toBe(frame.find((s) => s.refno === row.refno)!.noun);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('同一帧的两份深拷贝比较结果与自比较相同', () => {
    fc.assert(
      fc.property(frameArb, (frame) => {
        const copy = frame.map((s) => ({ ...s }));
        expect(compareModelUnitGeometry(copy, frame)).toEqual(compareModelUnitGeometry(frame, frame));
      }),
      { numRuns: 100 },
    );
  });

  it('只有 signature 不同才算修改（自比较不会误报 added / deleted / modified）', () => {
    fc.assert(
      fc.property(frameArb, (frame) => {
        const diff = compareModelUnitGeometry(frame, frame);
        expect(diff.some((r) => r.status === 'added' || r.status === 'deleted' || r.status === 'modified')).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});
