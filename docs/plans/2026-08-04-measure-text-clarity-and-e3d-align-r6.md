# 测量功能审核 r6 · 尺寸文字清晰度根因定案 + E3D 交互对齐顺序调整 · 2026-08-04

来源：本地代码复核 + dimension-kernel-demo 截图取证（DPR 1/2/3/4 三态对照）+ Oracle（GPT-5.5 Pro，browser）第二模型评审。
Oracle 会话：`measure-text-clarity-e3d-r6b`（附 8 个源码/文档 + 4 张证据图），转录见 `C:\Users\dpc\.oracle\sessions\measure-text-clarity-e3d-r6b\artifacts\transcript.md`。
上一轮：`2026-08-04-e3d-measure-interaction-align-r5.md`（E3D 交互对齐 r5，P0-1..P0-4 截至本轮仍未实施——已代码核实：无「第 1/2 步」文案、无 `MeasurementResultInspector`、无 `persistDimension`、无 `draftResult`）。

本轮主题：**用户反馈「文字绘制的还是不太清晰」**。上一版未提交的 4 方向 halo 描边尝试（`scenePainter.ts` 工作区改动）没有解决问题。本轮用 demo 页三态截图 + 布局数据探针把根因定案，并已落地一个验证性修复。

## 0. 结论

1. **文字不清晰 = 三个独立问题叠加**：① 字形笔画被角色虚线样式打断（确定 Bug，已修复）；② halo 描边是 4 份错位复制，产生重影/脏边，且制造了「尺寸线穿过文字」的假象（应整体移除）；③ GL_LINES 光栅化恒为 1 设备像素，DPR≥1.5 时笔画为亚 CSS 像素，theme.lineWidthPx 是从未被消费的假配置（结构性限制，需把批量线渲染升级为屏幕空间 stroke quad）。
2. **「尺寸线穿过文字」不成立**：`trimLineAgainstRect` 已接入全部布局类型（linear/projected/angular/radial/explicit），布局数据探针证实缺口存在且文字在缺口内。穿字观感 100% 来自 halo 错位复制——去掉 halo 后画面干净（证据见 §2 状态 C）。
3. **halo 方案应放弃**（Oracle 一致意见）：它不是实心描边而是 4 个 offset ghost，对角有缺口、黑色碎边在浅灰背景把字染脏、高 DPR 下与 1 设备像素线宽比例失衡。若未来仍要 halo，用「同几何两遍绘制（底层宽 +1.5px 实心底色）」，不用偏移复制。
4. **E3D 交互对齐 r5 计划维持有效，但顺序调整**：先做文字渲染基础修复（否则临时结果态/Inspector 上屏后依旧不像 E3D），再做 P0-1 分步提示 → P0-2 结果模型 → P0-3 临时结果态 → P0-4 Inspector。三个必须合并的点见 §6。

## 1. 根因逐条判定（Oracle 复核 + 本地证据）

| # | 假设 | 判定 | 证据 |
| - | --- | --- | --- |
| 1 | GL_LINES 恒 1 设备像素，DPR≥1.5 亚 CSS 像素灰化；lineWidthPx 未被消费 | ✅ 成立（最大结构性根因） | DPR1/2 对照：DPR2 更细更灰；代码无任何 lineWidth 消费点 |
| 2 | halo = 4 份偏移复制 → 重影非描边；对角缺口；黑边染脏 | ✅ 成立 | 状态 B 特写：字形周围 4 份黑 ghost；状态 C（去 halo）立刻干净 |
| 3 | 字形笔画被 ROLE_LINE_DASH 虚线化（external-reference/invalid/approximate） | ✅ 确定 Bug | 状态 A 特写：`~2200.00`、`STALE Ø1400.00` 笔画断裂成虚线；`visitPrimitiveSegments` glyph 分支不传 lineStyle，`dashCode()` 落回角色虚线 |
| 4 | 尺寸线未在标签矩形处截断 | ❌ 不成立 | 布局探针：demo-projected 尺寸线拆成 x 675.5→835.8 与 906.4→1066.7 两段，字形 bounds x 839.8..902.4 在缺口内；穿字观感是 #2 的 halo 假象 |
| 5 | capHeight 11.5px 偏小，文字笔画应比尺寸线略粗 | ✅ 成立 | Oracle：单线字体建议 13~14px；文字/尺寸线线宽应拆分配置 |

