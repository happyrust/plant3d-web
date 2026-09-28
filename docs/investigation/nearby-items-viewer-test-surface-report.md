# Test Surface Investigation: Nearby Items Viewer Feature

**Date:** 2026-03-11  
**Repository:** `/Volumes/DPC/work/plant-code/plant3d-web`  
**Feature:** Toolbar entry + left panel + backend spatial query integration + viewer highlighting

---

## 1. Available Test Commands

### Unit Tests (Vitest)
```bash
# Run all unit tests
npm run test

# Watch mode (interactive)
npm run test:watch

# With coverage
npm run test:coverage
```

**Configuration:** `vitest.config.ts`
- **Environment:** `happy-dom` (lightweight DOM simulation)
- **Pattern:** `src/**/*.{test,spec}.{js,ts}`
- **Coverage:** Configured for `src/utils/three/annotation/**/*.ts` (can be expanded)

### E2E Tests (Playwright)
```bash
# Run all e2e tests
npm run test:e2e

# Interactive UI mode
npm run test:e2e:ui

# Headed mode (show browser)
npm run test:e2e:headed
```

**Configuration:** `playwright.config.ts`
- **Test directory:** `./e2e`
- **Base URL:** `http://127.0.0.1:3101`
- **Browser:** Chrome
- **Timeout:** 60s per test, 15s per assertion
- **Web server:** Auto-starts with `npm run dev -- --host 127.0.0.1 --port 3101`

### Development Server
```bash
# Standard dev server
npm run dev

# Demo URLs for testing
npm run demo:mbd-pipe-annotation
npm run demo:rebarviz-beam
```

---

## 2. Existing Test Patterns

### 2.1 Unit Test Patterns

#### Pattern 1: Panel Component Tests with Store Mocking
**Example:** `src/components/tools/MeasurementPanel.test.ts`

**Key Features:**
- Mocks `localStorage` for state persistence
- Uses `vi.doMock()` to mock composables like `useViewerContext()`
- Tests component lifecycle: mount → interact → verify state → unmount
- Validates bi-directional data binding (UI ↔ store)

**Code Pattern:**
```typescript
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick, ref, shallowRef } from 'vue';

describe('MeasurementPanel', () => {
  beforeEach(() => {
    // Mock localStorage
    const storage = new Map<string, string>();
    (globalThis as any).localStorage = { /* ... */ };
    localStorage.clear();
    vi.resetModules();
  });

  it('should handle list selection and external sync', async () => {
    // Mock useViewerContext
    vi.doMock('@/composables/useViewerContext', () => ({
      useViewerContext: () => ({ /* ... */ }),
    }));

    // Import component and store
    const [{ default: Panel }, { useToolStore }] = await Promise.all([
      import('./MeasurementPanel.vue'),
      import('@/composables/useToolStore'),
    ]);

    // Setup test data
    const store = useToolStore();
    store.addMeasurement({ /* ... */ });

    // Mount component
    const app = createApp(Panel, { tools: { /* ... */ } });
    app.mount(host);
    await nextTick();

    // Interact with UI
    const row = host.querySelector('[data-testid="measurement-row-m1"]');
    row?.click();
    await nextTick();

    // Verify state changes
    expect(store.activeMeasurementId.value).toBe('m1');
  });
});
```

**Relevance to Nearby Items:**
- Panel creation/mounting pattern
- Store integration testing
- Interaction simulation (clicks, selection)

---

#### Pattern 2: Composable Tests with State Persistence
**Example:** `src/composables/useToolStore.dimensions.test.ts`

**Key Features:**
- Tests state migration between versions
- Validates localStorage persistence
- Tests CRUD operations on reactive state

**Code Pattern:**
```typescript
describe('useToolStore - dimensions', () => {
  beforeEach(() => {
    // Setup localStorage mock
    vi.resetModules();
  });

  it('should add a dimension record and persist', async () => {
    const mod = await import('./useToolStore');
    const store = mod.useToolStore();

    store.addDimension({ id: 'd1', /* ... */ });
    await nextTick();

    const raw = localStorage.getItem('plant3d-web-tools-v4');
    const parsed = JSON.parse(raw);
    expect(parsed?.dimensions.length).toBe(1);
  });
});
```

**Relevance to Nearby Items:**
- Store testing pattern for nearby items state
- Persistence validation for search history
- CRUD operations for nearby items list

---

#### Pattern 3: Viewer Integration Tests
**Example:** `src/composables/useDbnoInstancesParquetLoader.test.ts`

