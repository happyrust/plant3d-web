import { e3dGetAncestors, e3dGetSubtreeRefnos } from '@/api/genModelE3dApi';
import { pdmsGetTypeInfo } from '@/api/genModelPdmsAttrApi';

export const MIN_REVIEW_DELIVERY_UNIT_NOUNS = new Set([
  'BRAN',
  'HANG',
  'EQUI',
  'WALL',
  'SWALL',
  'GWALL',
  'GENSEC',
]);

const DELIVERY_UNIT_SUBTREE_MAX_DEPTH = 8;
const DELIVERY_UNIT_SUBTREE_LIMIT = 200;

export type ReviewDeliveryTypeInfo = {
  noun?: string | null;
  owner_noun?: string | null;
  owner_refno?: string | null;
};

export type ResolveReviewDeliveryUnitOptions = {
  getFallbackTypeInfo?: (refno: string) => ReviewDeliveryTypeInfo | Promise<ReviewDeliveryTypeInfo>;
};

export function normalizeReviewDeliveryNoun(value?: string | null): string {
  return String(value || '').trim().toUpperCase();
}

export function normalizeReviewDeliveryRefno(value?: string | null): string {
  return String(value || '').trim().replace(/\//g, '_');
}

export function isReviewMinimumDeliveryUnit(noun?: string | null): boolean {
  return MIN_REVIEW_DELIVERY_UNIT_NOUNS.has(normalizeReviewDeliveryNoun(noun));
}

async function getPdmsTypeInfoSafe(
  refno: string,
  options?: ResolveReviewDeliveryUnitOptions,
): Promise<ReviewDeliveryTypeInfo> {
  try {
    const resp = await pdmsGetTypeInfo(refno);
    if (resp.success) {
      return {
        noun: resp.noun,
        owner_noun: resp.owner_noun,
        owner_refno: normalizeReviewDeliveryRefno(resp.owner_refno),
      };
    }
  } catch {
    // ignore and fallback
  }

  if (options?.getFallbackTypeInfo) {
    return await options.getFallbackTypeInfo(refno);
  }

  return {};
}

async function findNearestDeliveryUnitAncestor(
  refno: string,
  options?: ResolveReviewDeliveryUnitOptions,
): Promise<string | null> {
  try {
    const resp = await e3dGetAncestors(refno);
    if (!resp.success || !Array.isArray(resp.refnos)) return null;
    const ancestors = [...resp.refnos].map((item) => normalizeReviewDeliveryRefno(item)).filter(Boolean).reverse();
    for (const ancestorRefno of ancestors) {
      if (ancestorRefno === normalizeReviewDeliveryRefno(refno)) continue;
      const typeInfo = await getPdmsTypeInfoSafe(ancestorRefno, options);
      if (isReviewMinimumDeliveryUnit(typeInfo.noun)) {
        return ancestorRefno;
      }
    }
  } catch {
    // ignore
  }
  return null;
}

async function findSingleDeliveryUnitDescendant(
  refno: string,
  options?: ResolveReviewDeliveryUnitOptions,
): Promise<string | null> {
  try {
    const resp = await e3dGetSubtreeRefnos(refno, {
      includeSelf: true,
      maxDepth: DELIVERY_UNIT_SUBTREE_MAX_DEPTH,
      limit: DELIVERY_UNIT_SUBTREE_LIMIT,
    });
    if (!resp.success || !Array.isArray(resp.refnos)) return null;
    const candidates = new Set<string>();
    for (const item of resp.refnos) {
      const candidateRefno = normalizeReviewDeliveryRefno(item);
      if (!candidateRefno) continue;
      const typeInfo = await getPdmsTypeInfoSafe(candidateRefno, options);
      if (isReviewMinimumDeliveryUnit(typeInfo.noun)) {
        candidates.add(candidateRefno);
        if (candidates.size > 1) {
          throw new Error('当前选中项跨多个最小交付单元，请直接选择具体的 BRAN/HANG/EQUI/WALL/GENSEC 等节点。');
        }
      }
    }
    return Array.from(candidates)[0] ?? null;
  } catch (error) {
    if (error instanceof Error) throw error;
  }
  return null;
}

export async function resolveReviewDeliveryUnitRefno(
  refno: string,
  options?: ResolveReviewDeliveryUnitOptions,
): Promise<string> {
  const normalizedRefno = normalizeReviewDeliveryRefno(refno);
  if (!normalizedRefno) {
    throw new Error('当前未选中有效构件，无法加入校审。');
  }

  const typeInfo = await getPdmsTypeInfoSafe(normalizedRefno, options);
  if (isReviewMinimumDeliveryUnit(typeInfo.noun)) {
    return normalizedRefno;
  }

  const ownerRefno = normalizeReviewDeliveryRefno(typeInfo.owner_refno);
  if (ownerRefno && isReviewMinimumDeliveryUnit(typeInfo.owner_noun)) {
    return ownerRefno;
  }

  const ancestorRefno = await findNearestDeliveryUnitAncestor(normalizedRefno, options);
  if (ancestorRefno) {
    return ancestorRefno;
  }

  const descendantRefno = await findSingleDeliveryUnitDescendant(normalizedRefno, options);
  if (descendantRefno) {
    return descendantRefno;
  }

  throw new Error('当前选中项无法归并到最小交付单元，不能加入校审。');
}
