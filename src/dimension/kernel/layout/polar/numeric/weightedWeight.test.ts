import { describe, expect, it } from 'vitest';

import { weightedWeight } from './weightedWeight';

const plain = { basicRadius: 200, isInstPipe: false };
const inst = { basicRadius: 200, isInstPipe: true };

describe('weightedWeight', () => {
  it('adds the angle and radius weights and scales by the lead coefficient', () => {
    expect(weightedWeight(0, 200, false, 30, plain)).toBe(0);
    expect(weightedWeight(10, 600, true, 30, plain)).toBeCloseTo(7.8, 9);
    expect(weightedWeight(10, 600, true, 30, inst)).toBeCloseTo(3.9, 9);
  });

  it('falls back to a basic radius of 200 when the system reports 0', () => {
    expect(weightedWeight(50, 9000, false, 60, { basicRadius: 0, isInstPipe: false })).toBe(75);
  });

  it('normalizes the angle deviation by needAngle / 30 before bucketing', () => {
    // 10° × 60 / 30 = 20 → the `< 30` bucket (polarsystem.pmlobj:1305, :1315-1316).
    expect(weightedWeight(10, 0, false, 60, plain)).toBe(8);
  });

  it('matches the PML angle buckets at their boundaries (:1309-1325)', () => {
    const at = (angle: number) => weightedWeight(angle, 0, false, 30, plain);
    expect(at(5)).toBe(0);
    expect(at(15)).toBe(3);
    expect(at(20)).toBe(8);
    expect(at(30)).toBe(10);
    expect(at(45)).toBe(12);
    expect(at(60)).toBe(15);
    expect(at(80)).toBe(25);
  });

  it('matches the PML radius buckets at their boundaries (:1354-1378)', () => {
    const at = (rt: number) => weightedWeight(0, rt * 200, false, 30, plain);
    expect(at(2)).toBe(1);
    expect(at(3)).toBe(3);
    expect(at(4)).toBe(5);
    expect(at(5)).toBe(6);
    expect(at(7)).toBe(7);
    expect(at(10)).toBe(9);
    expect(at(15)).toBe(11);
    expect(at(20)).toBe(12);
    expect(at(25)).toBe(13);
    expect(at(30)).toBe(14);
    expect(at(40)).toBe(50);
  });

  it('matches the PML instrument-pipe radius buckets at their boundaries (:1381-1401)', () => {
    const at = (rt: number) => weightedWeight(0, rt * 200, false, 30, inst);
    expect(at(4)).toBe(1);
    expect(at(6)).toBe(3);
    expect(at(8)).toBe(5);
    expect(at(10)).toBe(6);
    expect(at(14)).toBe(7);
    expect(at(20)).toBe(10);
    expect(at(30)).toBe(15);
    // :1397 repeats `lt 40` with weight 20 after `lt 40 → 15`; it is unreachable,
    // so 40 itself already lands in the `else → 50` bucket.
    expect(at(40)).toBe(50);
  });
});
