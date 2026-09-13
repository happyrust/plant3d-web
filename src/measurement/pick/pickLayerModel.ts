/**
 * E3D Positioning Control pick layer, two-dimensional: **pick filter** × **pick type**.
 *
 * Source: E3D 3.1 PMLLIB `edgposcntrl.pmlobj` (`loadPicks`: `picks[1..8]`,
 * `pickTypes[1..7]`, default values, `intermediate` = Significant Snaps),
 * `edgpick.pmlobj` (`std*` descriptions), `edgpicktype.pmlobj` (`set*` prompt
 * tokens), `edgstate.pmlobj` (`prompt()` composition).
 *
 * The labels are E3D's own gadget strings — kept verbatim so the Web prompt
 * reads like the E3D command line (`Measure distance start (Snap) Snap :`).
 *
 * Prompt composition (`EDGSTATE.prompt()`):
 *   `<pickPacket.prompt> <pickType.prompt> (<pick.prompt>) [WP] [Offset] [Snap] :`
 *   - `pickPacket.prompt`  = the command ("Measure distance")
 *   - `pickType.prompt`    = the step ("start" / "end")
 *   - `pick.prompt`        = the **pick type** token ("Snap" / "Cursor" / "Mid-Point" /
 *                            "Distance[100]" / "Fraction[2]" / "Proportion[0.5]" /
 *                            "Intersection[1]") — in parentheses
 *   - trailing `Snap`      = `!!edgPosCntrl.intermediate` (Significant Snaps) is on
 * The pick **filter** (Any / Element / …) never appears in the prompt.
 */

/** `EDGPOSCNTRL.loadPicks` `picks[1..8]`, in E3D list order. */
export const MEASUREMENT_PICK_FILTER_IDS = [
  'any',
  'element',
  'aid',
  'pline',
  'ppoint',
  'screen',
  'graphics',
  'external',
] as const;

export type MeasurementPickFilterId = (typeof MEASUREMENT_PICK_FILTER_IDS)[number];

/** `EDGPICK.std*` descriptions. */
export const MEASUREMENT_PICK_FILTER_LABELS: Readonly<Record<MeasurementPickFilterId, string>> = {
  any: 'Any',
  element: 'Element',
  aid: 'Aid',
  pline: 'Pline',
  ppoint: 'Ppoint',
  screen: 'Screen',
  graphics: 'Graphics',
  external: 'External',
};

/** What each filter admits in E3D, for tooltips. */
export const MEASUREMENT_PICK_FILTER_HINTS: Readonly<Record<MeasurementPickFilterId, string>> = {
  any: '任意可拾取对象（E3D Any）',
  element: '元素显著点：Item 原点 / 基本体关键点；Cursor 类型下为元素表面点（E3D Element）',
  aid: '设计辅助线 / 面（E3D Aid）',
  pline: '型材 PLINE（E3D Pline）',
  ppoint: '目录 P-Point（E3D Ppoint）',
  screen: '屏幕位置 → 模型表面点（E3D Screen）',
  graphics: '网格边 / 面：光标附近的绘制边（相邻面夹角 ≥ 30° 或边界）吸成线，否则取光标下的面（E3D Graphics）',
  external: '外部几何 / 点云（E3D External）',
};

/** `EDGPOSCNTRL.loadPicks` `pickTypes[1..7]`, in E3D list order. */
export const MEASUREMENT_PICK_TYPE_IDS = [
  'snap',
  'distance',
  'midpoint',
  'fraction',
  'proportion',
  'intersect',
  'exact',
] as const;

export type MeasurementPickTypeId = (typeof MEASUREMENT_PICK_TYPE_IDS)[number];

/** `EDGPICKTYPE.description` after `set*` (Exact is listed as "Cursor"). */
export const MEASUREMENT_PICK_TYPE_LABELS: Readonly<Record<MeasurementPickTypeId, string>> = {
  snap: 'Snap',
  distance: 'Distance',
  midpoint: 'Mid-Point',
  fraction: 'Fraction',
  proportion: 'Proportion',
  intersect: 'Intersect',
  exact: 'Cursor',
};

export const MEASUREMENT_PICK_TYPE_HINTS: Readonly<Record<MeasurementPickTypeId, string>> = {
  snap: '吸到最近的显著点 / 线端（E3D Snap）',
  distance: '沿拾中线从近端走指定距离；P-Point 沿其方向偏移（E3D Distance）',
  midpoint: '拾中线的中点（E3D Mid-Point = Proportion 0.5）',
  fraction: '把拾中线等分 n 段，吸到最近的分点（E3D Fraction）',
  proportion: '从近端按比例取点（E3D Proportion）',
  intersect: '两次拾取的线 / 面交点：先选一条边 / PLINE / P-Point 轴或一个面，再选另一个，两个面要再选第三项（E3D Intersect）',
  exact: '光标下的精确位置（E3D Cursor）',
};

