/**
 * 云线空间范围体 → 屏幕云线的纯函数入口——2026-09-14 方案 §3.3 管线（P2）。
 *
 * ```
 * regionV1（世界凸单元集合）
 *   → [可选] G_new · G_old⁻¹ 重映射（§8 补充 1）
 *   → 每单元先裁深度（w ≥ ε、近、远）+ 截面封口（clip4）
 *   → 透视除法 → 全部单元的屏幕点求凸包（hull2d）
 *   → 与视口求交得可见部分 + 边界来源（状态机）
 *   → Minkowski 圆角外扩 padding（roundedPath）
 *   → 特征锚定相位 + 收口区 → 单侧余弦波纹 → 屏幕折线片段（wave）
 * ```
 *
 * 核心边界：「有范围但被裁剪 / 出屏」与「没有可用范围」是两种状态。前者（`viewport-cut / offscreen / depth-empty`）
 * **绝不**回退旧固定布局；只有 `missing-region`（记录没有可用范围 / 校验不过）才允许走旧布局。
 *
 * 无 DOM / three 依赖；矩阵与视口由调用方传入（three.js 列主序 16 数、CSS 像素）。
 */

import {
  BOX_CORNER_BITS,
  BOX_EDGES,
  boxCellFromCorners,
  clipConvexSolid4,
  depthPlanes,
  isOutsideAnyPlane,
  mul4,
  toClipSolid,
  transformWorldCell,
  type Mat4,
  type V3,
  type WorldCell,
  type WorldVertex,
} from './clip4';
import { boundsOf, convexHull2d, intersectHullWithRect, signedArea, type P2, type Rect } from './hull2d';
import { buildRoundedConvexPath, roundedPathBounds, roundedPathPolygon, type RoundedPath } from './roundedPath';
import { buildVisibleCloudPolylines, continuingBoundaryPair, transportCloudPhase, type PhaseFrame, type PhasePrevious } from './wave';

import type { ConvexCell, ObbSnapshot, RegionV1 } from '../cloudRegion';

export type Viewport = { width: number; height: number };

// ---------------------------------------------------------------------------
// 记录 → 世界凸单元
// ---------------------------------------------------------------------------

/** 数量预算：超过不交给几何执行器（§6.4「不能通过截掉成员或顶点来修复记录」——整条记录判不可用） */
export const REGION_MAX_CELLS = 256;
export const REGION_MAX_CELL_VERTICES = 64;
export const REGION_MAX_CELL_FACES = 64;

const isFiniteV3 = (v: unknown): v is V3 =>
  Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n));

/** OBB 轴必须单位化且相互正交（容差 1e-3）；不满足的记录不是「修一下」而是不可用 */
export function hasOrthonormalAxes(axes: readonly [V3, V3, V3], eps = 1e-3): boolean {
  for (let i = 0; i < 3; i++) {
    const a = axes[i]!;
    if (Math.abs(Math.hypot(a[0], a[1], a[2]) - 1) > eps) return false;
    for (let j = i + 1; j < 3; j++) {
      const b = axes[j]!;
      if (Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) > eps) return false;
    }
  }
  return true;
}

export type RegionValidation =
  | { ok: true; cells: WorldCell[] }
  | { ok: false; reason: string };

function validateObb(box: ObbSnapshot, index: number): string | null {
  if (typeof box.id !== 'string' || !box.id) return `boxes[${index}].id`;
  if (!isFiniteV3(box.center) || !isFiniteV3(box.halfSize)) return `boxes[${index}] center/halfSize`;
  if (box.halfSize.some((h) => h < 0)) return `boxes[${index}].halfSize < 0`;
  if (!Array.isArray(box.axes) || box.axes.length !== 3 || !box.axes.every(isFiniteV3)) return `boxes[${index}].axes`;
  if (!hasOrthonormalAxes(box.axes)) return `boxes[${index}].axes not orthonormal`;
  return null;
}

