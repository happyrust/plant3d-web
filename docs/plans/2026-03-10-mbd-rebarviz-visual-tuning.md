# MBD RebarViz Visual Tuning Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Increase the default visual weight of RebarViz-style MBD dimensions by setting `arrowSizePx=22` and `lineWidthPx=3.0`, and make the BRAN fixture an easy verification path for this tuning.

**Architecture:** The change stays at the mode-configuration layer. `src/composables/mbd/mbdDimensionMode.ts` remains the single source of truth for RebarViz defaults, while the existing propagation path in `src/composables/useMbdPipeAnnotationThree.ts` stays intact. Fixture-facing updates should improve verification ergonomics without changing annotation geometry behavior.

**Tech Stack:** Vue 3, TypeScript, Three.js, Vitest, existing MBD fixture/demo wiring

---

### Task 1: Lock the default-value change to the mode config

**Files:**
- Modify: `src/composables/mbd/mbdDimensionMode.ts`
- Reference: `src/composables/useMbdPipeAnnotationThree.ts`

**Step 1: Inspect the current RebarViz mode config**

Confirm that the `rebarviz` block still owns `arrowSizePx` and `lineWidthPx`, and that no second source of truth was introduced.

**Step 2: Update the defaults**

Change only the `rebarviz` values from `16 -> 22` and `2.2 -> 3.0`.

**Step 3: Keep propagation unchanged**

Do not change how `useMbdPipeAnnotationThree` passes `arrowSizePx` and `lineWidthPx` into `LinearDimension3D`; only verify that the existing path still uses the mode config values.

**Step 4: Sanity-check for unintended scope expansion**

Confirm that `classic` mode defaults and any geometry logic remain untouched.

### Task 2: Make the BRAN fixture a stable verification entry

**Files:**
- Modify: `src/debug/injectMbdPipeDemo.ts`
- Modify: `src/fixtures/README.md`
- Optional modify if needed: `docs/notes/mbd-rebarviz-beam-demo.md`

**Step 1: Inspect the current BRAN fixture entry point**

Review how `bran_fixture` is selected in `src/debug/injectMbdPipeDemo.ts` and confirm whether a title, description, or helper string can be improved without changing behavior.

**Step 2: Add the stable verification path**

Implement the lightest-weight change that makes the fixture easier to verify with the tuned defaults. Prefer documentation or fixture-facing labeling over new runtime logic. If runtime help is necessary, keep it constrained to the existing `bran_fixture` path.

**Step 3: Document the recommended URL**

Update `src/fixtures/README.md` to include a direct verification URL for `bran_fixture` in `rebarviz` mode, and explicitly note that the tuned default now corresponds to `arrowSizePx=22` and `lineWidthPx=3.0` unless overridden by URL params.

### Task 3: Add or update focused regression checks

**Files:**
- Modify: `src/fixtures/bran-test-data.test.ts`
- Reference: `src/composables/mbd/mbdDimensionMode.ts`

**Step 1: Identify the narrowest assertion point**

Look for an existing BRAN fixture test that already renders dimensions and can assert default RebarViz styling without introducing brittle geometry snapshots.

**Step 2: Write the failing test or assertion first**

Add or refine assertions that verify the rendered RebarViz dimensions inherit the intended default size/line-width values through the current annotation path.

**Step 3: Run the focused test target**

Run a narrow Vitest command that exercises the fixture test file.

Suggested command:

```bash
npm test -- src/fixtures/bran-test-data.test.ts
```

**Step 4: Adjust the implementation only if the assertion exposes a mismatch**

Keep changes limited to defaults, fixture ergonomics, or test setup. Do not modify `LinearDimension3D` geometry logic.

### Task 4: Verify no regression in the manual demo path

**Files:**
- Reference: `src/components/dock_panels/ViewerPanel.vue`
- Reference: `src/debug/injectMbdPipeDemo.ts`
- Reference: `src/fixtures/README.md`

**Step 1: Confirm URL override compatibility**

Verify from code inspection or targeted checks that `mbd_arrow_size` and `mbd_line_width` still override the tuned defaults.

**Step 2: Capture the recommended manual verification URL**

Record a deterministic URL similar to:

```text
/?dtx_demo=mbd_pipe&mbd_pipe_case=bran_fixture&mbd_dim_mode=rebarviz
```

Only add explicit `mbd_arrow_size` or `mbd_line_width` params if the fixture/docs need to demonstrate override behavior.

**Step 3: Summarize results**

Report exactly which files changed, what verification passed, and whether any remaining uncertainty is visual-only.
