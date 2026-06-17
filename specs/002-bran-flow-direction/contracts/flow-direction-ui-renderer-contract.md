# Contract: Flow Direction UI And Renderer

## Purpose

Define the expected contract between MBD display controls, `useMbdPipeAnnotationThree`, and the rendered flow direction overlay.

## Composable Contract

`useMbdPipeAnnotationThree` exposes:

- `showFlowDirection: Ref<boolean>`
  - Default: `false`.
  - Scope: current viewer/composable session only.
  - Effective visibility: `isVisible.value && showFlowDirection.value`.

- `getFlowDirectionObjects(): Map<string, FlowDirectionObject>` or an equivalent test/debug accessor
  - Keyed by source segment id.
  - Used by tests to verify object count, visibility, cleanup, and direction.

`FlowDirectionObject` should provide enough structure for tests to inspect:

- `centerline`: the rendered line object for the segment.
- `arrows`: rendered arrow objects for the segment.
- `direction`: normalized direction vector or inspectable arrow orientation data.

The implementation may choose the concrete Three.js object types, but tests must be able to assert the source segment id and direction behavior.

## Renderer Contract

For each segment in current MBD pipe data:

1. If `arrive` or `leave` is missing, incomplete, non-finite, or directionless, no flow object is created for that segment.
2. If the segment is valid, create one centerline from `arrive` to `leave`.
3. If the segment is valid and long enough for stable direction, create at least one arrow pointing from `arrive` toward `leave`.
4. Longer segments may create multiple arrows, with capped density.
5. Flow objects are attached to the same MBD annotation group as other MBD pipe annotations so the existing global model matrix applies.
6. Flow objects do not create text labels and do not participate in MBD label visibility.

## Visibility Contract

| State | Expected Flow Direction Visibility |
|-------|------------------------------------|
| `isVisible=false`, `showFlowDirection=false` | Hidden |
| `isVisible=false`, `showFlowDirection=true` | Hidden |
| `isVisible=true`, `showFlowDirection=false` | Hidden |
| `isVisible=true`, `showFlowDirection=true` | Visible for valid segments |

Changing unrelated label or text visibility controls must not change `showFlowDirection`.

## MBD Pipe Panel Contract

The MBD pipe annotation panel includes a flow direction checkbox in the existing display checkbox area.

Expected behavior:

- Label text: `流向`.
- Checked state reads `vis.showFlowDirection.value`.
- Change handler toggles `vis.showFlowDirection.value`.
- The checkbox is visible with other display controls, not gated behind debug UI.

## Ribbon Contract

The MBD ribbon display controls include a flow direction button.

Expected config:

- `id`: `mbd.flow_direction`
- `commandId`: `mbd.flow_direction`
- `label`: `流向`
- `icon`: existing suitable icon such as `trending_up`

Expected command behavior in the viewer:

- Toggle `mbdPipeVisRef.value.showFlowDirection.value` when the composable exists.
- Request a render after toggling.
- Do not alter `showLabels`, `showSegments`, or `isVisible`.

## Cleanup Contract

- `clearAll()` empties the flow direction object collection and disposes flow geometries.
- `dispose()` disposes flow materials in addition to existing MBD materials.
- Rendering new BRAN data replaces any previous flow objects.
