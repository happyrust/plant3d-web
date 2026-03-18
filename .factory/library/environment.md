# Environment

Environment variables, external dependencies, and setup notes for the current mission.

**What belongs here:** required environment variables, shared services, runtime assumptions, and mission-specific environment blockers.
**What does NOT belong here:** service commands and ports (use `.factory/services.yaml`).

---

## Local Development Environment

- Node.js 18+
- npm or pnpm
- Modern browser tooling for local validation

## Shared Service Assumptions

- Frontend app: http://127.0.0.1:3101
- Backend API: http://127.0.0.1:3100
- Review websocket path may exist, but mission success should not depend on a websocket-first rewrite
- Shared backend on 3100 must remain running; mission workers should not stop it

## Mission-Specific Environment Notes

- The M6+M7 mission depends on **scripted demo data** for deterministic reviewer/designer validation.
- Missing seeded reviewer/designer tasks are an environment blocker, not evidence that the product passes or fails.
- Headless WebGL2 limitations may block realistic annotation/measurement replay validation even when other surfaces are reachable; record this explicitly when encountered.
- Current browser validation concurrency is limited to 1 because machine headroom is constrained.

## Environment Variables

The project uses Vite environment variables. Follow `.env.example` if additional variables become necessary.

No new mission-specific environment variables are required by default; if workers add any, they must document them here and keep secrets out of git.

## Lint Note

`npm run lint` in `package.json` uses `eslint . --fix` across the whole repository.

- Use `npx eslint <files>` for focused read-only checks on mission-owned files.
- Do not rely on whole-repo lint output as the milestone gate when focused checks already prove the changed surface.
