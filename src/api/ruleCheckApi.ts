/**
 * 三维模型规范校验（gen-model GitHub #174）前端 API 客户端与统一视图模型映射。
 *
 * 对接四套 `/api/v1/rule-check/*` 端点：
 * - 空间规则：`GET /api/v1/rule-check/rules`、`GET /api/v1/rule-check/run`
 * - BRAN 拓扑规则：`GET /api/v1/rule-check/bran/rules`、`GET /api/v1/rule-check/bran/run?refno=<bran>`
 * - 房间语义规则：`GET /api/v1/rule-check/rooms/rules`、`GET /api/v1/rule-check/rooms/run`
 * - 属性/通道/火灾分区规则：`GET /api/v1/rule-check/attrs/rules`、`GET /api/v1/rule-check/attrs/run[?refno=a,b,c]`
 */

import { genModelV1Fetch, type GenModelV1RequestOptions } from '@/api/genModelV1Api';

export type RuleCheckEngine = 'spatial' | 'bran' | 'rooms' | 'attrs';

export type RuleCheckSeverity = 'violation' | 'reminder' | 'semi_auto';

export type RuleCheckHighlightColor = 'red' | 'yellow';

// ---------------------------------------------------------------------------
// 后端原始契约类型（与 gen-model `src/fast_model/rule_check/*.rs` 逐字段对齐）
// ---------------------------------------------------------------------------

export interface SpatialRuleCatalogRow {
  id: string;
  issue: number;
  discipline: string;
  title: string;
  requirement: string;
  threshold_mm: number;
  unit: string;
}

export interface SpatialItemJson {
  refno: string | number;
  noun: string;
}

export interface SpatialViolationJson {
  source: SpatialItemJson;
  target: SpatialItemJson;
  measured_mm: number;
  threshold_mm: number;
  margin_mm: number;
  highlight_refnos: string[];
}

export interface SpatialRuleResultJson {
  id: string;
  issue: number;
  discipline: string;
  title: string;
  requirement: string;
  unit: string;
  source_items: number;
  target_items: number;
  violation_total: number;
  violations: SpatialViolationJson[];
  truncated: boolean;
}

export interface SpatialRuleCheckResponse {
  tree_state: string;
  rules_run: number;
  results: SpatialRuleResultJson[];
  elapsed_ms: number;
  warnings: string[];
}

export interface BranRuleCatalogRow {
  id: string;
  issue: number;
  discipline: string;
  title: string;
  requirement: string;
  unit: string;
}

export interface BranElemRefJson {
  refno: string;
  noun: string;
  order: number;
  weld_number?: string;
  weld_kind?: string;
}

export interface BranViolationJson {
  source: BranElemRefJson;
  target: BranElemRefJson;
  measured_mm: number;
  threshold_mm: number;
  margin_mm: number;
  outside_diameter_mm?: number;
  severity?: 'reminder' | 'semi_auto' | string;
  highlight_refnos: string[];
  detail: string;
}

export interface BranRuleResultJson {
  id: string;
  issue: number;
  discipline: string;
  title: string;
  requirement: string;
  unit: string;
  checked_pairs: number;
  violation_total: number;
  violations: BranViolationJson[];
  truncated: boolean;
  warnings: string[];
}

export interface BranRuleCheckResponse {
  branch_refno: string;
  flow_direction: string | null;
  elem_count: number;
  rules_run: number;
  results: BranRuleResultJson[];
  warnings: string[];
}

export interface RoomRuleCatalogRow {
  id: string;
  issue: number;
  discipline: string;
  title: string;
  requirement: string;
  unit: string;
}

export interface RoomViolationJson {
  room_num: string;
  source_refnos: string[];
  target_refnos: string[];
  measured_mm: number;
  threshold_mm: number;
  margin_mm: number;
  has_column: boolean;
  highlight_refnos: string[];
  detail: string;
}

