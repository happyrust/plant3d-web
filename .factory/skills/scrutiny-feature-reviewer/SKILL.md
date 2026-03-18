---
name: scrutiny-feature-reviewer
description: Review completed M6+M7 annotation, replay, seed-data, and collaboration features for blocking defects, regression risks, and missing verification before user-surface synthesis.
---

# scrutiny-feature-reviewer

Use this skill after M6 or M7 implementation features are complete.

## Scope
- Review completed feature diffs in reviewer workbench, annotation, measurement replay, seed-data, collaboration, and designer continuity areas
- Run mission-scoped static validation only
- Produce findings-first output with exact file references, blockers, and verification gaps

## Procedure
1. Read mission `AGENTS.md`, `validation-contract.md`, and `features.json`.
2. Read `.factory/library/architecture.md`, `.factory/library/m6-m7-review-collaboration.md`, and `.factory/library/review-annotations.md`.
3. Inspect the completed implementation files and relevant tests for the assigned feature.
4. Run:
   - `npm run type-check`
   - targeted `npx eslint <files>`
   - mission-scoped Vitest files from `.factory/services.yaml` relevant to the changed milestone
5. Prioritize findings about:
   - reviewer-visible OBB leakage into canonical annotation paths
   - unstable annotation or measurement replay lineage
   - task-thread / annotation-thread ambiguity
   - seeded demo-data brittleness that would undermine later user testing
   - accidental dependency on unavailable live business data instead of the scripted demo pack
6. Return findings first, with concise remediation guidance and exact file references.

## Example Handoff

```json
{
  "salientSummary": "Reviewed the completed M6 reviewer direct-launch shell and found one blocking regression where reviewer counts still included legacy OBB records after confirmation reload; type-check and scoped tests otherwise passed.",
  "whatWasImplemented": "Performed scrutiny on the finished feature by inspecting the changed reviewer workbench/orchestration files, reading the updated tests, and running the mission-scoped type-check, focused eslint, and M6 baseline Vitest suite. Documented the remaining blocker and confirmed the rest of the scoped behavior matched the feature contract.",
  "whatWasLeftUndone": "User-surface validation was intentionally not performed in this scrutiny session; that remains for the automatic user-testing validator after the milestone completes.",
  "verification": {
    "commandsRun": [
      {
        "command": "npm --prefix /Volumes/DPC/work/plant-code/plant3d-web run type-check",
        "exitCode": 0,
        "observation": "Type-check completed successfully with no new type errors."
      },
      {
        "command": "cd /Volumes/DPC/work/plant-code/plant3d-web && npx eslint src/components/review/ReviewPanel.vue src/components/tools/AnnotationPanel.vue --max-warnings 0",
        "exitCode": 0,
        "observation": "Focused eslint passed on the reviewed files."
      },
      {
        "command": "cd /Volumes/DPC/work/plant-code/plant3d-web && npx vitest run src/components/review/ReviewPanel.test.ts src/components/tools/AnnotationPanel.test.ts src/api/reviewApi.test.ts",
        "exitCode": 0,
        "observation": "Scoped M6 baseline tests passed, covering the main reviewer direct-launch and contract surfaces."
      }
    ],
    "interactiveChecks": []
  },
  "tests": {
    "added": [],
    "coverage": "Scrutiny session only; no new tests added. Review relied on existing focused tests and static validators."
  },
  "discoveredIssues": [
    {
      "severity": "blocking",
      "description": "Confirmed summary counts still include a legacy OBB bucket after reload, which violates the approved canonical reviewer semantics.",
      "suggestedFix": "Remove or migrate the remaining OBB count path so reviewer-visible summaries only reflect text/cloud/rectangle data."
    }
  ]
}
```

## When to Return to Orchestrator

- A feature depends on a missing backend/data contract that must be implemented before meaningful scrutiny can continue.
- The required scoped validators no longer match the changed milestone area and need orchestrator adjustment.
- The worktree has unexpected concurrent edits that make a trustworthy scrutiny outcome impossible.
