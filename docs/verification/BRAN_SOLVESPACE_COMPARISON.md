# BRAN Fixture: SolveSpace Comparison Verification Guide

## Overview

This document provides a systematic manual verification process for comparing BRAN dimension annotations against SolveSpace reference behavior. Use this guide to visually verify that our `LinearDimension3D` implementation matches the golden standard.

**Reference Implementation:**
- File: `/Volumes/DPC/work/plant-code/solvespace/src/drawconstraint.cpp`
- Functions: `DoLineWithArrows()`, `DoArrow()`, `DoLineTrimmedAgainstBox()`

**Current Implementation:**
- File: `src/utils/three/annotation/annotations/LinearDimension3D.ts`
- Alignment Report: `LINEARDIMENSION3D_SOLVESPACE_ALIGNMENT_REPORT.md`

---

## Quick Launch

### Method 1: Direct URL
```
http://localhost:5173/?dtx_demo=mbd_pipe&mbd_pipe_case=bran_fixture
```

### Method 2: npm script (if available)
```bash
npm run demo:bran-fixture
```

### Method 3: E2E Screenshot Generation
```bash
npx playwright test mbd-bran-fixture
# Screenshots will be saved to e2e/screenshots/bran-comparison-*.png
```

---

## Test Fixture Details

**Data Source:** `src/fixtures/bran-test-data.json`

**Geometry:**
- 5 pipe segments with varying lengths (800mm, 600mm, 1000mm, 150mm, 900mm)
- Total branch length: 3450mm
- Contains representative cases: normal, short (crowded), and long segments

**Annotations:**
- 13 dimensions (5 segment, 5 chain, 1 overall, 2 port)
- 4 welds (Butt and Fillet, shop and field)
- 2 slopes (0.5%, 1.0%)
- 1 bend (45° angle)
- 3 fitting tags (elbow, tee, flange)

---

## Verification Scenarios

### Scenario 1: Normal Segment Dimensions

**What to verify:**
- Extension line overshoot is **exactly 10 pixels** beyond dimension line endpoint
- Open arrows use **V-line structure** (2 line segments per arrow)
- Arrow opening angle matches configured value (default: 18°)
- Dimension line is **trimmed** against label bounding box
- Label is **centered** on dimension line

**Test segment:** Segment 1 (0,0,0 → 800,0,0) or Segment 3 (800,600,0 → 1800,600,0)

**Screenshot:** `e2e/screenshots/bran-comparison-normal-segments.png`

**SolveSpace equivalents:**
```cpp
// Extension overshoot: out.WithMagnitude(10*pixels)
DoLine(canvas, hcs, a, ae.Plus(out.WithMagnitude(10*pixels)));

// Arrow V-line with angle theta
DoLine(canvas, hcs, p, p.Plus(dir.RotatedAbout(n,  angle)));
DoLine(canvas, hcs, p, p.Plus(dir.RotatedAbout(n, -angle)));
```

**Checklist:**
- [ ] Extension lines extend 10px beyond dimension line (use browser zoom to verify pixel count)
- [ ] Arrows form clear V-shape with symmetric angle
- [ ] Arrow size is consistent (default: 13px length)
- [ ] Dimension line has gap where label sits
- [ ] Label text is centered horizontally on dimension line
- [ ] No visual artifacts (z-fighting, flickering)

---

### Scenario 2: Crowded Short Segment (150mm)

**What to verify:**
- Arrow direction **reverses** when label is placed outside (arrows point outward)
- Extension lines from arrows to label endpoints are drawn when arrows are external
- Label can be positioned outside the measurement span without visual glitches
- Short segment rendering doesn't crash or produce NaN coordinates

**Test segment:** Segment 4 (1800,600,0 → 1950,600,0) - 150mm length

**Screenshot:** `e2e/screenshots/bran-comparison-short-segment-crowded.png`

**SolveSpace equivalent:**
```cpp
int within = DoLineTrimmedAgainstBox(canvas, hcs, ref, ae, be);
if(within != 0) {
    arrow = arrow.ScaledBy(-1);  // reverse arrows when label is outside
    // Draw extension segments from arrows to label
    DoLine(canvas, hcs, ae, ae.Plus(ab.WithMagnitude(ExtraSegmentLength)));
    DoLine(canvas, hcs, be, be.Plus(ab.Negated().WithMagnitude(ExtraSegmentLength)));
}
```

