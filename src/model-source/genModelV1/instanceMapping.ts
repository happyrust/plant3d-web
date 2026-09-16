/**
 * `GeomInstQuery`（gen-model `model/records` 的一条）→ `InstanceEntry[]`（DTX 加载链吃的形状），plan P3-b。
 *
 * 矩阵：`matrix = compose(world_trans) × compose(inst.transform)`，两边都是 bevy `Transform`（T·R·S，
 * 四元数 `[x,y,z,w]`），three 的 `Matrix4.compose(position, quaternion, scale)` 同一约定；输出用
 * `toArray()`（列主序），与 `useDbnoInstancesDtxLoader` 里 `new Matrix4().fromArray(matrix)` 对得上。
 * 直管（`is_tubi`）的 `inst.transform` 恒为单位阵、姿态与缩放已折进 `world_trans`——同一条公式照样成立。
 *
 * 单位：E3D 原生 mm、Z-up，不换算（D6；P3 第一步用 BRAN 24381/145018 对拍过 AABB 才允许这句话留在这里）。
 *
 * `uniforms`：`refno`（构件，`a_b`）、`noun`（`generic`；直管统一 `TUBI`，DTX 层靠它把直管挂到属主）、
 * `owner_refno`（**生成根**，不是直接属主——`model/records` 就是按根投影出来的）、`owner_noun`（能从同批记录里
 * 认出来就填，认不出留空让加载链自己推）、`is_invalid_tubi`（画告警色用，plan §8 Q2）。
 */
import { Matrix4, Quaternion, Vector3 } from 'three';

import type { InstanceEntry } from '@/utils/instances/instanceManifest';

import { fromV1Refno, type GeomInstQuery, type V1Aabb, type V1Transform } from '@/api/genModelV1Api';

const IDENTITY: V1Transform = { translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] };

function isFiniteTriple(value: unknown): value is [number, number, number] {
  return Array.isArray(value) && value.length === 3 && value.every((n) => typeof n === 'number' && Number.isFinite(n));
}

function isFiniteQuad(value: unknown): value is [number, number, number, number] {
  return Array.isArray(value) && value.length === 4 && value.every((n) => typeof n === 'number' && Number.isFinite(n));
}

/** bevy `Transform` → three `Matrix4`（T·R·S）。字段缺失 / 非法时用单位量代替，绝不产出 NaN 矩阵。 */
export function transformToMatrix(transform: V1Transform | null | undefined): Matrix4 {
  const t = transform ?? IDENTITY;
  const translation = isFiniteTriple(t.translation) ? t.translation : IDENTITY.translation;
  const rotation = isFiniteQuad(t.rotation) ? t.rotation : IDENTITY.rotation;
  const scale = isFiniteTriple(t.scale) ? t.scale : IDENTITY.scale;
  return new Matrix4().compose(
    new Vector3(translation[0], translation[1], translation[2]),
    new Quaternion(rotation[0], rotation[1], rotation[2], rotation[3]).normalize(),
    new Vector3(scale[0], scale[1], scale[2]),
  );
}

/** 一个几何实例的最终世界矩阵（列主序 16 个数）。 */
export function composeInstanceMatrix(worldTrans: V1Transform, instTransform: V1Transform | null | undefined): number[] {
  const world = transformToMatrix(worldTrans);
  const local = transformToMatrix(instTransform);
  return world.multiply(local).toArray();
}

export function aabbToEntryAabb(aabb: V1Aabb | null | undefined): { min: number[]; max: number[] } | null {
  if (!aabb || !isFiniteTriple(aabb.mins) || !isFiniteTriple(aabb.maxs)) return null;
  return { min: [...aabb.mins], max: [...aabb.maxs] };
}

export type InstanceMappingContext = {
  /** `refno(a_b) → noun`，给 `owner_noun` 用；通常由同一批记录的 `generic` 建（见 `buildNounIndex`） */
  nounByRefno?: Map<string, string>;
};

