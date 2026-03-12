---
name: integration-nearby-worker
description: Align cross-repo nearby flow, AMS project context, service wiring, and E2E validation for the nearby-items mission.
---

# integration-nearby-worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the work procedure for cross-repo nearby-items features and validation.

## When to Use This Skill

Use this skill for features that span both repositories, including:
- frontend API client and backend contract alignment
- AMS project entry and output-path correctness
- load-by-refno / show-nearby bridging into viewer
- local `3100/3101` service orchestration
- Playwright/E2E and manual validation of the full nearby flow

## Work Procedure

1. Read the mission files first:
   - mission `AGENTS.md`
   - `validation-contract.md`
   - `features.json`
   - `.factory/library/architecture.md`
   - `.factory/library/environment.md`
   - `.factory/library/user-testing.md`
2. Verify the current local environment and service commands before making changes. Reuse `3100` and `3101`; do not move the mission to different ports without orchestrator approval.
3. For integration behavior, write the failing test first where possible:
   - Playwright/E2E for user-observable flow
   - targeted integration tests for API client wiring or project context mapping
4. Implement the smallest cross-repo change necessary to align:
   - project context
   - nearby API client contract
   - unloaded-result load path
   - viewer focus target identity
5. Start services only as needed for verification. Confirm:
   - backend health endpoint
   - frontend entry page
   - AMS project entry path
   - nearby flow reaching backend and surfacing real results
6. Capture at least one end-to-end observable path with concrete evidence. If the index is still empty, report that limitation explicitly and avoid over-claiming.
7. Stop services you started before handoff unless the validation framework is intentionally reusing them.

## Example Handoff

```json
{
  "salientSummary": "Aligned the AMS nearby flow across both repositories so backend query results can be loaded, grouped, and focused from the real project entry path on ports 3100 and 3101.",
  "whatWasImplemented": "Updated the cross-repo nearby client contract, ensured AMS project context resolves consistently, bridged unloaded nearby refnos into the existing load-by-refno path, and added E2E coverage for opening AMS, querying nearby items, and focusing the clicked result in the viewer.",
  "whatWasLeftUndone": "The only remaining limitation is data-dependent: if the local spatial index is still empty, end-to-end proof is limited to flow wiring rather than real nearby result content.",
  "verification": {
    "commandsRun": [
      {
        "command": "curl -sf http://127.0.0.1:3100/api/health",
        "exitCode": 0,
        "observation": "Backend health endpoint responded successfully on the mission port."
      },
      {
        "command": "npm --prefix /Volumes/DPC/work/plant-code/plant3d-web run test:e2e",
        "exitCode": 0,
        "observation": "Playwright nearby-flow coverage passed against the AMS entry path and real local ports."
      }
    ],
    "interactiveChecks": [
      {
        "action": "Opened AMS project in the browser, ran a nearby query, and clicked a result after the grouped list rendered.",
        "observed": "The grouped nearby results were visible and the clicked item matched the viewer-focused target under the same AMS project context."
      }
    ]
  },
  "tests": {
    "added": [
      {
        "file": "/Volumes/DPC/work/plant-code/plant3d-web/e2e/nearby-items.spec.ts",
        "cases": [
          {
            "name": "opens AMS and drives nearby query from the real viewer workspace",
            "verifies": "The AMS entry path, nearby panel, and backend contract work together on the approved local ports."
          },
          {
            "name": "clicking a grouped nearby result focuses the same viewer item",
            "verifies": "Result identity remains aligned across UI list item and viewer focus target."
          }
        ]
      }
    ]
  },
  "discoveredIssues": [
    {
      "severity": "non_blocking",
      "description": "If the local index data does not include representative uncategorized rows, uncategorized end-to-end proof may require a more explicit fixture.",
      "suggestedFix": "Seed or regenerate the index with a known uncategorized sample and rerun the E2E/manual validation path."
    }
  ]
}
```

## When to Return to Orchestrator

- The AMS entry path or project resolution is inconsistent across runs.
- The backend and frontend contracts are individually working but cannot be reconciled without changing mission scope.
- E2E validation is blocked by missing local data, missing services, or an environment constraint that cannot be solved within the approved boundaries.
- The feature would require changes to unrelated project-selection or viewer architecture beyond nearby-items scope.
