# Contract: Primitive Key Points Model Package Data

## Purpose

Define the generated model package data needed for the Primitive Key Point measurement source.

## File

`primitive_keypoints.parquet`

The file is optional. If absent, the frontend reports Primitive Key Point as unavailable and leaves other sources usable.

## Manifest Entry

The dbno model manifest should include an optional entry:

```json
{
  "tables": {
    "primitive_keypoints": {
      "file": "primitive_keypoints.parquet"
    }
  },
  "primitive_keypoint_unit": {
    "source": "mm",
    "target": "mm",
    "conversion_factor": 1.0,
    "coordinate_space": "geo_local"
  }
}
```

## Schema

| Column | Type | Required | Description |
|--------|------|----------|-------------|
| `geo_hash` | Utf8 | yes | Geometry-template identity used by instance geometry rows |
| `keypoint_index` | Int32 | yes | Stable point index within the geometry template |
| `kind` | Utf8 | yes | Semantic point type, such as origin, start, end, center, or corner |
| `local_x` | Float64 | yes | X coordinate in geometry-local units |
| `local_y` | Float64 | yes | Y coordinate in geometry-local units |
| `local_z` | Float64 | yes | Z coordinate in geometry-local units |
| `has_dir` | Boolean | yes | Whether a direction vector is present |
| `dir_x` | Float64 | yes | Direction X when `has_dir=true`, otherwise 0 |
| `dir_y` | Float64 | yes | Direction Y when `has_dir=true`, otherwise 0 |
| `dir_z` | Float64 | yes | Direction Z when `has_dir=true`, otherwise 0 |
| `source` | Utf8 | no | Producer hint, such as `geo_param.key_points` |

## Unit Rules

Primitive key point local coordinates are in the manifest `primitive_keypoint_unit.source` unit and `geo_local` coordinate space. The frontend multiplies `local_x`, `local_y`, and `local_z` by `primitive_keypoint_unit.conversion_factor` before applying geometry-local, instance/world, and global viewer transforms.

If `primitive_keypoint_unit` is missing, or `coordinate_space` is not `geo_local`, the package must be treated as contract-incomplete unless the implementation deliberately supports an explicit legacy default.

## Frontend Resolution

For a hovered instance:

1. Resolve refno/objectId to instance geometry rows.
2. Read `geo_hash` for each geometry row.
3. Query primitive key point rows by `geo_hash`.
4. Apply primitive key point unit conversion to the local point.
5. Transform local point by geometry transform.
6. Transform by instance/world transform.
7. Apply viewer global model matrix.
8. Present resulting scene-space points as candidates for display and snap.

## Error Handling

- Missing manifest entry: source unavailable.
- Missing file: source unavailable.
- Missing unit metadata: source unavailable unless an explicit legacy default is configured.
- Empty rows for a hovered geometry: no candidates for that geometry.
- Transform missing or invalid: skip that candidate and report a source warning.

## Backend Note

The expected backend source is the primitive geometry key point capability in `plant-model-gen`. The export should avoid duplicating points per world instance when geometry-template identity and transforms are sufficient.
