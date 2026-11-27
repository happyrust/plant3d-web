import { describe, expect, it } from 'vitest';

import {
  countViolationsByAccuracy,
  countViolationsByDiscipline,
  countViolationsByResultSeverity,
  describeRuleCheckError,
  filterRuleViolations,
  formatRuleCheckClock,
  formatRuleCheckDuration,
  groupViolationsByRule,
  ruleViolationKey,
  violationGapLabel,
  violationGaugeRatio,
} from './ruleCheckResultView';

import type { UnifiedRuleViolation } from '@/api/ruleCheckApi';

function mk(partial: Partial<UnifiedRuleViolation>): UnifiedRuleViolation {
  return {
    key: partial.key ?? 'k',
    engine: partial.engine ?? 'spatial',
    ruleId: partial.ruleId ?? 'LAY-189',
    issue: partial.issue ?? 189,
    discipline: partial.discipline ?? '布置',
    title: partial.title ?? '最小净距',
    requirement: partial.requirement ?? '>=500mm',
    sourceLabel: partial.sourceLabel ?? 'PIPE 24381_10',
    targetLabel: partial.targetLabel ?? 'WALL 24381_20',
    roomNum: partial.roomNum,
    severity: partial.severity ?? 'violation',
    highlightColor: partial.highlightColor,
    highlightRefnos: partial.highlightRefnos ?? ['24381_10'],
    detail: partial.detail ?? '净距不足',
    accuracy: partial.accuracy,
    branchRefno: partial.branchRefno,
    copyNamed: partial.copyNamed,
  };
}

