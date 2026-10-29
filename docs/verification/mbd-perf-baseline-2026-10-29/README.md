# MBD 尺寸标注 · 性能基线（W4-1 = T0.3 + D1，2026-10-29）

对应 `docs/plans/2026-10-29-mbd-dimension-remaining-work-dev-plan.md` W4-1；是 W5-5（2k 记录分帧预算）「相对基线 P95 不退化」的比较对象。
**只量不改**：本轮没有动任何布局 / 绘制逻辑，新增的只是观测钩子（见「数字从哪来」）。

状态：**A 合成 2k 已实测填表**（2026-10-29，headless Chromium，`npm run perf:dimensions:browser` 同一条链路的 `run()` + `settle(20)` 各三次）；**B / C 真实 BRAN 仍待填**（需 gen-model 后端 18084 与真实 BRAN 数据，表里的 `—`）。

## 环境（A 场景已填；B / C 待填）

| 项 | 值 |
| --- | --- |
| 机器 | AMD Ryzen 9 7950X 16-Core / 63.1 GB / AMD Radeon RX590 GME |
| 系统 / 浏览器 | Windows 11 企业版 10.0.26200 / Playwright 1.58.2 自带 Chromium（headless）|
| 窗口 / DPR | 1920×1080 / DPR 1（`test.use({ viewport: { width: 1920, height: 1080 } })`，未设 `deviceScaleFactor`）；A 场景画布由 `/dimension-perf.html` 自铺满视口 |
| 电源 / 后台 | 接电源、高性能档；别的占 GPU 的进程关掉 |
| 前端 | `plant3d-web` 提交 `42546128`（A 场景实测时点）；`npm run dev`（dev 构建，`http://127.0.0.1:3101`，`reuseExistingServer: true`）|
| 后端 | A 场景不需要后端（合成数据）；B / C 待填（地址 / 构建），项目 `AvevaMarineSample` |
| 日期 / 操作人 | 2026-10-29 / Lead（A 场景）；B / C 待填 |

## 场景与相机

| 场景 | 内容 | 相机 |
| --- | --- | --- |
| A 合成 2k | `/dimension-perf.html`（`src/debug/dimensionPerf.ts`）：装 10 000 条、可见 2 000 条（1 500 用户 + 500 外部），正交相机，视口 1920×1080 | 脚本自带 |
| B 小 BRAN `24381_145018` | 全类别 77 图元 → 63 条记录（18 条 `linear_dim`：11 main / 7 atta，`cheight_mm=27`；09-12 基线同一条管）| 加载后的自动 fit |
| C 大 BRAN `24381_146979` | 58 个对象、27 个焊缝标记，09-12 远景画出 48 条 | 加载后的自动 fit |

自动 fit = `ViewerPanel.vue::fitDtxViewerToFocusBox`：`distance = max(maxDim × 2.5, 5)`，
`position = center + distance × (0.8, 0.6, 0.8)`，`target = center`（Y 向上）。加载完成后**不碰鼠标**，把相机抄进下表：

```js
JSON.stringify({
  position: __dtxViewer.camera.position.toArray(),
  target: __dtxViewer.controls.target.toArray(),
});
```

绕轨脚本跑完会把相机放回这一位，三次重复不必刷新页面。

## 怎么跑

### A 合成 2k 场景

门禁脚本（headless Chromium 1920×1080，自动起 dev server）：

```powershell
cd D:\work\plant-code\old\plant3d-web
npm run perf:dimensions:browser   # = DIMENSION_PERF_GATE=1 npx playwright test e2e/dimension-perf.spec.ts
```

控制台一行 `dimension-perf { loaded, visible, external, samples, updateP50Ms, updateP95Ms, layoutP95Ms, paintP95Ms, hitP95Ms, observedFps, sceneObjectCount }`。
注意：`run()` 的 60 帧只是相机微动的**渲染**帧（`updateP50Ms` / `updateP95Ms` 是它们的分位），`layoutP95Ms` / `paintP95Ms` 是 60 帧之后**一次** settle 的读数，不是分位。

layout / paint 要分位就在页面里连续 settle：`npm run dev` → 打开 `http://127.0.0.1:3101/dimension-perf.html` → DevTools：

