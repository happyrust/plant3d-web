/** 库内结果的纯格式化：终态、没跑完归类、原因计数的筛选、汇总行并批次、构件名取定位名称。 */
import { describe, expect, it } from 'vitest';

import {
  describeStoreError,
  elementName,
  facetOptions,
  facetTotal,
  failureClassOfReason,
  failureClassOfStatus,
  formatPeakMb,
  formatSeconds,
  groupBatches,
  ledgerEntries,
  reasonKindInfo,
  reasonTotals,
  rollupTotals,
  runStatusKey,
  stageFailureClass,
  statusCounts,
  storeCategoryLabel,
  storeLocateTarget,
  storeStatusInfo,
  unitKindLabel,
} from './rvmStoreFormat';

import type { RvmStoreReasonCount, RvmStoreRollupRow } from '@/api/rvmCheckStoreApi';

import { GenModelV1ApiError } from '@/api/genModelV1Api';

function rollupRow(overrides: Partial<RvmStoreRollupRow>): RvmStoreRollupRow {
  return {
    batch_id: 'accept-20261110/7999-zone',
    dbnum: 7999,
    root_refno: '24383/80211',
    root_noun: 'SITE',
    root_name: '/1RX-ELECBJ',
    mode: 'zone',
    runs: 19,
    units: { zone: 19 },
    status: { pass: 17, empty: 2 },
    clean: true,
    not_clean_runs: 0,
    not_clean: [],
    counts: { both: 8829, exact: 8829 },
    mismatch_total: 0,
    seconds: { resolve: 0, generate: 54, e3d_export: 17.1, compare: 0 },
    gen_peak_private_mb: 270,
    finished_at: '2026-11-10T11:58:56.149334+08:00',
    finished_unix_ms: 1794283136149,
    ...overrides,
  };
}

describe('终态', () => {
  it('认得批量命令的全部终态，没过的不算干净', () => {
    expect(storeStatusInfo('pass')).toMatchObject({ label: '通过', tone: 'pass', clean: true });
    expect(storeStatusInfo('empty')).toMatchObject({ label: '无可比内容', clean: true });
    expect(storeStatusInfo('kind_differ')).toMatchObject({ label: '种类不一致', clean: false });
    expect(storeStatusInfo('no-baseline')).toMatchObject({ label: '缺基准', tone: 'tool_error', clean: false });
    expect(storeStatusInfo('gen-failed').label).toBe('生成失败');
    expect(storeStatusInfo('timeout').label).toBe('生成超时');
    expect(storeStatusInfo('commit-guard').label).toBe('内存护栏');
    expect(storeStatusInfo('compare-failed').label).toBe('比对失败');
  });

  it('不认识的终态原样显示，按没过算', () => {
    expect(storeStatusInfo('mystery')).toMatchObject({ label: 'mystery', tone: 'fail', clean: false });
  });

  it('个数表排成「没过的在前」，零的不要', () => {
    const items = statusCounts({ pass: 17, empty: 2, fail: 3, 'no-baseline': 1, timeout: 0 });
    expect(items.map((item) => `${item.status}:${item.count}`)).toEqual(['fail:3', 'no-baseline:1', 'pass:17', 'empty:2']);
  });

  it('批量行的终态原样用；页面单根的三色要再细分', () => {
    expect(runStatusKey({ status: 'no-baseline', verdict: 'fail', source: 'batch' })).toBe('no-baseline');
    // 页面单根：生成超时落成 fail + 一条 stage_failure
    expect(runStatusKey({
      status: 'fail',
      verdict: 'fail',
      source: 'page',
      mismatch_by_category: { stage_failure: 1 },
      mismatch_by_kind: { generate_timeout: 1 },
    })).toBe('timeout');
    // 页面单根：两侧都空，后端仍报 pass
    expect(runStatusKey({ status: 'pass', verdict: 'pass', source: 'page', counts: { both: 0, off: 0 } })).toBe('empty');
    // 比对跑完却一件没配上：是比对出的结论，不改成没跑完
    expect(runStatusKey({
      status: 'fail',
      verdict: 'fail',
      source: 'page',
      mismatch_by_category: { stage_failure: 1 },
      mismatch_by_kind: { compare_nothing_paired: 1 },
    })).toBe('fail');
    // 批量行即使带 stage_failure 也不改写：标签上的个数来自汇总，两边要对得上
    expect(runStatusKey({
      status: 'fail',
      verdict: 'fail',
      source: 'batch',
      mismatch_by_category: { stage_failure: 1 },
      mismatch_by_kind: { compare_nothing_paired: 1 },
    })).toBe('fail');
  });
});