function validateCell(cell: ConvexCell, label: string): string | null {
  if (typeof cell.id !== 'string' || !cell.id) return `${label}.id`;
  if (!Array.isArray(cell.vertices) || cell.vertices.length < 4 || cell.vertices.length > REGION_MAX_CELL_VERTICES) return `${label}.vertices`;
  if (!cell.vertices.every(isFiniteV3)) return `${label}.vertices non-finite`;
  if (!Array.isArray(cell.faces) || cell.faces.length < 4 || cell.faces.length > REGION_MAX_CELL_FACES) return `${label}.faces`;
  for (const face of cell.faces) {
    if (!Array.isArray(face) || face.length < 3) return `${label}.faces degenerate`;
    if (!face.every((i) => Number.isInteger(i) && i >= 0 && i < cell.vertices.length)) return `${label}.faces index`;
  }
  return null;
}

/** OBB 的 8 个世界角点（按 `BOX_CORNER_BITS` 位序：bit 0 = −half，1 = +half） */
export function obbSnapshotCorners(box: ObbSnapshot): V3[] {
  const [ax, ay, az] = box.axes;
  return BOX_CORNER_BITS.map((b) => {
    const sx = (b[0] ? 1 : -1) * box.halfSize[0];
    const sy = (b[1] ? 1 : -1) * box.halfSize[1];
    const sz = (b[2] ? 1 : -1) * box.halfSize[2];
    return [
      box.center[0] + ax[0] * sx + ay[0] * sy + az[0] * sz,
      box.center[1] + ax[1] * sx + ay[1] * sy + az[1] * sz,
      box.center[2] + ax[2] * sx + ay[2] * sy + az[2] * sz,
    ];
  });
}

/** OBB 12 条边的世界端点对（bbox3d 真实盒边，§4.7） */
export function obbSnapshotEdges(box: ObbSnapshot): [V3, V3][] {
  const corners = obbSnapshotCorners(box);
  return BOX_EDGES.map(([a, b]) => [corners[a]!, corners[b]!]);
}

export function convexCellToWorldCell(cell: ConvexCell): WorldVertex[][] {
  const vertices = cell.vertices.map((p, i) => ({ id: `src:${cell.id}:${i}`, p }));
  return cell.faces.map((f) => f.map((i) => vertices[i]!));
}

/**
 * 校验并展开 `regionV1` 为世界凸单元。未知版本 / 形状 / 非法数值一律 `ok:false`，原记录原样保留但不交给几何执行器。
 * `remap`（G_new · G_old⁻¹）可选：记录来源矩阵与当前不等时先重映射到当前世界系。
 */
export function regionToWorldCells(region: RegionV1 | null | undefined, remap?: Mat4 | null): RegionValidation {
  if (!region || typeof region !== 'object') return { ok: false, reason: 'missing' };
  if (region.version !== 1 || region.space !== 'world') return { ok: false, reason: 'unknown version/space' };
  let cells: WorldCell[];
  switch (region.kind) {
    case 'obb-union': {
      if (!Array.isArray(region.boxes) || region.boxes.length === 0) return { ok: false, reason: 'boxes empty' };
      if (region.boxes.length > REGION_MAX_CELLS) return { ok: false, reason: 'boxes over budget' };
      for (let i = 0; i < region.boxes.length; i++) {
        const err = validateObb(region.boxes[i]!, i);
        if (err) return { ok: false, reason: err };
      }
      cells = region.boxes.map((box) => boxCellFromCorners(obbSnapshotCorners(box), box.id));
      break;
    }
    case 'hull': {
      const err = validateCell(region.hull, 'hull');
      if (err) return { ok: false, reason: err };
      cells = [convexCellToWorldCell(region.hull)];
      break;
    }
    case 'lasso-prism': {
      if (!Array.isArray(region.cells) || region.cells.length === 0) return { ok: false, reason: 'cells empty' };
      if (region.cells.length > REGION_MAX_CELLS) return { ok: false, reason: 'cells over budget' };
      for (let i = 0; i < region.cells.length; i++) {
        const err = validateCell(region.cells[i]!, `cells[${i}]`);
        if (err) return { ok: false, reason: err };
      }
      cells = region.cells.map(convexCellToWorldCell);
      break;
    }
    default:
      return { ok: false, reason: 'unknown kind' };
  }
  if (remap) {
    try {
      cells = cells.map((cell) => transformWorldCell(cell, remap));
    } catch {
      return { ok: false, reason: 'remap failed' };
    }
  }
  return { ok: true, cells };
}

