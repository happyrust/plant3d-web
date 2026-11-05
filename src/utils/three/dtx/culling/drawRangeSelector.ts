/**
 * 按构件选段绘制：从每个构件的世界包围球、三角形区段与可见标志，挑出本帧要画的段（multiDraw 的 starts/counts）。
 *
 * - 跳过不可见构件、包围球完全在视锥外的构件；`minPx > 0` 时再跳过屏幕投影直径小于 `minPx` 的构件。
 * - 相邻的入选构件之间若只隔着不超过 `mergeGapTriangles` 个三角形就并成一段：WEBGL_multi_draw 每段固定开销
 *   约等于画 20 个三角形，多画几个被跳过的三角形比多开一段便宜（被跳过的构件若不可见，顶点着色器照样会丢掉）。
 * - 输入的区段必须按 `triStart` 升序（DTXLayer 的 primitiveOffset 是按追加顺序递增的）。
 * - 给了 `lod` 时，投影直径小于 `lod.minPx` 且有粗网格的构件改画粗网格区段。粗网格区段排在全部原网格之后、
 *   同样按构件顺序升序，所以两类段各自并段，粗网格段整体接在原网格段后面输出。
 */

import { Matrix4 } from 'three';

import type { Camera } from 'three';

export const DEFAULT_MERGE_GAP_TRIANGLES = 20;

export type DrawRangeView = {
  /** projectionMatrix × matrixWorldInverse（列主序） */
  viewProjection: Float64Array;
  /** matrixWorldInverse（列主序），用来算眼空间深度 */
  view: Float64Array;
  /** projectionMatrix.elements[5]：透视 = 1 / tan(fov / 2)，正交 = 2 / (top - bottom)（已含 zoom） */
  projScaleY: number;
  orthographic: boolean;
};

export type DrawRangeInput = {
  objectCount: number;
  /** 每构件 4 个数：cx, cy, cz, r（世界空间）；r < 0 或非有限值表示不参与裁剪（总是画） */
  spheres: Float32Array;
  /** 每构件三角形起点（全局图元序号） */
  triStart: Uint32Array;
  /** 每构件三角形数 */
  triCount: Uint32Array;
  /** 可见标志字节数组：第 i 个构件读 `visibleFlags[i * visibleStride + visibleOffset]`，0 = 隐藏 */
  visibleFlags: Uint8Array;
  visibleStride: number;
  visibleOffset: number;
  view: DrawRangeView;
  viewportHeightPx: number;
  minPx: number;
  mergeGapTriangles?: number;
  lod?: DrawRangeLodInput;
};

export type DrawRangeLodInput = {
  /** 每构件粗网格三角形起点（全局图元序号，必须按构件顺序升序） */
  triStart: Uint32Array;
  /** 每构件粗网格三角形数；0 = 没有粗网格 */
  triCount: Uint32Array;
  /** 投影直径小于它（px）改画粗网格；0 = 不用粗网格 */
  minPx: number;
  /** 每构件上一帧是否在画粗网格（1 = 是），选段时读写，用来做滞回 */
  state: Uint8Array;
  /** 已在画粗网格的构件，直径涨过 minPx × (1 + hysteresis) 才换回原网格；默认 0.15 */
  hysteresis?: number;
};

export const DEFAULT_LOD_HYSTERESIS = 0.15;

export type DrawRangeOutput = {
  /** 段起点，单位是顶点（= 三角形 × 3） */
  starts: Int32Array;
  /** 段长度，单位是顶点 */
  counts: Int32Array;
};

export type DrawRangeResult = {
  segmentCount: number;
  /** 实际会画的三角形数（含并段时夹带的间隙三角形） */
  triangleCount: number;
  /** 改画粗网格的构件数 */
  lodObjectCount: number;
};

let _lodStarts = new Int32Array(0);
let _lodCounts = new Int32Array(0);

const _tmpViewProjection = new Matrix4();

