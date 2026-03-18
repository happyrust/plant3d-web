# User Testing

## Validation Surface

**Primary Surface:** Browser UI at http://127.0.0.1:3101

**Tool:** agent-browser

**Entry Points:**
- Main app -> project selection -> reviewer role switch
- Reviewer workbench (`ReviewPanel`) for direct-launch annotation and measurement
- Designer tracking/detail/resubmit surfaces
- Task-thread collaboration surface
- Annotation-thread collaboration surface

## Validation Concurrency

**Max Concurrent Validators:** 1

**Rationale:**
- Current machine headroom and load only support one safe browser validator at a time
- Seeded reviewer/designer demo data is the main validation bottleneck, not throughput
- Headless WebGL2 limits make annotation/measurement-heavy flows more fragile, so serial validation is safer

## Flow Validator Guidance: browser-ui

- Stay on `http://127.0.0.1:3101` with backend on `http://127.0.0.1:3100` only.
- Run browser validation serially; do not open concurrent browser validators for this mission.
- Generate or refresh the scripted demo data before attempting final reviewer/designer user-surface validation.
- Focus on seeded reviewer -> designer -> reviewer flows rather than opportunistic live business data.
- Treat missing seeded tasks, collaboration fixtures, or headless WebGL2 replay limits as explicit environment blockers.

## Testing Surface Details

### M6 Flows
1. Reviewer enters a seeded task workbench.
2. Reviewer directly launches text/cloud/rectangle annotation and measurement from the workbench.
3. Reviewer confirms annotation and measurement candidates.
4. Workbench reloads canonical annotations and replayable confirmed measurement records.
5. Designer surfaces show the same confirmed measurement/annotation result set after handoff.

### M7 Flows
1. Reviewer opens task-thread and annotation-thread from seeded tasks.
2. Reviewer performs replies, edit/delete, resolve/unresolve, mentions, and attachments.
3. Designer opens the same task and sees the same thread continuity.
4. Reviewer returns task, designer resubmits, reviewer reopens.
5. Thread lineage, read state, and replayable records remain coherent after the loop.

## Required Test Data

- Seeded reviewer-visible task set covering text/cloud/rectangle annotation scenarios
- Seeded measurement replay scenario
- Seeded task-thread scenario
- Seeded annotation-thread scenario
- Seeded reviewer -> designer -> reviewer return/resubmit/reopen path

## Dry Run Findings

- Frontend and backend are reachable locally in the current environment.
- Reviewer role switching and review surface entry are reachable.
- Current live reviewer/designer queues remain empty without scripted demo data, so seeded data is mandatory for final mission validation.
- Headless WebGL2 constraints remain a likely blocker for rich annotation/measurement replay checks; user-surface reports must distinguish this from product defects.