describe('某一步没跑完归到哪一类', () => {
  it('从终态认', () => {
    expect(failureClassOfStatus('no-baseline')).toBe('baseline');
    expect(failureClassOfStatus('gen-failed')).toBe('generate');
    expect(failureClassOfStatus('timeout')).toBe('timeout');
    expect(failureClassOfStatus('commit-guard')).toBe('memory');
    expect(failureClassOfStatus('compare-failed')).toBe('compare');
    expect(failureClassOfStatus('fail')).toBeNull();
    expect(failureClassOfStatus('pass')).toBeNull();
  });

  it('从 stage_failure 行的原因种类认', () => {
    expect(failureClassOfReason('baseline_missing')).toBe('baseline');
    expect(failureClassOfReason('e3d_export_failed')).toBe('baseline');
    expect(failureClassOfReason('e3d_export_no_file')).toBe('baseline');
    expect(failureClassOfReason('generate_timeout')).toBe('timeout');
    expect(failureClassOfReason('generate_commit_guard')).toBe('memory');
    expect(failureClassOfReason('generate_panic')).toBe('generate');
    expect(failureClassOfReason('generate_failed')).toBe('generate');
    expect(failureClassOfReason('compare_panic')).toBe('compare');
    expect(failureClassOfReason('resolve_refno_invalid')).toBe('resolve');
    expect(failureClassOfReason('tree_not_ready')).toBe('resolve');
    expect(failureClassOfReason('run_failed')).toBe('other');
  });

  it('知道所在运行的终态时以终态为准', () => {
    // 批量的 compare-failed 落库后原因种类是笼统的 run_failed
    expect(stageFailureClass('run_failed', 'compare-failed')).toBe('compare');
    expect(stageFailureClass('e3d_export_failed', 'no-baseline')).toBe('baseline');
    // 终态只是 fail（页面单根）时退到原因种类
    expect(stageFailureClass('generate_commit_guard', 'fail')).toBe('memory');
    expect(stageFailureClass('run_failed')).toBe('other');
  });
});

describe('原因种类与分类', () => {
  it('有中文名和说明；不认识的原样显示', () => {
    expect(reasonKindInfo('aabb_shifted')).toMatchObject({ label: '整体偏移' });
    expect(reasonKindInfo('aabb_shifted').hint).toContain('位置整体偏了');
    expect(reasonKindInfo('extra_in_generated').label).toBe('生成侧多出');
    expect(reasonKindInfo('missing_implied_tube').label).toBe('缺隐式管身');
    expect(reasonKindInfo('centreline_only').label).toBe('只画中心线');
    expect(reasonKindInfo('brand_new_kind')).toEqual({ kind: 'brand_new_kind', label: 'brand_new_kind', hint: '' });
  });

  it('分类补上库里才有的两种', () => {
    expect(storeCategoryLabel('stage_failure')).toBe('没跑完');
    expect(storeCategoryLabel('centreline_only')).toBe('只画中心线');
    expect(storeCategoryLabel('only_generated')).toBe('仅生成');
  });

  it('无名的根 / 单元库里记的 name 就是 noun，不当名字用', () => {
    expect(elementName('/1RX02-LCT', 'ZONE')).toBe('/1RX02-LCT');
    expect(elementName('ZONE', 'ZONE')).toBeNull();
    expect(elementName('zone', 'ZONE')).toBeNull();
    expect(elementName('', 'SITE')).toBeNull();
    expect(elementName(null, null)).toBeNull();
  });

  it('单元种类：老记录没有这一格，按整根算', () => {
    expect(unitKindLabel('zone')).toBe('ZONE');
    expect(unitKindLabel('fallback')).toBe('兜底');
    expect(unitKindLabel('root')).toBe('整根');
    expect(unitKindLabel(undefined)).toBe('整根');
  });
});

