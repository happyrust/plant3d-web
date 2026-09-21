/**
 * 最小交付单元在三维场景里的「整体」（ADR 0068 追记；用户 2026-09-21 拍板：**管件要带直段**，方案 A）。
 *
 * gen-model 把 BRAN 的隐式直管（TUBI）全部挂在 **BRAN 自己的 refno** 上：直管没有独立 refno，`model/records` 里那几条是
 * `refno == owner == BRAN, generic = TUBI`（`instanceMapping.ts`）。而空间索引（`nearby/tree` / `rooms/{refno}/tree`）里
 * **一条 TUBI 都没有**，两棵树的叶子只有管件。于是只按叶子 refno 做加载 / 显隐 / 隔离，管件就会悬空——直段要么根本没画
 * （抽屉批量加载只取命中的 refno），要么被当成「别的东西」隐掉 / XRAY（单元级动作的 refno 集里没有 BRAN 自己）。
 *
 * 这里只读记录缓存（`GenModelV1ModelRecordSource`），不发请求：
 * - `branOwnerOfLoaded(refno)`：一个已取过记录的构件所属的 BRAN 生成根。只认 `owner_noun == BRAN`——HANG / EQUI 根没有直管，不扩；
 *   BRAN 自己的直管条目 `refno == owner`，回 null（它就是根）。记录没取过 / 构件没几何 → null。
 * - `deliveryUnitSceneRefnos(unitRefno)`：一条 BRAN 在场景里的全部 refno = 它自己（直管挂在这儿）+ 记录缓存里这一根的全部构件
 *   （含范围 / 房间之外、树上没列的那些）。记录还没取过时只有它自己。
 * - `sceneCompanionsOf(refnos, unitRefnos)`：一批构件 + 一批 BRAN 单元 → 它们在场景里还该一起动的 refno（去重、不含入参里已有的）。
 *
 * 源没建起来 / 测试没桩时一律退成「什么都不扩」，调用方行为与改前一致。
 */
import type { InstanceEntry } from '@/utils/instances/instanceManifest';

import { getModelSource } from '@/model-source';

type RecordCacheLike = {
  peek?: (refno: string) => InstanceEntry[] | undefined;
  leavesOfRoot?: (root: string) => string[];
};

export function normalizeSceneRefno(refno: string): string {
  return String(refno ?? '').trim().replace('/', '_');
}

function recordCache(): RecordCacheLike | null {
  try {
    const source = getModelSource() as { records?: RecordCacheLike } | null | undefined;
    return source?.records ?? null;
  } catch {
    return null;
  }
}

/** 已取过记录的构件所属的 BRAN 生成根（`a_b`）；不是 BRAN 下的构件 / 记录没取过 / 它自己就是 BRAN → null。 */
export function branOwnerOfLoaded(refno: string): string | null {
  const key = normalizeSceneRefno(refno);
  if (!key) return null;
  const first = recordCache()?.peek?.(key)?.[0];
  if (!first) return null;
  const uniforms = (first.uniforms ?? {}) as Record<string, unknown>;
  const ownerNoun = String(uniforms.owner_noun ?? '').trim().toUpperCase();
  const owner = normalizeSceneRefno(String(uniforms.owner_refno ?? ''));
  if (ownerNoun !== 'BRAN' || !owner || owner === key) return null;
  return owner;
}

/** 一条 BRAN 在场景里的全部 refno：它自己（直管）+ 记录缓存里这一根的全部构件；记录没取过时只有它自己。 */
export function deliveryUnitSceneRefnos(unitRefno: string): string[] {
  const key = normalizeSceneRefno(unitRefno);
  if (!key) return [];
  const out = [key];
  const seen = new Set(out);
  let leaves: string[] = [];
  try {
    leaves = recordCache()?.leavesOfRoot?.(key) ?? [];
  } catch {
    leaves = [];
  }
  for (const leaf of leaves) {
    const leafKey = normalizeSceneRefno(leaf);
    if (!leafKey || seen.has(leafKey)) continue;
    seen.add(leafKey);
    out.push(leafKey);
  }
  return out;
}

/**
 * 一批构件（按记录缓存认属主）+ 一批 BRAN 单元 refno → 场景里还该跟着一起动的 refno（去重，不含 `refnos` 里已有的）。
 * 单元 refno 单独给一份：单元下在范围里的构件可能全都没几何记录（如只剩 ATTA），靠属主认不出来，但单元行本身就是那条 BRAN。
 */
export function sceneCompanionsOf(refnos: Iterable<string>, unitRefnos: Iterable<string> = []): string[] {
  const given = new Set<string>();
  const owners = new Set<string>();
  for (const refno of refnos) {
    const key = normalizeSceneRefno(refno);
    if (!key) continue;
    given.add(key);
    const owner = branOwnerOfLoaded(key);
    if (owner) owners.add(owner);
  }
  for (const unit of unitRefnos) {
    const key = normalizeSceneRefno(unit);
    if (key) owners.add(key);
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const owner of owners) {
    for (const refno of deliveryUnitSceneRefnos(owner)) {
      if (given.has(refno) || seen.has(refno)) continue;
      seen.add(refno);
      out.push(refno);
    }
  }
  return out;
}
