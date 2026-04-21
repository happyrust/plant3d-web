/**
 * MBD V2 数据契约（TypeScript 侧）。
 *
 * 设计原则：
 * - 与后端 `aios_core::mbd::v2::primitive` 完全镜像
 * - 所有坐标世界空间、单位 mm
 * - 所有 primitive 为「已排版完成」的最终输出，前端不再二次计算方向 / 偏移
 *
 * 详见 `rs-core/MBD/开发文档/MBD-V2-开发计划.md`。
 *
 * @packageDocumentation
 */

// ─────────────────────────────────────────────────────────────────────────
// 基础类型
// ─────────────────────────────────────────────────────────────────────────

/** 世界坐标向量（mm）。与 Rust 侧 `Vec3V2` 同构。 */
export type Vec3V2 = [number, number, number];

/** 所有 primitive 公共字段。对应 Rust `CommonFields`；以 `#[serde(flatten)]` 在 JSON 中展平到 primitive 同层。 */
export type CommonFields = {
  /** 稳定唯一 ID。 */
  id: string;
  /** PDMS `nodeNames`：绑定到的模型节点名数组。 */
  node_names: string[];
  /** 业务语义（`"长度"` / `"坡度"` / `"焊"`）。 */
  function?: string;
  /** 产生此 primitive 的上游对象 refno。 */
  source_refno?: string;
  /** 是否可见。 */
  visible: boolean;
  /** `visible=false` 时给出抑制原因。 */
  suppressed_reason?: string;
}

/** 文字块；出现在 dim / slope / label 等处。 */
export type TextBlock = {
  /** 文字基线起点（世界坐标）。 */
  anchor: Vec3V2;
  /** 文字内容，已完成格式化与单位装饰。 */
  content: string;
  /** 字高（mm），对应 PDMS `cheight`。 */
  height_mm: number;
  /** 文字阅读方向（右向量）。 */
  orientation: Vec3V2;
  /** 文字上方向。 */
  up: Vec3V2;
}

/** 一根直线的两个端点。 */
export type LineSegmentEndpoints = {
  start: Vec3V2;
  end: Vec3V2;
}

// ─────────────────────────────────────────────────────────────────────────
// 顶层响应
// ─────────────────────────────────────────────────────────────────────────

/** MBD V2 API 的响应封装。 */
export type MbdV2Response = {
  success: boolean;
  error_message?: string;
  data?: MbdV2PipeData;
}

/** MBD V2 数据主载荷。 */
export type MbdV2PipeData = {
  /** 契约版本号。Phase 1 固定为 `"v2"`。 */
  version: 'v2';
  /** API 请求时传入的 refno。 */
  input_refno: string;
  /** 实际被标注的分支 refno。 */
  branch_refno: string;
  /** 所有图元的最终列表。 */
  primitives: MbdPrimitive[];
  /** 聚合元数据。 */
  meta: MbdV2Meta;
  /** 结构化问题，对标 PDMS `wronglines`。 */
  issues: MbdV2Issue[];
}

export type MbdV2Meta = {
  segments_count: number;
  welds_count: number;
  /** `dims_by_kind["segment"]` 等。 */
  dims_by_kind: Record<string, number>;
  branch_attrs: Record<string, string>;
  /** ISO 8601。 */
  generated_at: string;
}

export type MbdV2Issue = {
  id: string;
  severity: IssueSeverity;
  category: IssueCategory;
  message: string;
  related_refnos?: string[];
  related_primitive_ids?: string[];
}

export type IssueSeverity = 'info' | 'warning' | 'error';
export type IssueCategory = 'geometry' | 'data' | 'layout' | 'avoidance';

// ─────────────────────────────────────────────────────────────────────────
// Primitive 判别联合
// ─────────────────────────────────────────────────────────────────────────

