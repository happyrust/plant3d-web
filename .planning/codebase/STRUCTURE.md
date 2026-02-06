# Codebase Structure

**Analysis Date:** 2026-01-30

## Directory Layout

```
plant3d-web/
├── src/
│   ├── api/                    # Backend API clients
│   ├── assets/                 # Static assets (CSS, icons)
│   ├── benchmark/              # Performance benchmarking tools
│   ├── components/             # Vue components
│   │   ├── debug/              # Debug/diagnostic components
│   │   ├── dock_panels/        # Dockable panel wrappers
│   │   ├── model-project/      # Project selection UI
│   │   ├── model-query/        # Search/query panels
│   │   ├── model-tree/         # Tree view components
│   │   ├── review/             # Review workflow components
│   │   ├── ribbon/             # Top ribbon bar
│   │   ├── task/               # Task management UI
│   │   ├── tools/              # Measurement/annotation tools
│   │   ├── ui/                 # Reusable UI primitives
│   │   └── user/               # User profile components
│   ├── composables/            # Vue composables (state + logic)
│   ├── lib/                    # Shared library code
│   ├── meili/                  # MeiliSearch integration (if present)
│   ├── plugins/                # Vue/Vuetify plugins
│   ├── ribbon/                 # Ribbon configuration and event buses
│   ├── types/                  # TypeScript type definitions
│   ├── utils/                  # Utilities and helpers
│   │   ├── instances/          # Instance manifest handling
│   │   ├── storage/            # IndexedDB caching layer
│   │   └── three/              # Three.js extensions
│   │       └── dtx/            # DTX rendering engine
│   │           ├── outline/    # Outline/highlight effects
│   │           └── selection/  # GPU picking and selection
│   ├── viewer/                 # 3D viewer classes
│   │   └── dtx/                # DTX viewer implementation
│   ├── App.vue                 # Root component
│   └── main.ts                 # Application entry point
├── public/                     # Static public assets
├── .planning/                  # GSD planning documents
│   └── codebase/               # Codebase analysis docs
├── package.json                # NPM dependencies
├── vite.config.ts              # Vite build config
├── tsconfig.json               # TypeScript config
└── tailwind.config.js          # Tailwind CSS config
```

## Directory Purposes

**api:**
- Purpose: Backend HTTP API clients for model data, tasks, search, review
- Contains: TypeScript modules with typed fetch wrappers
- Key files: `genModelE3dApi.ts`, `genModelTaskApi.ts`, `reviewApi.ts`, `genModelSearchApi.ts`

**assets:**
- Purpose: Static CSS, SCSS, images, and PDMS type icons
- Contains: Global stylesheets, Tailwind entry point, icon SVGs
- Key files: `main.scss`, `tailwind.css`, `pdms-icons/16x16/`

**components/dock_panels:**
- Purpose: Wrapper components for dockview-vue panel system
- Contains: Panel dock containers that load actual feature components
- Key files: `ViewerPanel.vue`, `ModelTreePanelDock.vue`, `MeasurementPanelDock.vue`

**components/tools:**
- Purpose: Interactive 3D tools (measurement, annotation, material config)
- Contains: Feature-complete tool panels with business logic
- Key files: `MeasurementPanel.vue`, `MeasurementWizard.vue`, `AnnotationPanel.vue`, `DtxMaterialConfigPanel.vue`

**components/review:**
- Purpose: Review workflow UI (task lists, comments, file uploads)
- Contains: Components for designer/reviewer/resubmission roles
- Key files: `ReviewPanel.vue`, `InitiateReviewPanel.vue`, `ReviewerTaskList.vue`, `DesignerTaskList.vue`

**components/ribbon:**
- Purpose: Top ribbon bar with tabs and command buttons
- Contains: RibbonBar component implementing Microsoft-style ribbon interface
- Key files: `RibbonBar.vue`

**composables:**
- Purpose: Reusable Vue composition functions for state and logic
- Contains: Global stores, data loaders, tool managers, database clients
- Key files: `useViewerContext.ts`, `useToolStore.ts`, `useSelectionStore.ts`, `usePdmsOwnerTree.ts`, `useDbnoInstancesDtxLoader.ts`, `useSurrealDB.ts`, `useUnitSettingsStore.ts`

**utils/three/dtx:**
- Purpose: Custom DTX rendering engine core implementation
- Contains: DTXLayer, DTXMaterial, DTXGeometry, selection controllers
- Key files: `DTXLayer.ts`, `DTXMaterial.ts`, `DTXGeometry.ts`, `selection/DTXSelectionController.ts`, `selection/GPUPicker.ts`

**viewer/dtx:**
- Purpose: High-level 3D viewer classes wrapping Three.js and DTX
- Contains: Viewer initialization, camera controls, scene management
- Key files: `DtxViewer.ts`, `DtxCompatViewer.ts`, `dtxCadGrid.ts`