**Checklist:**
- [ ] Arrows point **outward** from the measurement span (not inward)
- [ ] Extension segments connect arrows to label (if label is far outside)
- [ ] Label is readable and not overlapping with adjacent dimensions
- [ ] Dimension line is continuous (no gaps except for label)
- [ ] No NaN warnings in console (check browser DevTools)

---

### Scenario 3: Chain Dimension Relationships

**What to verify:**
- Chain dimensions are **stacked** with consistent vertical offset from segment dimensions
- Overall dimension spans the **entire chain** with greater offset
- Visual hierarchy is clear: segment (green) → chain (yellow) → overall (white)
- All dimension types align properly (no misaligned extension lines)

**Test segments:** All 5 segments with corresponding chain and overall dimensions

**Screenshot:** `e2e/screenshots/bran-comparison-chain-dimensions.png`

**Layout expectations:**
```
        ┌─────────── Overall (white, largest offset) ──────────┐
        │                                                       │
    ┌───┴───┐    ┌────┴────┐    ┌───┴───┐    ┌─┴─┐    ┌───┴───┐
Chain:  800      600        1000      150      900        (yellow, medium offset)
    └───┬───┘    └────┬────┘    └───┬───┘    └─┬─┘    └───┬───┘
Segment: 800      600        1000      150      900        (green, closest to pipe)
    ────●────────────●────────────●────────●────────●────────●────
      (0,0,0)      (800,0,0)  (800,600,0) (1800)  (1950)  (2850)
```

**Checklist:**
- [ ] Segment dimensions are closest to the pipe geometry
- [ ] Chain dimensions are offset further from pipe than segments
- [ ] Overall dimension has the largest offset
- [ ] All dimensions use the same offset direction (perpendicular to pipe)
- [ ] Colors match expected mode (construction: green/yellow/white)
- [ ] No dimensions overlap or obscure each other

---

### Scenario 4: Inspection Mode - Port Dimensions

**What to verify:**
- Mode switch correctly filters dimension types
- Port dimensions replace segment/chain dimensions
- Overall dimension remains visible
- Color scheme changes to inspection mode palette
- No flickering or re-layout issues during mode switch

**Test:** Toggle between construction and inspection modes

**Screenshot:** `e2e/screenshots/bran-comparison-inspection-mode.png`

**Mode-specific visibility:**
| Dimension Kind | Construction Mode | Inspection Mode |
|----------------|-------------------|-----------------|
| Segment        | ✅ Visible (green) | ❌ Hidden        |
| Chain          | ✅ Visible (yellow)| ❌ Hidden        |
| Port           | ❌ Hidden         | ✅ Visible (blue) |
| Overall        | ✅ Visible (white) | ✅ Visible (white)|

**Checklist:**
- [ ] Construction mode shows segment + chain + overall
- [ ] Inspection mode shows port + overall (hides segment + chain)
- [ ] Mode switch is smooth (no visual glitches)
- [ ] Port dimensions span correct measurement ranges (per JSON fixture)
- [ ] Overall dimension remains stable across mode switches

---

### Scenario 5: Arrow and Extension Line Detail

**What to verify:**
- Arrow geometry uses **open style** (V-lines) not filled triangles
- Each arrow has exactly **2 line segments** forming the V-shape
- Extension lines are **perpendicular** to the original measurement line
- Extension lines **align** to pixel grid (no sub-pixel jitter)
- Arrow tips share the same point (meeting at dimension line endpoint)

**Best viewed:** Zoom in on any dimension arrow (e.g., first segment)

**Screenshot:** `e2e/screenshots/bran-comparison-arrow-detail.png`

**SolveSpace arrow construction:**
```cpp
void Constraint::DoArrow(Canvas *canvas, Canvas::hStroke hcs,
                         Vector p, Vector dir, Vector n, 
                         double width, double angle, double da) {
    dir = dir.WithMagnitude(width / cos(angle));  // adjust for angle
    dir = dir.RotatedAbout(n, da);                // optional offset rotation
    DoLine(canvas, hcs, p, p.Plus(dir.RotatedAbout(n,  angle)));  // upper line
    DoLine(canvas, hcs, p, p.Plus(dir.RotatedAbout(n, -angle)));  // lower line
}
```

**Checklist:**
- [ ] Each arrow is clearly a **V-shape** (not a filled triangle)
- [ ] Arrow lines meet at a single point (the dimension line endpoint)
- [ ] Arrow angle is symmetric (equal angle above and below)
- [ ] Arrow size is consistent across all dimensions
- [ ] Extension lines are perfectly perpendicular to measurement line
- [ ] No anti-aliasing artifacts at arrow tips

