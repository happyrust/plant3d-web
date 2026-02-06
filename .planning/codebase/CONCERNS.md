# Codebase Concerns

**Analysis Date:** 2026-01-30

## Tech Debt

**TypeScript Type Safety Bypasses:**
- Issue: Multiple files use `@ts-nocheck` to disable type checking entirely
- Files: `src/composables/useDuckDBModelLoader.ts`, `src/components/task/TaskStatusCard.vue`, `src/components/task/TaskMonitorPanel.vue`, `src/components/review/InitiateReviewPanel.vue`, `src/components/task/ModelExportPanel.vue`, `src/components/task/TaskCreationWizard.vue`, `src/components/tools/AnnotationPanel.vue`, `src/components/dock_panels/ViewerPanel.vue`
- Impact: Loss of type safety, increased risk of runtime errors, harder to refactor
- Fix approach: Incrementally remove `@ts-nocheck`, add proper type annotations, fix type errors one file at a time

**Excessive Console Usage:**
- Issue: 221 console.log/warn/error/debug statements throughout codebase
- Files: Widespread across 43 files including `src/components/model-tree/ModelTreePanel.vue` (14 instances), `src/utils/three/dtx/DTXLayer.ts` (28 instances), `src/composables/usePdmsOwnerTree.ts` (13 instances), `src/components/dock_panels/ViewerPanel.vue` (13 instances)
- Impact: Pollutes console in production, potential performance overhead, makes debugging harder
- Fix approach: Replace with proper logging framework, add environment-based log levels, remove debug statements in production builds

**Type 'any' Usage:**
- Issue: 298 occurrences of `any` or `unknown` types across 39 files
- Files: `src/composables/useDtxTools.ts` (43 instances), `src/utils/instances/instanceManifest.ts` (28 instances), `src/composables/useModelGeneration.ts` (36 instances), `src/api/reviewApi.ts` (22 instances), `src/composables/useSurrealModelQuery.ts` (22 instances)
- Impact: Weakens type safety, makes refactoring risky
- Fix approach: Audit each usage, create proper interfaces/types for external API responses, use generic constraints

**DEBUG Flags in Production Code:**
- Issue: Hardcoded debug flags and conditional debugging logic
- Files: `src/composables/usePdmsOwnerTree.ts` (lines 613-622), `src/components/model-tree/ModelTreePanel.vue` (line 57: `DEBUG_SKIP_EYE_AUTO_GENERATE`), `src/utils/three/dtx/selection/GPUPicker.ts` (line 144: localStorage-based debug flag)
- Impact: Dead code branches, confusion about intended behavior, maintenance burden
- Fix approach: Extract to environment configuration, remove hardcoded flags, use proper feature flags system

**Incomplete TODO Items:**
- Issue: Critical functionality marked as TODO but not implemented
- Files:
  - `src/utils/three/dtx/DTXLayer.ts:1532` - "TODO: 实现局部更新" (partial texture updates not implemented)
  - `src/components/tools/PropertiesPanel.vue:218` - "TODO: 调用 API 保存" (property save API not called)
  - `src/components/review/ReviewPanel.vue:339,357` - "TODO: 添加 toast 提示" (missing user feedback)
- Impact: Features are incomplete, user experience degraded
- Fix approach: Prioritize and implement or remove TODO markers

**Large File Complexity:**
- Issue: Several files exceed 1000-2700 lines indicating high complexity
- Files:
  - `src/composables/useDtxTools.ts` (2706 lines)
  - `src/utils/three/dtx/DTXLayer.ts` (2138 lines)
  - `src/components/dock_panels/ViewerPanel.vue` (1631 lines)
  - `src/components/model-tree/ModelTreePanel.vue` (1360 lines)
  - `src/api/reviewApi.ts` (1151 lines)
  - `src/components/tools/AnnotationPanel.vue` (1006 lines)
- Impact: Hard to understand, test, and maintain; increased cognitive load
- Fix approach: Split into smaller modules/composables, extract shared logic, separate concerns (e.g., API layer from business logic)

**Refno Format Inconsistency:**
- Issue: Codebase uses underscore format (`24383_84631`) per CLAUDE.md convention, but old code may use pipe (`|`)
- Files: Widespread across 43 files with 728 occurrences of "refno"
- Impact: Data inconsistency, potential parsing errors when mixing formats
- Fix approach: Audit all refno usage, ensure consistent normalization at API boundaries, add validation

## Known Bugs

**Error Handling Gaps:**
- Symptoms: Errors thrown without proper user feedback or recovery
- Files: Multiple API files throw generic errors (`src/api/reviewApi.ts`, `src/composables/useDbMetaInfo.ts`, `src/composables/useDbnoInstancesJsonLoader.ts`)
- Trigger: Network failures, invalid data responses, missing configuration
- Workaround: None - errors propagate to console only
- Fix approach: Wrap critical operations in try-catch, emit toast notifications, provide fallback UI states

