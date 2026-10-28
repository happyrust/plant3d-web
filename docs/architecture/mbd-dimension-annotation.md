# MBD 尺寸标注实现总览

MBD（Model-Based Definition）尺寸标注在 `plant3d-web` 里的完整链路：**模型树写 `?mbd_refno` → 取数 → 冻结契约校验 → 图元映射 → 外部注册表 → 尺寸内核布局 → 覆盖层绘制**。

- 架构图：[mbd-dimension-annotation.html](../diagrams/mbd-dimension-annotation.html)（组件与边界，可交互）
- 时序图：[mbd-dimension-sync.html](../diagrams/mbd-dimension-sync.html)（一次同步的调用顺序与失败分支）

> 图由 `archify finalize` 生成，证据固定到 `62be3e9`（HEAD）的已提交字节；本文的行号同样以该版本为准。

## 关键路径

| 步骤 | 位置 | 说明 |
| --- | --- | --- |
| 触发 | `src/components/model-tree/ModelTreePanel.vue:1128-1146` | BRAN 节点「查看尺寸标注」写 `?mbd_refno=` 并派发 `popstate` |
| 宿主 | `src/components/dock_panels/ViewerPanel.vue:2837`、`:2912` | 创建 `createMbdExternalSync`、`createDimensionSystem` |
| 通道 | `src/composables/useMbdExternalSync.ts:115-219` | 通道选择、竞态守卫、原子拒绝、诊断写入 |
| HTTP | `src/api/mbdV2Api.ts:92-115` | `GET /api/mbd/v2/pipe/{refno}`；基址解析见 `:32-56` |
| 契约 | `src/dimension/adapters/mbdV2Contract.ts:427-474` | 逐图元校验，产出 `MbdV2ParseResult` 与逐条诊断 |
| 映射 | `src/dimension/adapters/mbdV2ExternalAnnotations.ts:754-762` | 契约图元 → 只读 `ExternalDimensionRecord` |
| 注册表 | `src/dimension/services/externalDimensionRegistry.ts:24-70` | 按 source 分组，跨源 id 冲突即抛错 |
| 组合根 | `src/dimension/facade/createDimensionSystem.ts:157-220` | 字体 + 文档会话 + 视口 + 指针装配 |
| 视口 | `src/dimension/viewport/dimensionViewport.ts:113-200` | 独立 overlay scene；`renderOverlay` 在 `:169` |
| 布局 | `src/dimension/kernel/viewport/layoutViewport.ts:50-108` | 求解 → 去重叠 → 标签占位 → 标签避让 → 检视遮挡 → 命中索引 |
| 绘制 | `src/dimension/viewport/scenePainter.ts:887` | 描边 / 文字 / 箭头写入 overlayScene |
| 导出 | `src/dimension/export/svgOverlay.ts:223` | `layoutResultsToSvg` |
| 面板 | `src/dimension/ui/DimensionPanelDock.vue:79-129`、`:156` | 工程 / 检视模式切换、诊断展示 |
| 诊断 | `src/composables/useMbdDiagnosticsStore.ts:8-30` | `issues / skipped / layoutMode / notes / loadError` |

## 不变量

1. **单通道**：只有实时 API 通道（`channel = 'api'`）。URL 无 `mbd_refno` 时清空来源并清诊断，不做静默降级。
2. **全有或全无**：契约诊断或映射跳过只要有任意一条，整包拒绝并把来源清空，只保留诊断与 `loadError`（ADR 0046）。不存在部分提交。
3. **契约形状冻结**：MBD 数据只能经 v2 契约解析进入（ADR 0043）；焊缝、坡度不新增专用图元，由弧线 + 标记 + 文字拼装（ADR 0042）；角度与辅助弧/圆按 PML `AIDARC` 帧落到内核原生弧（ADR 0055）。
4. **外部只读**：MBD 记录进的是 `ExternalDimensionRegistry`，用户自有尺寸走文档会话与命令日志，两者互不覆盖（ADR 0028）。
5. **覆盖层后置**：尺寸覆盖层在宿主一帧渲染完成（后处理、sRGB 输出之后）再单独绘制，`autoClear = false` + `clearDepth()`（ADR 0062 / ADR 0064），不参与深度排序。

## 排查开关

| 参数 | 作用 |
| --- | --- |
| `?mbd_refno=<refno>` | 指定要取数的分支 |
| `?mbd_kinds=linear_dim,label,…` | 只显示指定图元；过滤事实写进诊断 `notes` |
| `?mbd_lod=0` | 关闭分级显示（剥掉 mapper 打的 `lod` 提示） |
| `?mbd_3d=0` | 关闭三维标注呈现，回落到求解器原位平面几何 |
| `?mbd_mode=inspection` | 打开检视模式：被模型遮挡的尺寸淡化（ADR 0061） |
| `?mbd_partial=1` | 允许部分显示：坏图元只进诊断、其余照常绘制；缺省仍是原子拒绝（ADR 0046） |
| `?mbdBackendPort=<port>` | 覆盖 MBD 后端端口（只能改端口，主机仍是当前页面主机） |
| `?mbdBackend=<绝对地址>` | 覆盖 MBD 后端基址。**2026-10-29 起收紧**：仅开发构建（`import.meta.env.DEV`）或构建期设了 `VITE_MBD_ALLOW_QUERY_BACKEND=1` 时生效；生产构建忽略该参数并 `console.warn` 一次，改用 `VITE_MBD_API_BASE_URL` |

> 用 `vite preview` / 静态包做联调又想用 `?mbdBackend` 时，构建前加 `VITE_MBD_ALLOW_QUERY_BACKEND=1`（离线包里前置独立 MBD 服务的场景就是这个）。

## 维护

候选 JSON 与交付回执在 `.archify/` 下（当前未被 git 跟踪）；`docs/diagrams/` 里是定稿副本。

重新生成：

```
node %USERPROFILE%\.claude\skills\archify\bin\archify.mjs finalize architecture ^
  .archify/architecture-mbd-dimension-20261029-015206/candidate.json ^
  .archify/architecture-mbd-dimension-20261029-015206/mbd-dimension-annotation.html ^
  --repo-root . --quality showcase --json
```

同一输出路径上已存在浏览器证据时（例如重新生成后再跑一次），`finalize` 会以 `viewer/evidence-path-conflict` 拒绝覆盖，追加 `--out-dir <同目录>/review-<n>` 即可；无冲突时不要加，否则产物会落到子目录。

改代码后若行号漂移，`finalize` 会以 `repository-evidence/line-out-of-range` 报出具体文件与行数，按提示更新 `sources` 即可。
