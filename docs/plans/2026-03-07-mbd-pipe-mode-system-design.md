# MBD 管道标注模式系统设计

**日期：** 2026-03-07

**目标：** 为 BRAN/HANG 的 MBD 标注建立统一的“施工模式 / 校核模式”语义体系，使后端和前端都具备模式能力，同时保持职责边界清晰、兼容性可控。

## 背景

第一期已经完成前端默认态切换：默认视图从“端口校核优先”切到“施工表达优先”。但当前这种默认值仍然主要存在于前端：

- 后端接口尚无显式模式语义
- 前后端默认值仍可能再次漂移
- “施工视图”和“校核视图”仍然只是隐式组合，而不是正式模式

因此第二期需要把模式概念上升为正式接口能力，并在前端建立与之对应的显示与交互规则。

## 核心决策

### 1. 两层都有模式，但职责分离

采用“两层都有”的方案：

- 后端：新增 `mode=construction|inspection`
- 前端：新增 `mbdViewMode=construction|inspection`

职责划分：

- 后端负责“语义默认值”
- 前端负责“显示与交互控制”

不采用“后端返回整套 UI 决策”的做法，避免把前端面板状态、样式切换和显隐控制全部耦合进接口。

### 2. 后端默认值改为 construction

`GET /api/mbd/pipe/{refno}` 新增可选 query 参数：

- `mode=construction|inspection`

兼容规则：

- 不传 `mode` 时，按 `construction` 处理
- 显式传 `mode=construction` 或 `mode=inspection` 时，分别应用对应模式默认值
- 若同时显式传入 `include_*` 字段，显式值优先，覆盖模式默认值

这样可以同时满足：

- 老调用方不需要立即升级，也能自动获得施工默认语义
- 新前端仍可对单项能力做精确覆盖

## 模式定义

### Construction

用于轴测、施工、表达主视图。

后端默认组合：

- `include_dims=true`
- `include_chain_dims=true`
- `include_overall_dim=true`
- `include_port_dims=false`
- `include_welds=true`
- `include_slopes=true`
- `include_bends=false`

前端默认展示：

- `showDimChain=true`
- `showDimOverall=true`
- `showWelds=true`
- `showSlopes=true`
- `showDimPort=false`
- `showDimSegment=false`
- `showBends=false`
- `showSegments=false`
- `dimMode=classic`

### Inspection

用于几何校核、端口间距检查、屏幕高可读性查看。

后端默认组合：

- `include_dims=true`
- `include_chain_dims=false`
- `include_overall_dim=false`
- `include_port_dims=true`
- `include_welds=false`
- `include_slopes=false`
- `include_bends=false`

前端默认展示：

- `showDimPort=true`
- 其余主语义默认关闭
- `dimMode=rebarviz`

## 后端设计

### 1. 接口扩展

在 `gen-model-fork/src/web_api/mbd_pipe_api.rs` 中：

- 为 `MbdPipeQuery` 增加 `mode` 字段
- 新增 `MbdPipeMode` 枚举
- 在 query 归一化逻辑中，先应用 mode 基线，再应用显式 `include_*` 覆盖

建议引入一个明确的“归一化视图配置”函数，而不是把判断散在 handler 中。目标是让“模式默认值 + 显式覆盖”的规则在一处完成。

### 2. 默认值策略

不要直接把 `MbdPipeQuery::default()` 中的每个 `include_*` 写死成 construction 最终值，然后再在各处打补丁。更稳妥的方式是：

- `default()` 仍保留结构初始化语义
- 新增 `resolve_mode_defaults(query)` 或等效逻辑，统一生成运行时最终配置

这样未来若增加第三种模式，不会把默认值逻辑散落到多个地方。

### 3. 测试重点

后端至少验证：

- 不传 `mode` 等价于 `construction`
- `mode=construction` 与 `mode=inspection` 的默认组合不同
- 显式 `include_port_dims=true` 能覆盖 `construction`
- 显式 `include_chain_dims=true` 能覆盖 `inspection`

## 前端设计

### 1. 模式状态

在 `src/composables/useMbdPipeAnnotationThree.ts` 中增加：

- `mbdViewMode: Ref<"construction" | "inspection">`
- `applyModeDefaults(mode)`
- `resetToCurrentModeDefaults()`

前端模式不直接替代 `dimMode`、`showDimChain` 等细项，而是作为一层更高阶的预设。

### 2. 请求层

在 `src/components/dock_panels/ViewerPanel.vue` 中：

- 调用 `getMbdPipeAnnotations()` 时显式传 `mode`
- 当前 `mode` 来自 `mbdPipeVis.mbdViewMode.value`
- 同时仍允许按需传显式 `include_*`，以支持局部覆盖和测试控制

### 3. 面板层

在 `src/components/tools/MbdPipePanel.vue` 中增加：

- 模式切换入口：`施工模式 / 校核模式`
- 一个“重置为当前模式默认”的按钮

这里不建议做成复杂配置页。一期已经有较多开关，第二期只需要让模式成为一等概念。

## 用户交互规则

最重要的规则：

- 首次加载 BRAN 标注时，按当前模式套默认
- 用户手动修改显示项后，不因模式值变化被静默全量覆盖
- 只有在以下两种场景才整套应用默认：
  - 首次加载
  - 用户点击“重置为当前模式默认”

否则用户刚手动打开一项，切一下模式又被自动重置，体验会非常差。

## 风险与控制

### 风险 1：前后端双默认值再次漂移

控制：

- 前端始终显式传 `mode`
- 后端只负责语义基线
- 前端仅负责显示细调

### 风险 2：模式切换破坏用户手工开关

控制：

- 模式切换不自动覆盖所有局部显隐
- 提供显式“重置为当前模式默认”

### 风险 3：测试矩阵扩大

控制：

- 后端主要测“模式默认值 + 显式覆盖”
- 前端主要测“请求参数 + 默认展示映射 + 模式切换”
- 不在第二期引入更多模式

## 结果预期

第二期完成后，应达到：

- 后端正式理解“施工模式 / 校核模式”
- 新老请求在兼容前提下统一到 construction 默认语义
- 前端 UI 中模式成为正式入口，而不是隐式组合
- 前后端默认值不再容易漂移

## 非目标

本期不做：

- weld shop/field 规则重构
- bend 默认开启
- 根据响应返回整套前端 UI 配置
- 更复杂的模式持久化或全局 viewer 级设置
