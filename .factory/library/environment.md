# Nearby Items Environment

## Repository Paths

- Frontend root: `/Volumes/DPC/work/plant-code/plant3d-web`
- Backend root: `/Volumes/DPC/work/plant-code/plant-model-gen`
- Mission dir: `/Users/dongpengcheng/.factory/missions/4bd05dbc-269c-492b-949f-10e6096385fa`

## Ports

- Backend API: `127.0.0.1:3100`
- Frontend Vite dev server: `127.0.0.1:3101`

Do not take over unrelated observed ports such as `5000`, `7000`, or `8020`.

## Service Commands

- Backend start:
  `DB_OPTION_FILE=/Volumes/DPC/work/plant-code/plant-model-gen/db_options/DbOption-mac.toml WEB_SERVER_PORT=3100 cargo run --manifest-path /Volumes/DPC/work/plant-code/plant-model-gen/Cargo.toml --bin web_server --features web_server`
- Frontend start:
  `npm --prefix /Volumes/DPC/work/plant-code/plant3d-web run dev -- --host 127.0.0.1 --port 3101 --strictPort`

## Validation Commands

- Frontend tests:
  `npm --prefix /Volumes/DPC/work/plant-code/plant3d-web test`
- Frontend type-check:
  `npm --prefix /Volumes/DPC/work/plant-code/plant3d-web run type-check`
- Frontend lint:
  `npm --prefix /Volumes/DPC/work/plant-code/plant3d-web run lint`
- Backend targeted tests:
  `cargo test --manifest-path /Volumes/DPC/work/plant-code/plant-model-gen/Cargo.toml --features web_server web_server::sqlite_spatial_api::tests:: -- --nocapture`
- Backend type-check:
  `cargo check --manifest-path /Volumes/DPC/work/plant-code/plant-model-gen/Cargo.toml --tests --lib --bins --features web_server`
- E2E:
  `npm --prefix /Volumes/DPC/work/plant-code/plant3d-web run test:e2e`

## Known Starting State

- Frontend browser automation path is executable locally.
- Backend health endpoint is reachable locally.
- Mission starts with `spatial_index.sqlite` effectively empty (`total_elements: 0`), so rebuilding or regenerating a non-empty index is part of the approved work.

## Worker Guidance

- Use absolute paths whenever you touch the backend repository from the frontend working directory.
- Stop background services you start unless a validator explicitly reuses them.
- If local data is insufficient to build a non-empty index, return to orchestrator with evidence rather than fabricating fixtures silently.
