import type {
  DimensionAnchor,
  SemanticAnchorRef,
} from '../domain/types';

export type ResolveAnchorResult =
  | Readonly<{ ok: true; anchor: DimensionAnchor }>
  | Readonly<{
    ok: false;
    reason: 'not-found' | 'ambiguous' | 'source-unavailable';
  }>;

export type DimensionAnchorResolver = Readonly<{
  resolveMany(
    refs: readonly SemanticAnchorRef[],
  ): Promise<readonly ResolveAnchorResult[]>;
}>;
