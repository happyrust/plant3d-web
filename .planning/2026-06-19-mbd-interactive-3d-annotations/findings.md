# Findings: MBD Interactive 3D BRAN Dimensions

## Codebase Scope

- `src/components/model-tree/ModelTreePanel.vue` contains the model-tree context menu and MBD noun gating.
- `src/components/dock_panels/ViewerPanel.vue` owns request watching, model preload, API parameters, response handling, and renderer calls.
- `src/composables/useToolStore.ts` defines the cross-component MBD request.
- `src/utils/mbdStandaloneUrl.ts` controls URL standalone/drawing/full/length mode resolution.
- `src/composables/useMbdPipeAnnotationThree.ts` owns the Three.js MBD annotation rendering.
- `src/composables/mbd/mbdDrawingStyleProfile.ts` and `src/components/tools/MbdAnnotationStylePanel.vue` own style configuration.
- `src/components/model-tree/ModelTreeRow.vue` now exposes stable row test attributes so real context-menu paths can be automated without bypassing DOM interaction.

## Requirement Findings

- The user explicitly wants MBD annotations inside the normal 3D interactive page through menu clicks.
- The user does not want screenshot generation or a special fixed view as the primary result.
- The user wants true 3D anchors: camera rotation and zoom must preserve model-to-annotation correspondence.
- The first priority is BRAN length dimensions, but the design must be generic and tested across more BRANs when data is available.
- Style configuration must live in settings and cover color/line/arrow/pipe outline behavior.

## Technical Findings

- The key architectural distinction is `full` interactive MBD vs `drawing` fixed-sheet MBD.
- Plain standalone `mbd_refno` should be full interactive by default.
- `showInlineTubeLengthDims` is needed so inline pipe length labels like `600` can show without enabling all cut-tubi detail noise.
- `showPipeVisualEmphasis` is needed so full interactive mode can show pipe/fitting visual emphasis without relying on drawing preset.
- The current cata2 real backend data is known to include `2013286704_476`; other candidate BRANs may require a multibran package/backend.
- The model-tree context menu height can exceed the previous fixed estimate once MBD and room actions are present; the menu needs post-render viewport clamping based on actual DOM size.
- `pdmsTree.focusNodeById` returns early when the root is not initialized, so browser tests and external focus flows must wait for model-tree root/flatRows readiness.

## Verification Findings

- Focused type-check and Vitest were previously run successfully for the relevant changes.
- Real browser verification for `2013286704_476` found three dimensions (`600`, `1073`, `783`) and full visual/tag objects.
- Camera rotation changed label screen positions, which indicates annotations were not fixed overlay screenshots.
- Actual model-tree right-click menu UI path is now automated against the real backend: focus real BRAN row, right-click DOM row, click `生成 MBD 标注`, verify full API flags, dimension texts, viewport status, and camera-anchored movement.
