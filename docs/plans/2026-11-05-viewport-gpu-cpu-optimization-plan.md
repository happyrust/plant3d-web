# 三维视口 GPU/CPU 优化开发计划（参照 plant-ui 第二轮）

参照 plant-ui 的三次提交：`d77a27bb5`（界面相机关 MSAA）、`ada26e8d4`（拖动时降画质）、`d01007a29`（缓存包围盒并集），按本仓的实际情况调整。共四步，每步一个提交，可以单独回退。

## 现状（已读代码确认）

- **画布开着 MSAA**：`src/viewer/dtx/DtxViewer.ts:84-102` 里 `getContext('webgl2', { antialias: true })`，渲染器也是 `antialias: true`。像素比在 `:106` 和 `:224` 两处设成 `max(1, devicePixelRatio)`，没有上限。
- **默认样式下画布 MSAA 白费**：默认绘制样式是 `e3d`（`src/composables/useRenderStyleStore.ts:102`），主场景走 `SglLookPipeline.render`（`ViewerPanel.vue:529-536`）。管线自己在离屏图里做抗锯齿：颜色 4× MSAA，法线深度和 HLR 边线 2×2 超采样，AO 全分辨率再加两趟模糊（`sglLookPipeline.ts:1033-1257`）。最后只往画布贴一张全屏图，画布这一层的 MSAA 用不上。
- **空闲停画已经有了**：`renderFrame` 只在 `needsRender` 为真或相机变化时才画（`ViewerPanel.vue:3357-3447`），不用再做 plant-ui 那种停画闸门。
- **包围盒每帧重算**：模糊锐度每帧调用 `extraSceneBounds`，对每个 DTX 层执行一次 `getBoundingBox()`，每次都要克隆再做矩阵变换（`ViewerPanel.vue:3656-3660`、`DTXLayer.ts:915`）。同一帧里 `_collectRenderables` 还会把普通 Mesh 的世界包围盒再合并一遍（`sglLookPipeline.ts:1365-1377`）。

## 第 1 步：画布关 MSAA，非管线样式改走离屏图

改动：
- `DtxViewer.ts` 里的 `getContext` 和 `WebGLRenderer` 都改成 `antialias: false`。
- 新增一张 MSAA 离屏图（`WebGLRenderTarget`，`samples = min(4, capabilities.maxSamples)`，尺寸随 `setSize` 变）。工程图、PBR、线框、X 光这几种不走管线的样式，主场景和尺寸标注层先画进这张图，再拷到画布上。E3D 外观照旧走管线，不经过这张图。
- `DTXOutlineHelper` 的选中描边本来就画在自己的离屏图里，要核对它的抗锯齿效果和改动前一致。
- ViewportGizmo 和尺寸标注线直接画在画布上。尺寸标注线自带羽化，gizmo 要截图对比边缘，锯齿明显就把它也挪进离屏图。

风险：画布 MSAA 在创建上下文时就定死了，运行时关不掉，出问题只能回退提交。

验证：每种样式截图后和改动前逐像素对比。E3D 外观应该完全一致，非管线样式只允许边缘有微小差异。另外采 GPU 占用。

## 第 2 步：像素比限制到 2

改动：`DtxViewer.ts:106` 和 `:224` 改成 `min(2, max(1, devicePixelRatio))`，和 `e3dLookDemo.ts:65` 一致。管线通过 `renderer.getPixelRatio()` 读像素比，会自动跟着变。

影响：只影响 devicePixelRatio 大于 2 的设备（部分高分屏笔记本、平板），画面会稍微软一点。

## 第 3 步：拖动时临时降画质

改动：
- `SglLookPipeline` 新增 `setInteracting(on: boolean)`。开着时跳过 AO 和模糊，HLR 超采样降到 1×1。边线和渐变背景照常画。颜色离屏图的 MSAA 不动，避免反复重建离屏图。
- 交互开始的信号：OrbitControls 和 gizmo 的 `start`/`end` 事件、滚轮、`flyTo` 动画。松手后进入宽限期，宽限期内相机还在动（阻尼惯性）就继续延长。停稳 200ms 后恢复全画质，并调一次 `requestRender()` 补一帧高画质；否则按需出帧会停在最后那一帧低画质上。
- 开关：URL 参数 `?dtx_drag_downgrade=0` 或 localStorage 项 `dtx_drag_downgrade=0` 可关闭，默认开。

测试：恢复时机的判断写成纯函数，补 Vitest 单元测试，覆盖六种情况：
- 一开始拖动就降级
- 一直拖着保持降级
- 松手后阻尼还在转，宽限期跟着延长
- 停稳 200ms 后恢复
- 开关关闭时不降级
- 非 E3D 样式不受影响

已知现象：开始拖动和松手时 HLR 离屏图各重建一次，那一帧可能多花几毫秒，不会出现黑帧。

## 第 4 步：缓存场景包围盒（先测再做）

