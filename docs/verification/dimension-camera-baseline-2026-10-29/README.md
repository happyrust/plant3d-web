# 尺寸标注 · 固定相机截图基线（W5-2 / T6.4，2026-10-29）

**只量不改**：这份基线不修改任何布局 / 绘制逻辑，只固定「相机 + 数据 + 视口」三件事，
让后续改动的截图能与它逐档对照。生成器是 `e2e/dimension-camera-baseline.spec.ts`。

## 这是什么、给谁用

对**真实 BRAN**（gen-model 后端直读 + MBD 尺寸通道）在**同一个 `controls.target`** 下出
「远 / 中 / 近」三档 canvas 截图，并把每档的相机参数落成 `cameras.json` 侧车文件。

| 用途 | 谁 | 怎么用 |
| --- | --- | --- |
| 布局 / 剔除改动的 A/B 对照 | W1-3 / W5-3 / W5-4 | 读侧车的 `tiers.<tier>.position` / `target` 复现同一位，再比截图与 `drawn` / `lodHidden` |
| 改动前后的并排对比 | W0-2 的 T7.6 | 旧提交与当前树各跑一组到不同目录，人工并排看 |

三档的语义：

| 档 | `scale` | 相机来源 |
| --- | --- | --- |
| `far` | 1 | **不重算**：加载后 `fitDtxViewerToFocusBox` 留下的相机，原样读取 |
| `mid` | 0.4 | `target + (farPosition − target) × 0.4` |
| `near` | 0.2 | `target + (farPosition − target) × 0.2` |

`far` 档刻意不复用既有取景写法（`e2e/dimension-doc-screenshots.spec.ts` 那套按锚点包围盒
重算相机）：A/B 要比的是**用户真看到的默认视角**，重算一套取景会把这个前提换掉。
自动 fit 的公式是 `distance = max(maxDim × 2.5, 5)`、`position = center + distance × (0.8, 0.6, 0.8)`
（`src/components/dock_panels/ViewerPanel.vue:1475` `fitDtxViewerToBox`，由 `:1491`
`fitDtxViewerToFocusBox` 调）。

mid / near 只沿**同一条方向向量**缩模长，`target` 一个字节都不动——三档的 `target` 必须相等，
这是断言之一。

## 产物

```
docs/verification/dimension-camera-baseline-2026-10-29/
  README.md                     ← 本文件
  <refno>/
    far.png                     ← canvas.viewer 截图
    mid.png
    near.png
    cameras.json                ← 侧车
```

`cameras.json` 结构（每个 refno 一份）：

```json
{
  "label": "36d701b2 / baseline",
  "generatedAt": "2026-10-29T06:12:44.318Z",
  "url": "http://127.0.0.1:3101/?output_project=AvevaMarineSample&show_refno=24381_145018&...",
  "viewport": { "width": 1920, "height": 1080 },
  "devicePixelRatio": 1,
  "canvasCss": { "width": 1220, "height": 778 },
  "refno": "24381_145018",
  "tiers": {
    "far":  { "scale": 1,   "position": [x, y, z], "target": [x, y, z], "up": [0, 0, 1], "fov": 30, "near": 0.5, "far": 500000, "records": 63, "drawn": 48, "lodHidden": 6 },
    "mid":  { "scale": 0.4, "position": [x, y, z], "target": [x, y, z], "up": [0, 0, 1], "fov": 30, "near": 0.0077, "far": 307.0, "records": 63, "drawn": 48, "lodHidden": 0 },
    "near": { "scale": 0.2, "position": [x, y, z], "target": [x, y, z], "up": [0, 0, 1], "fov": 30, "near": 0.0038, "far": 153.5, "records": 63, "drawn": 47, "lodHidden": 0 }
  }
}
```

