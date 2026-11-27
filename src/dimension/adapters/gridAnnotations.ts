import type { ExternalDimensionRecord } from './normalizeExternalDimensions';
import type { Vec3 } from '../kernel/types';

/**
 * 结构网格自动标注（#78）。只读 external source，不进用户尺寸文档。
 * 哪根轴、偏多少是工程默认，#70 的 GRID 金样回来后只改这张表。
 */
export const GRID_ANNOTATION_TOLERANCES = Object.freeze({
  /** 平面法向与视线点积低于它就当侧看，不画 GRIDPL。0.2 约等于离正视 78°。 */
  minFaceOn: 0.2,
  minAxisLengthM: 1e-6,
  minRadiusM: 1e-6,
  offsetM: 0.15,
});

export type GridAnnotationView = Readonly<{
  /** 设计系视线，任意非零长度。 */
  forward: Vec3;
}>;

export type GridPlanePrimitive = Readonly<{
  id: string;
  noun: 'GRIDPL';
  origin: Vec3;
  axisU: Vec3;
  axisV: Vec3;
}>;

export type GridCylinderPrimitive = Readonly<{
  id: string;
  noun: 'GRIDCY';
  origin: Vec3;
  axis: Vec3;
  radiusM: number;
}>;

export type GridDrawPrimitive =
  | GridPlanePrimitive
  | GridCylinderPrimitive
  | Readonly<{ id: string; noun: string }>;

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function length(vector: Vec3): number {
  return Math.hypot(vector[0], vector[1], vector[2]);
}

