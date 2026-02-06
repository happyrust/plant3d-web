# Coding Conventions

**Analysis Date:** 2026-01-30

## Naming Patterns

**Files:**
- Vue 组件使用 PascalCase: `ModelTreePanel.vue`, `ViewerPanel.vue`
- TypeScript 文件使用 camelCase: `useDockApi.ts`, `useModelTree.ts`
- Composables 统一使用 `use` 前缀: `useModelTreeStore.ts`, `useSelectionStore.ts`
- API 文件使用描述性名称: `genModelRoomTreeApi.ts`, `reviewApi.ts`
- 工具函数文件: `utils.ts`, `unitFormat.ts`
- 类型定义文件: `auth.ts`, `task.ts`, `spec.ts`
- DTX 相关类使用 PascalCase: `DTXLayer.ts`, `DTXGeometry.ts`

**Functions:**
- 使用 camelCase: `getModelTreeInstance()`, `formatLengthMeters()`, `setFilter()`
- 辅助函数使用动词前缀: `get`, `set`, `format`, `resolve`, `ensure`, `build`
- 布尔函数使用 `is/has` 前缀: `isDesigner()`, `hasRole()`, `hasPdmsTypeIcon()`
- 事件发射函数使用 `emit` 前缀: `emitCommand()`, `emitToast()`
- 类型转换函数: `fromBackendRole()`, `toBackendRole()`, `normalizeReviewTask()`

**Variables:**
- 使用 camelCase: `activeTree`, `expandedIds`, `flatRows`
- Ref 变量使用 `Ref` 后缀: `pdmsViewerRef`, `roomViewerRef`, `ribbonBarRef`
- Store 变量使用 `Store` 后缀: `selectionStore`, `toolStore`
- 常量使用 UPPER_SNAKE_CASE: `NOUN_TYPES`, `WORKFLOW_NODE_NAMES`
- 布尔变量使用描述性前缀: `isRoomTree`, `searchLoading`, `DEBUG_SKIP_EYE_AUTO_GENERATE`

**Types:**
- 使用 PascalCase: `TreeNode`, `ObjectHandle`, `GeometryHandle`
- Response 类型添加 `Response` 后缀: `RoomTreeNodeResponse`, `TaskListResponse`
- Request 类型添加 `Request` 后缀: `TaskCreationRequest`, `ReviewTaskCreateRequest`
- DTO 类型添加 `Dto` 后缀: `RoomTreeNodeDto`, `TreeNodeDto`
- Parameters 类型添加 `Parameters` 后缀: `ModelGenParameters`, `ParseTaskParameters`
- Enum 使用 PascalCase: `UserRole`, `UserStatus`, `TaskStatus`

## Code Style

**Formatting:**
- 工具: ESLint (`eslint.config.js`)
- 缩进: 2 空格
- 引号: 单引号 (`'single'`)
- 分号: 必须使用 (`;`)
- 行尾逗号: 仅多行 (`'only-multiline'`)
- 最大空行: 1 行

**Linting:**
- 工具: ESLint 9.39.1 + TypeScript ESLint 8.48.1
- Vue 插件: eslint-plugin-vue 10.6.2
- 数组类型: 使用 `[]` 语法而非 `Array<T>` (`@typescript-eslint/array-type: array`)
- 类型定义: 优先使用 `type` 而非 `interface` (`@typescript-eslint/consistent-type-definitions: type`)
- 未使用变量: 关闭警告 (`@typescript-eslint/no-unused-vars: off`)
- 函数返回类型: 不强制显式声明 (`@typescript-eslint/explicit-function-return-type: off`)

## Import Organization

**Order:**
1. Vue 核心库 (vue, vue-router, pinia, vuetify)
2. 外部依赖 (three, @tanstack/vue-query, lucide-vue-next)
3. 内部代码 (@/api, @/components, @/composables, @/utils)
4. 父级目录引用
5. 同级目录引用
6. 索引文件
7. 类型引用

**Path Aliases:**
- `@/*` → `./src/*` (主要别名)
- `~/*` → `./node_modules/*`

**规则:**
- 按字母顺序排序 (`alphabetize: asc`)
- 分组间必须空行 (`newlines-between: always`)
- 禁用 `import/default` 以支持 Vue setup style

