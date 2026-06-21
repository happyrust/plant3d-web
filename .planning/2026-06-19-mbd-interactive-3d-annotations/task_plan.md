# Task Plan: MBD Interactive 3D BRAN Dimensions

## Goal

Implement and verify menu-triggered MBD pipe dimensions in the interactive 3D viewer. The default path must render true 3D anchored annotations for real BRAN data, not a fixed drawing/screenshot view. The work must be driven by a written requirements, edge-case, architecture, and development plan.

## Phases

| Phase | Status | Deliverable |
| --- | --- | --- |
| 0. Requirement and codebase audit | complete | Relevant files, current behavior, failure mode identified |
| 1. Architecture and edge-case document | complete | `docs/plans/2026-06-19-mbd-interactive-3d-annotation-architecture-plan.md` |
| 2. Request mode separation | complete | `displayMode: full/drawing/length` contract |
| 3. Viewer orchestration and error handling | complete | Model preload, full API flags, fallback/error toast, latest-only async guard |
| 4. 3D renderer behavior | complete | Full interactive annotations stay 3D anchored; drawing-only behavior isolated |
| 5. Style settings integration | complete | MBD style panel/profile exists and full-mode hot update is verified by real UI E2E |
| 6. Tests and real BRAN verification | complete | Type-check/unit/browser checks passed; real Ribbon and model-tree context-menu UI E2E added |
| 7. Root Goal contract | complete | `GOAL.md` records production-grade scope, Done definition, architecture, and verification gates |
| 8. Five-axis request compatibility layer | complete | `mbdPresetMapper.ts` and `mbdApiParamBuilder.ts` with unit tests and Viewer integration |
| 9. Multi-BRAN regression corpus | complete | `e2e/fixtures/mbd-branch-corpus.json` and `mbdPrintBranchCorpus.mjs` helper |
| 10. Renderer full-test stabilization | complete | Full `useMbdPipeAnnotationThree.flyTo.test.ts` is green after fallback/rebuild fixes |
| 11. Multibran real-backend verification | blocked by external runtime | Corpus is ready, but current backend reports SurrealDB WebSocket connection refused for `497/508/488` |
| 12. Final production review pass | complete | Requirement-by-requirement evidence audit recorded in `progress.md`; frontend MBD scope is production-ready for primary BRAN with external multibran/backend blocker noted |

## Current Decisions

- Menu and Ribbon generated MBD annotations use `displayMode: 'full'`.
- Explicit drawing mode is only for `mbd_preset=drawing/sheet/reference` or `mbd_sheet=1`.
- Plain `mbd_refno` and `mbd_pipe` URLs default to full interactive 3D mode.
- Full mode may request rich backend data but must not activate fixed drawing layout behavior.
- Style configuration is owned by `mbdDrawingStyleProfile` and `MbdAnnotationStylePanel`.
- Internally, `displayMode` is now mapped to request axes (`requestIntent`, `dataScope`, `layoutMode`, `renderMode`) before API params are built.
- API query flags are built by `buildMbdPipeQueryParams` instead of being hand-written in the Viewer watcher.
- Multi-BRAN validation must use `e2e/fixtures/mbd-branch-corpus.json`; production code must not special-case those refnos.

## Verification Targets

- `npm run type-check`
- Focused Vitest for URL mode and MBD renderer behavior.
- Real BRAN `2013286704_476` against `http://127.0.0.1:18082` and `aps250160-mbd-cata2`.
- Browser camera rotation check: labels move with projection and remain in viewport.
- Real Ribbon UI-click path in Playwright.
- Real model-tree right-click context-menu path in Playwright.
- Request-axis unit tests: `mbdPresetMapper.test.ts`, `mbdApiParamBuilder.test.ts`.
- Corpus helper checks: `node e2e/helpers/mbdPrintBranchCorpus.mjs --priority smoke --include-expected-lengths`.
- Full renderer test file must stay green before final review.

## Errors Encountered

| Error | Attempt | Resolution |
| --- | --- | --- |
| SigMap MCP file explanation returned no Vue signatures | 1 | Used SigMap CLI/context for scope, then `rg` and direct source reads |
| `.planning` directory did not exist | 1 | Created scoped planning directory before writing files |
| Old MBD request could clear/overwrite a newer request | 1 | Wired `createLatestOnlyGate` and `shouldClearMbdRequest` into the Viewer watcher |
| E2E could not call `useSelectionStore()` from `page.evaluate` because vue-query needs injection context | 1 | Exposed `setSelectedRefno` on `__plant3dMbdE2E` from ViewerPanel setup |
| New E2E file was ignored by `.gitignore` due `e2e/*` | 1 | Added an explicit exception for `e2e/mbd-interactive-ui.spec.ts` |
| Playwright did not discover the spec when invoked with Windows backslashes | 1 | Re-ran with the project's working forward-slash path `e2e/mbd-interactive-ui.spec.ts` |
| Model-tree E2E focus ran before the tree root loaded | 1 | Added a model-tree E2E snapshot/focus helper and waited for root/flatRows before focusing |
| Right-click context menu could place the MBD item below the viewport | 1 | Added DOM-size based context-menu clamping after render |
| Full renderer Vitest suite had 14 failing tests | 1 | Fixed fallback bend rendering, backend-derived declutter mutation, dim/bend rebuild, fallback declutter passes, and stale default-style assertion; full renderer suite now passes 49/49 |
| Multibran refs `2013286704_497/508/488` return `success=false` | 1 | Corpus remains ready; current backend/runtime reports SurrealDB WebSocket connection refused even with `source=cache` |
| Real full interactive labels overlapped after camera rotation | 1 | Recompute layout-result screen declutter on camera updates and use generic semantic slots; real diagnostic now reports severe overlap `0` before and after rotation |
| Full `npm test` fails outside MBD scope | 1 | Fixed the MBD API contract failure; recorded remaining unrelated review/measurement/version/duckdb failures as repo-wide residual risk |