/** Which pick types carry an input value (`pickTypesInput[n]`). */
export const MEASUREMENT_PICK_TYPE_VALUE_KEY: Readonly<
  Partial<Record<MeasurementPickTypeId, keyof MeasurementPickTypeValues>>
> = {
  distance: 'distanceMm',
  fraction: 'fraction',
  proportion: 'proportion',
};

/** `pickTypesValue[2|4|5]`; Distance is kept in mm like the E3D `!!distanceFmt` gadget. */
export type MeasurementPickTypeValues = Readonly<{
  distanceMm: number;
  fraction: number;
  proportion: number;
}>;

export const DEFAULT_MEASUREMENT_PICK_TYPE_VALUES: MeasurementPickTypeValues = {
  distanceMm: 0,
  fraction: 2,
  proportion: 0.5,
};

/**
 * Availability of each filter / type in the Web today. `placeholder` entries
 * are shown greyed out with the reason (plan 2026-09-12 Phase A: Aid /
 * External are parked; Graphics waits for the mesh-derived provider; Intersect
 * waits for the two-pick flow).
 */
export type MeasurementPickAvailability =
  | Readonly<{ available: true }>
  | Readonly<{ available: false; reason: string }>;

export const MEASUREMENT_PICK_FILTER_AVAILABILITY: Readonly<
  Record<MeasurementPickFilterId, MeasurementPickAvailability>
> = {
  any: { available: true },
  element: { available: true },
  aid: { available: false, reason: 'Web 暂无设计辅助（Aid）系统，见方案 §7 Q3' },
  pline: { available: true },
  ppoint: { available: true },
  screen: { available: true },
  graphics: { available: true },
  external: { available: false, reason: '外部几何拾取不在本期范围' },
};

export const MEASUREMENT_PICK_TYPE_AVAILABILITY: Readonly<
  Record<MeasurementPickTypeId, MeasurementPickAvailability>
> = {
  snap: { available: true },
  distance: { available: true },
  midpoint: { available: true },
  fraction: { available: true },
  proportion: { available: true },
  intersect: { available: true },
  exact: { available: true },
};

export type MeasurementPickLayerConfig = Readonly<{
  filter: MeasurementPickFilterId;
  pickType: MeasurementPickTypeId;
  values: MeasurementPickTypeValues;
  /** `!!edgPosCntrl.intermediate` — E3D default true. */
  significantSnaps: boolean;
}>;

/**
 * E3D defaults: Measure's `stdPosition` pick is `Any`; `pickTypeIndex = 1` (Snap);
 * `intermediate = true`.
 */
export const DEFAULT_MEASUREMENT_PICK_LAYER: MeasurementPickLayerConfig = {
  filter: 'any',
  pickType: 'snap',
  values: DEFAULT_MEASUREMENT_PICK_TYPE_VALUES,
  significantSnaps: true,
};

function isFilterId(value: unknown): value is MeasurementPickFilterId {
  return typeof value === 'string' && (MEASUREMENT_PICK_FILTER_IDS as readonly string[]).includes(value);
}

function isPickTypeId(value: unknown): value is MeasurementPickTypeId {
  return typeof value === 'string' && (MEASUREMENT_PICK_TYPE_IDS as readonly string[]).includes(value);
}

