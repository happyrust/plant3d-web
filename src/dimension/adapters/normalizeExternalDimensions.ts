import type {
  ExplicitLayoutInput,
  NormalizedDimensionInput,
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
  | 'xeokit-measurement';

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
  role: 'external' | 'external-reference';
  /** Omitted means 'dimension' (pre-existing records are all dimensions). */
  category?: ExternalDimensionCategory;
  /**
   * 缺省 = 由 `layout.labelPinned` 推导（true → solver，false → screen，既有生产者
   * 一行不改）；显式给出时它是唯一事实源，`normalizeExternalDimension` 据它
   * 重算送进内核的 `labelPinned`。
   */
  layoutAuthority?: ExternalLayoutAuthority;
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
