# Annotation Refactor Environment

## Repository and Mission Paths

- Frontend repo: `D:/work/plant-code/plant3d-web`
- Backend repo: `D:/work/plant-code/plant-model-gen`
- Mission directory: `C:/Users/Administrator/.factory/missions/721db4de-bdc8-4f82-afdb-66cfddd40847`

## Shared Service Assumptions

- Frontend Vite server should run on `http://127.0.0.1:3101`
- Backend review web server should run on `http://127.0.0.1:3100`
- Supporting data-service assumptions should remain compatible with `8020` when contract validation needs them
- `9222` is reserved/off-limits for this mission

## Workspace Safety

- The frontend repository is already dirty; preserve unrelated changes exactly as found.
- Workers must avoid broad cleanup, `git checkout`, or cross-mission rewrites.
- Do not run the mission runner and do not create commits from this artifact set.

## Dependency and Tooling Baseline

- Frontend package management: `npm install`
- Frontend validators: `npm run type-check`, `npm run lint`, `npm test`
- Focused frontend iteration may use mission-scoped Vitest commands from `.factory/services.yaml`
- Backend contract validation should prefer live HTTP probes (`curl`) against `3100`

## Validation Notes

- Use deterministic seeded/demo review data whenever browser validation needs stable reviewer/designer flows.
- Keep browser validation conservative; assume one active browser validator at a time unless the orchestrator explicitly parallelizes isolated checks.
- If backend metadata rollout is partial, collect compatibility-window evidence instead of inventing missing fields.

## Common Blockers To Report

- frontend or backend service not reachable on the expected port
- seeded reviewer/designer data unavailable for the assigned validation flow
- inability to validate workflow-sync because `formId`-scoped query data is absent
- any requirement that would force use of port `9222`
