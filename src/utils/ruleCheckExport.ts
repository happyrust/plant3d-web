import type {
  RuleCheckEngine,
  UnifiedBranRunAllSummary,
  UnifiedPreciseSummary,
  UnifiedRuleCheckBatchResult,
  UnifiedRuleResult,
  UnifiedRuleViolation,
} from '@/api/ruleCheckApi';

const ENGINE_ZH_LABEL: Record<RuleCheckEngine, string> = {
  spatial: '空间净距',
  bran: 'BRAN 拓扑',
  rooms: '房间语义',
  attrs: '属性/火灾分区',
};

const SEVERITY_ZH_LABEL: Record<UnifiedRuleViolation['severity'], string> = {
  violation: '违规',
  reminder: '提醒',
  semi_auto: '半自动复核',
};

export type RuleCheckExportSummary = {
  rulesRun: number;
  totalReported: number;
  violations: number;
  reminders: number;
  semiAuto: number;
  firezones: number;
  totalElapsedMs: number;
  precise?: UnifiedPreciseSummary | null;
  branAll?: UnifiedBranRunAllSummary | null;
}

export type RuleCheckExportPayload = {
  summary: RuleCheckExportSummary;
  warnings: string[];
  batches: UnifiedRuleCheckBatchResult[];
  results: UnifiedRuleResult[];
  violations: UnifiedRuleViolation[];
  exportedAt?: string;
}

export function escapeCsvCell(value: string | number | boolean | undefined | null): string {
  if (value === undefined || value === null) return '';
  const text = String(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

const CSV_HEADERS = [
  '引擎',
  '规则ID',
  '工单号',
  '专业',
  '规则标题',
  '规范要求',
  '分级',
  '火灾分区着色',
  '房间号',
  '有柱口径',
  '来源构件',
  '目标构件',
  '实测值(mm)',
  '阈值(mm)',
  '裕度(mm)',
  '涉事高亮refno',
  '详情',
  '口径',
  '网格外表面距(mm)',
  '所在BRAN',
  '复制副本',
] as const;

function formatNumber(n?: number): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '';
  return n.toFixed(1);
}

function formatHighlightColor(color?: UnifiedRuleViolation['highlightColor']): string {
  if (color === 'red') return '红(扩散性火灾)';
  if (color === 'yellow') return '黄(局部性火灾)';
  return '';
}

function formatAccuracy(accuracy?: UnifiedRuleViolation['accuracy']): string {
  if (accuracy === 'exact') return '网格精算';
  if (accuracy === 'aabb') return '包围盒估算';
  return '';
}

/** 构造带 UTF-8 BOM 的 RFC 4180 CSV 字符串（确保中文在 Excel 直接打开不乱码）。 */
export function buildRuleCheckCsv(violations: UnifiedRuleViolation[]): string {
  const lines: string[] = [CSV_HEADERS.map(escapeCsvCell).join(',')];

  for (const v of violations) {
    const row = [
      ENGINE_ZH_LABEL[v.engine] ?? v.engine,
      v.ruleId,
      `#${v.issue}`,
      v.discipline,
      v.title,
      v.requirement,
      SEVERITY_ZH_LABEL[v.severity] ?? v.severity,
      formatHighlightColor(v.highlightColor),
      v.roomNum ?? '',
      v.hasColumn ? '是' : '',
      v.sourceLabel,
      v.targetLabel,
      formatNumber(v.measuredMm),
      formatNumber(v.thresholdMm),
      formatNumber(v.marginMm),
      v.highlightRefnos.join(';'),
      v.detail,
      formatAccuracy(v.accuracy),
      formatNumber(v.exactSurfaceMm),
      v.branchRefno ?? '',
      v.copyNamed ? '是' : '',
    ];
    lines.push(row.map(escapeCsvCell).join(','));
  }

  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

/** 构造结构化 JSON 校验报告（包含汇总统计、告警、分引擎批次与逐条违规清单）。 */
export function buildRuleCheckJson(payload: RuleCheckExportPayload): string {
  const doc = {
    schemaVersion: 1,
    exportedAt: payload.exportedAt ?? new Date().toISOString(),
    summary: payload.summary,
    warnings: payload.warnings,
    batches: payload.batches.map((b) => ({
      engine: b.engine,
      treeState: b.treeState,
      branchRefno: b.branchRefno,
      roomCount: b.roomCount,
      rulesRun: b.rulesRun,
      elapsedMs: b.elapsedMs,
      warnings: b.warnings,
      precise: b.precise,
      bransTotal: b.bransTotal,
      bransChecked: b.bransChecked,
      bransFailed: b.bransFailed,
    })),
    results: payload.results.map((r) => ({
      engine: r.engine,
      id: r.id,
      issue: r.issue,
      discipline: r.discipline,
      title: r.title,
      requirement: r.requirement,
      checkedCount: r.checkedCount,
      violationTotal: r.violationTotal,
      truncated: r.truncated,
      warnings: r.warnings,
      precise: r.precise,
    })),
    violations: payload.violations,
  };
  return `${JSON.stringify(doc, null, 2)}\n`;
}

export function formatExportTimestamp(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

export function triggerTextDownload(
  content: string,
  filename: string,
  mimeType: string,
): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}
