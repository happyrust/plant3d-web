import { describe, expect, it } from 'vitest';

import { Vector3 } from 'three';

import {
  normalizeMbdLayoutHint,
  resolveBranchLayout,
  resolveSemanticLane,
  resolveSemanticDimOffset,
} from './branchLayoutEngine';
import { computePipeAlignedOffsetDirs } from './computePipeAlignedOffsetDirs';

import type { MbdLayoutHint, MbdPipeSegmentDto } from '@/api/mbdPipeApi';

describe('branchLayoutEngine', () => {
  it('normalizes missing and partial hints field-by-field', () => {
    const normalized = normalizeMbdLayoutHint({
      offset_dir: [0, 2, 0],
      char_dir: [NaN, 0, 0] as any,
      offset_level: -3,
      layout_group_id: 'grp-1',
      declutter_priority: 4,
      unknown_key: 'kept',
    } as MbdLayoutHint);

    expect(normalized.offsetDir?.toArray()).toEqual([0, 1, 0]);
    expect(normalized.charDir).toBeUndefined();
    expect(normalized.offsetLevel).toBe(0);
    expect(normalized.layoutGroupId).toBe('grp-1');
    expect(normalized.declutterPriority).toBe(4);
    expect(normalized.raw?.unknown_key).toBe('kept');
  });

  it('prefers hint direction over branch topology and avoids camera fallback when sufficient data exists', () => {
    const segments: MbdPipeSegmentDto[] = [
      {
        id: 'seg-1',
        refno: 'seg-1',
        noun: 'STRA',
        arrive: [0, 0, 0],
        leave: [1000, 0, 0],
        length: 1000,
        straight_length: 1000,
      },
    ];
    const pipeOffsetDirs = computePipeAlignedOffsetDirs(segments);

    const resolved = resolveBranchLayout({
      start: new Vector3(0, 0, 0),
      end: new Vector3(1000, 0, 0),
      role: 'segment',
      hint: {
        offset_dir: [0, 1, 0],
        offset_level: 1,
      } as MbdLayoutHint,
      segments,
      pipeOffsetDirs,
    });

    expect(resolved.source).toBe('hint');
    expect(resolved.direction?.toArray()).toEqual([0, 1, 0]);
    expect(resolved.offset).toBeGreaterThan(0);
  });

  it('falls back to deterministic branch topology when hints are absent', () => {
    const segments: MbdPipeSegmentDto[] = [
      {
        id: 'seg-1',
        refno: 'seg-1',
        noun: 'STRA',
        arrive: [0, 0, 0],
        leave: [1000, 0, 0],
        length: 1000,
        straight_length: 1000,
      },
    ];
    const pipeOffsetDirs = computePipeAlignedOffsetDirs(segments);

    const resolved = resolveBranchLayout({
      start: new Vector3(0, 0, 0),
      end: new Vector3(1000, 0, 0),
      role: 'chain',
      segments,
      pipeOffsetDirs,
    });

    expect(resolved.source).toBe('branch');
    expect(resolved.direction).toBeTruthy();
    expect(resolved.normalizedHint.offsetLevel).toBe(0);
  });

  it('keeps semantic lane ordering stable for equivalent inputs', () => {
    const segmentOffset = resolveSemanticDimOffset(120, 'segment');
    const portOffset = resolveSemanticDimOffset(120, 'port');
    const chainOffset = resolveSemanticDimOffset(120, 'chain');
    const cutTubiOffset = resolveSemanticDimOffset(120, 'cut_tubi');
    const overallOffset = resolveSemanticDimOffset(120, 'overall');

    expect(segmentOffset).toBeLessThan(portOffset);
    expect(portOffset).toBeLessThan(chainOffset);
    expect(chainOffset).toBeLessThan(overallOffset);
    expect(chainOffset).toBeLessThan(cutTubiOffset);
    expect(cutTubiOffset).toBeLessThan(overallOffset);
  });

  it('keeps explicit placement_lane backward-compatible while preventing semantic regressions', () => {
    expect(resolveSemanticLane('chain', { placement_lane: 0 } as MbdLayoutHint)).toBe(2);
    expect(resolveSemanticLane('overall', { placement_lane: 3 } as MbdLayoutHint)).toBe(4);
    expect(resolveSemanticLane('cut_tubi', { placement_lane: 6 } as MbdLayoutHint)).toBe(6);
  });
});