describe('原因计数的筛选', () => {
  // 取自库里 rvm-check-fused/all 这一批的真实计数，另加一条 warning 和一条 info
  const kinds: RvmStoreReasonCount[] = [
    { reason_kind: 'extra_in_generated', category: 'only_generated', severity: 'error', n: 55 },
    { reason_kind: 'extra_implied_tube', category: 'only_generated', severity: 'error', n: 4 },
    { reason_kind: 'aabb_shifted', category: 'off', severity: 'error', n: 2 },
    { reason_kind: 'missing_unnamed_element', category: 'only_baseline', severity: 'error', n: 2 },
    { reason_kind: 'aabb_one_axis_size', category: 'off', severity: 'error', n: 1 },
    { reason_kind: 'e3d_export_failed', category: 'stage_failure', severity: 'error', n: 1 },
    { reason_kind: 'missing_implied_tube', category: 'only_baseline', severity: 'error', n: 1 },
    { reason_kind: 'facet_vs_analytic', category: 'kind_differ', severity: 'warning', n: 3 },
    { reason_kind: 'centreline_only', category: 'centreline_only', severity: 'info', n: 7 },
  ];

  it('合计跟着条件走', () => {
    expect(facetTotal(kinds)).toBe(76);
    expect(facetTotal(kinds, { severity: 'error' })).toBe(66);
    expect(facetTotal(kinds, { category: 'off' })).toBe(3);
    expect(facetTotal(kinds, { category: 'off', reason_kind: 'aabb_shifted' })).toBe(2);
    expect(facetTotal(kinds, { category: 'off', reason_kind: 'extra_in_generated' })).toBe(0);
  });

  it('某一格的可选值不受它自己的条件限制，其余条件照常生效', () => {
    const categories = facetOptions(kinds, 'category', { category: 'off', severity: 'error' });
    expect(categories).toEqual([
      { value: 'only_generated', n: 59 },
      { value: 'off', n: 3 },
      { value: 'only_baseline', n: 3 },
      { value: 'stage_failure', n: 1 },
    ]);
    expect(facetOptions(kinds, 'severity', {})).toEqual([
      { value: 'error', n: 66 },
      { value: 'info', n: 7 },
      { value: 'warning', n: 3 },
    ]);
  });

  it('按原因种类合并，多的在前，原因这一格自己的条件不算', () => {
    const totals = reasonTotals(kinds, { category: 'only_generated', reason_kind: 'extra_implied_tube' });
    expect(totals).toEqual([
      { reason_kind: 'extra_in_generated', n: 55, severity: 'error', categories: ['only_generated'] },
      { reason_kind: 'extra_implied_tube', n: 4, severity: 'error', categories: ['only_generated'] },
    ]);
  });

  it('同一种原因分在几个级别下时取最重的', () => {
    const split: RvmStoreReasonCount[] = [
      { reason_kind: 'aabb_off', category: 'off', severity: 'warning', n: 1 },
      { reason_kind: 'aabb_off', category: 'container_off', severity: 'error', n: 2 },
    ];
    expect(reasonTotals(split)).toEqual([{ reason_kind: 'aabb_off', n: 3, severity: 'error', categories: ['off', 'container_off'] }]);
  });
});