export function createDrawRangeView(): DrawRangeView {
  return {
    viewProjection: new Float64Array(16),
    view: new Float64Array(16),
    projScaleY: 1,
    orthographic: false,
  };
}

/** 从 three 相机取选段要用的矩阵；调用方负责相机 matrixWorldInverse / projectionMatrix 已是最新 */
export function drawRangeViewFromCamera(camera: Camera, target: DrawRangeView = createDrawRangeView()): DrawRangeView {
  _tmpViewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  target.viewProjection.set(_tmpViewProjection.elements);
  target.view.set(camera.matrixWorldInverse.elements);
  target.projScaleY = camera.projectionMatrix.elements[5]!;
  target.orthographic = (camera as { isOrthographicCamera?: boolean }).isOrthographicCamera === true;
  return target;
}

const _planes = new Float64Array(24);

function extractFrustumPlanes(m: Float64Array): void {
  const m0 = m[0]!, m1 = m[1]!, m2 = m[2]!, m3 = m[3]!;
  const m4 = m[4]!, m5 = m[5]!, m6 = m[6]!, m7 = m[7]!;
  const m8 = m[8]!, m9 = m[9]!, m10 = m[10]!, m11 = m[11]!;
  const m12 = m[12]!, m13 = m[13]!, m14 = m[14]!, m15 = m[15]!;
  // 与 three Frustum.setFromProjectionMatrix（WebGL 坐标系）同序：右、左、下、上、远、近
  const raw = [
    m3 - m0, m7 - m4, m11 - m8, m15 - m12,
    m3 + m0, m7 + m4, m11 + m8, m15 + m12,
    m3 + m1, m7 + m5, m11 + m9, m15 + m13,
    m3 - m1, m7 - m5, m11 - m9, m15 - m13,
    m3 - m2, m7 - m6, m11 - m10, m15 - m14,
    m3 + m2, m7 + m6, m11 + m10, m15 + m14,
  ];
  for (let p = 0; p < 6; p++) {
    const a = raw[p * 4]!, b = raw[p * 4 + 1]!, c = raw[p * 4 + 2]!, d = raw[p * 4 + 3]!;
    const len = Math.hypot(a, b, c);
    const inv = len > 0 ? 1 / len : 0;
    _planes[p * 4] = a * inv;
    _planes[p * 4 + 1] = b * inv;
    _planes[p * 4 + 2] = c * inv;
    _planes[p * 4 + 3] = d * inv;
  }
}

