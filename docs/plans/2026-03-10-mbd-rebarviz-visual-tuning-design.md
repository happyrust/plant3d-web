# MBD RebarViz Visual Tuning Design

**Date:** 2026-03-10

**Goal:** Make the RebarViz-style MBD arrows look clearly larger and the dimension lines clearly thicker in the default viewer path, while keeping all `LinearDimension3D` geometry logic unchanged.

## Scope

- Raise the `rebarviz` mode defaults from `arrowSizePx=16` and `lineWidthPx=2.2` to `arrowSizePx=22` and `lineWidthPx=3.0`.
- Keep the existing URL override controls (`mbd_arrow_size`, `mbd_line_width`) unchanged so manual fine-tuning still works.
- Update the existing BRAN fixture entry so there is a stable, low-friction demo path for verifying the new default visual weight.
- Do not change arrow geometry construction, label layout algorithms, or dimension placement rules.

## Files Involved

- `src/composables/mbd/mbdDimensionMode.ts`
  - Source of the default `rebarviz` arrow and line-width values.
- `src/composables/useMbdPipeAnnotationThree.ts`
  - Already forwards mode config into annotation instances; expected to remain behaviorally unchanged.
- `src/debug/injectMbdPipeDemo.ts`
  - Existing `bran_fixture` demo entry point; likely place to improve fixture discoverability if needed.
- `src/fixtures/README.md`
  - Existing BRAN fixture usage docs; suitable place to document a stable verification URL.

## Chosen Approach

Use a narrow default-value adjustment plus a fixture-oriented verification path.

Why this approach:

- It changes the real day-to-day `rebarviz` viewing experience instead of only improving a demo.
- It avoids risk in `LinearDimension3D`, where the current issue appears to be visual weight rather than geometry.
- It preserves the current override mechanism for rapid follow-up tuning if the result still feels too light or too heavy.

## Alternatives Considered

1. Only change a demo URL or fixture params
   - Lowest risk, but normal `rebarviz` usage would still look too small/thin.
2. Change `LinearDimension3D` rendering logic
   - Highest risk and not justified by the current evidence.
3. Change defaults and wire a fixture/demo verification path
   - Chosen because it improves production behavior and keeps regression review easy.

## Verification Strategy

- Verify the BRAN fixture still renders in `rebarviz` mode with the new default values.
- Verify URL overrides still take precedence over the new defaults.
- Prefer fixture-backed regression checks so the result is deterministic and does not depend on backend data.

## Non-Goals

- No geometry math changes in `LinearDimension3D`.
- No changes to classic mode defaults.
- No broad annotation styling refactor.
