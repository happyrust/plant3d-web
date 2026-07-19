export type Vec2 = Readonly<{ x: number; y: number }>;
export type Vec3 = readonly [number, number, number];
export type DimensionKind = 'linear' | 'projected' | 'angular' | 'radial';
export type DimensionAccuracy = 'exact' | 'approximate';
export type DimensionValidity = 'valid' | 'invalid';
export type DimensionArcChoice = 'minor' | 'major';
export type RadialDisplay = 'radius' | 'diameter';

export type SemanticAnchorRef = Readonly<{
  source:
    | 'p-point'
    | 'instance-origin'
    | 'primitive-key-point'
    | 'model-surface'
    | 'circle'
    | 'arc'
    | 'direction';
  refno?: string;
  candidateId?: string;
}>;

export type DimensionAnchor = Readonly<{
  snapshot: Vec3 | null;
  accuracy: DimensionAccuracy;
  semanticRef?: SemanticAnchorRef;
}>;

export type ProjectionAxisRef =
  | Readonly<{ kind: 'design-axis'; axis: 'x' | 'y' | 'z' }>
  | Readonly<{
    kind: 'semantic-direction';
    snapshot: Vec3;
    semanticRef: SemanticAnchorRef;
  }>;

export type LinearPlacementIntent = Readonly<{
  offsetM: number;
  labelT: number;
  side: 1 | -1;
}>;

export type AngularPlacementIntent = Readonly<{
  radiusM?: number;
  labelT: number;
  arcChoice: DimensionArcChoice;
}>;

export type RadialPlacementIntent = Readonly<{
  leaderDirection: Vec3;
  labelDistanceM: number;
}>;

export type UserDimensionRecord =
  | Readonly<{
    id: string;
    kind: 'linear';
    a: DimensionAnchor;
    b: DimensionAnchor;
    placement: LinearPlacementIntent;
    authorId: string;
    authorRole: string;
    createdAt: number;
    updatedAt: number;
    validity: DimensionValidity;
  }>
  | Readonly<{
    id: string;
    kind: 'projected';
    a: DimensionAnchor;
    b: DimensionAnchor;
    axis: ProjectionAxisRef;
    placement: LinearPlacementIntent;
    authorId: string;
    authorRole: string;
    createdAt: number;
    updatedAt: number;
    validity: DimensionValidity;
  }>
  | Readonly<{
    id: string;
    kind: 'angular';
    vertex: DimensionAnchor;
    rayA: DimensionAnchor;
    rayB: DimensionAnchor;
    placement: AngularPlacementIntent;
    authorId: string;
    authorRole: string;
    createdAt: number;
    updatedAt: number;
    validity: DimensionValidity;
  }>
  | Readonly<{
    id: string;
    kind: 'radial';
    center: DimensionAnchor;
    rim: DimensionAnchor;
    normal: ProjectionAxisRef;
    display: RadialDisplay;
    placement: RadialPlacementIntent;
    authorId: string;
    authorRole: string;
    createdAt: number;
    updatedAt: number;
    validity: DimensionValidity;
  }>;