/**
 * 同一批记录里「构件 → generic」的索引，供 `owner_noun` 查（生成根常常自己也有记录，比如 BRAN 的直管）。
 *
 * 隐式管身的记录挂在它所属 **BRAN 的 refno** 上（`refno == owner`），而 `generic` 给的是 `TUBI`——那是管身自己的类型，
 * 不是这个 refno 的类型：直管只会长在 BRAN 上，所以这条记录只说明「这个 refno 是一条 BRAN」。真机 `model/records`
 * 从来不发 `generic=BRAN` 的记录（2026-09-17 :8023 实测：BRAN 24381_145018 的 22 条里 11 条 TUBI 都挂在它自己的 refno 上），
 * 按字面收 `TUBI` 会让整条 BRAN 下所有构件的 `owner_noun` 变成 `TUBI`，靠 `owner_noun == BRAN` 认属主的都认不出来。
 * 非 `TUBI` 的 generic（含真给了 `BRAN` 的）优先，首见为准。
 */
export function buildNounIndex(items: GeomInstQuery[]): Map<string, string> {
  const map = new Map<string, string>();
  const tubingOwners: string[] = [];
  for (const item of items) {
    const key = fromV1Refno(item.refno);
    const noun = (item.generic ?? '').trim().toUpperCase();
    if (!key || !noun) continue;
    if (noun === 'TUBI') {
      tubingOwners.push(key);
      continue;
    }
    if (!map.has(key)) map.set(key, noun);
  }
  for (const key of tubingOwners) {
    if (!map.has(key)) map.set(key, 'BRAN');
  }
  return map;
}

/** 一条记录 → 它的全部几何实例。没有 `insts` 的记录（纯层级）产出空数组。 */
export function geomInstQueryToInstanceEntries(item: GeomInstQuery, context: InstanceMappingContext = {}): InstanceEntry[] {
  const refno = fromV1Refno(item.refno);
  const owner = item.owner ? fromV1Refno(item.owner) : '';
  const generic = (item.generic ?? '').trim().toUpperCase();
  const aabb = aabbToEntryAabb(item.world_aabb);
  const worldMatrix = transformToMatrix(item.world_trans).toArray();
  const ownerNoun = owner ? context.nounByRefno?.get(owner) ?? '' : '';
  const out: InstanceEntry[] = [];
  for (const inst of item.insts ?? []) {
    const geoHash = String(inst.geo_hash ?? '').trim();
    if (!geoHash) continue;
    const isTubi = inst.is_tubi === true;
    const uniforms: Record<string, unknown> = {
      refno,
      noun: isTubi ? 'TUBI' : generic,
      owner_refno: owner,
      owner_noun: isTubi ? ownerNoun || 'BRAN' : ownerNoun,
      generic,
      is_tubi: isTubi,
      is_invalid_tubi: inst.is_invalid_tubi === true,
      has_neg: item.has_neg === true,
    };
    const entry: InstanceEntry = {
      geo_hash: geoHash,
      matrix: composeInstanceMatrix(item.world_trans, inst.transform),
      geo_index: 0,
      color_index: 0,
      name_index: 0,
      site_name_index: 0,
      lod_mask: 1,
      uniforms,
      aabb,
    };
    // 直管的 world_trans 已折进缩放，不能当「构件的刚体位姿」给测量 / 点集用；普通构件才给。
    if (!isTubi) entry.refno_transform = worldMatrix;
    out.push(entry);
  }
  return out;
}

/** 一批记录 → `refno(a_b) → InstanceEntry[]`（`queryInstanceEntriesByRefnos` 的返回形状）。 */
export function groupInstanceEntriesByRefno(items: GeomInstQuery[]): Map<string, InstanceEntry[]> {
  const context: InstanceMappingContext = { nounByRefno: buildNounIndex(items) };
  const out = new Map<string, InstanceEntry[]>();
  for (const item of items) {
    const key = fromV1Refno(item.refno);
    if (!key) continue;
    const entries = geomInstQueryToInstanceEntries(item, context);
    const bucket = out.get(key);
    if (bucket) bucket.push(...entries);
    else out.set(key, entries);
  }
  return out;
}
