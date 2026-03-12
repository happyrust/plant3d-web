# Duplicate Text Fix Report

## Root Cause Confirmed

The duplicate/overlapping text appearance in `rebarviz` style was caused by:

1. **Both `line` and `haloLine` visible simultaneously** - The main text line and the halo line are both rendered
2. **Shared geometry** - Both use the same `lineGeometry` buffer
3. **High halo opacity (0.88)** - Combined with only 1.15x scale difference, created a strong overlapping effect
4. **Similar visual weight** - The high-opacity white halo at nearly the same size as the text creates a duplicate appearance

## Files Changed

### `/src/utils/three/annotation/text/SolveSpaceBillboardVectorText.ts`
- **Line 60**: Changed `haloOpacity: 0.88` → `0.28` in rebarviz preset
- **Behavior change**: The halo is now rendered with 68% less opacity (0.28 vs 0.88)

### `/src/utils/three/annotation/text/SolveSpaceBillboardVectorText.test.ts`
- **Added new test**: `'rebarviz 风格应使用低透明度 halo 避免重复文字效果'`
- **Test coverage**: Verifies halo opacity is between 0.2-0.35 for rebarviz style
- **Test coverage**: Confirms halo scale remains at 1.15x

## Exact Behavior Change

### Before
- Halo opacity: **0.88** (88% opaque)
- Visual effect: Strong white overlay creating duplicate text appearance
- Scale: 1.15x

### After
- Halo opacity: **0.28** (28% opaque)
- Visual effect: Subtle glow that enhances readability without duplication
- Scale: 1.15x (unchanged)

## Validation Results

### Unit Tests
```bash
npm test -- src/utils/three/annotation/text/SolveSpaceBillboardVectorText.test.ts
✓ 3 tests passed
```

### Integration Tests
```bash
npm test -- src/utils/three/annotation/
✓ 19 test files passed
✓ 186 tests passed
```

### Linting
```bash
npm run lint -- --fix src/utils/three/annotation/text/
✓ No issues found
```

## Visual Tradeoff

### Preserved
- ✅ Text readability maintained
- ✅ Halo still provides contrast against complex backgrounds
- ✅ Text always renders on top (`depthTest: false` in rebarviz mode)

### Changed
- 📉 Halo is now more subtle (68% less opacity)
- ✅ No more duplicate/overlapping text appearance
- ✅ Cleaner, more professional text rendering

## Technical Details

The fix leverages the fact that `rebarviz` style already uses `forceTextDepthOff: true`, which disables depth testing for the main text. This means the text is always visible on top, making a strong halo less necessary. The reduced opacity (0.28) still provides contrast benefit while eliminating the duplicate appearance.

## Minimal Impact

This is a **single-value change** (one constant in a preset object), making it:
- Easy to revert if needed
- Low risk of side effects
- Simple to adjust further if desired (e.g., 0.25, 0.30, etc.)

## Recommendation

The fix successfully eliminates the duplicate text appearance while preserving readability. If further visual refinement is desired, the opacity can be fine-tuned between 0.2-0.35 without code changes to the core rendering logic.
