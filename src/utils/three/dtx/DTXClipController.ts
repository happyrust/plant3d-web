/**
 * DTXClipController — 房间凸壳裁剪在前端的中枢。
 *
 * 持有 DTXMaterial + DTXPickingMaterial 引用，统一把"当前要裁剪的房间集合"
 * 翻译成 shader 端的 uniform / DataTexture / sampler2DArray 数据。
 *
 * 设计契约见 `goals/room-clip-dual-track/data-source-design.md`；
 * 数据流图见 `goals/room-clip-dual-track/assets/dtx-room-clip-shader-data-flow.png`。
 *
 * # 阶段实装表
 *
 * | 阶段 | 实装内容 |
 * |---|---|
 * | **P1.5 (当前)** | AABB / CONVEX_HULLS 通过固定上限 uniform arrays 做视觉 MVP 裁剪；SDF 暂退化为 AABB |
 * | **P2**       | 将 plane 数据从 uniform arrays 升级为 uClipPlanesTexture + uClipMetaTexture，支持更大规模房间集合 |
 * | **P4**       | SDF mode 上传 uRoomSdfArray sampler2DArray + 异步 fetch binary；shader 加 mode 分派 |
 *
 * 后端 API 输出类型与本文件 `RoomClipPayload` 严格对齐，详见
 * `plant-model-gen/src/fast_model/room_clip/api_payload.rs`（P2 落地）。
 */

import type { DTXMaterial } from './DTXMaterial';
import type { DTXPickingMaterial } from './DTXPickingMaterial';

// ════════════════════════════════════════════════════════════════════════════
// API 数据类型（与后端 /api/room/clip-config 输出严格对齐）
// ════════════════════════════════════════════════════════════════════════════

export type V3 = [number, number, number];
/** 半空间 `(nx, ny, nz, d)`：`n·p ≤ d` 在内侧。 */
export type Plane = [number, number, number, number];

export type HullPlanes = {
  aabb_min: V3;
  aabb_max: V3;
  planes: Plane[];
};

export type AabbRoomPayload = {
  mode: 'aabb';
  room_refno: string;
  aabb_min: V3;
  aabb_max: V3;
};

export type ConvexHullsRoomPayload = {
  mode: 'convex_hulls';
  room_refno: string;
  aabb_min: V3;
  aabb_max: V3;
  hulls: HullPlanes[];
};

export type SdfRoomPayload = {
  mode: 'sdf';
  room_refno: string;
  aabb_min: V3;
  aabb_max: V3;
  resolution: V3;
  /** 二进制下载地址：`GET /api/room/sdf/{geo_hash}.bin` */
  sdf_url: string;
};

export type RoomClipPayload =
  | AabbRoomPayload
  | ConvexHullsRoomPayload
  | SdfRoomPayload;

export const ROOM_CLIP_MAX_SHAPES = 16;
export const ROOM_CLIP_MAX_PLANES = 128;

export type RoomClipUniformPayload = {
  enabled: boolean;
  roomCount: number;
  shapeCount: number;
  planeCount: number;
  planes: Plane[];
  shapePlaneStarts: number[];
  shapePlaneCounts: number[];
  shapeAabbMins: V3[];
  shapeAabbMaxs: V3[];
};

const ZERO_PLANE: Plane = [0, 0, 0, 0];
const ZERO_V3: V3 = [0, 0, 0];

function cloneV3(v: V3): V3 {
  return [v[0], v[1], v[2]];
}

function normalizePlane(plane: Plane): Plane | null {
  const [x, y, z, d] = plane;
  const len = Math.hypot(x, y, z);
  if (!Number.isFinite(len) || len <= 0) return null;
  return [x / len, y / len, z / len, d / len];
}

function planesFromAabb(min: V3, max: V3): Plane[] {
  return [
    [1, 0, 0, max[0]],
    [-1, 0, 0, -min[0]],
    [0, 1, 0, max[1]],
    [0, -1, 0, -min[1]],
    [0, 0, 1, max[2]],
    [0, 0, -1, -min[2]],
  ];
}

/**
 * 把 API payload 降维成当前视觉 MVP 使用的固定上限 uniform 数据。
 *
 * - 每个 AABB / convex hull 都是一个独立 shape，多个 shape 之间取并集。
 * - 每个 shape 内的 planes 取交集，约定 `n·p <= d` 为内部。
 * - SDF 暂时退化为 AABB，后续真实 SDF 纹理路径落地后再替换。
 */