**实际示例 (来自 `ModelTreePanel.vue`):**
```typescript
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue';

import { useVirtualizer } from '@tanstack/vue-virtual';
import { Filter, Plus, Search, X } from 'lucide-vue-next';
import type { DtxCompatViewer } from '@/viewer/dtx/DtxCompatViewer';

import { pdmsSearch, type PdmsSearchItem } from '@/api/genModelSearchApi';
import ModelGenerationProgressModal from '@/components/model-tree/ModelGenerationProgressModal.vue';
import ModelTreeRow from '@/components/model-tree/ModelTreeRow.vue';
import { useModelGeneration } from '@/composables/useModelGeneration';
import { usePdmsOwnerTree, NOUN_TYPES } from '@/composables/usePdmsOwnerTree';
import { useRoomTree } from '@/composables/useRoomTree';
import { useSelectionStore } from '@/composables/useSelectionStore';
import { cn } from '@/lib/utils';
```

## Error Handling

**Patterns:**
- API 调用使用 try-catch 并提供错误消息
- 错误信息通过 `error_message` 字段返回
- HTTP 错误包含状态码和响应文本: `throw new Error(\`HTTP ${resp.status} ${resp.statusText}: ${text}\`)`
- 异步函数使用 `.catch()` 或 `try-catch`
- 空值检查优先使用可选链: `ribbonBarRef.value?.collapsed ?? false`

**实际示例 (来自 `genModelRoomTreeApi.ts`):**
```typescript
async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const base = getBaseUrl().replace(/\/$/, '');
  const url = `${base}${path.startsWith('/') ? '' : '/'}${path}`;

  const resp = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`HTTP ${resp.status} ${resp.statusText}: ${text}`);
  }

  return (await resp.json()) as T;
}
```

## Logging

**Framework:** console (原生)

**Patterns:**
- 调试日志: `console.log('[ComponentName] description:', value)`
- 组件日志使用方括号标记: `[ModelTreePanel]`, `[DtxViewer]`
- 警告: `console.warn()`
- 错误: `console.error()`
- 频率: 代码库中有 220 个 console 调用分布在 42 个文件中
- 生产环境: 未配置移除 (保留调试能力)

**实际示例:**
```typescript
console.log('[ModelTreePanel] initial props.viewer:', props.viewer ? 'exists' : 'null');
console.log('[ModelTreePanel] watch triggered, viewer:', v ? 'exists' : 'null', 'activeTree:', t);
```

## Comments

**When to Comment:**
- JSDoc 注释用于类型定义和公共 API
- 复杂算法添加说明性注释
- TODO/FIXME 标记待完成工作 (当前 4 个 TODO)
- 中文注释用于业务逻辑说明
- 关键架构决策添加文档链接

**JSDoc/TSDoc:**
- 类型定义使用 JSDoc: `/** 几何体句柄 - 添加几何体后返回 */`
- 函数参数使用 `@param` (可选)
- 返回值使用 `@returns` (可选)
- 枚举值添加中文说明: `ADMIN = 'admin', // 系统管理员`

**实际示例:**
```typescript
/**
 * DTXLayer - Data Texture Layer
 *
 * 借鉴 xeokit 的 DTX 架构，将所��几何体和实例数据打包到 GPU 纹理中，
 * 通过 gl_VertexID + texelFetch 实现单次 draw call 渲染全场景。
 *
 * 核心优化目标：
 *   - 269 个 InstancedMesh2 → 1 个 DTXLayer
 *   - 269 次 draw call → 1-3 次 draw call
 *   - setProgram 开销从 90-165ms 降至 < 5ms
 *
 * @see docs/渲染引擎/DTX数据纹理层技术方案.md
 */
```

## Function Design

**Size:** 无严格限制，但倾向于单一职责

**Parameters:**
- 使用对象参数传递多个选项
- 可选参数使用 `?` 标记: `limit?: number`
- 默认参数使用 ES6 语法: `getBaseUrl() || ''`
- 使用解构传递: `{ filter, typeQuery }`