Oracle 补充的遗漏因素：

- **sRGB 低覆盖率灰化**：细线像素覆盖率低，经 sRGB 输出转换后视觉灰化比线性平均更明显——加宽笔画是正解，黑 halo 不是。
- **MSAA 与 shader AA 不要叠加**：stroke quad 用 fragment `smoothstep + discard(coverage)` 做 AA，保持 `transparent:false`，不进透明排序、不破坏单 draw call。
- **glyphCache key 不完整**：现为 `capHeight:rotation:text`，引入 textStrokeWidthPx / 字体版本后必须扩 key，否则缓存污染。
- **`lineWidthPx` 应拆分**为 `dimensionStrokeWidthPx` + `textStrokeWidthPx`，不要单参数。

## 2. 证据链（docs/verification/，demo 页 `public/dimension-kernel-demo.html`）

| 状态 | 代码条件 | 文件 |
| --- | --- | --- |
| A 基线 | HEAD 等效（halo 尝试 + 字形虚线 Bug） | `2026-08-04-dim-text-r6-stateA-baseline-dpr1.png`、`...-stateA-baseline-zoom-approx.png`（`~2200.00` 断裂）、`...-stateA-baseline-zoom-stale.png` |
| B 字形实线修复 | halo 保留 + glyph 强制 solid | `...-stateB-glyphsolid-halo-dpr1.png`、`...-stateB-glyphsolid-halo-zoom.png`（笔画连续但重影脏边仍在） |
| C 去 halo 预览 | 无 halo + glyph 强制 solid | `...-stateC-nohalo-dpr1.png`、`...-stateC-nohalo-dpr2.png`、`...-stateC-nohalo-zoom-approx.png`（干净；缺口清晰可见）、`...-stateC-nohalo-zoom-stale.png` |
| **D Phase 0 终态** | 去 halo + glyph solid + 字高 13 + 中文用例 | `...-phase0-dpr1.png`、`...-phase0-dpr2.png`、`...-phase0-zoom-approx.png`、`...-phase0-zoom-stale.png`、`...-phase0-zoom-cjk.png`（`中文标注 · 近似值 ±0.5` LFF CJK 渲染正常） |
| **E Phase 1 终态** | stroke quad 渲染器（文字 1.5px / 线 1.2px 真实笔画宽） | `...-phase1-dpr1.png`、`...-phase1-dpr2.png`（**DPR1/DPR2 视觉权重一致，细线灰化根除**）、`...-phase1-zoom-approx.png`、`...-phase1-zoom-stale.png`、`...-phase1-zoom-cjk.png` |

复现脚本：`scripts/capture-dimension-demo.mjs`（Playwright，DPR 1/2/3 全页 + 4 组标签特写，dev server 5173，`node scripts/capture-dimension-demo.mjs [outDir]`）。
布局探针：`tmp/inspect-projected-layout.mjs`（导出 demo-projected 的 scene/screen 图元与 labelBounds，验证截断）。

## 3. 本轮已落地（工作区，待提交）——Phase 0 全部完成

