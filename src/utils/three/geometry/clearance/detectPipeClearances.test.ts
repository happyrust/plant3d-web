import { describe, it, expect } from 'vitest';

import { detectPipeClearances } from './detectPipeClearances';

import type { MbdPipeSegmentDto } from '@/api/mbdPipeApi';

describe('detectPipeClearances', () => {
  it('should detect parallel pipes within distance threshold', () => {
    const branches = {
      'bran1': [
        {
          id: 'seg1',
          refno: 'pipe1',
          noun: 'PIPE',
          arrive: [0, 0, 0],
          leave: [0, 10, 0],
          length: 10,
          straight_length: 10,
          outside_diameter: 100,
        } as MbdPipeSegmentDto,
      ],
      'bran2': [
        {
          id: 'seg2',
          refno: 'pipe2',
          noun: 'PIPE',
          arrive: [200, 0, 0],
          leave: [200, 10, 0],
          length: 10,
          straight_length: 10,
          outside_diameter: 100,
        } as MbdPipeSegmentDto,
      ],
    };

    const result = detectPipeClearances(branches, 500);
    expect(result.length).toBe(1);
    expect(result[0]!.distance).toBeCloseTo(100, 0);
  });

  it('should not detect pipes beyond distance threshold', () => {
    const branches = {
      'bran1': [
        {
          id: 'seg1',
          refno: 'pipe1',
          noun: 'PIPE',
          arrive: [0, 0, 0],
          leave: [0, 10, 0],
          length: 10,
          straight_length: 10,
          outside_diameter: 100,
        } as MbdPipeSegmentDto,
      ],
      'bran2': [
        {
          id: 'seg2',
          refno: 'pipe2',
          noun: 'PIPE',
          arrive: [1000, 0, 0],
          leave: [1000, 10, 0],
          length: 10,
          straight_length: 10,
          outside_diameter: 100,
        } as MbdPipeSegmentDto,
      ],
    };

    const result = detectPipeClearances(branches, 500);
    expect(result.length).toBe(0);
  });

  it('should not detect non-parallel pipes', () => {
    const branches = {
      'bran1': [
        {
          id: 'seg1',
          refno: 'pipe1',
          noun: 'PIPE',
          arrive: [0, 0, 0],
          leave: [0, 10, 0],
          length: 10,
          straight_length: 10,
          outside_diameter: 100,
        } as MbdPipeSegmentDto,
      ],
      'bran2': [
        {
          id: 'seg2',
          refno: 'pipe2',
          noun: 'PIPE',
          arrive: [200, 0, 0],
          leave: [210, 0, 0],
          length: 10,
          straight_length: 10,
          outside_diameter: 100,
        } as MbdPipeSegmentDto,
      ],
    };

    const result = detectPipeClearances(branches, 500);
    expect(result.length).toBe(0);
  });
});