先测：在开发模式下用 `performance.now()` 统计 `_autoBlurSharpness` 和 `_collectRenderables` 每帧的耗时。如果拖动时它们占不到一帧时间的 2%，这一步就不做，只在本文件里记下实测数字。

如果要做：
- `DTXLayer` 新增 `boundsRevision` 计数，在 `:661`（扩大包围盒）、`:2080`（重算包围盒）和 `setGlobalModelMatrix` 里加 1。
- ViewerPanel 以"层列表 + 各层 `boundsRevision`"为键缓存合并后的世界包围盒，键没变就直接用缓存。层列表在 `:774`、`:2444`、`:5378` 三处增删时让缓存失效。
- 补单元测试：缓存结果和直接合并的结果必须完全一致，覆盖新增层、删除层、清空、改全局矩阵四种情况。

## 实测方法

- 加载：开发服务器带 `?dtx_demo=primitives&dtx_demo_count=<N>`；需要稳定负载时把 localStorage 项 `dtx_continuous_render` 设为 `1`。如果用真实模型，后端按 AGENTS.md 用 rocksdb 档启动。
- 浏览器：用 Playwright 驱动 Chrome，固定窗口尺寸，拖动用 `page.mouse` 注入，不依赖窗口在不在前台。plant-ui 测拖动时就因为窗口在后台，拖动打到了别的窗口。
- 数据：GPU 占用用 `Get-Counter` 只采 Chrome GPU 进程的 3D 引擎；帧时间从 `__dimensionFrameStats` 读。改动前后交替各跑两轮，空闲和拖动两种场景分开记录。
- 跑新数据前先确认浏览器里确实是刚改的代码（看模块时间戳，或加一条临时日志，测完删掉）。plant-ui 第 1 步就是测成了旧产物，数据作废。

## 每步检查

- `npm run type-check`：不得出现基线之外的新错误。
- `npx eslint <改动的文件>`：只查改动的文件，不跑全仓 `npm run lint --fix`。
- `npx vitest run src/viewer/e3dLook src/utils/three/dtx`，再加上新增的测试。
- `npm run build-only`。
- 截图对比，以及 GPU 占用和帧时间实测。

## 回退

每步可以单独 `git revert`。第 3 步也可以设 `dtx_drag_downgrade=0` 临时关闭，不用回退。

## 执行记录（2026-11-05）

环境：AMD RX590 / ANGLE D3D11，本机 Chrome（Playwright `channel: 'chrome'`，headless），开发服务器 3101，`?dtx_demo=primitives`。

- **第 1 步**（`4311fb16`）：只把画布和渲染器改成 `antialias: false`。实测五种样式改动前后逐像素对比（3000 个图元，1280×800），主场景 0 差异，差异只在右上角 gizmo（约 250 px，最大差 70，放大看边缘略硬）。原因：非管线样式其实不直接画画布，而是走选中描边的 EffectComposer（`selection.hasOutline()` 恒真，离屏图 + FXAA），所以计划里的「新增 MSAA 离屏图」不需要做。GPU 占用改动前后交替各两轮：E3D 93.1/93.2 → 92.5/93.5%，工程图 53.1/53.0 → 52.9/52.4%，在噪声范围内（这块卡上画布 MSAA 解析本来就便宜）。
- **第 2 步**（`2e6936ec`）：`clampViewerPixelRatio` 上限 2。顺带把尺寸叠层的 `getDpr` 接到 `renderer.getPixelRatio()`，否则描边羽化仍按 `window.devicePixelRatio` 算。`deviceScaleFactor=3` 下 `getPixelRatio()` = 2，画面正常。GPU 拾取本来就读 `renderer.getPixelRatio()`。
- **第 3 步**（`393efa9d`）：管线单帧耗时（含 GPU，每帧后 `readPixels` 同步）：500 个图元、1220×778 画布 5.5ms → 2.8~3.1ms；5000 个图元时瓶颈在几何，22ms → 19~20ms。「相机在动」改为与上一次出帧的位姿比较，位移按视距归一、阈值 3e-4（约半个像素）：用原来的 `CAMERA_EPS_SQ` 时阻尼尾巴要拖约 3 秒才算停稳。实测松手后约 0.95s 恢复（阻尼收尾 + 200ms），恢复帧与强制重画的全画质帧只差 12 个像素。GPU 占用在 5000 个图元时就已顶在 97%，看不出差别，所以用单帧耗时衡量。
- **第 4 步**：不做。拖动时 `_collectRenderables` 约 1.2~1.4µs、`_autoBlurSharpness` 约 0.8~1.2µs（含 `DTXLayer.getBoundingBox()` 0.3µs），合计约 2.5µs，占 16.7ms 帧时间约 0.015%，远低于 2% 门槛。demo 场景只有 1 个可见普通 Mesh、1 个 DTX 层；`show_dbnum` 多层时按层数线性增长，也还差两个数量级。

## 需要人工确认

大模型场景、真实显卡、高分屏上的观感、选中描边和 gizmo 边缘、缩放和悬停交互，这些自动测试覆盖不到，需要手动确认。
