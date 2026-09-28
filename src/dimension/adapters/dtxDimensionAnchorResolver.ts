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

export class DtxDimensionAnchorResolver implements DimensionAnchorResolver {
  constructor(private readonly input: Readonly<{
    loadCandidates(
      refno: string,
    ): Promise<readonly DtxDimensionAnchorCandidate[]>;
  }>) {}

  async resolveMany(
    refs: readonly SemanticAnchorRef[],
  ): Promise<readonly ResolveAnchorResult[]> {
    const refnos = [...new Set(
      refs
        .filter(ref => ref.source !== 'model-surface')
        .map(ref => ref.refno?.trim())
        .filter((refno): refno is string => Boolean(refno)),
    )];
    const loaded = new Map<
      string,
      readonly DtxDimensionAnchorCandidate[] | null
    >();
    await Promise.all(refnos.map(async (refno) => {
      try {
        loaded.set(refno, await this.input.loadCandidates(refno));
      } catch {
        loaded.set(refno, null);
      }
    }));

    return refs.map((ref) => {
      if (ref.source === 'model-surface') {
        return { ok: false, reason: 'source-unavailable' };
      }
      const refno = ref.refno?.trim();
      if (!refno) return { ok: false, reason: 'source-unavailable' };
      const candidates = loaded.get(refno);
      return candidates
        ? resolveCandidate(ref, candidates)
        : { ok: false, reason: 'source-unavailable' };
    });
  }
}
