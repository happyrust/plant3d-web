import { describe, expect, it } from 'vitest';

import {
  bannerCounts,
  categoryLabel,
  countsSummary,
  describeMismatch,
  formatDeltaMm,
  formatDurationMs,
  latestStatusByRefno,
  mismatchDisplayName,
  mismatchLocateTarget,
  nodeVerdictLabel,
  rvmStatusTitle,
  stageLabel,
  statusFromRun,
  verdictTone,
  type RvmRunLike,
} from './rvmCheckFormat';

import type { RvmMismatch } from '@/api/rvmCheckApi';

describe('verdictTone', () => {
  it('maps the three compare colours and leaves a running job pending', () => {
    expect(verdictTone('pass').label).toBe('通过');
    expect(verdictTone('pass').banner).toContain('emerald');
    expect(verdictTone('kind_differ').banner).toContain('amber');
    expect(verdictTone('fail').chip).toContain('red');
    expect(verdictTone(null).verdict).toBe('pending');
    expect(verdictTone('running').verdict).toBe('pending');
  });

  it('has grey tones for the derived verdicts', () => {
    expect(verdictTone('empty').label).toBe('无可比内容');
    expect(verdictTone('tool_error').label).toBe('工具故障');
    expect(verdictTone('external').label).toBe('非几何问题');
    expect(nodeVerdictLabel('external')).toBe('非几何问题');
  });
});

describe('statusFromRun with reasons', () => {
  it('derives empty / external and puts the main reasons in the title', () => {
    const zero = { both: 0, only_baseline: 0, only_generated: 0, off: 0 };
    const empty = statusFromRun({ task_id: 'a', state: 'failed', result: { refno: '24383/80151', verdict: 'fail', stage: 'compare', message: '没有配上任何构件', counts: zero, mismatches: [] } });
    expect(empty?.verdict).toBe('empty');
    const naming = statusFromRun({
      task_id: 'b',
      state: 'failed',
      result: {
        refno: '14195/2',
        verdict: 'fail',
        stage: 'compare',
        message: '不一致',
        counts: { ...zero, only_baseline: 1, only_generated: 1 },
        mismatches: [
          { category: 'only_baseline', name: 'FLOOR 1 of SITE 2 of WORLD /*' },
          { category: 'only_generated', name: '/GENERATED/FLOOR 1 of SITE 1 of WORL /*' },
        ],
      },
    });
    expect(naming?.verdict).toBe('external');
    expect(naming?.reasons).toBe('命名没配上 2');
    expect(rvmStatusTitle(naming!)).toContain('RVM 核对：非几何问题');
    expect(rvmStatusTitle(naming!)).toContain('主要原因：命名没配上 2');
  });
});

describe('stage and category labels', () => {
  it('uses the page wording for the four stages and the mismatch categories', () => {
    expect(stageLabel('generate_ours')).toBe('生成我们的 RVM');
    expect(stageLabel('e3d_export')).toBe('E3D 导出');
    expect(stageLabel('compare')).toBe('比对');
    expect(stageLabel(undefined)).toBe('等待');
    expect(categoryLabel('only_baseline')).toBe('仅 E3D');
    expect(categoryLabel('only_generated')).toBe('仅生成');
    expect(categoryLabel('kind_differ')).toBe('图元种类不同');
    expect(categoryLabel('container_off')).toBe('管身偏差');
  });
});

describe('formatDeltaMm', () => {
  it('keeps sub-millimetre deltas and rounds large ones', () => {
    expect(formatDeltaMm(null)).toBe('');
    expect(formatDeltaMm(0)).toBe('0');
    expect(formatDeltaMm(0.0124)).toBe('0.012');
    expect(formatDeltaMm(12.54)).toBe('12.5');
  });
});

describe('describeMismatch', () => {
  const base: RvmMismatch = {
    category: 'off',
    name: '/C-1',
    noun: 'PIPE',
    max_axis_delta_mm: 12.34,
    baseline_kinds: ['CYLI'],
    generated_kinds: ['CYLI'],
    baseline_aabb: [0, 0, 0, 100, 100, 100],
    generated_aabb: [0, 0, 0, 100, 100, 112.34],
  };

  it('says how far off and on which axis', () => {
    expect(describeMismatch(base)).toBe('位置或尺寸偏差 12.3 mm，最大在 Z 向');
  });

  it('names both primitive sets when kinds differ', () => {
    expect(describeMismatch({ ...base, category: 'kind_differ', baseline_kinds: ['CONE'], generated_kinds: ['CYLI', 'CYLI'] }))
      .toBe('包围盒对得上，图元不同：E3D CONE，生成 CYLI×2');
  });

  it('describes one-sided rows', () => {
    expect(describeMismatch({ ...base, category: 'only_baseline' })).toBe('E3D 有这个构件，我们没有生成');
    expect(describeMismatch({ ...base, category: 'only_generated' })).toBe('我们生成了这个构件，E3D 导出里没有');
    expect(describeMismatch({ ...base, category: 'container_off', max_axis_delta_mm: 3 })).toBe('管身偏差 3.000 mm');
  });
});