```js
await window.__dimensionPerf.run();   // 60 帧渲染 + 1 次 settle + 1000 次命中测试
window.__dimensionPerf.settle(20);    // 连续 20 次全量布局 + 绘制 → layout / paint 各自的 P50 / P95
```

两条各跑三次。

### B / C 真实 BRAN

1. URL（dev；换 refno 与后端地址；全类别，不加 `mbd_kinds`）：

   ```text
   http://127.0.0.1:3101/?output_project=AvevaMarineSample&show_refno=24381_145018&show_refno_select=0
     &mbd_refno=24381_145018&gm_backend=http://127.0.0.1:18084&mbdBackend=http://127.0.0.1:18084
   ```

2. 等加载完：toast「[成功] 对象 N…」、尺寸面板「BRAN 尺寸标注（MBD）」列出记录、`window.__dimensionSystemError === undefined`。
3. 相机不动，按上面的方法把 `position` / `target` 抄进表。
4. DevTools 里跑绕轨脚本：绕 `target` 的竖直轴匀速转一圈，600 帧；每帧 `notifyViewerChanged()`，所以**每帧都是全量布局**（`layoutFrames ≈ frames`）。先空跑一次热身（字体 / 着色器），再记三次：

   ```js
   await (async ({ frames = 600, radiusScale = 1 } = {}) => {
     const viewer = window.__dtxViewer;
     const system = window.__viewerContext.dimensionSystem.value;
     const stats = window.__dimensionFrameStats;          // dev 构建才有
     const target = viewer.controls.target.clone();
     const home = viewer.camera.position.clone();
     const offset = home.clone().sub(target).multiplyScalar(radiusScale);
     const radius = Math.hypot(offset.x, offset.z);
     const phi0 = Math.atan2(offset.z, offset.x);
     const next = () => new Promise(requestAnimationFrame);
     stats.reset();
     for (let i = 1; i <= frames; i += 1) {
       await next();
       const phi = phi0 + (i / frames) * Math.PI * 2;
       viewer.flyTo(
         target.clone().set(
           target.x + radius * Math.cos(phi),
           target.y + offset.y,
           target.z + radius * Math.sin(phi),
         ),
         target,
         { duration: 0 },
       );
       system.notifyViewerChanged();
     }
     await next();
     viewer.flyTo(home, target, { duration: 0 });
     system.notifyViewerChanged();
     const layouts = system.viewport.getLayouts();
     return {
       records: layouts.length,
       drawn: layouts.filter(layout => layout.primitives.length > 0).length,
       ...stats.summary(),
     };
   })();
   ```

   `radiusScale = 0.4` 是可选的中景档（同一仰角、距离 ×0.4）。缓冲只留最近 600 帧，`frames` 别超过它。
5. 对照（不进表）：手动拖动旋转 10 s 再看 `__dimensionFrameStats.summary()`。真实输入里有 damping 产生的增量帧，`layoutFrames` 会小于 `frames`，两档分开看。

`summary()` 字段：`frames`（缓冲里的帧数）、`layoutFrames`（跑了全量布局的帧数，按 `kind === 'layout'` 判）、`frameKinds`（`{ layout, style, camera }` 三类各多少帧，相加等于 `frames`）、`frameMs`（全部帧的 P50 / P95 / max）、`layoutMs` 与 `paintMs`（**都只算全量布局帧**）。分位是最近邻秩，与 `dimensionPerf.ts` / `benchKernel.ts` 同一算法。

## 记录（三次重复）

### A 合成 2k（`run()`）

| 次 | updateP50Ms | updateP95Ms | layoutP95Ms（单次） | paintP95Ms（单次） | hitP95Ms | observedFps | sceneObjectCount |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 0.30 | 0.60 | 26.30 | 71.30 | 0.10 | 57.93 | 4 |
| 2 | 0.30 | 0.50 | 23.90 | 61.70 | 0.10 | 58.53 | 4 |
| 3 | 0.20 | 0.50 | 21.00 | 59.40 | 0.10 | 58.77 | 4 |
| 中位数 | 0.30 | 0.50 | 23.90 | 61.70 | 0.10 | 58.53 | 4 |

预算（ADR 0040，`e2e/dimension-perf.spec.ts`）：`updateP95Ms ≤ 16`、`hitP95Ms ≤ 2`。

