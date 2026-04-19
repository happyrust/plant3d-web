---
name: review-fullstack-worker
description: Implement features spanning both plant3d-web frontend and plant-model-gen backend
---

# Review Fullstack Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the WORK PROCEDURE.

## When to Use This Skill

Features that require coordinated frontend + backend changes: comment decoupling with API changes, realtime convergence (WebSocket + frontend handlers), metadata extension (backend fields + frontend consumption), workflow-sync payload expansion.

## Required Skills

- `agent-browser` — For end-to-end browser verification after both frontend and backend changes are complete.

## Work Procedure

1. **Read feature description** and identify both frontend and backend changes needed.

2. **Backend first** (if feature adds/modifies API):
   - Implement backend changes in `D:\work\plant-code\plant-model-gen`
   - `cargo check --bin web_server --features web_server` — MUST compile
   - Curl-verify new endpoints if backend is running

3. **Frontend second**:
   - Write tests first (RED) in plant3d-web
   - Implement frontend changes to consume new/modified API
   - `npm run type-check` + `npm run lint` + `npm test -- --run`

4. **End-to-end verification** (when both services can run):
   - Start backend and frontend (see services.yaml)
   - Use agent-browser to verify the complete flow
   - Use curl to verify API contract changes

5. **Commit both repos** with matching conventional commit messages

## Example Handoff

```json
{
  "salientSummary": "Added workflowNode and reviewRound fields to records and comments APIs. Frontend consumes new fields in ReviewSnapshot adapter. Cargo check passes. 6 new frontend tests pass. Browser-verified round filter works.",
  "whatWasImplemented": "Backend: Extended SurrealDB record/comment schema with workflowNode and reviewRound. Added fields to create/read handlers. Frontend: Updated reviewRecordAdapter to extract new metadata. Added round-filter toggle to ReviewCommentsTimeline.",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      { "command": "cargo check --bin web_server --features web_server", "exitCode": 0, "observation": "Compiles" },
      { "command": "npm run type-check", "exitCode": 0, "observation": "Zero errors" },
      { "command": "npm test -- --run", "exitCode": 1, "observation": "849 passed, 43 pre-existing failures" },
      { "command": "curl http://localhost:3100/api/review/records/by-task/test-task-1", "exitCode": 0, "observation": "Records include workflowNode and reviewRound fields" }
    ],
    "interactiveChecks": [
      { "action": "Open task with multi-round annotations", "observed": "Round filter toggle visible, switching shows correct subset" }
    ]
  },
  "tests": {
    "added": [
      { "file": "src/review/adapters/reviewRecordAdapter.test.ts", "cases": [
        { "name": "extracts workflowNode from record metadata", "verifies": "Metadata extraction" },
        { "name": "handles missing metadata gracefully", "verifies": "Backward compat" }
      ]}
    ]
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- Backend compilation fails due to dependency issues
- Frontend and backend contract changes are incompatible
- SurrealDB schema migration would affect non-review modules
- WebSocket implementation location is unclear
