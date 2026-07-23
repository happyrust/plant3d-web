import {
  createEmptyDimensionDocument,
  type DimensionDocumentState,
} from './document';

import type {
  DimensionAnchor,
  SemanticAnchorRef,
  UserDimensionRecord,
  Vec3,
} from './types';

type LinearRecord = Extract<UserDimensionRecord, { kind: 'linear' }>;
type ProjectedRecord = Extract<UserDimensionRecord, { kind: 'projected' }>;
type AngularRecord = Extract<UserDimensionRecord, { kind: 'angular' }>;
type RadialRecord = Extract<UserDimensionRecord, { kind: 'radial' }>;

export function exactAnchor(
  snapshot: Vec3 = [0, 0, 0],
  semanticRef?: SemanticAnchorRef,
): DimensionAnchor {
  return {
    snapshot,
    accuracy: 'exact',
    ...(semanticRef ? { semanticRef } : {}),
  };
}

export function approximateAnchor(
  snapshot: Vec3 = [0, 0, 0],
  semanticRef?: SemanticAnchorRef,
): DimensionAnchor {
  return {
    snapshot,
    accuracy: 'approximate',
    ...(semanticRef ? { semanticRef } : {}),
  };
}

export function linearRecord(
  overrides: Partial<LinearRecord> = {},
): LinearRecord {
  return {
    id: 'linear-1',
    kind: 'linear',
    a: exactAnchor([0, 0, 0]),
    b: exactAnchor([1, 0, 0]),
    placement: {
      offsetM: 0.15,
      labelT: 0.5,
      side: 1,
    },
    labelPinned: false,
    authorId: 'owner',
    authorRole: 'designer',
    createdAt: 1,
    updatedAt: 1,
    validity: 'valid',
    ...overrides,
  };
}

export function projectedRecord(
  overrides: Partial<ProjectedRecord> = {},
): ProjectedRecord {
  return {
    id: 'projected-1',
    kind: 'projected',
    a: exactAnchor([0, 0, 0]),
    b: exactAnchor([1, 1, 0]),
    axis: {
      kind: 'design-axis',
      axis: 'x',
    },
    placement: {
      offsetM: 0.15,
      labelT: 0.5,
      side: 1,
    },
    labelPinned: false,
    authorId: 'owner',
    authorRole: 'designer',
    createdAt: 1,
    updatedAt: 1,
    validity: 'valid',
    ...overrides,
  };
}

export function angularRecord(
  overrides: Partial<AngularRecord> = {},
): AngularRecord {
  return {
    id: 'angular-1',
    kind: 'angular',
    vertex: exactAnchor([0, 0, 0]),
    rayA: exactAnchor([1, 0, 0]),
    rayB: exactAnchor([0, 1, 0]),
    placement: {
      radiusM: 0.3,
      labelT: 0.5,
      arcChoice: 'minor',
    },
    labelPinned: false,
    authorId: 'owner',
    authorRole: 'designer',
    createdAt: 1,
    updatedAt: 1,
    validity: 'valid',
    ...overrides,
  };
}

export function radialRecord(
  overrides: Partial<RadialRecord> = {},
): RadialRecord {
  return {
    id: 'radial-1',
    kind: 'radial',
    center: exactAnchor([0, 0, 0]),
    rim: exactAnchor([0.5, 0, 0]),
    normal: {
      kind: 'design-axis',
      axis: 'z',
    },
    display: 'radius',
    placement: {
      leaderDirection: [1, 0, 0],
      labelDistanceM: 0.25,
    },
    labelPinned: false,
    authorId: 'owner',
    authorRole: 'designer',
    createdAt: 1,
    updatedAt: 1,
    validity: 'valid',
    ...overrides,
  };
}

export function emptyDimensionDocument(
  records: readonly UserDimensionRecord[] = [],
  overrides: Partial<Omit<DimensionDocumentState, 'records'>> = {},
): DimensionDocumentState {
  return {
    ...createEmptyDimensionDocument({
      documentId: 'document-1',
    }),
    ...overrides,
    records,
  };
}
