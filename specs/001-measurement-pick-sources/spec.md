# Feature Specification: Measurement Pick Sources

**Feature Branch**: `001-measurement-pick-sources`

**Created**: 2026-06-09

**Status**: Draft

**Input**: User description: "Implement selectable measurement point sources in plant3d-web for position, mesh pick point, ptset, and primitive key points; provide checkbox controls for display and snap in measurement mode; use Spec Kit to orchestrate the feature."

## User Scenarios & Testing

### User Story 1 - Choose Visible And Snappable Point Sources (Priority: P1)

As a model reviewer measuring 3D plant geometry, I can choose which measurement point sources are displayed and which sources can be used for snap, so I can measure against the point set that matches the task.

**Why this priority**: This is the minimum useful change. Without source-level display and snap controls, the viewer remains limited to the current ptset-only behavior and cannot support the requested measurement workflows.

**Independent Test**: Open a model in measurement mode, toggle the source display/snap checkboxes, verify PTSET remains the default source, and verify Mesh Pick Point can be accepted when explicitly snap-enabled.

**Acceptance Scenarios**:

1. **Given** a loaded model with ptset point data, **When** PTSET display and snap are enabled and the user hovers a component, **Then** ptset markers appear and clicks near a ptset marker create measurement points snapped to PTSET.
2. **Given** PTSET snap is disabled and Mesh Pick Point snap is enabled, **When** the user clicks a model surface in measurement mode, **Then** the clicked surface point can be registered as the measurement point.
3. **Given** a source display checkbox is disabled, **When** the user hovers the model, **Then** helper markers for that source are hidden without changing other enabled sources.
4. **Given** a source snap checkbox is disabled, **When** the cursor is close to a point from that source, **Then** that point source is ignored for measurement registration.

---

### User Story 2 - Resolve Multiple Candidate Sources Deterministically (Priority: P2)

As a user measuring dense or overlapping geometry, I need the viewer to choose a predictable snap target when multiple enabled sources are near the cursor, so repeated clicks produce consistent results.

**Why this priority**: Once multiple point sources exist, ambiguous snap behavior can create wrong measurements even if each individual source works.

**Independent Test**: Enable two or more snap sources that have nearby candidates, move the cursor within the snap threshold, and verify that the same candidate is selected repeatedly according to a documented priority and distance rule.

**Acceptance Scenarios**:

1. **Given** primitive key point and PTSET candidates are both within the snap threshold, **When** the user clicks once, **Then** the higher-priority source is selected consistently.
2. **Given** two candidates from the same source are within the snap threshold, **When** the user clicks, **Then** the candidate with the smallest screen distance to the cursor is selected.
3. **Given** no enabled source has a candidate within the threshold, **When** the user clicks, **Then** the viewer does not create a measurement point and shows a clear reason.

---

### User Story 3 - Measure From Position And Primitive Key Points (Priority: P3)

As a model reviewer checking generated geometry, I can display and snap to instance position points and primitive key points, so measurements can reference generated model structure rather than only PTSET or mesh surfaces.

**Why this priority**: Position and primitive key points are required for deeper generated-model inspection, but primitive key point availability depends on a generated data contract that must be defined before full implementation.

**Independent Test**: Load a model package that contains position and primitive key point data, enable those sources, and verify that markers appear at the expected model locations and can be used for distance, angle, point elevation, and elevation delta measurement.

**Acceptance Scenarios**:

1. **Given** Position display is enabled, **When** the user hovers or selects an instance with a known position, **Then** the position marker appears at that instance position.
2. **Given** Position snap is enabled, **When** the cursor is within the snap threshold of a position marker, **Then** the measurement point locks to that position.
3. **Given** Primitive Key Point display and snap are enabled and the model package provides primitive key point data, **When** the user hovers an instance, **Then** primitive key point markers appear and can be used as snap targets.
4. **Given** primitive key point data is unavailable, **When** the user enables Primitive Key Point display or snap, **Then** the viewer reports that the source is unavailable and keeps other sources usable.

---

### User Story 4 - Preserve And Explain Measurement Records (Priority: P3)

As a reviewer revisiting saved measurements, I can see or infer what source each measured point used, while older measurement records still render correctly.

**Why this priority**: Multi-source measurement needs traceability, but compatibility with existing records is required before rollout.

