/**
 * TypeScript mirror of the frozen rs-mbd V2 contract
 * (`rs-mbd/crates/rs-mbd/src/contract.rs`, Phase 0, 2026-07; since 2026-09
 * maintained as `plant-mbd/crates/plant-mbd/src/contract.rs`). `kind` values
 * are stable; fields grow as the upstream algorithm porting progresses
 * (ADR 0043). The arc kinds (`angle_dim` / `aid_arc` / `aid_circle`) got
 * their geometry on 2026-09-07 (ADR 0055), so every kind now has explicit
 * geometry.
 *
 * Payload coordinates use `meta.geometry_space`. The mapper converts
 * `source_mm` through `source_to_design` before records enter Design Space
 * metres (ADR 0008).
 *
 * `meta.source_to_design` is a 16-element **column-major** matrix (THREE
 * `Matrix4.fromArray` layout: translation in elements 12-14). Producers
 * (plant-model-gen manifests, forwarded verbatim by plant-web-server and
 * rs-mbd) currently only emit diagonal scale matrices, which are
 * order-agnostic; the convention is pinned by
 * `fixtures/mbd-v2/source-to-design-translation.json` before any
 * rotation/translation appears upstream.
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

/** `meta.source_version.databases` 的一条：本次读取打开的一个库及其会话。 */
export type MbdV2SourceDatabase = Readonly<{
  dbnum: number;
  sesno: number;
  db_type: string;
}>;

/**
 * T4.5（现行计划 W3-2）：本次负载读自哪个数据时点。形状与 `/api/v1/spatial/centerline`
 * 的 `source_version`（`genModelV1Api.ts` `SpatialCenterlineResponse`）一致，面板才能直接和
 * 管道信息卡 / 时间轴的版本口径对账：`dbnum@sesno` 是 BRAN 所在设计库的会话，
 * `databases` 是本次读取打开的全部库（含目录库），每个库号只出现一次。
 */
export type MbdV2SourceVersion = Readonly<{
  dbnum: number;
  sesno: number;
  databases: readonly MbdV2SourceDatabase[];
}>;

/**
 * T4.6（现行计划 W3-6）+ T4.2（W3-3）：一条直段（PML `isoline`，plant-mbd `SplitResult::allarr`
 * 的一袋）的结构摘要。`index` 是袋下标，与 `MbdV2Issue.isoline_idx`、图元的 `isoline_idx`
 * 同一套编号；`members` 是袋成员 refno（按 `allarr` 顺序，host 认得的文本，格式不在契约里
 * 校验）；`cheight_mm` 是直段级字高（plant-mbd `isoline_cheight_mm`：`changeCheightAuto` 之后，
 * 角度 / 焊点 / 标签都按它摆，没出尺寸的直段也有公式值），`od_mm` 是直段外径；两者都是
 * 源空间毫米，和 `meta.cheight_mm` 同口径。
 *
 * `axis`（#103 第 2 步）：直段轴线，PML `isoline.line`——`from` 是直段起点 `isoline.pos`，`to` 是
 * 沿袋轴到最远成员的投影（`getisolineinfo`），与图元同在源空间毫米。极坐标放置以它为极轴；
 * absent / `null` = 生产者未声明（ADR 0055 D7 同款顺序：前端先接受、后消费）。
 */
export type MbdV2Isoline = Readonly<{
  index: number;
  members: readonly string[];
  cheight_mm: number;
  od_mm: number;
  axis?: MbdV2LineSegment | null;
}>;

