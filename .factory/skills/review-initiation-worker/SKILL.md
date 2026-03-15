---
name: review-initiation-worker
description: Implement M1 initiation-side review task creation, attachment lineage, and contract hardening for plant3d-web.
---

# review-initiation-worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the work procedure for M1 initiation-side review mission features in `plant3d-web`.

## When to Use This Skill

Use this skill for features that touch:
- `src/components/review/InitiateReviewPanel.vue`
- `src/components/review/FileUploadSection.vue`
- `src/components/review/AssociatedFilesList.vue`
- `src/composables/useUserStore.ts` creation / attachment / resubmission flows
- `src/api/reviewApi.ts` task creation, attachment, embed-url, and task normalization behavior
- review task creation tests, attachment lineage tests, and initiation-side docs under `开发文档/三维校审`

## Work Procedure

1. Read mission context first:
   - mission `mission.md`
   - mission `AGENTS.md`
   - `features.json`
   - `.factory/library/architecture.md`
   - `.factory/library/environment.md`
   - `.factory/library/user-testing.md`
2. Inspect the current initiation-side path before editing:
   - `src/components/review/InitiateReviewPanel.vue`
   - `src/components/review/FileUploadSection.vue`
   - `src/components/review/AssociatedFilesList.vue`
   - `src/composables/useUserStore.ts`
   - `src/api/reviewApi.ts`
   - existing focused tests for review creation / attachment flow
3. Follow TDD strictly:
   - add or update focused failing tests first
   - run the targeted tests to confirm they fail for the intended reason
   - only then implement the minimum change to make them pass
4. Keep M1 boundaries explicit:
   - `taskId` is the technical task identifier
   - `formId` is the business identifier
   - attachment lineage must not silently fall back to an ambiguous identifier when a better source exists
5. Preserve role semantics in task creation:
   - `checkerId` / `approverId` remain explicit fields
   - any `reviewerId` compatibility behavior must be documented in code/tests rather than left implicit
6. If you touch embed or task creation payloads, verify both request construction and normalized response behavior.
7. When changing UI, verify the page against `ui/三维校审/review-designer.pen`; use `ui/三维校审/review-flow.pen` only to sanity-check cross-role handoff.
8. Run targeted verification before handoff:
   - `npm --prefix /Volumes/DPC/work/plant-code/plant3d-web/.worktrees/mission-review-m1-m2 run type-check`
   - read-only lint on changed review files (no `--fix`)
   - focused Vitest files for the touched creation / API / attachment flows
9. Perform manual verification on the live app:
   - open `http://127.0.0.1:3101/`
   - enter the main UI through a project card
   - exercise the initiation-side path or the closest available initiation surface
   Record exactly what was clicked, what payload/result changed, and any gap between intended and available surface.
10. If docs are part of the feature, keep task/checklist wording aligned with the implemented behavior rather than leaving stale milestone notes behind.
11. Stop any extra processes you start and do not leave watch/test runners running.

## Example Handoff

```json
{
  "salientSummary": "Hardened initiation-side review task creation so the panel now preserves taskId/formId lineage through creation and attachment flows, and aligned the M1 docs/tests with the final contract.",
  "whatWasImplemented": "Updated InitiateReviewPanel and the review API/store path so creation responses normalize `taskId` and `formId` consistently, attachment upload/update uses the stable lineage instead of ambiguous fallback values, and associated-files behavior now reflects the M1 productized placeholder rules. Added regression coverage for create-task payload construction, normalized API responses, and attachment lineage handling.",
  "whatWasLeftUndone": "AssociatedFilesList still uses placeholder data for file content preview because the real downstream file metadata endpoint is outside the confirmed M1 scope.",
  "verification": {
    "commandsRun": [
      {
        "command": "npm --prefix /Volumes/DPC/work/plant-code/plant3d-web/.worktrees/mission-review-m1-m2 run type-check",
        "exitCode": 0,
        "observation": "Type-check passed after review task creation field and payload updates."
      },
      {
        "command": "cd /Volumes/DPC/work/plant-code/plant3d-web/.worktrees/mission-review-m1-m2 && npx eslint src/components/review/InitiateReviewPanel.vue src/components/review/FileUploadSection.vue src/components/review/AssociatedFilesList.vue src/composables/useUserStore.ts src/api/reviewApi.ts",
        "exitCode": 0,
        "observation": "Targeted read-only lint passed for all changed M1 files."
      },
      {
        "command": "cd /Volumes/DPC/work/plant-code/plant3d-web/.worktrees/mission-review-m1-m2 && npx vitest run src/api/reviewApi.test.ts src/composables/useUserStore.createReviewTask.test.ts src/components/review/reviewAttachmentFlow.test.ts",
        "exitCode": 0,
        "observation": "Focused M1 tests passed, covering normalized review task fields, backend-only create-task behavior, and attachment upload lineage."
      }
    ],
    "interactiveChecks": [
      {
        "action": "Opened http://127.0.0.1:3101/, clicked a project card, entered the main UI, and opened the initiation-side review task surface.",
        "observed": "The initiation surface loaded without an auth blocker, and the page structure matched the designer-side layout expectations closely enough for M1 validation."
      },
      {
        "action": "Created a review task with selected components, reviewer assignments, and attachment upload enabled.",
        "observed": "The request completed with a stable task context, attachments stayed associated with the created task, and the UI did not regress to ambiguous task-id-only handling when formId was present."
      }
    ]
  },
  "tests": {
    "added": [
      {
        "file": "/Volumes/DPC/work/plant-code/plant3d-web/.worktrees/mission-review-m1-m2/src/composables/useUserStore.createReviewTask.test.ts",
        "cases": [
          {
            "name": "createReviewTask preserves backend-only task creation semantics",
            "verifies": "The store does not silently fall back to local task creation when the backend create-task call fails."
          },
          {
            "name": "createReviewTask keeps taskId/formId lineage for follow-up attachment work",
            "verifies": "The returned review task context preserves the identifiers needed by M1 downstream flows."
          }
        ]
      }
    ]
  },
  "discoveredIssues": [
    {
      "severity": "non_blocking",
      "description": "The current backend sample data still returns empty formId values for some review tasks, which limits strict M1 UI verification against realistic business identifiers.",
      "suggestedFix": "Add a backend fixture or seed path that returns non-empty formId values for review tasks used in local validation."
    }
  ]
}
```

## When to Return to Orchestrator

- The feature needs an unconfirmed backend contract decision around `formId`, attachment ownership, or embed payload semantics.
- Existing local changes in the mission worktree overlap with M1 files and cannot be safely separated.
- Validation is blocked because the initiation-side UI surface cannot be reached from the approved local app entry path.
- The requested feature spills into M3 tracking behavior or reviewer workbench behavior beyond the confirmed M1 milestone.
