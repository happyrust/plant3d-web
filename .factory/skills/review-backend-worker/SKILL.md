---
name: review-backend-worker
description: Implement annotation refactor backend features in plant-model-gen (Rust/Axum)
---

# Review Backend Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the WORK PROCEDURE.

## When to Use This Skill

Backend API changes in plant-model-gen: metadata field extensions (annotationKey, workflowNode, reviewRound), comment PATCH endpoint, annotation severity PATCH, workflow-sync payload expansion, WebSocket event enhancements, compatibility window management.

## Required Skills

None — backend work is verified via cargo check and curl probes.

## Work Procedure

1. **Read the feature description** and identify affected backend files. The main review API is at `D:\work\plant-code\plant-model-gen\src\web_api\review_api.rs`. Platform API is at `src\web_api\platform_api\`.

2. **Understand existing patterns**:
   - Read the relevant handler functions in review_api.rs
   - Note the SurrealDB query patterns used (raw SQL via `db.query()`)
   - Note the response normalization patterns (snake_case → camelCase)

3. **Implement changes**:
   - Add new fields to SurrealDB CREATE/UPDATE queries
   - Add new handler functions for new endpoints (e.g., PATCH comment)
   - Register routes in the router function
   - Maintain backward compatibility: new fields are optional, old responses still valid

4. **Run quality gate**:
   - `cd D:\work\plant-code\plant-model-gen && cargo check --bin web_server --features web_server` — MUST compile
   - If possible, `cargo build --bin web_server --features web_server --release` for full build

5. **Curl verification** (when backend is running):
   - Start backend if not running
   - Test new/modified endpoints with curl
   - Verify backward compatibility with old request shapes
   - Record each probe as a `commandsRun` entry

6. **Commit** with `feat(review): ...` or `fix(review): ...`

## Example Handoff

```json
{
  "salientSummary": "Added PATCH /api/review/comments/item/{id} endpoint for comment editing. Cargo check passes. Curl-verified: update returns modified comment with edited marker.",
  "whatWasImplemented": "Added update_comment handler in review_api.rs. Registered PATCH route. SurrealDB UPDATE query sets content and updatedAt. Returns full comment object.",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      { "command": "cargo check --bin web_server --features web_server", "exitCode": 0, "observation": "Compiles with 2 warnings (from pdms_io dependency)" },
      { "command": "curl -X PATCH http://localhost:3100/api/review/comments/item/comment-abc -H 'Content-Type: application/json' -d '{\"content\":\"updated text\"}'", "exitCode": 0, "observation": "200 OK, comment.content updated, updatedAt set" }
    ],
    "interactiveChecks": []
  },
  "tests": { "added": [] },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- SurrealDB schema migration is needed that could affect other modules
- Changes to shared Rust crates (rs-core, pdms-io-fork) are required
- Compilation fails due to dependency issues outside review module
- Need to add new Cargo dependencies
