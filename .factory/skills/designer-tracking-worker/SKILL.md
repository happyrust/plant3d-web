---
name: designer-tracking-worker
description: Implements designer task tracking features including status board, resubmission list, detail page, and resubmit flow
---

# Designer Tracking Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the WORK PROCEDURE.

## When to Use This Skill

Use this worker for features related to designer (initiator) task tracking:
- Designer task status board (`DesignerTaskList.vue`)
- Resubmission task list (`ResubmissionTaskList.vue`)
- Task detail page (`TaskReviewDetail.vue`)
- Resubmit workflow
- Task filtering and status logic
- Related state management in `useUserStore`

## Work Procedure

### 1. Read Feature Requirements
- Read the feature description, preconditions, expectedBehavior, and verificationSteps
- Understand what needs to be built and what success looks like

### 2. Investigate Existing Code
- Read relevant existing components and composables
- Understand current implementation patterns
- Identify what needs to be refactored vs built from scratch

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
- Test the complete user flow from entry to completion
- Record specific actions and observations in `interactiveChecks`
- Each flow = one detailed `interactiveChecks` entry

### 7. Document What Was Done
- Prepare thorough handoff with all verification details
- Include specific commands run and their outputs
- Document any issues discovered
- Note what was left undone (if anything)

## Example Handoff

```json
{
  "salientSummary": "Refactored DesignerTaskList to show status buckets (pending/approved/returned); added getDesignerTaskStatusBucket() with 8 test cases; verified via agent-browser that tasks display correctly in each bucket with proper card info.",
  "whatWasImplemented": "Refactored `DesignerTaskList.vue` to implement status bucket display (待审核/已通过/退回待修改). Added `getDesignerTaskStatusBucket()` function in `reviewTaskFilters.ts` with comprehensive test coverage. Updated task card layout to show currentNode, assignee, updateTime, and return summary. All tasks now route to unified `TaskReviewDetail` page.",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      {
        "command": "npm --prefix /Volumes/DPC/work/plant-code/plant3d-web run type-check",
        "exitCode": 0,
        "observation": "vue-tsc completed successfully with no type errors"
      },
      {
        "command": "cd /Volumes/DPC/work/plant-code/plant3d-web && npx vitest run src/components/review/reviewTaskFilters.test.ts",
        "exitCode": 0,
        "observation": "8 tests passed covering getDesignerTaskStatusBucket with various status/node combinations"
      },
      {
        "command": "cd /Volumes/DPC/work/plant-code/plant3d-web && npx eslint src/components/review/DesignerTaskList.vue src/components/review/reviewTaskFilters.ts --max-warnings 0",
        "exitCode": 0,
        "observation": "No lint violations in changed files"
      }
    ],
    "interactiveChecks": [
      {
        "action": "Used agent-browser to open http://127.0.0.1:3101/, navigated to project, switched to designer role, opened task list",
        "observed": "Task list displayed with three status tabs: 待审核 (3 tasks), 已通过 (1 task), 退回待修改 (2 tasks). Each card showed task title, current node badge, assignee name, last update time. Returned tasks showed return reason summary."
      },
      {
        "action": "Clicked on a returned task card to open detail page",
        "observed": "TaskReviewDetail opened showing full task info, workflow timeline, and return history. 'Continue editing' button visible for returned tasks."
      }
    ]
  },
  "tests": {
    "added": [
      {
        "file": "src/components/review/reviewTaskFilters.test.ts",
        "cases": [
          {
            "name": "getDesignerTaskStatusBucket returns 'pending' for submitted tasks",
            "verifies": "Tasks at jd/sh/pz nodes with submitted status are pending"
          },
          {
            "name": "getDesignerTaskStatusBucket returns 'returned' for returned tasks",
            "verifies": "Tasks with returned status show in returned bucket"
          },
          {
            "name": "getDesignerTaskStatusBucket returns 'approved' for approved tasks",
            "verifies": "Tasks with approved status show in approved bucket"
          }
        ]
      }
    ],
    "coverage": "Comprehensive coverage of status bucket logic with 8 test cases covering all status/node combinations"
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

Beyond standard cases (missing dependencies, ambiguous requirements, blocking bugs), return when:
- Backend API endpoints needed for the feature don't exist or return unexpected data
- Workflow status/node mapping rules are unclear or inconsistent
- Task data structure doesn't match what the feature expects
- Cannot verify feature due to missing test data or broken local environment