describe('ruleCheckResultView', () => {
  const sample: UnifiedRuleViolation[] = [
    mk({ key: '1', ruleId: 'LAY-189', issue: 189, highlightRefnos: ['24381_10', '24381_20'] }),
    mk({ key: '2', ruleId: 'LAY-189', issue: 189, highlightRefnos: ['24381_20', '24381_30'], detail: '第二处净距不足' }),
    mk({ key: '3', engine: 'bran', ruleId: 'INST-225', issue: 225, discipline: '仪控', severity: 'reminder', highlightRefnos: ['24381_40'] }),
    mk({ key: '4', engine: 'rooms', ruleId: 'ELEC-250', issue: 250, discipline: '电气', roomNum: 'R101', severity: 'semi_auto', highlightRefnos: ['24381_50'] }),
    mk({ key: '5', engine: 'attrs', ruleId: 'ELEC-282', issue: 282, discipline: '电气', highlightColor: 'red', highlightRefnos: ['24381_60'] }),
  ];

  it('counts all severities and firezone annotations accurately', () => {
    expect(countViolationsByResultSeverity(sample)).toEqual({
      all: 5,
      violation: 3,
      reminder: 1,
      semi_auto: 1,
      firezone: 1,
    });
  });

  it('filters by severity, firezone, room number, refno, and keyword', () => {
    expect(filterRuleViolations(sample, { severity: 'reminder', keyword: '' }).map((v) => v.key)).toEqual(['3']);
    expect(filterRuleViolations(sample, { severity: 'semi_auto', keyword: '' }).map((v) => v.key)).toEqual(['4']);
    expect(filterRuleViolations(sample, { severity: 'firezone', keyword: '' }).map((v) => v.key)).toEqual(['5']);
    expect(filterRuleViolations(sample, { severity: 'all', keyword: 'r101' }).map((v) => v.key)).toEqual(['4']);
    expect(filterRuleViolations(sample, { severity: 'all', keyword: '24381_30' }).map((v) => v.key)).toEqual(['2']);
  });

  it('groups violations by engine+ruleId and deduplicates group highlightRefnos', () => {
    const groups = groupViolationsByRule(sample);
    expect(groups).toHaveLength(4);
    expect(groups[0]!.ruleId).toBe('LAY-189');
    expect(groups[0]!.violations).toHaveLength(2);
    expect(groups[0]!.allHighlightRefnos).toEqual(['24381_10', '24381_20', '24381_30']);
  });

  it('counts and filters by accuracy and matches the BRAN of project-wide rows', () => {
    const rows: UnifiedRuleViolation[] = [
      mk({ key: 'e', accuracy: 'exact' }),
      mk({ key: 'a', accuracy: 'aabb' }),
      mk({ key: 'n' }),
      mk({ key: 'b', engine: 'bran', ruleId: 'hyd-007', branchRefno: '24381_145018' }),
    ];
    expect(countViolationsByAccuracy(rows)).toEqual({ all: 4, exact: 1, aabb: 1 });
    expect(filterRuleViolations(rows, { severity: 'all', keyword: '', accuracy: 'exact' }).map((v) => v.key)).toEqual(['e']);
    expect(filterRuleViolations(rows, { severity: 'all', keyword: '', accuracy: 'aabb' }).map((v) => v.key)).toEqual(['a']);
    expect(filterRuleViolations(rows, { severity: 'all', keyword: '145018' }).map((v) => v.key)).toEqual(['b']);
  });

  it('finds rows tagged as E3D copies by the keyword 副本 or copy', () => {
    const rows: UnifiedRuleViolation[] = [mk({ key: 'c', copyNamed: true }), mk({ key: 'o' })];
    expect(filterRuleViolations(rows, { severity: 'all', keyword: '副本' }).map((v) => v.key)).toEqual(['c']);
    expect(filterRuleViolations(rows, { severity: 'all', keyword: 'Copy' }).map((v) => v.key)).toEqual(['c']);
  });

  it('narrows rows by discipline, by one rule, and to E3D copies', () => {
    expect(countViolationsByDiscipline(sample)).toEqual({ 布置: 2, 仪控: 1, 电气: 2 });
    expect(filterRuleViolations(sample, { severity: 'all', keyword: '', disciplines: ['电气'] }).map((v) => v.key)).toEqual(['4', '5']);
    expect(
      filterRuleViolations(sample, { severity: 'all', keyword: '', ruleKey: ruleViolationKey(sample[2]!) }).map((v) => v.key),
    ).toEqual(['3']);
    const rows: UnifiedRuleViolation[] = [mk({ key: 'c', copyNamed: true }), mk({ key: 'o' })];
    expect(filterRuleViolations(rows, { severity: 'all', keyword: '', copyOnly: true }).map((v) => v.key)).toEqual(['c']);
  });

  it('formats durations and the running clock for people', () => {
    expect(formatRuleCheckDuration(850)).toBe('850 ms');
    expect(formatRuleCheckDuration(52010)).toBe('52.0 s');
    expect(formatRuleCheckDuration(161000)).toBe('2 分 41 秒');
    expect(formatRuleCheckDuration(120000)).toBe('2 分');
    expect(formatRuleCheckDuration(3_720_000)).toBe('1 小时 2 分');
    expect(formatRuleCheckClock(72_400)).toBe('01:12');
  });

  it('says how far a measurement misses its threshold', () => {
    const below: UnifiedRuleViolation = { ...mk({}), measuredMm: 52.1, thresholdMm: 100, marginMm: -47.9 };
    const above: UnifiedRuleViolation = { ...mk({}), measuredMm: 1212, thresholdMm: 1200, marginMm: 12 };
    expect(violationGapLabel(below)).toBe('差 47.9');
    expect(violationGapLabel(above)).toBe('超 12.0');
    expect(violationGapLabel(mk({}))).toBeNull();
    expect(violationGaugeRatio(below)).toBeCloseTo(0.521);
    expect(violationGaugeRatio(above)).toBeNull();
  });

  it('turns network and backend errors into one plain sentence', () => {
    expect(describeRuleCheckError('gen-model 请求失败 GET http://localhost:8022/api/v1/rule-check/rooms/run: Failed to fetch'))
      .toBe('连不上 gen-model（后端没有响应）');
    expect(describeRuleCheckError('HTTP 503 Service Unavailable: {"error":"attrs offline"}')).toBe('gen-model 服务出错（HTTP 503）');
    expect(describeRuleCheckError('HTTP 404 Not Found')).toBe('gen-model 没有这个接口（可能是旧版本后端）');
    expect(describeRuleCheckError('request timed out after 120s')).toBe('请求超时');
    expect(describeRuleCheckError('请先输入 BRAN refno')).toBe('请先输入 BRAN refno');
  });
});
