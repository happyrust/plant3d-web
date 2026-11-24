import { describe, expect, it } from 'vitest';

import {
  MBD_ANNOTATION_TYPE_LABELS,
  PIPE_EXPECTED_KINDS,
  expectedKindsFor,
  mbdAnnotationTypeLabel,
} from './mbdAnnotationTypes';

describe('mbdAnnotationTypeLabel', () => {
  it('names all nine annotation types of the closed vocabulary', () => {
    expect(MBD_ANNOTATION_TYPE_LABELS).toEqual({
      em4_pipe: 'EM4 管道',
      em9_pipe: 'EM9 仪表管',
      em4_supp: 'EM4 支架',
      em9_inst_supp: 'EM9 仪表支架',
      em9_pipe_supp: 'EM9 仪表管支架',
      civil: '土建结构',
      arch: '建筑',
      em4_equi: 'EM4 设备',
      em9_equi: 'EM9 设备',
    });
    expect(mbdAnnotationTypeLabel('em9_inst_supp')).toBe('EM9 仪表支架');
    expect(mbdAnnotationTypeLabel('civil')).toBe('土建结构');
  });

  it('has no label for a package that does not declare its type', () => {
    expect(mbdAnnotationTypeLabel(null)).toBeNull();
    expect(mbdAnnotationTypeLabel(undefined)).toBeNull();
  });

  it('echoes a value outside the vocabulary instead of hiding it', () => {
    expect(mbdAnnotationTypeLabel('em5_pipe')).toBe('em5_pipe');
    expect(mbdAnnotationTypeLabel('constructor')).toBe('constructor');
  });
});

describe('expectedKindsFor', () => {
  it('keeps the pipe expectation for both pipe types and for packages without a type', () => {
    for (const annotationType of ['em4_pipe', 'em9_pipe', null, undefined]) {
      expect(expectedKindsFor(annotationType)).toBe(PIPE_EXPECTED_KINDS);
    }
    expect(PIPE_EXPECTED_KINDS).toEqual([
      'linear_dim',
      'angle_dim',
      'label',
      'leader_line',
      'aid_line',
      'aid_text',
      'weld_mark',
      'slope_mark',
    ]);
  });

  it('returns the solver-aligned expected kinds for all seven non-pipe annotation types', () => {
    expect(expectedKindsFor('em4_supp')).toEqual([
      'linear_dim',
      'label',
      'leader_line',
      'aid_text',
      'aid_line',
      'aid_circle',
      'angle_dim',
    ]);
    expect(expectedKindsFor('em9_pipe_supp')).toEqual([
      'linear_dim',
      'label',
      'leader_line',
    ]);
    expect(expectedKindsFor('em9_inst_supp')).toEqual([
      'linear_dim',
      'label',
      'leader_line',
      'aid_text',
    ]);
    expect(expectedKindsFor('civil')).toEqual([
      'linear_dim',
      'label',
      'leader_line',
      'aid_line',
      'aid_text',
      'aid_arc',
      'aid_circle',
    ]);
    expect(expectedKindsFor('arch')).toEqual([
      'linear_dim',
      'label',
      'leader_line',
      'aid_text',
      'aid_circle',
    ]);
    expect(expectedKindsFor('em4_equi')).toEqual([
      'linear_dim',
      'angle_dim',
      'label',
      'leader_line',
      'aid_line',
      'aid_text',
    ]);
    expect(expectedKindsFor('em9_equi')).toEqual([
      'linear_dim',
      'angle_dim',
      'label',
      'leader_line',
      'aid_line',
      'aid_text',
    ]);
  });

  it('returns null for unknown annotation types outside the closed vocabulary', () => {
    expect(expectedKindsFor('em5_pipe')).toBeNull();
    expect(expectedKindsFor('constructor')).toBeNull();
  });
});
