# DTX 选段第 2 阶段开发计划：不透明/透明分表选段 + GPU 拾取走选段

接着第 1 阶段（按构件选段，multi draw）往下做两步，每步一个提交，可以单独回退。本文只是计划，执行结果记在末尾的"执行记录"。

## 现状（已实测）

测试条件：AMD RX590 / ANGLE D3D11，本机 Chrome headless，画布 1220×778。

- **第 1 阶段代码已在工作区，尚未提交**：新增 `src/utils/three/dtx/culling/drawRangeSelector.ts`、`src/utils/three/dtx/DTXMultiDrawMesh.ts`（及各自测试、`DTXLayer.drawRanges.test.ts`），改动 `DTXLayer.ts`、`ViewerPanel.vue`、`culling/DTXViewCullController.ts`。
- **真实库 7997 的效果**（19,387 个构件，142 万三角形）：
  - 拉近到 10% 视距：静止帧三角形降到 31%，E3D 单帧 66ms → 44ms；
  - 全景拖动：三角形降到 19%，E3D 单帧 37ms → 11ms；
  - 选段耗时：7997 库 ≤ 0.6ms，demo 10 万构件 ≤ 1.6ms。
- **multi draw 下 `gl_VertexID` 是绝对序号**（本机实测确认），着色器不用改。
- **问题 1：不透明和透明网格共用一张段表**（`src/utils/three/dtx/DTXLayer.ts:336` 的 `_drawRanges`，`:1471` 和 `:1477` 两个网格都传它）。场景里只要有半透明构件，两个通道都会被打开，每个构件画两遍，靠片元着色器按 `renderPass` 丢弃（`src/utils/three/dtx/DTXMaterial.ts:317-331`）。实测 10% 构件半透明时：三角形 142 万 → 285 万，E3D 单帧 38ms → 69ms，直出 18ms → 33ms。
- **问题 2：GPU 拾取网格是普通 Mesh，按整层绘制**（`DTXLayer.ts:1510`），7997 库一次拾取 2.4~2.8ms。入口 `src/utils/three/dtx/selection/DTXSelectionController.ts:192` 的 `pick`，调用方是 `src/components/dock_panels/ViewerPanel.vue:2584`（左键选中，含分屏）和 `:3132`（右键）。`pickPoints` / `pickPoint` 走 kd-tree + CPU 射线求交，不在本次范围。
- **不在本次范围**：
  - 拉近后 E3D 的主要瓶颈是法线深度那趟的超采样片元开销（10% 视距下关掉 AO、HLR、MSAA，单帧 44.6ms → 15.9ms），另立计划；
  - 全景静止帧要靠网格 LOD（`C:\Users\dpc\.factory\specs\2026-11-05-dtx-lod.md` 第 2 阶段）。

## 前置条件

- 第 1 阶段先单独提交。提交前不动 `DTXLayer.ts` 和 `drawRangeSelector.ts`，避免和另一个会话同时编辑同一文件。
- `DTXMaterial.ts`、`DTXMaterial.sgl.test.ts`、`index.ts` 在工作区里有别人未提交的改动，本计划不改 `DTXMaterial.ts`。

## 第 1 步：不透明和透明分表选段

改动：

- **`culling/drawRangeSelector.ts`**：`DrawRangeInput` 新增两个可选字段：
  - `passFlags?: Uint8Array`，每构件 1 字节，0 = 不透明，1 = 透明；
  - `pass?: 0 | 1`，本次选哪个通道。
  
  `passFlags` 不传时行为和现在完全一致。不属于本通道的构件按"不画"处理。相邻段之间夹着的其他构件不超过 20 个三角形时照旧合并；被夹进来的另一通道构件由片元着色器按 `renderPass` 丢弃，结果正确。
- **`DTXLayer.ts`**：
  - `_drawRanges` 拆成 `_opaqueRanges` 和 `_transparentRanges`，分别交给 `_mesh` 和 `_transparentMesh`（`:1471`、`:1477`）。两张表各有一套缓存键（视图矩阵、可见性修订号、`minPx`、像素换算系数），另加新的 `_passRevision`。
  - 分类口径和着色器一致（`DTXMaterial.ts:317-331`，`alphaCutoff = 0.999`，见 `DTXLayer.ts:1435`、`:1458`）：`a = opacity × opacityScale`；`a ≥ 0.999` 进不透明表，`0.001 < a < 0.999` 进透明表，`a ≤ 0.001` 两张都不进。与 `_syncRenderPassVisibility`（`:1515-1525`）的判据相同。
  - `_passRevision` 递增点：`setObjectMaterial` 改透明度（`:2017` 附近）、`setObjectsOpacity`（`:2186`）、`setRenderStyleParams` 改 `opacityScale`（`:1547`）、`compile`（`:877`）、`recompile`（`:938`）、`rollbackObjectsAddedAfter`（`:2403`）。`_passFlags` 在修订号变化后懒重建，和 `_syncRenderPassVisibility` 合成一次遍历。
  - `_beforeMeshRender`（`:1685`）按当前网格属于哪个通道，只更新对应那张表。
  - `getCullStats()`（`:1595`）改为两个通道分开统计，再给合计；`DTXViewCullController` 的汇总相应调整。
- **E3D 法线深度那趟**：透明网格在这一趟被临时当不透明画（`DTXMaterial.ts:585` 的 `setSglNormalDepthOutput`），但它只画透明表里的段，每个构件仍只画一次。管线不用改。

单测：

- 选段器：混合场景、全不透明、全透明、某一通道为空、合并间隙夹带另一通道构件；不传 `passFlags` 时结果和改动前逐项一致。
- DTXLayer：改透明度、改 `opacityScale`（1 → 0.5 → 0 → 1）、`recompile` 之后两张表的三角形数都正确；两表并集覆盖全部可见构件，且没有构件同时出现在两张表里。

