# Quickstart: Measurement Pick Sources

## Prerequisites

- `plant3d-web` dependencies are installed.
- A generated model package is available with existing PTSET data.
- For Primitive Key Point validation, the model package includes `primitive_keypoints.parquet` and a manifest entry for it.

## Start The Viewer

```powershell
cd D:\work\plant-code\plant3d-web
npm run dev -- --host 127.0.0.1 --port 3101
```

Open the viewer URL that loads a known model package. If the project data supports it, use the known BRAN refno `24381_145018` as a validation target.

## Validate Default PTSET Behavior

1. Open the measurement panel.
2. Confirm PTSET display and snap are enabled by default.
3. Start distance measurement.
4. Hover a component with PTSET data.
5. Confirm PTSET markers appear.
6. Click near a PTSET marker.
7. Confirm the measurement point locks to PTSET and the draft continues.

Expected result: Existing PTSET measurement behavior still works without enabling additional sources.

## Validate Mesh Pick Point Fallback

1. Disable PTSET snap.
2. Enable Mesh Pick Point snap.
3. Start distance measurement.
4. Click on visible model surface.

Expected result: The clicked surface point becomes the measurement point. If Mesh Pick Point display is enabled, a transient marker follows the cursor surface hit.

## Validate Source Display Toggles

1. Enable PTSET display and Mesh Pick Point display.
2. Disable PTSET display while leaving Mesh Pick Point display enabled.
3. Hover the same object.

Expected result: PTSET markers disappear and Mesh Pick Point hover feedback remains available. Snap behavior follows the independent snap checkboxes.

## Validate Position Source

1. Enable Position display and snap.
2. Hover an instance with a known transform origin.
3. Click near the position marker.

Expected result: Position marker appears at the instance origin and can be selected when Position snap is enabled. If Position is not implemented in the current milestone, the source reports unavailable instead of affecting PTSET or Mesh Pick Point.

## Validate Priority

1. Enable snap for two sources that have nearby candidates.
2. Click repeatedly at the same cursor location.

Expected result: The same source and candidate are selected each time according to source priority and pixel distance.

## Validate Primitive Key Point

1. Load a package with primitive key point data.
2. Enable Primitive Key Point display and snap.
3. Hover a component whose geometry has primitive key points.
4. Start distance, angle, point elevation, and elevation delta measurements using primitive key points.

Expected result: Primitive key point markers appear at transformed geometry key point locations after local unit conversion and can be used in every xeokit measurement mode.

## Compatibility Check

1. Load existing persisted measurements created before this feature.
2. Confirm they render and format without source metadata.
3. Create a new measurement using a non-PTSET source.
4. Reload the viewer.

Expected result: Old records remain readable. New records keep optional point source metadata.

## Verification Commands After Implementation

```powershell
npm run type-check
npm run lint
```
