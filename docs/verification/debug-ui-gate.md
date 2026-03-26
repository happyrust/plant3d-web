# Debug UI Gate 使用说明

本文说明当前仓库里哪些页面/面板受 `debug_ui` 门控控制，以及在联调时如何开启或关闭这些调试界面。

## 默认行为

- 开发环境：默认显示调试 UI
- 非开发环境（部署环境）：默认隐藏调试 UI
- 仅在显式开启时，部署环境才会显示这些调试/联调入口

## 开启方式

任选一种即可：

### 1. URL 查询参数

在页面 URL 后追加：

```text
?debug_ui=1
```

如果 URL 已经有其它参数，则追加：

```text
&debug_ui=1
```

示例：

```text
http://127.0.0.1:3101/pms-review-simulator.html?debug_ui=1
http://127.0.0.1:3101/?project_id=AvevaMarineSample&debug_ui=1
```

### 2. 浏览器 Local Storage

在浏览器控制台执行：

```js
localStorage.setItem('plant3d_debug_ui', '1');
```

关闭：

```js
localStorage.removeItem('plant3d_debug_ui');
```

### 3. 浏览器 Session Storage

在当前页签会话内临时开启：

```js
sessionStorage.setItem('plant3d_debug_ui', '1');
```

关闭：

```js
sessionStorage.removeItem('plant3d_debug_ui');
```

## 当前受控范围

### Review 相关调试/联调提示

- `src/components/review/InitiateReviewPanel.vue`
  - 自动进入提资/编辑工作区
  - 表单 ID / 项目 / Lineage
  - 当前绑定任务
  - form_id 未绑定内部任务提示
  - 外部流程模式 banner

- `src/components/review/ReviewPanel.vue`
  - 自动进入校审/待处理工作区
  - reviewer 落点中的 Lineage 标签

### 工具与可视化调试入口

- `src/components/tools/ToolManagerPanel.vue`
  - `DTX / Instances 导入（开发用）`

- `src/components/tools/MbdPipePanel.vue`
  - `锚点调试`
  - `所属段调试`

- `src/ribbon/ribbonConfig.ts`
  - `调试` Ribbon 页签

### 独立调试页面

- `pms-review-simulator.html`
  - 非开发环境下，默认不开放
  - 需要显式带 `debug_ui=1` 或设置 `plant3d_debug_ui=1` 后才允许进入

## 推荐联调方式

如果只是临时查看调试 UI，优先使用 URL 参数：

```text
?debug_ui=1
```

如果需要连续联调多个页面，优先使用：

```js
localStorage.setItem('plant3d_debug_ui', '1');
```

联调结束后建议及时关闭，避免误把调试信息当成正式界面：

```js
localStorage.removeItem('plant3d_debug_ui');
sessionStorage.removeItem('plant3d_debug_ui');
```
