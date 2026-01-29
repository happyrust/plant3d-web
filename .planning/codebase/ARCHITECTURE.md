# Architecture

**Analysis Date:** 2026-01-30

## Pattern Overview

**Overall:** Component-Based 3D Visualization Architecture with DTX Rendering Engine

**Key Characteristics:**
- Vue 3 Composition API for reactive UI components
- Custom DTX (Data Texture) rendering layer for high-performance 3D visualization
- Dock-based layout system for flexible panel management
- Event-driven communication via command bus pattern
- Global singleton stores for cross-component state sharing

## Layers

**Presentation Layer:**
- Purpose: UI components, panels, and user interactions
- Location: `src/components/`
- Contains: Vue components organized by feature (dock_panels, tools, review, model-tree, ribbon)
- Depends on: Composables layer, Viewer layer, API layer
- Used by: Main application entry point

**Composables Layer (Business Logic):**
- Purpose: Reusable reactive state management and business logic
- Location: `src/composables/`
- Contains: Vue composables for state stores, data loading, tools management, database connections
- Depends on: API layer, Utils layer, Viewer layer
- Used by: Presentation components, other composables

**Viewer Layer (3D Rendering):**
- Purpose: Three.js-based 3D visualization engine with custom DTX optimization
- Location: `src/viewer/dtx/`, `src/utils/three/dtx/`
- Contains: DtxViewer, DtxCompatViewer, DTXLayer rendering engine, selection controllers
- Depends on: Three.js library, Utils layer
- Used by: ViewerPanel component, measurement/annotation tools

**API Layer:**
- Purpose: Backend communication and data fetching
- Location: `src/api/`
- Contains: HTTP clients for model tree, spatial queries, tasks, search, review workflow
- Depends on: External backend services
- Used by: Composables layer

**Utils Layer:**
- Purpose: Shared utilities and low-level helpers
- Location: `src/utils/`
- Contains: Matrix operations, geometry parsing, unit formatting, storage caching, DTX rendering primitives
- Depends on: None (leaf layer)
- Used by: All other layers

**Infrastructure Layer:**
- Purpose: Application configuration and plugins
- Location: `src/plugins/`, `src/ribbon/`, `src/types/`
- Contains: Vuetify setup, ribbon configuration, TypeScript type definitions, command/toast event buses
- Depends on: None
- Used by: Main entry point and all layers

## Data Flow

**Model Loading Flow:**

1. User selects project via `useModelProjects` composable
2. `usePdmsOwnerTree` fetches tree structure from backend via `genModelE3dApi`
3. Tree nodes are normalized and stored in `nodesById` reactive state
4. User expands node → triggers `e3dGetChildren` API call
5. `useDbnoInstancesDtxLoader` loads 3D geometry from GLB files
6. Geometry is registered with `DTXLayer` as GPU-optimized data textures
7. `DtxViewer` renders scene with single draw call via DTX shader

**Selection & Visibility Flow:**

1. User clicks on 3D object → `DTXSelectionController` performs GPU picking
2. Picked object ID mapped to refno via `useDbnoInstancesDtxLoader` cache
3. `useSelectionStore` updates selected refno set
4. `usePdmsOwnerTree` updates tree UI checkboxes via `checkStateById`
5. `DtxCompatViewer` updates DTX layer object visibility flags
6. Shader reads updated flags from data texture → renders visible objects

**Measurement Tool Flow:**

1. User activates tool via ribbon → `emitCommand('measure_distance')`
2. `useDtxTools` listens via `onCommand` → sets `toolMode` state
3. ViewerPanel detects mode change → enables pointer event handlers
4. User clicks points → `GPUPicker` performs raycasting
5. Measurement data stored in `useToolStore.measurements` array
6. MeasurementPanel displays list with formatted units via `formatVec3Meters`
7. Three.js Line2 overlays rendered on top of DTX layer

**State Management:**
- Global singleton pattern using Vue `ref`/`shallowRef` at module scope
- Composables return accessors to shared state (e.g., `useViewerContext()`)
- Cross-cutting state: viewer instance, selection, tools, review tasks, user authentication

## Key Abstractions

**DTXLayer:**
- Purpose: GPU-accelerated rendering of massive 3D scenes via data textures
- Examples: `src/utils/three/dtx/DTXLayer.ts`
- Pattern: Batches all geometries and instances into single draw call, inspired by xeokit architecture

**TreeNode:**
- Purpose: Represents hierarchical PDMS model structure
- Examples: `src/composables/useModelTree.ts`
- Pattern: Flat dictionary indexed by refno ID with parent/children relationships

**Composable Store:**
- Purpose: Global reactive state management without Pinia/Vuex
- Examples: `src/composables/useSelectionStore.ts`, `src/composables/useToolStore.ts`
- Pattern: Module-scoped `ref` variables with exported accessor functions

**ViewerContext:**
- Purpose: Central registry for 3D viewer and tool instances
- Examples: `src/composables/useViewerContext.ts`
- Pattern: Singleton object with `ShallowRef` pointers to viewer, tools, stores

**RefnoKey:**
- Purpose: Normalized identifier for PDMS database objects (format: `dbno_refno`)
- Examples: Used throughout tree, selection, and DTX loading logic
- Pattern: String key like `17496_171640`, normalized from various backend formats

## Entry Points

**Main Application:**
- Location: `src/main.ts`
- Triggers: Browser loads index.html
- Responsibilities: Initialize Vue app, register global components, mount Vuetify, register dock panels

**Root Component:**
- Location: `src/App.vue`
- Triggers: Vue app mount
- Responsibilities: Render RibbonBar and DockLayout, handle top-level layout structure

**Dock Layout Manager:**
- Location: `src/components/DockLayout.vue`
- Triggers: Mounted by App.vue
- Responsibilities: Initialize dockview-vue API, restore saved layout, manage panel lifecycle, handle embed mode

**Viewer Panel:**
- Location: `src/components/dock_panels/ViewerPanel.vue`
- Triggers: Loaded by dock layout as default panel
- Responsibilities: Create DtxViewer instance, initialize DTXLayer, handle 3D rendering loop, manage tools

**Command Bus:**
- Location: `src/ribbon/commandBus.ts`
- Triggers: User clicks ribbon buttons or menu items
- Responsibilities: Event-driven pub/sub for cross-component commands (open panel, activate tool, etc.)

## Error Handling

**Strategy:** Defensive try-catch with console logging and user-facing toast notifications

**Patterns:**
- API calls wrapped in try-catch with error response objects containing `success` boolean and `error_message` field
- Console store (`useConsoleStore`) collects error logs for debugging panel
- Toast bus (`emitToast`) displays transient error messages to user
- SurrealDB connection failures logged with status ref (`status: 'error'`)
- GPU picking failures silently ignored (no selection change)

## Cross-Cutting Concerns

**Logging:**
- Console store system (`useConsoleStore`) with colored output categories (info, warn, error)
- Debug panel displays real-time log stream
- Production console.log/warn/error for developer tools

**Validation:**
- Refno format validation via regex patterns (`isPdmsRefnoKey`)
- API response validation via TypeScript types and `success` flags
- Unit conversion validation in `formatVec3Meters` with configurable display units

**Authentication:**
- User store (`useUserStore`) manages JWT tokens and user profile
- Embed mode supports URL-based user_token/user_id parameters
- Review workflow role-based access (designer, reviewer, resubmission)

---

*Architecture analysis: 2026-01-30*
