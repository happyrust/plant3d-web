# Feature Specification: BRAN Pipe Flow Direction

**Feature Branch**: `002-bran-flow-direction`

**Created**: 2026-06-15

**Status**: Draft

**Input**: User description: "Add a BRAN pipe flow direction overlay in plant3d-web MBD annotation rendering. The overlay is off by default and can be toggled from the MBD menu and MBD pipe annotation panel. Direction follows each segment's arrive-to-leave centerline, drawn as a readable blue centerline with repeated orange arrows."

## User Scenarios & Testing

### User Story 1 - Toggle Flow Direction Overlay (Priority: P1)

As a model reviewer inspecting MBD BRAN pipe annotations, I can turn pipe flow direction on or off without leaving the viewer, so I can reveal direction only when it helps my review and keep the default view uncluttered.

**Why this priority**: This is the minimum useful behavior. Users need an explicit control because the overlay adds visual density and must not change the default BRAN annotation appearance.

**Independent Test**: Open a model with BRAN pipe annotation data, verify the flow direction overlay is hidden by default, turn it on from an MBD display control, then turn it off again and confirm the overlay visibility changes immediately.

**Acceptance Scenarios**:

1. **Given** BRAN pipe annotations are loaded, **When** the user first opens the viewer, **Then** the flow direction overlay is not visible by default.
2. **Given** BRAN pipe annotations are visible, **When** the user enables the flow direction control, **Then** flow centerlines and arrows appear for valid pipe segments.
3. **Given** the flow direction overlay is visible, **When** the user disables the flow direction control, **Then** flow centerlines and arrows are hidden without hiding other BRAN annotation content.
4. **Given** the user refreshes the page or starts a new viewer session, **When** BRAN pipe annotations are loaded again, **Then** the flow direction overlay returns to its default hidden state.

---

### User Story 2 - Read Segment Flow Direction (Priority: P1)

As a model reviewer checking pipe routing, I can see the direction of each valid BRAN pipe segment along its centerline, so I can understand the intended arrive-to-leave flow without manually interpreting coordinate data.

**Why this priority**: A visible toggle has little value unless the direction markers are accurate, readable, and tied to the BRAN segment contract.

**Independent Test**: Load a representative BRAN fixture with segments in known directions, enable flow direction, and verify the first known segment points in the expected X direction and another known segment points in the expected Y direction.

**Acceptance Scenarios**:

1. **Given** a BRAN segment has both arrive and leave coordinates, **When** flow direction is enabled, **Then** the overlay shows a centerline from arrive to leave.
2. **Given** a BRAN segment has a non-zero arrive-to-leave direction, **When** flow direction is enabled, **Then** one or more arrows point from arrive toward leave.
3. **Given** a short but valid BRAN segment, **When** flow direction is enabled, **Then** at least one readable arrow is shown if the segment is long enough to determine direction.
4. **Given** a long valid BRAN segment, **When** flow direction is enabled, **Then** repeated arrows make the flow direction understandable along the segment without making the view excessively dense.

---

### User Story 3 - Keep Flow Direction Usable With Other MBD Visibility Controls (Priority: P2)

As a reviewer using existing MBD display controls, I need the flow direction overlay to behave consistently with BRAN annotation visibility, so I can predict when it will appear or disappear.

**Why this priority**: The feature is a new overlay within an existing annotation system. It must not confuse users by ignoring the overall MBD visibility state or unrelated label controls.

**Independent Test**: Toggle BRAN annotation visibility and the flow direction control in different orders, then verify flow direction is visible only when both the BRAN annotation group and the flow direction control are enabled.

**Acceptance Scenarios**:

1. **Given** flow direction is enabled, **When** the user hides BRAN pipe annotations, **Then** the flow direction overlay is hidden.
2. **Given** BRAN pipe annotations are visible and flow direction is disabled, **When** the user changes unrelated MBD label visibility controls, **Then** the flow direction overlay remains hidden.
3. **Given** BRAN pipe annotations are visible and flow direction is enabled, **When** the user hides unrelated MBD labels, **Then** the flow direction overlay remains controlled by the flow direction setting rather than label visibility.

---

### User Story 4 - Use Readable Visual Styling (Priority: P2)

As a model reviewer, I can distinguish flow direction from existing model geometry and labels, so I can read direction quickly without mistaking it for physical model content.

**Why this priority**: The overlay sits on top of dense 3D pipe geometry. It must be visually distinct and readable without becoming another source of clutter.

**Independent Test**: Enable flow direction on a representative BRAN pipe model and verify users can distinguish the centerline and arrowheads from the model, labels, and other annotations at common zoom levels.

**Acceptance Scenarios**:

