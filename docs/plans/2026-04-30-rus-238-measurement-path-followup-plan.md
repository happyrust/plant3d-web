# RUS-238 测量路径显示后续开发计划

> 日期：2026-04-30  
> 状态：执行中  
> 前置计划：`2026-04-29-rus-238-measurement-path-display-plan.md`  
> 范围：`plant3d-web` 测量路径展示增强、PMS/编校审联调验收、交付收敛

## 1. 当前状态

RUS-238 第一阶段已完成低风险修复：

- 测量列表、批注测量证据、确认测量回放已统一使用 `measurementDisplay` 展示 formatter。
- raw `entityId` / DTX object id / 历史确认快照中的 refno 已在展示层规范化。
- 修复不反写 `MeasurementRecord`，不影响测量定位、隐藏、删除、回放与历史数据。
- 定向 ESLint、目标 Vitest、`type-check` 与 IDE lints 已验证通过。

第一阶段解决的是“不要暴露内部 ID、统一 refno 展示”。下一步应验证业务是否需要进一步展示完整模型树路径，并把交付风险收敛到联调场景。

## 2. 下一步目标

- 确认测量路径的最终业务文案：仅 refno、完整模型树路径，或 refno + tooltip/raw 信息。
- 在不改变测量持久化结构的前提下，设计完整路径查询与缓存方案。
- 补齐 PMS/编校审真实流程中的人工或自动化验收记录。
- 形成可交付的风险清单、回滚方案与验收标准。

## 3. 非目标

- 不迁移历史确认记录。
- 不把展示路径反写到测量记录。
- 不重构测量创建、定位、隐藏、删除、确认快照的数据流。
- 不在未确认业务文案前引入跨模块大改。

## 4. 详细阶段计划

### Phase 0 · 业务确认

任务：

- 和业务确认“测量路径”最终展示级别。
- 用 3 组样例确认展示效果：
  - classic refno：`24381_145018`
  - DTX object id：`o:24381_145018:0`
  - 历史 confirmed record：旧 raw `entityId`
- 确认是否需要 tooltip 展示 raw `entityId`，用于技术排查。

通过条件：

- 明确第一阶段是否已满足交付，或需要进入完整路径增强。
- 明确列表主文案、详情文案、tooltip 文案三处展示规则。

### Phase 1 · 真实流程验收

任务：

- 在测量列表中创建距离和角度测量，确认起点、拐点、终点展示一致。
- 在批注中关联测量证据，确认 summary 和测量列表一致。
- 发起编校审确认记录，回放历史测量快照，确认旧数据展示一致。
- 如涉及 PMS 入口，走 PMS 嵌入页面或本地 CDP 脚本记录关键截图和返回结果。

建议验证方式：

```bash
npm run type-check
npx eslint "src/components/review/measurementDisplay.ts" "src/components/review/annotationWorkspaceModel.ts" "src/components/tools/MeasurementPanel.vue" "src/components/review/TaskReviewDetail.vue"
```

如需走 PMS 端到端联调，按现有项目约定使用真实页面或 CDP 脚本，并记录输入 BRAN、包名、页面结果。

通过条件：

- 三个入口在真实数据下展示一致。
- 点击定位、隐藏、删除、确认回放行为不退化。
- PMS/编校审页面中不再出现 `o:...:0` 这类内部对象 ID。

### Phase 2 · 完整业务路径方案设计

任务：

- 梳理 refno 到模型树节点路径的可用数据源。
- 确认路径查询 API 或本地索引是否已存在。
- 设计 `refno -> displayPath` 的只读查询层，不改变测量记录结构。
- 设计缓存策略，避免测量列表和批注详情重复查询。
- 设计 fallback：路径缺失、查询失败、模型未加载时仍显示规范化 refno。

建议接口形态：

```ts
export type MeasurementPathLookupResult = {
  refno: string;
  displayPath: string | null;
  rawEntityId?: string;
};
```

通过条件：

- 有明确的数据源、调用边界、缓存生命周期和失败 fallback。
- 能证明不会阻塞测量面板首屏渲染。
- 不影响历史 confirmed record 的只读回放。

### Phase 3 · 增强实现

任务：

- 新增路径查询封装，输入规范化 refno，输出用户可读路径。
- 在测量列表、批注测量证据、确认测量回放中复用同一展示模型。
- 保持主文案稳定，完整路径可作为主文案或 tooltip，按 Phase 0 结论落地。
- 补充针对缓存、fallback、路径缺失的最小回归覆盖。

通过条件：

- 完整路径和 refno fallback 在三个入口表现一致。
- 路径查询失败不会导致面板报错或空白。
- 不引入测量记录字段迁移。

### Phase 4 · 交付收敛

任务：

- 更新 RUS-238 计划文档执行记录。
- 整理验证证据：命令、输入数据、页面结果、截图或录屏。
- 标注已知限制：仅展示 refno、路径查询依赖模型树、历史快照无法补全等。
- 准备回滚说明：撤回路径增强时仍保留第一阶段 formatter 修复。

通过条件：

- PR 描述包含背景、影响模块、验证命令和真实流程结果。
- 风险和回滚路径清晰。
- 业务确认验收通过。

## 5. 风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| 完整路径查询数据源不稳定 | 展示结果不一致 | 保留 refno fallback，不阻塞 UI |
| 列表批量查询过多 | 面板加载慢 | 使用缓存和懒加载，优先渲染 refno |
| 历史确认快照缺失上下文 | 无法补全完整路径 | 只读展示 refno，tooltip 标注 raw ID |
| 业务文案反复变化 | 重复改多个入口 | 保持统一 formatter / view model |
| 误改存储结构 | 定位和回放退化 | 路径增强只做展示层，不反写记录 |

## 6. 建议优先级

1. 先完成 Phase 0 和 Phase 1，确认第一阶段是否可直接交付。
2. 只有业务明确要求完整模型树路径时，再进入 Phase 2 和 Phase 3。
3. Phase 4 在交付前必须完成，尤其是 PMS/编校审真实流程验收记录。

## 7. 交付物清单

- 业务确认结论。
- 真实流程验收记录。
- 完整路径查询技术方案。
- 如进入增强实现：路径查询封装、统一展示接入、最小回归覆盖。
- PR 验证记录与回滚说明。

## 8. 执行记录

### 2026-04-30 · 启动执行

已完成：

- 创建后续开发计划文件。
- 对第一阶段已触达文件运行静态验证：

```bash
npm run type-check
npx eslint "src/components/review/measurementDisplay.ts" "src/components/review/annotationWorkspaceModel.ts" "src/components/tools/MeasurementPanel.vue" "src/components/review/TaskReviewDetail.vue"
```

结果：

- `npm run type-check` 通过。
- 定向 ESLint 通过。

当前阻塞：

- Phase 0 需要业务确认最终展示文案：仅 refno、完整模型树路径，或 refno + tooltip/raw 信息。
- Phase 1 的 PMS/编校审真实流程验收需要可操作页面、目标 BRAN/包名和人工或 CDP 验收窗口。

下一步：

- 拿到业务确认后，先判断第一阶段是否可直接交付。
- 若需要完整模型树路径，再进入 Phase 2 数据源梳理与查询方案设计。
