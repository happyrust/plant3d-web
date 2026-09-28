# Task Creation 侧栏（shadcn 工程控制台）设计稿说明

日期：2026-02-23  
范围：`pencil` 设计稿 + Vue 可绑定结构草稿  
参考：`/Users/dongpengcheng/.gemini/antigravity/brain/f5ee5436-e731-44f9-9f24-de74b3de126f/implementation_plan.md.resolved`

## 1. 设计目标

将原多步骤向导思路抽象为单页扁平化侧栏，强调高密度操作路径：

- 全局基础配置
- 解析目标区
- 解析动作区（基础 + 高级标志位）
- 性能调节区
- 粘底提交按钮

同时展示自适应侧栏下的两个状态：

- 窄栏：360px（`Narrow 360`）
- 宽栏：填充容器（`Wide Adaptive`）

## 2. Pencil 画布结构

当前活动文档中的关键节点：

- 根画布：`bi8Au`
- 状态容器：`NPoEp`
- 窄栏面板：`yi6y5`
- 宽栏面板：`jWLin`

窄栏与宽栏均采用相同信息架构，仅宽度策略不同。

## 3. 视觉策略（shadcn + 工程控制台）

- 基础配色：`background/card/border/foreground` 中性体系
- 组件形态：卡片分组 + 紧凑间距 + 小字号信息密度
- 状态表达：`ON/OFF` 文本化矩阵，便于快速扫描
- 行为层级：底部单一主按钮 `启动任务 (Start Task)`

## 4. 交互映射（到业务字段）

- 任务类型：`DataParsingWizard | DataGeneration`
- 目标模式：`all | dbnum | refno`
- 高级标志位：
  - `regenModel`
  - `genIndextree`
  - `rebuildTreeIndex`
  - `genAllDesiIndextree`
- 性能参数：
  - `meshTolRatio`
  - `maxConcurrent`

## 5. Vue 结构草稿

新增文件：`src/components/task/TaskCreationPanelShadcnDraft.vue`

说明：

- 已包含 `script setup` + `reactive/computed/handler` 骨架
- 使用现有基础组件：`Input`、`Badge`、`ScrollArea`
- 未接真实 API，仅保留 `handleStartTask` 占位日志
- 可直接作为后续替换 `TaskCreationWizard` 的结构模板

## 6. 后续落地建议

1. 将草稿中的 `form` 与 `useTaskCreation.ts` 新字段对齐。  
2. 将 `handleStartTask` 接到 `submitTask` / 批量创建逻辑。  
3. 将样式 token 统一到项目现有 Tailwind + CSS 变量体系。  