/** 已排版完成的 MBD 图元。前端按 `kind` 分发渲染。 */
export type MbdPrimitive =
  | LinearDimPrimitive
  | AngleDimPrimitive
  | LabelPrimitive
  | LeaderLinePrimitive
  | AidLinePrimitive
  | AidArcPrimitive
  | AidCirclePrimitive
  | AidPointPrimitive
  | AidTextPrimitive
  | WeldMarkPrimitive
  | SlopeMarkPrimitive;

/** 从任意 primitive 取 `id`，对等 Rust `MbdPrimitive::id()`。 */
export function primitiveId(p: MbdPrimitive): string {
  return p.id;
}

/** 是否可见；被 suppress 的 primitive 可能留下但 `visible=false`。 */
export function primitiveVisible(p: MbdPrimitive): boolean {
  return p.visible;
}

// ─────────────────────────────────────────────────────────────────────────
// Linear dim
// ─────────────────────────────────────────────────────────────────────────

export type LinearDimSubKind = 'segment' | 'chain' | 'overall' | 'port';

export type LinearDimArrow = {
  position: Vec3V2;
  direction: Vec3V2;
}

/** 线性尺寸（对应 PDMS `lindim`）。 */
export type LinearDimPrimitive = {
  kind: 'linear_dim';
  sub_kind: LinearDimSubKind;
  extension_1: LineSegmentEndpoints;
  extension_2: LineSegmentEndpoints;
  dim_line: LineSegmentEndpoints;
  /** 两个箭头：起点方向、终点方向。 */
  arrows: [LinearDimArrow, LinearDimArrow];
  text: TextBlock;
  /** 分层序号；`0` 为基础层，`>0` 表示已被后端 `SmallDimSolver` 错层。 */
  level: number;
} & CommonFields

// ─────────────────────────────────────────────────────────────────────────
// Angle dim
// ─────────────────────────────────────────────────────────────────────────

export type AngleDimArrow = {
  position: Vec3V2;
  /** 弧顶切线方向（单位向量），用于前端绘制弧端箭头。 */
  tangent: Vec3V2;
}

export type ArcGeometry = {
  center: Vec3V2;
  radius_mm: number;
  start_angle_rad: number;
  sweep_rad: number;
  /** 弧所在平面的法线（单位向量）。 */
  normal: Vec3V2;
}

/** 角度尺寸（如弯头、管件夹角）。 */
export type AngleDimPrimitive = {
  kind: 'angle_dim';
  vertex: Vec3V2;
  /** 第一条参考射线的单位方向。 */
  ray_1: Vec3V2;
  /** 第二条参考射线的单位方向。 */
  ray_2: Vec3V2;
  arc: ArcGeometry;
  arrows: [AngleDimArrow, AngleDimArrow];
  text: TextBlock;
} & CommonFields

// ─────────────────────────────────────────────────────────────────────────
// Label / LeaderLine
// ─────────────────────────────────────────────────────────────────────────

export type LabelBoxShape = 'none' | 'rect' | 'circle';

/** 带锚点的标签（对应 PDMS `mlabel`）。引线单独作为 `LeaderLinePrimitive` 出现。 */
export type LabelPrimitive = {
  kind: 'label';
  anchor: Vec3V2;
  text_anchor: Vec3V2;
  content: string;
  height_mm: number;
  orientation: Vec3V2;
  up: Vec3V2;
  box_shape: LabelBoxShape;
  /** 方框内边距（mm），仅 `box_shape !== 'none'` 时有意义。 */
  box_padding_mm: number;
} & CommonFields

export type LeaderArrowAt = 'none' | 'start' | 'end' | 'both';

export type LeaderLinePrimitive = {
  kind: 'leader_line';
  /** 折线点，至少 2 个。 */
  points: Vec3V2[];
  arrow_at: LeaderArrowAt;
} & CommonFields

// ─────────────────────────────────────────────────────────────────────────
// Aid 辅助图元
// ─────────────────────────────────────────────────────────────────────────