**GPU Picking Debug Warnings:**
- Symptoms: Console warnings about missing textures or uncompiled shaders during GPU picking diagnostics
- Files: `src/utils/three/dtx/DTXLayer.ts` (lines 1664, 1668, 1675)
- Trigger: Attempting GPU diagnostics before DTX layer compilation
- Workaround: Warnings are informational only
- Fix approach: Add compilation state checks before diagnostics, suppress warnings in production

**InstancesJsonNotFoundError:**
- Symptoms: Custom error class for missing instance JSON files
- Files: `src/composables/useDbnoInstancesJsonLoader.ts` (lines 5-12)
- Trigger: When `instances_{dbno}.json` file doesn't exist on server
- Workaround: Trigger generation task via API
- Fix approach: Already has error type; ensure proper handling in UI with retry mechanism

## Security Considerations

**Hardcoded Credentials in Example:**
- Risk: Example environment file contains default credentials
- Files: `.env.example` (SurrealDB credentials: root/root)
- Current mitigation: File is `.example` only, not committed as `.env`
- Recommendations: Add stronger warnings in documentation, validate that production deployments never use default credentials

**JWT Token in localStorage:**
- Risk: XSS attacks could steal authentication tokens
- Files: `src/api/reviewApi.ts` (lines 33-54)
- Current mitigation: None - standard localStorage usage
- Recommendations: Consider httpOnly cookies for token storage, implement token refresh, add CSRF protection

**No Input Validation:**
- Risk: User input not validated before API calls
- Files: Multiple API files lack input validation
- Current mitigation: Backend validation assumed
- Recommendations: Add client-side validation, sanitize inputs, validate refno formats

## Performance Bottlenecks

**Visible Instance Queries:**
- Problem: Fetching all visible child instances for large hierarchies is slow
- Files: `src/composables/usePdmsOwnerTree.ts` (lines 650-675)
- Cause: Backend API call to get all visible refnos, then batch visibility updates
- Improvement path: Add DEBUG timing logs (already present but disabled), implement pagination or streaming, cache visibility states

**Tree State Recomputation:**
- Problem: Parent node recalculation can traverse large child sets
- Files: `src/composables/usePdmsOwnerTree.ts` (lines 640-647, comment mentions blocking when child count is large)
- Cause: Synchronous traversal of tree hierarchy
- Improvement path: Use web workers for tree calculations, debounce updates, implement incremental recomputation

**DTX Texture Updates:**
- Problem: Full texture update instead of partial updates
- Files: `src/utils/three/dtx/DTXLayer.ts:1532` (marked TODO)
- Cause: Simplified implementation updates entire texture even for single object changes
- Improvement path: Implement partial texture region updates, batch updates in single frame

**Console Logging Overhead:**
- Problem: Extensive console output in hot paths (performance timing, debug messages)
- Files: `src/composables/usePdmsOwnerTree.ts` (performance.now() timing), `src/utils/three/dtx/DTXLayer.ts` (GPU diagnostics)
- Cause: Debug code left in production paths
- Improvement path: Disable console logs in production builds, use conditional compilation, add performance monitoring API

## Fragile Areas

**Model Tree Eye Toggle:**
- Files: `src/components/model-tree/ModelTreePanel.vue` (lines 54-57, 153, 923), `src/composables/usePdmsOwnerTree.ts` (setVisible function)
- Why fragile: Complex interaction between tree state, API calls, and 3D scene visibility; has debug skip flags indicating past freezing issues
- Safe modification: Use DEBUG flags to isolate changes, test with large hierarchies, monitor performance timing logs
- Test coverage: None detected - manual testing only

**DTX Layer Compilation:**
- Files: `src/utils/three/dtx/DTXLayer.ts`
- Why fragile: Complex GPU texture packing, shader compilation, and object indexing; warnings indicate timing-dependent issues
- Safe modification: Always check compilation state before operations, test with various geometry sizes, validate texture dimensions
- Test coverage: None detected - relies on GPU diagnostics function

**Shared Instance Tables Loading:**
- Files: `src/composables/useDbnoInstancesJsonLoader.ts` (lines 43-77)
- Why fragile: Race conditions possible with concurrent loads, IndexedDB corruption handling, network failure recovery
- Safe modification: Never bypass preloadInstancesSharedTables(), ensure promise chaining, validate data structure before use
- Test coverage: No tests for corrupted cache scenarios