// ---------------------------------------------------------------------------
// 创建时：局部盒 × 世界矩阵 → ObbSnapshot（§4.1 / §7 primitiveFromPlacement 的 OBB 分支）
// ---------------------------------------------------------------------------

/**
 * 由「几何局部盒 + 已含 global 的世界矩阵」构造 OBB 快照。
 * 三个列向量相互正交（刚体 + 保正交缩放）→ 真 OBB；含剪切 / 退化 → 退成 8 个变换角点的**单位轴 AABB**
 * （保守；`obb-union` 只装 OBB，剪切实例在 DTX 生产数据里不出现，这里只保证不漏包）。
 */
export function obbSnapshotFromLocalBoxAndMatrix(
  min: V3,
  max: V3,
  worldMatrix: Mat4,
  id: string,
  memberRefno: string | null,
): ObbSnapshot {
  if (worldMatrix.length !== 16) throw new Error('Matrix4 needs 16 values');
  const m = worldMatrix;
  const cols: V3[] = [[m[0]!, m[1]!, m[2]!], [m[4]!, m[5]!, m[6]!], [m[8]!, m[9]!, m[10]!]];
  const lens = cols.map((c) => Math.hypot(c[0], c[1], c[2]));
  const localCenter: V3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  const h = mul4(m, [localCenter[0], localCenter[1], localCenter[2], 1]);
  if (Math.abs(h[3]) < 1e-15) throw new Error('point at infinity');
  const center: V3 = [h[0] / h[3], h[1] / h[3], h[2] / h[3]];

  const affine = Math.abs(m[3]!) < 1e-12 && Math.abs(m[7]!) < 1e-12 && Math.abs(m[11]!) < 1e-12 && Math.abs(m[15]! - 1) < 1e-9;
  const nonDegenerate = lens.every((l) => l > 1e-12);
  let orthogonal = affine && nonDegenerate;
  if (orthogonal) {
    const axes = cols.map((c, i) => [c[0] / lens[i]!, c[1] / lens[i]!, c[2] / lens[i]!] as V3) as [V3, V3, V3];
    orthogonal = hasOrthonormalAxes(axes, 1e-6);
    if (orthogonal) {
      return {
        id,
        memberRefno,
        center,
        axes,
        halfSize: [
          (lens[0]! * (max[0] - min[0])) / 2,
          (lens[1]! * (max[1] - min[1])) / 2,
          (lens[2]! * (max[2] - min[2])) / 2,
        ],
      };
    }
  }
  // 剪切 / 退化：8 个变换角点的单位轴 AABB
  const corners = BOX_CORNER_BITS.map((b) => {
    const p = mul4(m, [b[0] ? max[0] : min[0], b[1] ? max[1] : min[1], b[2] ? max[2] : min[2], 1]);
    if (Math.abs(p[3]) < 1e-15) throw new Error('point at infinity');
    return [p[0] / p[3], p[1] / p[3], p[2] / p[3]] as V3;
  });
  const lo: [number, number, number] = [Infinity, Infinity, Infinity];
  const hi: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const c of corners) {
    for (let i = 0; i < 3; i++) {
      if (c[i]! < lo[i]!) lo[i] = c[i]!;
      if (c[i]! > hi[i]!) hi[i] = c[i]!;
    }
  }
  return {
    id,
    memberRefno,
    center: [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2],
    axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
    halfSize: [(hi[0] - lo[0]) / 2, (hi[1] - lo[1]) / 2, (hi[2] - lo[2]) / 2],
  };
}

// ---------------------------------------------------------------------------
// 投影
// ---------------------------------------------------------------------------

export type RegionProjection = {
  /** 深度裁剪 + 透视除法后全部单元屏幕点的凸包（CSS 像素，可越出视口） */
  rawHull: P2[];
  /** 与视口求交后的可见部分 */
  visibleHull: P2[];
  depthClipped: boolean;
  viewportCut: boolean;
  state: 'visible' | 'offscreen' | 'depth-empty';
};

