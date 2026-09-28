# RUS-238 测量数据路径显示问题修复开发计划

> 日期：2026-04-29  
> 状态：已实现  
> 关联问题：RUS-238 `测量数据路径显示问题`  
> 范围：`plant3d-web` 测量列表、批注测量证据、确认测量回放

## 0. 执行记录

已按第一阶段低风险方案实现：

- 新增 `src/components/review/measurementDisplay.ts`，统一处理测量点位展示格式。
- 新增 `src/components/review/measurementDisplay.test.ts`，覆盖 refno、DTX object id、PE 包装、空值和路径 summary。
- `src/components/tools/MeasurementPanel.vue` 改用统一 formatter。
- `src/components/review/annotationWorkspaceModel.ts` 改用统一 formatter。
- `src/components/review/annotationWorkspaceModel.test.ts` 补充批注测量证据 summary 回归。
- `src/components/tools/MeasurementPanel.test.ts` 补充测量列表规范化路径断言。
- `src/components/review/TaskReviewDetail.vue` 改用统一 formatter。
- `src/components/review/TaskReviewDetail.test.ts` 补充确认测量回放规范化路径断言。

验证命令：

```bash
npx eslint "src/components/review/measurementDisplay.ts" "src/components/review/measurementDisplay.test.ts" "src/components/review/annotationWorkspaceModel.ts" "src/components/review/annotationWorkspaceModel.test.ts" "src/components/tools/MeasurementPanel.vue" "src/components/tools/MeasurementPanel.test.ts" "src/components/review/TaskReviewDetail.vue" "src/components/review/TaskReviewDetail.test.ts"
npm test -- "src/components/review/measurementDisplay.test.ts" "src/components/review/annotationWorkspaceModel.test.ts" "src/components/tools/MeasurementPanel.test.ts" "src/components/review/TaskReviewDetail.test.ts"
npm run type-check
```

## 1. 背景与问题

当前测量记录中的点位标识直接来自测量引擎拾取结果：

- classic / DTX 测量通常会把对象 ID 归一到 refno，例如 `24381_145018` 或 `24381/145018`。
- Xeokit 测量当前更接近直接保存 `hit.objectId`，可能出现 `o:24381_145018:0` 或其他内部 object id。
- 已确认测量回放读取的是历史快照，里面保留的是当时写入的 raw `entityId`。

这些值适合给程序做定位和回放，但不适合作为用户可读的“测量路径”。目前多个 UI 入口直接拼接 `origin.entityId` / `corner.entityId` / `target.entityId`，导致用户看到内部 ID、下划线 refno、斜杠 refno 混杂。

## 2. 目标

- 统一测量点位在 UI 中的显示格式。
- 兼容 classic、Xeokit、历史 confirmed record 三类来源。
- 不改动测量记录的持久化字段，避免影响定位、回放和旧数据。
- 收敛分散在多个组件里的测量 summary 拼接逻辑。

## 3. 非目标

- 不重构测量存储模型。
- 不迁移历史确认记录。
- 不改变 `flyToMeasurement()`、测量回放、测量创建流程。
- 不在第一阶段实现完整模型树层级路径查询。
- 不把显示格式反写回 `MeasurementRecord`。

## 4. 当前代码判断

### 4.1 展示入口分散

当前至少有三个用户可见入口各自格式化测量路径：

- `src/components/tools/MeasurementPanel.vue`
  - `getMeasurementSummary()` 直接输出 `起点 ${entityId} · 终点 ${entityId}`。
- `src/components/review/annotationWorkspaceModel.ts`
  - `buildLinkedMeasurementItems()` 直接输出 `距离 · ${origin.entityId} → ${target.entityId}`。
- `src/components/review/TaskReviewDetail.vue`
  - `formatMeasurementSummary()` 直接输出 confirmed record 中的 raw `entityId`。

### 4.2 创建侧来源不一致

- `src/composables/useDtxTools.ts`
  - `pickSurfacePoint()` 会尝试从 DTX object id 中解析 refno。
- `src/composables/useXeokitMeasurementTools.ts`
  - `pickSurfacePoint()` 当前更倾向直接返回 `hit.objectId`。

这会使相同业务含义的测量点在 UI 中呈现不同格式。

### 4.3 历史数据必须展示兼容

确认记录中的 `measurements` 是快照，不应要求迁移。修复应在读取/展示时兼容旧 raw ID。

## 5. 方案设计

### 5.1 新增统一展示工具

新增文件：

- `src/components/review/measurementDisplay.ts`

建议导出：

```ts
export type MeasurementDisplayPoint = {
  entityId?: string | null;
};

export type MeasurementDisplayRecord = {
  kind?: 'distance' | 'angle' | string;
  origin?: MeasurementDisplayPoint | null;
  corner?: MeasurementDisplayPoint | null;
  target?: MeasurementDisplayPoint | null;
};

export function normalizeMeasurementEntityId(raw: unknown): string;
export function formatMeasurementEntityId(raw: unknown): string;
export function formatMeasurementPath(record: MeasurementDisplayRecord): string;
```

### 5.2 显示格式规则

第一阶段采用保守规则：

