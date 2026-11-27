import { beforeEach, describe, expect, it, vi } from 'vitest';

const { genModelV1FetchMock } = vi.hoisted(() => ({
  genModelV1FetchMock: vi.fn(),
}));

vi.mock('@/api/genModelV1Api', () => ({
  genModelV1Fetch: genModelV1FetchMock,
}));

import {
  fetchAllRuleCatalogs,
  normalizeAttrResponse,
  normalizeBranResponse,
  normalizeBranRunAllResponse,
  normalizeRoomResponse,
  normalizeRuleRefnoToken,
  normalizeSpatialResponse,
  runAttrRuleCheck,
  runBranRuleCheck,
  runBranRuleCheckAll,
  runRoomRuleCheck,
  runSpatialRuleCheck,
} from './ruleCheckApi';

describe('ruleCheckApi', () => {
  beforeEach(() => {
    genModelV1FetchMock.mockReset();
  });

  it('normalizes refno tokens from slash or spaces to underscore format', () => {
    expect(normalizeRuleRefnoToken(' 24381/145018 ')).toBe('24381_145018');
    expect(normalizeRuleRefnoToken('24381_145018')).toBe('24381_145018');
    expect(normalizeRuleRefnoToken('   ')).toBe('');
  });

  it('fetches all four rule catalogs and tolerates single-engine failure', async () => {
    genModelV1FetchMock.mockImplementation(async (path: string) => {
      if (path === '/api/v1/rule-check/rules') {
        return [
          {
            id: 'HYD-001',
            issue: 315,
            discipline: '水工',
            title: '水工净距',
            requirement: '>=300mm',
            threshold_mm: 300,
            unit: 'mm',
          },
        ];
      }
      if (path === '/api/v1/rule-check/bran/rules') {
        throw new Error('503 bran offline');
      }
      if (path === '/api/v1/rule-check/rooms/rules') {
        return [
          {
            id: 'ELEC-250',
            issue: 250,
            discipline: '电气',
            title: '配电室通道',
            requirement: '>=1500mm',
            unit: 'mm',
          },
        ];
      }
      if (path === '/api/v1/rule-check/attrs/rules') {
        return [
          {
            id: 'ELEC-282',
            issue: 282,
            discipline: '电气',
            title: '火灾分区',
            requirement: '红黄高亮',
            unit: '个',
          },
        ];
      }
      throw new Error(`unexpected path: ${path}`);
    });

    const { rules, warnings } = await fetchAllRuleCatalogs();
    expect(rules.map((r) => `${r.engine}:${r.id}`)).toEqual([
      'spatial:HYD-001',
      'rooms:ELEC-250',
      'attrs:ELEC-282',
    ]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('BRAN 拓扑');
    expect(warnings[0]).toContain('503 bran offline');
  });

  it('passes query parameters for spatial, bran, room, and attr run endpoints', async () => {
    genModelV1FetchMock.mockResolvedValue({ results: [] });

    await runSpatialRuleCheck(['HYD-001', 'LAY-189']);
    expect(genModelV1FetchMock).toHaveBeenLastCalledWith('/api/v1/rule-check/run', {
      query: { rules: 'HYD-001,LAY-189' },
    });

    await runSpatialRuleCheck(['HYD-001'], undefined, { precise: true });
    expect(genModelV1FetchMock).toHaveBeenLastCalledWith('/api/v1/rule-check/run', {
      query: { rules: 'HYD-001', precise: '1' },
    });

    await runBranRuleCheck('24381/145018', ['INST-222']);
    expect(genModelV1FetchMock).toHaveBeenLastCalledWith('/api/v1/rule-check/bran/run', {
      query: { refno: '24381_145018', rules: 'INST-222' },
    });

    await runBranRuleCheckAll(['INST-222']);
    expect(genModelV1FetchMock).toHaveBeenLastCalledWith('/api/v1/rule-check/bran/run-all', {
      query: { rules: 'INST-222' },
    });

    await runRoomRuleCheck(['ELEC-250']);
    expect(genModelV1FetchMock).toHaveBeenLastCalledWith('/api/v1/rule-check/rooms/run', {
      query: { rules: 'ELEC-250' },
    });

    await runAttrRuleCheck(['ELEC-282', 'LAY-191'], ['24381/1', '24381/2']);
    expect(genModelV1FetchMock).toHaveBeenLastCalledWith('/api/v1/rule-check/attrs/run', {
      query: { rules: 'ELEC-282,LAY-191', refno: '24381_1,24381_2' },
    });
  });

  it('normalizes spatial, bran, room, and attr responses preserving severity, hasColumn, and firezone highlightColor', () => {
    const spatial = normalizeSpatialResponse({
      tree_state: 'ready',
      rules_run: 1,
      elapsed_ms: 12,
      warnings: ['w1'],
      results: [
        {
          id: 'LAY-189',
          issue: 189,
          discipline: '布置',
          title: '净距',
          requirement: '>=500mm',
          unit: 'mm',
          source_items: 4,
          target_items: 6,
          violation_total: 1,
          truncated: false,
          violations: [
            {
              source: { refno: '24381_10', noun: 'PIPE' },
              target: { refno: '24381_20', noun: 'WALL' },
              measured_mm: 320,
              threshold_mm: 500,
              margin_mm: -180,
              highlight_refnos: ['24381/10', '24381/20'],
            },
          ],
        },
      ],
    });
    expect(spatial.elapsedMs).toBe(12);
    expect(spatial.results[0]!.violations[0]!.highlightRefnos).toEqual(['24381_10', '24381_20']);
    expect(spatial.results[0]!.violations[0]!.measuredMm).toBe(320);

    const bran = normalizeBranResponse({
      branch_refno: '24381_145018',
      flow_direction: 'forward',
      elem_count: 8,
      rules_run: 1,
      warnings: [],
      results: [
        {
          id: 'INST-225',
          issue: 225,
          discipline: '仪控',
          title: '提醒',
          requirement: '需复核',
          unit: 'mm',
          checked_pairs: 2,
          violation_total: 1,
          truncated: false,
          warnings: [],
          violations: [
            {
              source: { refno: '24381_33', noun: 'VALV', order: 1 },
              target: { refno: '24381_34', noun: 'ELBO', order: 2 },
              measured_mm: 120,
              threshold_mm: 200,
              margin_mm: -80,
              severity: 'reminder',
              highlight_refnos: ['24381_33', '24381_34'],
              detail: '请人工复核',
            },
          ],
        },
      ],
    });
    expect(bran.results[0]!.violations[0]!.severity).toBe('reminder');
    expect(bran.results[0]!.violations[0]!.highlightRefnos).toEqual(['24381_33', '24381_34']);

    const rooms = normalizeRoomResponse({
      tree_state: 'ready',
      room_count: 3,
      rules_run: 1,
      elapsed_ms: 8,
      warnings: [],
      results: [
        {
          id: 'ELEC-250',
          issue: 250,
          discipline: '电气',
          title: '配电室通道',
          requirement: '>=1500mm',
          unit: 'mm',
          rooms_checked: 3,
          violation_total: 1,
          truncated: false,
          violations: [
            {
              room_num: 'R101',
              source_refnos: ['24381_100'],
              target_refnos: ['24381_101'],
              has_column: true,
              measured_mm: 1100,
              threshold_mm: 1500,
              margin_mm: -400,
              highlight_refnos: ['24381_100', '24381_101'],
              detail: '通道局部有柱',
            },
          ],
        },
      ],
    });
    expect(rooms.results[0]!.violations[0]!.hasColumn).toBe(true);
    expect(rooms.results[0]!.violations[0]!.highlightRefnos).toEqual(['24381_100', '24381_101']);

    const attrs = normalizeAttrResponse({
      tree_state: 'ready',
      rules_run: 1,
      elapsed_ms: 4,
      warnings: [],
      results: [
        {
          id: 'ELEC-282',
          issue: 282,
          discipline: '电气',
          title: '火灾分区',
          requirement: '扩散性红/局部性黄',
          checked_items: 2,
          violation_total: 1,
          truncated: false,
          violations: [
            {
              source_refno: '24381_500',
              source_noun: 'CTRAY',
              highlight_color: 'red',
              highlight_refnos: ['24381_500', '24381_501'],
              detail: '扩散性火灾分区',
            },
          ],
        },
      ],
    });
    expect(attrs.results[0]!.violations[0]!.highlightColor).toBe('red');
    expect(attrs.results[0]!.violations[0]!.highlightRefnos).toEqual(['24381_500', '24381_501']);
  });

  it('extracts endpoint refnos from implicit TUBI spans, falls back to branch_refno, and preserves rule unit', () => {
    const bran = normalizeBranResponse({
      branch_refno: '24381/145018',
      flow_direction: null,
      elem_count: 4,
      rules_run: 1,
      warnings: [],
      results: [
        {
          id: 'inst-024',
          issue: 224,
          discipline: '仪控',
          title: '仪表管坡度',
          requirement: '>=2%',
          unit: '%',
          checked_pairs: 2,
          violation_total: 2,
          truncated: false,
          warnings: [],
          violations: [
            {
              source: { refno: '24381_145033~24381_145035', noun: 'TUBI', order: 1 },
              target: { refno: '24381_145033~24381_145035', noun: 'TUBI', order: 1 },
              measured_mm: 0.3,
              threshold_mm: 2.0,
              margin_mm: -1.7,
              highlight_refnos: [],
              detail: '坡度不足',
            },
            {
              source: { refno: 'HEAD~TAIL', noun: 'TUBI', order: 2 },
              target: { refno: 'HEAD~TAIL', noun: 'TUBI', order: 2 },
              measured_mm: 0.0,
              threshold_mm: 2.0,
              margin_mm: -2.0,
              highlight_refnos: [],
              detail: '整支无拟合件',
            },
          ],
        },
      ],
    });
    expect(bran.results[0]!.violations[0]!.unit).toBe('%');
    expect(bran.results[0]!.violations[0]!.highlightRefnos).toEqual(['24381_145033', '24381_145035']);
    expect(bran.results[0]!.violations[1]!.highlightRefnos).toEqual(['24381_145018']);
  });

  it('maps accuracy, exact surface distance and per-rule precise stats from a precise spatial run', () => {
    const spatial = normalizeSpatialResponse({
      tree_state: 'Ready',
      precise: true,
      rules_run: 1,
      elapsed_ms: 52,
      warnings: [],
      results: [
        {
          id: 'hvac-001',
          issue: 287,
          discipline: '通风',
          title: '两风管净距',
          requirement: '≥100 mm',
          unit: 'mm',
          source_items: 9021,
          target_items: 9021,
          violation_total: 2,
          truncated: false,
          precise: { refinable: true, aabb_findings: 500, candidates: 640, exact: 640, unavailable: 0, cleared: 498 },
          violations: [
            {
              source: { refno: '24381_58129', noun: 'STRT' },
              target: { refno: '24383_75979', noun: 'ELBO' },
              measured_mm: 52.1,
              threshold_mm: 100,
              margin_mm: -47.9,
              highlight_refnos: ['24381/58129', '24383/75979'],
              accuracy: 'exact-surface',
              exact_surface_mm: 52.1,
            },
            {
              source: { refno: '24383_1102', noun: 'BOX' },
              target: { refno: '24383_1131', noun: 'CYLI' },
              measured_mm: 0,
              threshold_mm: 100,
              margin_mm: -100,
              highlight_refnos: ['24383/1102', '24383/1131'],
              accuracy: 'aabb',
              copy_named: true,
            },
          ],
        },
      ],
    });
    expect(spatial.precise).toBe(true);
    const [exact, estimated] = spatial.results[0]!.violations;
    expect(exact!.accuracy).toBe('exact');
    expect(exact!.exactSurfaceMm).toBe(52.1);
    expect(exact!.detail).toContain('网格精算');
    expect(estimated!.accuracy).toBe('aabb');
    expect(estimated!.exactSurfaceMm).toBeUndefined();
    expect(estimated!.detail).toContain('包围盒估算');
    expect(exact!.copyNamed).toBeUndefined();
    expect(estimated!.copyNamed).toBe(true);
    expect(spatial.results[0]!.precise).toEqual({
      refinable: true,
      aabbFindings: 500,
      candidates: 640,
      exact: 640,
      unavailable: 0,
      cleared: 498,
    });
  });

  it('normalizes project-wide BRAN results and keeps the branch of each violation', () => {
    const batch = normalizeBranRunAllResponse({
      brans_total: 3,
      brans_checked: 2,
      brans_failed: 1,
      rules_run: 1,
      elapsed_ms: 900,
      warnings: ['24381/150022 分支查询失败'],
      results: [
        {
          id: 'hyd-007',
          issue: 320,
          discipline: '水工',
          title: '相邻弯管间直管段最小距离',
          requirement: '按外径对照表 mm',
          unit: 'mm',
          brans_checked: 2,
          checked_pairs: 6,
          violation_total: 1,
          truncated: false,
          violations: [
            {
              branch_refno: '24381/145018',
              source: { refno: '24381_145031', noun: 'ELBO', order: 3 },
              target: { refno: '24381_145034', noun: 'ELBO', order: 4 },
              measured_mm: 86,
              threshold_mm: 114,
              margin_mm: -28,
              highlight_refnos: [],
              detail: '直管段不足',
            },
          ],
        },
      ],
    });
    expect(batch.bransTotal).toBe(3);
    expect(batch.bransChecked).toBe(2);
    expect(batch.bransFailed).toBe(1);
    expect(batch.elapsedMs).toBe(900);
    const v = batch.results[0]!.violations[0]!;
    expect(v.branchRefno).toBe('24381_145018');
    expect(v.highlightRefnos).toEqual(['24381_145031', '24381_145034']);
    expect(v.unit).toBe('mm');
  });
});
