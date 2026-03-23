---
name: mbd-layout-reviewer
description: Review completed MBD layout mission features for deterministic behavior regressions, contract safety, and missing verification evidence.
---

# mbd-layout-reviewer

Use this skill after the MBD layout implementation features are complete.

## Scope
- Review completed mission diffs for blocking defects and regression risks
- Run mission-scoped validation only
- Verify the final evidence against the approved validation contract
- Produce findings-first output with exact file references and any remaining gaps

## Procedure

1. Read mission `AGENTS.md`, `validation-contract.md`, and `features.json`.
2. Read `.factory/library/architecture.md`, `.factory/library/environment.md`, `.factory/library/mbd-layout-testing.md`, and `.factory/library/mbd-layout-contract.md`.
3. Inspect completed implementation files and their tests, especially:
   - `src/composables/useMbdPipeAnnotationThree.ts`
   - `src/api/mbdPipeApi.ts`
   - new or changed files under `src/composables/mbd/`
   - `src/composables/useMbdPipeAnnotationThree.flyTo.test.ts`
   - `src/fixtures/bran-test-data.test.ts`
4. Run:
   - `npm run type-check`
   - focused eslint from `.factory/services.yaml`
   - the mission-scoped Vitest regression command from `.factory/services.yaml`
5. Prioritize findings about:
   - camera-sensitive semantic relayout
   - unstable same-side or lane ordering behavior
   - broken duplicate suppression or manual override precedence
   - accidental contract regressions for missing/partial `layout_hint`
   - missing BRAN `24381_145717` evidence or unproven assumptions
6. Return findings first, then concise residual risks and verification coverage.

## Handoff Expectations

- Findings must come before any summary.
- Cite exact file references for each issue.
- Explicitly state which claimed assertions were verified and which remain only partially evidenced.
- If no findings exist, say so plainly and note any residual testing gaps.

## Return to Orchestrator When

- Required mission-scoped validators are no longer relevant to the changed files and need adjustment
- The worktree contains unexpected overlapping edits that undermine a trustworthy review
- There is insufficient evidence to assess a claimed assertion without a new orchestrator decision