describe('汇总行并成批次', () => {
  const rows = [
    rollupRow({}),
    rollupRow({
      batch_id: 'rvm-check-fused/all',
      dbnum: 8000,
      root_refno: '24384/22399',
      root_name: '/1RX03-EQUI',
      mode: 'root',
      runs: 1,
      units: { root: 1 },
      status: { fail: 1 },
      clean: false,
      not_clean_runs: 1,
      not_clean: [{ refno: '24384/22399', noun: 'SITE', name: '/1RX03-EQUI', status: 'fail' }],
      mismatch_total: 40,
      seconds: { resolve: 0, generate: 1.5, e3d_export: 0, compare: 0 },
      gen_peak_private_mb: 187,
      finished_at: '2026-11-08T15:40:19.491359700+08:00',
      finished_unix_ms: 1794123619491,
    }),
    rollupRow({
      batch_id: 'rvm-check-fused/all',
      dbnum: 7999,
      root_refno: '24383/66456',
      root_name: '/1WCC-PIPEBJ',
      mode: 'root',
      runs: 1,
      units: { root: 1 },
      status: { 'no-baseline': 1 },
      clean: false,
      not_clean_runs: 1,
      not_clean: [{ refno: '24383/66456', noun: 'SITE', name: '/1WCC-PIPEBJ', status: 'no-baseline' }],
      mismatch_total: 1,
      seconds: { resolve: 0, generate: 2.5, e3d_export: 0, compare: 0.5 },
      gen_peak_private_mb: 332,
      finished_at: '2026-11-08T15:40:03.93074+08:00',
      finished_unix_ms: 1794123603930,
    }),
  ];

  it('保持服务端的顺序，逐批合计', () => {
    const batches = groupBatches(rows);
    expect(batches.map((batch) => batch.batchId)).toEqual(['accept-20261110/7999-zone', 'rvm-check-fused/all']);
    expect(batches[0]).toMatchObject({ roots: 1, runs: 19, notCleanRuns: 0, mismatchTotal: 0, modes: ['zone'], dbnums: [7999], peakMb: 270 });
    expect(batches[1]).toMatchObject({
      rows: 2,
      roots: 2,
      runs: 2,
      notCleanRuns: 2,
      mismatchTotal: 41,
      modes: ['root'],
      dbnums: [7999, 8000],
      status: { fail: 1, 'no-baseline': 1 },
      peakMb: 332,
      finishedUnixMs: 1794123619491,
      finishedAt: '2026-11-08T15:40:19.491359700+08:00',
    });
    expect(batches[1]?.seconds).toEqual({ resolve: 0, generate: 4, e3d_export: 0, compare: 0.5 });
    expect(batches[1]?.notClean.map((unit) => unit.refno)).toEqual(['24384/22399', '24383/66456']);
  });

  it('同一个根的两种跑法只算一个上级根', () => {
    const totals = rollupTotals([rollupRow({ mode: 'zone' }), rollupRow({ mode: 'root', runs: 1, units: { root: 1 }, status: { pass: 1 } })]);
    expect(totals).toMatchObject({ rows: 2, roots: 1, runs: 20, modes: ['zone', 'root'], units: { zone: 19, root: 1 }, status: { pass: 18, empty: 2 } });
  });

  it('没有行时是全零', () => {
    expect(rollupTotals([])).toMatchObject({ rows: 0, roots: 0, runs: 0, peakMb: null, finishedAt: null });
  });
});