（`canvasCss` / `up` / `fov` / `near` / `far` 的数值取自 2026-10-29 在 `?dtx_demo=primitives`
页面上的实测：1920×1080 视口下画布 `clientWidth/Height` = 1220×778，`up` = `[0,0,1]`，`fov` = 30。
`far` 档的 `near` / `far` 是**页面原值**——基准档不重算裁剪面，实测拿到的就是 `DtxViewer`
构造时的 `0.5 / 500000`；真实 BRAN 加载时 `applyDtxCameraClipByLayerBBox` 会按 layer bbox
收紧一次，那时读到的会是收紧后的值。`records` / `drawn` / `lodHidden` 三列是真实 BRAN 的
预期量级，尚未实测。）

字段口径：

- `position` / `target` / `up` / `fov` / `near` / `far` 都是**读回值**（`camera.position.toArray()`），
  不是公式算出来的理论值——`controls.update()` 会把位置从球坐标重算一遍，读回值才是复现依据。
- `records` = `getLayouts().length`
- `drawn` = `layout.primitives.length > 0` 的 layout 条数（与 `docs/verification/mbd-perf-baseline-2026-10-29/README.md:108` 同口径，W5-5 可直接对表；被 LOD 剔除时 `primitives` 与 `scenePrimitives` 都空，两种写法结果相同）
- `lodHidden` = `derived.lodHidden !== undefined` 的条数（`ExplicitLodHiddenReason`，
  见 `src/dimension/kernel/types.ts:330`）
- `canvasCss` 是主画布元素的 `clientWidth` / `clientHeight`（`<canvas ref="mainCanvas" class="viewer" />`），
  与 `viewport` 不同：视口扣掉左右面板与工具栏才是画布的实际像素尺寸。

`up` 的缺省是 `[0, 0, 1]`（`DtxViewer` 构造时 `camera.up.set(0, 0, 1)`，Z 向上），
不是 Three.js 的 `[0, 1, 0]`——侧车里记的是实测值，不要照抄示例。

## 环境（2026-10-29 生成时的机器）

| 项 | 值 |
| --- | --- |
| 机器 | AMD Ryzen 9 7950X 16-Core / 63.1 GB / AMD Radeon RX590 GME |
| 系统 / 浏览器 | Windows 11 企业版 10.0.26200 / Playwright 1.58.2 + 本机 Google Chrome 156（`channel: 'chrome'`，headless） |
| 窗口 / DPR | 1920×1080 / DPR 1（`test.use({ viewport: { width: 1920, height: 1080 } })`，未设 `deviceScaleFactor`） |
| 电源 / 后台 | 接电源、高性能档；别的占 GPU 的进程关掉 |
| 前端 | `plant3d-web` 提交 `36d701b2`；`npm run dev`（dev 构建，`http://127.0.0.1:3101`） |
| 后端 | gen-model `http://127.0.0.1:18084`（同时喂 `gm_backend` 与 `mbdBackend`），项目 `AvevaMarineSample` |
| 数据 | BRAN `24381_145018`（小，63 条记录）、`24383_91813` |

## 怎么跑

门控变量 `DIMENSION_CAMERA_BASELINE=1` 不开就整个文件 skip（环境缺失不误报成回归）。
后端不在也 skip；refno 在后端没有 MBD 尺寸记录也 skip。

```powershell
cd D:\work\plant-code\old\plant3d-web

# 起 dev（3101 已有 dev server 在跑时跳过这步，config 是 reuseExistingServer: true）
npm run dev -- --host 127.0.0.1 --port 3101 --strictPort

# 另开一个终端：跑基线
$env:DIMENSION_CAMERA_BASELINE = '1'
$env:GEN_MODEL_V1_BASE_URL = 'http://127.0.0.1:18084'
$env:PLANT3D_REAL_PROJECT = 'AvevaMarineSample'
$env:DIMENSION_CAMERA_BASELINE_LABEL = '36d701b2 / baseline'
npx playwright test --config=playwright.novideo.config.ts e2e/dimension-camera-baseline.spec.ts
```

跑完控制台一行一档的摘要（距离 / `records` / `drawn` / `lodHidden`），产物落在输出目录。

### 环境变量

