---
name: backend-spatial-worker
description: Implement SQLite spatial index, nearby query API, and backend contract changes for nearby-items missions.
---

# backend-spatial-worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the work procedure for backend spatial/index features that may touch the sibling repository `../plant-model-gen`.

## When to Use This Skill

Use this skill for features that modify or validate:
- SQLite spatial index generation or schema
- `spec_value` enrichment in index-backed results
- `GET /api/sqlite-spatial/query`
- `GET /api/sqlite-spatial/stats`
- backend spatial-query tests and smoke validation

## Work Procedure

1. Read the mission files first:
   - mission `AGENTS.md`
   - `validation-contract.md`
   - `features.json`
   - `.factory/library/architecture.md`
   - `.factory/library/environment.md`
2. Inspect the current backend implementation in `plant-model-gen` before changing code. Confirm whether the feature touches index build, query handler, response DTOs, or tests.
3. Write failing backend tests first (red). Prefer targeted Rust tests near the spatial API or index code you will change.
4. Implement the smallest backend change that makes the new tests pass while preserving existing `mode=refno` behavior.
5. If the feature depends on index contents, verify whether the index is non-empty. If the real blocker is missing or stale data, report it clearly instead of faking success.
6. Run focused verification commands, not broad unrelated suites:
   - targeted `cargo test` for spatial API
   - `cargo check --tests --lib --bins --features web_server`
   - `curl` smoke checks for `/api/health`, `/api/sqlite-spatial/stats`, and representative query paths when service startup is required
7. Capture concrete observations: whether stats changed, whether `spec_value` is present, whether bad parameters fail correctly, whether truncation is exposed.
8. If you start backend services, stop them before handoff unless a validator is explicitly reusing them.

## Example Handoff

```json
{
  "salientSummary": "Extended the SQLite spatial query contract to return spec_value and added position-mode query coverage while keeping refno mode intact.",
  "whatWasImplemented": "Updated the spatial index import path to persist spec_value into the SQLite items table, enriched the API response DTO to expose spec_value, added mode=position query parsing and validation, and added targeted Rust tests for valid queries, invalid params, and fallback handling.",
  "whatWasLeftUndone": "The AMS fixture index is still empty on this machine, so end-to-end data proof for a real nearby result set remains blocked until the index rebuild path is completed or valid source data is provided.",
  "verification": {
    "commandsRun": [
      {
        "command": "cargo test --manifest-path /Volumes/DPC/work/plant-code/plant-model-gen/Cargo.toml --features web_server web_server::sqlite_spatial_api::tests:: -- --nocapture",
        "exitCode": 0,
        "observation": "Targeted spatial API tests passed, including position-mode parsing, refno-mode regression coverage, and error handling expectations."
      },
      {
        "command": "cargo check --manifest-path /Volumes/DPC/work/plant-code/plant-model-gen/Cargo.toml --tests --lib --bins --features web_server",
        "exitCode": 0,
        "observation": "Backend typecheck passed after the spatial DTO and index changes."
      },
      {
        "command": "curl -sf http://127.0.0.1:3100/api/sqlite-spatial/stats",
        "exitCode": 0,
        "observation": "Stats endpoint responded successfully and exposed the current index readiness state for manual confirmation."
      }
    ],
    "interactiveChecks": []
  },
  "tests": {
    "added": [
      {
        "file": "/Volumes/DPC/work/plant-code/plant-model-gen/src/web_server/sqlite_spatial_api.rs",
        "cases": [
          {
            "name": "returns spec_value in nearby query results",
            "verifies": "Clients receive grouping-ready spec_value directly from the spatial API response."
          },
          {
            "name": "rejects invalid position query params",
            "verifies": "Mode-specific validation rejects incomplete or malformed position inputs before query execution."
          }
        ]
      }
    ]
  },
  "discoveredIssues": [
    {
      "severity": "non_blocking",
      "description": "The local spatial index still starts empty, so a real AMS nearby result proof depends on successful index regeneration rather than API code alone.",
      "suggestedFix": "Complete the approved index rebuild feature and then rerun backend smoke queries against known AMS fixtures."
    }
  ]
}
```

## When to Return to Orchestrator

- The backend cannot generate a non-empty index from locally available data.
- `spec_value` source-of-truth becomes ambiguous across export/index layers.
- The requested feature would require breaking an already-approved query contract without clear frontend agreement.
- A blocker depends on unrelated infrastructure or user-provided data that is not present locally.