function validViewport(v: Viewport): void {
  if (!(v.width > 0 && v.height > 0 && Number.isFinite(v.width + v.height))) throw new Error('invalid viewport');
}

/** 各单元先裁深度，透视除法后对**集合**求凸包，最后才与视口求交（不能先删掉出屏对象再求凸包） */
export function projectCloudRegion(
  cells: readonly WorldCell[],
  viewProjection: Mat4,
  viewport: Viewport,
  wEps = 1e-8,
  worldEps = 1e-8,
): RegionProjection {
  validViewport(viewport);
  if (!(wEps > 0 && worldEps > 0)) throw new Error('invalid epsilon');
  const points: P2[] = [];
  let depthClipped = false;
  const planes = depthPlanes(wEps);
  for (const cell of cells) {
    const solid = toClipSolid(cell, viewProjection);
    if (solid.some((f) => f.some((v) => isOutsideAnyPlane(v, planes)))) depthClipped = true;
    const clipped = clipConvexSolid4(solid, planes, worldEps);
    for (const face of clipped) {
      for (const v of face) {
        if (!(v.h[3] > 0)) throw new Error('clipper left nonpositive w');
        const x = v.h[0] / v.h[3];
        const y = v.h[1] / v.h[3];
        points.push({ id: v.id, x: ((x + 1) * viewport.width) / 2, y: ((1 - y) * viewport.height) / 2 });
      }
    }
  }
  const rawHull = convexHull2d(points);
  const r: Rect = { left: 0, top: 0, right: viewport.width, bottom: viewport.height };
  const visibleHull = intersectHullWithRect(rawHull, r);
  return {
    rawHull,
    visibleHull,
    depthClipped,
    viewportCut: rawHull.some((p) => p.x < 0 || p.y < 0 || p.x > r.right || p.y > r.bottom),
    state: !rawHull.length ? 'depth-empty' : !visibleHull.length ? 'offscreen' : 'visible',
  };
}

// ---------------------------------------------------------------------------
// 状态机与 LOD
// ---------------------------------------------------------------------------

export type CloudFitState = 'complete' | 'viewport-cut' | 'offscreen' | 'depth-empty' | 'missing-region';

export function chooseCloudFitPresentation(state: CloudFitState) {
  switch (state) {
    case 'complete': return 'contour' as const;
    case 'viewport-cut': return 'contour-and-cut-hints' as const;
    case 'offscreen': return 'edge-indicator' as const;
    case 'depth-empty': return 'depth-status-indicator' as const;
    case 'missing-region': return 'legacy-layout' as const;
  }
}

export type SmallTargetLod = 'cloud' | 'icon' | 'minimum-halo';

/** 极小投影：以**裁视口前**的最大边长判断——低于 12 px 进入图标、高于 18 px 退出（滞回）；不能只按面积 */
export function chooseSmallTargetLod(width: number, height: number, previous: 'cloud' | 'icon', active: boolean): SmallTargetLod {
  const extent = Math.max(width, height);
  const small = previous === 'icon' ? extent < 18 : extent < 12;
  return small ? (active ? 'minimum-halo' : 'icon') : 'cloud';
}

export const SMALL_TARGET_MIN_BOX_PX = Object.freeze({ width: 32, height: 24 });

// ---------------------------------------------------------------------------
// 一帧的完整纯函数渲染
// ---------------------------------------------------------------------------

export type CloudRegionRenderStyle = {
  paddingPx: number;
  wavelengthPx: number;
  amplitudePx: number;
  /** 采样步长（CSS px），只影响离散精度 */
  stepPx: number;
  /** 描边 + halo 总宽（视口外扩量），可见区间选择用 */
  haloWidthPx: number;
};

export const DEFAULT_CLOUD_REGION_RENDER_STYLE: Readonly<CloudRegionRenderStyle> = Object.freeze({
  paddingPx: 14,
  wavelengthPx: 52,
  amplitudePx: 4,
  stepPx: 2,
  haloWidthPx: 8.5,
});