### A 合成 2k（`settle(20)`）

| 次 | layoutP50Ms | layoutP95Ms | paintP50Ms | paintP95Ms |
| --- | --- | --- | --- | --- |
| 1 | 17.10 | 26.20 | 61.70 | 76.60 |
| 2 | 15.70 | 27.80 | 59.40 | 82.00 |
| 3 | 16.60 | 21.30 | 58.10 | 78.60 |
| 中位数 | 16.60 | 26.20 | 59.40 | 78.60 |

### B `24381_145018`（远景，自动 fit）

相机：`position` `—`，`target` `—`；记录 `—` 条 / 画出 `—` 条。

| 次 | frames | layoutFrames | layoutMs P50 | layoutMs P95 | layoutMs max | paintMs P50 | paintMs P95 | paintMs max | frameMs P50 | frameMs P95 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | — | — | — | — | — | — | — | — | — | — |
| 2 | — | — | — | — | — | — | — | — | — | — |
| 3 | — | — | — | — | — | — | — | — | — | — |

中景（`radiusScale = 0.4`，可选）：

| 次 | frames | layoutFrames | layoutMs P50 | layoutMs P95 | layoutMs max | paintMs P50 | paintMs P95 | paintMs max | frameMs P50 | frameMs P95 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | — | — | — | — | — | — | — | — | — | — |
| 2 | — | — | — | — | — | — | — | — | — | — |
| 3 | — | — | — | — | — | — | — | — | — | — |

### C `24381_146979`（远景，自动 fit）

相机：`position` `—`，`target` `—`；记录 `—` 条 / 画出 `—` 条。

| 次 | frames | layoutFrames | layoutMs P50 | layoutMs P95 | layoutMs max | paintMs P50 | paintMs P95 | paintMs max | frameMs P50 | frameMs P95 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | — | — | — | — | — | — | — | — | — | — |
| 2 | — | — | — | — | — | — | — | — | — | — |
| 3 | — | — | — | — | — | — | — | — | — | — |

中景（`radiusScale = 0.4`，可选）：

| 次 | frames | layoutFrames | layoutMs P50 | layoutMs P95 | layoutMs max | paintMs P50 | paintMs P95 | paintMs max | frameMs P50 | frameMs P95 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | — | — | — | — | — | — | — | — | — | — |
| 2 | — | — | — | — | — | — | — | — | — | — |
| 3 | — | — | — | — | — | — | — | — | — | — |

## 基线结论（A 已填 / B、C 待填）

W5-5 比的就是这几格（各取三次的中位数）：

| 场景 | 指标 | 基线 |
| --- | --- | --- |
| 内核（ADR 口径，最接近的度量）| `layout+collision` P95 | **3.746 ms**（预算 16，余量 4.3×；`npm run perf:dimensions:kernel`，DPR 2、实测 200 次）|
| 内核（ADR 口径）| `hit-test` P95 | **0.036 ms**（预算 2，余量 55×）|
| A | `updateP95Ms` / `hitP95Ms` | **0.50 / 0.10**（`hitP95Ms` 与 ADR 同口径；`updateP95Ms` **不对应** ADR 的 16 ms，见下方警示）|
| A | `settle(20)` `layoutP95Ms` / `paintP95Ms` | **26.20 / 78.60**（dev 档浏览器读数，与上面内核口径不可横向比）|
| B 远景 | `layoutMs P95` / `paintMs P95` | — / —（待 gen-model 后端 + 真实 BRAN）|
| C 远景 | `layoutMs P95` / `paintMs P95` | — / —（待 gen-model 后端 + 真实 BRAN）|

**A 场景读数说明**：`hitP95Ms` 0.10 ms 说明**命中测试**不是瓶颈（与 ADR 的「pointer hit-test p95 ≤ 2 ms」同口径，`src/debug/dimensionPerf.ts:245-255` 是纯 CPU 命中）。`paintP95Ms`（`settle(20)` 的 78.60 ms）是 dev 档浏览器里 layout → paint 这一档的主要成本，与 `run()` 里单次 settle 的 61.70 ms 同量级。W5-5 做分帧预算要盯的是 `paintP95Ms`。

