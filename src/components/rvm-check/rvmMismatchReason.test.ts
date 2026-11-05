import { describe, expect, it } from 'vitest';

import { classifyReport, classifyRow, parseE3dLog, reasonBrief, type ClassifyContext } from './rvmMismatchReason';

import type { RvmMismatch } from '@/api/rvmCheckApi';

function row(category: string, name: string, extra: Partial<RvmMismatch> = {}): RvmMismatch {
  return {
    category,
    name,
    noun: '',
    max_axis_delta_mm: null,
    baseline_kinds: [],
    generated_kinds: [],
    baseline_aabb: null,
    generated_aabb: null,
    ...extra,
  };
}

const NO_CTX: ClassifyContext = { balancedOnlySides: false, log: null };

const E3D_LOG = [
  'Name /MDS-Standards-Supports',
  'Catalogue error for component ATTACHMENT /MDS-Standards-ST59-PS , catalogue primitive NSCYLINDER 1 of SBOX /GMSE-ST59-UB',
  'DESP parameter number ( 19 ) out of range',
  'Catalogue error for component ATTACHMENT /MDS-Standards-GT85-PS , catalogue primitive NSCYLINDER 5 of SBOX /GMSE-GT85-UB',
  'GMAMEM/gm_AddMember (member) - Invalid Item id ( =24381/175149 BOX 14 of SUBEQUIPMENT /Copy-of-HYHS-420210-TC1-P500 )',
].join('\r\n');

describe('parseE3dLog', () => {
  it('collects component names from catalogue errors and invalid item ids', () => {
    const info = parseE3dLog(E3D_LOG);
    expect([...info.errorNames].sort()).toEqual(['/Copy-of-HYHS-420210-TC1-P500', '/MDS-Standards-GT85-PS', '/MDS-Standards-ST59-PS']);
    expect(info.catalogueErrors).toBe(2);
    expect(info.invalidItems).toBe(1);
  });
});

describe('classifyRow', () => {
  it('naming: WORLD /* vs /GENERATED/ paths when both one-sided counts match (14195/2, 79977)', () => {
    const ctx: ClassifyContext = { balancedOnlySides: true, log: null };
    expect(classifyRow(row('only_baseline', 'FLOOR 1 of FRMWORK 1 of STRUCTURE 1 of ZONE 1 of SITE 2 of WORLD /*'), ctx).reason).toBe('naming');
    expect(classifyRow(row('only_generated', '/GENERATED/BEND 1 of BRAN 1 of HVAC 1 of ZONE 1 of SITE 10 of WORL /* BEND BEND 1'), ctx).reason).toBe('naming');
    // 两边数量不等时不认作命名问题
    expect(classifyRow(row('only_generated', '/GENERATED/TUBI 1 of BRAN /MDS-Standards-FT03-B1'), NO_CTX).reason).toBe('only_ours');
  });

  it('missing_template: E3D-only PJOINT under an SCTN template (24381/535)', () => {
    const detail = classifyRow(row('only_baseline', 'PJOINT 1 of PNODE 1 of TMPLATE 1 of SJOINT 1 of SNODE 1 of SCTN /1RCV013MN-SUPP-02-BAR-1'), NO_CTX);
    expect(detail.reason).toBe('missing_template');
  });

  it('e3d_catalogue: a row named in e3d.log (23705/289 GT85-PS)', () => {
    const ctx: ClassifyContext = { balancedOnlySides: false, log: parseE3dLog(E3D_LOG) };
    const gt85 = row('off', ' /MDS-Standards-GT85-PS', {
      max_axis_delta_mm: 136.5,
      baseline_aabb: [-170, -101.6, 0, 170, 101.6, 200],
      generated_aabb: [-170, -101.6, 84.86, 170, 101.6, 336.5],
    });
    expect(classifyRow(gt85, ctx).reason).toBe('e3d_catalogue');
    // 没有日志时同一行按几何分到「长度不同」
    expect(classifyRow(gt85, NO_CTX).reason).toBe('length');
    // 属主在日志里也算
    expect(classifyRow(row('only_baseline', 'BOX 2 of SUBEQUIPMENT /Copy-of-HYHS-420210-TC1-P500'), ctx).reason).toBe('e3d_catalogue');
  });

  it('length: SCTN 195 vs 300 along Z (23705/1)', () => {
    const detail = classifyRow(row('off', 'SCTN 2 FRMW 1 of /OGLFL1', {
      noun: 'SCTN',
      max_axis_delta_mm: 105,
      baseline_aabb: [-11, -50, 105, 11, 50, 300],
      generated_aabb: [-11, -50, 0, 11, 50, 300],
    }), NO_CTX);
    expect(detail.reason).toBe('length');
    expect(detail.text).toBe('长度不同：Z 向 E3D 195、生成 300（生成长 105 mm）');
  });

  it('shift: JOINT same size moved 66.6 along X (23705/1)', () => {
    const detail = classifyRow(row('off', 'SJOI 1 SNOD 1 of SCTN 1 of FRMW 1 of /OGLFL7', {
      noun: 'SJOI',
      max_axis_delta_mm: 66.6,
      baseline_aabb: [-103.4, -29, -66.1, 236.6, 29, 93],
      generated_aabb: [-170, -29, -66.1, 170, 29, 93],
    }), NO_CTX);
    expect(detail.reason).toBe('shift');
    expect(detail.text).toBe('尺寸一致，整体平移 66.6 mm，生成相对 E3D 沿 -X 66.6');
  });

  it('unpaired and fallbacks', () => {
    expect(classifyRow(row('unkeyable_baseline', '/MDS/FT62/1-V1/JOINT1（缺 noun/owner_desc/ordinal，且无同名生成元素）'), NO_CTX).reason).toBe('unpaired');
    expect(classifyRow(row('only_baseline', 'TUBE 1 of BRANCH /-CAM-E-2-H-5302'), NO_CTX).reason).toBe('only_e3d');
    expect(classifyRow(row('kind_differ', '/A'), NO_CTX).reason).toBe('kind');
    expect(classifyRow(row('weird', '/A'), NO_CTX).reason).toBe('other');
  });
});

