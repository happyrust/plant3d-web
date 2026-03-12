---
name: frontend-nearby-worker
description: Implement nearby toolbar, panel controls, grouped results, and viewer-linked UI behavior in plant3d-web.
---

# frontend-nearby-worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the work procedure for nearby-items frontend features in `plant3d-web`.

## When to Use This Skill

Use this skill for features that touch:
- left toolbar entry for nearby items
- nearby panel UI and state
- refno / position input flows
- distance slider + manual input synchronization
- grouped result rendering by `spec_value`
- result click behavior that drives viewer selection/highlight/focus

## Work Procedure

1. Read the mission files first:
   - mission `AGENTS.md`
   - `validation-contract.md`
   - `features.json`
   - `.factory/library/architecture.md`
   - `.factory/library/user-testing.md`
2. Inspect existing toolbar, dock panel, viewer context, and selection store patterns before editing code.
3. Write failing frontend tests first (red). Prefer focused Vitest/component tests for UI state and behavior. Add Playwright/E2E coverage when the feature spans real AMS flow or viewer behavior.
4. Implement the smallest UI/state change that makes the new tests pass while preserving existing dock/panel conventions.
5. Keep user-visible state explicit:
   - active mode
   - current target refno or position
   - synchronized distance controls
   - loading / empty / error states
   - grouped result context
6. When wiring viewer interaction, verify the clicked result identity matches the viewer-focused identity. Do not settle for “some object moved.”
7. Run targeted validation:
   - focused Vitest files
   - `npm --prefix /Volumes/DPC/work/plant-code/plant3d-web run type-check`
   - E2E or manual checks for toolbar/panel/viewer behavior when needed
8. Stop any services you start for ad hoc validation unless a validator is explicitly reusing them.

## Example Handoff

```json
{
  "salientSummary": "Added the nearby toolbar entry and left panel, including refno/position mode switching, synchronized distance controls, grouped results, and viewer-linked result clicks.",
  "whatWasImplemented": "Created the nearby panel entry in the left toolbar, added panel state for refno and position query modes, synchronized slider/manual distance input, implemented loading/empty/error states, rendered grouped results by spec_value, and wired result clicks to the existing viewer focus/highlight path.",
  "whatWasLeftUndone": "Manual proof for uncategorized grouping remains dependent on backend data that actually returns missing or zero-like spec_value values in the local index.",
  "verification": {
    "commandsRun": [
      {
        "command": "npm --prefix /Volumes/DPC/work/plant-code/plant3d-web test -- src/components/nearby/NearbyPanel.test.ts",
        "exitCode": 0,
        "observation": "Focused nearby panel tests passed, covering mode switching, distance sync, loading state, empty state, and grouped result rendering."
      },
      {
        "command": "npm --prefix /Volumes/DPC/work/plant-code/plant3d-web run type-check",
        "exitCode": 0,
        "observation": "Frontend type-check passed after panel state and viewer interaction wiring changes."
      }
    ],
    "interactiveChecks": [
      {
        "action": "Opened AMS project, clicked the nearby toolbar entry, ran a search, then clicked a grouped result.",
        "observed": "The nearby panel opened in the left area, grouped results rendered, and the clicked item became the focused/highlighted viewer target."
      }
    ]
  },
  "tests": {
    "added": [
      {
        "file": "/Volumes/DPC/work/plant-code/plant3d-web/src/components/nearby/NearbyPanel.test.ts",
        "cases": [
          {
            "name": "keeps slider and manual distance input synchronized",
            "verifies": "The user never sees conflicting distance values between the two controls."
          },
          {
            "name": "groups nearby results by spec_value",
            "verifies": "The rendered result list is grouped into stable discipline buckets, including uncategorized fallback."
          }
        ]
      }
    ]
  },
  "discoveredIssues": [
    {
      "severity": "non_blocking",
      "description": "The real AMS end-to-end proof for some grouping buckets depends on backend index data quality rather than frontend rendering logic.",
      "suggestedFix": "After backend index enrichment lands, rerun the AMS nearby flow and capture bucket-specific evidence."
    }
  ]
}
```

## When to Return to Orchestrator

- Backend contract required by the feature is missing or unstable, especially `spec_value`, truncation, or `mode=position` behavior.
- Viewer focus/highlight hooks cannot be reused cleanly without a broader architecture decision.
- AMS project entry flow is inconsistent enough that nearby UI cannot be validated reliably.
- A requested fix would require refactoring unrelated UI systems outside the approved mission scope.
