# BRAN 标注默认施工视图设计

**日期：** 2026-03-06

**目标：** 将当前 BRAN 的 MBD 标注默认视图，从“端口校核优先”调整为“轴测/施工习惯优先”，先只改前端默认展示，不改后端生成规则。

## 背景

当前前端在请求 `/api/mbd/pipe/{refno}` 时，默认仅开启 `include_port_dims`，同时关闭 `chain / overall / weld / slope / bend`。渲染侧默认样式为 `rebarviz`，默认可见项也以 `port` 尺寸为主。

这更接近 3D 几何校核视图，不是管道专业更常见的施工表达。对施工习惯而言，链式尺寸、总长、焊口、坡度更应成为默认主视图，端口尺寸应退居次要或按需查看。

## 一期范围

仅调整前端默认行为：

- 调整 `ViewerPanel.vue` 中的 `getMbdPipeAnnotations()` 默认请求参数
- 调整 `useMbdPipeAnnotationThree.ts` 中的默认显示项
- 调整默认尺寸样式模式，从 `rebarviz` 切到 `classic`

不在一期内做的事情：

- 不修改后端 `mbd_pipe_api.rs` 的默认 query 值
- 不增加新的模式系统或复杂状态持久化
- 不重构焊口 shop/field 语义规则
- 不改动 `model-display.config.json`

## 默认视图目标

进入 BRAN/HANG 标注后，默认应看到：

- 链式尺寸
- 总长尺寸
- 焊口标注
- 坡度标注

默认应隐藏：

- 端口尺寸
- 单段尺寸
- 弯头角度
- 线骨架

## 设计决策

### 1. 默认请求语义

`ViewerPanel.vue` 默认请求改为：

- `include_dims: true`
- `include_chain_dims: true`
- `include_overall_dim: true`
- `include_port_dims: false`
- `include_welds: true`
- `include_slopes: true`
- `include_bends: false`

说明：

- `chain` 和 `overall` 对应施工表达的主体
- `weld` 和 `slope` 是常见辅助施工语义
- `port` 更偏几何校核信息，不应作为默认主视图
- `bend` 先关闭，避免首屏过载

### 2. 默认可见性

`useMbdPipeAnnotationThree.ts` 默认状态改为：

- `showDimSegment = false`
- `showDimChain = true`
- `showDimOverall = true`
- `showDimPort = false`
- `showWelds = true`
- `showSlopes = true`
- `showBends = false`
- `showSegments = false`

### 3. 默认视觉风格

默认 `dimMode` 从 `rebarviz` 改为 `classic`。

原因：

- `classic` 更接近工程图尺寸线观感
- `rebarviz` 当前更偏屏幕高对比展示，不够像管道轴测/施工标注
- 一期目标是先让默认态更像专业表达，而不是保留对比实验风格

### 4. 兼容性

- URL 参数覆盖仍保留，允许开发/测试继续通过 `mbd_dim_mode` 等参数切回 `rebarviz`
- 面板中的开关仍保留，用户可在默认施工视图基础上二次调整
- 后端能力不动，因此一期风险主要集中在默认显示效果变化

## 风险与控制

风险：

- 某些 BRAN 在链式尺寸很多时可能出现文字拥挤
- 焊口和坡度同时开启后，局部区域可能比现在更热闹

控制：

- 一期先不打开 segment/port/bend，控制首屏信息密度
- 保留现有交互拖拽与显隐开关，不影响用户手动整理
- 先用真实 BRAN 做验证，再决定二期是否调整后端默认 query

## 二期方向

二期再考虑：

- 后端默认 query 改成施工语义优先
- 增加“施工模式 / 校核模式”正式预设
- 补强 shop/field weld 规则
- 增加分支主标头或线号主标签
