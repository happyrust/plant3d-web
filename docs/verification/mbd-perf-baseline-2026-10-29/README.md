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

`summary()` 字段：`frames`（缓冲里的帧数）、`layoutFrames`（跑了全量布局的帧数）、`frameMs` / `paintMs`（全部帧的 P50 / P95 / max）、`layoutMs`（只算全量布局帧）。分位是最近邻秩，与 `dimensionPerf.ts` / `benchKernel.ts` 同一算法。

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
| A | `updateP95Ms` / `hitP95Ms` | **0.50 / 0.10**（预算 16 / 2，余量 32× / 20×）|
| A | `settle(20)` `layoutP95Ms` / `paintP95Ms` | **26.20 / 78.60** |
| B 远景 | `layoutMs P95` / `paintMs P95` | — / —（待 gen-model 后端 + 真实 BRAN）|
| C 远景 | `layoutMs P95` / `paintMs P95` | — / —（待 gen-model 后端 + 真实 BRAN）|

**A 场景读数说明**：`updateP95Ms` 与 `hitP95Ms` 大幅低于预算，说明 2k 记录在 headless Chromium 下的**布局与命中测试**不是瓶颈；`paintP95Ms`（`settle(20)` 的 78.60 ms）才是这一档的真实成本，它是 20 次全量布局 + 绘制里最慢的那 5%，与 `run()` 里单次 settle 的 61.70 ms 同量级。W5-5 做分帧预算时要盯的是 `paintP95Ms`，不是 `updateP95Ms`。

**口径提醒**：`run()` 的 `layoutP95Ms` / `paintP95Ms` 是 60 帧之后**一次** settle 的读数（README `:52` 已注明），字段名带 P95 但不是分位；`settle(20)` 那两列才是真分位。两者不可横向直接比。

退化判据（建议，W5-5 时按实际数定稿）：P95 上浮超过 20 %，或 A 超出 ADR 0040 预算。

## 数字从哪来（本轮改动）

- `createDimensionSystem({ onFrame })`（`src/dimension/facade/createDimensionSystem.ts`）：原样透传给 `DimensionViewport` 的 `onFrame`（`src/dimension/viewport/dimensionViewport.ts`）。视口三处上报：全量布局帧 `layoutMs + paintMs`；只改样式的增量帧与「相机失效但 projector 未换」的帧 `layoutMs = 0`、`paintMs = 整帧`。
- `src/debug/dimensionFrameStats.ts`：环形缓冲（600 帧）+ 最近邻秩分位；`ViewerPanel.vue` 在 dev 构建把它挂为 `window.__dimensionFrameStats`，生产构建既不挂也不记录。
- `src/debug/dimensionPerf.ts`：新增 `window.__dimensionPerf.settle(passes)`；`run()` 与 e2e 门禁没动。
- 可选对照：`npm run perf:dimensions:kernel`（Node 内核基准：1920×1080 @2x、2k 可见、热身 50 / 实测 200 次，打印 `layout+collision p50/p95` 与 `hit-test p50/p95`）。

## 注意

- dev 构建（Vite 不压缩、Vue dev 模式）比生产略慢；基线与 W5-5 复测都用 dev，口径一致即可。
- `layoutMs` 只统计全量布局帧。绕轨脚本每帧 `notifyViewerChanged()`，`layoutFrames ≈ frames`；手动拖动时增量帧多，两者分开。
- 首轮含字体 / 着色器热身，先空跑一次再记三次。
- 三次的原始返回值（JSON）原样贴在下面「原始读数」；B / C 的读数也往同一节追加，或存 `runs/`。

## 已知口径问题（2026-10-29 只读审计，未修，W5-5 前需知情）

1. **`paintMs` 在三类帧里语义不一致**：`dimensionViewport.ts:506-509`（只改样式的增量帧）与 `:524-527`（仅相机失效且 projector 未换）把**整帧**耗时记为 `paintMs`，而 `:559-562`（全量布局帧）的 `paintMs` 只含 `scenePainter.paint`。`:524-527` 那条分支实际**不绘制**（只有 `requestRender()`），却以 `paintMs ≈ 整帧` 入缓冲。后果：`paintMs` 分位被这两类帧往下拉或往上推，跨场景不可直接比。
2. **相机停下后必然产生一条 `layoutMs = 0` 的帧**：`setProjector`（`dimensionViewport.ts:224-227`）设 80 ms `cameraSettleTimer` → `invalidate('camera')`，此时 `lastLayoutProjector === projector` 且 `reasons` 只有 `camera`，命中 `:516-529` 分支。绕轨脚本每帧 `notifyViewerChanged()` 会重置该 timer，但循环结束后的 `flyTo(home)` 仍会留下一条。
3. **`layoutMs > 0` 的过滤会误杀极快的全量帧**：`dimensionFrameStats.ts:91` 用 `sample.layoutMs > 0` 判定全量布局帧；`performance.now()` 精度不足时（小场景可能只几十条记录）全量布局可能测得 `0`，该帧被归为增量帧，`layoutFrames` 少算。
4. **`record` 不校验 `durationMs`**：`dimensionFrameStats.ts:76-81` 直接存入；`NaN` 会让排序比较器返回 `NaN`（顺序不定）、`percentile` 可能返回 `NaN`，而 `quantiles` 的 `max` 因 `NaN > max` 恒 false 报 0。
5. **`settle(passes)` 没有参数校验**：`dimensionPerf.ts:267` 接受任意 `passes`；`passes <= 0` 或非整数时循环不执行，返回全 0 读数，调用方无法与「真实测到 0 ms」区分。
6. **`run()` 的 `layoutP95Ms` / `paintP95Ms` 是单次读数**：字段名带 P95 但非分位（`:52` 已注明），与 `settle(20)` 的同名指标不可横向比。

**这些都不影响 A 场景已填数字的可用性**（三次重复、同一脚本、同一环境，横向比的是同一口径），但 W5-5 做「P95 不退化」判定时要按场景分别比，不要把 B / C 的 `paintMs` 与 A 的 `paintMs` 放一张表里排名。

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