export function selectDrawRanges(input: DrawRangeInput, out: DrawRangeOutput): DrawRangeResult {
  const {
    objectCount, spheres, triStart, triCount,
    visibleFlags, visibleStride, visibleOffset,
    view, viewportHeightPx,
  } = input;
  const gap = Math.max(0, input.mergeGapTriangles ?? DEFAULT_MERGE_GAP_TRIANGLES);
  const pixelTest = input.minPx > 0 && viewportHeightPx > 0;
  const minPx = input.minPx;
  const lod = input.lod && input.lod.minPx > 0 && viewportHeightPx > 0 ? input.lod : null;
  const lodPx = lod ? lod.minPx : 0;
  const lodKeepPx = lodPx * (1 + (lod?.hysteresis ?? DEFAULT_LOD_HYSTERESIS));
  if (lod && _lodStarts.length < starts0(out)) {
    _lodStarts = new Int32Array(starts0(out));
    _lodCounts = new Int32Array(starts0(out));
  }
  // 投影直径 px = r × projScaleY × H / depth（正交时没有 depth）
  const pxScale = view.projScaleY * viewportHeightPx;
  const ortho = view.orthographic;
  const v = view.view;
  const v2 = v[2]!, v6 = v[6]!, v10 = v[10]!, v14 = v[14]!;

  extractFrustumPlanes(view.viewProjection);
  const p = _planes;

  const starts = out.starts;
  const counts = out.counts;
  let segmentCount = 0;
  let triangleCount = 0;
  let segStart = -1;
  let segEnd = -1;
  let lodSegmentCount = 0;
  let lodSegStart = -1;
  let lodSegEnd = -1;
  let lodObjectCount = 0;

  for (let i = 0; i < objectCount; i++) {
    const count = triCount[i]!;
    if (count === 0) continue;
    if (visibleFlags[i * visibleStride + visibleOffset] === 0) continue;

    const s = i * 4;
    const r = spheres[s + 3]!;
    let useLod = false;
    if (r >= 0 && Number.isFinite(r)) {
      const cx = spheres[s]!, cy = spheres[s + 1]!, cz = spheres[s + 2]!;
      if (
        p[0]! * cx + p[1]! * cy + p[2]! * cz + p[3]! < -r
        || p[4]! * cx + p[5]! * cy + p[6]! * cz + p[7]! < -r
        || p[8]! * cx + p[9]! * cy + p[10]! * cz + p[11]! < -r
        || p[12]! * cx + p[13]! * cy + p[14]! * cz + p[15]! < -r
        || p[16]! * cx + p[17]! * cy + p[18]! * cz + p[19]! < -r
        || p[20]! * cx + p[21]! * cy + p[22]! * cz + p[23]! < -r
      ) {
        continue;
      }
      const lodCandidate = lod !== null && lod.triCount[i]! > 0;
      if (pixelTest || lodCandidate) {
        let px: number;
        if (ortho) {
          px = r * pxScale;
        } else {
          const depth = -(v2 * cx + v6 * cy + v10 * cz + v14);
          // 相机在包围球里或贴着它：投影无界，当作大构件
          px = depth > r ? (r * pxScale) / depth : Infinity;
        }
        if (pixelTest && px < minPx) continue;
        if (lodCandidate) {
          useLod = lod.state[i] === 1 ? px < lodKeepPx : px < lodPx;
          lod.state[i] = useLod ? 1 : 0;
        }
      }
    }

    if (useLod) {
      const lodStart = lod!.triStart[i]!;
      const lodEnd = lodStart + lod!.triCount[i]!;
      lodObjectCount++;
      if (lodSegStart >= 0 && lodStart - lodSegEnd <= gap) {
        triangleCount += lodEnd - lodSegEnd;
        lodSegEnd = lodEnd;
        continue;
      }
      if (lodSegStart >= 0) {
        _lodStarts[lodSegmentCount] = lodSegStart * 3;
        _lodCounts[lodSegmentCount] = (lodSegEnd - lodSegStart) * 3;
        lodSegmentCount++;
      }
      lodSegStart = lodStart;
      lodSegEnd = lodEnd;
      triangleCount += lodEnd - lodStart;
      continue;
    }

    const start = triStart[i]!;
    const end = start + count;
    if (segStart >= 0 && start - segEnd <= gap) {
      triangleCount += end - segEnd;
      segEnd = end;
      continue;
    }
    if (segStart >= 0) {
      starts[segmentCount] = segStart * 3;
      counts[segmentCount] = (segEnd - segStart) * 3;
      segmentCount++;
    }
    segStart = start;
    segEnd = end;
    triangleCount += count;
  }

  if (segStart >= 0) {
    starts[segmentCount] = segStart * 3;
    counts[segmentCount] = (segEnd - segStart) * 3;
    segmentCount++;
  }
  if (lodSegStart >= 0) {
    _lodStarts[lodSegmentCount] = lodSegStart * 3;
    _lodCounts[lodSegmentCount] = (lodSegEnd - lodSegStart) * 3;
    lodSegmentCount++;
  }
  // 每个构件至多贡献一段，两类段合起来不会超过 out 的容量（= 构件数）
  starts.set(_lodStarts.subarray(0, lodSegmentCount), segmentCount);
  counts.set(_lodCounts.subarray(0, lodSegmentCount), segmentCount);
  segmentCount += lodSegmentCount;

  return { segmentCount, triangleCount, lodObjectCount };
}

function starts0(out: DrawRangeOutput): number {
  return out.starts.length;
}