| 变量 | 缺省 | 作用 |
| --- | --- | --- |
| `DIMENSION_CAMERA_BASELINE` | 未设 | 门控：不等于 `1` 就 `test.skip` |
| `GEN_MODEL_V1_BASE_URL` | `http://127.0.0.1:18084` | 后端地址，同时喂 `gm_backend` 与 `mbdBackend` |
| `PLANT3D_REAL_PROJECT` | `AvevaMarineSample` | `output_project` |
| `DIMENSION_CAMERA_BASELINE_REFNOS` | `24381_145018,24383_91813` | 逗号分隔，每个 refno 一个 test |
| `DIMENSION_CAMERA_BASELINE_TIERS` | `far:1,mid:0.4,near:0.2` | 档位名:距离比例。**第一档就是基准档**，它的 scale 恒按 1 处理（写别的值会打 warning 并被忽略） |
| `DIMENSION_CAMERA_BASELINE_OUT_DIR` | `docs/verification/dimension-camera-baseline-2026-10-29` | 输出根目录 |
| `DIMENSION_CAMERA_BASELINE_BASE_URL` | 未设 | 设了就 `page.goto` 绝对 URL，绕过 config 的 `baseURL`（用于指向另一个 worktree 的 dev server，如 3102） |
| `DIMENSION_CAMERA_BASELINE_LABEL` | 未设（侧车记 `null`） | 写进侧车 JSON，标识这次跑的是哪个提交 / 哪一组 |

URL 参数名是 `gm_backend` 和 `mbdBackend`（大小写不同，别合并成一个）。生成的链接形如：

```text
http://127.0.0.1:3101/?output_project=AvevaMarineSample&show_refno=24381_145018&show_refno_select=0
  &mbd_refno=24381_145018&gm_backend=http://127.0.0.1:18084&mbdBackend=http://127.0.0.1:18084
```

## 用它做 A/B（W1-3 / W5-3 / W5-4）

侧车里每一档的 `position` / `target` 就是**回到同一位**的全部信息。在页面上复现某一档：

```js
const viewer = window.__dtxViewer;
const system = window.__viewerContext.dimensionSystem.value;
const tier = /* 侧车里的 tiers.near，或任何一档 */ null;

viewer.camera.position.set(...tier.position);
viewer.controls.target.set(...tier.target);
viewer.camera.up.set(...tier.up);
viewer.camera.fov = tier.fov;
viewer.camera.near = tier.near;
viewer.camera.far = tier.far;
viewer.controls.enableDamping = false;   // 别让残余阻尼把相机再挪走
viewer.controls.update();
viewer.camera.updateProjectionMatrix();
system.notifyViewerChanged();
```

要点：

1. `enableDamping` 关掉再 `update()`。开着时 `update()` 会把残余的 `sphericalDelta` 再衰减一半
   写回相机，读回来的 `position` 就不是刚设进去的点。
2. `near` / `far` 直接抄侧车，不要用 `maxExtent × 40` 之类重算——深度精度变了会改变 z-fighting，
   截图对比就不干净了。
3. 改完等**两帧 rAF** 再截图（`requestAnimationFrame` 套两层），否则截到的是上一相机下的标签角度。
4. 比截图之外还要比侧车里的 `drawn` / `lodHidden`：这两个数直接反映剔除规则有没有多藏 / 少藏记录。

## 用它做 W0-2 的前后对比（T7.6）

目标：在两个不同的提交上各跑一组，输出到两个目录，人工并排看。

