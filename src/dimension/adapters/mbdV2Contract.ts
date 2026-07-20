/**
 * TypeScript mirror of the frozen rs-mbd V2 contract
 * (`rs-mbd/crates/rs-mbd/src/contract.rs`, Phase 0, 2026-07). `kind` values
 * are stable; fields grow as the upstream algorithm porting progresses
 * (ADR 0043).
 *
 * Coordinate convention for this module: every Vec3 consumed by the mapper is
 * in Design Space metres (ADR 0008). Channel loaders (HTTP API, parquet) own
 * unit conversion and source-to-design transforms before data reaches here.
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
}>;

export type MbdV2Meta = Readonly<{
  cheight_mm?: number | null;
  layout_mode?: string | null;
  notes: readonly string[];
}>;

export type MbdV2AidLineStyle = 'solid' | 'dashed' | 'dash_dot';

/**
 * `extension_lines` / `arrow_lines` / `label_anchor` / `reference` are a
 * documented superset of the Phase 0 contract: the parquet channel already
 * ships this geometry and upstream declared the fields will be filled in.
 * Re-align the names here once rs-mbd freezes them.
 */
export type MbdV2LinearDim = Readonly<{
  kind: 'linear_dim';
  id: string;
  start: MbdV2Vec3;
  end: MbdV2Vec3;
  text: string;
  sub_kind?: string;
  offset?: number;
  suppressed_reason?: string;
  extension_lines?: readonly MbdV2LineSegment[];
  arrow_lines?: readonly MbdV2LineSegment[];
  label_anchor?: MbdV2Vec3;
  reference?: boolean;
}>;

export type MbdV2AngleDim = Readonly<{
  kind: 'angle_dim';
  id: string;
  text: string;
  suppressed_reason?: string;
}>;

export type MbdV2Label = Readonly<{
  kind: 'label';
  id: string;
  text: string;
  position: MbdV2Vec3;
  suppressed_reason?: string;
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
  version: string;
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

const PRIMITIVE_KINDS: readonly MbdPrimitiveKind[] = [
  'linear_dim',
  'angle_dim',
  'label',
  'leader_line',
  'aid_line',
  'aid_arc',
  'aid_circle',
  'aid_point',
  'aid_text',
  'weld_mark',
  'slope_mark',
];

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
  return value === undefined || (
    Array.isArray(value)
    && value.every(item =>
      isObject(item) && isVec3(item.from) && isVec3(item.to))
  );
}

function isPrimitive(value: unknown): value is MbdPrimitive {
  if (!isObject(value) || !isNonEmptyString(value.id)) return false;
  switch (value.kind) {
    case 'linear_dim':
      return isVec3(value.start)
        && isVec3(value.end)
        && typeof value.text === 'string'
        && isOptionalString(value.sub_kind)
        && (value.offset === undefined
          || (typeof value.offset === 'number' && Number.isFinite(value.offset)))
        && isOptionalString(value.suppressed_reason)
        && isLineSegmentArray(value.extension_lines)
        && isLineSegmentArray(value.arrow_lines)
        && (value.label_anchor === undefined || isVec3(value.label_anchor))
        && (value.reference === undefined || typeof value.reference === 'boolean');
    case 'angle_dim':
      return typeof value.text === 'string'
        && isOptionalString(value.suppressed_reason);
    case 'label':
      return typeof value.text === 'string'
        && isVec3(value.position)
        && isOptionalString(value.suppressed_reason);
    case 'leader_line':
      return isVec3(value.start) && isVec3(value.end);
    case 'aid_line':
      return isVec3(value.start)
        && isVec3(value.end)
        && isOptionalString(value.style);
    case 'aid_arc':
    case 'aid_circle':
      return true;
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
  ) {
    return null;
  }
  return {
    id: value.id,
    severity: value.severity as MbdV2IssueSeverity,
    category: value.category as MbdV2IssueCategory,
    message: value.message,
    ...(value.refno ? { refno: value.refno } : {}),
  };
}

function parseMeta(value: unknown): MbdV2Meta {
  if (!isObject(value)) return { notes: [] };
  return {
    ...(typeof value.cheight_mm === 'number' && Number.isFinite(value.cheight_mm)
      ? { cheight_mm: value.cheight_mm }
      : {}),
    ...(typeof value.layout_mode === 'string'
      ? { layout_mode: value.layout_mode }
      : {}),
    notes: Array.isArray(value.notes)
      ? value.notes.filter((note): note is string => typeof note === 'string')
      : [],
  };
}

/**
 * Tolerant contract validation: a structurally broken top level fails hard;
 * individual invalid primitives/issues are skipped with a diagnostic so one
 * bad row never blanks a whole branch (mirrors the parquet loader posture).
 */
export function parseMbdV2PipeData(value: unknown): MbdV2ParseResult {
  if (!isObject(value)) {
    return { ok: false, error: 'MBD V2 payload must be an object' };
  }
  if (!isNonEmptyString(value.version)) {
    return { ok: false, error: 'MBD V2 payload is missing version' };
  }
  if (!Array.isArray(value.primitives)) {
    return { ok: false, error: 'MBD V2 payload is missing primitives array' };
  }

  const diagnostics: MbdV2ParseDiagnostic[] = [];
  const primitives: MbdPrimitive[] = [];
  value.primitives.forEach((candidate, index) => {
    if (isPrimitive(candidate)) {
      primitives.push(candidate);
      return;
    }
    const candidateObject = isObject(candidate) ? candidate : null;
    const id = isNonEmptyString(candidateObject?.id)
      ? candidateObject!.id as string
      : `primitive-${index}`;
    const kind = candidateObject?.kind;
    diagnostics.push({
      id,
      reason: typeof kind === 'string' && !PRIMITIVE_KINDS.includes(kind as MbdPrimitiveKind)
        ? `unknown primitive kind "${kind}"`
        : 'invalid primitive fields',
    });
  });

  const issues: MbdV2Issue[] = [];
  if (Array.isArray(value.issues)) {
    value.issues.forEach((candidate, index) => {
      const issue = parseIssue(candidate);
      if (issue) issues.push(issue);
      else diagnostics.push({ id: `issue-${index}`, reason: 'invalid issue entry' });
    });
  }

  return {
    ok: true,
    data: {
      version: value.version,
      input_refno: typeof value.input_refno === 'string' ? value.input_refno : '',
      branch_refno: typeof value.branch_refno === 'string' ? value.branch_refno : '',
      primitives,
      meta: parseMeta(value.meta),
      issues,
    },
    diagnostics,
  };
}