export type CloudRegionRenderInput = {
  cells: readonly WorldCell[];
  /** projection × view（three: `camera.projectionMatrix × camera.matrixWorldInverse`） */
  viewProjection: Mat4;
  viewport: Viewport;
  style: CloudRegionRenderStyle;
  /** 上一帧的路径与相位框（相位锚定 / 交接） */
  previous?: PhasePrevious | null;
  previousLod?: 'cloud' | 'icon';
  /** 激活 / 选中的小目标用最小提示框而不是图标 */
  active?: boolean;
};

export type CloudRegionRenderResult = {
  state: CloudFitState;
  projection: RegionProjection;
  lod: SmallTargetLod;
  /** 圆角外扩后的路径（含 padding、未加波浪）；`offscreen / depth-empty / icon` 为 null */
  path: RoundedPath | null;
  phase: PhaseFrame | null;
  phaseHandover: boolean;
  /** 可见轮廓折线片段（CSS px，视口坐标）；整条可见时只有一条闭合折线 */
  polylines: P2[][];
  /** 加 padding、未加波浪的轮廓包围框 */
  referenceBounds: { x: number; y: number; width: number; height: number } | null;
  /** 闭合区域（供文字框重叠判断） */
  enclosure: { x: number; y: number }[];
};

/** 退化凸包（点 / 线段 / 极小）→ 以其包围框中心为中心、至少 `minWidth × minHeight` 的矩形四角 */
function inflateDegenerateHull(points: readonly P2[], minWidth: number, minHeight: number): P2[] {
  const b = boundsOf(points);
  if (!b) return [];
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  const hw = Math.max(b.maxX - b.minX, minWidth) / 2;
  const hh = Math.max(b.maxY - b.minY, minHeight) / 2;
  return [
    { id: 'deg:0', x: cx - hw, y: cy - hh },
    { id: 'deg:1', x: cx + hw, y: cy - hh },
    { id: 'deg:2', x: cx + hw, y: cy + hh },
    { id: 'deg:3', x: cx - hw, y: cy + hh },
  ];
}

/**
 * 一帧：范围体 → 屏幕云线折线 + 文字框参考框。相机静止时调用方不该再调（脏标记门控在适配层）。
 * `state`：
 * - `complete`：真实轮廓全部在视口内；
 * - `viewport-cut`：有范围、部分出屏，只画可见片段，不伪造闭合；
 * - `offscreen`：有范围但全部在视口外（不画轮廓、不回退旧布局）；
 * - `depth-empty`：有范围但全部落在有效深度之外（同上）。
 * `missing-region` 不在这里产生——那是记录层面（校验不过）的状态，由 `regionToWorldCells` 给。
 */
export function renderCloudRegion(input: CloudRegionRenderInput): CloudRegionRenderResult {
  const { cells, viewProjection, viewport, style } = input;
  const projection = projectCloudRegion(cells, viewProjection, viewport);
  const empty = (state: CloudFitState, lod: SmallTargetLod = 'cloud'): CloudRegionRenderResult => ({
    state,
    projection,
    lod,
    path: null,
    phase: null,
    phaseHandover: false,
    polylines: [],
    referenceBounds: null,
    enclosure: [],
  });
  if (projection.state === 'depth-empty') return empty('depth-empty');
  if (projection.state === 'offscreen') return empty('offscreen');

  // 极小投影按裁视口前的最大边长判（滞回）
  const rawBounds = boundsOf(projection.rawHull)!;
  const rawW = rawBounds.maxX - rawBounds.minX;
  const rawH = rawBounds.maxY - rawBounds.minY;
  const lod = chooseSmallTargetLod(rawW, rawH, input.previousLod ?? 'cloud', input.active === true);
  if (lod === 'icon') return empty(projection.viewportCut ? 'viewport-cut' : 'complete', 'icon');

  let hullInput: readonly P2[] = projection.rawHull;
  if (lod === 'minimum-halo') {
    hullInput = inflateDegenerateHull(projection.rawHull, SMALL_TARGET_MIN_BOX_PX.width, SMALL_TARGET_MIN_BOX_PX.height);
  } else if (projection.rawHull.length < 3 || signedArea(projection.rawHull) <= 1e-9) {
    // 点 / 线段退化（目标侧视成线）：给 2 px 厚度让 Minkowski 外扩成胶囊
    hullInput = inflateDegenerateHull(projection.rawHull, 2, 2);
  }
  const path = buildRoundedConvexPath(hullInput, style.paddingPx);

  let fallback = null;
  if (input.previous && !Object.keys(path.features).some((id) => input.previous!.path.features[id] !== undefined)) {
    fallback = continuingBoundaryPair(input.previous, path);
  }
  const { frame, handover } = transportCloudPhase(path, style.wavelengthPx, input.previous ?? null, fallback);

  const viewportRect: Rect = { left: 0, top: 0, right: viewport.width, bottom: viewport.height };
  const polylines = buildVisibleCloudPolylines(path, frame, viewportRect, style.amplitudePx, style.stepPx, style.haloWidthPx);
  const pb = roundedPathBounds(path);
  return {
    state: projection.viewportCut ? 'viewport-cut' : 'complete',
    projection,
    lod,
    path,
    phase: frame,
    phaseHandover: handover,
    polylines,
    referenceBounds: { x: pb.minX, y: pb.minY, width: pb.maxX - pb.minX, height: pb.maxY - pb.minY },
    enclosure: roundedPathPolygon(path),
  };
}

