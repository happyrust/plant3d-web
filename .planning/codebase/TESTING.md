# Testing Patterns

**Analysis Date:** 2026-01-30

## Test Framework

**Runner:**
- 未检测到测试框架配置 (无 jest.config.*, vitest.config.*)
- Playwright 1.57.0 存在于 dependencies (通常用于 E2E 测试)
- 无 git 追踪的测试文件 (*.test.*, *.spec.*)

**Assertion Library:**
- 未配置

**Run Commands:**
```bash
# package.json 中未定义测试脚本
# 推荐添加:
npm run test              # 运行所有测试
npm run test:watch        # 监听模式
npm run test:coverage     # 覆盖率报告
```

## Test File Organization

**Location:**
- 当前无测试文件组织结构
- tsconfig.app.json 排除 `src/**/__tests__/*` (预期位置但未使用)
- 推荐: 测试文件与源文件并置 (co-located)

**Naming:**
- 推荐模式: `*.test.ts`, `*.spec.ts`, `*.test.vue`
- 组件测试: `ComponentName.spec.ts`
- 工具函数测试: `utilFunction.test.ts`

**Structure:**
```
src/
├── components/
│   ├── ModelTreePanel.vue
│   └── ModelTreePanel.spec.ts          # 推荐位置
├── composables/
│   ├── useModelTree.ts
│   └── useModelTree.test.ts            # 推荐位置
└── utils/
    ├── unitFormat.ts
    └── unitFormat.test.ts              # 推荐位置
```

## Test Structure

**Suite Organization:**
```typescript
// 推荐模式 (基于 Vue 3 + Vite 生态)
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import ModelTreePanel from '@/components/model-tree/ModelTreePanel.vue';

describe('ModelTreePanel', () => {
  beforeEach(() => {
    // 设置测试环境
  });

  afterEach(() => {
    // 清理
  });

  it('should render tree structure', () => {
    const wrapper = mount(ModelTreePanel, {
      props: { viewer: null }
    });
    expect(wrapper.exists()).toBe(true);
  });

  it('should toggle tree nodes', async () => {
    // 测试交互
  });
});
```

**Patterns:**
- 使用 describe 组织测试套件
- 使用 it/test 描述单个测试
- beforeEach/afterEach 管理测试生命周期
- 异步测试使用 async/await

## Mocking

**Framework:**
- 推荐: Vitest (内置 mocking，与 Vite 集成良好)
- 替代: Jest (需额外配置 TypeScript + ESM)

**Patterns:**
```typescript
// Mock API 调用
import { vi } from 'vitest';
import * as api from '@/api/genModelRoomTreeApi';

vi.mock('@/api/genModelRoomTreeApi', () => ({
  roomTreeGetRoot: vi.fn(() => Promise.resolve({
    success: true,
    node: { id: 'root', name: 'Root' }
  }))
}));

// Mock composables
vi.mock('@/composables/useModelTree', () => ({
  useModelTree: () => ({
    expandedIds: ref(new Set()),
    flatRows: ref([])
  })
}));

// Mock Three.js (大型库)
vi.mock('three', () => ({
  Scene: vi.fn(),
  WebGLRenderer: vi.fn(),
  PerspectiveCamera: vi.fn()
}));
```

**What to Mock:**
- 外部 API 调用 (`@/api/*`)
- WebSocket 连接 (`useWebSocket`)
- Three.js 场景和渲染器
- IndexedDB 操作 (`indexedDbCache`)
- DuckDB WASM (`@duckdb/duckdb-wasm`)
- 文件系统操作
- 定时器 (setTimeout, setInterval)

**What NOT to Mock:**
- 纯函数工具 (`cn()`, `formatLengthMeters()`)
- 简单类型转换 (`fromBackendRole()`, `toBackendRole()`)
- Vue 响应式 API (ref, computed, watch)
- 枚举和常量 (`UserRole`, `WORKFLOW_NODE_NAMES`)

## Fixtures and Factories

**Test Data:**
```typescript
// 推荐模式: 测试工厂函数
export function createMockTreeNode(overrides?: Partial<TreeNode>): TreeNode {
  return {
    id: 'test-node',
    name: 'Test Node',
    noun: 'ZONE',
    children: [],
    visible: true,
    checked: false,
    ...overrides
  };
}

export function createMockTask(overrides?: Partial<Task>): Task {
  return {
    id: 'task-1',
    name: 'Test Task',
    type: 'DataGeneration',
    status: 'pending',
    progress: 0,
    priority: 'normal',
    ...overrides
  };
}

// 使用示例
const node = createMockTreeNode({ name: 'Custom Node' });
const task = createMockTask({ status: 'completed', progress: 100 });
```

**Location:**
- 推荐: `src/__tests__/fixtures/` 或 `tests/fixtures/`
- 按领域组织: `fixtures/tree.ts`, `fixtures/tasks.ts`, `fixtures/auth.ts`

## Coverage

**Requirements:**
- 未配置覆盖率要求
- 推荐: 设置最低 70% 覆盖率阈值

**View Coverage:**
```bash
# 推荐配置 (Vitest)
npm run test:coverage

# 生成报告位置
coverage/
├── index.html           # HTML 报告
├── lcov.info           # LCOV 格式
└── coverage-final.json  # JSON 格式
```

**配置示例 (vitest.config.ts):**
```typescript
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 70,
        statements: 70
      }
    }
  }
});
```