**Key Features:**
- Mocks viewer context
- Tests data loading and viewer state updates
- Validates async operations

**Relevance to Nearby Items:**
- Testing backend API integration
- Viewer highlighting validation
- Async query handling

---

### 2.2 E2E Test Patterns

#### Pattern 1: Annotation Creation Flow
**Example:** `e2e/dtx-annotation-creation.spec.ts`

**Key Features:**
- Waits for DTX layer to be ready
- Resets tool store before each test
- Simulates mouse interactions (click, drag)
- Validates store state changes
- Uses `page.evaluate()` to access internal state

**Code Pattern:**
```typescript
import { expect, test, type Page } from '@playwright/test';

async function waitForDtxReady(page: Page) {
  await page.waitForFunction(
    () => {
      const v = (window as any).__xeokitViewer;
      const layer = v?.__dtxLayer;
      return layer?.getStats()?.compiled && layer.getStats().totalObjects > 0;
    },
    { timeout: 60_000 }
  );
}

async function resetToolStore(page: Page) {
  await page.evaluate(async () => {
    const storeMod = await import('/src/composables/useToolStore.ts');
    const store = storeMod.useToolStore();
    store.clearAll();
  });
}

test.describe('DTX Annotation Creation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?dtx_demo=primitives&dtx_demo_count=50');
    await waitForDtxReady(page);
    await resetToolStore(page);
  });

  test('should create annotation on mesh click', async ({ page }) => {
    const point = await findPickablePoint(page);
    
    await setToolMode(page, 'annotation');
    await page.mouse.click(point.x, point.y);

    await expect
      .poll(() => readAnnotationState(page), { timeout: 10_000 })
      .toMatchObject({ textCount: 1 });
  });
});
```

**Relevance to Nearby Items:**
- Opening panel from toolbar
- Selecting an object in viewer
- Triggering nearby search
- Validating result list in panel

---

#### Pattern 2: Selection and Highlighting
**Example:** `e2e/dtx-selection-highlight.spec.ts`

**Key Features:**
- Validates viewer state after selection
- Captures screenshots for visual verification
- Polls for async state changes

**Code Pattern:**
```typescript
test('should highlight selected object', async ({ page }, testInfo) => {
  await page.evaluate(() => {
    const viewer = (window as any).__xeokitViewer;
    viewer.scene.setObjectsSelected(['demo:0'], true);
  });

  const state = await expect
    .poll(() => page.evaluate(() => {
      const scene = (window as any).__xeokitViewer?.__dtxViewer?.scene;
      const overlayGroup = scene.getObjectByName('DTXSelectionOverlay');
      return { overlayNames: overlayGroup?.children.map(c => c.name) };
    }), { timeout: 10_000 })
    .toEqual({ overlayNames: ['sel_fill_demo:0'] });

  const screenshot = await page.screenshot({
    path: testInfo.outputPath('selection.png'),
  });
});
```

**Relevance to Nearby Items:**
- Highlighting nearby items in viewer
- Visual verification of results
- Testing selection synchronization

---

#### Pattern 3: Visibility Control
**Example:** `e2e/dtx-visibility.spec.ts`

**Key Features:**
- Tests object show/hide operations
- Validates GPU buffer consistency
- Tests batch operations

**Relevance to Nearby Items:**
- Hide/show nearby items
- Isolate mode (show only nearby items)
- Batch visibility operations

---

## 3. Recommended Test Strategy for Nearby Items Feature

### 3.1 Unit Tests (Vitest)

#### Test File 1: `src/composables/useNearbyItemsStore.test.ts`
**Purpose:** Store logic and state management

**Test Cases:**
1. ✅ Should initialize with empty state
2. ✅ Should update search radius setting
3. ✅ Should store search results
4. ✅ Should handle search mode switch (refno/position)
5. ✅ Should clear results
6. ✅ Should persist search history to localStorage (optional)
7. ✅ Should handle loading and error states

**Pattern:** Similar to `useToolStore.dimensions.test.ts`

---

#### Test File 2: `src/components/tools/NearbyItemsPanel.test.ts`
**Purpose:** Panel UI interactions

**Test Cases:**
1. ✅ Should render search controls
2. ✅ Should update radius input
3. ✅ Should switch between search modes
4. ✅ Should trigger search on button click
5. ✅ Should display results list
6. ✅ Should select item on row click
7. ✅ Should show loading state during search
8. ✅ Should display error message on failure

