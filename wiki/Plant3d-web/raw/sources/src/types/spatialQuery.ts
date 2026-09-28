export type SpatialQueryMode = 'range' | 'distance';

export type SpatialQueryCenterSource = 'selected' | 'pick' | 'coordinates' | 'refno';

export type SpatialQueryShape = 'sphere' | 'cube';

export type SpatialQuerySortBy = 'distanceAsc' | 'nameAsc' | 'specThenDistance';

export type SpatialQueryStatus =
  | 'idle'
  | 'resolving-center'
  | 'querying-local'
  | 'querying-server'
  | 'merging-results'
  | 'ready'
  | 'loading-model-for-result'
  | 'loading-results-batch'
  | 'flying-to-result'
  | 'error';

export type SpatialQueryPoint = {
  x: number;
  y: number;
  z: number;
};

export type SpatialQueryAabb = {
  min: SpatialQueryPoint;
  max: SpatialQueryPoint;
};

export type SpatialQueryFilters = {
  nouns: string[];
  keyword: string;
  onlyLoaded: boolean;
  onlyVisible: boolean;
  specValues: number[];
};

export type SpatialQueryRequest = {
  mode: SpatialQueryMode;
  centerSource: SpatialQueryCenterSource;
  center: SpatialQueryPoint;
  radius: number;
  shape: SpatialQueryShape;
  filters: SpatialQueryFilters;
  limit: number;
  sortBy: SpatialQuerySortBy;
  refno?: string;
};

export type SpatialQueryResultItem = {
  refno: string;
  noun: string;
  specValue: number;
  specName: string;
  distance: number | null;
  loaded: boolean;
  visible: boolean;
  matchedBy: 'viewer-local' | 'server-spatial-index' | 'merged';
  sourceModel?: string | null;
  name?: string | null;
  position?: SpatialQueryPoint | null;
  bbox?: SpatialQueryAabb | null;
};

export type SpatialQueryResultGroup = {
  specValue: number;
  specName: string;
  count: number;
  items: SpatialQueryResultItem[];
};

export type SpatialQueryResultSet = {
  request: SpatialQueryRequest;
  items: SpatialQueryResultItem[];
  total: number;
  loadedCount: number;
  unloadedCount: number;
  truncated: boolean;
  warnings: string[];
  groups: SpatialQueryResultGroup[];
};

export type SpatialQueryDraft = {
  mode: SpatialQueryMode;
  rangeCenterSource: Exclude<SpatialQueryCenterSource, 'refno'>;
  distanceCenterSource: Extract<SpatialQueryCenterSource, 'coordinates' | 'refno'>;
  refno: string;
  center: SpatialQueryPoint;
  radius: number;
  shape: SpatialQueryShape;
  nounText: string;
  keyword: string;
  onlyLoaded: boolean;
  onlyVisible: boolean;
  specValues: number[];
  limit: number;
};