export type MbdV2Meta = Readonly<{
  geometry_space: MbdV2GeometrySpace;
  source_to_design?: readonly number[];
  cheight_mm?: number | null;
  layout_mode?: string | null;
  /**
   * T4.1（现行计划 W3-1）：本次交付覆盖的图元 kind 列表，由求解器按它实际产出的
   * 类别声明。现网生产者还没发这个字段（absent = 未声明，`null` 同义），所以前端
   * 先接受、后消费（ADR 0055 D7 同款顺序）：面板的「本分支标注不完整」警示条改读
   * 它之后，`PARTIAL_LAYOUT_MODES` 兜底才能退休。给了就必须是字符串数组（允许空
   * 数组 = 明确声明什么都没覆盖；条目不限于前端已知的 kind），其它形状按 ADR 0046
   * 整包拒绝。
   */
  coverage?: readonly string[] | null;
  /**
   * T4.5（现行计划 W3-2）：数据时点，形状见 {@link MbdV2SourceVersion}。absent / `null` =
   * 生产者未声明（现网都还没发），前端先接受、后消费（ADR 0055 D7）。
   */
  source_version?: MbdV2SourceVersion | null;
  /**
   * T4.6 + T4.2（现行计划 W3-6 / W3-3）：直段表，形状见 {@link MbdV2Isoline}。absent / `null` =
   * 生产者未声明（现网都还没发）。有了它，字高按 D7 分三层：图元自己的 `text_height_mm`
   * > 所在直段的 `cheight_mm`（用图元的 `isoline_idx` 查表）> 全局 `meta.cheight_mm`（仍是
   * 各直段取最大，继续作兑底）。不要求 `index` 连续或有序：plant-mbd 没有布局方向的直段
   * 不进表；表里没有的下标消费侧回退全局值，不算错。
   */
  isolines?: readonly MbdV2Isoline[] | null;
  notes: readonly string[];
}>;

export type MbdV2AidLineStyle = 'solid' | 'dashed' | 'dash_dot';

export type MbdV2LinearDim = Readonly<{
  kind: 'linear_dim';
  id: string;
  /**
   * T4.4（现行计划 W3-5）：这条图元所标注 / 所落在的模型构件 refno，原样是 host 认得的
   * 文本（plant-mbd 发 `<dbnum>_<seq>`，与 `MbdV2Issue.object_refno` 同口径；格式不在契约
   * 里校验，消费侧统一过 `toRefnoKey`）。每种 kind 都可带，让点尺寸跳构件和巡检遮挡的
   * `subject` 不再从 id 字符串里猜（今天 `tagSubject` / `weldSubject` 只认 plant-mbd 的
   * id 约定）。缺省 = 未声明，即今天所有生产者的行为（ADR 0055 D7：前端先接受，producer
   * 后产出）；给了就得像 `id` 一样是非空字符串。
   */
  object_refno?: string;
  /**
   * T4.6（现行计划 W3-6）：这条图元所在直段的下标，与 `MbdV2Issue.isoline_idx` 和
   * `meta.isolines[].index` 同一套编号（plant-mbd `SplitResult::allarr` 的袋下标），让前端
   * 不再从 id 里的 `:isoline:<n>:` 猜。缺省 = 未归段（BRAN 级的标签 / 支名，或今天的生产
   * 者）；给了就得是非负安全整数。指向 `meta.isolines[]` 里没有的下标不算错：消费侧查不到
   * 就回退全局 `meta.cheight_mm`。
   */
  isoline_idx?: number;
  start: MbdV2Vec3;
  end: MbdV2Vec3;
  text: string;
  sub_kind?: string;
  extension_lines: readonly MbdV2LineSegment[];
  /**
   * Arrow strokes, one segment per wing: `from` is the tip on the dimension
   * line, `to` the wing base (plant-mbd `isodim::make_segment`: length
   * `0.96 · cheight`, half width `0.28 · cheight`, pointing outwards for
   * `sub_kind: "small"`). Source geometry drawn 1:1 by the 3D viewport; a
   * wing that projects shorter than the theme's `arrowLineMinLengthPx` is
   * stretched on screen about its tip (ADR 0048 §35, ADR 0056). Empty ⇒ the
   * kernel draws its own screen-scaled heads at both ends.
   */
  arrow_lines: readonly MbdV2LineSegment[];
  label_anchor: MbdV2Vec3;
  reference?: boolean;
}>;