**Pattern:** Similar to `MeasurementPanel.test.ts`

---

#### Test File 3: `src/api/genModelSpatialApi.test.ts`
**Purpose:** Backend API integration

**Test Cases:**
1. ✅ Should build correct query parameters
2. ✅ Should parse response correctly
3. ✅ Should handle truncated results
4. ✅ Should handle API errors
5. ✅ Should support refno mode
6. ✅ Should support bbox mode
7. ✅ Should support sphere/cube shape toggle

**Pattern:** Mock `fetch()` with `vi.fn()`

---

### 3.2 E2E Tests (Playwright)

#### Test File 1: `e2e/nearby-items-panel-open.spec.ts`
**Purpose:** Panel lifecycle

**Test Cases:**
1. ✅ Should open panel from toolbar button
2. ✅ Should close panel via close button
3. ✅ Should persist panel state across page reload (if zone state saved)
4. ✅ Should expand left zone when opening panel

**Complexity:** Low  
**Estimated Time:** 10 min to write, 20s to run

---

#### Test File 2: `e2e/nearby-items-search-by-selection.spec.ts`
**Purpose:** Search by selected object

**Test Cases:**
1. ✅ Should enable search when object selected
2. ✅ Should display nearby items list
3. ✅ Should show distance for each item
4. ✅ Should update results when radius changes
5. ✅ Should clear results when selection cleared

**Complexity:** Medium  
**Estimated Time:** 30 min to write, 30s to run

---

#### Test File 3: `e2e/nearby-items-highlighting.spec.ts`
**Purpose:** Viewer integration

**Test Cases:**
1. ✅ Should highlight item when clicked in list
2. ✅ Should sync selection between panel and viewer
3. ✅ Should toggle item visibility from panel
4. ✅ Should support isolate mode (show only nearby items)

**Complexity:** Medium  
**Estimated Time:** 30 min to write, 40s to run

---

#### Test File 4: `e2e/nearby-items-shape-mode.spec.ts`
**Purpose:** Search shape (cube vs sphere)

**Test Cases:**
1. ✅ Should return different results for cube vs sphere
2. ✅ Should persist shape preference
3. ✅ Should display shape indicator in UI

**Complexity:** Low  
**Estimated Time:** 15 min to write, 20s to run

---

### 3.3 Component/Integration Tests (Optional)

#### Test File: `src/components/tools/NearbyItemsPanel.integration.test.ts`
**Purpose:** Full panel lifecycle with real viewer

**Test Cases:**
1. ✅ Should load nearby items from backend
2. ✅ Should update viewer highlighting
3. ✅ Should handle concurrent searches
4. ✅ Should debounce radius changes

**Complexity:** High  
**Pattern:** Similar to `useDbnoInstancesParquetLoader.test.ts`

---

## 4. Manual Verification Path

### 4.1 Application Entry Point

**URL:** `http://localhost:5173/` (or the configured dev server port)

**Demo URL with DTX primitives:**
```
http://localhost:5173/?dtx_demo=primitives&dtx_demo_count=100
```

**Demo URL with real model (if available):**
```
http://localhost:5173/?project_id=<your-project-id>
```

---

### 4.2 Manual Test Flow

#### Step 1: Open Nearby Items Panel
1. ✅ Start dev server: `npm run dev`
2. ✅ Open browser to `http://localhost:5173/`
3. ✅ Click "视图" tab in ribbon toolbar
4. ✅ Click "附近构件" button (once implemented)
5. ✅ **Verify:** Panel opens in left zone

#### Step 2: Search by Selected Object
1. ✅ Click on an object in 3D viewer
2. ✅ **Verify:** Object is highlighted
3. ✅ In nearby items panel, set mode to "按对象"
4. ✅ Set search radius to `10` meters
5. ✅ Click "搜索" button
6. ✅ **Verify:** Results list populates with nearby objects
7. ✅ **Verify:** Each result shows name, refno, and distance

#### Step 3: Interact with Results
1. ✅ Click on a result item in the list
2. ✅ **Verify:** Object is selected in viewer
3. ✅ **Verify:** Viewer flies to selected object (optional)
4. ✅ **Verify:** Properties panel updates (if open)

#### Step 4: Test Search Shape Toggle
1. ✅ Toggle between "cube" and "sphere" modes
2. ✅ Re-run search
3. ✅ **Verify:** Result count changes (sphere typically returns fewer items)

