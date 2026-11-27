import type { RuleCheckEngine, UnifiedRuleViolation } from '@/api/ruleCheckApi';

export type RuleCheckResultSeverityFilter =
  | 'all'
  | 'violation'
  | 'reminder'
  | 'semi_auto'
  | 'firezone';

export type RuleCheckResultAccuracyFilter = 'all' | 'exact' | 'aabb';

/** 「Copy-of 副本」标记的可搜文字：关键词输入「副本」或「copy」就能筛出带标记的行。 */
const COPY_TAG_TEXT = 'copy-of 副本';

export type RuleCheckResultFilterOptions = {
  severity: RuleCheckResultSeverityFilter;
  keyword: string;
  accuracy?: RuleCheckResultAccuracyFilter;
  /** 只留这些专业；空数组不限。 */
  disciplines?: string[];
  /** 只留这条规则（`ruleViolationKey` 的值）。 */
  ruleKey?: string | null;
  copyOnly?: boolean;
};

export type RuleCheckResultSeverityCounts = Record<RuleCheckResultSeverityFilter, number>;

export type RuleCheckResultAccuracyCounts = Record<RuleCheckResultAccuracyFilter, number>;

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

export function ruleViolationKey(v: Pick<UnifiedRuleViolation, 'engine' | 'ruleId'>): string {
  return `${v.engine}:${v.ruleId}`;
}

export function countViolationsByDiscipline(violations: UnifiedRuleViolation[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const v of violations) {
    counts[v.discipline] = (counts[v.discipline] ?? 0) + 1;
  }
  return counts;
}

/** 850 → `850 ms`，52010 → `52.0 s`，161000 → `2 分 41 秒`。 */
export function formatRuleCheckDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 59_950) return `${(ms / 1000).toFixed(1)} s`;
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return seconds > 0 ? `${minutes} 分 ${seconds} 秒` : `${minutes} 分`;
  return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分`;
}

/** 运行中的计时：72000 → `01:12`。 */
export function formatRuleCheckClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/** 实测与阈值差多少：低于下限写「差」，超过上限写「超」（`margin_mm` = 实测 − 阈值）。 */
export function violationGapLabel(v: Pick<UnifiedRuleViolation, 'marginMm'>): string | null {
  if (v.marginMm === undefined || !Number.isFinite(v.marginMm) || Math.abs(v.marginMm) < 0.05) return null;
  const abs = Math.abs(v.marginMm).toFixed(1);
  return v.marginMm < 0 ? `差 ${abs}` : `超 ${abs}`;
}

/** 下限类违规的实测 / 阈值比（0–1），用于行内比例条；其余情况不画。 */
export function violationGaugeRatio(
  v: Pick<UnifiedRuleViolation, 'measuredMm' | 'thresholdMm' | 'marginMm'>,
): number | null {
  if (v.measuredMm === undefined || v.thresholdMm === undefined || v.thresholdMm <= 0) return null;
  if (v.marginMm === undefined || v.marginMm >= 0) return null;
  return Math.min(1, Math.max(0, v.measuredMm / v.thresholdMm));
}

export function countViolationsByAccuracy(
  violations: UnifiedRuleViolation[],
): RuleCheckResultAccuracyCounts {
  const counts: RuleCheckResultAccuracyCounts = { all: violations.length, exact: 0, aabb: 0 };
  for (const v of violations) {
    if (v.accuracy === 'exact') counts.exact += 1;
    else if (v.accuracy === 'aabb') counts.aabb += 1;
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
    if (options.accuracy && options.accuracy !== 'all' && v.accuracy !== options.accuracy) return false;
    if (options.disciplines && options.disciplines.length > 0 && !options.disciplines.includes(v.discipline)) return false;
    if (options.ruleKey && ruleViolationKey(v) !== options.ruleKey) return false;
    if (options.copyOnly && v.copyNamed !== true) return false;

    if (!kw) return true;
    return (
      v.ruleId.toLowerCase().includes(kw)
      || v.discipline.toLowerCase().includes(kw)
      || v.title.toLowerCase().includes(kw)
      || v.detail.toLowerCase().includes(kw)
      || v.sourceLabel.toLowerCase().includes(kw)
      || v.targetLabel.toLowerCase().includes(kw)
      || (v.roomNum?.toLowerCase().includes(kw) ?? false)
      || (v.branchRefno?.toLowerCase().includes(kw) ?? false)
      || (v.copyNamed === true && COPY_TAG_TEXT.includes(kw))
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
    const key = ruleViolationKey(v);
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
