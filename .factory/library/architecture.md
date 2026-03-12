# Nearby Items Architecture

## Mission Scope

This mission implements a nearby-items flow that starts from the AMS viewer UI and ends with observable viewer focus/highlight behavior.

It spans two repositories:
- Frontend UI and viewer integration: `/Volumes/DPC/work/plant-code/plant3d-web`
- Backend spatial index and query API: `/Volumes/DPC/work/plant-code/plant-model-gen`

## Source-of-Truth Rules

- The spatial query source of truth is the SQLite RTree index in `../plant-model-gen/output/spatial_index.sqlite`.
- `spec_value` used for grouping must be available from the index-backed query response.
- Do not treat SurrealDB `inst_relate` as the authoritative source for nearby-item grouping in this mission.

## Expected Data Flow

1. User opens AMS project in the frontend viewer.
2. User opens the nearby-items entry from the left toolbar.
3. User searches by one of:
   - refno
   - position `(x, y, z)`
   - current selection in the viewer
4. Frontend sends the nearby query to backend spatial API.
5. Backend resolves the query against SQLite spatial index and returns:
   - `refno`
   - `noun`
   - `aabb`
   - `spec_value`
   - `query_bbox`
   - optional `truncated`
6. Frontend groups results by `spec_value` bucket.
7. Clicking a result drives viewer selection/highlight/focus for the same item.

## Frontend Integration Expectations

- Reuse the existing toolbar and left-panel patterns rather than inventing a new layout model.
- Keep query-mode controls, distance controls, and result grouping state explicit and user-visible.
- Avoid hidden coupling where the viewer reacts to a different refno than the result the user clicked.

## Backend Integration Expectations

- Preserve existing `mode=refno` behavior.
- Add `mode=position` without breaking current query clients.
- Return stable fallback values for missing `spec_value` so the frontend can render an uncategorized bucket.

## Highest-Risk Seams

- Empty or stale spatial index making the UI look finished while real nearby queries return nothing.
- `spec_value` being present in export data but not exposed through the API contract.
- Cross-repo AMS project context mismatches causing nearby results to target the wrong dataset.
- Viewer focus/highlight behavior drifting from the clicked nearby result identity.