---

### Scenario 6: Overall View - All Annotation Types

**What to verify:**
- All annotation types render without conflicts
- Welds appear at connection points (4 total)
- Slopes appear on appropriate segments (2 total)
- Fitting tags appear at elbow, tee, flange positions (3 total)
- No z-fighting or overlapping annotation elements
- Scene is navigable (camera controls work)

**Screenshot:** `e2e/screenshots/bran-comparison-overall-view.png`

**Annotation inventory (from JSON):**
- **Dimensions:** 13 (5 seg + 5 chain + 1 overall + 2 port)
- **Welds:** 4 at coordinates (800,0,0), (800,600,0), (1800,600,0), (1950,600,0)
- **Slopes:** 2 on segments 1 (0.5%) and 3 (1.0%)
- **Bends:** 1 at (800,300,0) with 45° angle
- **Fitting Tags:** 3 (ELBO:T1, TEE:T1, FLAN:T1)

**Checklist:**
- [ ] All dimensions render (count: 8 in construction mode, 3 in inspection mode)
- [ ] All welds visible at correct positions
- [ ] Slope annotations show percentage text
- [ ] Fitting tags have correct labels
- [ ] No missing annotations (check console for errors)
- [ ] Scene performance is smooth (no lag during rotation)

---

## Known Differences (Acceptable)

These differences are expected and do not indicate bugs:

### 1. Font Rendering
- **SolveSpace:** TTF stroke font with direct OpenGL rasterization
- **plant3d-web:** SolveSpace vector font WOFF with SDF (Signed Distance Field) rendering
- **Impact:** Text may appear slightly different but should maintain same readability

### 2. Line Anti-aliasing
- **SolveSpace:** Varies by OpenGL implementation and driver settings
- **plant3d-web:** Three.js Line2 with built-in anti-aliasing
- **Impact:** Lines may appear smoother/softer in web version

### 3. Coordinate System
- **SolveSpace:** Right-handed Y-up system (typical CAD)
- **plant3d-web:** Right-handed Y-up Three.js system
- **Impact:** Should be identical; if orientations differ, report as bug

### 4. Pixel Alignment
- **SolveSpace:** Direct pixel grid snapping in screen space
- **plant3d-web:** TypeScript port of alignment logic
- **Impact:** Minor sub-pixel differences acceptable (<1px deviation)

---

## Debugging Failed Verifications

If any checklist item fails, use this diagnostic process:

### Issue: Extension lines don't overshoot 10px

**Diagnosis:**
1. Open browser DevTools → Console
2. Check for warnings related to `LinearDimension3D`
3. Inspect extension line geometry: `ext1Geometry`, `ext2Geometry`
4. Verify `instanceEnd` attribute has correct endpoint positions

**Expected code path:**
```typescript
const outDirUnitW = this.tmpWorldC;
outDirUnitW.copy(outDirW).normalize();  // ✓ normalized to unit length
const ext = 10 * wpp;  // exactly 10 world-pixels
this.tmpWorldF.copy(aeW).addScaledVector(outDirUnitW, ext);  // ✓ correct overshoot
```

**Fix:** Check `LINEARDIMENSION3D_SOLVESPACE_ALIGNMENT_REPORT.md` section on extension line overshoot.

---

### Issue: Arrows are filled triangles, not V-lines

**Diagnosis:**
1. Check arrow style setting: `mbd_arrow_style` URL param
2. Verify `arrowStyle` is set to `'open'` (default)
3. Inspect `arrowOpen1`, `arrowOpen2` line objects in scene
4. Check `instanceStart` attribute has exactly 2 segments

**Expected code path:**
```typescript
if (this.arrowStyle === 'open') {
  this.arrowOpen1.visible = true;
  this.arrow1.visible = false;  // hide filled mesh
  // arrowOpenGeometry1 should have instanceStart.count === 2
}
```

**Fix:** Ensure arrow style is not overridden to `'filled'` or `'tick'`.

---

### Issue: Arrows don't reverse on short segment

**Diagnosis:**
1. Check label position relative to measurement span
2. Verify `lineTrimmedAgainstBoxT()` returns non-zero `within` value
3. Inspect arrow direction vectors: should be negated when `within !== 0`
4. Check for extension segments from arrows to label

**Expected code path:**
```typescript
const within = lineTrimmedAgainstBoxT(/* ... */);
if (within !== 0) {
  // Reverse arrow direction
  this.tmpWorldG.copy(dirUnit).multiplyScalar(-13 * wpp);
  // Draw extension segments
  this.setLineGeometryFromWorld(/* arrows to label */);
}
```

