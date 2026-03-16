# User Testing

## Validation Surface

**Primary Surface:** Browser UI at http://127.0.0.1:3101

**Tool:** agent-browser

**Entry Points:**
- Main app → Project selection → Designer role
- Designer task list
- Returned / resubmission task list
- Reviewer inbox
- Task detail modal

## Validation Concurrency

**Max Concurrent Validators:** 1

**Rationale:**
- Machine: 16GB RAM, 10 CPU cores
- Observed available memory during planning dry run: ~2.68GB
- Conservative 70% usable headroom: ~1.88GB
- agent-browser is workable, but current follow-up validation is list/detail heavy and does not benefit from parallel browser sessions
- Dry run confirmed validation is executable, but task seed data is limited and WebGL2 is unavailable in headless flow, so serial validation is the safer choice

## Testing Surface Details

**Consistency Follow-up Flows:**
1. Designer list vs returned list status consistency
2. Returned task detail reason/node and resubmit action visibility
3. Resubmit success clearing stale returned UI
4. Reviewer inbox re-visibility after resubmit
5. Websocket-triggered list refresh consistency
6. Navigation away/back state restoration for designer, returned, and reviewer lists

**Required Test Data:**
- Tasks in different designer-visible statuses, including returned/resubmittable cases
- Tasks with workflow history and explicit return reason/node
- At least one task that can be resubmitted back into reviewer inbox

## Dry Run Findings

- Validation path is runnable: frontend and backend both responded locally
- Designer list and reviewer inbox entry flows are reachable in browser automation
- Current limitation: task seed data may be missing, so some returned-task and cross-flow checks may require test data setup first
- Headless browser currently shows WebGL2 initialization failure, so validator focus should stay on task-list/detail flows rather than 3D viewer behavior
