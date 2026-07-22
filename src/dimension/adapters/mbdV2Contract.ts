/**
 * TypeScript mirror of the frozen rs-mbd V2 contract
 * (`rs-mbd/crates/rs-mbd/src/contract.rs`, Phase 0, 2026-07). `kind` values
 * are stable; fields grow as the upstream algorithm porting progresses
 * (ADR 0043).
 *
 * Payload coordinates use `meta.geometry_space`. The mapper converts
 * `source_mm` through `source_to_design` before records enter Design Space
 * metres (ADR 0008).
 */

export type MbdV2Vec3 = readonly [number, number, number];

export type MbdV2LineSegment = Readonly<{
  from: MbdV2Vec3;
  to: MbdV2Vec3;
}>;

export type MbdV2IssueSeverity = 'info' | 'warning' | 'error';

export type MbdV2IssueCategory =
  | 'split'
  | 'direction'
  | 'avoidance'
  | 'data'
  | 'suppress'
  | 'other';

export type MbdV2Issue = Readonly<{
  id: string;
  severity: MbdV2IssueSeverity;
  category: MbdV2IssueCategory;
  message: string;
  refno?: string;
  isoline_idx?: number;
  object_refno?: string;
  rule_id?: string;
}>;

export type MbdV2GeometrySpace = 'source_mm' | 'design_m';

export type MbdV2Meta = Readonly<{
  geometry_space: MbdV2GeometrySpace;
  source_to_design?: readonly number[];
  cheight_mm?: number | null;
  layout_mode?: string | null;
  notes: readonly string[];
}>;

export type MbdV2AidLineStyle = 'solid' | 'dashed' | 'dash_dot';

export type MbdV2LinearDim = Readonly<{
  kind: 'linear_dim';
  id: string;
  start: MbdV2Vec3;
  end: MbdV2Vec3;
  text: string;
  sub_kind?: string;
  extension_lines: readonly MbdV2LineSegment[];
  arrow_lines: readonly MbdV2LineSegment[];
  label_anchor: MbdV2Vec3;
  reference?: boolean;
}>;

export type MbdV2AngleDim = Readonly<{
  kind: 'angle_dim';
  id: string;
  text: string;
}>;

export type MbdV2Label = Readonly<{
  kind: 'label';
  id: string;
  text: string;
  position: MbdV2Vec3;
}>;

export type MbdV2LeaderLine = Readonly<{
  kind: 'leader_line';
  id: string;
  start: MbdV2Vec3;
  end: MbdV2Vec3;
}>;

export type MbdV2AidLine = Readonly<{
  kind: 'aid_line';
  id: string;
  start: MbdV2Vec3;
  end: MbdV2Vec3;
  style?: MbdV2AidLineStyle;
}>;

export type MbdV2AidArc = Readonly<{
  kind: 'aid_arc';
  id: string;
}>;

export type MbdV2AidCircle = Readonly<{
  kind: 'aid_circle';
  id: string;
}>;

export type MbdV2AidPoint = Readonly<{
  kind: 'aid_point';
  id: string;
  position: MbdV2Vec3;
}>;

export type MbdV2AidText = Readonly<{
  kind: 'aid_text';
  id: string;
  text: string;
  position: MbdV2Vec3;
}>;

export type MbdV2WeldMark = Readonly<{
  kind: 'weld_mark';
  id: string;
  position: MbdV2Vec3;
  weld_type?: string;
}>;

export type MbdV2SlopeMark = Readonly<{
  kind: 'slope_mark';
  id: string;
  text: string;
  start: MbdV2Vec3;
  end: MbdV2Vec3;
}>;

export type MbdPrimitive =
  | MbdV2LinearDim
  | MbdV2AngleDim
  | MbdV2Label
  | MbdV2LeaderLine
  | MbdV2AidLine
  | MbdV2AidArc
  | MbdV2AidCircle
  | MbdV2AidPoint
  | MbdV2AidText
  | MbdV2WeldMark
  | MbdV2SlopeMark;

export type MbdPrimitiveKind = MbdPrimitive['kind'];

export type MbdV2PipeData = Readonly<{
  version: 'v2';
  input_refno: string;
  branch_refno: string;
  primitives: readonly MbdPrimitive[];
  meta: MbdV2Meta;
  issues: readonly MbdV2Issue[];
}>;

export type MbdV2ParseDiagnostic = Readonly<{
  id: string;
  reason: string;
}>;

export type MbdV2ParseResult =
  | Readonly<{
    ok: true;
    data: MbdV2PipeData;
    diagnostics: readonly MbdV2ParseDiagnostic[];
  }>
  | Readonly<{ ok: false; error: string }>;

const ISSUE_SEVERITIES: readonly MbdV2IssueSeverity[] = [
  'info',
  'warning',
  'error',
];

const ISSUE_CATEGORIES: readonly MbdV2IssueCategory[] = [
  'split',
  'direction',
  'avoidance',
  'data',
  'suppress',
  'other',
];

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string';
}

function isVec3(value: unknown): value is MbdV2Vec3 {
  return Array.isArray(value)
    && value.length === 3
    && value.every(item => typeof item === 'number' && Number.isFinite(item));
}

function isLineSegmentArray(
  value: unknown,
): value is readonly MbdV2LineSegment[] {
  return Array.isArray(value)
    && value.every(item =>
      isObject(item) && isVec3(item.from) && isVec3(item.to));
}

function isMatrix4(value: unknown): value is readonly number[] {
  return Array.isArray(value)
    && value.length === 16
    && value.every(item => typeof item === 'number' && Number.isFinite(item));
}