describe('mismatchLocateTarget', () => {
  it('uses a name directly and falls back to the named owner', () => {
    expect(mismatchLocateTarget('/C-1')).toEqual({ name: '/C-1', viaOwner: false });
    expect(mismatchLocateTarget('PIPE /C-1')).toEqual({ name: '/C-1', viaOwner: false });
    expect(mismatchLocateTarget('BEND 3 of BRANCH /C-1/B1')).toEqual({ name: '/C-1/B1', viaOwner: true });
    expect(mismatchLocateTarget('BOX 2 of EQUI 4 of ZONE 1')).toBeNull();
    expect(mismatchLocateTarget('')).toBeNull();
  });

  it('gives up on paths that only reach WORLD or a generated placeholder name', () => {
    expect(mismatchLocateTarget('FLOOR 1 of FRMWORK 1 of STRUCTURE 1 of ZONE 1 of SITE 2 of WORLD /*')).toBeNull();
    expect(mismatchLocateTarget('/GENERATED/FLOOR 1 of FRMW 1 of STRU 1 of ZONE 1 of SITE 1 of WORL /*')).toBeNull();
    expect(mismatchLocateTarget('/*')).toBeNull();
  });
});

describe('mismatchDisplayName', () => {
  it('drops the pairing key rvm_compare appends to generated-only names', () => {
    expect(mismatchDisplayName('/GENERATED/MDS/VH111/100/H2   /MDS/VH111/100/H2')).toBe('/GENERATED/MDS/VH111/100/H2');
    expect(mismatchDisplayName('/GENERATED/BEND 1 of BRAN 1 of SITE 10 of WORL /* BEND BEND 1')).toBe('/GENERATED/BEND 1 of BRAN 1 of SITE 10 of WORL /* BEND BEND 1');
    expect(mismatchDisplayName('  TUBE 1 of BRANCH /A  ')).toBe('TUBE 1 of BRANCH /A');
  });
});

describe('countsSummary', () => {
  it('lists only the non-zero counts', () => {
    expect(countsSummary({ both: 66, exact: 41, off: 11, only_baseline: 4, only_generated: 0, kind_differ: 0 })).toBe('配上 66 · 偏差 11 · 仅 E3D 4');
    expect(countsSummary({ both: 0 })).toBe('');
    expect(countsSummary(null)).toBe('');
  });
});

describe('bannerCounts', () => {
  it('keeps only the non-zero counts in banner order', () => {
    expect(bannerCounts({ both: 66, off: 11, only_baseline: 8, only_generated: 5, kind_differ: 0 })).toEqual([
      { label: '配上', value: 66 },
      { label: '偏差', value: 11 },
      { label: '仅 E3D', value: 8 },
      { label: '仅生成', value: 5 },
    ]);
    expect(bannerCounts({ both: 0 })).toEqual([]);
    expect(bannerCounts(null)).toEqual([]);
  });
});

describe('formatDurationMs', () => {
  it('sums the four stages into minutes and seconds', () => {
    expect(formatDurationMs({ resolve: 1_000, generate_ours: 60_000, e3d_export: 500_000, compare: 20_000 })).toBe('用时 9 分 41 秒');
    expect(formatDurationMs({ resolve: 0, generate_ours: 0, e3d_export: 0, compare: 41_200 })).toBe('用时 41 秒');
    expect(formatDurationMs({ resolve: 0, generate_ours: 0, e3d_export: 3_725_000, compare: 0 })).toBe('用时 1 小时 2 分');
    expect(formatDurationMs({ resolve: 0, generate_ours: 0, e3d_export: 0, compare: 0 })).toBe('');
    expect(formatDurationMs(null)).toBe('');
  });
});

describe('latestStatusByRefno', () => {
  it('keeps the newest run per node and maps states to tree verdicts', () => {
    const runs: RvmRunLike[] = [
      { task_id: 'old', kind: 'rvm_check', state: 'succeeded', created_at: '2026-11-01T00:00:00Z', result: { refno: '1/2', verdict: 'pass', sesno: 10 } },
      { task_id: 'new', kind: 'rvm_check', state: 'failed', created_at: '2026-11-03T00:00:00Z', result: { refno: '1/2', verdict: 'fail', sesno: 11, message: '偏差 3 处' } },
      { task_id: 'other', kind: 'rvm_check', state: 'partial', created_at: '2026-11-02T00:00:00Z', result: { refno: '3/4', verdict: 'kind_differ' } },
      { task_id: 'live', kind: 'rvm_check', state: 'running', created_at: '2026-11-04T00:00:00Z', current_stage: 'e3d_export', detail: { refno: '5/6' } },
      { task_id: 'skip', kind: 'data_batch', state: 'succeeded', created_at: '2026-11-05T00:00:00Z', result: { refno: '1/2' } },
    ];
    const latest = latestStatusByRefno(runs);
    expect(Object.keys(latest).sort()).toEqual(['1_2', '3_4', '5_6']);
    expect(latest['1_2']).toMatchObject({ verdict: 'fail', taskId: 'new', sesno: 11, message: '偏差 3 处' });
    expect(latest['3_4']?.verdict).toBe('kind_differ');
    expect(latest['5_6']).toMatchObject({ verdict: 'running', stage: 'e3d_export' });
  });

  it('treats a terminal run without a verdict as a failure', () => {
    const latest = latestStatusByRefno([{ task_id: 't', state: 'failed', result: null, detail: { refno: '7/8' } }]);
    expect(latest['7_8']?.verdict).toBe('fail');
  });
});