1. **Given** flow direction is enabled, **When** the pipe segment is viewed inside or near pipe geometry, **Then** the centerline and arrows remain readable enough to determine direction.
2. **Given** flow direction is enabled, **When** the user views small and large pipe segments, **Then** arrow size stays within readable bounds and does not dominate the scene.
3. **Given** flow direction is enabled, **When** the scene contains other labels or annotation helpers, **Then** the flow overlay does not add text labels and remains visually distinct from label visibility controls.

### Edge Cases

- A BRAN segment is missing arrive coordinates, leave coordinates, or both.
- A BRAN segment has arrive and leave coordinates that are identical or too close to determine a stable direction.
- A BRAN model contains a mix of valid and invalid segments.
- A valid segment is very short and cannot fit repeated arrows.
- A valid segment is very long and could become visually crowded if arrows are too dense.
- The user toggles flow direction before or during BRAN annotation loading.
- The user toggles overall BRAN annotation visibility while flow direction is enabled.
- The BRAN annotation layer is cleared or replaced while flow direction objects are present.

## Requirements

### Functional Requirements

- **FR-001**: The system MUST provide a user-facing flow direction display control in the MBD display menu.
- **FR-002**: The system MUST provide a user-facing flow direction display control in the MBD pipe annotation panel.
- **FR-003**: The flow direction display control MUST be off by default for a new viewer session.
- **FR-004**: The flow direction display state MUST apply to all currently loaded valid BRAN pipe segments as a single global overlay.
- **FR-005**: The system MUST derive each segment's flow direction from the segment arrive coordinate toward the segment leave coordinate.
- **FR-006**: The system MUST show a centerline for each valid segment when BRAN pipe annotations are visible and flow direction display is enabled.
- **FR-007**: The system MUST show directional arrows for each valid segment when BRAN pipe annotations are visible and flow direction display is enabled.
- **FR-008**: The system MUST show at least one directional arrow for each valid segment that is long enough to determine a stable direction.
- **FR-009**: The system MUST show repeated directional arrows on longer segments while keeping arrow density low enough that the model remains readable.
- **FR-010**: The system MUST hide the flow direction overlay whenever overall BRAN pipe annotation visibility is hidden.
- **FR-011**: The system MUST keep flow direction display independent from MBD text or label visibility controls.
- **FR-012**: The system MUST skip segments with missing, incomplete, or directionless arrive/leave data without preventing valid segments from displaying.
- **FR-013**: The system MUST keep the flow direction overlay readable when it lies inside or near pipe geometry, using visual treatment that prioritizes review readability over strict physical occlusion.
- **FR-014**: The system MUST distinguish the flow centerline and directional arrows using clearly different visual styling.
- **FR-015**: The system MUST not add text labels as part of the flow direction overlay.
- **FR-016**: The system MUST clear flow direction overlay content when BRAN annotation content is cleared or replaced.
- **FR-017**: The system MUST allow users to toggle flow direction without reloading the page or reloading the model.

### Key Entities

- **BRAN Pipe Segment**: A pipe annotation segment with arrive and leave coordinates that define the intended centerline direction for this feature.
- **Flow Direction Overlay**: The user-visible centerline and arrow markers that communicate segment flow direction.
- **Flow Direction Display State**: A session-scoped on/off user preference for showing the flow direction overlay.
- **Valid Flow Segment**: A BRAN pipe segment that has complete, distinct arrive and leave coordinates sufficient to determine direction.

## Success Criteria

### Measurable Outcomes

- **SC-001**: A user can enable or disable flow direction from either supported MBD control location in two interactions or fewer.
- **SC-002**: With default settings, existing BRAN annotation views show no additional flow direction lines or arrows.
- **SC-003**: On a representative BRAN fixture, 100% of valid segments with complete arrive and leave coordinates produce direction markers when flow direction is enabled.
- **SC-004**: On a representative BRAN fixture with known segment directions, direction markers point from arrive to leave for all checked sample segments.
- **SC-005**: Toggling overall BRAN annotation visibility or flow direction visibility updates the overlay without requiring a model reload.
- **SC-006**: Invalid or incomplete segments do not block flow direction display for valid segments in the same model.

## Assumptions

- Flow direction semantics for this feature are fixed to arrive-to-leave for each segment.
- Flow direction display is session-scoped and is not persisted across page refreshes, projects, or viewer sessions.
- The v1 overlay is global for all valid BRAN pipe segments and does not support per-pipe, per-branch, or selected-object filtering.
- The v1 overlay is static and does not include animated flow effects.
- The v1 overlay applies only to MBD BRAN pipe annotation display and does not alter source model data, DTX data, or measurement records.
- The overlay may prioritize readability through pipe geometry when enabled, because users enable it specifically to inspect direction.