export function buildRoomClipUniformPayload(rooms: RoomClipPayload[]): RoomClipUniformPayload {
  const planes: Plane[] = [];
  const shapePlaneStarts: number[] = [];
  const shapePlaneCounts: number[] = [];
  const shapeAabbMins: V3[] = [];
  const shapeAabbMaxs: V3[] = [];

  const addShape = (aabbMin: V3, aabbMax: V3, shapePlanes: Plane[]) => {
    if (shapePlaneStarts.length >= ROOM_CLIP_MAX_SHAPES) return;
    const start = planes.length;
    for (const plane of shapePlanes) {
      if (planes.length >= ROOM_CLIP_MAX_PLANES) break;
      const normalized = normalizePlane(plane);
      if (normalized) planes.push(normalized);
    }
    const count = planes.length - start;
    if (count <= 0) return;
    shapePlaneStarts.push(start);
    shapePlaneCounts.push(count);
    shapeAabbMins.push(cloneV3(aabbMin));
    shapeAabbMaxs.push(cloneV3(aabbMax));
  };

  for (const room of rooms) {
    if (room.mode === 'convex_hulls') {
      if (room.hulls.length === 0) {
        addShape(room.aabb_min, room.aabb_max, planesFromAabb(room.aabb_min, room.aabb_max));
        continue;
      }
      for (const hull of room.hulls) {
        const hullPlanes = hull.planes.length > 0
          ? hull.planes
          : planesFromAabb(hull.aabb_min, hull.aabb_max);
        addShape(hull.aabb_min, hull.aabb_max, hullPlanes);
      }
      continue;
    }

    // 视觉 MVP：AABB 直接裁；SDF 暂时用整体 AABB 兜底。
    addShape(room.aabb_min, room.aabb_max, planesFromAabb(room.aabb_min, room.aabb_max));
  }

  while (planes.length < ROOM_CLIP_MAX_PLANES) planes.push([...ZERO_PLANE]);
  while (shapePlaneStarts.length < ROOM_CLIP_MAX_SHAPES) shapePlaneStarts.push(0);
  while (shapePlaneCounts.length < ROOM_CLIP_MAX_SHAPES) shapePlaneCounts.push(0);
  while (shapeAabbMins.length < ROOM_CLIP_MAX_SHAPES) shapeAabbMins.push([...ZERO_V3]);
  while (shapeAabbMaxs.length < ROOM_CLIP_MAX_SHAPES) shapeAabbMaxs.push([...ZERO_V3]);

  const shapeCount = shapePlaneCounts.findIndex((count) => count === 0);
  const effectiveShapeCount = shapeCount === -1 ? ROOM_CLIP_MAX_SHAPES : shapeCount;
  const planeCount = planes.findIndex((plane) => plane[0] === 0 && plane[1] === 0 && plane[2] === 0 && plane[3] === 0);
  const effectivePlaneCount = planeCount === -1 ? ROOM_CLIP_MAX_PLANES : planeCount;

  return {
    enabled: effectiveShapeCount > 0,
    roomCount: rooms.length,
    shapeCount: effectiveShapeCount,
    planeCount: effectivePlaneCount,
    planes,
    shapePlaneStarts,
    shapePlaneCounts,
    shapeAabbMins,
    shapeAabbMaxs,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// DTXClipController
// ════════════════════════════════════════════════════════════════════════════

/**
 * Controller 构造参数。
 *
 * DTXLayer 同时持有不透明 + 透明 + picking 三种材质，必须**全部**同步裁剪状态，
 * 否则会出现：
 * - 透明管道在裁剪边界没被切断（视觉错乱）；
 * - 被裁的片元仍可被 GPU picker 命中（语义错乱）。
 */
export type DTXClipControllerOptions = {
  mainMaterials: DTXMaterial[];
  pickingMaterials: DTXPickingMaterial[];
};

export class DTXClipController {
  private currentRooms: RoomClipPayload[] = [];
  private readonly mainMaterials: DTXMaterial[];
  private readonly pickingMaterials: DTXPickingMaterial[];

  constructor(options: DTXClipControllerOptions) {
    this.mainMaterials = options.mainMaterials.slice();
    this.pickingMaterials = options.pickingMaterials.slice();
  }

  /**
   * 接入一组房间作为裁剪范围。
   *
   * - 传空数组 / 不传 → 等价 {@link disable}（关闭裁剪）。
   * - 列表内顺序对应 shader 端 uClipRoom* uniform 数组的 index；后续 PR 用此 index 索引 DataTexture。
   *
   * @internal 当前视觉 MVP：AABB / convex hull 会被转换为固定上限 uniform arrays；
   *           后续 P2 可替换为 DataTexture 上传而不破坏本接口。
   */
  setRooms(rooms: RoomClipPayload[]): void {
    this.currentRooms = rooms.slice();
    const uniforms = buildRoomClipUniformPayload(rooms);
    for (const m of this.mainMaterials) m.setRoomClipUniforms(uniforms);
    for (const m of this.pickingMaterials) m.setRoomClipUniforms(uniforms);
    // TODO(P4): uploadSdfTextures(this.currentRooms.filter(r => r.mode === 'sdf'))
  }

  disable(): void {
    this.currentRooms = [];
    const uniforms = buildRoomClipUniformPayload([]);
    for (const m of this.mainMaterials) m.setRoomClipUniforms(uniforms);
    for (const m of this.pickingMaterials) m.setRoomClipUniforms(uniforms);
  }

  get roomCount(): number {
    return this.currentRooms.length;
  }

  get roomRefnos(): string[] {
    return this.currentRooms.map((r) => r.room_refno);
  }

  /**
   * 统计每种 mode 的房间数。便于 UI / 调试面板展示当前裁剪规模。
   */
  get statsByMode(): Record<RoomClipPayload['mode'], number> {
    const stats: Record<RoomClipPayload['mode'], number> = {
      aabb: 0,
      convex_hulls: 0,
      sdf: 0,
    };
    for (const r of this.currentRooms) {
      stats[r.mode] = (stats[r.mode] ?? 0) + 1;
    }
    return stats;
  }

  /**
   * 释放本 controller 持有的 GPU 资源。P1 暂无资源，预留接口。
   * P2+ 会持有 DataTexture / sampler2DArray，需要在 viewer dispose 时调用。
   */
  dispose(): void {
    // P2+: 释放 uClipPlanesTexture / uClipMetaTexture
    // P4+: 释放 uRoomSdfArray
  }
}