**Refno Resolution:**
- Files: `src/composables/useDbMetaInfo.ts`, widespread usage across 43 files
- Why fragile: Central to entire application, breaks if db_meta_info.json structure changes, strict validation throws errors
- Safe modification: Always normalize refnos, handle missing metadata gracefully, test with various refno formats
- Test coverage: None detected

## Scaling Limits

**DTX Geometry Limits:**
- Current capacity: Optimized from 269 InstancedMesh2 to single DTXLayer
- Limit: Unknown maximum object/primitive count before texture size limits hit
- Scaling path: Document texture size limits (likely 8192x8192), implement multiple DTXLayers for huge scenes, add memory monitoring

**Tree Virtualization:**
- Current capacity: Uses @tanstack/vue-virtual for rendering, but no documented limits
- Limit: Performance degradation observed with large child sets (per comments)
- Scaling path: Already virtualized; add lazy loading of tree branches, implement pagination, cache expanded states

**WebSocket Connection:**
- Current capacity: Single SurrealDB WebSocket connection
- Limit: Concurrent user limit unknown
- Scaling path: Document connection limits, implement connection pooling, add reconnection logic

## Dependencies at Risk

**Three.js Version Lock:**
- Risk: Locked to ^0.162.0 (not latest)
- Impact: Missing performance improvements, security patches
- Migration plan: Test with newer versions, update custom shaders/materials, validate DTX layer compatibility

**DuckDB WASM:**
- Risk: Early adoption of WASM-based query engine (^1.30.0)
- Impact: Potential bugs in WASM runtime, browser compatibility issues
- Migration plan: Monitor for breaking changes, have fallback to server-side queries, test memory limits

**SurrealDB Client:**
- Risk: Relatively new database (^1.3.2), SDK stability unknown
- Impact: Breaking API changes, connection reliability issues
- Migration plan: Abstract database access behind interface, evaluate PostgreSQL fallback

## Missing Critical Features

**Test Infrastructure:**
- Problem: Zero unit/integration tests detected in src/
- Blocks: Confident refactoring, regression prevention, documentation of expected behavior
- Priority: High - add vitest/jest setup, start with critical paths (refno normalization, DTX compilation)

**Error Boundaries:**
- Problem: No Vue error boundaries for graceful failure handling
- Blocks: Production stability, user-friendly error messages
- Priority: Medium - wrap major components in error boundaries, add error reporting service

**Performance Monitoring:**
- Problem: Ad-hoc performance.now() calls but no centralized monitoring
- Blocks: Identifying production bottlenecks, capacity planning
- Priority: Medium - integrate performance API, add user timing marks, implement analytics

**API Documentation:**
- Problem: No OpenAPI/Swagger docs for backend APIs
- Blocks: Frontend-backend contract validation, onboarding new developers
- Priority: Low - generate from backend code, add to development workflow

## Test Coverage Gaps

**DTX Rendering Pipeline:**
- What's not tested: Geometry packing, texture generation, shader compilation, GPU picking
- Files: `src/utils/three/dtx/DTXLayer.ts`, `src/utils/three/dtx/selection/GPUPicker.ts`
- Risk: Regression in core rendering functionality, GPU-specific bugs go unnoticed
- Priority: High - complex, critical path with 2138 lines of untested code

**API Error Handling:**
- What's not tested: Network failures, malformed responses, timeout scenarios
- Files: All files in `src/api/` directory (reviewApi.ts, genModelTaskApi.ts, etc.)
- Risk: Production failures when APIs return unexpected data
- Priority: High - APIs are integration points with high failure probability

**Refno Normalization:**
- What's not tested: Edge cases in refno format conversion (underscore vs pipe)
- Files: `src/composables/useDbMetaInfo.ts`, utility functions throughout codebase
- Risk: Data corruption when mixing formats
- Priority: High - affects data integrity across entire application

**Tree State Management:**
- What's not tested: Visibility propagation, check state computation, parent recalculation
- Files: `src/composables/usePdmsOwnerTree.ts`, `src/composables/useRoomTree.ts`
- Risk: UI state inconsistencies, performance issues with large trees
- Priority: Medium - complex state logic with performance implications

**Vue Component Integration:**
- What's not tested: Component lifecycle, prop validation, event emissions
- Files: All Vue components (141 source files total)
- Risk: UI bugs, broken component composition
- Priority: Medium - standard Vue testing practices missing

**Measurement Tools:**
- What's not tested: Distance/angle calculations, point snapping, surface intersection
- Files: `src/composables/useDtxTools.ts` (2706 lines, 37+ refno occurrences)
- Risk: Incorrect measurements, user workflow failures
- Priority: Medium - user-facing feature with mathematical complexity

---

*Concerns audit: 2026-01-30*