**⚠️ `updateP95Ms` 与 ADR 0040 的预算不是同一件事（2026-10-30 补）**：`run()` 的 60 帧循环（`src/debug/dimensionPerf.ts:223-235`）每帧只做「改相机 → `renderer.render(scene, camera)`」，**不跑 `layoutViewport`、不跑 `scenePainter.paint`**；真正的 layout + collision + paint 在 `settleLayout()`（`:190-217`）里，而 `run()` 只在 60 帧之后调它**一次**（`:243`）。ADR 0040 的预算是「合并后的 layout → collision → paint 帧 p95 不超过 16 ms」，所以 `e2e/dimension-perf.spec.ts:27` 那条 `updateP95Ms ≤ 16` **测的是纯 GPU 提交成本，不是 ADR 那个数**。门禁绿不等于 layout → paint 达标。

**这个缺口有多大，要分两个口径看（2026-10-30 实测，两次结论不同，以本段为准）**：

| 口径 | 覆盖 | 机器 / 档位 | p95 | 对 16 ms 预算 |
| --- | --- | --- | --- | --- |
| 内核基准 `npm run perf:dimensions:kernel` | layout + collision（**不含 paint**） | Node 26 / DPR 2 / 热身 50 + 实测 200 次 | **3.746 ms** | **达标**（余量 4.3×）|
| 浏览器 `settle(20)` | layout + collision + hit index + paint | headless Chromium / DPR 1 / **dev 构建** | 26.20 + 78.60 = **104.8 ms** | 超出，但档位不可比 |

内核基准那一行是 ADR 0040 口径里最接近的**可运行**度量：同一份 `layoutDimension` + `resolveLabelCollisions`、同样 2 000 可见、同样 DPR 2，`layout+collision p95 = 3.746 ms`，自带 16 ms 断言且通过（`test/perf/dimensions/benchKernel.ts:26`、`:218`）。所以**「layout 超预算」这个说法不成立**——它只在 dev 构建 + GPU 上传的浏览器读数里看着像超，那是 paint 与 dev 开销混进来的结果。

浏览器那一行的 `paintP95Ms` 78.60 ms 才是真正可疑的成本，但它同样不能直接与 16 ms 比：dev 构建（Vite 未压缩、Vue dev 模式）+ DPR 1 + headless Chromium 的 GPU 路径都与 ADR 参考环境不同。**要判定 paint 是否达标，必须先在能跑生产档的地方量一次**——而这一步现在做不了，见下条。

**生产档拿不到基线（2026-10-30 发现）**：`public/dimension-perf.html:13` 写的是 `<script type="module" src="/src/debug/dimensionPerf.ts">`，而 `public/` 由 Vite **原样拷贝**进 `dist/`，所以 `dist/dimension-perf.html` 里这条路径指向一个构建产物中不存在的文件——**生产构建下这个性能页是坏的**。`vite.config.ts:154-157` 的 `build.rollupOptions.input` 只列了 `index.html` 与 `pms-review-simulator.html`，没有这个页面。因此 W5-5 若要生产档基线，得先把它做成真正的构建入口（或改用 `vite preview` + 一个 dev-only 的等价入口），这本身是一小刀独立工作。

**口径提醒**：`run()` 的 `layoutP95Ms` / `paintP95Ms` 是 60 帧之后**一次** settle 的读数（README `:52` 已注明），字段名带 P95 但不是分位；`settle(20)` 那两列才是真分位。两者不可横向直接比。

退化判据（建议，W5-5 时按实际数定稿）：P95 上浮超过 20 %，或 A 超出 ADR 0040 预算。

## 数字从哪来（本轮改动）

