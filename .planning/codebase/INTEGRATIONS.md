# External Integrations

**Analysis Date:** 2026-01-30

## APIs & External Services

**Backend API:**
- Plant3D Model Generation API - CRUD operations for CAD model tasks
  - Base URL: Configurable via `VITE_GEN_MODEL_API_BASE_URL`
  - Endpoints: `/api/*` (proxied in dev via Vite)
  - Implementation: `src/api/genModelSearchApi.ts`, `src/api/genModelE3dApi.ts`, `src/api/genModelIndexTreeApi.ts`, `src/api/genModelTaskApi.ts`, `src/api/genModelPdmsAttrApi.ts`
  - Auth: JWT token stored in localStorage (`review_auth_token`)
  - Content-Type: application/json

**Review System API:**
- Review Task Management API - Task submission and review workflows
  - Base URL: Configurable via `VITE_REVIEW_WEB_BASE_URL` (fallback: window.location.origin)
  - Implementation: `src/api/reviewApi.ts`
  - Auth: JWT token in Authorization header (`Bearer <token>`)
  - Features: Designer tasks, reviewer tasks, resubmission tracking, annotations, attachments

**File Service:**
- Static file hosting/download service
  - Endpoints: `/files/*` (proxied in dev via Vite)
  - Used for CAD model assets, attachments, exported files

**CDN/External:**
- jsDelivr CDN - DuckDB WASM bundles (`@duckdb/duckdb-wasm`)
  - Usage: `src/composables/useDuckDBModelLoader.ts`
  - Purpose: Load DuckDB WASM runtime from CDN for in-browser SQL queries

## Data Storage

**Databases:**
- SurrealDB 3.0 - Primary database for Plant3D model metadata
  - Connection: WebSocket (configured via `VITE_SURREAL_URL`)
  - Client: `surrealdb` ^1.3.2
  - Implementation: `src/composables/useSurrealDB.ts`
  - Features: Real-time queries, namespace/database switching, signin authentication
  - Query language: SurrealQL
  - Tables: `pe` (piping elements), model instances, scene tree data

**In-Browser Databases:**
- DuckDB-WASM ^1.30.0 - Client-side SQL analytics
  - Implementation: `src/composables/useDuckDBModelLoader.ts`, `src/composables/useSceneTreeLoader.ts`
  - Purpose: Query remote DuckDB files via HTTP Range Requests (virtualized reading)
  - Web Worker: Runs in separate thread for performance

**File Storage:**
- Remote Parquet files - Columnar model data storage
  - Format: Apache Parquet (read via parquet-wasm)
  - Implementation: `src/composables/useParquetSqlStore.ts`
  - Purpose: Efficient storage/transmission of large CAD model geometry

**Caching:**
- Browser localStorage - Token storage, user preferences
- In-memory caching via @tanstack/vue-query - API response caching with configurable TTL

## Authentication & Identity

**Auth Provider:**
- Custom JWT-based authentication
  - Implementation: `src/api/reviewApi.ts`
  - Token storage: localStorage key `review_auth_token`
  - Token format: Bearer token in Authorization header
  - User roles: Designer, Reviewer, Admin (defined in `src/types/auth.ts`)
  - User store: `src/composables/useUserStore.ts`

**SurrealDB Auth:**
- Username/password signin via SurrealDB SDK
  - Config: `VITE_SURREAL_USER`, `VITE_SURREAL_PASS`
  - Namespace/database scoping: `VITE_SURREAL_NS`, `VITE_SURREAL_DB`

## Monitoring & Observability

**Error Tracking:**
- None (browser console only)

**Logs:**
- Console logging throughout application
  - Prefixed logs: `[SurrealDB]`, `[DuckDB-WASM]`, `[DTX]`
  - Implementation: `src/composables/useConsoleStore.ts` for in-app console panel
  - Benchmark utilities: `src/benchmark/surreal_sync_benchmark.ts`

## CI/CD & Deployment

**Hosting:**
- GitHub Pages (static deployment)
  - Base path: `/`
  - Output directory: `dist`
  - CI workflow: `.github/workflows/main.yml`

**CI Pipeline:**
- GitHub Actions
  - Trigger: Push to `main` branch
  - Build: Node 20, npm ci, Vite build
  - Deploy: `actions/deploy-pages@v4`
  - Concurrency: Single deployment group (`pages`)

**Dependency Management:**
- Dependabot enabled (`.github/dependabot.yml`)

## Environment Configuration

**Required env vars:**
- `VITE_SURREAL_URL` - SurrealDB WebSocket endpoint (e.g., ws://localhost:8020)
- `VITE_SURREAL_NS` - SurrealDB namespace (e.g., 1516)
- `VITE_SURREAL_DB` - SurrealDB database name (e.g., AvevaMarineSample)
- `VITE_SURREAL_USER` - SurrealDB username
- `VITE_SURREAL_PASS` - SurrealDB password
- `VITE_BACKEND_PORT` - Backend API port for dev proxy (default: 8080)
- `VITE_GEN_MODEL_API_BASE_URL` - Model generation API base URL (optional, defaults to empty)
- `VITE_REVIEW_WEB_BASE_URL` - Review web base URL (optional, auto-detected from window.location.origin)

**Secrets location:**
- Local development: `.env.development` (not committed, use `.env.example` as template)
- Production: GitHub Pages deployment (environment variables configured in repository settings)

## Webhooks & Callbacks

**Incoming:**
- None detected

**Outgoing:**
- WebSocket connections to SurrealDB for real-time data subscriptions
  - Implementation: `src/composables/useWebSocket.ts`
  - Purpose: Real-time task status updates, model change notifications

## Static Assets

**Configuration Files:**
- `public/config/model-display.config.json` - Material presets for CAD model rendering
  - Purpose: Configure display settings, materials, colors per PDMS noun types
  - Loaded at runtime: `src/utils/three/dtx/materialConfig.ts`

---

*Integration audit: 2026-01-30*