export type AidLineStyle = 'solid' | 'dashed' | 'dash_dot';

export type AidLinePrimitive = {
  kind: 'aid_line';
  /** 折线点，至少 2 个。 */
  points: Vec3V2[];
  style: AidLineStyle;
} & CommonFields

export type AidArcPrimitive = {
  kind: 'aid_arc';
  center: Vec3V2;
  radius_mm: number;
  start_angle_rad: number;
  sweep_rad: number;
  normal: Vec3V2;
} & CommonFields

export type AidCirclePrimitive = {
  kind: 'aid_circle';
  center: Vec3V2;
  radius_mm: number;
  normal: Vec3V2;
} & CommonFields

export type AidPointPrimitive = {
  kind: 'aid_point';
  position: Vec3V2;
  diameter_mm: number;
} & CommonFields

export type AidTextPrimitive = {
  kind: 'aid_text';
  position: Vec3V2;
  content: string;
  height_mm: number;
  orientation: Vec3V2;
  up: Vec3V2;
} & CommonFields

// ─────────────────────────────────────────────────────────────────────────
// Weld / Slope
// ─────────────────────────────────────────────────────────────────────────

export type WeldType = 'shop' | 'field';

export type WeldMarkPrimitive = {
  kind: 'weld_mark';
  position: Vec3V2;
  cross_size_mm: number;
  weld_type: WeldType;
  /** 可选：关联一条 `LabelPrimitive` 的 id；避免重复携带文字。 */
  linked_label_id?: string;
} & CommonFields

export type SlopeMarkPrimitive = {
  kind: 'slope_mark';
  start: Vec3V2;
  end: Vec3V2;
  /** 有符号坡度：`dy / horizontal`。 */
  slope: number;
  text: TextBlock;
} & CommonFields

// ─────────────────────────────────────────────────────────────────────────
// 类型守卫（type guards）
// ─────────────────────────────────────────────────────────────────────────

export function isLinearDim(p: MbdPrimitive): p is LinearDimPrimitive {
  return p.kind === 'linear_dim';
}
export function isAngleDim(p: MbdPrimitive): p is AngleDimPrimitive {
  return p.kind === 'angle_dim';
}
export function isLabel(p: MbdPrimitive): p is LabelPrimitive {
  return p.kind === 'label';
}
export function isLeaderLine(p: MbdPrimitive): p is LeaderLinePrimitive {
  return p.kind === 'leader_line';
}
export function isAidLine(p: MbdPrimitive): p is AidLinePrimitive {
  return p.kind === 'aid_line';
}
export function isAidArc(p: MbdPrimitive): p is AidArcPrimitive {
  return p.kind === 'aid_arc';
}
export function isAidCircle(p: MbdPrimitive): p is AidCirclePrimitive {
  return p.kind === 'aid_circle';
}
export function isAidPoint(p: MbdPrimitive): p is AidPointPrimitive {
  return p.kind === 'aid_point';
}
export function isAidText(p: MbdPrimitive): p is AidTextPrimitive {
  return p.kind === 'aid_text';
}
export function isWeldMark(p: MbdPrimitive): p is WeldMarkPrimitive {
  return p.kind === 'weld_mark';
}
export function isSlopeMark(p: MbdPrimitive): p is SlopeMarkPrimitive {
  return p.kind === 'slope_mark';
}

/**
 * MBD V2 primitive 的 `kind` 闭集合。
 * 用于 `switch` 穷举与类型守卫断言。
 */
export const MBD_V2_PRIMITIVE_KINDS = [
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
] as const;

export type MbdPrimitiveKind = (typeof MBD_V2_PRIMITIVE_KINDS)[number];

/** 编译期穷举哨兵，确保 switch case 覆盖所有 primitive。 */
export function assertNever(x: never): never {
  throw new Error(`Unreachable primitive kind: ${JSON.stringify(x)}`);
}