1. **P0-A 字形强制实线**：`scenePainter.ts` glyph 分支 visit 传 `'solid'`，文字永不参与角色虚线；新增回归测试「keeps glyph strokes solid for roles with dashed line styles」。
2. **0-2 移除 halo**：`LINE_HALO_COLOR`/`haloOffsets` 与 `paint()`/`updateStyles()` 中的 4 方向复制 pass 全部删除，恢复单遍绘制；`scenePainter.test.ts` 断言恢复无 halo 口径。
3. **0-3 参数调整**：`theme.ts` `textHeightPx 11.5→13`；新增 `textStrokeWidthPx:1.5` / `dimensionStrokeWidthPx:1.2`（Phase 1 stroke quad 消费的占位配置，GL_LINES 阶段不生效）；受字高影响的 `linear/explicit` 手写断言与 7 个 kernel goldens 快照已按新值更新（金标 diff 均为标签尺寸驱动：字形 bounds 变大、圆弧被标签矩形多吃一段）。
4. **0-4 金标截图与用例**：demo 页新增 CJK 文本用例（`dimensionKernelDemo.ts`）；截图脚本转正为 `scripts/capture-dimension-demo.mjs`；Phase 0 终态证据归档（§2 状态 D）。
5. 验证：`vitest run src/dimension` 50 文件 / 243 用例全通过；eslint 对全部改动文件通过（顺手修复 demo 文件一处预存在 import 顺序错误）。

## 4. 修复路线（Oracle 排序：★★★★★ = stroke quad + glyph solid；★ = halo/sprite 路线）

### Phase 0（小改动，立刻可做）——✅ 2026-08-04 已全部完成（见 §3）

| 项 | 内容 | 量级 |
| --- | --- | --- |
| 0-1 ✅ | 字形强制实线（已落地） | 一行 |
| 0-2 ✅ | **移除 halo**（4 方向复制整段删除，恢复单遍绘制） | 小 |
| 0-3 ✅ | theme 拆分：`textHeightPx 11.5→13`、新增 `textStrokeWidthPx:1.5` / `dimensionStrokeWidthPx:1.2`（Phase 0 先占位，Phase 1 消费） | 小 |
| 0-4 ✅ | 金标截图基线更新（demo 页 DPR 1/2/3 + normal/近似虚线/失效/中文 特写） | 小 |

### Phase 1（核心：batched screen-space stroke quad renderer）——✅ 2026-08-04 已实施

把 GL_LINES 批次升级为「每线段 2 三角形」的四边形批次，保持单 BufferGeometry + 单 draw call。实施与蓝图的差异点如下：

- 属性布局：`position(anchor) / offsetPx / otherAnchor / otherOffsetPx / side(±1) / strokeWidthPx / segmentT / dashCode / batchColor`（4 顶点 6 索引每线段；`ReusableGeometry` 增加 quadIndexed 模式，索引缓冲按容量预填充，drawRange 按索引数推进）。
- vertex shader：复用 `projectSceneVertex()`，投影后取两端 CSS 坐标算切向/法向，沿法向 ±strokeWidthPx/2 扩宽（乘 clip.w，与 offsetPx 同法）；远端顶点 side 取反以保持同一世界侧；退化线段（屏幕长度≈0）回退 (1,0) 方向。
- **AA 决策（与蓝图不同）**：不做 fragment 距离羽化/discard——四边形是真实三角形几何，渲染器已开 MSAA，几何边缘天然抗锯齿；`transparent:false` 保持，dash 仍用 discard。避免了 Oracle 提示的「MSAA + shader AA 双重柔化」。
- dash：沿用 segmentT/vLineDistancePx 像素距离逻辑。
- `updateStyles()` 快路径保持（颜色/dash 独立属性，每段 4 顶点）；glyphCache 仍按 `capHeight:rotation:text`（几何与笔画宽解耦，宽度是顶点属性，无需扩 key——蓝图中的扩 key 项不再需要）。
- 文字笔画 `textStrokeWidthPx`(1.5)，线 `dimensionStrokeWidthPx`(1.2)；hitRegions 与 SVG 导出（`svgOverlay` stroke-width + 字形强制实线）同步取新配置；**`lineWidthPx` 假配置已删除**。
- 接缝：字形折线相邻线段共享端点，butt cap 在 1.5px 宽下接缝不可见（DPR4 特写确认）；如未来加粗到 ≥3px 再考虑 cap 扩展。

