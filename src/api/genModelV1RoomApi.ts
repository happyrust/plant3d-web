/**
 * gen-model v1 的房间归属点查：`POST /api/v1/query` 的 `e3d.room.lookup` 工具（spec §4.x `query`；
 * plant3d-web ADR 0067 / 计划 2026-09-20 §4.3）。
 *
 * 给两处用：抽屉「当前选中构件所在房间」一键带入过滤（Q4 (c)），与结果区「房间列表」（当前页条目所在房间，
 * 此前打旧后端 `:3100 /api/room-tree/ancestors`，v1 源下那条路是断的，Q7 (a) 改接这里）。
 *
 * 单独成文件、只 import `genModelV1Api.ts` 的基座：那份文件里有别的会话在飞的改动，这里不往它身上加东西。
 */
import { fromV1Refno, genModelV1Fetch, toV1Refno, type GenModelV1RequestOptions } from '@/api/genModelV1Api';

/** `e3d.room.lookup` 的 `calculation_status`：空 `memberships` 是「算过、不在任何房间」还是「还没算」。 */
export type RoomLookupCalculationStatus =
  | 'computed'
  | 'ready_empty'
  | 'ready_nonempty'
  | 'not_computed'
  | 'initializing'
  | 'disabled'
  | 'failed'
  | (string & {});

export type RoomLookupMembership = {
  /** 房间元素 refno（`a_b`）；面板不在任何在册房间名下时为 null */
  roomRefno: string | null;
  roomNum: string | null;
  /** 归属挂在哪块面板上（`a_b`） */
  panelRefno: string;
  /** 元素 AABB 八顶点落在面板内的个数（0–8），越大归属越强；读透形态给，落盘形态可能没有 */
  insideCount: number | null;
  centerDist: number | null;
};

export type RoomLookupResult = {
  /** `a_b` */
  refno: string;
  /** 按 `inside_count` 降序 → `center_dist` 升序 → `room_num` 升序；首条是材料表取的主归属 */
  memberships: RoomLookupMembership[];
  calculationStatus: RoomLookupCalculationStatus;
  /** 服务端 `room_membership` 总开关 */
  roomMembership: boolean;
};

type RawMembership = {
  room_refno?: string | null;
  room_num?: string | null;
  panel_refno?: string | null;
  inside_count?: number | null;
  center_dist?: number | null;
};

type RawRoomLookup = {
  refno?: string;
  memberships?: RawMembership[];
  calculation_status?: string;
  room_membership?: boolean;
};

type QueryResponse<T> = {
  tool: string;
  result: T;
};

function asFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** `QueryResponse.result` → 前端形状；refno 一律归一 `a_b`。 */
export function normalizeRoomLookup(refno: string, raw: RawRoomLookup | null | undefined): RoomLookupResult {
  const memberships = (raw?.memberships ?? [])
    .filter((membership): membership is RawMembership => !!membership && typeof membership === 'object')
    .map((membership) => ({
      roomRefno: membership.room_refno ? fromV1Refno(membership.room_refno) : null,
      roomNum: membership.room_num?.trim() || null,
      panelRefno: membership.panel_refno ? fromV1Refno(membership.panel_refno) : '',
      insideCount: asFiniteNumber(membership.inside_count),
      centerDist: asFiniteNumber(membership.center_dist),
    }));
  return {
    refno: raw?.refno ? fromV1Refno(raw.refno) : fromV1Refno(refno),
    memberships,
    calculationStatus: raw?.calculation_status ?? 'not_computed',
    roomMembership: raw?.room_membership ?? false,
  };
}

/** 某构件属于哪些房间。容器（SITE / ZONE / PIPE…）没有生成根，服务端回 `not_computed` + 空表，不是错误。 */
export async function genModelV1RoomLookup(
  refno: string,
  options?: GenModelV1RequestOptions,
): Promise<RoomLookupResult> {
  const resp = await genModelV1Fetch<QueryResponse<RawRoomLookup>>('/api/v1/query', {
    ...options,
    method: 'POST',
    body: { tool: 'e3d.room.lookup', arguments: { refno: toV1Refno(refno) } },
  });
  return normalizeRoomLookup(refno, resp?.result);
}

/**
 * 该构件所在房间的 refno 列表（去重、保持归属强弱序）。给「当前选中所在房间」与「房间列表」用；
 * 归属不含在册房间（`room_refno` 为 null）的边不算。
 */
export function roomRefnosOf(lookup: RoomLookupResult): string[] {
  const out: string[] = [];
  for (const membership of lookup.memberships) {
    if (membership.roomRefno && !out.includes(membership.roomRefno)) {
      out.push(membership.roomRefno);
    }
  }
  return out;
}
