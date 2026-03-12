# BRAN SolveSpace Comparison - Quick Verification Checklist

**Purpose:** Fast manual verification of dimension annotation rendering against SolveSpace reference behavior.

**Launch:** `http://localhost:5173/?dtx_demo=mbd_pipe&mbd_pipe_case=bran_fixture`

**Time:** ~10-15 minutes for complete verification

---

## Pre-Flight Check

```bash
# 1. Run automated tests (must pass before manual verification)
npm test -- src/fixtures/bran-test-data.test.ts

# 2. Generate E2E screenshots
npx playwright test mbd-bran-fixture

# 3. Start dev server
npm run dev
```

**Expected:**
- [ ] All unit tests pass (18 tests)
- [ ] All E2E tests pass (7 scenarios)
- [ ] Dev server running on http://localhost:5173

---

## Camera Presets (Use from Browser Console)

```javascript
// Access camera presets
const presets = window.branCameraPresets;
const viewer = window.dtxViewer;

// Jump to verification views
presets.normalSegments(viewer);      // Normal dimensions
presets.shortSegment(viewer);        // Crowded 150mm segment
presets.chainRelationships(viewer);  // Stacked chain dims
presets.arrowDetail(viewer);         // Arrow close-up
presets.overallView(viewer);         // Full scene
presets.verticalSegment(viewer);     // Vertical pipe
presets.teeFitting(viewer);          // TEE area
```

---

## Scenario 1: Normal Segment Dimensions ⏱️ 2 min

**Camera:** `presets.normalSegments(viewer)` or manual view of segments 1 & 3

**What to check:**
- [ ] Extension lines extend **exactly 10px** beyond dimension line endpoints
- [ ] Arrows use **open V-line style** (not filled triangles)
- [ ] Arrow angle is **symmetric** (equal above/below dimension line)
- [ ] Dimension line has **clean gap** where label sits (trimmed)
- [ ] Label is **horizontally centered** on dimension line
- [ ] No z-fighting or flickering on lines

**Pass criteria:** All 6 items checked ✅

---

## Scenario 2: Crowded Short Segment (150mm) ⏱️ 2 min

**Camera:** `presets.shortSegment(viewer)` (focuses on segment 4)

**What to check:**
- [ ] Arrows point **outward** from measurement span (reversed)
- [ ] Label is **outside** the 150mm measurement span
- [ ] Extension segments connect arrows to label (if label is far)
- [ ] Dimension line is continuous (no breaks except label)
- [ ] No NaN errors in browser console
- [ ] Adjacent dimensions don't overlap with short segment

**Pass criteria:** All 6 items checked ✅

---

## Scenario 3: Chain Dimension Relationships ⏱️ 3 min

**Camera:** `presets.chainRelationships(viewer)` (side view showing stacking)

**What to check:**
- [ ] **Segment dims (green)** are closest to pipe
- [ ] **Chain dims (yellow)** have medium offset from pipe
- [ ] **Overall dim (white)** has largest offset from pipe
- [ ] All dimensions use same offset direction (perpendicular to pipe)
- [ ] No overlapping dimensions at any level
- [ ] Visual hierarchy is clear: green → yellow → white

**Layout verification:**
```
Overall: ────────────────────────────── (white, far)
Chain:   ────┴────┴────┴──┴────         (yellow, medium)
Segment: ────┴────┴────┴──┴────         (green, near)
Pipe:    ════●════●════●══●════         (geometry)
```

**Pass criteria:** All 6 items checked ✅

---

## Scenario 4: Arrow & Extension Detail ⏱️ 2 min

**Camera:** `presets.arrowDetail(viewer)` (close-up on first segment)

**What to check:**
- [ ] Each arrow is a clear **V-shape** (2 line segments)
- [ ] Arrow lines meet at a **single point** (dimension line endpoint)
- [ ] Arrow angle appears **symmetric** (~18° above/below)
- [ ] Extension lines are **perpendicular** to measurement line
- [ ] Extension lines **align to pixel grid** (no jitter)
- [ ] No anti-aliasing artifacts at arrow tips

**Zoom in:** Use browser zoom (Cmd/Ctrl +) to verify pixel-level details

**Pass criteria:** All 6 items checked ✅

---

## Scenario 5: Overall View - All Annotations ⏱️ 2 min

**Camera:** `presets.overallView(viewer)` (isometric of full branch)

**What to check:**
- [ ] All **dimensions visible** (8 in construction mode)
- [ ] All **4 welds** visible at pipe connections
- [ ] **2 slope annotations** visible with percentage text
- [ ] **3 fitting tags** visible (ELBO, TEE, FLAN)
- [ ] No z-fighting between annotation layers
- [ ] Camera navigation is smooth (no lag)

