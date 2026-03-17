# User Testing

## Validation Surface

**Primary Surface:** Browser UI at http://127.0.0.1:3101

**Tool:** agent-browser

**Entry Points:**
- Main app -> Project selection -> Reviewer-facing review entry surface
- Reviewer inbox / pending review list
- Review workbench (`ReviewPanel`)
- Auxiliary data and collision sections inside the workbench
- Workflow submit / return dialogs

## Validation Concurrency

**Max Concurrent Validators:** 1

**Rationale:**
- Browser validation for M4 should stay serial because reviewer-owned seed tasks and confirmed-record data are limited
- The main validation surface is the reviewer workbench chain, not high-parallel throughput
- WebGL2 constraints can still affect headless 3D-heavy checks, so prioritize workbench/task-context flows

## Flow Validator Guidance: browser-ui

- Stay on `http://127.0.0.1:3101` and backend `http://127.0.0.1:3100` only.
- Run browser validation serially; do not open concurrent browser validators for this milestone.
- Focus on reviewer inbox -> workbench -> workflow/records/aux-data flows.
- Treat missing reviewer-owned seeded tasks, confirmed records, or aux-data prerequisites as blocking environment issues.
- Use visible account-switcher entries only; do not invent hidden users or mutate backend state outside existing UI/API behavior.

## Testing Surface Details

**M4 Reviewer Workbench Flows:**
1. Reviewer selects a task and enters the workbench with normalized task context
2. Reviewer opens submit/return dialogs and confirms action labels/current node are correct
3. Workflow action refresh updates current task state and history
4. Confirmed-record surface and workflow-history surface remain semantically separate
5. Auxiliary data / collision behavior derives from the active task context
6. Sync import/export keeps the current workbench context coherent after refresh
7. M5/M6 surfaces are not required for the core M4 path

**Required Test Data:**
- At least one reviewer-visible task that can enter the workbench
- Preferably one task with workflow history
- Preferably one task with confirmed records or a reproducible way to observe the empty state
- If auxiliary-data/collision checks are required, task components with usable `refNo` context

## Dry Run Findings

- Frontend and backend are reachable locally in the current environment
- Reviewer entry into the workbench is the primary validation surface for this mission
- Seed data availability remains the main execution risk; lack of reviewer-owned tasks or confirmed records should be reported as blockers
- Headless WebGL constraints remain a reason to keep validation focused on workbench surfaces rather than broader 3D interaction claims