**Independent Test**: Create measurements using different enabled sources, reload the viewer, and verify that records render, summarize, and identify their point source where available; then load older records without source metadata and verify they still render.

**Acceptance Scenarios**:

1. **Given** a new measurement uses PTSET, Position, Primitive Key Point, or Mesh Pick Point, **When** it appears in the measurement list, **Then** the point source is available for display, debugging, or formatting.
2. **Given** an older measurement record without source metadata, **When** the viewer loads it, **Then** the measurement still renders and formats without data migration errors.

### Edge Cases

- The model is loaded but no enabled point source has data for the hovered object.
- The cursor is over empty space while a measurement draft is active.
- A source is visible but not snap-enabled.
- A source is snap-enabled but not visible.
- Multiple enabled sources return candidates at the same screen distance.
- A user toggles source settings while a distance, angle, elevation point, or elevation delta draft is active.
- PTSET or primitive key point data arrives asynchronously after the user has already hovered or clicked.
- Old measurements without source metadata are loaded from persisted viewer state.

## Requirements

### Functional Requirements

- **FR-001**: The system MUST provide measurement-mode controls for Mesh Pick Point, PTSET, Position, and Primitive Key Point sources.
- **FR-002**: Each measurement point source MUST have an independent display toggle.
- **FR-003**: Each measurement point source MUST have an independent snap toggle.
- **FR-004**: The system MUST ignore disabled snap sources when registering measurement points.
- **FR-005**: The system MUST hide helper markers for sources whose display toggle is disabled.
- **FR-006**: The system MUST preserve the existing PTSET measurement experience by default for users who do not enable additional sources.
- **FR-007**: The system MUST support the selected point sources for distance, angle, point elevation, and elevation delta measurement modes.
- **FR-008**: The system MUST choose snap candidates deterministically when multiple enabled candidates are available.
- **FR-009**: The system MUST use screen-space snap distance so snap behavior remains stable across zoom levels.
- **FR-010**: The system MUST show a clear status message when no enabled source can provide a measurement point.
- **FR-011**: The system MUST represent the source of newly created measurement points where source information is available.
- **FR-012**: The system MUST continue to render and format older measurement records that do not contain point source metadata.
- **FR-013**: The system MUST handle missing PTSET, Position, or Primitive Key Point data without blocking other enabled sources.
- **FR-014**: The system MUST support changing source display and snap settings without requiring a page reload.
- **FR-015**: Display state and snap state MUST be independent: hiding a source hides its helper markers, and disabling snap prevents selection, but changing one state MUST NOT implicitly rewrite the other state.

### Key Entities

- **Measurement Point Source**: A domain category of candidate measurement points. Includes Mesh Pick Point, PTSET, Position, and Primitive Key Point.
- **Source Setting**: The user-selected display state, snap state, snap threshold, and priority for a point source.
- **Pick Candidate**: A point that can be considered for measurement, including its source, world position, related object reference, and optional label.
- **Measurement Point**: A point stored in a measurement record, including world position and optional source metadata.
- **Measurement Record**: A saved distance, angle, point elevation, or elevation delta measurement.

## Success Criteria

### Measurable Outcomes

- **SC-001**: A user can enable or disable display and snap for any supported point source in three interactions or fewer from the measurement panel.
- **SC-002**: Existing PTSET distance and angle measurement behavior remains usable with default settings on a model that contains PTSET data.
- **SC-003**: When Mesh Pick Point snap is enabled and PTSET snap is disabled, a user can create a surface-based measurement point with one click on visible model geometry.
- **SC-004**: When two enabled sources provide nearby candidates, repeated clicks at the same cursor location choose the same source and point in 100% of attempts.
- **SC-005**: Toggling a source display checkbox updates visible helper markers on the next hover or render update without reloading the page.
- **SC-006**: A missing optional point source produces a user-visible reason while at least one other enabled source remains usable.

## Assumptions

- Position means the instance placement/origin point exposed by the model transform data, not the bounding-box center.
- Mesh Pick Point means the transient surface point returned by the viewer ray pick at the cursor, not a precomputed dense point set.
- Primitive Key Point means points derived from generated primitive geometry definitions, transformed into the instance/world coordinate space.
- PTSET remains the default visible and snappable source so current measurement workflows do not regress.
- Mesh Pick Point snap is off by default to preserve current ptset-focused measurement behavior.
- Primitive Key Point support may require a generated model package that explicitly includes primitive key point data.