export interface RoomRuleResultJson {
  id: string;
  issue: number;
  discipline: string;
  title: string;
  requirement: string;
  unit: string;
  rooms_checked: number;
  violation_total: number;
  violations: RoomViolationJson[];
  truncated: boolean;
}

export interface RoomRuleCheckResponse {
  tree_state: string;
  room_count: number;
  rules_run: number;
  results: RoomRuleResultJson[];
  elapsed_ms: number;
  warnings: string[];
}

export interface AttrRuleCatalogRow {
  id: string;
  issue: number;
  discipline: string;
  title: string;
  requirement: string;
  unit: string;
}

export interface AttrViolationJson {
  source_refno: string;
  source_noun: string;
  target_refno?: string;
  room_num?: string;
  measured_mm?: number;
  threshold_mm?: number;
  highlight_color?: RuleCheckHighlightColor | string;
  highlight_refnos: string[];
  detail: string;
}

export interface AttrRuleResultJson {
  id: string;
  issue: number;
  discipline: string;
  title: string;
  requirement: string;
  checked_items: number;
  violation_total: number;
  violations: AttrViolationJson[];
  truncated: boolean;
}

export interface AttrRuleCheckResponse {
  tree_state: string;
  rules_run: number;
  results: AttrRuleResultJson[];
  elapsed_ms: number;
  warnings: string[];
}

// ---------------------------------------------------------------------------
// 统一前端视图模型
// ---------------------------------------------------------------------------

export interface UnifiedRuleCatalogRow {
  engine: RuleCheckEngine;
  id: string;
  issue: number;
  discipline: string;
  title: string;
  requirement: string;
  unit: string;
  thresholdMm?: number;
}

export interface UnifiedRuleViolation {
  key: string;
  engine: RuleCheckEngine;
  ruleId: string;
  issue: number;
  discipline: string;
  title: string;
  requirement: string;
  sourceLabel: string;
  targetLabel: string;
  roomNum?: string;
  measuredMm?: number;
  thresholdMm?: number;
  marginMm?: number;
  hasColumn?: boolean;
  severity: RuleCheckSeverity;
  highlightColor?: RuleCheckHighlightColor;
  highlightRefnos: string[];
  detail: string;
}

export interface UnifiedRuleResult {
  engine: RuleCheckEngine;
  id: string;
  issue: number;
  discipline: string;
  title: string;
  requirement: string;
  checkedCount: number;
  violationTotal: number;
  truncated: boolean;
  warnings: string[];
  violations: UnifiedRuleViolation[];
}

export interface UnifiedRuleCheckBatchResult {
  engine: RuleCheckEngine;
  treeState?: string;
  branchRefno?: string;
  roomCount?: number;
  rulesRun: number;
  elapsedMs?: number;
  warnings: string[];
  results: UnifiedRuleResult[];
}

// ---------------------------------------------------------------------------
// Query 构造与请求封装
// ---------------------------------------------------------------------------

