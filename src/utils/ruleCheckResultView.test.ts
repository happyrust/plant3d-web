import { describe, expect, it } from 'vitest';

import {
  countViolationsByResultSeverity,
  filterRuleViolations,
  groupViolationsByRule,
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
});
