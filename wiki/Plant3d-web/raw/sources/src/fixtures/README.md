# BRAN Test Fixtures

This directory contains JSON fixtures for testing MBD (Model-Based Definition) pipe annotations with controlled mock data.

## Files

### `bran-test-data.json`
Comprehensive BRAN test fixture with representative annotation data including:
- 5 pipe segments (including one short 150mm segment to test crowded layout)
- 13 dimensions of all types (segment, chain, overall, port)
- 4 welds (Butt and Fillet, both shop and field)
- 2 slopes
- 1 bend
- 2 cut tubis (split segment validation)
- 3 fittings (elbow, tee, flange)
- 3 tags with different roles

### `bran-test-data.test.ts`
Unit test suite that validates:
- JSON structure matches `MbdPipeData` type
- All dimension kinds are present
- Annotations render correctly in construction and inspection modes
- Welds, slopes, bends, cut tubis, and tags render with correct styling
- Short segments handle crowded annotation layout
- All 3D coordinates are valid

## Usage

### Running Unit Tests
```bash
npm test -- src/fixtures/bran-test-data.test.ts
```

### Using in Demo Mode
Load the fixture via URL parameter:
```
http://localhost:5173/?dtx_demo=mbd_pipe&mbd_pipe_case=bran_fixture
```

Quick verification path for the tuned RebarViz MBD defaults:
```
http://localhost:5173/?dtx_demo=mbd_pipe&mbd_pipe_case=bran_fixture&mbd_dim_mode=rebarviz
```

Or use shorthand:
```
http://localhost:5173/?dtx_demo=mbd_pipe&mbd_pipe_case=fixture
http://localhost:5173/?dtx_demo=mbd_pipe&mbd_pipe_case=test
```

### Using in E2E Tests
The fixture is wired into Playwright e2e tests in `/e2e/mbd-bran-fixture.spec.ts`:
```bash
npx playwright test mbd-bran-fixture
```

### Importing in Code
```typescript
import branTestData from '@/fixtures/bran-test-data.json';
import type { MbdPipeData } from '@/api/mbdPipeApi';

const data = branTestData as MbdPipeData;
// Use with useMbdPipeAnnotationThree.renderBranch(data)
```

## Test Coverage

The fixture provides deterministic test data for validating:
1. **Dimension Rendering**: All four dimension kinds (segment, chain, overall, port) with correct styling
2. **Weld Annotations**: Both shop and field welds with proper visualization
3. **Slope Annotations**: Gradient indicators with percentage text
4. **Bend Annotations**: Angular dimensions at bend points
5. **Cut Tubis**: Split segment dimensions for construction accuracy
6. **Fitting Tags**: Labels for elbows, tees, and flanges with role-based styling
7. **Crowded Layout**: Short 150mm segment tests arrow flipping and text positioning

## Benefits

- **Reproducible Testing**: Controlled mock data ensures consistent test results
- **No Backend Dependency**: Tests run without requiring database or API server
- **Fast Iteration**: Instant feedback on annotation styling changes
- **Visual Verification**: E2E tests capture screenshots for regression checking
- **Documentation**: Serves as reference example of complete MBD data structure