```powershell
cd D:\work\plant-code\old\plant3d-web

# 1) 检出旧提交到独立 worktree（不要把当前工作区的改动带走）
git worktree add ..\plant3d-web-before <旧提交 sha>
cd ..\plant3d-web-before
npm install          # 或从主工作区拷 node_modules
npm run dev -- --host 127.0.0.1 --port 3102 --strictPort

# 2) 另开终端：旧提交那一组
cd D:\work\plant-code\old\plant3d-web
$env:DIMENSION_CAMERA_BASELINE = '1'
$env:GEN_MODEL_V1_BASE_URL = 'http://127.0.0.1:18084'
$env:DIMENSION_CAMERA_BASELINE_BASE_URL = 'http://127.0.0.1:3102'
$env:DIMENSION_CAMERA_BASELINE_OUT_DIR = 'docs/verification/dimension-camera-baseline-2026-10-29/before'
$env:DIMENSION_CAMERA_BASELINE_LABEL = '<旧提交 sha> / before'
npx playwright test --config=playwright.novideo.config.ts e2e/dimension-camera-baseline.spec.ts

# 3) 当前树那一组（3101 的 dev server，或同样另起）
$env:DIMENSION_CAMERA_BASELINE_BASE_URL = 'http://127.0.0.1:3101'
$env:DIMENSION_CAMERA_BASELINE_OUT_DIR = 'docs/verification/dimension-camera-baseline-2026-10-29/after'
$env:DIMENSION_CAMERA_BASELINE_LABEL = '36d701b2 / after'
npx playwright test --config=playwright.novideo.config.ts e2e/dimension-camera-baseline.spec.ts
```

并排看：

- 图片：`before/<refno>/<tier>.png` vs `after/<refno>/<tier>.png`，同 `tier` 同 `refno` 对一对。
- 侧车：`diff before/<refno>/cameras.json after/<refno>/cameras.json`。`position` / `target` 应当
  几乎一致（`far` 档取决于自动 fit，如果改的就是取景逻辑，这里会差——那正是要看的）；
  `drawn` / `lodHidden` 的差量是剔除改动的直接读数。
- 收尾：`git worktree remove ..\plant3d-web-before`。

注意 `before` / `after` 两组必须用**同一个** `DIMENSION_CAMERA_BASELINE_REFNOS` 与
`DIMENSION_CAMERA_BASELINE_TIERS`，否则并排的不是同一件事。

## spec 内的断言

1. 每档 `drawn >= 1`（一条图元都没画出来就是环境问题，不是基线）
2. 三张 PNG 的 Buffer **两两不相等**（相机没生效 / 页面没重绘时三张会一模一样）
3. 侧车里三档的 `target` 三个分量各自相等（容差 `1e-6`）
4. 侧车里三档 `position` 到 `target` 的距离比 ≈ 配置的比例（容差 `1e-3`）

## 已知限制

- **需要 gen-model 后端**：`/api/v1/health` 不通就整条 skip；没有 MBD 数据（`/api/mbd/v2/pipe`
  返回空 / 报错）也 skip。没后端时这条用例永远是 skip，不是「通过」。
- **dev 构建**：走 `npm run dev`。生产构建的差异（压缩、tree-shaking、`import.meta.env.DEV`
  分支）不在基线覆盖范围内；`window.__dimensionFrameStats` 这类 dev-only 探针在生产构建里没有。
- **GPU 档位**：基线用的是 Playwright 缺省（本机 Chrome headless 拿真显卡）。软渲染
  （`PLAYWRIGHT_SOFTWARE_GL=1`）下浮点与抗锯齿会有差异，跨档位比较请标明档位。
- **字体**：标签用 troika-three-text，字形来自浏览器字体栈。换机器 / 换 Chrome 大版本可能
  造成标签像素差异，`cameras.json` 的数值不受影响。
- **`far` 档会随取景逻辑漂移**：改 `fitDtxViewerToFocusBox` / `fitDtxViewerToBox` 会同时改掉
  `far` 的相机，于是 `mid` / `near` 也跟着变（它们按 `far` 缩模长）。做布局 A/B 时如果 diff 到
  三档 `position` 全变，先查是不是动过取景。
- **`canvasCss` 依赖面板布局**：左右面板宽度、Dock 布局变了画布尺寸就变。跨组比较前先确认
  `canvasCss` 一致，否则等于换了视口比图。
- **一个 refno 一个 test**：`DIMENSION_CAMERA_BASELINE_REFNOS` 里加条目就多一个 test，
  并行度由 Playwright 的 `fullyParallel` 决定；同机并发跑多档会互相抢 GPU，数值场景建议 `--workers=1`。