- `createDimensionSystem({ onFrame })`（`src/dimension/facade/createDimensionSystem.ts`）：原样透传给 `DimensionViewport` 的 `onFrame`（`src/dimension/viewport/dimensionViewport.ts`）。视口三处上报：全量布局帧 `layoutMs + paintMs`；只改样式的增量帧与「相机失效但 projector 未换」的帧 `layoutMs = 0`、`paintMs = 整帧`。三处各带 `kind`（`layout` / `style` / `camera`），数值口径不变（`layoutMs + paintMs` 恒等于整帧）。
- `src/debug/dimensionFrameStats.ts`：环形缓冲（600 帧）+ 最近邻秩分位，按 `kind` 分桶（`paintMs` 只算 `layout` 帧）；`ViewerPanel.vue` 在 dev 构建把它挂为 `window.__dimensionFrameStats`，生产构建既不挂也不记录。
- `src/debug/dimensionPerf.ts`：新增 `window.__dimensionPerf.settle(passes)`；`run()` 与 e2e 门禁没动。
- 可选对照：`npm run perf:dimensions:kernel`（Node 内核基准：1920×1080 @2x、2k 可见、热身 50 / 实测 200 次，打印 `layout+collision p50/p95` 与 `hit-test p50/p95`，自带 16 ms / 2 ms 断言）。**这是最接近 ADR 0040 口径的可运行度量**（`test/perf/dimensions/benchKernel.ts:26`、`:218`）：2026-10-30 实测 `layout+collision p95 = 3.746 ms`、`hit-test p95 = 0.036 ms`，均达标。

## 注意

- dev 构建（Vite 不压缩、Vue dev 模式）比生产略慢；基线与 W5-5 复测都用 dev，口径一致即可。
- `layoutMs` 与 `paintMs` 都只统计全量布局帧。绕轨脚本每帧 `notifyViewerChanged()`，`layoutFrames ≈ frames`；手动拖动时增量帧多，两者分开。
- 首轮含字体 / 着色器热身，先空跑一次再记三次。
- 三次的原始返回值（JSON）原样贴在下面「原始读数」；B / C 的读数也往同一节追加，或存 `runs/`。

## 已知口径问题（2026-10-29 只读审计；第 1、3、4、5 条当天已修，第 2、6 条保持，第 7、8 条 2026-10-30 新登记）

1. ~~**`paintMs` 在三类帧里语义不一致**~~ → **已修（2026-10-29）**：`dimensionViewport.ts` 的 `onFrame` breakdown 加 `kind: 'layout' | 'style' | 'camera'`（`DimensionFrameKind`，三处上报点各标一种），数值口径未动（`layoutMs + paintMs` 仍恒等于整帧，facade 用例补断言 `kind === 'layout'`）；`dimensionFrameStats.ts` 的 `summary()` 现在按 `kind` 分桶，`paintMs` **只统计 `layout` 帧**，`style` / `camera` 帧的整帧耗时只进 `frameMs`。另加 `frameKinds` 计数，三类相加等于 `frames`。用例 `buckets by the reported kind instead of inferring it from layoutMs` 钉住。
2. **相机停下后必然产生一条 `layoutMs = 0` 的帧**：`setProjector`（`dimensionViewport.ts:224-227`）设 80 ms `cameraSettleTimer` → `invalidate('camera')`，此时 `lastLayoutProjector === projector` 且 `reasons` 只有 `camera`，命中 `:516-529` 分支。绕轨脚本每帧 `notifyViewerChanged()` 会重置该 timer，但循环结束后的 `flyTo(home)` 仍会留下一条。
3. ~~**`layoutMs > 0` 的过滤会误杀极快的全量帧**~~ → **已修（2026-10-29）**：`dimensionFrameStats.ts` 的 `summary()` 现在按 `kind === 'layout'` 判定全量布局帧，不再看 `layoutMs > 0`。只传两个耗时的老调用方（不给 `kind`）仍按 `layoutMs > 0` 推断，视口自己总是给 `kind`。
4. ~~**`record` 不校验 `durationMs`**~~ → **已修（2026-10-29）**：`dimensionFrameStats.ts` 的 `record` 现在丢弃非有限样本（`durationMs` / `layoutMs` / `paintMs` 任一不是有限数就不入缓冲），避免 `NaN` 毒化排序与 `max`；用例 `drops non-finite samples instead of poisoning the quantiles` 钉住。
5. ~~**`settle(passes)` 没有参数校验**~~ → **已修（2026-10-29）**：`dimensionPerf.ts` 的 `settle` 现在对非正整数 `passes` 抛 `RangeError`，不再返回「全 0 读数但 `passes` 原样回传」这种无法与真实 0 ms 区分的值。
6. **`run()` 的 `layoutP95Ms` / `paintP95Ms` 是单次读数**：字段名带 P95 但非分位（`:52` 已注明），与 `settle(20)` 的同名指标不可横向比。
7. **`updateP95Ms` 与 ADR 0040 的帧预算不同口径（2026-10-30 补，未修）**：`run()` 的 60 帧循环只测 `renderer.render`（`src/debug/dimensionPerf.ts:223-235`），不含 layout / collision / paint；`e2e/dimension-perf.spec.ts:27` 却拿它对着 16 ms 判。ADR 0040 的预算是三者合并的帧 p95。**处置**：W5-5 补一条 `settle(passes)` 分位断言（计划文档 §11.3、风险 R8），在此之前不得引用门禁绿作为性能达标证据。
8. **生产构建下的 `/dimension-perf.html` 是坏的（2026-10-30 发现，未修）**：`public/dimension-perf.html:13` 指向 `/src/debug/dimensionPerf.ts`，而 `public/` 被原样拷进 `dist/`；`vite.config.ts:154-157` 的 `build.rollupOptions.input` 也没有这个页面。所以生产档性能基线**目前无法采集**，W5-5 若要生产档数字，得先把它做成真正的构建入口。