验证：`vitest run src/dimension` 50 文件 / 244 用例全绿（新增 quad 拓扑与 text/line 笔画宽 2 个用例；7 个 goldens 因 hit 宽度 1→1.2 重生成）；eslint 通过（顺手修复 3 个布局文件预存在的 import 顺序/缩进 lint）。

### 淘汰项

8 方向 halo（★，治标染脏）、troika/MSDF（★★，违反 LFF 图元契约 + CJK 图集体积 + SVG 导出需另做）、Canvas sprite（★，破坏三维一致性与批量）、three.js Line2（★★，每尺寸一对象，不符合单批次约束）。

### 验证

- vitest：glyph dashCode=0（已加）；trim 分段（已有 `trimLineAgainstRect.test.ts`）；glyphCache key 命中/失效；stroke quad 顶点数与拓扑。
- 金标：demo 页 DPR 1/2/3 截图对比——文字无断裂/无虚线/无黑重影；label 区域尺寸线不穿过；dash 节奏连续。
- 真实场景：AvevaMarineSample BRAN `24381_145018` 距离测量落标注后近距检查标签。

## 5. 遗留观察（P2，非本轮阻塞）

- `resolveLabelCollisions` 移动标签后**不回写尺寸线截断**：原缺口留在旧位置、新位置无缺口（有 leader 线补偿）。密集标注场景可能出现移动后的标签压在别的尺寸线上。建议 Phase 1 之后评估「移动后重截断」或「标签底色矩形」方案。
- demo 页 `preserveDrawingBuffer:true` 仅为截图便利，主视口无此设置，性能不受影响。
- DPR≥8 时 demo 渲染缓冲过大导致整画布空白（10240×6400），与产品无关，截图脚本注意上限。

## 6. E3D 交互对齐：r5 计划复核结果

r5 的 P0-1..P0-4 逐项核实均未实施；计划内容维持有效。Oracle 复核结论：**与文字渲染改造不冲突，但顺序重排**：

```
Phase 0/1（本文档 §4：字形实线 → 去 halo → stroke quad）
  → r5 P0-1 分步命令提示 + Snap 目标名
  → r5 P0-2 结果模型扩展（合并点②）
  → r5 P0-3 临时结果态 + persistDimension（合并点③）
  → r5 P0-4 Result Inspector 常驻面板
```

三个必须合并的点：

1. **统一 `DimensionTextStyle`**（heightPx/strokeWidthPx/color）：canvas dimension 与 Inspector 预览共用，避免两处字体口径漂移。
2. **结果模型存显示语义**：`formattedLabel` + `displayRole`，不存裸文本，后续 CAD 风格统一才有抓手。
3. **临时结果态走同一 painter**：S3 临时结果以 temporary ScenePrimitive 进 `ThreeSceneDimensionPainter`，禁止另写 DOM overlay——否则会出现「正式尺寸清晰、临时测量模糊」的分裂。

## 7. 实施记录：E3D 交互对齐 r5 P0 落地（2026-08-04，同工作区待提交）

按 §6 顺序（渲染修复先行）完成 r5 的 P0-1..P0-4，全部走 vitest 验收（66 用例测量域全绿）：

| 项 | 实施 | 文件 |
| --- | --- | --- |
| P0-1 分步命令提示 | statusText 全部测量模式改为「第 n/m 步 选择… · Snap: <目标>」；浮动条提取分步文案并放宽 440px | `useXeokitMeasurementTools.ts`、`MeasurementOverlayBar.vue` |
| P0-1 Snap 目标名 | 新增 `measurementSnapLabel.ts`：`formatMeasurementSnapLabel`（label→noun→formatPdmsRef 优先级，`VALVE 100-A` 口径）+ refno→noun 异步缓存（动态 import e3d API，避免测量链路静态背 DuckDB-WASM）；hover 命中即预取 noun | `measurementSnapLabel.ts`（新）、`useXeokitMeasurementTools.ts` hover 链 |
| P0-2 结果模型 | `computeDistanceMeasurementResult`：distance + offsets(wrt World=ENU 分量) + direction 单位向量占位 + wrt:'world'；store 新增 `MeasurementDraftResult` | `xeokitMeasurementFormat.ts`、`useToolStore.ts` |
| P0-3 临时结果态 | 第二击恒产出 draftResult；`persistDimension=false` 时不落持久记录（连续测量/Repeat 兼容临时结果终点续测）；`persistDraftResult()` 显式落地；ESC 语义分层（草稿→临时结果→退出）；style store V6→V7 迁移默认 true | `useXeokitMeasurementTools.ts`、`useXeokitMeasurementStyleStore.ts` |
| P0-4 Result Inspector | 新增 `MeasurementResultInspector.vue`（距离主值/Offset(wrt World)/Direction 占位/起终点 Snap 标签/wrt World 只读/☑ 生成线性标注/落地标注按钮），挂测量面板顶部 | `MeasurementResultInspector.vue`（新）、`XeokitMeasurementPanel.vue` |