const ZERO_COUNTS = {
  both: 0, exact: 0, chord: 0, reference_artifact: 0, film: 0, off: 0, only_baseline: 0, only_generated: 0,
  kind_match: 0, kind_differ: 0, container_off: 0, container_only_baseline: 0, container_only_generated: 0,
  centreline_only_baseline: 0, unkeyable_baseline: 0, unkeyable_generated: 0,
};

describe('classifyReport', () => {
  it('empty: all counts zero (/1AXIS)', () => {
    const result = classifyReport({ verdict: 'fail', stage: 'compare', message: '没有配上任何构件', counts: ZERO_COUNTS, mismatches: [] });
    expect(result.nodeVerdict).toBe('empty');
  });

  it('tool_error: rvm_compare failed (1PTU)', () => {
    const result = classifyReport({
      verdict: 'fail',
      stage: 'compare',
      message: 'rvm_compare 没有写出 compare.json（exit=Some(1)）\nError: e3d.rvm 里有 10 条记录的 bbox 帧认不出来',
      counts: ZERO_COUNTS,
      mismatches: [],
    });
    expect(result.nodeVerdict).toBe('tool_error');
  });

  it('external: only naming rows (14195/2)', () => {
    const result = classifyReport({
      verdict: 'fail',
      stage: 'compare',
      message: '不一致：偏差 0，仅 E3D 1，仅生成 1，种类不同 0',
      counts: { ...ZERO_COUNTS, only_baseline: 1, only_generated: 1 },
      mismatches: [
        row('only_baseline', 'FLOOR 1 of FRMWORK 1 of STRUCTURE 1 of ZONE 1 of SITE 2 of WORLD /*'),
        row('only_generated', '/GENERATED/FLOOR 1 of FRMW 1 of STRU 1 of ZONE 1 of SITE 1 of WORL /* FLOOR FLOO 1'),
      ],
    });
    expect(result.nodeVerdict).toBe('external');
    expect(result.externalRows).toBe(2);
    expect(reasonBrief(result.summary)).toBe('命名没配上 2');
  });

  it('keeps fail when any row is ours, and summarises by count', () => {
    const result = classifyReport({
      verdict: 'fail',
      stage: 'compare',
      message: '',
      counts: { ...ZERO_COUNTS, both: 127, only_baseline: 2 },
      mismatches: [
        row('only_baseline', 'PJOINT 1 of PNODE 1 of TMPLATE 1 of SJOINT 1 of SNODE 1 of SCTN /1RCV013MN-SUPP-02-BAR-1'),
        row('only_baseline', 'PJOINT 2 of PNODE 1 of TMPLATE 1 of SJOINT 1 of SNODE 1 of SCTN /1RCV013MN-SUPP-02-BAR-1'),
      ],
    });
    expect(result.nodeVerdict).toBe('fail');
    expect(result.summary).toEqual([{ reason: 'missing_template', count: 2 }]);
  });

  it('does not call a truncated list external', () => {
    const result = classifyReport({
      verdict: 'fail',
      stage: 'compare',
      message: '',
      counts: { ...ZERO_COUNTS, only_baseline: 1, only_generated: 1 },
      mismatches_truncated: true,
      mismatches: [row('only_baseline', 'FLOOR 1 of SITE 2 of WORLD /*')],
    });
    expect(result.nodeVerdict).toBe('fail');
  });

  it('passes stay pass', () => {
    expect(classifyReport({ verdict: 'pass', stage: 'compare', message: '', counts: { ...ZERO_COUNTS, both: 3 }, mismatches: [] }).nodeVerdict).toBe('pass');
  });
});
