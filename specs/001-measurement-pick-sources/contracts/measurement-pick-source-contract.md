# Contract: Measurement Pick Source

## Purpose

Define the frontend contract shared by all measurement pick sources.

## Source IDs

| Source ID | Display Name | Data Lifecycle |
|-----------|--------------|----------------|
| `mesh_pick_point` | Mesh Pick Point | Transient cursor ray-pick result |
| `ptset` | PTSET | Existing component point set, loaded on hover and cached |
| `position` | Position | Instance origin derived from model transform data |
| `primitive_key_point` | Primitive Key Point | Generated geometry-template key points, loaded from model package data |

## Resolver Input

```ts
type ResolveMeasurementPickInput = {
  canvas: HTMLCanvasElement;
  event: PointerEvent;
  camera: Camera;
  baseSurfaceHit: {
    entityId: string;
    objectId: string;
    worldPos: Vector3;
    refno: string | null;
  } | null;
  settings: Record<MeasurementPickSourceId, MeasurementPickSourceSetting>;
};
```

## Resolver Output

The resolver returns:

- visible candidates for marker rendering;
- the selected snap hit, if any;
- the chosen source;
- a miss reason when no hit is available.

## Display And Snap Filtering

Candidate generation is source-specific and may run for any source that needs hover data. Display and snap are filtered independently:

- `show=true` includes that source's candidates in helper marker rendering.
- `show=false` hides that source's helper markers even when snap remains enabled.
- `snap=true` allows that source's candidates to participate in measurement selection.
- `snap=false` excludes that source from measurement selection even when markers remain visible.

Selection rule:

1. Exclude sources with `snap=false`.
2. Exclude candidates outside their source `thresholdPx`.
3. Sort by source priority.
4. Within the same priority, sort by screen-space pixel distance.
5. If still tied, sort by stable candidate ID.

## Default Source Settings

| Source | Display | Snap | Priority |
|--------|---------|------|----------|
| PTSET | on | on | 20 |
| Mesh Pick Point | off | off | 40 |
| Position | off | off | 30 |
| Primitive Key Point | off | off | 10 |

## UI Contract

The measurement panel provides a source matrix with two checkbox columns:

- Display
- Snap

Changing a checkbox updates measurement behavior without reloading the viewer.

## Compatibility Contract

`keypointSnapEnabled` remains a compatibility input during migration:

- When no new source settings exist, `true` maps to `ptset.show=true` and `ptset.snap=true`.
- When no new source settings exist, `false` maps to `ptset.show=false` and `ptset.snap=false`.
- `keypointSnapPx` maps to `ptset.thresholdPx` during first migration.
- New persisted source settings take precedence when present.

Existing measurement records without source metadata remain valid.