/**
 * Shared arc frame, PML `AIDARC` 1:1 (`pos / ori(x, z) / radius / stangle /
 * sweepAngle`, ADR 0055). Angles are degrees; a positive sweep turns from
 * `x_axis` towards `normal × x_axis` (right-handed about `normal`). `x_axis`
 * travels explicitly so the wire contract never depends on the kernel's
 * private reference-axis rule (`stablePlaneBasis`); the mapper converts the
 * start angle into that basis. `radius` shares the payload's length unit.
 */
export type MbdV2ArcFrame = Readonly<{
  center: MbdV2Vec3;
  x_axis: MbdV2Vec3;
  normal: MbdV2Vec3;
  radius: number;
  start_angle_deg: number;
  sweep_angle_deg: number;
}>;

/**
 * Installation angle (PML `isombdangle` → `isoline.drawangle`): the arc, the
 * two legs from the arc centre along each direction, and the value text at
 * its centre anchor. Explicit geometry like `linear_dim`: the solver decides
 * every position, the mapper draws 1:1. `sub_kind` is a free solver label
 * (`tilt` = angle to the pipe axis, `rotation` = turn about the pipe axis).
 */
export type MbdV2AngleDim = Readonly<{
  kind: 'angle_dim';
  id: string;
  /** 所属构件 refno（T4.4），见 `MbdV2LinearDim.object_refno`。 */
  object_refno?: string;
  /** 所在直段下标（T4.6），见 `MbdV2LinearDim.isoline_idx`。 */
  isoline_idx?: number;
  text: string;
  leg_lines: readonly MbdV2LineSegment[];
  label_anchor: MbdV2Vec3;
  sub_kind?: string;
}> & MbdV2ArcFrame;

export type MbdV2Label = Readonly<{
  kind: 'label';
  id: string;
  /** 所属构件 refno（T4.4），见 `MbdV2LinearDim.object_refno`。 */
  object_refno?: string;
  /** 所在直段下标（T4.6），见 `MbdV2LinearDim.isoline_idx`。 */
  isoline_idx?: number;
  text: string;
  position: MbdV2Vec3;
  /** 文字基线方向（T4.3），含义见 `MbdV2AidText.text_dir`；缺省 = 视口水平。 */
  text_dir?: MbdV2Vec3;
}>;

export type MbdV2LeaderLine = Readonly<{
  kind: 'leader_line';
  id: string;
  /** 所属构件 refno（T4.4），见 `MbdV2LinearDim.object_refno`。 */
  object_refno?: string;
  /** 所在直段下标（T4.6），见 `MbdV2LinearDim.isoline_idx`。 */
  isoline_idx?: number;
  start: MbdV2Vec3;
  end: MbdV2Vec3;
}>;

export type MbdV2AidLine = Readonly<{
  kind: 'aid_line';
  id: string;
  /** 所属构件 refno（T4.4），见 `MbdV2LinearDim.object_refno`。 */
  object_refno?: string;
  /** 所在直段下标（T4.6），见 `MbdV2LinearDim.isoline_idx`。 */
  isoline_idx?: number;
  start: MbdV2Vec3;
  end: MbdV2Vec3;
  style?: MbdV2AidLineStyle;
}>;

export type MbdV2AidArc = Readonly<{
  kind: 'aid_arc';
  id: string;
  /** 所属构件 refno（T4.4），见 `MbdV2LinearDim.object_refno`。 */
  object_refno?: string;
  /** 所在直段下标（T4.6），见 `MbdV2LinearDim.isoline_idx`。 */
  isoline_idx?: number;
  style?: MbdV2AidLineStyle;
}> & MbdV2ArcFrame;

/** Full circle (PML `AIDCIR`): no in-plane reference axis is needed. */
export type MbdV2AidCircle = Readonly<{
  kind: 'aid_circle';
  id: string;
  /** 所属构件 refno（T4.4），见 `MbdV2LinearDim.object_refno`。 */
  object_refno?: string;
  /** 所在直段下标（T4.6），见 `MbdV2LinearDim.isoline_idx`。 */
  isoline_idx?: number;
  center: MbdV2Vec3;
  normal: MbdV2Vec3;
  radius: number;
  style?: MbdV2AidLineStyle;
}>;