**这些不影响 A 场景已填数字的可用性**（三次重复、同一脚本、同一环境，横向比的是同一口径），但 W5-5 做「P95 不退化」判定时要按场景分别比，不要把 B / C 的 `paintMs` 与 A 的 `paintMs` 放一张表里排名。第 1、3、4、5 条已修掉；第 2 条（相机停下后的那条 `layoutMs = 0` 帧）不是缺陷，现在会被正确记成 `kind: 'camera'` 并只进 `frameMs`；第 6 条（`run()` 的单次读数）保持原样，与 recorder 分位是两套口径；第 7 条（门禁口径）**待 W5-5 修，属计划级缺口，不是本表的口径问题**。

## 原始读数

### A 合成 2k（2026-10-29，`plant3d-web@42546128`，Ryzen 9 7950X / RX590 GME / Playwright 1.58.2 headless Chromium / 1920×1080 DPR 1）

三次连续运行，每次 `run()` 后再 `settle(20)`：

```json
[
  {
    "round": 1,
    "run": {"loaded":10000,"visible":2000,"external":500,"samples":60,
            "updateP50Ms":0.30000001192092896,"updateP95Ms":0.5999999642372131,
            "layoutP95Ms":26.30000001192093,"paintP95Ms":71.30000001192093,
            "hitP95Ms":0.09999996423721313,"observedFps":57.931833543198415,
            "sceneObjectCount":4},
    "settle": {"passes":20,"layoutP50Ms":17.099999964237213,"layoutP95Ms":26.19999998807907,
               "paintP50Ms":61.69999998807907,"paintP95Ms":76.60000002384186}
  },
  {
    "round": 2,
    "run": {"loaded":10000,"visible":2000,"external":500,"samples":60,
            "updateP50Ms":0.30000001192092896,"updateP95Ms":0.5,
            "layoutP95Ms":23.899999976158142,"paintP95Ms":61.69999998807907,
            "hitP95Ms":0.09999996423721313,"observedFps":58.53087503862377,
            "sceneObjectCount":4},
    "settle": {"passes":20,"layoutP50Ms":15.699999988079071,"layoutP95Ms":27.80000001192093,
               "paintP50Ms":59.39999997615814,"paintP95Ms":82}
  },
  {
    "round": 3,
    "run": {"loaded":10000,"visible":2000,"external":500,"samples":60,
            "updateP50Ms":0.20000004768371582,"updateP95Ms":0.5,
            "layoutP95Ms":21,"paintP95Ms":59.39999997615814,
            "hitP95Ms":0.09999996423721313,"observedFps":58.77167205544248,
            "sceneObjectCount":4},
    "settle": {"passes":20,"layoutP50Ms":16.600000023841858,"layoutP95Ms":21.30000001192093,
               "paintP50Ms":58.09999996423721,"paintP95Ms":78.60000002384186}
  }
]
```

取数方式：临时 spec 用 `page.evaluate` 调 `window.__dimensionPerf.run()` 与 `.settle(20)`，跑完即删（不入库）；等价的手工路径见上面「怎么跑」的 DevTools 两行。