**Return Values:**
- 异步函数返回 `Promise<T>`
- API 函数返回统一的 Response 类型
- 布尔函数直接返回布尔值
- 复杂返回值使用类型化对象
- Composables 返回响应式对象或函数集合

**实际示例:**
```typescript
// API 函数
export async function roomTreeGetChildren(id: string, limit?: number): Promise<RoomTreeChildrenResponse> {
  const url = new URL('http://localhost');
  url.pathname = `/api/room-tree/children/${encodeURIComponent(id)}`;
  if (limit !== undefined) {
    url.searchParams.set('limit', String(limit));
  }
  return await fetchJson<RoomTreeChildrenResponse>(`${url.pathname}${url.search}`);
}

// 辅助函数
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// 类型守卫
export function hasRole(user: User | null, role: UserRole): boolean {
  if (!user) return false;
  return user.role === role;
}
```

## Module Design

**Exports:**
- 优先使用命名导出: `export function`, `export type`, `export const`
- Vue 组件使用默认导出 (由 Vue 约定)
- 类型和接口统一使用命名导出
- 枚举使用命名导出
- Composables 返回对象或函数集合

**Barrel Files:**
- 使用 `index.ts` 作为桶文件: `src/utils/three/dtx/index.ts`, `src/utils/three/dtx/selection/index.ts`
- 重新导出子模块内容: `export { DTXLayer } from './DTXLayer'`
- 简化导入路径: `import { DTXLayer } from '@/utils/three/dtx'`

**实际示例 (来自 `src/utils/three/dtx/index.ts`):**
```typescript
export { DTXLayer } from './DTXLayer';
export { DTXMaterial } from './DTXMaterial';
export { DTXGeometry } from './DTXGeometry';
export { DTXPickingMaterial } from './DTXPickingMaterial';
```

## Vue Specific Conventions

**Script Setup:**
- 使用 `<script setup lang="ts">` 语法
- Props 使用 `defineProps<T>()` 泛型语法
- Emits 使用 `defineEmits<T>()` (如需)
- 组��名无需显式声明 (文件名即组件名)

**Attributes Order (Vue ESLint 规则):**
1. DEFINITION (is, v-is)
2. LIST_RENDERING (v-for)
3. CONDITIONALS (v-if, v-else, v-show)
4. RENDER_MODIFIERS (v-once, v-pre)
5. GLOBAL (id)
6. UNIQUE (ref, key)
7. SLOT (v-slot, slot)
8. TWO_WAY_BINDING (v-model)
9. OTHER_DIRECTIVES (v-custom)
10. OTHER_ATTR (custom props, class, style)
11. EVENTS (@click, @change)
12. CONTENT (v-html, v-text)

**Template Formatting:**
- HTML 缩进: 2 空格
- 自闭合标签空格: `<Component />`
- 单行最多 10 个属性
- 多行最多 6 个属性
- 块间必须空行 (`vue/padding-line-between-blocks`)
- Mustache 插值空格: `{{ value }}`

**Reactivity:**
- 优先使用 `ref()` 和 `computed()`
- 大对象使用 `shallowRef()`: `shallowRef<DtxCompatViewer | null>(null)`
- 响应式状态集中管理在 composables
- 避免直接操作 `.value`，使用计算属性

## TypeScript Conventions

**Type Definitions:**
- 使用 `type` 而非 `interface`
- 导出类型使用 `export type`
- 联合类型使用竖线: `'text' | 'cloud' | 'rect' | 'obb'`
- 可选属性使用 `?`: `owner?: string | null`
- Record 类型用于映射: `Record<string, UserRole>`

**Generics:**
- API 函数使用泛型: `fetchJson<T>(path: string): Promise<T>`
- 类型推断优先于显式声明
- 复杂泛型提取为类型别名

**Type Imports:**
- 类型导入使用 `import type`: `import type { DtxCompatViewer } from '@/viewer/dtx/DtxCompatViewer'`
- 值和类型混合导入分开: `import { foo } from 'bar'; import type { Baz } from 'bar';`

**配置:**
- tsconfig.json 使用 composite 项目
- 路径别名: `@/*` → `./src/*`
- 严格模式: 基于 `@vue/tsconfig/tsconfig.dom.json`

---

*Convention analysis: 2026-01-30*
