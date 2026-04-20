---
name: review-demo-seed-worker
description: Build repeatable scripted demo data and validation bootstrap artifacts for review/annotation missions, including M2 restore validation and later collaboration milestones.
---

# review-demo-seed-worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the work procedure for review demo/bootstrap seed features.

## When to Use This Skill

Use this skill for features that touch:
- scripted seed generation for reviewer/designer/approver demo tasks
- demo-data reset/regeneration behavior
- mission-specific validation bootstrap scripts or docs
- backend/API preparation needed to make seeded validation deterministic
- tracked M2 restore bootstrap artifacts and discoverability docs

## Work Procedure

1. Read mission context first:
   - mission `mission.md`
   - mission `AGENTS.md`
   - `validation-contract.md`
   - `features.json`
   - `.factory/library/architecture.md`
   - `.factory/library/environment.md`
   - `.factory/library/user-testing.md`
   - `.factory/library/m6-m7-review-collaboration.md` when relevant
   - any milestone-specific bootstrap docs already present (for example `.factory/library/m2-restore-bootstrap.md`)
2. Inspect the current backend/frontend entry points for demo data before editing:
   - existing review task APIs
   - any existing seed or mock scripts
   - reviewer/designer role assumptions in the current app
3. Write tests or executable checks first (red) for the seed contract whenever practical. At minimum, create a repeatable verification command that proves the seed output shape.
4. Implement a deterministic seed path that can be rerun safely. Prefer explicit IDs/names/statuses over random behavior.
   - Use tracked repo locations for committed deliverables. In this repo prefer `debug_scripts/` for executable seed utilities/tests unless the feature explicitly requires another tracked path.
5. Make seed output easy to inspect: roles, task IDs/titles, and which scenario each task covers.
6. Verify idempotence by running the seed path more than once and comparing the resulting scenario inventory.
7. Run targeted validation before handoff:
   - mission seed command(s)
   - `npm --prefix /Volumes/DPC/work/plant-code/plant3d-web run type-check` if frontend code changed
   - focused tests or backend checks relevant to the seed path
8. Perform manual verification using browser or API checks to prove the seeded reviewer/designer tasks are discoverable in the app.
   - For M2 restore bootstrap features, the artifact must explicitly document a confirmed-task scenario, an empty-task clearing scenario, and a formId-backed embed restore scenario with exact identifiers/routes later validators can read directly.
9. Stop any ad hoc services/processes you start unless a validator is explicitly reusing them.

## Example Handoff

```json
{
  "salientSummary": "Added a deterministic review demo/bootstrap generator and proved that rerunning it recreates the same reviewer/designer scenarios without duplicating tasks.",
  "whatWasImplemented": "Created a scripted seed path that provisions reviewer, designer, and approver demo tasks with inventory output so validators can locate each seeded scenario deterministically, and documented how to refresh the dataset before browser validation.",
  "whatWasLeftUndone": "Attachment binary fixture generation still uses placeholder files; product-quality sample attachments can be improved later if UX review needs richer files.",
  "verification": {
    "commandsRun": [
      {
        "command": "python3 debug_scripts/review_demo_seed.py --reset",
        "exitCode": 0,
        "observation": "Seed script created the expected scenario inventory and printed stable task identifiers for all seeded reviewer/designer flows."
      },
      {
        "command": "python3 debug_scripts/review_demo_seed.py --reset",
        "exitCode": 0,
        "observation": "Second run reproduced the same scenario inventory without duplicate tasks, confirming idempotence."
      },
      {
        "command": "curl -sf http://127.0.0.1:3100/api/review/tasks?checker_id=user-002",
        "exitCode": 0,
        "observation": "Seeded reviewer tasks were discoverable through the backend API after regeneration."
      }
    ],
    "interactiveChecks": [
      {
        "action": "Opened the app, switched to reviewer role, and inspected the pending seeded tasks after running the seed command.",
        "observed": "The reviewer inbox showed the seeded scenarios needed for text/cloud/rectangle, measurement replay, and collaboration validation."
      }
    ]
  },
  "tests": {
    "added": [
      {
        "file": "D:/work/plant-code/plant3d-web/debug_scripts/review_demo_seed_test.py",
        "cases": [
          {
            "name": "seed script creates canonical scenario inventory",
            "verifies": "The generator emits all required reviewer/designer scenario types with deterministic identifiers."
          },
          {
            "name": "seed script is idempotent under reset",
            "verifies": "Repeated generation refreshes the dataset rather than appending duplicates."
          }
        ]
      }
    ]
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- The backend lacks the API/data hooks needed to generate or reset the required demo scenarios.
- Deterministic seed generation would require an unsafe destructive operation outside the approved local demo scope.
- Reviewer/designer roles or workflow nodes needed by the scenarios are ambiguous.
- Browser/manual verification cannot locate the seeded tasks after the generator runs.
