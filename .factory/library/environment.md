# Environment

Environment variables, shared services, and setup notes for the MBD layout consistency mission.

## Local Development Environment

- Node.js 20+ preferred
- npm available for dependency install and mission-scoped commands
- Vite frontend app served locally on `http://127.0.0.1:3101`

## Shared Service Assumptions

- Frontend: `http://127.0.0.1:3101`
- Backend: `http://127.0.0.1:3100` (optional for this frontend-first mission)
- Workers must not stop shared services they did not start
- The repository worktree is already dirty; unrelated changes must remain untouched

## Mission-Specific Environment Notes

- The mission is designed to succeed without backend producer changes in other repositories.
- The strongest evidence comes from focused unit and fixture tests, not from broad end-to-end infrastructure.
- If a BRAN-specific spot check is performed, use BRAN `24381_145717` as the anchor target.
- New pure-layout tests are encouraged when they strengthen deterministic behavior checks.

## Environment Variables

The project follows Vite environment conventions. No new mission-specific environment variables are required by default.

If a worker introduces optional debugging flags for layout comparison, they must:
- default them off
- document them in the handoff
- avoid checking secrets or machine-specific values into git

## Lint and Test Scope Note

- Use mission-scoped commands from `.factory/services.yaml` as the gate.
- Do not treat whole-repo `npm run lint` or `npm test` as required mission blockers unless the changed surface specifically depends on them.