describe('数值', () => {
  it('耗时', () => {
    expect(formatSeconds(0)).toBe('—');
    expect(formatSeconds(null)).toBe('—');
    expect(formatSeconds(2.5)).toBe('2.5 秒');
    expect(formatSeconds(54)).toBe('54 秒');
    expect(formatSeconds(83)).toBe('1 分 23 秒');
    expect(formatSeconds(7500)).toBe('2 小时 5 分');
  });

  it('生成峰值内存', () => {
    expect(formatPeakMb(null)).toBe('—');
    expect(formatPeakMb(270)).toBe('270 MB');
    expect(formatPeakMb(9318)).toBe('9.1 GB');
  });

  it('生成侧账本只留非零的格，表格合计并带明细', () => {
    const entries = ledgerEntries({
      visited: 100,
      generated: 80,
      skipped: 0,
      evidence_pending: { ATTA: 5, SCTN: 2 },
      unknown_nouns: {},
      not_wired: { PNOD: 3 },
    });
    expect(entries).toEqual([
      { key: 'visited', label: '访问', value: 100, detail: '' },
      { key: 'generated', label: '生成', value: 80, detail: '' },
      { key: 'evidence_pending', label: '待证据', value: 7, detail: 'ATTA 5、SCTN 2' },
      { key: 'not_wired', label: 'not_wired', value: 3, detail: 'PNOD 3' },
    ]);
    expect(ledgerEntries(null)).toEqual([]);
  });
});

describe('构件名 → 能拿去模型树里找的名称', () => {
  it('配上的件：noun、序号、有名属主', () => {
    expect(storeLocateTarget('BOX 1 /1-LNR-Q005-PJ')).toEqual({ name: '/1-LNR-Q005-PJ', viaOwner: true });
    expect(storeLocateTarget('TUBI 1 /1WCC1135/B1')).toEqual({ name: '/1WCC1135/B1', viaOwner: true });
  });

  it('仅 E3D 的无名件退到有名属主', () => {
    expect(storeLocateTarget('TUBE 2 of BRANCH /1WCC1135/B1')).toEqual({ name: '/1WCC1135/B1', viaOwner: true });
  });

  it('生成侧多出的件：无名的取末尾的有名属主，命名的取它自己', () => {
    expect(storeLocateTarget('/GENERATED/BEND 1 of BRAN /CODEX_DB8000_BR_COPY BEND BEND 1 /CODEX_DB8000_BR_COPY'))
      .toEqual({ name: '/CODEX_DB8000_BR_COPY', viaOwner: true });
    expect(storeLocateTarget('/GENERATED/Copy-of-R332.001   /Copy-of-R332.001')).toEqual({ name: '/Copy-of-R332.001', viaOwner: false });
  });

  it('命名元素直接用；没跑完的行（名称是 refno）和 WORLD 定位不了', () => {
    expect(storeLocateTarget('/C-1')).toEqual({ name: '/C-1', viaOwner: false });
    expect(storeLocateTarget('24384/26547')).toBeNull();
    expect(storeLocateTarget('FLOOR 1 of SITE 2 of WORLD /*')).toBeNull();
    expect(storeLocateTarget('')).toBeNull();
  });
});

describe('读不到时怎么说', () => {
  it('后端没回应', () => {
    const text = describeStoreError(new GenModelV1ApiError({ code: 'network', status: 0, path: '/api/v1/rvm-check/rollup', message: 'Failed to fetch' }));
    expect(text.message).toBe('Failed to fetch');
    expect(text.hint).toContain('8022');
  });

  it('后端是旧构建，没有这条路由', () => {
    const text = describeStoreError(new GenModelV1ApiError({
      code: 'not_found',
      status: 404,
      path: '/api/v1/rvm-check/rollup',
      message: 'HTTP 404 Not Found',
      hasEnvelope: false,
    }));
    expect(text.hint).toContain('旧构建');
  });

  it('后端查库失败', () => {
    const text = describeStoreError(new GenModelV1ApiError({ code: 'internal', status: 500, path: '/api/v1/rvm-check/history', message: '查 rvm_check_run' }));
    expect(text.hint).toContain('SurrealDB');
  });

  it('别的错误只给原文', () => {
    expect(describeStoreError(new Error('boom'))).toEqual({ message: 'boom', hint: '' });
  });
});
