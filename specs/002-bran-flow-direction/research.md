# Research: BRAN Pipe Flow Direction

## Decision: Flow Direction Semantics

**Decision**: Treat each valid BRAN pipe segment's flow direction as `arrive -> leave`.

**Rationale**: The feature request explicitly names `segments[].arrive -> segments[].leave` as the v1 meaning. This is testable with existing fixture data and avoids hidden topology inference rules.

**Alternatives considered**:

- Infer flow from connected BRAN topology: rejected for v1 because it changes scope and would require additional domain rules beyond the existing segment contract.
- Wait for a backend direction field: rejected because the current frontend has enough segment coordinate data to satisfy v1.

## Decision: Overlay Scope

**Decision**: Implement one global session-scoped flow direction overlay for all valid currently loaded BRAN pipe segments.

**Rationale**: Existing MBD display controls are global toggles. A global overlay meets the review need and avoids adding partial selection semantics that are not requested.

**Alternatives considered**:

- Per-pipe, per-branch, or selected-object flow display: rejected for v1 because no user story requires local filtering.
- Persisted project or browser preference: rejected because the default view must stay uncluttered, and the user confirmed session-only state.

## Decision: Visibility Integration

**Decision**: Flow direction objects are visible only when both overall MBD pipe annotations and flow direction are enabled: `isVisible && showFlowDirection`.

**Rationale**: This matches the existing `applyVisibility()` pattern and keeps the overlay predictable when users hide all MBD annotations.

**Alternatives considered**:

- Tie flow direction to text/label visibility: rejected because the spec says it should not add labels and should be independent from MBD label controls.
- Tie flow direction to existing segment skeleton visibility: rejected because the flow overlay communicates direction, while segment skeleton visibility is a separate positioning/debug aid.

## Decision: Visual Treatment

**Decision**: Use a readable semi-transparent cyan/blue centerline and orange arrow markers, with weak depth occlusion so the overlay remains readable inside or near pipe geometry.

**Rationale**: Users enable the overlay specifically to inspect direction, and centerlines may be inside pipe geometry. Color separation makes the line and arrow roles distinct.

**Alternatives considered**:

- Strict depth-tested overlay: rejected because centerlines inside the pipe can disappear and fail the primary inspection task.
- Text labels: rejected because labels are explicitly out of scope and would add visual density.
- Animated flow: rejected because v1 is static.

## Decision: Arrow Density And Size

**Decision**: Place at least one arrow on each valid segment that is long enough to determine direction; place repeated arrows on longer segments with capped density and bounded size based on segment length and available diameter metadata.

**Rationale**: This handles short and long segments without making arrows too large or too dense.

**Alternatives considered**:

- Fixed one-arrow-per-segment display: rejected because long segments can become ambiguous.
- Fixed spacing without size bounds: rejected because very small or very large segments can become unreadable.

## Decision: Validation Strategy

**Decision**: Extend existing BRAN fixture tests and MBD UI tests rather than introducing a new broad test harness.

**Rationale**: `src/fixtures/bran-test-data.test.ts` already renders representative BRAN data through `useMbdPipeAnnotationThree`, and `MbdPipePanel.mode.test.ts` already mounts the panel with a mock `vis` object.

**Alternatives considered**:

- Full Playwright coverage as the first validation: deferred because targeted Vitest coverage can verify the rendering contract faster. Manual viewer validation remains in quickstart for final visual confidence.
