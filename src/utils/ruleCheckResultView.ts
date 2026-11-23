import type { RuleCheckEngine, UnifiedRuleViolation } from '@/api/ruleCheckApi';

export type RuleCheckResultSeverityFilter =
  | 'all'
  | 'violation'
  | 'reminder'
  | 'semi_auto'
  | 'firezone';

export type RuleCheckResultFilterOptions = {
  severity: RuleCheckResultSeverityFilter;
  keyword: string;
};

export type RuleCheckResultSeverityCounts = Record<RuleCheckResultSeverityFilter, number>;

export type RuleViolationGroup = {
  key: string;
  engine: RuleCheckEngine;
  ruleId: string;
  issue: number;
  discipline: string;
  title: string;
  requirement: string;
  violations: UnifiedRuleViolation[];
  allHighlightRefnos: string[];
};

export function countViolationsByResultSeverity(
  violations: UnifiedRuleViolation[],
): RuleCheckResultSeverityCounts {
  const counts: RuleCheckResultSeverityCounts = {
    all: violations.length,
    violation: 0,
    reminder: 0,
    semi_auto: 0,
    firezone: 0,
  };
  for (const v of violations) {
    if (v.highlightColor) counts.firezone += 1;
    if (v.severity === 'reminder') counts.reminder += 1;
    else if (v.severity === 'semi_auto') counts.semi_auto += 1;
    else counts.violation += 1;
  }
  return counts;
}

export function filterRuleViolations(
  violations: UnifiedRuleViolation[],
  options: RuleCheckResultFilterOptions,
): UnifiedRuleViolation[] {
  const kw = options.keyword.trim().toLowerCase();
  return violations.filter((v) => {
    if (options.severity === 'firezone' && !v.highlightColor) return false;
    if (options.severity === 'reminder' && v.severity !== 'reminder') return false;
    if (options.severity === 'semi_auto' && v.severity !== 'semi_auto') return false;
    if (options.severity === 'violation' && v.severity !== 'violation') return false;

    if (!kw) return true;
    return (
      v.ruleId.toLowerCase().includes(kw)
      || v.discipline.toLowerCase().includes(kw)
      || v.title.toLowerCase().includes(kw)
      || v.detail.toLowerCase().includes(kw)
      || v.sourceLabel.toLowerCase().includes(kw)
      || v.targetLabel.toLowerCase().includes(kw)
      || (v.roomNum?.toLowerCase().includes(kw) ?? false)
      || `#${v.issue}`.includes(kw)
      || v.highlightRefnos.some((r) => r.toLowerCase().includes(kw))
    );
  });
}

export function groupViolationsByRule(
  violations: UnifiedRuleViolation[],
): RuleViolationGroup[] {
  const map = new Map<string, RuleViolationGroup>();

  for (const v of violations) {
    const key = `${v.engine}:${v.ruleId}`;
    let group = map.get(key);
    if (!group) {
      group = {
        key,
        engine: v.engine,
        ruleId: v.ruleId,
        issue: v.issue,
        discipline: v.discipline,
        title: v.title,
        requirement: v.requirement,
        violations: [],
        allHighlightRefnos: [],
      };
      map.set(key, group);
    }
    group.violations.push(v);
    for (const refno of v.highlightRefnos) {
      if (refno && !group.allHighlightRefnos.includes(refno)) {
        group.allHighlightRefnos.push(refno);
      }
    }
  }

  return Array.from(map.values());
}
