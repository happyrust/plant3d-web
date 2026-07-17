import { describe, it, expect } from 'vitest';

import { detectPipeClearances } from './detectPipeClearances';

import type { PipeSegmentDto } from '@/types/pipeGeometry';

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
        } as PipeSegmentDto,
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
        } as PipeSegmentDto,
      ],
    };

    const result = detectPipeClearances(branches, 500);
    expect(result.length).toBe(1);
    expect(result[0]!.distance).toBeCloseTo(100, 0);
    expect(result[0]!.layout_hint?.pipe1_start).toEqual([0, 0, 0]);
    expect(result[0]!.layout_hint?.pipe1_end).toEqual([0, 10, 0]);
    expect(result[0]!.layout_hint?.pipe2_start).toEqual([200, 0, 0]);
    expect(result[0]!.layout_hint?.pipe2_end).toEqual([200, 10, 0]);
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
        } as PipeSegmentDto,
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
        } as PipeSegmentDto,
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
        } as PipeSegmentDto,
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
        } as PipeSegmentDto,
      ],
    };

    const result = detectPipeClearances(branches, 500);
    expect(result.length).toBe(0);
  });

  it('should respect max angle threshold', () => {
    const branches = {
      'bran1': [
        {
          id: 'seg1',
          refno: 'pipe1',
          noun: 'PIPE',
          arrive: [0, 0, 0],
          leave: [0, 100, 0],
          length: 100,
          straight_length: 100,
          outside_diameter: 100,
        } as PipeSegmentDto,
      ],
      'bran2': [
        {
          id: 'seg2',
          refno: 'pipe2',
          noun: 'PIPE',
          arrive: [200, 0, 0],
          leave: [214, 99, 0],
          length: 100,
          straight_length: 100,
          outside_diameter: 100,
        } as PipeSegmentDto,
      ],
    };

    expect(detectPipeClearances(branches, 500, 5).length).toBe(0);
    expect(detectPipeClearances(branches, 500, 10).length).toBe(1);
  });

  it('should keep zero-clearance touching pipes', () => {
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
        } as PipeSegmentDto,
      ],
      'bran2': [
        {
          id: 'seg2',
          refno: 'pipe2',
          noun: 'PIPE',
          arrive: [100, 0, 0],
          leave: [100, 10, 0],
          length: 10,
          straight_length: 10,
          outside_diameter: 100,
        } as PipeSegmentDto,
      ],
    };

    const result = detectPipeClearances(branches, 500);
    expect(result.length).toBe(1);
    expect(result[0]!.distance).toBeCloseTo(0, 8);
  });

  it('should use the layout default outside diameter when segment OD is missing', () => {
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
        } as PipeSegmentDto,
      ],
      'bran2': [
        {
          id: 'seg2',
          refno: 'pipe2',
          noun: 'PIPE',
          arrive: [329, 0, 0],
          leave: [329, 10, 0],
          length: 10,
          straight_length: 10,
        } as PipeSegmentDto,
      ],
    };

    const result = detectPipeClearances(branches, 500);
    expect(result.length).toBe(1);
    expect(result[0]!.distance).toBeCloseTo(100, 8);
  });

  it('should not report far offset finite pipe segments as close', () => {
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
        } as PipeSegmentDto,
      ],
      'bran2': [
        {
          id: 'seg2',
          refno: 'pipe2',
          noun: 'PIPE',
          arrive: [200, 1000, 0],
          leave: [200, 1010, 0],
          length: 10,
          straight_length: 10,
          outside_diameter: 100,
        } as PipeSegmentDto,
      ],
    };

    const result = detectPipeClearances(branches, 500);
    expect(result.length).toBe(0);
  });
});
