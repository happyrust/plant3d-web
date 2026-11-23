import type {
  DimensionAccuracy,
  SemanticAnchorRef,
  Vec3,
} from '../domain/types';
import type {
  DimensionAnchorResolver,
  ResolveAnchorResult,
} from '../ports/anchorResolver';

export type DtxDimensionAnchorCandidate = Readonly<{
  id: string;
  point: Vec3;
  accuracy?: DimensionAccuracy;
  direction?: Vec3;
  circle?: Readonly<{ center: Vec3; rim: Vec3; normal: Vec3 }>;
  arc?: Readonly<{ center: Vec3; rim: Vec3; normal: Vec3 }>;
}>;

function isFiniteVec3(value: unknown): value is Vec3 {
  return Array.isArray(value)
    && value.length === 3
    && value.every(item => typeof item === 'number' && Number.isFinite(item));
}

function candidateParts(candidateId: string): Readonly<{
  baseId: string;
  part: 'center' | 'rim' | 'normal' | null;
}> {
  const match = candidateId.match(/^(.*):(center|rim|normal)$/);
  return match
    ? {
      baseId: match[1]!,
      part: match[2] as 'center' | 'rim' | 'normal',
    }
    : { baseId: candidateId, part: null };
}

function resolveCandidate(
  ref: SemanticAnchorRef,
  candidates: readonly DtxDimensionAnchorCandidate[],
): ResolveAnchorResult {
  const candidateId = ref.candidateId;
  if (!candidateId) return { ok: false, reason: 'source-unavailable' };
  const parts = candidateParts(candidateId);
  const matches = candidates.filter(candidate => candidate.id === parts.baseId);
  if (matches.length === 0) return { ok: false, reason: 'not-found' };
  if (matches.length > 1) return { ok: false, reason: 'ambiguous' };
  const candidate = matches[0]!;
  let snapshot: Vec3 | null = null;
  if (ref.source === 'direction') {
    snapshot = candidate.direction ?? null;
  } else if (ref.source === 'circle' || ref.source === 'arc') {
    const geometry = ref.source === 'circle' ? candidate.circle : candidate.arc;
    if (geometry) {
      if (parts.part === 'rim') snapshot = geometry.rim;
      else if (parts.part === 'normal') snapshot = geometry.normal;
      else snapshot = geometry.center;
    }
  } else {
    snapshot = candidate.point;
  }
  if (!isFiniteVec3(snapshot)) return { ok: false, reason: 'not-found' };
  return {
    ok: true,
    anchor: {
      snapshot,
      accuracy: candidate.accuracy ?? 'exact',
      semanticRef: ref,
    },
  };
}

const TUBI_ID = /^TUBI:(.+)~(.+):(ARRIVE|LEAVE)$/;
const PTSET_ID = /^ptset:([^#]+)#\d+$/;
const PLINES_ID = /^plines:([^:]+):/;

/**
 * 主 refno 下找不到这个语义点时，还能去哪几个构件下找（#66）。管身端点 `TUBI:A~B:END` 挂在两端站 `A` / `B`
 * （BRAN 直属成员）上都能取到，锚点记的 refno 可能是 BRAN、管身 `A~B` 或任一端构件；P-Point / PLINE 的
 * `candidateId` 里带着自己的构件号。容器头尾 `Head` / `Tail` 不是构件。
 */
export function fallbackRefnosForCandidate(candidateId: string | undefined, primary?: string): string[] {
  if (!candidateId) return [];
  const { baseId } = candidateParts(candidateId);
  const out: string[] = [];
  const tubi = TUBI_ID.exec(baseId);
  if (tubi) out.push(tubi[1]!, tubi[2]!);
  const ptset = PTSET_ID.exec(baseId);
  if (ptset) out.push(ptset[1]!);
  const plines = PLINES_ID.exec(baseId);
  if (plines) out.push(plines[1]!);
  return [...new Set(out)]
    .filter(refno => refno !== 'Head' && refno !== 'Tail' && refno !== primary);
}

export class DtxDimensionAnchorResolver implements DimensionAnchorResolver {
  constructor(private readonly input: Readonly<{
    loadCandidates(
      refno: string,
    ): Promise<readonly DtxDimensionAnchorCandidate[]>;
  }>) {}

  async resolveMany(
    refs: readonly SemanticAnchorRef[],
  ): Promise<readonly ResolveAnchorResult[]> {
    const loaded = new Map<
      string,
      readonly DtxDimensionAnchorCandidate[] | null
    >();
    const load = async (refnos: readonly string[]): Promise<void> => {
      await Promise.all([...new Set(refnos)].filter(refno => !loaded.has(refno)).map(async (refno) => {
        try {
          loaded.set(refno, await this.input.loadCandidates(refno));
        } catch {
          loaded.set(refno, null);
        }
      }));
    };
    const resolveUnder = (ref: SemanticAnchorRef, refno: string | undefined): ResolveAnchorResult => {
      const candidates = refno ? loaded.get(refno) : undefined;
      return candidates
        ? resolveCandidate(ref, candidates)
        : { ok: false, reason: 'source-unavailable' };
    };

    await load(refs
      .filter(ref => ref.source !== 'model-surface')
      .map(ref => ref.refno?.trim())
      .filter((refno): refno is string => Boolean(refno)));
    const results: ResolveAnchorResult[] = refs.map((ref) => {
      if (ref.source === 'model-surface') {
        return { ok: false, reason: 'source-unavailable' };
      }
      return resolveUnder(ref, ref.refno?.trim());
    });

    const retry = refs
      .map((ref, index) => ({ ref, index }))
      .filter(({ ref, index }) => ref.source !== 'model-surface'
        && !results[index]!.ok
        && (results[index] as { reason: string }).reason !== 'ambiguous');
    const fallbacks = new Map(retry.map(({ ref, index }) => [
      index,
      fallbackRefnosForCandidate(ref.candidateId, ref.refno?.trim()),
    ]));
    await load([...fallbacks.values()].flat());
    for (const { ref, index } of retry) {
      for (const refno of fallbacks.get(index) ?? []) {
        const result = resolveUnder(ref, refno);
        if (result.ok || result.reason === 'ambiguous') {
          results[index] = result;
          break;
        }
      }
    }
    return results;
  }
}