export type MbdV2AidPoint = Readonly<{
  kind: 'aid_point';
  id: string;
  /** 所属构件 refno（T4.4），见 `MbdV2LinearDim.object_refno`。 */
  object_refno?: string;
  /** 所在直段下标（T4.6），见 `MbdV2LinearDim.isoline_idx`。 */
  isoline_idx?: number;
  position: MbdV2Vec3;
}>;

/**
 * Free text the solver places (PML `AIDTXT`). `text_height_mm` lets the
 * solver declare a height that differs from the group height: the
 * installation-angle direction labels are drawn at `cheight / 2` so they stay
 * subordinate to the value text. Absent means "follow `meta.cheight_mm`",
 * which is what every producer did before the field existed, so the mapper
 * keeps the group height for it (ADR 0055 D7: the front end accepts the
 * optional field first, the producer starts sending it later).
 */
export type MbdV2AidText = Readonly<{
  kind: 'aid_text';
  id: string;
  /** 所属构件 refno（T4.4），见 `MbdV2LinearDim.object_refno`。 */
  object_refno?: string;
  /** 所在直段下标（T4.6），见 `MbdV2LinearDim.isoline_idx`。 */
  isoline_idx?: number;
  text: string;
  position: MbdV2Vec3;
  /** Source-space (mm) cap height for this text; absent = the group height. */
  text_height_mm?: number;
  /**
   * T4.3（现行计划 W3-4）：文字基线（阅读）方向，PML AIDTXT `ori` 的 X 轴。与其它几何
   * 同在 `meta.geometry_space`，长度不限但不能是零向量；mapper 只取方向，经
   * `source_to_design` 的线性部分变换后进 `labelAlong` / `along`。缺省 = 视口水平，
   * 即今天所有生产者的行为（ADR 0055 D7：前端先接受，producer 后产出）。
   */
  text_dir?: MbdV2Vec3;
}>;

export type MbdV2WeldMark = Readonly<{
  kind: 'weld_mark';
  id: string;
  /** 所属构件 refno（T4.4），见 `MbdV2LinearDim.object_refno`。 */
  object_refno?: string;
  /** 所在直段下标（T4.6），见 `MbdV2LinearDim.isoline_idx`。 */
  isoline_idx?: number;
  position: MbdV2Vec3;
  weld_type?: string;
}>;