export function normalizeRuleRefnoToken(raw: string): string {
  return raw.trim().replace(/\//g, '_');
}

function formatRulesQuery(ids?: string[]): string | undefined {
  if (!ids || ids.length === 0) return undefined;
  const cleaned = ids.map((s) => s.trim()).filter(Boolean);
  return cleaned.length > 0 ? cleaned.join(',') : undefined;
}

function formatRefnoListQuery(refnos?: string[]): string | undefined {
  if (!refnos || refnos.length === 0) return undefined;
  const cleaned = refnos.map(normalizeRuleRefnoToken).filter(Boolean);
  return cleaned.length > 0 ? cleaned.join(',') : undefined;
}

export function fetchSpatialRulesCatalog(
  options?: GenModelV1RequestOptions,
): Promise<SpatialRuleCatalogRow[]> {
  return genModelV1Fetch<SpatialRuleCatalogRow[]>('/api/v1/rule-check/rules', { ...options });
}

export function runSpatialRuleCheck(
  ruleIds?: string[],
  options?: GenModelV1RequestOptions,
): Promise<SpatialRuleCheckResponse> {
  return genModelV1Fetch<SpatialRuleCheckResponse>('/api/v1/rule-check/run', {
    ...options,
    query: { rules: formatRulesQuery(ruleIds) },
  });
}

export function fetchBranRulesCatalog(
  options?: GenModelV1RequestOptions,
): Promise<BranRuleCatalogRow[]> {
  return genModelV1Fetch<BranRuleCatalogRow[]>('/api/v1/rule-check/bran/rules', { ...options });
}

export function runBranRuleCheck(
  branchRefno: string,
  ruleIds?: string[],
  options?: GenModelV1RequestOptions,
): Promise<BranRuleCheckResponse> {
  return genModelV1Fetch<BranRuleCheckResponse>('/api/v1/rule-check/bran/run', {
    ...options,
    query: {
      refno: normalizeRuleRefnoToken(branchRefno),
      rules: formatRulesQuery(ruleIds),
    },
  });
}

export function fetchRoomRulesCatalog(
  options?: GenModelV1RequestOptions,
): Promise<RoomRuleCatalogRow[]> {
  return genModelV1Fetch<RoomRuleCatalogRow[]>('/api/v1/rule-check/rooms/rules', { ...options });
}

export function runRoomRuleCheck(
  ruleIds?: string[],
  options?: GenModelV1RequestOptions,
): Promise<RoomRuleCheckResponse> {
  return genModelV1Fetch<RoomRuleCheckResponse>('/api/v1/rule-check/rooms/run', {
    ...options,
    query: { rules: formatRulesQuery(ruleIds) },
  });
}

export function fetchAttrRulesCatalog(
  options?: GenModelV1RequestOptions,
): Promise<AttrRuleCatalogRow[]> {
  return genModelV1Fetch<AttrRuleCatalogRow[]>('/api/v1/rule-check/attrs/rules', { ...options });
}

export function runAttrRuleCheck(
  ruleIds?: string[],
  scopeRefnos?: string[],
  options?: GenModelV1RequestOptions,
): Promise<AttrRuleCheckResponse> {
  return genModelV1Fetch<AttrRuleCheckResponse>('/api/v1/rule-check/attrs/run', {
    ...options,
    query: {
      rules: formatRulesQuery(ruleIds),
      refno: formatRefnoListQuery(scopeRefnos),
    },
  });
}

/** 并行加载四套规则引擎的全部内置规则目录（任一端点暂不可用时记录告警，不阻塞其余引擎）。 */
export async function fetchAllRuleCatalogs(
  options?: GenModelV1RequestOptions,
): Promise<{ rules: UnifiedRuleCatalogRow[]; warnings: string[] }> {
  const warnings: string[] = [];
  const rules: UnifiedRuleCatalogRow[] = [];

  const [spatial, bran, rooms, attrs] = await Promise.allSettled([
    fetchSpatialRulesCatalog(options),
    fetchBranRulesCatalog(options),
    fetchRoomRulesCatalog(options),
    fetchAttrRulesCatalog(options),
  ]);

  if (spatial.status === 'fulfilled') {
    for (const r of spatial.value) {
      rules.push({
        engine: 'spatial',
        id: r.id,
        issue: r.issue,
        discipline: r.discipline,
        title: r.title,
        requirement: r.requirement,
        unit: r.unit,
        thresholdMm: r.threshold_mm,
      });
    }
  } else {
    warnings.push(`空间规则目录加载失败：${String(spatial.reason?.message ?? spatial.reason)}`);
  }

  if (bran.status === 'fulfilled') {
    for (const r of bran.value) {
      rules.push({
        engine: 'bran',
        id: r.id,
        issue: r.issue,
        discipline: r.discipline,
        title: r.title,
        requirement: r.requirement,
        unit: r.unit,
      });
    }
  } else {
    warnings.push(`BRAN 拓扑规则目录加载失败：${String(bran.reason?.message ?? bran.reason)}`);
  }

  if (rooms.status === 'fulfilled') {
    for (const r of rooms.value) {
      rules.push({
        engine: 'rooms',
        id: r.id,
        issue: r.issue,
        discipline: r.discipline,
        title: r.title,
        requirement: r.requirement,
        unit: r.unit,
      });
    }
  } else {
    warnings.push(`房间语义规则目录加载失败：${String(rooms.reason?.message ?? rooms.reason)}`);
  }

  if (attrs.status === 'fulfilled') {
    for (const r of attrs.value) {
      rules.push({
        engine: 'attrs',
        id: r.id,
        issue: r.issue,
        discipline: r.discipline,
        title: r.title,
        requirement: r.requirement,
        unit: r.unit,
      });
    }
  } else {
    warnings.push(`属性/通道/火灾分区规则目录加载失败：${String(attrs.reason?.message ?? attrs.reason)}`);
  }

  return { rules, warnings };
}

// ---------------------------------------------------------------------------
// 响应标准化映射
// ---------------------------------------------------------------------------

function normalizeSeverity(raw?: string): RuleCheckSeverity {
  if (raw === 'reminder') return 'reminder';
  if (raw === 'semi_auto') return 'semi_auto';
  return 'violation';
}

function normalizeHighlightColor(raw?: string): RuleCheckHighlightColor | undefined {
  if (raw === 'red' || raw === 'yellow') return raw;
  return undefined;
}

export function normalizeSpatialResponse(res: SpatialRuleCheckResponse): UnifiedRuleCheckBatchResult {
  return {
    engine: 'spatial',
    treeState: res.tree_state,
    rulesRun: res.rules_run,
    elapsedMs: res.elapsed_ms,
    warnings: res.warnings ?? [],
    results: (res.results ?? []).map((r) => ({
      engine: 'spatial',
      id: r.id,
      issue: r.issue,
      discipline: r.discipline,
      title: r.title,
      requirement: r.requirement,
      checkedCount: r.source_items,
      violationTotal: r.violation_total,
      truncated: r.truncated,
      warnings: [],
      violations: (r.violations ?? []).map((v, idx) => {
        const srcRef = v.highlight_refnos?.[0] ?? String(v.source.refno);
        const tgtRef = v.highlight_refnos?.[1] ?? String(v.target.refno);
        return {
          key: `spatial:${r.id}:${idx}:${srcRef}:${tgtRef}`,
          engine: 'spatial',
          ruleId: r.id,
          issue: r.issue,
          discipline: r.discipline,
          title: r.title,
          requirement: r.requirement,
          sourceLabel: `${v.source.noun} ${srcRef}`,
          targetLabel: `${v.target.noun} ${tgtRef}`,
          measuredMm: v.measured_mm,
          thresholdMm: v.threshold_mm,
          marginMm: v.margin_mm,
          severity: 'violation',
          highlightRefnos: (v.highlight_refnos ?? []).map(normalizeRuleRefnoToken).filter(Boolean),
          detail: `${v.source.noun} ${srcRef} ↔ ${v.target.noun} ${tgtRef} 实测 ${v.measured_mm.toFixed(1)} ${r.unit}（规范 ${r.requirement}，阈值 ${v.threshold_mm.toFixed(1)} ${r.unit}）`,
        };
      }),
    })),
  };
}

export function normalizeBranResponse(res: BranRuleCheckResponse): UnifiedRuleCheckBatchResult {
  return {
    engine: 'bran',
    branchRefno: res.branch_refno,
    rulesRun: res.rules_run,
    warnings: res.warnings ?? [],
    results: (res.results ?? []).map((r) => ({
      engine: 'bran',
      id: r.id,
      issue: r.issue,
      discipline: r.discipline,
      title: r.title,
      requirement: r.requirement,
      checkedCount: r.checked_pairs,
      violationTotal: r.violation_total,
      truncated: r.truncated,
      warnings: r.warnings ?? [],
      violations: (r.violations ?? []).map((v, idx) => ({
        key: `bran:${r.id}:${idx}:${v.source.refno}:${v.target.refno}`,
        engine: 'bran',
        ruleId: r.id,
        issue: r.issue,
        discipline: r.discipline,
        title: r.title,
        requirement: r.requirement,
        sourceLabel: `${v.source.noun} ${v.source.refno}`,
        targetLabel: `${v.target.noun} ${v.target.refno}`,
        measuredMm: v.measured_mm,
        thresholdMm: v.threshold_mm,
        marginMm: v.margin_mm,
        severity: normalizeSeverity(v.severity),
        highlightRefnos: (v.highlight_refnos ?? []).map(normalizeRuleRefnoToken).filter(Boolean),
        detail: v.detail,
      })),
    })),
  };
}

export function normalizeRoomResponse(res: RoomRuleCheckResponse): UnifiedRuleCheckBatchResult {
  return {
    engine: 'rooms',
    treeState: res.tree_state,
    roomCount: res.room_count,
    rulesRun: res.rules_run,
    elapsedMs: res.elapsed_ms,
    warnings: res.warnings ?? [],
    results: (res.results ?? []).map((r) => ({
      engine: 'rooms',
      id: r.id,
      issue: r.issue,
      discipline: r.discipline,
      title: r.title,
      requirement: r.requirement,
      checkedCount: r.rooms_checked,
      violationTotal: r.violation_total,
      truncated: r.truncated,
      warnings: [],
      violations: (r.violations ?? []).map((v, idx) => ({
        key: `rooms:${r.id}:${idx}:${v.room_num}`,
        engine: 'rooms',
        ruleId: r.id,
        issue: r.issue,
        discipline: r.discipline,
        title: r.title,
        requirement: r.requirement,
        sourceLabel: v.source_refnos.join(', ') || v.room_num,
        targetLabel: v.target_refnos.join(', ') || '-',
        roomNum: v.room_num,
        measuredMm: v.measured_mm,
        thresholdMm: v.threshold_mm,
        marginMm: v.margin_mm,
        hasColumn: v.has_column,
        severity: 'violation',
        highlightRefnos: (v.highlight_refnos ?? []).map(normalizeRuleRefnoToken).filter(Boolean),
        detail: v.detail,
      })),
    })),
  };
}

export function normalizeAttrResponse(res: AttrRuleCheckResponse): UnifiedRuleCheckBatchResult {
  return {
    engine: 'attrs',
    treeState: res.tree_state,
    rulesRun: res.rules_run,
    elapsedMs: res.elapsed_ms,
    warnings: res.warnings ?? [],
    results: (res.results ?? []).map((r) => ({
      engine: 'attrs',
      id: r.id,
      issue: r.issue,
      discipline: r.discipline,
      title: r.title,
      requirement: r.requirement,
      checkedCount: r.checked_items,
      violationTotal: r.violation_total,
      truncated: r.truncated,
      warnings: [],
      violations: (r.violations ?? []).map((v, idx) => ({
        key: `attrs:${r.id}:${idx}:${v.source_refno}:${v.target_refno ?? ''}`,
        engine: 'attrs',
        ruleId: r.id,
        issue: r.issue,
        discipline: r.discipline,
        title: r.title,
        requirement: r.requirement,
        sourceLabel: `${v.source_noun} ${v.source_refno}`,
        targetLabel: v.target_refno ?? (v.room_num ?? '-'),
        roomNum: v.room_num,
        measuredMm: v.measured_mm,
        thresholdMm: v.threshold_mm,
        severity: 'violation',
        highlightColor: normalizeHighlightColor(v.highlight_color),
        highlightRefnos: (v.highlight_refnos ?? []).map(normalizeRuleRefnoToken).filter(Boolean),
        detail: v.detail,
      })),
    })),
  };
}
