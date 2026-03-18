---
name: review-annotation-worker
description: Implement reviewer workbench direct-launch, canonical text/cloud/rectangle semantics, and measurement confirm/replay behavior for the M6+M7 mission in plant3d-web.
---

# review-annotation-worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the work procedure for reviewer annotation mission features in `plant3d-web`.

## When to Use This Skill

Use this skill for features that touch:
- reviewer workbench direct-launch in `src/components/review/ReviewPanel.vue`
- reviewer annotation creation flows in `src/composables/useDtxTools.ts`
- annotation mode UI / helper copy in `src/components/tools/AnnotationPanel.vue`
- reviewer confirm/persistence flows in `src/composables/useReviewStore.ts`
- annotation record schemas in `src/composables/useToolStore.ts`
- measurement confirmation/replay behavior tied to the reviewer workbench
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
   - `.factory/library/m6-m7-review-collaboration.md`
   - `.factory/library/review-annotations.md`
2. Inspect the current reviewer action flow before editing:
   - `src/components/review/ReviewPanel.vue`
   - `src/composables/useDtxTools.ts`
   - `src/components/tools/AnnotationPanel.vue`
   - `src/composables/useToolStore.ts`
   - `src/composables/useReviewStore.ts`
3. Write failing tests first (red). Prefer focused Vitest coverage for direct-launch state changes, geometry/state/persistence changes, and measurement confirm/replay behavior.
4. Implement the smallest change that makes the tests pass while preserving existing reviewer panel/store patterns.
5. Keep reviewer semantics explicit:
   - rectangle is canonical reviewer geometry replacement
   - cloud is the screen-space marquee reviewer annotation
   - no reviewer-facing legacy OBB mode
   - measurement is temporary until explicit confirmation, then replayable later
6. When changing rendering or replay behavior, verify both the stored data model and the visible result. Do not settle for only updating store fields or only updating visuals.
7. If the feature touches confirmation/reload behavior, validate both the pending tool-session state and the restored replay state. Confirm reviewer-visible counts and summaries do not leak legacy OBB data.
8. Run targeted validation before handoff:
   - focused Vitest files
   - `npm --prefix /Volumes/DPC/work/plant-code/plant3d-web run type-check`
   - focused `npx eslint <files>`
9. Perform manual verification on seeded reviewer tasks through `http://127.0.0.1:3101`. Capture what you launched from the workbench and what changed on screen.
10. Stop any ad hoc services/processes you start unless a validator is explicitly reusing them.

## Example Handoff

```json
{
  "salientSummary": "Added reviewer workbench direct-launch for canonical annotations and measurement, removed reviewer-visible OBB affordances, and made confirmed measurements replayable after reload.",
  "whatWasImplemented": "Updated ReviewPanel to orchestrate direct-launch entry points for text/cloud/rectangle annotation and measurement, removed reviewer-facing legacy OBB mode/list copy, preserved stable annotation lineage across confirmation and reload, and added replay support for confirmed measurement records so reviewer and designer surfaces can inspect the same confirmed result set later.",
  "whatWasLeftUndone": "Cloud visual fine-tuning under extreme zoom is acceptable but could use polish later if product wants exact screenshot parity with a reference tool.",
  "verification": {
    "commandsRun": [
      {
        "command": "npm --prefix /Volumes/DPC/work/plant-code/plant3d-web test -- src/components/review/ReviewPanel.test.ts src/components/tools/AnnotationPanel.test.ts src/components/review/TaskReviewDetail.test.ts src/api/reviewApi.test.ts",
        "exitCode": 0,
        "observation": "Focused reviewer annotation and replay tests passed, covering direct-launch, canonical semantics, and measurement replay payload handling."
      },
      {
        "command": "npm --prefix /Volumes/DPC/work/plant-code/plant3d-web run type-check",
        "exitCode": 0,
        "observation": "Frontend type-check passed after workbench orchestration and store schema updates."
      },
      {
        "command": "npx eslint src/components/review/ReviewPanel.vue src/components/tools/AnnotationPanel.vue src/composables/useDtxTools.ts src/composables/useToolStore.ts src/composables/useReviewStore.ts --max-warnings 0",
        "exitCode": 0,
        "observation": "No lint violations in reviewer annotation owned files."
      }
    ],
    "interactiveChecks": [
      {
        "action": "Opened a seeded reviewer task, launched text/cloud/rectangle and measurement directly from the workbench, then returned to the workbench summary.",
        "observed": "All approved direct-launch actions started from the reviewer workbench without leaving task context, and the candidate summary reflected the pending annotation/measurement results."
      },
      {
        "action": "Confirmed a seeded reviewer batch, reloaded the task, and opened the replay view for confirmed measurements.",
        "observed": "Canonical annotations reloaded without legacy OBB wording and confirmed measurements replayed successfully in the workbench."
      }
    ]
  },
  "tests": {
    "added": [
      {
        "file": "/Volumes/DPC/work/plant-code/plant3d-web/src/components/review/ReviewPanel.test.ts",
        "cases": [
          {
            "name": "reviewer workbench launches approved tools directly",
            "verifies": "ReviewPanel exposes direct-launch controls for text/cloud/rectangle and measurement."
          },
          {
            "name": "confirmed measurement payload replays after reload",
            "verifies": "Measurement stays temporary before confirmation and replayable after confirmation."
          }
        ]
      }
    ]
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- The feature requires a reviewer workflow or persistence decision not specified in the mission.
- Existing local changes conflict with required annotation edits and cannot be separated safely.
- Stable annotation or measurement replay cannot be stored without a broader API/schema decision.
- Manual validation is blocked because seeded reviewer tasks or required services are no longer reachable.
