# Data Model: BRAN Pipe Flow Direction

## BRAN Pipe Segment

Represents one source pipe segment from the loaded MBD BRAN annotation data.

**Source fields**:

- `id`: Stable segment identifier used for object names, maps, and test lookup.
- `arrive`: Segment start coordinate. Required for flow rendering.
- `leave`: Segment end coordinate. Required for flow rendering.
- `outside_diameter` / `bore`: Optional size hints for bounded arrow sizing.
- `length`: Optional length metadata; rendered direction is still derived from coordinates.

**Validation rules**:

- `arrive` and `leave` must both exist and contain three finite coordinate values.
- The vector from `arrive` to `leave` must have non-zero length above the minimum stable threshold chosen by implementation.
- Invalid segments are skipped without failing the whole overlay.

## Valid Flow Segment

Derived domain object used only by the frontend overlay.

**Fields**:

- `segmentId`: Source BRAN segment id.
- `start`: Coordinate copied from `arrive`.
- `end`: Coordinate copied from `leave`.
- `direction`: Normalized vector from start to end.
- `length`: Distance between start and end.
- `diameterHint`: Optional numeric size hint derived from segment metadata.

**Relationships**:

- One valid flow segment belongs to exactly one BRAN pipe segment.
- One valid flow segment produces one centerline and one or more arrow markers.

## Flow Direction Overlay

Session-only visual layer for all valid flow segments.

**Fields**:

- `centerline`: Visual line from start to end.
- `arrows`: One or more arrow visuals aligned with `direction`.
- `segmentId`: Source segment id used for debugging and tests.
- `visible`: Derived visibility, not independently persisted.

**Relationships**:

- The overlay is attached to the existing MBD pipe annotation group so it receives the same global model matrix as other MBD annotations.
- The overlay is independent from text labels and existing segment skeleton objects.

## Flow Direction Display State

User-controlled session state.

**Fields**:

- `showFlowDirection`: Boolean. Defaults to `false` for each new composable/viewer session.
- Effective visibility: `isVisible && showFlowDirection`.

**State transitions**:

- Initial state: `showFlowDirection = false`, overlay hidden.
- User enables flow direction: overlay becomes visible if MBD pipe annotations are visible.
- User disables flow direction: overlay becomes hidden while remaining ready for future toggles.
- Overall MBD visibility hidden: overlay hidden even if `showFlowDirection = true`.
- BRAN data cleared/replaced: overlay objects are removed and the display state remains session-only.

## Cleanup Rules

- `clearAll()` removes flow centerlines and arrows and disposes their geometries.
- `dispose()` calls `clearAll()` and disposes flow materials.
- Re-rendering a branch replaces old flow objects with objects derived from the new current data.