#### Step 5: Test Radius Changes
1. ✅ Change radius to `5` meters
2. ✅ Re-run search
3. ✅ **Verify:** Fewer results returned
4. ✅ Change radius to `20` meters
5. ✅ **Verify:** More results returned

#### Step 6: Test Search by Position (Optional)
1. ✅ Set mode to "按位置"
2. ✅ Enter coordinates manually (e.g., `0,0,0`)
3. ✅ Click "搜索"
4. ✅ **Verify:** Results based on position, not selection

---

### 4.3 Manual Verification Checklist

#### UI Components
- [ ] Toolbar button renders correctly
- [ ] Panel opens in left zone
- [ ] Search mode toggle works
- [ ] Radius input accepts numbers
- [ ] Search button is clickable
- [ ] Results list scrolls properly
- [ ] Loading spinner shows during search
- [ ] Error message displays on failure

#### Viewer Integration
- [ ] Selected object is passed to search
- [ ] Clicking result selects object in viewer
- [ ] Highlighting updates correctly
- [ ] Camera flies to object (optional)
- [ ] Multiple selections work

#### Backend Integration
- [ ] API request includes correct parameters
- [ ] Response is parsed correctly
- [ ] Truncated results are indicated
- [ ] Network errors are handled
- [ ] Empty results are handled

#### Edge Cases
- [ ] No object selected (search disabled?)
- [ ] Very large radius (truncated results)
- [ ] No results found
- [ ] Rapid searches (debouncing?)
- [ ] Panel closed while loading

---

## 5. Testing Environment Status

### ✅ Fully Functional

#### Unit Testing (Vitest)
- **Status:** ✅ Working
- **Evidence:** Tests run successfully with `npm run test`
- **Environment:** `happy-dom` provides DOM simulation
- **Mock Support:** `localStorage`, `fetch`, composables via `vi.doMock()`

#### E2E Testing (Playwright)
- **Status:** ✅ Working
- **Evidence:** 34 tests across 14 files
- **Browser:** Chrome (configurable)
- **Auto-starts dev server:** Yes
- **Screenshot support:** Yes

#### Development Server
- **Status:** ✅ Working
- **Command:** `npm run dev`
- **Hot reload:** Yes
- **Demo URLs:** Multiple available

---

### ⚠️ Partial or Unknown

#### Backend Spatial API
- **Status:** ⚠️ Depends on environment
- **File:** `src/api/genModelSpatialApi.ts`
- **Endpoint:** `/api/sqlite-spatial/query`
- **Note:** Requires backend server with spatial index
- **Validation:** Check `querySpatialStats()` before testing

**Validation Command (manual):**
```bash
# In browser console or API client
fetch('http://your-backend/api/sqlite-spatial/stats')
  .then(r => r.json())
  .then(console.log)
```

**Expected Response:**
```json
{
  "success": true,
  "total_elements": 12345,
  "index_type": "rtree",
  "index_path": "/path/to/spatial.db"
}
```

---

### 🔴 Blockers/Gaps

#### 1. Backend Spatial Index Availability
- **Risk:** High
- **Impact:** Cannot test real spatial queries
- **Mitigation:** Mock API responses in tests
- **Resolution:** Verify with backend team

#### 2. Test Data for Nearby Items
- **Risk:** Medium
- **Impact:** Cannot validate real-world scenarios
- **Mitigation:** Use `?dtx_demo=primitives` for basic testing
- **Resolution:** Load production-like test model

#### 3. Viewer State Initialization in Tests
- **Risk:** Low
- **Impact:** E2E tests may need longer wait times
- **Current Solution:** `waitForDtxReady()` helper already exists

---

## 6. Test Execution Plan

### Phase 1: Unit Tests (Week 1)
1. Create `useNearbyItemsStore.test.ts`
2. Create `NearbyItemsPanel.test.ts`
3. Create `genModelSpatialApi.test.ts`
4. Run: `npm run test:coverage`
5. **Target:** >80% coverage for new code

### Phase 2: E2E Tests (Week 2)
1. Create `nearby-items-panel-open.spec.ts`
2. Create `nearby-items-search-by-selection.spec.ts`
3. Create `nearby-items-highlighting.spec.ts`
4. Create `nearby-items-shape-mode.spec.ts`
5. Run: `npm run test:e2e`
6. **Target:** All critical user flows covered

### Phase 3: Manual Verification (Week 2)
1. Follow manual test flow (see 4.2)
2. Test with production data (if available)
3. Record bugs/edge cases
4. Update test cases based on findings

