# Research: Measurement Pick Sources

## Current Capability Audit

- `plant-model-gen/src/web_api/ptset_api.rs` already exposes `GET /api/pdms/ptset/{refno}` and `POST /api/pdms/ptset/batch-query`, returning ptset points plus `world_transform` and unit information.
- `plant-model-gen/src/fast_model/export_model/export_dbnum_instances_parquet.rs` already exports `ptsets.parquet`, adds it to the manifest as `tables.ptsets`, and keys rows by `cata_hash + point_number`.
- `plant3d-web/src/composables/useDbnoInstancesParquetLoader.ts` reads ptset data from the Parquet package by resolving an instance `refno` to `cata_hash`, then querying `ptsets.parquet`.
- `plant3d-web/src/composables/usePtsetVisualizationThree.ts` can draw ptset crosses, labels, and arrows; `PtsetPanel.vue` exposes those visual toggles for the standalone ptset panel.
- `plant3d-web/src/composables/useXeokitMeasurementTools.ts` can draw lightweight ptset crosses while measuring and can snap to cached ptset candidates. A measured point is registered as `ptset:<refno>#<point_number>`.
- Current measurement behavior is ptset-only: the mesh surface pick is used to identify the hovered instance/refno and seed ptset lookup, but ordinary surface points are rejected when ptset snap misses.
- Current measurement UI only has one ptset snap checkbox and a pixel threshold. It does not yet provide independent display/snap checkboxes for `Position`, `Mesh Pick Point`, `PTSET`, and `Primitive Key Point`.

## Decision: Use A Source Resolver Instead Of Expanding `pickSurfacePoint()`

**Rationale**: Current measurement picking is ptset-specific. Adding Mesh Pick Point, Position, and Primitive Key Point directly to that function would mix display, async loading, snap priority, and miss-message logic. A resolver keeps each point source independently testable and allows future sources to register through the same contract.

**Alternatives considered**:

- Add source-specific branches to `useXeokitMeasurementTools.ts`: rejected because it would preserve the ptset-only coupling.
- Add a generic "all keypoints" list: rejected because Mesh Pick Point is not a precomputed point set and Position/PTSET/Primitive have different data lifecycles.

## Decision: Preserve PTSET Defaults

**Rationale**: Existing behavior requires hover ptset display and ptset snap. The new feature should not silently turn on mesh surface fallback because that would change measurement meaning.

**Alternatives considered**:

- Enable all sources by default: rejected because dense candidates and mesh fallback could hide PTSET regressions.
- Disable PTSET by default until the user opts in: rejected because it breaks current behavior.

## Decision: Define Position As Instance Origin

**Rationale**: The existing model package already exposes instance/refno transform information. The instance origin is deterministic and useful for placement-based measurement. Bounding-box center is visually intuitive but changes with geometry and LOD, so it is not a stable "position" point.

**Alternatives considered**:

- AABB center: rejected because it is geometry-derived and not a placement point.
- PDMS POS attribute: deferred because the frontend currently has a transform-driven loader path and POS availability is not guaranteed in every package.

## Decision: Primitive Key Point Requires A Generated Data Contract

**Rationale**: `plant-model-gen` has runtime primitive key point capability through geometry parameters, but the current frontend package only has a complete PTSET path. Primitive key points should be exported as template-local points keyed by geometry identity, then transformed per instance in the frontend.

**Alternatives considered**:

- Compute primitive key points in the frontend from meshes: rejected because mesh geometry does not reliably preserve semantic primitive key points.
- Export per-instance world key points: rejected as larger and less consistent with the existing geometry-template plus transform model.

## Decision: Primitive Local Coordinates Carry Unit Metadata

**Rationale**: PTSET coordinates already carry unit information before transform composition. Primitive key point coordinates must do the same, otherwise local key points can be transformed in the wrong length unit and render away from the geometry.

**Alternatives considered**:

- Assume primitive local coordinates use the same units as transforms: rejected because generated packages may mix source coordinate units with viewer global transforms.
- Add per-row unit columns: rejected because the unit is package/table-level metadata, not point-specific data.

## Decision: Store Optional Source Metadata On Measurement Points

**Rationale**: New measurements should be explainable, but old records should remain compatible. Optional metadata gives traceability without forcing a migration.

**Alternatives considered**:

- Encode source only in `entityId`: rejected because it is brittle and hard to format consistently.
- Require a migration for all old records: rejected because existing records can render without source metadata.

## Decision: Manual Real-Data Validation Is The Primary Gate

**Rationale**: The feature is heavily viewer- and data-package-dependent. Type checking catches TS regressions, but final correctness requires loading a model and validating visible markers and snap behavior.

**Alternatives considered**:

- Add broad new unit tests before implementation: deferred because the repo guidance discourages one-off tests unless CLI/manual validation cannot cover key behavior.
