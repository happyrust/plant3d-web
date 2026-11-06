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

## 追加：粗网格补拉推迟到整库装载结束（`8d3d13ef`）

### 问题

整库是一批批到的，批与批之间的空闲常超过 `scheduleLod1Backfill` 的 300ms 空闲阈值，粗网格补拉于是插进装载中间：和装载本身抢请求，还反复 `recompile`。实测补拉窗口 222.6s，几乎横跨整个装载。

### 改动

- `useDbnoInstancesDtxLoader.ts` 新增 `holdDtxLod1Backfill()`，返回幂等的释放函数。持有期间 `scheduleLod1Backfill` 不排定时器，只把图层登记进 `lod1DeferredLayers`；可嵌套计数，最后一个释放时对登记过的图层各排一次。
- `useModelGeneration.ts` 的 `showModelByDbnum` 在 `modelLoadStatus.begin` 之后持有，`finally` 首行释放，抛错也释放。
- `invalidateDtxLoaderCaches` 一并清空 `lod1DeferredLayers`。

### 实测（AMS 全量 20 库，开 LOD，同一后端）

| 指标 | 改动前 | 改动后 |
|---|---|---|
| 装载总耗时 | 223.3s | 213.2s |
| lod1 补拉窗口（first → last） | 222.6s，贯穿整个装载 | 1.55s，装载结束后集中发完 |
| 堆峰值 | 2422MB | 1967MB |
| lod1 命中 | 1282 个 200 + 704 个 404 | 同上 |
| lodSettle | 9.1s | 10.5s |

帧时间与拾取基本不变：全景静止直出约 92ms / E3D 约 188ms，拖动约 14ms；拉近静止约 38 / 96ms，拖动约 20.5 / 22ms；三角形 828 万（全景静止）；拾取中位 1.1–1.6ms。

### 数据可信度（第一轮，沙箱后端）

只有一对样本。第二对对照没跑成：before 侧的 `git worktree` 实例上 `__dtxViewCull` 始终为 `false`（junction 的 `node_modules` 加依赖预构建 reload 打断初始化），与本改动无关。

**装载总耗时那一行（223.3s → 213.2s，快 4.5%）不可用**，单对样本且装载耗时本身波动很大，见下面的第二轮复测。补拉窗口和堆峰值两项差异足够大，第一轮结论成立。

## 复测二：合入 main 后在 8022 真实后端上各跑两轮

环境：after 侧用 3101（`main`，含他人未提交改动），before 侧用 `git worktree` 到 `6417dbd6`（改动前）跑 3112；两侧同一个 8022 后端、rocksdb 档、AMS 全量 20 库、开 LOD。worktree 实例起不来的原因这次定位清楚：`node_modules` 是 junction，vite 的 `fs.strict` 把字体等资源拒成 403，加上首次依赖预构建的 reload 打断初始化；加 `server.fs.allow` 并等 reload 完成后正常。

| 轮次 | 装载总耗时 | lod1 补拉窗口 | 补拉起点距装载结束 | 堆峰值 | 全景静止 直出 / E3D |
|---|---|---|---|---|---|
| before1 | 172.4s | 172.05s | −171.8s（装载中就开始） | 2943MB | 113.5 / 232.3ms |
| before2 | 139.3s | 139.02s | −138.7s | 2943MB | — |
| after1 | 118.6s | 2.31s | 装载结束后 | 1942MB | 112.9 / 231.9ms |
| after2 | 155.5s | 2.59s | +0.35s | 2071MB | 115.0 / 236.1ms |

- **补拉窗口**：before 两次等于整个装载时长（补拉从装载开始就发起、横跨到底）；after 两次都是 2.3–2.6s，after2 实测起点在装载结束后 0.35s。改动生效且可重复。
- **堆峰值**：before 两次都是 2943MB，after 1942 / 2071MB，低 0.9–1.0GB。
- **帧时间**：两边一致（全景静止直出约 113ms、E3D 约 232ms），全景静止三角形数四次完全相同，都是 10,350,911，渲染结果没变。
- **装载总耗时**：before 中位 155.9s、after 中位 137.1s，看着快 12%，但 after2（155.5s）比 before2（139.3s）还慢。这台机器上装载耗时波动超过 30s，两对样本分不开，**不作为收益**。
- lod1 请求这次 2008 个全是 200、无 404。8022 不认 `?lod=`，这 2008 个 200 都是原网格，那一轮没有粗网格参与。两侧一致，不影响对照，但和第一轮 1282 个 200 + 704 个 404 的数字不可直接比。
- 7333 库两侧都 `loaded:false`，已知的后端问题。

结论：本改动的收益是**把粗网格补拉整体挪到装载之后**，顺带压低堆峰值；装载耗时是否变快，本机测不出来。

### 未做

剩余 16 个库补 LOD 本轮未做。
