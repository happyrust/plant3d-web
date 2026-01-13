# plant3d-web 进展文档

## 2026-01-12：模型显示“模糊/发糊”问题排查

### 现象

- Viewer 区域整体偏“糊”，边缘不够锐利；在白底背景下更明显，容易误判为“灯光过曝/泛白”。

### 初步结论（高优先级根因）

- 在 `src/components/dock_panels/ViewerPanel.vue` 中，`handleResize()` 将 `canvas.width/height` 直接设置为容器的 CSS 像素尺寸：
  - `canvas.width = rect.width`
  - `canvas.height = rect.height`
- 在 Retina/高 DPI 屏幕上，这会导致 WebGL 以 **1x 分辨率**渲染，然后被浏览器按 CSS 尺寸放大显示，从而产生明显的整体模糊。

### 已实施修复

- 文件：`src/components/dock_panels/ViewerPanel.vue`
- 修改：resize 时按 `devicePixelRatio` 同步实际像素尺寸，并同步 CSS 尺寸：
  - `canvas.style.width/height = rect.width/height`
  - `canvas.width/height = rect.width/height * devicePixelRatio`

### 验证方式

- 刷新页面后观察：
  - 线框边缘是否明显更锐利
  - 同一视角下，小件（比如薄板、边线）细节是否更清晰
- 在浏览器控制台可临时打印：
  - `window.devicePixelRatio`
  - `viewer.scene.canvas.canvas.width/height` 与容器 `getBoundingClientRect()` 的比例是否接近 DPR

### 下一步（如果仍感觉“糊”）

- 再区分“模糊”来源：
  - **分辨率问题**（通常全局都糊）
  - **SAO/后处理 blur**（局部有雾化感）
  - **曝光/材质/背景对比度**（看起来像泛白）
- 当前 `viewer.vue` 里 `sao.blur = true` 可能带来轻微雾化感，但不应造成明显的全局模糊；需要在 DPR 修复生效后再评估是否要调整 SAO。

## 2026-01-12：模型显示“泛白、面片几乎不可见”问题排查

### 现象（泛白）

- 白底背景下，模型面片几乎“融入背景”，只能隐约看到少量边线。

### 初步结论（泛白，高优先级根因）

- **对比度不足**：Viewer 清屏色接近白，而默认模型颜色也偏浅，导致面片与背景对比度极低。
- **颜色归一化缺口**：部分链路可能直接把 `0..255` 颜色数组传给 xeokit（期望 `0..1`），会被 clamp 成 `1`，视觉效果接近全白。
- **Surreal/SSE 材质偏高光**：`loadSurrealToXeokit` 使用 PBR 且 `roughness` 偏低，会在浅色背景下进一步“洗白”细节。

### 已实施修复（泛白）

- 文件：`src/components/dock_panels/ViewerPanel.vue`
  - 背景清屏色从接近白调整为更明显的浅灰，提高对比度。
- 文件：`src/composables/useSurrealModelLoader.ts`
  - 增加颜色“智能归一化”（兼容 `0..255` 与 `0..1` 输入）。
  - 调整 PBR 参数为更哑光（降低高光影响）。
  - 默认颜色略微压暗，以在浅色背景下更可见。
- 文件：`src/aios-prepack-bundle-loader.ts`
  - 为延迟加载与非延迟加载路径补齐 `createMesh` 的颜色归一化兜底，避免颜色 clamp 导致泛白。

### 验证方式（泛白）

- 刷新页面并重新加载同一模型：
  - 面片应重新可见（不再“白到消失”）。
  - 线框/边线不应是唯一可见信息。
- 若仍泛白：下一步将检查是否存在全局 `xray/selected/highlight` 材质覆盖或某处 `opacity` 被错误设置。