function finiteOr(raw: unknown, fallback: number): number {
  const parsed = typeof raw === 'string' && raw.trim() === '' ? Number.NaN : Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Normalise pick-type values: Fraction is an integer ≥ 1 (E3D `!!integerFmt`, `REAL.int()`). */
export function normalizeMeasurementPickTypeValues(
  raw: Partial<Record<keyof MeasurementPickTypeValues, unknown>> | null | undefined,
): MeasurementPickTypeValues {
  const distanceMm = finiteOr(raw?.distanceMm, DEFAULT_MEASUREMENT_PICK_TYPE_VALUES.distanceMm);
  const fraction = Math.max(1, Math.trunc(finiteOr(raw?.fraction, DEFAULT_MEASUREMENT_PICK_TYPE_VALUES.fraction)));
  const proportion = finiteOr(raw?.proportion, DEFAULT_MEASUREMENT_PICK_TYPE_VALUES.proportion);
  return { distanceMm, fraction, proportion };
}

/** Rebuild a config from persisted / untrusted input; unknown ids fall back to E3D defaults. */
export function normalizeMeasurementPickLayer(raw: unknown): MeasurementPickLayerConfig {
  const input = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const filter = isFilterId(input.filter) && MEASUREMENT_PICK_FILTER_AVAILABILITY[input.filter].available
    ? input.filter
    : DEFAULT_MEASUREMENT_PICK_LAYER.filter;
  const pickType = isPickTypeId(input.pickType) && MEASUREMENT_PICK_TYPE_AVAILABILITY[input.pickType].available
    ? input.pickType
    : DEFAULT_MEASUREMENT_PICK_LAYER.pickType;
  return {
    filter,
    pickType,
    values: normalizeMeasurementPickTypeValues(
      input.values as Partial<Record<keyof MeasurementPickTypeValues, unknown>> | undefined,
    ),
    significantSnaps: typeof input.significantSnaps === 'boolean'
      ? input.significantSnaps
      : DEFAULT_MEASUREMENT_PICK_LAYER.significantSnaps,
  };
}

/** PML `REAL.string()`-like rendering for the prompt token (no trailing zeros). */
function formatPromptReal(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return Number(value.toFixed(6)).toString();
}

/**
 * `pick.prompt` set by `EDGPICKTYPE.set*` — the parenthesised token of the E3D prompt.
 * `Intersection[n]` carries the pick ordinal (`!this.minor`); pass `intersectPickIndex`.
 */
export function measurementPickTypePromptToken(
  pickType: MeasurementPickTypeId,
  values: MeasurementPickTypeValues = DEFAULT_MEASUREMENT_PICK_TYPE_VALUES,
  intersectPickIndex = 1,
): string {
  switch (pickType) {
    case 'snap':
      return 'Snap';
    case 'exact':
      return 'Cursor';
    case 'midpoint':
      return 'Mid-Point';
    case 'distance':
      return `Distance[${formatPromptReal(values.distanceMm)}]`;
    case 'fraction':
      return `Fraction[${Math.max(1, Math.trunc(values.fraction))}]`;
    case 'proportion':
      return `Proportion[${formatPromptReal(values.proportion)}]`;
    case 'intersect':
      return `Intersection[${intersectPickIndex}]`;
    default:
      return 'Snap';
  }
}

export type MeasurementPromptInput = Readonly<{
  /** Command title, e.g. `距离测量` (E3D `Measure distance`). */
  command: string;
  /** Step ordinal / total / hint, e.g. `第 2/2 步 选择终点` (E3D `end`). */
  stepIndex: number;
  stepTotal: number;
  stepHint?: string | null;
  /** Parenthesised pick type token (`measurementPickTypePromptToken`). */
  pickTypeToken: string;
  /** Appends the E3D `Snap` flag when Significant Snaps is on. */
  significantSnaps: boolean;
  /** Current snap target text (E3D shows the picked element after the colon). */
  target?: string | null;
  /** Web-only trailer such as `；点空白取消当前点选`. */
  trailer?: string | null;
}>;

/**
 * Web rendering of `EDGSTATE.prompt()`:
 * `距离测量 · 第 2/2 步 选择终点 (Mid-Point) Snap : ELBO P-Point #1；点空白取消当前点选`.
 */
export function formatMeasurementPrompt(input: MeasurementPromptInput): string {
  const step = [`第 ${input.stepIndex}/${input.stepTotal} 步`, input.stepHint?.trim()]
    .filter((part): part is string => Boolean(part))
    .join(' ');
  const flags = input.significantSnaps ? ' Snap' : '';
  const target = input.target?.trim() ? ` ${input.target.trim()}` : '';
  return `${input.command} · ${step} (${input.pickTypeToken})${flags} :${target}${input.trailer ?? ''}`;
}

/**
 * Feature class of a pick candidate — the E3D `EDGPOSITIONDATA.type` the filter
 * tests against (`PPOINT` / `PLINE` / `ELEMENT` / `GRAPHICS` / `DESIGNAID` / `3D_LINE`).
 */
export type MeasurementPickFeature =
  | 'ppoint'
  | 'pline'
  | 'element'
  | 'surface'
  | 'graphics-line'
  | 'graphics-plane'
  | 'aid'
  | 'external';

/**
 * Whether the active filter × pick type lets a candidate of `feature` be picked.
 *
 * - `Any` is E3D `EDGPICK.stdAny` — "Standard pick interpreter for **Element,
 *   Ppoint or Pline**" (`inMode = 'pany'`). It does **not** pick detail graphics
 *   (facet edges / facets need `stdGraphics`, `inMode = 'pickdetail'`), aids
 *   (`stdAid`) or external geometry (`stdExternal`). The Web surface point is
 *   admitted under `Any` as well: it is the Web stand-in for E3D's element pick
 *   when no significant point is near (free-surface mode) and for `Element` +
 *   `Cursor` (`edgTypes.attribute(noun).exact()`, the exact point on the element).
 * - `Element` + `Cursor` admits the surface point for the same reason, and only there.
 */
export function measurementPickFilterAdmits(
  filter: MeasurementPickFilterId,
  pickType: MeasurementPickTypeId,
  feature: MeasurementPickFeature,
): boolean {
  switch (filter) {
    case 'any':
      return feature === 'element' || feature === 'ppoint' || feature === 'pline' || feature === 'surface';
    case 'element':
      return feature === 'element' || (feature === 'surface' && pickType === 'exact');
    case 'ppoint':
      return feature === 'ppoint';
    case 'pline':
      return feature === 'pline';
    case 'graphics':
      return feature === 'graphics-line' || feature === 'graphics-plane';
    case 'screen':
      return feature === 'surface';
    case 'aid':
      return feature === 'aid';
    case 'external':
      return feature === 'external';
    default:
      return false;
  }
}