**Fix:** Verify label positioning logic in `rebuild()` method.

---

### Issue: Dimensions missing or NaN coordinates

**Diagnosis:**
1. Check browser console for `NaN` or `Infinity` warnings
2. Verify JSON fixture has valid numeric coordinates
3. Inspect dimension parameters: `start`, `end`, `length`
4. Check for division by zero in offset calculation

**Expected validation:**
```typescript
if (distance < 1e-6) {
  console.warn('LinearDimension3D: degenerate dimension (distance too small)');
  return;
}
```

**Fix:** Ensure all JSON coordinates are valid numbers, not strings or null.

---

## Comparison Checklist Summary

Use this quick checklist when performing a full manual verification:

### Geometry Correctness
- [ ] Extension lines overshoot 10px beyond dimension line
- [ ] Arrows use open V-line style (2 segments each)
- [ ] Arrow angle is symmetric and matches configuration
- [ ] Dimension lines are trimmed against label boxes
- [ ] Labels are centered on dimension lines

### Layout Strategy
- [ ] Short segments (150mm) handle arrow reversal correctly
- [ ] Chain dimensions stack with consistent offset
- [ ] Overall dimension has largest offset from geometry
- [ ] No overlapping dimensions or annotations

### Visual Quality
- [ ] Lines are smooth with proper anti-aliasing
- [ ] Text is readable at all zoom levels
- [ ] Colors match mode (construction vs inspection)
- [ ] No z-fighting or flickering
- [ ] No visual artifacts at arrow tips or line joints

### Functional Behavior
- [ ] Mode switching works without glitches
- [ ] Camera navigation is smooth
- [ ] No console errors or warnings
- [ ] All annotation types render (dims, welds, slopes, tags)
- [ ] Scene loads within acceptable time (<3s)

### Cross-Reference Validation
- [ ] Dimension coordinates match JSON fixture (within 1mm)
- [ ] Dimension counts match JSON fixture (13 total)
- [ ] Weld positions match JSON fixture (4 welds)
- [ ] All segments represented (5 segments)

---

## Automated Validation

Before manual verification, ensure automated tests pass:

```bash
# Unit tests (geometry correctness)
npm test -- src/fixtures/bran-test-data.test.ts

# E2E tests (screenshot generation)
npx playwright test mbd-bran-fixture

# Full test suite
npm test
```

**Expected output:**
- Unit tests: ✅ 18 tests passed (including 6 geometry tests)
- E2E tests: ✅ 7 tests passed (7 screenshots generated)
- No console errors related to annotations

---

## Manual Verification Workflow

**Recommended process:**

1. **Run automated tests first** (ensures baseline correctness)
2. **Launch demo** using URL or npm script
3. **Go through scenarios 1-6** in order (follow checklists)
4. **Compare with SolveSpace screenshots** (if available)
5. **Document any discrepancies** in GitHub issue or report
6. **Re-test after fixes** to verify resolution

**Time estimate:** 15-20 minutes for complete verification

---

## Success Criteria

The BRAN fixture passes SolveSpace comparison if:

✅ All automated tests pass  
✅ All checklist items in Scenarios 1-6 are verified  
✅ No critical visual artifacts or geometry errors  
✅ Any differences fall within "Known Differences (Acceptable)"  
✅ Performance is smooth (no lag, crashes, or NaN errors)

**Result:** Implementation is considered **production-ready** for dimension annotation rendering.

---

## References

- **SolveSpace Source:** `/Volumes/DPC/work/plant-code/solvespace/src/drawconstraint.cpp`
- **Implementation Report:** `LINEARDIMENSION3D_SOLVESPACE_ALIGNMENT_REPORT.md`
- **Verification Report:** `BRAN_VERIFICATION_STRENGTHENING_REPORT.md`
- **Fixture Data:** `src/fixtures/bran-test-data.json`
- **Fixture Documentation:** `src/fixtures/README.md`
- **Implementation Code:** `src/utils/three/annotation/annotations/LinearDimension3D.ts`
- **Unit Tests:** `src/fixtures/bran-test-data.test.ts`
- **E2E Tests:** `e2e/mbd-bran-fixture.spec.ts`

---

## Version History

- **2026-03-10:** Initial comparison guide created with 7 verification scenarios
- **Future:** Add visual diff screenshots comparing SolveSpace vs plant3d-web side-by-side