预期：10% 半透明场景，E3D 69ms → 约 40ms，直出 33ms → 约 19ms。

## 第 2 步：GPU 拾取走选段

改动：

- **`DTXLayer.ts`**：`_pickingMesh`（`:1510`）改成 `DTXMultiDrawMesh`，用第三张段表 `_pickRanges`。按当次拾取相机（`selection/GPUPicker.ts:223` 的 `_createPickCamera`，`setViewOffset` 生成的窄视锥）选段：
  - 只做视锥和可见性裁剪；
  - `minPx` 固定为 0，拖动中也不裁小构件；
  - 不按透明通道筛选（拾取着色器本来就不区分）。
- **复用现有的渲染前回调**。拾取相机每次新建，缓存基本命中不了，每次拾取多算一遍选段，7997 库 ≤ 0.6ms。
- **不支持 `WEBGL_multi_draw` 时**退回整层绘制（`multiDrawEnabled = false`），和主网格一致；`?dtx_cull=0` 时同样整层绘制。
- **`GPUPicker` 和 `DTXSelectionController` 的接口不变。**

单测：拾取表不受 `minPx` 影响；窄视锥下只保留与视锥相交的构件；关闭选段时段表等于整层。

预期：7997 库一次拾取约 2.6ms → 1ms 以内；10 万构件从 100ms 以上 → 约 2ms。

## 实测方法

- 临时脚本放 `.scratch/md/`，用完删除。Playwright 用 `channel: 'chrome'`、`--use-angle=d3d11`，视口 1920×1080。
- 数据：
  - 真实库：`?show_dbnum=7997&output_project=AvevaMarineSample`，后端按 AGENTS.md 用 rocksdb 档；
  - 合成：`?dtx_demo=primitives&dtx_demo_count=100000`。
- 第 1 步：0%、10%、100% 半透明三种情况，记录 `renderer.info` 的三角形数和 calls，以及 E3D（`__sglLookPipeline.render`）和直出（`selection.renderOutline`）单帧中位数。计时含 `readPixels` 同步。
- 第 2 步：100 个随机屏幕点，拾取结果必须和改动前完全一致（以 `?dtx_cull=0` 为对照）；记录拾取耗时中位数。
- 两步都做：静止帧截图与改动前对比，要求 0 像素差；选中描边、隔离显示、E3D 外观、分屏对比人工抽查一次。
- 跑之前先确认浏览器加载的是新代码（看模块时间戳）。

## 每步检查

- `npm run type-check`：不新增基线之外的错误；
- `npx eslint <改动的文件>`：只查改动的文件；
- `npx vitest run src/utils/three/dtx src/viewer`；
- `npm run build-only`；
- 实测数据记进下面的"执行记录"。

## 回退

两步各自单独提交，可分别 `git revert`。现场临时关闭用 `?dtx_cull=0`，主网格和拾取同时退回整层绘制。

## 执行记录

环境：RX590 / ANGLE D3D11，Chrome headless，画布 1220×778；7997 库 19,387 个构件，demo 10 万构件。

### 第 1 步（`1e56bf5c`）

| 数据 / 半透明比例 | 改动前 | 改动后 |
|---|---|---|
| 7997，0% | 1,424,771 三角形；直出 16.6ms；E3D 36.6ms | 直出 17.0ms；E3D 37.6ms |
| 7997，10% | 2,849,540 三角形；直出 32.8ms；E3D 69.3ms | 1,439,739 三角形；直出 17.2ms；E3D 37.6ms |
| 7997，100% | 直出 16.7ms；E3D 36.8ms | 直出 17.1ms；E3D 37.3ms |
| demo，10% | 3200 万三角形；直出 332.5ms；E3D 667ms | 1600 万三角形；直出 167ms；E3D 336ms |

- 7997 库 10% 半透明：不透明 1,187 段 / 1,276,878 三角形，透明 1,748 段 / 162,859 三角形，选段 1.9ms。
- demo 的统计里透明通道一直报 0，疑似统计时机问题，未深究。

### 第 2 步（`a7e6992a`）

200 个拾取点（100 个随机点 + 100 个构件中心投影点），改动前后命中 0 处不一致。

| 数据 | 改动前（中位 / p90 / 最大） | 改动后 |
|---|---|---|
| 7997 库 | 1.8 / 2.2 / 3.9 ms | 0.5 / 0.9 / 1.4 ms |
| demo 10 万 | 16.2 / 16.7 / 19.5 ms | 0.9 / 1.1 / 2.2 ms |

### 截图对比

- 由 app 自己出帧再截图：两步都与改动前 0 像素差（含 10% 半透明）。
- 固定相机、显式出帧、`readPixels` 读原始像素：
  - 改动前的代码自己就有两种帧状态。三次运行中，两次画 408 段 / 1,389,649 三角形；另一次画 2,868 段 / 747,627 三角形。推测与装载结束那一刻的交互降级或拖动状态有关，未逐帧确认。两种状态之间直出差约 2k 像素，E3D 差约 2 万像素。
  - 状态相同时，0% 半透明在改动前后为 0 像素差。10% 半透明时直出差 29 像素，E3D 差 372 像素：半透明构件改为只画一次，混合结果略有不同，属于预期内的变化。
  - 第 2 步与第 1 步：0 像素差。
- 之前看到的大面积差异（E3D 约 23 万像素）来自两次运行落在不同帧状态，不是改动引入的。

### 待人工抽查

选中描边、隔离显示、E3D 外观、分屏对比。
