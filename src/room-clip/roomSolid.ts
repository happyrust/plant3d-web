/**
 * 房间闭合体与直段轴线区间裁剪（1:1 移植自 `plant-ui/crates/plant-room/src/solid.rs`，ADR-0029）。
 */
import {
  type AabbMm,
  type PanelTriMesh,
  type Vec3Mm,
  aabbsOverlap,
  pointInsidePanel,
  rayHitTriangle,
} from './predicate';

/** 最短保留段长度与共面缝合并阈值（1.0 mm）。 */
export const MIN_PIECE_MM = 1.0;

/** 线段参数去重容差。 */
const PARAM_DEDUP_EPS = 1e-6;

/** 线段内部交点开区间边界容差。 */
const SEGMENT_INTERIOR_EPS = 1e-7;

export class RoomSolid {
  readonly panels: readonly PanelTriMesh[];
  readonly bounds: AabbMm;

  private constructor(panels: PanelTriMesh[], bounds: AabbMm) {
    this.panels = panels;
    this.bounds = bounds;
  }

  /** 由一间房的全部在册面板三角网构建 `RoomSolid`；无有效面板时返回 `null`。 */
  static fromPanels(panels: PanelTriMesh[]): RoomSolid | null {
    if (panels.length === 0) return null;
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;

    for (const panel of panels) {
      if (panel.aabb.min[0] < minX) minX = panel.aabb.min[0];
      if (panel.aabb.min[1] < minY) minY = panel.aabb.min[1];
      if (panel.aabb.min[2] < minZ) minZ = panel.aabb.min[2];
      if (panel.aabb.max[0] > maxX) maxX = panel.aabb.max[0];
      if (panel.aabb.max[1] > maxY) maxY = panel.aabb.max[1];
      if (panel.aabb.max[2] > maxZ) maxZ = panel.aabb.max[2];
    }

    return new RoomSolid(panels, {
      min: [minX, minY, minZ],
      max: [maxX, maxY, maxZ],
    });
  }

  /**
   * 轴线段 `a -> b`（世界毫米）落在房间体内的参数区间列表 `[t0, t1] ⊂ [0, 1]`（升序、不重叠）。
   * - `[]`：整段在房间外；
   * - `[[0, 1]]`：整段在房间内；
   * - 其余：被墙截断后的 1 段或多段（凹房间/L 形房间可出现多段）。
   */
  insideIntervals(a: Vec3Mm, b: Vec3Mm): [number, number][] {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const dz = b[2] - a[2];
    const length = Math.hypot(dx, dy, dz);
    if (length <= MIN_PIECE_MM) return [];

    const segBox: AabbMm = {
      min: [
        Math.min(a[0], b[0]) - 1e-6,
        Math.min(a[1], b[1]) - 1e-6,
        Math.min(a[2], b[2]) - 1e-6,
      ],
      max: [
        Math.max(a[0], b[0]) + 1e-6,
        Math.max(a[1], b[1]) + 1e-6,
        Math.max(a[2], b[2]) + 1e-6,
      ],
    };

    if (!aabbsOverlap(segBox, this.bounds)) return [];

    const raw: [number, number][] = [];
    for (const panel of this.panels) {
      if (!aabbsOverlap(segBox, panel.aabb)) continue;
      const cuts = [0.0, 1.0];
      collectSegmentCuts(panel, a, [dx, dy, dz], segBox, cuts);
      cuts.sort((x, y) => x - y);

      // 参数去重
      const deduped: number[] = [cuts[0]!];
      for (let i = 1; i < cuts.length; i++) {
        if (cuts[i]! - deduped[deduped.length - 1]! >= PARAM_DEDUP_EPS) {
          deduped.push(cuts[i]!);
        }
      }

      for (let i = 0; i + 1 < deduped.length; i++) {
        const t0 = deduped[i]!;
        const t1 = deduped[i + 1]!;
        if ((t1 - t0) * length < 1e-4) continue;
        const tm = 0.5 * (t0 + t1);
        const mid: Vec3Mm = [a[0] + dx * tm, a[1] + dy * tm, a[2] + dz * tm];
        if (pointInsidePanel(panel, mid)) {
          raw.push([t0, t1]);
        }
      }
    }

    return mergeIntervals(raw, length);
  }
}

/** 收集线段 `origin + t * delta`（`t ∈ (0, 1)`）穿过面板三角网的所有参数 `t`。 */
function collectSegmentCuts(
  panel: PanelTriMesh,
  origin: Vec3Mm,
  delta: Vec3Mm,
  segBox: AabbMm,
  cuts: number[],
): void {
  for (let i = 0; i < panel.indices.length; i++) {
    const triBox = panel.triAabbs[i]!;
    if (!aabbsOverlap(segBox, triBox)) continue;
    const [ia, ib, ic] = panel.indices[i]!;
    // 直接传 delta 作方向向量，求出的 t 即线段归一化参数 t ∈ [0, 1]
    const t = rayHitTriangle(
      origin,
      delta,
      panel.vertices[ia]!,
      panel.vertices[ib]!,
      panel.vertices[ic]!,
      SEGMENT_INTERIOR_EPS,
    );
    if (t !== null && t < 1.0 - SEGMENT_INTERIOR_EPS) {
      cuts.push(t);
    }
  }
}

/**
 * 合并各面板产出的内部区间：
 * 1. 距 0 或 1 不足 1 mm 的截点吸附到端点（消除贴墙浮点毛刺）；
 * 2. 间隔 <= 1 mm 的相邻区间合并（消除同房多块面板共面隔墙处的假断口）；
 * 3. 丢弃短于 1 mm 的碎段。
 */
export function mergeIntervals(
  intervals: [number, number][],
  lengthMm: number,
): [number, number][] {
  if (intervals.length === 0 || lengthMm <= MIN_PIECE_MM) return [];

  const minDt = MIN_PIECE_MM / lengthMm;
  const sorted = intervals
    .map(([a, b]): [number, number] => [
      a < minDt ? 0.0 : a,
      b > 1.0 - minDt ? 1.0 : b,
    ])
    .sort((x, y) => x[0] - y[0] || x[1] - y[1]);

  const merged: [number, number][] = [];
  for (const [t0, t1] of sorted) {
    if (t1 <= t0) continue;
    const last = merged[merged.length - 1];
    if (last && t0 <= last[1] + minDt) {
      if (t1 > last[1]) last[1] = t1;
    } else {
      merged.push([t0, t1]);
    }
  }

  return merged.filter(([t0, t1]) => (t1 - t0) * lengthMm >= MIN_PIECE_MM);
}