**ribbon:**
- Purpose: Ribbon configuration data and event bus infrastructure
- Contains: Command bus, toast bus, ribbon tabs/groups/buttons config, icon definitions
- Key files: `commandBus.ts`, `toastBus.ts`, `ribbonConfig.ts`, `ribbonIcons.ts`, `ribbonTypes.ts`

**types:**
- Purpose: Shared TypeScript type definitions
- Contains: Type definitions for specs, tasks, authentication
- Key files: `spec.ts`, `task.ts`, `auth.ts`

**utils/instances:**
- Purpose: Instance manifest parsing and indexing
- Contains: Logic to map refnos to geometry/transform data
- Key files: `instanceManifest.ts`

**utils/storage:**
- Purpose: Browser-based persistent caching (IndexedDB)
- Contains: Async key-value cache for geometry and metadata
- Key files: `indexedDbCache.ts`

## Key File Locations

**Entry Points:**
- `src/main.ts`: Application bootstrap, Vue app creation, component registration
- `src/App.vue`: Root component with RibbonBar and DockLayout

**Configuration:**
- `vite.config.ts`: Vite build config, proxy setup for backend API
- `tsconfig.json`: TypeScript compiler settings (references tsconfig.app.json and tsconfig.node.json)
- `package.json`: Dependencies (Vue 3, Three.js, Vuetify, dockview-vue, SurrealDB, DuckDB, etc.)
- `tailwind.config.js`: Tailwind CSS configuration

**Core Logic:**
- `src/viewer/dtx/DtxViewer.ts`: Three.js scene/camera/renderer setup
- `src/viewer/dtx/DtxCompatViewer.ts`: Higher-level viewer API with refno-based operations
- `src/utils/three/dtx/DTXLayer.ts`: DTX rendering engine (269 draw calls → 1 draw call optimization)
- `src/composables/usePdmsOwnerTree.ts`: PDMS tree data management and lazy loading
- `src/composables/useDbnoInstancesDtxLoader.ts`: Geometry loading and DTX registration

**Testing:**
- Not detected (no test files found in structure scan)

## Naming Conventions

**Files:**
- Vue components: PascalCase with `.vue` extension (e.g., `ViewerPanel.vue`, `RibbonBar.vue`)
- TypeScript modules: camelCase with `.ts` extension (e.g., `commandBus.ts`, `useToolStore.ts`)
- Composables: Prefix `use` + PascalCase (e.g., `useDtxTools.ts`, `useModelTree.ts`)
- API modules: Prefix `genModel` or domain name (e.g., `genModelE3dApi.ts`, `reviewApi.ts`)
- Type definitions: camelCase for general types, PascalCase for classes (e.g., `ribbonTypes.ts`, `DTXLayer.ts`)

**Directories:**
- kebab-case with hyphens (e.g., `dock_panels`, `model-tree`, `model-project`)
- Abbreviations in lowercase (e.g., `dtx`, `api`, `ui`)

## Where to Add New Code

**New Feature:**
- Primary code: `src/composables/use{FeatureName}.ts` for business logic
- UI component: `src/components/tools/{FeatureName}Panel.vue` or `src/components/{feature-category}/`
- Dock panel wrapper: `src/components/dock_panels/{FeatureName}PanelDock.vue`
- Tests: Not applicable (no test infrastructure detected)

**New Component/Module:**
- Implementation: `src/components/{category}/{ComponentName}.vue`
- Register globally in `src/main.ts` if used as dock panel
- Import path alias: Use `@/` prefix (configured in vite.config.ts)

**Utilities:**
- Shared helpers: `src/utils/{category}/{utilName}.ts`
- Three.js extensions: `src/utils/three/{feature}/`
- Type definitions: `src/types/{domain}.ts`

**New API Endpoint:**
- Client module: `src/api/{domain}Api.ts`
- Follow pattern: typed fetch wrapper, response DTOs, error handling with `success` boolean

**New Tool Mode:**
- Add mode to `ToolMode` type in `src/composables/useToolStore.ts`
- Implement handler in `src/composables/useDtxTools.ts`
- Add UI panel in `src/components/tools/`
- Register ribbon button in `src/ribbon/ribbonConfig.ts`

## Special Directories

**node_modules:**
- Purpose: NPM dependencies
- Generated: Yes (via `npm install`)
- Committed: No

**dist:**
- Purpose: Vite production build output
- Generated: Yes (via `npm run build`)
- Committed: No

**.planning/codebase:**
- Purpose: GSD codebase mapping documents
- Generated: By GSD map-codebase command
- Committed: Should be committed for team reference

**public:**
- Purpose: Static assets served at root (favicons, popout.html for dock popouts)
- Generated: No (manually created)
- Committed: Yes

**src/assets/pdms-icons/16x16:**
- Purpose: Icon set for PDMS object types (PIPE, ELBO, VALV, etc.)
- Generated: No (asset files)
- Committed: Yes

---

*Structure analysis: 2026-01-30*