export type MbdV2SlopeMark = Readonly<{
  kind: 'slope_mark';
  id: string;
  /** 所属构件 refno（T4.4），见 `MbdV2LinearDim.object_refno`。 */
  object_refno?: string;
  /** 所在直段下标（T4.6），见 `MbdV2LinearDim.isoline_idx`。 */
  isoline_idx?: number;
  text: string;
  start: MbdV2Vec3;
  end: MbdV2Vec3;
  /** 文字基线方向（T4.3），含义见 `MbdV2AidText.text_dir`；缺省 = 视口水平。 */
  text_dir?: MbdV2Vec3;
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

/** 契约层逐条跳过、但负载整体仍可交付的说明（A3：不认识的图元 kind）。 */
export type MbdV2ParseDiagnostic = Readonly<{
  id: string;
  reason: string;
}>;

/**
 * 解析选项。默认行为严格按 ADR 0046，两个开关各自只放宽一件事：
 *
 * | 情形 | 默认 | `partial: true` | `strict: true` |
 * | --- | --- | --- | --- |
 * | 不认识的图元 `kind` | 整包拒绝（ADR 0046） | 跳过它自己 + 记诊断 | 整包拒绝 |
 * | 已知 `kind` 上的契约外字段 | 忽略（向前兼容） | 忽略 | 整包拒绝 |
 * | 已知 `kind` 字段非法 | 整包拒绝 | 整包拒绝 | 整包拒绝 |
 *
 * `partial` 由用户体验开关 `?mbd_partial=1`（面板「允许部分显示」）驱动，是与
 * ADR 0046 的显式、可撤销偏离；`strict` 供契约回归与后端联调对账。
 */
export type MbdV2ParseOptions = Readonly<{
  strict?: boolean;
  partial?: boolean;
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

/**
 * Wire vocabulary of `style` on the aid kinds (`MbdV2AidLineStyle`). An
 * unknown value rejects the payload (ADR 0046) rather than falling through
 * to the mapper's no-style default (C6).
 */
const AID_LINE_STYLES: readonly MbdV2AidLineStyle[] = ['solid', 'dashed', 'dash_dot'];

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string';
}

/** 可选的构件 refno（`object_refno`，T4.4）：缺省可以，给了就得像 `id` 一样是非空字符串。 */
function isOptionalNonEmptyString(value: unknown): value is string | undefined {
  return value === undefined || isNonEmptyString(value);
}

/** 直段下标（`isoline_idx` / `meta.isolines[].index`）：非负安全整数。 */
function isIsolineIndex(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isOptionalIsolineIndex(value: unknown): value is number | undefined {
  return value === undefined || isIsolineIndex(value);
}

function isOptionalAidLineStyle(value: unknown): value is MbdV2AidLineStyle | undefined {
  return value === undefined || AID_LINE_STYLES.includes(value as MbdV2AidLineStyle);
}

function isVec3(value: unknown): value is MbdV2Vec3 {
  return Array.isArray(value)
    && value.length === 3
    && value.every(item => typeof item === 'number' && Number.isFinite(item));
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Axis vectors: finite and not the zero vector (unit length is the mapper's job). */
function isAxisVec3(value: unknown): value is MbdV2Vec3 {
  return isVec3(value) && (value[0] !== 0 || value[1] !== 0 || value[2] !== 0);
}

/** 可选的方向字段（`text_dir`）：缺省可以，给了就得是有限、非零的三维向量。 */
function isOptionalAxisVec3(value: unknown): value is MbdV2Vec3 | undefined {
  return value === undefined || isAxisVec3(value);
}

function isPositiveRadius(value: unknown): value is number {
  return isFiniteNumber(value) && value > 0;
}

/**
 * Optional length field: absent is fine (older producers), present must be a
 * finite positive number — a zero or negative height has no meaning and a
 * NaN would poison the kernel's projection.
 */
function isOptionalPositiveNumber(value: unknown): value is number | undefined {
  return value === undefined || isPositiveRadius(value);
}

/** Structure and finiteness only (ADR 0046); perpendicularity is re-derived by the mapper. */
function isArcFrame(value: Record<string, unknown>): boolean {
  return isVec3(value.center)
    && isAxisVec3(value.x_axis)
    && isAxisVec3(value.normal)
    && isPositiveRadius(value.radius)
    && isFiniteNumber(value.start_angle_deg)
    && isFiniteNumber(value.sweep_angle_deg)
    && value.sweep_angle_deg > 0
    && value.sweep_angle_deg <= 360;
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

/** 库号：正的安全整数；会话号：非负安全整数（与 `pipeInformation.ts` 的 `validSourceVersion` 同口径）。 */
function isDbnum(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function isSesno(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

/**
 * `meta.source_version`：结构、取值范围与「同一库号只出现一次」三件事。有意**不**要求
 * `databases` 含顶层那条（`pipeInformation.ts` 的 `validSourceVersion` 要求）：从 parquet
 * 离线跑的生产者（rs-mbd CLI）没有打开任何库，`databases: []` 是它如实的声明，为一个
 * 只供显示的字段整包拒收不值得。
 */
function isSourceVersion(value: unknown): value is MbdV2SourceVersion {
  if (!isObject(value) || !isDbnum(value.dbnum) || !isSesno(value.sesno)) return false;
  const databases = value.databases;
  if (!Array.isArray(databases)) return false;
  const seen = new Set<number>();
  for (const database of databases) {
    if (!isObject(database)
      || !isDbnum(database.dbnum)
      || !isSesno(database.sesno)
      || typeof database.db_type !== 'string'
      || seen.has(database.dbnum)) {
      return false;
    }
    seen.add(database.dbnum);
  }
  return true;
}

/**
 * `meta.isolines[].axis`：缺省或 `null` 都是未声明；给了就得是两个有限、且不重合的端点——零长的
 * 轴定不出方向（PML `getisolineinfo` 遇到起终点重合也要先偏 1 mm 才成线）。
 */
function isOptionalIsolineAxis(value: unknown): value is MbdV2LineSegment | null | undefined {
  if (value === undefined || value === null) return true;
  if (!isObject(value) || !isVec3(value.from) || !isVec3(value.to)) return false;
  const [fromX, fromY, fromZ] = value.from;
  const [toX, toY, toZ] = value.to;
  return fromX !== toX || fromY !== toY || fromZ !== toZ;
}

/**
 * `meta.isolines`：每条 `index` 非负整数且全表唯一（查表用），`members` 是非空字符串数组
 * （允许空数组），`cheight_mm` / `od_mm` 是正的有限数（和半径 / `text_height_mm` 同一条规则：
 * 零或负的字高没有意义，NaN 会毒化投影），可选的 `axis` 见 {@link isOptionalIsolineAxis}。
 * 不要求 `index` 连续或有序。
 */
function isIsolineList(value: unknown): value is readonly MbdV2Isoline[] {
  if (!Array.isArray(value)) return false;
  const seen = new Set<number>();
  for (const isoline of value) {
    if (!isObject(isoline)
      || !isIsolineIndex(isoline.index)
      || seen.has(isoline.index)
      || !Array.isArray(isoline.members)
      || !isoline.members.every(member => isNonEmptyString(member))
      || !isPositiveRadius(isoline.cheight_mm)
      || !isPositiveRadius(isoline.od_mm)
      || !isOptionalIsolineAxis(isoline.axis)) {
      return false;
    }
    seen.add(isoline.index);
  }
  return true;
}

function isPrimitive(value: unknown): value is MbdPrimitive {
  if (!isObject(value) || !isNonEmptyString(value.id)) return false;
  // 所有 kind 共有的可选定位字段（T4.4 / T4.6）先于按 kind 的检查。
  if (!isOptionalNonEmptyString(value.object_refno)) return false;
  if (!isOptionalIsolineIndex(value.isoline_idx)) return false;
  switch (value.kind) {
    case 'linear_dim':
      return isVec3(value.start)
        && isVec3(value.end)
        && typeof value.text === 'string'
        && isOptionalString(value.sub_kind)
        && isLineSegmentArray(value.extension_lines)
        && isLineSegmentArray(value.arrow_lines)
        && isVec3(value.label_anchor)
        && (value.reference === undefined || typeof value.reference === 'boolean');
    case 'angle_dim':
      return typeof value.text === 'string'
        && isArcFrame(value)
        && isLineSegmentArray(value.leg_lines)
        && isVec3(value.label_anchor)
        && isOptionalString(value.sub_kind);
    case 'label':
      return typeof value.text === 'string'
        && isVec3(value.position)
        && isOptionalAxisVec3(value.text_dir);
    case 'leader_line':
      return isVec3(value.start) && isVec3(value.end);
    case 'aid_line':
      return isVec3(value.start)
        && isVec3(value.end)
        && isOptionalAidLineStyle(value.style);
    case 'aid_arc':
      return isArcFrame(value) && isOptionalAidLineStyle(value.style);
    case 'aid_circle':
      return isVec3(value.center)
        && isAxisVec3(value.normal)
        && isPositiveRadius(value.radius)
        && isOptionalAidLineStyle(value.style);
    case 'aid_point':
      return isVec3(value.position);
    case 'aid_text':
      return typeof value.text === 'string'
        && isVec3(value.position)
        && isOptionalPositiveNumber(value.text_height_mm)
        && isOptionalAxisVec3(value.text_dir);
    case 'weld_mark':
      return isVec3(value.position) && isOptionalString(value.weld_type);
    case 'slope_mark':
      return typeof value.text === 'string'
        && isVec3(value.start)
        && isVec3(value.end)
        && isOptionalAxisVec3(value.text_dir);
    default:
      // 不认识的 kind 由 classifyPrimitive 单独判：默认跳过 + 诊断，strict 才整包拒绝。
      return false;
  }
}

/** 每种 kind 都有的字段：`kind` / `id`，以及可选的定位字段 `object_refno`（T4.4）/ `isoline_idx`（T4.6）。 */
const COMMON_PRIMITIVE_FIELDS: readonly string[] = ['kind', 'id', 'object_refno', 'isoline_idx'];

/** 已知 kind 自己的字段白名单，`COMMON_PRIMITIVE_FIELDS` 之外（只在 `strict` 模式下检查「多出来的字段」）。 */
const PRIMITIVE_FIELDS: Readonly<Record<MbdPrimitiveKind, readonly string[]>> = {
  linear_dim: ['start', 'end', 'text', 'sub_kind',
    'extension_lines', 'arrow_lines', 'label_anchor', 'reference'],
  angle_dim: ['text', 'leg_lines', 'label_anchor', 'sub_kind',
    'center', 'x_axis', 'normal', 'radius', 'start_angle_deg', 'sweep_angle_deg'],
  label: ['text', 'position', 'text_dir'],
  leader_line: ['start', 'end'],
  aid_line: ['start', 'end', 'style'],
  aid_arc: ['style',
    'center', 'x_axis', 'normal', 'radius', 'start_angle_deg', 'sweep_angle_deg'],
  aid_circle: ['center', 'normal', 'radius', 'style'],
  aid_point: ['position'],
  aid_text: ['text', 'position', 'text_height_mm', 'text_dir'],
  weld_mark: ['position', 'weld_type'],
  slope_mark: ['text', 'start', 'end', 'text_dir'],
};

const KNOWN_PRIMITIVE_KINDS = Object.keys(PRIMITIVE_FIELDS) as MbdPrimitiveKind[];

function isKnownPrimitiveKind(value: unknown): value is MbdPrimitiveKind {
  return typeof value === 'string'
    && (KNOWN_PRIMITIVE_KINDS as readonly string[]).includes(value);
}

/** 已知 kind 上出现了白名单以外的字段（只在 strict 模式下算错）。 */
function hasUnknownPrimitiveFields(value: Record<string, unknown>): string | null {
  if (!isKnownPrimitiveKind(value.kind)) return null;
  const allowed = PRIMITIVE_FIELDS[value.kind];
  const unknown = Object.keys(value).filter(key =>
    !COMMON_PRIMITIVE_FIELDS.includes(key) && !allowed.includes(key));
  return unknown.length > 0 ? unknown.join(', ') : null;
}

type PrimitiveVerdict =
  | Readonly<{ kind: 'ok' }>
  | Readonly<{ kind: 'unsupported' }>
  | Readonly<{ kind: 'invalid' }>;

/**
 * 一条图元的三分类：
 * - `unsupported`：kind 不在契约里 —— 只有显式开了 `partial` 才只跳过它自己，
 *   默认按 ADR 0046 整包拒绝；
 * - `invalid`：认识的 kind 但字段不合法（strict 下还包括契约外字段）—— 永远整包
 *   拒绝（写错的数据不可信）；
 * - `ok`：可交付。
 */
function classifyPrimitive(
  value: unknown,
  options: Readonly<{ strict: boolean; partial: boolean }>,
): PrimitiveVerdict {
  if (!isObject(value)) return { kind: 'invalid' };
  const kindUnknown = typeof value.kind === 'string' && !isKnownPrimitiveKind(value.kind);
  if (kindUnknown) {
    return options.partial && !options.strict
      ? { kind: 'unsupported' }
      : { kind: 'invalid' };
  }
  if (!isPrimitive(value)) return { kind: 'invalid' };
  if (options.strict && hasUnknownPrimitiveFields(value)) return { kind: 'invalid' };
  return { kind: 'ok' };
}

/** Names the offender so a rejected payload stays locatable (ADR 0046). */
function describeEntry(value: unknown, index: number): string {
  if (!isObject(value)) return `entry at index ${index}`;
  const kind = typeof value.kind === 'string' ? `${value.kind} ` : '';
  return isNonEmptyString(value.id)
    ? `${kind}"${value.id}"`
    : `${kind}entry at index ${index}`;
}

function primitiveRejection(value: unknown, index: number): string {
  return `MBD V2 payload has an invalid primitive ${describeEntry(value, index)}`;
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
    || (value.coverage !== undefined
      && value.coverage !== null
      && !(Array.isArray(value.coverage) && value.coverage.every(kind => isNonEmptyString(kind))))
    || (value.source_version !== undefined
      && value.source_version !== null
      && !isSourceVersion(value.source_version))
    || (value.isolines !== undefined
      && value.isolines !== null
      && !isIsolineList(value.isolines))
  ) return null;
  return {
    geometry_space: value.geometry_space,
    ...(value.source_to_design !== undefined
      ? { source_to_design: value.source_to_design as readonly number[] }
      : {}),
    ...(value.cheight_mm !== undefined ? { cheight_mm: value.cheight_mm as number | null } : {}),
    ...(value.layout_mode !== undefined ? { layout_mode: value.layout_mode as string | null } : {}),
    ...(value.coverage !== undefined ? { coverage: value.coverage as readonly string[] | null } : {}),
    ...(value.source_version !== undefined
      ? { source_version: value.source_version as MbdV2SourceVersion | null }
      : {}),
    ...(value.isolines !== undefined
      ? { isolines: value.isolines as readonly MbdV2Isoline[] | null }
      : {}),
    notes: value.notes as string[],
  };
}

/**
 * Strict validation for the external V2 JSON contract. Parquet rows are
 * normalized before this boundary and keep their own per-row diagnostics.
 *
 * 默认按 ADR 0046：不认识的图元 kind、认识但字段非法的图元，一律整包拒绝。
 * 两处可显式放宽 —— `partial`（面板「允许部分显示」，`?mbd_partial=1`）让不认识的
 * kind 降级成逐条诊断；契约外字段在默认模式下本就被忽略（A2，后端先发字段、前端
 * 后支持），`strict` 才把它们当错。三种情形见 {@link MbdV2ParseOptions}。
 */
export function parseMbdV2PipeData(
  value: unknown,
  options: MbdV2ParseOptions = {},
): MbdV2ParseResult {
  const strict = options.strict === true;
  const partial = options.partial === true;
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
  const primitives: MbdPrimitive[] = [];
  const diagnostics: MbdV2ParseDiagnostic[] = [];
  for (let index = 0; index < value.primitives.length; index += 1) {
    const candidate = value.primitives[index];
    const verdict = classifyPrimitive(candidate, { strict, partial });
    if (verdict.kind === 'ok') {
      primitives.push(candidate as MbdPrimitive);
      continue;
    }
    if (verdict.kind === 'unsupported') {
      const id = isObject(candidate) && isNonEmptyString(candidate.id)
        ? candidate.id
        : `#${index}`;
      const kind = isObject(candidate) && typeof candidate.kind === 'string'
        ? candidate.kind
        : 'unknown';
      diagnostics.push({
        id,
        reason: `还不认识的图元 kind：${kind}`,
      });
      continue;
    }
    return { ok: false, error: primitiveRejection(candidate, index) };
  }
  const parsedIssues = value.issues.map(parseIssue);
  const issueIndex = parsedIssues.findIndex(issue => issue === null);
  if (issueIndex >= 0) {
    return {
      ok: false,
      error: `MBD V2 payload has an invalid issue ${
        describeEntry(value.issues[issueIndex], issueIndex)}`,
    };
  }

  return {
    ok: true,
    data: {
      version: 'v2',
      input_refno: value.input_refno,
      branch_refno: value.branch_refno,
      primitives,
      meta,
      issues: parsedIssues as MbdV2Issue[],
    },
    diagnostics,
  };
}