// ---------------------------------------------------------------------------
// 像素 ↔ 世界
// ---------------------------------------------------------------------------

/** 直接读投影矩阵（已含 zoom）：透视 `2d / (|P00| W)`（d 是视空间深度），正交与深度无关 */
export function worldPerPixelFromProjection(
  kind: 'perspective' | 'orthographic',
  projection: Mat4,
  viewport: Viewport,
  viewDepth: number,
): { x: number; y: number } {
  validViewport(viewport);
  const d = kind === 'perspective' ? viewDepth : 1;
  const p00 = Math.abs(projection[0]!);
  const p11 = Math.abs(projection[5]!);
  if (!(d > 0 && p00 > 0 && p11 > 0)) throw new Error('invalid projection/depth');
  return { x: (2 * d) / (p00 * viewport.width), y: (2 * d) / (p11 * viewport.height) };
}

/** 屏幕折线统一反投影到固定 ndcZ 的 billboard 平面（`ndcZ` 只决定置顶装饰线放哪，不定义世界范围） */
export function liftScreenPolylineToBillboard(
  points: readonly { x: number; y: number }[],
  inverseViewProjection: Mat4,
  viewport: Viewport,
  ndcZ = 0,
): number[] {
  validViewport(viewport);
  if (!(ndcZ > -1 && ndcZ < 1)) throw new Error('overlay depth must be strictly inside clip interval');
  const out: number[] = [];
  for (const p of points) {
    const q = mul4(inverseViewProjection, [(2 * p.x) / viewport.width - 1, 1 - (2 * p.y) / viewport.height, ndcZ, 1]);
    if (Math.abs(q[3]) < 1e-15) throw new Error('invalid unprojection');
    out.push(q[0] / q[3], q[1] / q[3], q[2] / q[3]);
  }
  return out;
}

/** 世界点 → CSS 像素（不裁剪；w ≤ 0 返回 null） */
export function projectWorldPoint(p: V3, viewProjection: Mat4, viewport: Viewport): { x: number; y: number; ndcZ: number } | null {
  const h = mul4(viewProjection, [p[0], p[1], p[2], 1]);
  if (!(h[3] > 1e-12)) return null;
  return { x: ((h[0] / h[3] + 1) * viewport.width) / 2, y: ((1 - h[1] / h[3]) * viewport.height) / 2, ndcZ: h[2] / h[3] };
}

/** 16 元素矩阵是否逐元素相等（容差） */
export function matricesEqual(a: Mat4 | null | undefined, b: Mat4 | null | undefined, eps = 1e-9): boolean {
  if (!a || !b || a.length !== 16 || b.length !== 16) return false;
  for (let i = 0; i < 16; i++) if (Math.abs(a[i]! - b[i]!) > eps) return false;
  return true;
}