r5 §5 五个 vitest 验收点对应用例全部落地：snap label formatter、statusText 步骤、draftResult 存在性与记录数、Repeat 以 draftResult.target 续测、V7 迁移 persistDimension 默认 true。

实施决策记录：

- Inspector 挂在现有「measurement」dock 面板顶部而非新开 dock（避免 DockLayout/ribbon churn）；是否在进入测量模式时自动弹出面板留待人工验收后定。
- 全仓 vitest 有 45 个预存在失败（网络/DuckDB/评审后端类环境依赖，stash 对照确认与本轮无关）；测量域 7 文件 66 用例全绿。
- Direction 显示格式与 Offset 两行构成仍按 r5 §6 等 E3D 实机验证，内部模型已就位。

## 8. 实施记录：渲染收尾（2026-08-04，同工作区待提交）

1. **文字颜色与尺寸线拆分**：theme 新增 `textColors`（角色可选覆盖，未配置角色回落 `colors`）；`normal`/`external` 标签文字用 `#111827` 深色（浅背景可读性），`approximate`（粉）/`invalid`（琥珀）/`external-reference` 及 hovered/selected 交互高亮保持语义色。painter（paint/updateStyles 统一 `createColorResolver(styleRole, textStroke)`）与 SVG 导出同步。证据：`docs/verification/2026-08-04-dim-text-r6-polish-*.png`。
2. **测量模式自动打开测量面板**：`MeasurementOverlayBar` 在测量模式激活时 `ensurePanelAndActivate('measurement')`（E3D「窗体随命令打开」口径，Result Inspector 常驻可见）。
3. 暂缓项与理由：per-DPR 笔画微调（stroke quad 的 CSS px 宽度天然 DPR 无关，现有截图无证据需要）；标签移动后重截断（需改 resolveLabelCollisions 的图元拓扑，破坏 updateStyles 快路径不变量，单独一轮设计，维持 §5 P2）。
4. 验证：`vitest run src/dimension` + 浮动条/面板测试 52 文件 253 用例全绿（新增 文字色/自动开面板 断言）；eslint 通过。

## 8.1 实施记录：测量 hover 线框描边 + 关键点显示（2026-08-04 追加，同工作区待提交）

用户诉求：「测量时 hover 的模型能显示线框描边，以及关键点的显示」。

1. **hover 构件线框描边**：`useXeokitMeasurementTools` 新增独立 `DTXOverlayHighlighter`（edges-only，天蓝 0x38bdf8），挂 `syncMeasurementVisualAssists` hover 链；objectIds 经 `resolveDtxObjectIdsByRefno` 解析，缺 dbnum 时回落 `o:<refno>:` 前缀扫描；模式退出/清理时同步清空。
2. **关键点显示三连修**（实机逐层排查出的真实断点）：
   - `db_meta_info.json` 缺失（本部署 404）时 `getDbnumByRefno` 抛错导致 P-Point 拉取**静默中止** → 改为 dbno=0 回落直连后端 ptset API（接口本不依赖 dbno）。
   - 按 BRAN 整体加载的部署里 hover refno 是 BRAN 根（自身无 P-Point）→ 新增**直属子构件回落**（`/api/pdms/ptset/children/`），成员点集登记显示 + 进吸附索引（该部署模式下 P-Point 捕捉因此可用）。
   - `usePtsetVisualizationThree` 标记尺寸把「场景米」当「点空间单位」用：后端 API（mm、factor=1）数据源下十字只有亚像素大小 → 按 `group.matrix`（gm）缩放归一（parquet 米制流行为不变）。
