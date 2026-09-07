# Data Model: Measurement Pick Sources

## MeasurementPickSourceId

Represents a user-facing measurement point source.

```ts
type MeasurementPickSourceId =
  | 'mesh_pick_point'
  | 'ptset'
  | 'position'
  | 'primitive_key_point';
```

Validation rules:

- Source IDs are stable persisted keys.
- Unknown source IDs from future records should be ignored for snap and displayed as `unknown` if needed.

## MeasurementPickSourceSetting

User preference for a point source.

```ts
type MeasurementPickSourceSetting = {
  show: boolean;
  snap: boolean;
  priority: number;
  thresholdPx: number;
};
```

Validation rules:

- `thresholdPx` is clamped to the supported UI range.
- `priority` is deterministic; lower number wins.
- `snap=false` prevents source selection even when `show=true`.
- `show=false` hides helper markers even when `snap=true`.

Default settings:

| Source | show | snap | priority |
|--------|------|------|----------|
| primitive_key_point | false | false | 10 |
| ptset | true | true | 20 |
| position | false | false | 30 |
| mesh_pick_point | false | false | 40 |

## MeasurementPickCandidate

A candidate point returned by a source resolver.

```ts
type MeasurementPickCandidate = {
  id: string;
  source: MeasurementPickSourceId;
  worldPos: [number, number, number];
  objectId?: string | null;
  refno?: string | null;
  label?: string | null;
  pixelDistance?: number;
  metadata?: Record<string, unknown>;
};
```

Validation rules:

- `worldPos` must be in the same scene coordinate space as existing xeokit measurement records.
- Candidate IDs must be stable for precomputed point sets and may be transient for Mesh Pick Point.
- Candidates without valid projection cannot be selected for snap.

## MeasurementPickResult

Result consumed by `useXeokitMeasurementTools`.

```ts
type MeasurementPickResult = {
  hit: {
    entityId: string;
    objectId: string;
    worldPos: Vector3;
    source: MeasurementPickSourceId;
    candidateId: string;
  } | null;
  surfaceRefno: string | null;
  source: MeasurementPickSourceId | null;
  reason: string | null;
  candidates: MeasurementPickCandidate[];
};
```

Validation rules:

- `hit` is null when no enabled snap source resolves a candidate.
- `reason` explains the most relevant missing source or disabled setting.
- `surfaceRefno` is retained for hover-driven data loading.

## MeasurementPointSourceInfo

Optional metadata stored on new measurement points.

```ts
type MeasurementPointSourceInfo = {
  source: MeasurementPickSourceId;
  candidateId?: string;
  refno?: string | null;
  label?: string | null;
};
```

Validation rules:

- Existing records without `sourceInfo` remain valid.
- Source info must not be required to render geometry, only to explain provenance.

## PrimitiveKeyPointRow

Generated package row for primitive key points.

```ts
type PrimitiveKeyPointRow = {
  geoHash: string;
  keypointIndex: number;
  kind: string;
  localPos: [number, number, number];
  localDir?: [number, number, number] | null;
};
```

Validation rules:

- The table or manifest supplies unit metadata for `localPos`.
- `localPos` is multiplied by the primitive key point unit conversion factor before geometry and instance transforms.
- `localPos` is transformed by geometry transform, instance transform, and viewer global transform before display/snap.
- Rows are keyed by geometry identity, not duplicated per world instance.

## PrimitiveKeyPointUnitInfo

Unit metadata for primitive key point local coordinates.

```ts
type PrimitiveKeyPointUnitInfo = {
  sourceUnit: string;
  targetUnit: string;
  conversionFactor: number;
};
```

Validation rules:

- `conversionFactor` converts local coordinate values before transform composition.
- Missing unit metadata defaults only when the package contract explicitly declares the default.
