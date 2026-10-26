/**
 * pick_refno 候选纯逻辑：过滤、框选归结、候选轮换。
 * 从 useDtxTools.ts 拆出（docs/plans/2026-10-26-usedtxtools-split-plan.md 第 1 步），实现未改。
 */
import { parseTubeKey } from '@/composables/spatialTree';
import { findNounByRefnoAcrossAllDbnos, findOwnerRefnoByTubi, resolveDtxTubeKeyByObjectId } from '@/composables/useDbnoInstancesDtxLoader';

export function resolvePickedRefnoForFilter(
  pickedRefno: string,
  filter: string[],
  findNoun: (refno: string) => string | null = findNounByRefnoAcrossAllDbnos,
  findOwner: (refno: string) => string | null = findOwnerRefnoByTubi,
): string | null {
  let targetRefno = pickedRefno;
  let resolvedNoun: string | null = null;

  if (filter.includes('BRAN')) {
    const noun = findNoun(targetRefno);
    if (noun !== 'BRAN') {
      const branRefno = findOwner(targetRefno);
      if (branRefno) {
        targetRefno = branRefno;
        // 关键：owner 由 loader 侧保证为 BRAN，但 BRAN 本体可能未加载导致 findNoun 为空；
        // 在 BRAN 过滤下，这里直接视为满足过滤。
        resolvedNoun = 'BRAN';
      }
    }
  }

  if (filter.length > 0) {
    const noun = resolvedNoun || findNoun(targetRefno);
    if (!noun || !filter.includes(noun.toUpperCase())) {
      return null;
    }
  }

  return targetRefno;
}

export type BoxPickResolution =
  | { kind: 'ok'; refnos: string[] }
  | { kind: 'noun_unavailable' };

/**
 * 框选结果按 noun 过滤。
 *
 * 一个 noun 都解析不出来时返回 `noun_unavailable`：那说明 dbno 类型缓存还没就绪，
 * 不能和「框里确实没有目标类型」混为一谈——后者是空集，前者应该让用户重试。
 */
export function resolveBoxPickRefnos(
  selectedRefnos: string[],
  nounFilterUpper: string[],
  findNoun: (refno: string) => string | null = findNounByRefnoAcrossAllDbnos,
): BoxPickResolution {
  if (nounFilterUpper.length === 0 || selectedRefnos.length === 0) {
    return { kind: 'ok', refnos: selectedRefnos };
  }

  let nounResolved = false;
  const refnos = selectedRefnos.filter((refno) => {
    const noun = findNoun(refno);
    if (noun === null) return false;
    nounResolved = true;
    return nounFilterUpper.includes(noun.toUpperCase());
  });

  return nounResolved ? { kind: 'ok', refnos } : { kind: 'noun_unavailable' };
}

/** 光标射线上的一个可关联候选；`distance` 越小越靠近相机。 */
export type PickRefnoCandidate = {
  /** 过滤/上溯之后的目标 refno，例如 TUBI 上溯得到的 BRAN；按直段拾取时是直段身份键（`tubeKey`） */
  refno: string
  /** 射线实际命中的元素 refno；目标本身没有几何时用它兜底高亮 */
  hitRefno: string
  distance: number
}

export type PickRefnoRayHit = {
  entityId: string
  objectId: string
  distance: number
}

/**
 * 把一次射线的全部命中压成候选列表：逐个过 noun 过滤解析 refno，
 * 同一 refno（例如同属一根 BRAN 的多段 TUBI）只保留最靠前的那次命中，按距离升序。
 */
export function buildPickRefnoCandidates(
  hits: PickRefnoRayHit[],
  filter: string[],
  resolve: (refno: string, filter: string[]) => string | null = resolvePickedRefnoForFilter,
): PickRefnoCandidate[] {
  const byRefno = new Map<string, PickRefnoCandidate>();

  for (const hit of hits) {
    const refno = resolve(hit.entityId, filter);
    if (!refno) continue;
    const existing = byRefno.get(refno);
    if (existing && existing.distance <= hit.distance) continue;
    byRefno.set(refno, { refno, hitRefno: hit.entityId, distance: hit.distance });
  }

  return Array.from(byRefno.values()).sort((a, b) => a.distance - b.distance);
}

/** 拾取过滤含 `TUBI` = 按直段拾取：拾取结果是直段身份键（`tubeKey`），不是 refno。 */
export function isTubePickFilter(filter: readonly string[]): boolean {
  return filter.includes('TUBI');
}

/** 拾取结果里的直段身份键——高亮与包围盒都按那一段直管对象取，不走 refno。 */
export function isTubeKeyLike(id: string): boolean {
  return parseTubeKey(id) !== null;
}

/**
 * 按直段拾取的候选：命中按场景对象认直段身份键，一个键只留最靠前的一次；没有直段身份的命中（管件、老服务端不给
 * `tube` 的直管）不进候选。`hitRefno` 是对象挂的 refno（直管挂在所属 BRAN 上）。
 */
export function buildPickTubeCandidates(
  hits: PickRefnoRayHit[],
  resolveTubeKey: (objectId: string) => string | null = resolveDtxTubeKeyByObjectId,
): PickRefnoCandidate[] {
  const byKey = new Map<string, PickRefnoCandidate>();
  for (const hit of hits) {
    const key = resolveTubeKey(hit.objectId);
    if (!key) continue;
    const existing = byKey.get(key);
    if (existing && existing.distance <= hit.distance) continue;
    byKey.set(key, { refno: key, hitRefno: hit.entityId, distance: hit.distance });
  }
  return Array.from(byKey.values()).sort((a, b) => a.distance - b.distance);
}

/** 候选轮换下标，`step` 支持负数（Shift+Tab 反向）。 */
export function nextPickCandidateIndex(current: number, total: number, step = 1): number {
  if (total <= 0) return 0;
  return (((current + step) % total) + total) % total;
}

/** 光标是否仍停在上一次拾取的同一处——判定「原地重复点击 = 轮换」而非「新的一次拾取」。 */
export function isSamePickAnchor(
  previous: { x: number; y: number } | null,
  next: { x: number; y: number },
  tolerancePx = 6,
): boolean {
  if (!previous) return false;
  const dx = next.x - previous.x;
  const dy = next.y - previous.y;
  return dx * dx + dy * dy <= tolerancePx * tolerancePx;
}

/**
 * 候选序列是否与上一次一致。
 *
 * 屏幕坐标相同不代表命中相同——相机在两次点击之间转过一点，同一像素下的构件就换了。
 * 因此轮换的前提是「位置没动」且「候选序列没变」。
 */
export function isSamePickCandidateSequence(
  previous: PickRefnoCandidate[],
  next: PickRefnoCandidate[],
): boolean {
  if (previous.length !== next.length) return false;
  return previous.every((item, index) => item.refno === next[index]?.refno);
}