### Phase 4: CI Integration (Week 3)
1. Ensure tests run in CI environment
2. Configure screenshots/artifacts upload
3. Set up test failure notifications
4. **Target:** All tests pass in CI

---

## 7. Test Data Requirements

### Minimal Test Data
- **For Unit Tests:** Mock objects in test files
- **For E2E Tests:** `?dtx_demo=primitives&dtx_demo_count=100`

### Realistic Test Data (Optional)
- **Model with spatial index:** Real project with >1000 objects
- **Known nearby relationships:** Documented test cases (e.g., "Pipe A is 2.5m from Wall B")
- **Edge cases:** Objects at boundary, very dense areas, isolated objects

---

## 8. Test Coverage Goals

| Component | Unit Tests | E2E Tests | Manual |
|-----------|-----------|-----------|--------|
| Toolbar button | ✅ (command bus) | ✅ (panel open) | ✅ |
| Panel UI | ✅ (rendering) | ✅ (interaction) | ✅ |
| Search modes | ✅ (state) | ✅ (flow) | ✅ |
| Backend API | ✅ (mocked) | ✅ (real) | ✅ |
| Viewer highlighting | ⚠️ (complex) | ✅ (real) | ✅ |
| Error handling | ✅ (all cases) | ✅ (network) | ✅ |

**Legend:**
- ✅ Recommended
- ⚠️ Optional/complex
- ❌ Not needed

---

## 9. Known Testing Challenges

### Challenge 1: Viewer State Initialization
**Problem:** 3D viewer takes time to load in E2E tests  
**Solution:** Use `waitForDtxReady()` helper (already exists)

### Challenge 2: Async Search Results
**Problem:** Results may take 100ms-2s to load  
**Solution:** Use `expect.poll()` with 10s timeout (see existing tests)

### Challenge 3: Spatial Query Determinism
**Problem:** Results depend on backend data  
**Solution:** Use fixed demo models for E2E tests

### Challenge 4: Panel Positioning
**Problem:** Dockview layout may vary  
**Solution:** Use panel ID selectors, not visual position

---

## 10. Summary and Recommendations

### ✅ Strengths
1. Comprehensive E2E test infrastructure (Playwright)
2. Well-established unit test patterns (Vitest)
3. Existing test examples for similar features
4. Auto-starting dev server for E2E tests
5. Screenshot capture for visual verification

### ⚠️ Gaps
1. Backend spatial API availability uncertain
2. Need realistic test data for nearby queries
3. Viewer state mocking in unit tests is complex

### 🎯 Recommended Approach

#### Minimal Viable Test Suite
1. **Unit Tests:** 3 files, ~15 test cases, 2-3 hours to write
2. **E2E Tests:** 2 files (panel open + search flow), ~8 test cases, 2-3 hours to write
3. **Manual Testing:** Follow checklist, 30 minutes

**Total Effort:** ~6 hours for basic coverage

#### Complete Test Suite
1. **Unit Tests:** 4 files, ~25 test cases, 4-5 hours
2. **E2E Tests:** 4 files, ~15 test cases, 5-6 hours
3. **Integration Tests:** 1 file, ~5 test cases, 2-3 hours
4. **Manual Testing:** Full checklist + edge cases, 1-2 hours

**Total Effort:** ~15 hours for comprehensive coverage

---

## Appendix A: Quick Start Commands

```bash
# Clone and setup (if needed)
cd /Volumes/DPC/work/plant-code/plant3d-web
npm install

# Run unit tests
npm run test

# Run unit tests in watch mode
npm run test:watch

# Run E2E tests
npm run test:e2e

# Run E2E tests with UI (interactive)
npm run test:e2e:ui

# Start dev server for manual testing
npm run dev

# Start dev server with demo data
npm run dev
# Then open: http://localhost:5173/?dtx_demo=primitives&dtx_demo_count=100

# Type checking
npm run type-check

# Linting
npm run lint
```

---

## Appendix B: Relevant Existing Tests

### Unit Tests
1. `src/components/tools/MeasurementPanel.test.ts` - Panel UI pattern
2. `src/composables/useToolStore.dimensions.test.ts` - Store pattern
3. `src/composables/useDbnoInstancesParquetLoader.test.ts` - Async loading

### E2E Tests
1. `e2e/dtx-annotation-creation.spec.ts` - Tool interaction pattern
2. `e2e/dtx-selection-highlight.spec.ts` - Viewer state validation
3. `e2e/dtx-visibility.spec.ts` - Object visibility testing

---

**End of Report**