## Test Types

**Unit Tests:**
- 范围: 独立函数、工具类、类型转换
- 示例文件: `src/utils/unitFormat.test.ts`, `src/lib/utils.test.ts`
- 关键目标:
  - `formatLengthMeters()` - 单位格式化
  - `cn()` - 类名合并
  - `hasRole()`, `isDesigner()` - 角色检查
  - `fromBackendRole()`, `toBackendRole()` - 类型转换
  - `getTaskStatusDisplay()` - 状态映射

**Integration Tests:**
- 范围: Composables、API 集成、状态管理
- 示例文件: `src/composables/useModelTree.test.ts`, `src/api/reviewApi.test.ts`
- 关键目标:
  - `usePdmsOwnerTree()` - 树状态管理
  - `useSelectionStore()` - 选择状态
  - `useTaskMonitor()` - 任务监控
  - API 调用链: `roomTreeGetRoot()` → `roomTreeGetChildren()`
  - WebSocket 连接和消息处理

**E2E Tests:**
- 框架: Playwright 1.57.0 (已安装)
- 范围: 用户工作流、UI 交互
- 推荐位置: `e2e/` 或 `tests/e2e/`
- 关键场景:
  - 模型树加载和展开
  - 3D 场景交互和选择
  - 任务创建和监控
  - 审核流程 (编制 → 校对 → 审核 → 批准)
  - Ribbon 工具栏操作
  - 面板停靠和布局

**配置示例 (playwright.config.ts):**
```typescript
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  use: {
    baseURL: 'http://localhost:5173',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  },
  webServer: {
    command: 'npm run dev',
    port: 5173
  }
});
```

## Common Patterns

**Async Testing:**
```typescript
// Vitest 模式
it('should load tree data asynchronously', async () => {
  const { result } = renderComposable(() => usePdmsOwnerTree(ref(null)));

  await result.loadRoot();

  expect(result.flatRows.value.length).toBeGreaterThan(0);
});

// 等待 DOM 更新
it('should update UI after state change', async () => {
  const wrapper = mount(ModelTreePanel);

  await wrapper.vm.expandNode('node-1');
  await wrapper.vm.$nextTick();

  expect(wrapper.find('[data-node-id="node-1"]').classes()).toContain('expanded');
});
```

**Error Testing:**
```typescript
// API 错误处理
it('should handle API errors gracefully', async () => {
  vi.mocked(roomTreeGetRoot).mockRejectedValue(
    new Error('HTTP 500 Internal Server Error')
  );

  const { result } = renderComposable(() => useRoomTree(ref(null)));

  await expect(result.loadRoot()).rejects.toThrow('HTTP 500');
  expect(result.error.value).toContain('Internal Server Error');
});

// 输入验证
it('should validate refno format', () => {
  expect(() => parseRefno('invalid')).toThrow('Invalid refno format');
  expect(parseRefno('12345_67890')).toEqual({ dbno: 12345, seq: 67890 });
});
```

**Vue Component Testing:**
```typescript
import { mount } from '@vue/test-utils';
import { createVuetify } from 'vuetify';

it('should emit events on user interaction', async () => {
  const vuetify = createVuetify();
  const wrapper = mount(ModelTreeRow, {
    global: { plugins: [vuetify] },
    props: { node: createMockTreeNode() }
  });

  await wrapper.find('.toggle-button').trigger('click');

  expect(wrapper.emitted('toggle')).toBeTruthy();
  expect(wrapper.emitted('toggle')[0]).toEqual(['test-node']);
});
```

**Three.js Testing:**
```typescript
// Mock 渲染器避免 WebGL 依赖
vi.mock('three', () => ({
  WebGLRenderer: vi.fn(() => ({
    render: vi.fn(),
    setSize: vi.fn(),
    dispose: vi.fn()
  })),
  Scene: vi.fn(() => ({ add: vi.fn(), remove: vi.fn() })),
  PerspectiveCamera: vi.fn()
}));

it('should initialize DTX layer', () => {
  const layer = new DTXLayer();

  expect(layer.addGeometry).toBeDefined();
  expect(layer.addObject).toBeDefined();
});
```

## Testing Recommendations

**优先级:**
1. **高**: 工具函数和类型转换 (纯函数，易测试)
   - `src/utils/unitFormat.ts`
   - `src/lib/utils.ts`
   - `src/types/auth.ts` (辅助函数)
2. **中**: Composables 和状态管理 (业务逻辑核心)
   - `src/composables/useModelTree.ts`
   - `src/composables/useSelectionStore.ts`
3. **低**: 复杂 UI 组件和 3D 渲染 (依赖多，mock 复杂)
   - `src/components/model-tree/ModelTreePanel.vue`
   - `src/utils/three/dtx/DTXLayer.ts`

**推荐框架组合:**
- **单元/集成测试**: Vitest + @vue/test-utils
- **E2E 测试**: Playwright (已安装)
- **覆盖率**: Vitest Coverage (v8 provider)

**配置步骤:**
1. 安装依赖: `npm install -D vitest @vue/test-utils @vitest/coverage-v8`
2. 创建 `vitest.config.ts`
3. 添加测试脚本到 `package.json`
4. 创建示例测试文件验证配置
5. 配置 CI/CD 运行测试

---

*Testing analysis: 2026-01-30*
