# Nearby Items User Testing

## Primary Entry Path

1. Start backend on `3100`.
2. Start frontend on `3101`.
3. Open `http://127.0.0.1:3101`.
4. Enter `AMS 项目`.

## Manual Success Path Checklist

1. Confirm the viewer workspace loads and the nearby-items entry is visible in the left toolbar.
2. Open the nearby panel.
3. Run a nearby query from a selected viewer item.
4. Run a nearby query by manual `refno`.
5. Run a nearby query by manual `position(x, y, z)`.
6. Change the distance with the slider and confirm the manual field mirrors it.
7. Change the distance with the manual field and confirm the slider mirrors it.
8. Verify grouped results appear by `spec_value` bucket.
9. Verify at least one uncategorized bucket if fixture data contains missing or zero-like `spec_value`.
10. Click a result and confirm the same item becomes focused/highlighted in the viewer.

## Manual Edge Cases

- Empty query result produces a readable empty state.
- Backend/API failure produces a recoverable error state.
- Truncated result sets disclose that the visible list is incomplete.
- Reopening the panel does not duplicate panels or break result interactions.

## Evidence to Capture

- Screenshot of nearby toolbar entry in AMS viewer.
- Screenshot of grouped results.
- Screenshot or short note showing uncategorized grouping when applicable.
- Screenshot or observation showing clicked item matches viewer focus target.
- Command output for backend stats and nearby query smoke checks.

## Current Readiness Caveat

Nearby end-to-end user testing is only meaningful once `../plant-model-gen/output/spatial_index.sqlite` is non-empty and contains queryable AMS data. If stats still show zero elements, workers should limit claims to UI/API wiring and report the blocker explicitly.
