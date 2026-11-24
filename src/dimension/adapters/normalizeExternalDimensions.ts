import type {
  DimensionSemanticRole,
  ExplicitLayoutInput,
  NormalizedDimensionInput,
  Vec3,
} from '../kernel/types';

/**
 * 外部尺寸（dimension）与外部标注图元（annotation）的领域区分（ADR 0041）：
 * 前者是 LinearDim/AngleDim 等真正的尺寸，后者是标签、引线、辅助几何、
 * 焊缝/坡度符号等非尺寸图元。两类都只读、共用呈现内核。
 */
export type ExternalDimensionCategory = 'dimension' | 'annotation';
export type ExternalDimensionSource =
  | 'bran-clearance'
  | 'clearance'
  | 'mbd'
  | 'measurement'
  | 'pipe-distance'
  | 'pipe-information'
  | 'xeokit-measurement'
  | 'grid';

/**
 * 谁决定标签落点（S1，计划 §6.2）：
 * - `solver`：布局由求解器决定（MBD `label_anchor`，ADR 0003 确定性排版），
 *   Web 只登记占位、不移动、不补引线——内核里对应 `labelPinned: true`
 *   （`resolveLabelCollisions` 只让 pinned 标签占空间）。
 * - `screen`：参与 Web 的移动式避让，内核里对应 `labelPinned: false`。
 */
export type ExternalLayoutAuthority = 'solver' | 'screen';

export type ExternalDimensionRecord = Readonly<{
  id: string;
  source: ExternalDimensionSource;
  sourceLabel: string;
  role: Exclude<DimensionSemanticRole, 'normal'>;
  /** Omitted means 'dimension' (pre-existing records are all dimensions). */
  category?: ExternalDimensionCategory;
  /**
   * 缺省 = 由 `layout.labelPinned` 推导（true → solver，false → screen，既有生产者
   * 一行不改）；显式给出时它是唯一事实源，`normalizeExternalDimension` 据它
   * 重算送进内核的 `labelPinned`。
   */
  layoutAuthority?: ExternalLayoutAuthority;
  /**
   * 所在直段（MBD `isoline_idx`，T4.6）：`meta.isolines[]` 里那一行的 `index`。
   * 只有 MBD 生产者写，面板据它分组；缺省 = 不按直段归类。
   */
  isolineIndex?: number;
  /**
   * PML FUNCTION 类别（MBD `function`，#103 M1-3），如「一级尺寸」「定位尺寸」，原样是求解器给的
   * 文本。只有 MBD 生产者写，面板据它按类别成组、整组临时显隐；缺省 = 未声明，回落到原有分组。
   * 管道包的记录不写（管道面板照旧按直段分组，ADR 0071）。
   */
  mbdFunction?: string;
  /**
   * 尺寸链 id（MBD `chain_id`，#103 M1-3）：PML 的 N 点尺寸链拆成 N−1 条线性尺寸后同链各段共用它。
   * 只有 MBD 生产者写；缺省 = 不属于任何链。
   */
  chainId?: string;
  layout: NormalizedDimensionInput | ExplicitLayoutInput;
}>;

export function externalDimensionCategory(
  record: ExternalDimensionRecord,
): ExternalDimensionCategory {
  return record.category ?? 'dimension';
}

/** 显式字段优先；缺省按 `layout.labelPinned` 推导（true → solver，false → screen）。 */
export function externalLayoutAuthority(
  record: ExternalDimensionRecord,
): ExternalLayoutAuthority {
  return record.layoutAuthority ?? (record.layout.labelPinned ? 'solver' : 'screen');
}

export type ExternalDimensionMappingResult = Readonly<{
  records: readonly ExternalDimensionRecord[];
  skipped: readonly Readonly<{ id: string; reason: string }>[];
}>;

export function normalizeExternalDimension(
  record: ExternalDimensionRecord,
): NormalizedDimensionInput | ExplicitLayoutInput {
  return {
    ...record.layout,
    id: record.id,
    role: record.role,
    labelPinned: externalLayoutAuthority(record) === 'solver',
  } as NormalizedDimensionInput | ExplicitLayoutInput;
}

/**
 * Design Space 里把这批记录的几何包起来的轴对齐盒：线的端点、标签锚点、箭头、弧（按半径外扩）、标记、
 * 附加文字、卡片引线指的点、三维尺寸的管道点。非有限的点不算；一个有限点都没有时返回 `null`。
 * 给宿主摆相机用（把相机对到标注上），不参与排版。
 */
export function externalDimensionBounds(
  records: readonly ExternalDimensionRecord[],
): Readonly<{ min: Vec3; max: Vec3 }> | null {
  const min: [number, number, number] = [
    Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY,
  ];
  const max: [number, number, number] = [
    Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY,
  ];
  let found = false;
  const add = (point: Vec3 | undefined, padM = 0): void => {
    if (!point || !point.every(Number.isFinite) || !Number.isFinite(padM)) return;
    found = true;
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis]!, point[axis]! - padM);
      max[axis] = Math.max(max[axis]!, point[axis]! + padM);
    }
  };
  for (const record of records) {
    const layout = record.layout;
    if ('lines' in layout) {
      add(layout.labelAnchor);
      for (const line of layout.lines) {
        add(line.from);
        add(line.to);
      }
      for (const line of layout.arrowLines) {
        add(line.from);
        add(line.to);
      }
      for (const arc of layout.arcs ?? []) add(arc.center, Math.abs(arc.radiusM));
      for (const marker of layout.markers ?? []) add(marker.at);
      for (const text of layout.texts ?? []) add(text.anchor);
      add(layout.tag?.target);
      add(layout.dimension3d?.from);
      add(layout.dimension3d?.to);
    } else if (layout.kind === 'angular') {
      add(layout.vertex);
    } else if (layout.kind === 'radial') {
      add(layout.center);
      add(layout.rim);
    } else {
      add(layout.a);
      add(layout.b);
    }
  }
  return found ? { min, max } : null;
}

/**
 * 宿主要不要把相机对到刚装上的外部标注上。只在三件事同时成立时：
 * - 场景里一个模型对象都没有（有模型时相机跟模型走，不抢）；
 * - 这批来源有记录（空包、整包失败没有东西可对）；
 * - 这批来源还没对过（面板上的开关走 popstate 重新同步，同一批不该把用户拉近的视角弹回去）。
 */
export function shouldFrameExternalDimensions(input: Readonly<{
  sceneObjectCount: number;
  recordCount: number;
  sourceKey: string;
  framedSourceKey: string | null;
}>): boolean {
  return input.sceneObjectCount === 0
    && input.recordCount > 0
    && input.sourceKey !== input.framedSourceKey;
}
