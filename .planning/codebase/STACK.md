# Technology Stack

**Analysis Date:** 2026-01-30

## Languages

**Primary:**
- TypeScript ~5.9.3 - All application code, components, composables, utilities
- JavaScript (ES Module) - Configuration files (Vite, ESLint, Tailwind)

**Secondary:**
- SCSS/Sass ^1.94.2 - Vuetify styling customization
- CSS - Tailwind utilities and custom styles

## Runtime

**Environment:**
- Node.js 25.0.0 (development)
- Node.js 20 (CI/GitHub Actions)

**Package Manager:**
- pnpm (primary) - pnpm-lock.yaml present
- npm (CI fallback) - package-lock.json present
- Lockfile: Both pnpm-lock.yaml and package-lock.json exist

## Frameworks

**Core:**
- Vue.js ^3.5.24 - Frontend framework (Composition API)
- Vuetify ^3.11.2 - Material Design component library
- Vite ^7.2.7 - Build tool and dev server

**Testing:**
- Playwright ^1.57.0 - End-to-end testing (configured but tests not detected)

**Build/Dev:**
- Vite ^7.2.7 - Build tool with HMR, proxy, WASM support
- vue-tsc 3.1.6 - TypeScript type checking for Vue
- npm-run-all2 ^8.0.4 - Script orchestration
- PostCSS ^8.5.6 - CSS processing
- Autoprefixer ^10.4.21 - CSS vendor prefixing

## Key Dependencies

**Critical:**
- three ^0.162.0 - 3D rendering engine for CAD/Plant3D visualization
- surrealdb ^1.3.2 - WebSocket-based database client for real-time data
- @duckdb/duckdb-wasm ^1.30.0 - In-browser SQL query engine with HTTP Range Request support
- apache-arrow ^21.1.0 - Columnar data format for efficient model data transfer
- parquet-wasm ^0.7.1 - Parquet file reader (WASM-based)
- dockview-vue ^4.11.0 - Docking panel layout system for CAD-like interface

**Infrastructure:**
- @tanstack/vue-query ^5.92.1 - Async state management and data fetching
- @tanstack/vue-virtual ^3.13.12 - Virtual scrolling for large model trees
- three-viewport-gizmo ^2.2.0 - 3D viewport navigation control

**UI/Styling:**
- tailwindcss ^3.4.17 - Utility-first CSS framework
- tailwind-merge ^3.3.1 - Merge Tailwind classes without conflicts
- clsx ^2.1.1 - Conditional className utility
- lucide-vue-next ^0.535.0 - Icon library
- @mdi/font ^7.4.47 - Material Design Icons

**Linting/Quality:**
- ESLint ^9.39.1 - Code linting
- typescript-eslint ^8.48.1 - TypeScript ESLint integration
- eslint-plugin-vue ^10.6.2 - Vue-specific linting rules
- eslint-plugin-import-x ^4.16.1 - Import statement linting
- eslint-import-resolver-typescript ^4.4.4 - TypeScript import resolution

## Configuration

**Environment:**
- Configuration via Vite environment variables (VITE_* prefix)
- Example file: `.env.example`
- Required variables:
  - `VITE_SURREAL_URL` - SurrealDB WebSocket URL (default: ws://localhost:8020)
  - `VITE_SURREAL_NS` - Namespace (default: 1516)
  - `VITE_SURREAL_DB` - Database name (default: AvevaMarineSample)
  - `VITE_SURREAL_USER` - Username (default: root)
  - `VITE_SURREAL_PASS` - Password (default: root)
  - `VITE_BACKEND_PORT` - Backend API port (default: 8080)
  - `VITE_GEN_MODEL_API_BASE_URL` - Model generation API base URL
  - `VITE_REVIEW_WEB_BASE_URL` - Review web application base URL

**Build:**
- `vite.config.ts` - Vite configuration with dev proxy, WASM support, alias resolution
- `tsconfig.json` - Project references to app and node configs
- `tsconfig.app.json` - Application TypeScript config with Vue support
- `tsconfig.node.json` - Build tooling TypeScript config
- `tailwind.config.ts` - Tailwind CSS configuration with design tokens
- `postcss.config.cjs` - PostCSS with Tailwind and Autoprefixer
- `eslint.config.js` - Flat config format with TypeScript and Vue rules

## Platform Requirements

**Development:**
- Node.js >=20
- pnpm (recommended) or npm
- Modern browser with WebAssembly support (for DuckDB and Parquet)
- WebSocket support for SurrealDB

**Production:**
- GitHub Pages deployment (static hosting)
- Backend proxy required for `/api` and `/files` routes
- SurrealDB server (WebSocket endpoint)
- Model generation backend API

---

*Stack analysis: 2026-01-30*