3. Snap 目标名增强：元素类型优先取已加载 DTX 缓存（`resolveDtxNounByRefno`，同步、离线可用），异步 e3d 查询作为兜底。
4. 验证：vitest 27/27（新增 hover 描边、子构件回落 2 个端到端用例）；实机截图 `docs/verification/2026-08-04-measure-hover-outline-keypoints-*.png`（蓝色整分支线框 + 绿色成员 P-Point 十字同屏）。

## 9. 实机验收记录（2026-08-04，AvevaMarineSample BRAN `24381_145018`）

环境：本机后端 `web_server.exe --config db_options/DbOption-ams7997-zone-verify`（:3100）+ SurrealDB rocksdb（:8035，`D:/backup-dbs/ams7997-e3d31-verify-v2.db`）+ vite dev（:5173）。
执行：Playwright 用户级操作流 `tmp/accept-measure-flow.mjs`（真实鼠标事件，浮动条状态文案作为断言信号）。

| 验收点 | 结果 | 证据（docs/verification/） |
| --- | --- | --- |
| 分步命令提示（第 1/2 步 → 第 2/2 步） | ✅ 浮动条与面板同步显示 | `2026-08-04-e3d-p0-accept-hover-snap.png` |
| Snap 目标名 | ✅ E3D 模式空闲显示「等待捕捉（P-Point / Item 原点）」，hover 命中显示点源名 | 同上 |
| 面板随命令自动打开 + Result Inspector | ✅（修复一处：dock「measurement」面板实际渲染 `MeasurementPanel.vue`，Inspector 已同时挂入该面板） | `2026-08-04-e3d-p0-accept-inspector.png` |
| 结果解读（距离/Offset(wrt World)/起终点/近似徽标） | ✅ `4205mm 近似 · E +1820mm · N +2687mm · U +2674mm · 模型表面点 → 模型表面点` | 同上 |
| 生成线性标注开关 → 临时结果 → 落地标注 | ✅ 关闭后第二击不落记录（列表保持 1 条）、Inspector 出临时结果与「落地标注」按钮；点击后列表 2 条、按钮变「已生成标注」 | `...-accept-temp-result.png`、`...-accept-persist-now.png` |
| 空格 Repeat | ✅ 以上一结果终点直接进入第 2/2 步 | `...-accept-repeat.png` |
| ESC 分层 | ✅ 草稿 → 临时结果 → 第三次 ESC 退出测量模式（浮动条消失） | tmp/accept/09-after-esc.png |
| 深色标签（真实模型 canvas dimension） | ✅ 尺寸文字深色、尺寸线品红 | `...-accept-inspector.png` 视口中央 |

备注：验收流用「自由表面」模式保证盲点击可落点；P-Point 捕捉链路此前轮次已验证（artifacts/ptset-measurement-24381_145018-browser.png）。临时结果段两击落在同一表面点产生 0mm 结果，为脚本盲点击产物、非缺陷。

## 10. 下轮输入

1. ~~Phase 0 / Phase 1 / E3D P0 / 渲染收尾~~ ✅ 全部实施并通过实机验收（§3/§4/§7/§8/§9）。
2. 待办候选：标签移动后重截断（§5 P2）、r5 §6 E3D 实机验证项（Offs. 两行构成、Dire. 显示格式、ESC 层级、非 World wrt 符号约定）→ 验证后落 Direction 显示格式与非 World wrt（P1/P2）。
3. 工作区待提交：渲染两阶段+收尾（dimension 链路）与 E3D P0（测量链路）建议分组提交。