**Annotation inventory (from JSON):**
- Dimensions: 5 segment + 5 chain + 1 overall = 11 visible (construction mode)
- Welds: 4 at (800,0,0), (800,600,0), (1800,600,0), (1950,600,0)
- Slopes: 2 on segments 1 and 3
- Tags: 3 fitting labels

**Pass criteria:** All 6 items checked ✅

---

## Scenario 6: Inspection Mode Switch ⏱️ 2 min

**Action:** Toggle mode to "校核" (inspection) if UI available, or via console:
```javascript
window.__mbdPipeModeStore?.setMode('inspection');
```

**What to check:**
- [ ] **Segment dims disappear** (green ones hidden)
- [ ] **Chain dims disappear** (yellow ones hidden)
- [ ] **Port dims appear** (blue, 2 total)
- [ ] **Overall dim remains** (white, still visible)
- [ ] Mode switch is smooth (no glitches)
- [ ] No console errors during mode change

**Mode visibility table:**
| Dim Type | Construction | Inspection |
|----------|-------------|------------|
| Segment  | ✅ Green     | ❌ Hidden   |
| Chain    | ✅ Yellow    | ❌ Hidden   |
| Port     | ❌ Hidden    | ✅ Blue     |
| Overall  | ✅ White     | ✅ White    |

**Pass criteria:** All 6 items checked ✅

---

## Scenario 7: Vertical Segment ⏱️ 1 min

**Camera:** `presets.verticalSegment(viewer)` (segment 2: vertical pipe)

**What to check:**
- [ ] Dimension renders correctly on **vertical pipe**
- [ ] Extension lines extend perpendicular to vertical line
- [ ] Arrows and labels are readable
- [ ] No coordinate system issues (Y-axis handling)

**Pass criteria:** All 4 items checked ✅

---

## Known Acceptable Differences

These are **NOT bugs** (document if you see them):

✅ **Font appearance:** Text may look slightly different (SDF vs TTF rendering)  
✅ **Line smoothness:** Lines may be smoother (Three.js anti-aliasing)  
✅ **Pixel alignment:** Sub-pixel differences <1px are OK  
✅ **Color tones:** Minor color variations due to display/gamma settings  

---

## Failure Response

If any item fails:

1. **Document failure:**
   - Screenshot of issue
   - Which scenario failed
   - Specific checklist item(s)
   - Browser and OS version

2. **Check console:**
   ```javascript
   // Look for errors/warnings
   console.log('Check for NaN, Infinity, or annotation errors');
   ```

3. **Reference debug guide:**
   See `BRAN_SOLVESPACE_COMPARISON.md` → "Debugging Failed Verifications"

4. **Report:**
   - GitHub issue with "BRAN verification failure" label
   - Include screenshots and console output
   - Tag with `dimension-annotation` and `solvespace-parity`

---

## Final Sign-Off

**Date:** _______________  
**Tester:** _______________  
**Browser:** _______________ (Chrome/Firefox/Safari + version)  
**OS:** _______________ (macOS/Windows/Linux + version)

**Results:**
- [ ] Scenario 1: Normal segments — **PASS** ☐ FAIL ☐
- [ ] Scenario 2: Short segment — **PASS** ☐ FAIL ☐
- [ ] Scenario 3: Chain relationships — **PASS** ☐ FAIL ☐
- [ ] Scenario 4: Arrow detail — **PASS** ☐ FAIL ☐
- [ ] Scenario 5: Overall view — **PASS** ☐ FAIL ☐
- [ ] Scenario 6: Inspection mode — **PASS** ☐ FAIL ☐
- [ ] Scenario 7: Vertical segment — **PASS** ☐ FAIL ☐

**Overall Result:**
- [ ] ✅ **PASS** — All scenarios verified, ready for production
- [ ] ⚠️ **CONDITIONAL PASS** — Minor issues documented, acceptable for release
- [ ] ❌ **FAIL** — Critical issues found, fixes required

**Notes:**
```
(Add any observations, edge cases, or recommendations here)




```

**Signature:** _______________

---

## Quick Reference Links

- **Full Documentation:** `docs/verification/BRAN_SOLVESPACE_COMPARISON.md`
- **SolveSpace Source:** `/Volumes/DPC/work/plant-code/solvespace/src/drawconstraint.cpp`
- **Alignment Report:** `LINEARDIMENSION3D_SOLVESPACE_ALIGNMENT_REPORT.md`
- **Fixture Data:** `src/fixtures/bran-test-data.json`
- **E2E Tests:** `e2e/mbd-bran-fixture.spec.ts`
- **Unit Tests:** `src/fixtures/bran-test-data.test.ts`

---

**Version:** 2026-03-10  
**Estimated time:** 10-15 minutes  
**Prerequisites:** Dev server running, automated tests passing