function isPrimitive(value: unknown): value is MbdPrimitive {
  if (!isObject(value) || !isNonEmptyString(value.id)) return false;
  switch (value.kind) {
    case 'linear_dim':
      return isVec3(value.start)
        && isVec3(value.end)
        && typeof value.text === 'string'
        && isOptionalString(value.sub_kind)
        && isLineSegmentArray(value.extension_lines)
        && isLineSegmentArray(value.arrow_lines)
        && isVec3(value.label_anchor)
        && (value.reference === undefined || typeof value.reference === 'boolean')
        && value.offset === undefined
        && value.suppressed_reason === undefined;
    case 'angle_dim':
      return false;
    case 'label':
      return typeof value.text === 'string'
        && isVec3(value.position);
    case 'leader_line':
      return isVec3(value.start) && isVec3(value.end);
    case 'aid_line':
      return isVec3(value.start)
        && isVec3(value.end)
        && isOptionalString(value.style);
    case 'aid_arc':
    case 'aid_circle':
      return false;
    case 'aid_point':
      return isVec3(value.position);
    case 'aid_text':
      return typeof value.text === 'string' && isVec3(value.position);
    case 'weld_mark':
      return isVec3(value.position) && isOptionalString(value.weld_type);
    case 'slope_mark':
      return typeof value.text === 'string'
        && isVec3(value.start)
        && isVec3(value.end);
    default:
      return false;
  }
}

function parseIssue(value: unknown): MbdV2Issue | null {
  if (
    !isObject(value)
    || !isNonEmptyString(value.id)
    || !ISSUE_SEVERITIES.includes(value.severity as MbdV2IssueSeverity)
    || !ISSUE_CATEGORIES.includes(value.category as MbdV2IssueCategory)
    || typeof value.message !== 'string'
    || !isOptionalString(value.refno)
    || (value.isoline_idx !== undefined
      && (!Number.isInteger(value.isoline_idx) || (value.isoline_idx as number) < 0))
    || !isOptionalString(value.object_refno)
    || !isOptionalString(value.rule_id)
  ) {
    return null;
  }
  return {
    id: value.id,
    severity: value.severity as MbdV2IssueSeverity,
    category: value.category as MbdV2IssueCategory,
    message: value.message,
    ...(value.refno ? { refno: value.refno } : {}),
    ...(value.isoline_idx !== undefined
      ? { isoline_idx: value.isoline_idx as number }
      : {}),
    ...(value.object_refno ? { object_refno: value.object_refno } : {}),
    ...(value.rule_id ? { rule_id: value.rule_id } : {}),
  };
}

function parseMeta(value: unknown): MbdV2Meta | null {
  if (
    !isObject(value)
    || (value.geometry_space !== 'source_mm' && value.geometry_space !== 'design_m')
    || !Array.isArray(value.notes)
    || !value.notes.every(note => typeof note === 'string')
    || (value.source_to_design !== undefined && !isMatrix4(value.source_to_design))
    || (value.geometry_space === 'source_mm' && value.source_to_design === undefined)
    || (value.cheight_mm !== undefined
      && value.cheight_mm !== null
      && (typeof value.cheight_mm !== 'number' || !Number.isFinite(value.cheight_mm)))
    || (value.layout_mode !== undefined
      && value.layout_mode !== null
      && typeof value.layout_mode !== 'string')
  ) return null;
  return {
    geometry_space: value.geometry_space,
    ...(value.source_to_design !== undefined
      ? { source_to_design: value.source_to_design as readonly number[] }
      : {}),
    ...(value.cheight_mm !== undefined ? { cheight_mm: value.cheight_mm as number | null } : {}),
    ...(value.layout_mode !== undefined ? { layout_mode: value.layout_mode as string | null } : {}),
    notes: value.notes as string[],
  };
}

/**
 * Strict validation for the external V2 JSON contract. Parquet rows are
 * normalized before this boundary and keep their own per-row diagnostics.
 */
export function parseMbdV2PipeData(value: unknown): MbdV2ParseResult {
  if (!isObject(value)) {
    return { ok: false, error: 'MBD V2 payload must be an object' };
  }
  if (value.version !== 'v2') {
    return { ok: false, error: 'MBD V2 payload version must be "v2"' };
  }
  if (!isNonEmptyString(value.input_refno) || !isNonEmptyString(value.branch_refno)) {
    return { ok: false, error: 'MBD V2 payload is missing input_refno or branch_refno' };
  }
  if (!Array.isArray(value.primitives)) {
    return { ok: false, error: 'MBD V2 payload is missing primitives array' };
  }
  const meta = parseMeta(value.meta);
  if (!meta) return { ok: false, error: 'MBD V2 payload has invalid meta' };
  if (!Array.isArray(value.issues)) {
    return { ok: false, error: 'MBD V2 payload is missing issues array' };
  }
  const primitiveIndex = value.primitives.findIndex(candidate => !isPrimitive(candidate));
  if (primitiveIndex >= 0) {
    return { ok: false, error: `MBD V2 payload has invalid primitive at index ${primitiveIndex}` };
  }
  const parsedIssues = value.issues.map(parseIssue);
  const issueIndex = parsedIssues.findIndex(issue => issue === null);
  if (issueIndex >= 0) {
    return { ok: false, error: `MBD V2 payload has invalid issue at index ${issueIndex}` };
  }

  return {
    ok: true,
    data: {
      version: 'v2',
      input_refno: value.input_refno,
      branch_refno: value.branch_refno,
      primitives: value.primitives as MbdPrimitive[],
      meta,
      issues: parsedIssues as MbdV2Issue[],
    },
    diagnostics: [],
  };
}