function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function scale(vector: Vec3, factor: number): Vec3 {
  return [vector[0] * factor, vector[1] * factor, vector[2] * factor];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function unit(vector: Vec3): Vec3 | null {
  const vectorLength = length(vector);
  if (vectorLength <= GRID_ANNOTATION_TOLERANCES.minAxisLengthM) return null;
  return scale(vector, 1 / vectorLength);
}

function isPlane(item: GridDrawPrimitive): item is GridPlanePrimitive {
  return item.noun === 'GRIDPL'
    && 'origin' in item
    && 'axisU' in item
    && 'axisV' in item;
}

function isCylinder(item: GridDrawPrimitive): item is GridCylinderPrimitive {
  return item.noun === 'GRIDCY'
    && 'origin' in item
    && 'axis' in item
    && 'radiusM' in item;
}

/** 只留下受支持、几何有效的网格，并按 id 排序，绘制列表的顺序不影响结果。 */
export function collectSupportedGrids(
  drawList: readonly GridDrawPrimitive[],
): readonly (GridPlanePrimitive | GridCylinderPrimitive)[] {
  return drawList.filter((item): item is GridPlanePrimitive | GridCylinderPrimitive => {
    if (isPlane(item)) {
      return length(item.axisU) > GRID_ANNOTATION_TOLERANCES.minAxisLengthM
        && length(item.axisV) > GRID_ANNOTATION_TOLERANCES.minAxisLengthM
        && length(cross(item.axisU, item.axisV)) > GRID_ANNOTATION_TOLERANCES.minAxisLengthM;
    }
    return isCylinder(item) && item.radiusM > GRID_ANNOTATION_TOLERANCES.minRadiusM && length(item.axis) > GRID_ANNOTATION_TOLERANCES.minAxisLengthM;
  }).sort((left, right) => left.id.localeCompare(right.id));
}

function perpendicularTo(direction: Vec3, hint: Vec3): Vec3 | null {
  const along = unit(direction);
  const guide = unit(hint);
  if (!along || !guide) return null;
  const rejected = [
    guide[0] - along[0] * dot(guide, along),
    guide[1] - along[1] * dot(guide, along),
    guide[2] - along[2] * dot(guide, along),
  ] as const;
  return unit(rejected) ?? unit(cross(along, Math.abs(along[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]));
}

function planeRecord(grid: GridPlanePrimitive, forward: Vec3): ExternalDimensionRecord | null {
  const normal = unit(cross(grid.axisU, grid.axisV));
  const view = unit(forward);
  if (!normal || !view || Math.abs(dot(normal, view)) < GRID_ANNOTATION_TOLERANCES.minFaceOn) {
    return null;
  }
  const measured = Math.abs(dot(unit(grid.axisU) ?? grid.axisU, view))
    <= Math.abs(dot(unit(grid.axisV) ?? grid.axisV, view))
    ? grid.axisU
    : grid.axisV;
  const id = `grid:${grid.id}`;
  return {
    id,
    source: 'grid',
    sourceLabel: 'GRIDPL',
    role: 'external',
    category: 'dimension',
    layoutAuthority: 'solver',
    layout: {
      id,
      kind: 'linear',
      role: 'external',
      labelPinned: true,
      a: grid.origin,
      b: add(grid.origin, measured),
      placement: {
        offsetM: GRID_ANNOTATION_TOLERANCES.offsetM,
        labelT: 0.5,
        side: dot(cross(measured, normal), view) >= 0 ? 1 : -1,
      },
    },
  };
}

function cylinderRecord(grid: GridCylinderPrimitive, forward: Vec3): ExternalDimensionRecord | null {
  const radial = perpendicularTo(grid.axis, forward);
  if (!radial) return null;
  const id = `grid:${grid.id}`;
  return {
    id,
    source: 'grid',
    sourceLabel: 'GRIDCY',
    role: 'external',
    category: 'dimension',
    layoutAuthority: 'solver',
    layout: {
      id,
      kind: 'radial',
      role: 'external',
      labelPinned: true,
      center: grid.origin,
      rim: add(grid.origin, scale(radial, grid.radiusM)),
      normal: grid.axis,
      display: 'radius',
      placement: {
        leaderDirection: radial,
        labelDistanceM: GRID_ANNOTATION_TOLERANCES.offsetM,
      },
    },
  };
}

/** 纯函数：同一绘制列表和同一视线得到同一批记录。侧看的平面网格不产生记录。 */
export function layoutGridAnnotations(
  grids: readonly (GridPlanePrimitive | GridCylinderPrimitive)[],
  view: GridAnnotationView,
): readonly ExternalDimensionRecord[] {
  const records: ExternalDimensionRecord[] = [];
  for (const grid of grids) {
    const record = grid.noun === 'GRIDPL'
      ? planeRecord(grid, view.forward)
      : cylinderRecord(grid, view.forward);
    if (record) records.push(record);
  }
  return records;
}

/**
 * 绘制列表或视线变化时整批替换 `grid` 来源。清空绘制列表会把该来源的记录全部撤下。
 *
 * 只在记录变了的时候发布（#197）。`setView` 在相机变化的每一帧都会被调到，而注册表每发布一次，
 * 视口就把全部外部记录重新规范化、再做一次全量重排——相机运动的重排节流管不到这种失效。
 * 所以没有网格可画、此前也没发布过的时候什么都不做；有网格时算出来的记录与上次发布的相同也不重发。
 *
 * 还没管住的一种：GRIDCY 的半径引线跟着视线连续变化，视线每变一帧记录都不同，照样每帧重发。
 * 宿主开始喂 `setDrawList` 之前，要先把这个来源并进相机重排的节流。
 */
export class GridAnnotationSource {
  private supported: ReturnType<typeof collectSupportedGrids> = [];
  private view: GridAnnotationView | null = null;
  /** 上次发布出去的记录的序列化结果；空串表示该来源此刻没有记录。 */
  private published = '';

  constructor(private readonly publish: (records: readonly ExternalDimensionRecord[]) => void) {}

  setDrawList(drawList: readonly GridDrawPrimitive[]): void {
    this.supported = collectSupportedGrids(drawList);
    this.rebuild();
  }

  setView(view: GridAnnotationView | null): void {
    this.view = view;
    this.rebuild();
  }

  clear(): void {
    this.supported = [];
    this.rebuild();
  }

  private rebuild(): void {
    const records = this.view && this.supported.length > 0
      ? layoutGridAnnotations(this.supported, this.view)
      : [];
    const next = records.length > 0 ? JSON.stringify(records) : '';
    if (next === this.published) return;
    this.publish(records);
    this.published = next;
  }
}
