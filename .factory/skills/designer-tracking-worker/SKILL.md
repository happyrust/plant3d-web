---
name: designer-tracking-worker
description: Implement designer task continuity, replay visibility, and collaboration closed-loop behavior for reviewer/designer M6+M7 flows.
---

# Designer Tracking Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the WORK PROCEDURE.

## When to Use This Skill

Use this worker for features related to designer-facing continuity in the M6+M7 mission:
- Designer task status board (`DesignerTaskList.vue`)
- Resubmission task list (`ResubmissionTaskList.vue`)
- Task detail page (`TaskReviewDetail.vue`)
- Resubmit workflow
- Task filtering and status logic
- Designer visibility of canonical annotations, replayable measurements, task-thread continuity, and annotation-thread continuity
- Reviewer/designer closed-loop continuity across return / resubmit / reopen flows

## Work Procedure

### 1. Read Feature Requirements
- Read the feature description, preconditions, expectedBehavior, and verificationSteps
- Understand what needs to be built and what success looks like

### 2. Investigate Existing Code
- Read relevant existing components and composables
- Understand current implementation patterns
- Identify what needs to be refactored vs built from scratch
- When fixing continuity issues, inspect both reviewer and designer surfaces before changing code

### 3. Write Tests First (TDD - RED)
- Write failing tests BEFORE implementation
- Cover all expectedBehavior scenarios
- Use Vitest for unit/component tests
- Tests must fail initially (RED phase)

### 4. Implement to Make Tests Pass (GREEN)
- Implement the feature to make tests pass
- Follow existing code patterns and conventions
- Keep changes minimal and focused
- Ensure type safety (TypeScript)

### 5. Run Automated Validators
- `npm run type-check` - must pass
- Run focused tests for changed files
- Read-only lint on changed files (no --fix)

### 6. Manual Verification with agent-browser
- Use `agent-browser` to verify the feature works in the real UI
- Test the complete reviewer -> designer -> reviewer flow when relevant
- Record specific actions and observations in `interactiveChecks`
- For closed-loop continuity, verify at least two affected surfaces in the same flow (for example: reviewer return + designer detail, or designer resubmit + reviewer reopen)

### 7. Document What Was Done
- Prepare thorough handoff with all verification details
- Include specific commands run and their outputs
- Document any issues discovered
- Note what was left undone (if anything)
- If a feature resolves a continuity mismatch, explicitly state the canonical rule chosen and which surfaces now share it

## Example Handoff

```json
{
  "salientSummary": "Aligned designer returned/resubmit surfaces with replayable review records and collaboration continuity so reviewer return -> designer resubmit -> reviewer reopen now preserves task-thread, annotation-thread, and confirmed measurement state.",
  "whatWasImplemented": "Updated designer task list/detail/resubmission surfaces and shared store logic so returned tasks preserve canonical annotation identity, replayable confirmed measurements, and collaboration thread lineage. The designer resubmit path now reopens the same task truth for reviewers instead of creating a divergent local interpretation.",
  "whatWasLeftUndone": "Attachment thumbnail polish in the designer detail timeline is functional but visually basic; UX polish can follow separately if needed.",
  "verification": {
    "commandsRun": [
      {
        "command": "npm --prefix /Volumes/DPC/work/plant-code/plant3d-web run type-check",
        "exitCode": 0,
        "observation": "vue-tsc completed successfully with no type errors."
      },
      {
        "command": "cd /Volumes/DPC/work/plant-code/plant3d-web && npx vitest run src/components/review/DesignerTaskList.test.ts src/components/review/ResubmissionTaskList.test.ts src/components/review/TaskReviewDetail.test.ts src/composables/useReviewStore.websocket.test.ts",
        "exitCode": 0,
        "observation": "Focused designer continuity tests passed, covering returned/resubmitted task visibility and collaboration/replay continuity."
      },
      {
        "command": "cd /Volumes/DPC/work/plant-code/plant3d-web && npx eslint src/components/review/DesignerTaskList.vue src/components/review/ResubmissionTaskList.vue src/components/review/TaskReviewDetail.vue src/composables/useUserStore.ts --max-warnings 0",
        "exitCode": 0,
        "observation": "No lint violations in changed designer continuity files."
      }
    ],
    "interactiveChecks": [
      {
        "action": "Used agent-browser to open a seeded reviewer task, returned it, switched to designer surfaces, reviewed task detail, and resubmitted it.",
        "observed": "Designer saw the same canonical annotations, confirmed measurement replay summary, and task-thread continuity before resubmitting the task."
      },
      {
        "action": "Reopened the same task from the reviewer side after resubmit.",
        "observed": "Reviewer saw the same annotation-thread lineage and replayable measurement records rather than a duplicated or reset task state."
      }
    ]
  },
  "tests": {
    "added": [
      {
        "file": "src/components/review/TaskReviewDetail.test.ts",
        "cases": [
          {
            "name": "designer detail preserves collaboration and replay continuity after return",
            "verifies": "Returned task detail shows the same task-thread, annotation-thread, and replayable measurement lineage."
          }
        ]
      }
    ],
    "coverage": "Focused coverage of reviewer/designer continuity and store normalization across returned/resubmitted task flows."
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

Beyond standard cases, return when:
- Backend API endpoints needed for replay/collaboration continuity do not exist or return unexpected data
- Reviewer/designer lineage rules are unclear or inconsistent
- Stable task or annotation identities are missing from the return/resubmit path
- Cannot verify the feature due to missing seeded tasks or broken local environment