| 输入 | 显示 |
|------|------|
| `24381_145018` | `24381/145018` |
| `24381/145018` | `24381/145018` |
| `o:24381_145018:0` | `24381/145018` |
| `pe:=24381/145018` | `24381/145018` |
| `<24381/145018>` | `24381/145018` |
| `⟨24381/145018⟩` | `24381/145018` |
| `object-abc` | `object-abc` |
| 空值 | `-` |

说明：

- 只识别明确的 `o:<refno>:<idx>` DTX object id，不泛化处理所有冒号字符串。
- 对未知格式原样显示，避免误伤。
- `formatMeasurementPath()` 输出：
  - 距离：`起点 A -> 终点 B`
  - 角度：`起点 A -> 拐点 B -> 终点 C`

### 5.3 三个 UI 入口接入

#### A. 测量列表

文件：`src/components/tools/MeasurementPanel.vue`

改动：

- 删除本地直接拼接 `entityId` 的 `getMeasurementSummary()` 实现。
- 改为调用 `formatMeasurementPath(record)`。

验收：

- classic 和 Xeokit 测量在测量列表中显示一致。
- `定位`、`隐藏`、`删除` 不受影响。

#### B. 批注测量证据

文件：`src/components/review/annotationWorkspaceModel.ts`

改动：

- `buildLinkedMeasurementItems()` 中的 `summary` 统一使用 formatter。
- 可保留现有前缀风格，例如 `距离 · 起点 A -> 终点 B`。

验收：

- 批注详情中“测量证据”显示与测量列表一致。
- 关联关系仍按 `sourceAnnotationId` / `sourceAnnotationType` 判断，不受展示格式影响。

#### C. 确认测量回放

文件：`src/components/review/TaskReviewDetail.vue`

改动：

- `formatMeasurementSummary()` 改为调用 `formatMeasurementPath(measurement)`。
- 兼容 confirmed record 中字段不完整的情况。

验收：

- 旧确认记录无需迁移即可显示可读 refno。
- 加载确认记录失败/为空逻辑不变。

## 6. 分阶段实施计划

### Phase 0 · 需求确认

待确认项：

- 第一阶段是否只显示 refno（推荐），不显示完整模型树路径。
- `o:<refno>:<idx>` 是否只展示 refno，隐藏尾部 idx。
- 是否需要在 tooltip 中展示 raw `entityId`。

通过条件：

- 产品/业务确认第一阶段目标为“统一可读 refno 显示”。

### Phase 1 · 展示 formatter

任务：

- 新增 `measurementDisplay.ts`。
- 实现 `normalizeMeasurementEntityId()`。
- 实现 `formatMeasurementEntityId()`。
- 实现 `formatMeasurementPath()`。
- 补充纯函数测试。

建议测试文件：

- `src/components/review/measurementDisplay.test.ts`

通过条件：

- 覆盖常见 raw ID 输入。
- 未识别 ID 原样显示。
- 空值显示 `-`。

### Phase 2 · UI 接入

任务：

- 改造 `MeasurementPanel.vue`。
- 改造 `annotationWorkspaceModel.ts`。
- 改造 `TaskReviewDetail.vue`。
- 保持原有 props、emits 和 store 写入逻辑不变。

通过条件：

- 三个入口显示一致。
- 不新增异步依赖。
- 不改测量记录数据结构。

### Phase 3 · 回归验证

验证重点：

- classic 测量：
  - `24381_145018` 显示为 `24381/145018`。
- Xeokit 测量：
  - `o:24381_145018:0` 显示为 `24381/145018`。
- 历史 confirmed record：
  - 旧 raw `entityId` 也显示为统一格式。
- 定位功能：
  - 点击“定位”仍调用原测量 id / 原始记录，不因展示格式变化失效。

建议命令：

```bash
npm run type-check
npm test -- measurementDisplay
```

如需按项目习惯避免新增测试命令，可改用最小范围 Vitest 或人工 UI 验证，并记录输入数据与页面结果。

## 7. 风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| 把未知 object id 误解析成 refno | 显示错误路径 | 只处理明确模式，未知格式原样显示 |
| 修改存储字段影响定位 | 定位/回放异常 | 第一阶段只改展示层，不反写数据 |
| 三个入口改动不一致 | 用户仍看到混乱路径 | 统一使用同一个 formatter |
| 历史 confirmed record 字段不完整 | UI 报错 | formatter 使用最小结构和空值 fallback |
| 业务实际需要完整树路径 | 当前方案不满足最终视觉 | 作为第二阶段异步查询模型树路径，不混入本次低风险修复 |

## 8. 验收标准

- 用户不再在测量路径中看到 `o:...:0` 这类内部 DTX object id。
- `24381_145018` 和 `24381/145018` 在 UI 中显示一致。
- 测量列表、批注测量证据、确认测量回放三处显示一致。
- 历史确认记录无需迁移即可获得新显示效果。
- 测量定位、隐藏、删除、确认快照逻辑不退化。

## 9. 后续增强

如果确认需要完整业务路径，可在第二阶段新增：

- 基于 refno 查询模型树路径的异步服务。
- 路径缓存，避免列表中重复请求。
- tooltip 展示 raw `entityId` 和完整路径。
- 缺失路径时 fallback 到 refno。
