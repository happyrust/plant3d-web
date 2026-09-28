import type {
  DimensionAnchor,
  Vec2,
  Vec3,
} from '../domain/types';

export type SnapCapability = 'point' | 'direction' | 'circle' | 'arc';

export type SnapCandidate = Readonly<{
  id: string;
  capability: SnapCapability;
  anchor: DimensionAnchor;
  direction?: Vec3;
  normal?: Vec3;
  label: string;
  distancePx: number;
}>;

export type SnapQuery = Readonly<{
  screen: Vec2;
  capabilities: readonly SnapCapability[];
  thresholdPx: number;
}>;

export type SnapQueryResult = Readonly<{
  candidates: readonly SnapCandidate[];
  selected: SnapCandidate | null;
}>;

export type DimensionSnapPort = {
  query(input: SnapQuery): readonly SnapCandidate[];
}

export function resolveSnapQuery(
  port: DimensionSnapPort,
  input: SnapQuery,
): SnapQueryResult {
  const candidates = port.query(input);
  return {
    candidates,
    selected: candidates[0] ?? null,
  };
}
