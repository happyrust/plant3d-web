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
 * | **P1 (当前)** | uClipEnabled / uClipRoomCount 的开关与计数；shader 端 isInsideAnyRoom 仍永远 true |
 * | **P2**       | AABB / CONVEX_HULLS 两种 mode 上传 uClipPlanesTexture + uClipMetaTexture，shader 端实装 broad-phase AABB + 凸壳 plane 集合判定 |
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

// ════════════════════════════════════════════════════════════════════════════
// DTXClipController
// ════════════════════════════════════════════════════════════════════════════

export class DTXClipController {
  private currentRooms: RoomClipPayload[] = [];

  constructor(
    private readonly material: DTXMaterial,
    private readonly pickingMaterial: DTXPickingMaterial,
  ) {}

  /**
   * 接入一组房间作为裁剪范围。
   *
   * - 传空数组 / 不传 → 等价 {@link disable}（关闭裁剪）。
   * - 列表内顺序对应 shader 端 uClipRoom* uniform 数组的 index；后续 PR 用此 index 索引 DataTexture。
   *
   * @internal P1 实装：仅 toggle uClipEnabled + 设置 roomCount。真正 plane / SDF 数据
   *           会在 P2 / P4 PR 中扩展（届时不破坏本接口）。
   */
  setRooms(rooms: RoomClipPayload[]): void {
    this.currentRooms = rooms.slice();
    const enabled = rooms.length > 0;
    this.material.setRoomClipUniforms({ enabled, roomCount: rooms.length });
    this.pickingMaterial.setRoomClipUniforms({ enabled, roomCount: rooms.length });
    // TODO(P2): uploadPlanesData(this.currentRooms)
    // TODO(P4): uploadSdfTextures(this.currentRooms.filter(r => r.mode === 'sdf'))
  }

  disable(): void {
    this.currentRooms = [];
    this.material.setRoomClipUniforms({ enabled: false, roomCount: 0 });
    this.pickingMaterial.setRoomClipUniforms({ enabled: false, roomCount: 0 });
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
