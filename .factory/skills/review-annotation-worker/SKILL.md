---
name: review-annotation-worker
description: Implement reviewer annotation interaction, panel, persistence, and regression coverage for text/cloud/rectangle flows in plant3d-web.
---

# review-annotation-worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the work procedure for reviewer annotation mission features in `plant3d-web`.

## When to Use This Skill

Use this skill for features that touch:
- reviewer annotation creation flows in `src/composables/useDtxTools.ts`
- annotation mode UI / helper copy in `src/components/tools/AnnotationPanel.vue`
- reviewer confirm/persistence flows in `src/components/review/ReviewPanel.vue` and `src/composables/useReviewStore.ts`
- annotation record schemas in `src/composables/useToolStore.ts`
- regression coverage for rectangle/cloud/text reviewer flows

## Work Procedure

1. Read mission context first:
   - mission `mission.md`
   - mission `AGENTS.md`
   - `validation-contract.md`
   - `features.json`
   - `.factory/library/architecture.md`
   - `.factory/library/environment.md`
   - `.factory/library/user-testing.md`
2. Inspect the current reviewer annotation flow before editing:
   - `src/composables/useDtxTools.ts`
   - `src/components/tools/AnnotationPanel.vue`
   - `src/components/review/ReviewPanel.vue`
   - `src/composables/useToolStore.ts`
   - `src/composables/useReviewStore.ts`
   Treat the mission's already-dirty worktree as expected starting context; preserve listed unrelated edits rather than stopping solely because those files are already modified.
3. Write failing tests first (red). Prefer focused Vitest coverage for geometry/state/persistence changes. Add or update Playwright when the feature changes real viewer interaction.
4. Implement the smallest change that makes the tests pass while preserving existing reviewer panel/store patterns.
5. Keep reviewer semantics explicit:
   - rectangle = object-pick OBB annotation
   - cloud = drag-marquee screen-space annotation
   - no reviewer-facing legacy OBB mode
6. When changing overlay rendering, verify the data model and the rendered result stay aligned. Do not settle for only updating store fields or only updating visuals.
7. If the feature touches confirmation/reload behavior, validate both the pending state and the restored state. Confirm that reviewer-visible counts and lists do not leak legacy OBB data.
8. Run targeted validation before handoff:
   - focused Vitest files
   - `npm --prefix /Volumes/DPC/work/plant-code/plant3d-web run type-check`
   - `npm --prefix /Volumes/DPC/work/plant-code/plant3d-web run lint`
   - relevant Playwright spec(s) when viewer interaction changed
9. Perform manual verification on:
   - `http://127.0.0.1:3101/?output_project=AvevaMarineSample&dtx_demo=primitives&dtx_demo_count=50`
   Capture what you clicked/dragged and what changed on screen.
10. Stop any ad hoc services/processes you start unless a validator is explicitly reusing them.

## Example Handoff

```json
{
  "salientSummary": "Replaced reviewer rectangle mode with object-pick OBB creation, removed the legacy OBB reviewer affordance, and added persistence-safe regression coverage for rectangle/cloud reviewer flows.",
  "whatWasImplemented": "Updated reviewer annotation creation so rectangle mode now creates an OBB-wrapping annotation from object pick instead of planar drag, added immediate text-edit flow and OBB-center leader visuals, removed reviewer-facing OBB mode/list copy, and adjusted review persistence so only text/cloud/rectangle reviewer semantics survive confirm + reload.",
  "whatWasLeftUndone": "Cloud screen-space shape fine-tuning under extreme zoom remains visually acceptable but could use follow-up polish if product wants pixel-perfect parity with a reference tool.",
  "verification": {
    "commandsRun": [
      {
        "command": "npm --prefix /Volumes/DPC/work/plant-code/plant3d-web test -- src/composables/useDtxTools.annotation.test.ts",
        "exitCode": 0,
        "observation": "Focused annotation interaction tests passed, covering rectangle object-pick behavior, cloud marquee behavior, and persisted reviewer record shape."
      },
      {
        "command": "npm --prefix /Volumes/DPC/work/plant-code/plant3d-web run type-check",
        "exitCode": 0,
        "observation": "Frontend type-check passed after store and reviewer annotation schema updates."
      },
      {
        "command": "npx @playwright/test e2e/dtx-annotation-creation.spec.ts --reporter=line",
        "exitCode": 0,
        "observation": "Playwright verified text/cloud/rectangle creation against the stable viewer entry path."
      }
    ],
    "interactiveChecks": [
      {
        "action": "Opened the approved viewer URL, entered rectangle mode, clicked a target object, and saved the dialog text.",
        "observed": "A single click created an OBB-wrapping rectangle annotation with center-attached leader/text, and the text appeared immediately after saving."
      },
      {
        "action": "Entered cloud mode, dragged a marquee, saved the dialog text, then orbited and zoomed the camera.",
        "observed": "The cloud remained screen-space with a stable on-screen size while the leader/text stayed attached to the same anchor."
      },
      {
        "action": "Clicked 确认当前数据 and reloaded the task.",
        "observed": "Reviewer-visible pending counts cleared, the confirmed batch reappeared after reload, and no legacy OBB reviewer entry or counts resurfaced."
      }
    ]
  },
  "tests": {
    "added": [
      {
        "file": "/Volumes/DPC/work/plant-code/plant3d-web/src/composables/useDtxTools.annotation.test.ts",
        "cases": [
          {
            "name": "rectangle mode uses object-pick OBB creation",
            "verifies": "Rectangle reviewer mode can no longer fall back to the legacy planar-drag rectangle path."
          },
          {
            "name": "cloud mode resolves marquee-center anchor and persists reviewer-safe payload",
            "verifies": "Cloud reviewer behavior uses the new anchor semantics and stores reconstruction-ready review data."
          }
        ]
      }
    ]
  },
  "discoveredIssues": [
    {
      "severity": "non_blocking",
      "description": "Visual spacing between leader and text at very small viewport sizes may need future tuning if product wants more aggressive collision avoidance.",
      "suggestedFix": "Add a follow-up layout pass that clamps text offset and leader elbow placement for narrow screens."
    }
  ]
}
```

## When to Return to Orchestrator

- The feature requires a reviewer workflow decision that is not specified in the mission (for example, cancel behavior for create-time edit dialogs if it becomes product-critical).
- Existing in-flight local changes conflict with the required annotation edits and cannot be separated safely.
- You detect new concurrent modifications after your feature work begins and cannot determine whether they are safe to build on.
- The current reviewer persistence/backend path cannot store the required geometry without a broader API/schema decision.
- Manual validation is blocked because the approved viewer entry URL or required local services are no longer reachable.
