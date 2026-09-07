# MBD 三维尺寸标注审核复核与呈现层修复

日期：2026-07-30
性质：独立复核 + 两处呈现层修复（含代码变更）
前序：`docs/plans/2026-07-29-mbd-dimension-annotation-capability-audit.md`
参照基准：`rs-core/MBD/markpipe`（PML 需求事实源）· `rs-mbd`（算法与冻结 V2 契约）· `plant-web-server`（宿主 API）· 本仓尺寸标注系统

## 0. 与 7-29 报告的关系

7-29 报告的两条主结论仍然成立：呈现层架构性就绪、端到端尚不满足，且差距重心在上游。本文只记录三件它没有覆盖或已经过时的事：

1. 两条既有结论（G4、G6）已被代码推翻，需要作废。
2. 五项属于本仓的新差距，其中一项 7-29 的图元矩阵判成了「✅ 完整映射」。
3. 本轮实际落地的五处修复与三条决策记录。

## 1. 需要作废的既有结论

### G4「`/api/mbd/v2/pipe/{refno}` 为占位实现，未接 solver」——不成立

`plant-web-server/src/standalone_runtime.rs`（2026-07-29 14:13）里 `mbd_v2_pipe_route` 已是真实链路：

```
PipelineQueryService::fetch_branch_segments (SurrealDB)
  → pipeline_segments_to_branch_query
  → rs_mbd::layout_branch
  → MbdV2PipeData JSON
```

并带结构化错误码 `MBD_DATA_SOURCE_UNAVAILABLE` / `MBD_BRANCH_NOT_FOUND` / `MBD_BRANCH_DATA_INVALID` / `MBD_LAYOUT_FAILED`，另有「linear MVP 未产出可靠线性尺寸」的 422 分支。

7-29 引用的那句 `full MBD pipe semantics still require the model-core adapter` 在 `standalone_services.rs` 的 `mbd_pipe()` 里，服务的是 **v1** `/api/mbd/pipe/{refno}`，前端 V2 通道并不走它。

### G6「`DIMENSION_V2_CUTOVER` 关闭，作为生产安全网」——不成立

`src/` 下已经搜不到 `DIMENSION_V2_CUTOVER` 或 `dimension_demo`。`ViewerPanel.vue` 的 `initializeDimensionViewport()` 在 `onMounted` 和 review 任务 watcher 里无条件创建尺寸系统，`syncMbdExternalDimensions` 只要 URL 带 `mbd_refno` 或 `show_dbnum` 就会拉取 MBD。

**这条的影响不只是文档过时**：下面的差距都是线上可见的，没有开关挡着。

## 2. 本仓的新增差距

### N1 外部尺寸文字被自己的尺寸线划穿（本轮已修，见 §3.1）

rs-mbd `layout.rs::make_linear_primitive` 对非 `small` 尺寸把 `label_anchor` 放在尺寸线中点（金样 `fixtures/golden/24381_145018.json` 的 label_anchor 正是 start/end 中点）。而 `layoutExplicit` 画整条 `start→end` 尺寸线、把字形居中放在 label_anchor，且没有原生 `layoutLinearBetween` 那样的 `trimLineAgainstRotatedRect` 断线。结果是每条普通 MBD 尺寸的数字都被线穿过。`slope_mark` 同理——它的文本锚点也是线段中点。

### N2 外部文字没有朝向（本轮打通通道并修好尺寸文字，见 §3.6）

PML 侧文字朝向是一等公民：`lindim(gro, dimpos, textori, poss, cheight, ...)` 和 `aidtext(gro, pos, ori, text, cheight, function, node)` 都吃模型空间 `ori`，`isoori` 把 `pipedir` / `dimdir` / `chardir` / `ori` 成套解出来。

审核时两侧都缺：V2 契约无朝向字段；`ExplicitTextInput` 与 `layoutExplicit` 也没有 rotation 入参，`sceneGlyph` 走默认 0，所以全部 MBD 文字一律屏幕水平。内核本身具备能力——原生线性尺寸用 `engineeringTextRotation` 沿线排布并翻转到可读方向——缺的只是把通道打通。本轮已打通通道，并修好了可从几何推导朝向的线性尺寸；标签/辅助文字仍等契约字段。

7-29 图元矩阵把 `linear_dim` / `aid_text` / `label` 标为「✅ 完整映射」，遗漏了这一项。

### N3 几何用 mm、文字用 px，两套单位混在同一张图上

ADR 0044 记录的代价是「验收前无法与 PDMS 比对文字尺寸」。实际代价更大：

| 来源 | 量纲 | 当前值 |
| --- | --- | --- |
| 首层偏移 | 模型 mm | `MEMBER_OFFSET_MM = 500` |
| 层间距 | 模型 mm | `STACK_STEP_MM = 800` |
| 箭头 | 模型 mm | `ARROW_LENGTH_MM = 24`，半宽 7 |
| 字高 | 屏幕 px | `textHeightPx = 11.5`（恒定） |

solver 是按毫米预留间距的（PML 更明确：`od + cheight * 1.2 * (dimtimes - 1)`，偏移语义里含管径和层级），而文字不随视距缩放。于是：视距拉远时 500mm 塌成几个像素、文字不缩，多层尺寸叠成一坨；拉近时 24mm 箭头远大于文字。**后端「无重叠」的排版保证只在某一个特定视距成立。**

复审时对这一条的定性做了修正：解法不是把文字改成世界尺度（那与本仓「三维尺寸呈现保持稳定屏幕视觉尺度」的领域定义相冲突），而是把箭头这类纯呈现的毫米几何改成屏幕尺度，见 §3.5 与决策 D3。剩下的毫米量（偏移与层间距）是排版语义，本来就该活在设计空间。

### N4 前端避让与 solver 的确定性排版冲突

`mbdV2ExternalAnnotations.explicitRecord` 设 `labelPinned: category !== 'dimension'`：

- dimension 类（`linear_dim`）→ 未固定，进 `resolveLabelCollisions`，最多被平移 72px（9 次探测 × 8px 步长）并自动注入一条引线；
- annotation 类（`label` / `aid_text` / `weld_mark` / `slope_mark`）→ 固定，成为不可移动的障碍物去挤尺寸标签，且它们彼此之间的重叠永远不会被解决。

`layoutViewport` 对所有布局无条件调用 `resolveLabelCollisions`，没有按来源豁免。而 rs-mbd `CONTEXT.md` 明确写了「确定性布局」，`label_anchor` 是权威值。被废弃的 `mbdToExternalDimensions` 当初用的是 `labelPinned: true`，所以这是 V2 路径引入的行为变化。

7-29 把「标签避让未移植」记为 rs-mbd 的 G3，没有指出前端已经在跑自己那一套——等上游 Polar 避让落地，会是两套系统互相抵消。

### N5 空标签在避让网格里占位（复审时发现，本轮已修，见 §3.4）

`weld_mark` / `leader_line` / `aid_line` / `aid_point` 映射出的记录 `formattedLabel` 是空串。`font.getWidth('')` 返回 0，但 `getHeight` 与文本无关，再经 `expandRect(bounds, 4)` 一扩，每个空标签都变成约 8 × (字高+8) 像素的矩形。它们因为是 annotation 类而被 `labelPinned: true`，于是被无条件插入 `LabelOccupancy`——成为一批看不见的障碍物，把真实的尺寸标签推来推去。焊缝密集的分支受影响最明显。

## 3. 本轮代码变更

### 3.1 断开尺寸线让开标签（修 N1）

`src/dimension/kernel/layout/explicit.ts`：

- 新增 `labelClearance()`：先把 `labelAnchor` 投影一次，用 `makeCenteredGlyphRun` 求标签包围盒并按 `labelPaddingPx / 2` 外扩。标签为空、或压根没有 `part === 'dimension'` 的线时返回 null，不付这次投影的代价。
- 新增 `explicitSceneLines()`：只对 `dimension` 部位的线做剪裁（§3.6 之后走 `trimLineAgainstRotatedRect`，以便跟随标签旋转）；剪出的段端点用 `sceneVertexAtScreen` 回推到原线上的 design 锚点，所以断开的两截仍是真正的三维图元。标签本来就不压线时走原路径返回完整线段，不引入 offsetPx 噪声。
- extension / leader / arc 一律不动，`aid_line`、`leader_line` 等无文字图元行为不变。

回归：新增用例 `breaks the dimension line around a label anchored on it` 断言标签压线时尺寸线被拆成两段、两端终点不变、缺口落在字形包围盒两侧。`explicit-annotation` 金样快照未变（它用的是 leader / extension 线）。

已知取舍：`explicit.test.ts` 的 `project` 调用次数断言从 5 改为 8（标签探测 1 次 + 线端点 2 次）。这与 `linear.ts` 原生路径的开销模型一致，且只对「有文字且有尺寸线」的记录生效，对 ADR 0018 的 500 条可见尺寸目标影响可忽略。

### 3.2 让整包拒收的理由可定位（不改 ADR 0046）

ADR 0046 要求「输出可定位诊断」，但实现做不到：上游一旦发出 `angle_dim`，`parseMbdV2PipeData` 在解析层就报 `MBD V2 payload has invalid primitive at index 7`，不含 kind 和 id，读起来像后端发了脏数据；映射层那句写得很好的 `contract-incomplete: ...` 是死代码，实时通道永远走不到。

`src/dimension/adapters/mbdV2Contract.ts`：

- `CONTRACT_INCOMPLETE_KINDS`（`angle_dim` / `aid_arc` / `aid_circle`）单独给话术：`MBD V2 payload rejected: primitive angle_dim "<id>" has no geometry in the frozen V2 contract, so this branch cannot be rendered completely`。
- 真正的格式错误报 `MBD V2 payload has an invalid primitive linear_dim "<id>"`。
- issue 非法时同样报出 issue id 而不是数组下标。

**策略本身没有改**：仍然整包拒收、仍然清空 MBD 来源，ADR 0046 不动。改的只是用户能否分清「后端数据坏了」和「上游开始发新图元而前端还没接」。

回归：原拒收用例从只断言 `ok: false` 加强到断言理由含 kind、id 和 "frozen V2 contract"；另加一条用例覆盖格式错误与非法 issue 的命名。

### 3.3 显性化「本分支标注不完整」（D1 第一步）

ADR 0046 担心的「用户误判标注已经完整」今天**已经在发生，而且现行规则拦不住**：rs-mbd 只产出线性尺寸，weld / slope / tag / bend 全部未移植，这种大面积缺失不产生任何 issue，一声不响就渲染出来了。规则只在「出现一个无几何的 kind」这一个窄触发点上生效，代价却是整条分支变空白。

信号其实一直在负载里——`meta.layout_mode = "linear_mvp"`、`meta.notes`——只是从来没被显示过。本轮把它接了出来：

- `useMbdDiagnosticsStore` 快照新增 `layoutMode` / `notes`（更新入参里为可选，既有调用点不受影响）。
- `useMbdExternalSync` 成功路径写入 `payload.meta.layout_mode` 与 `payload.meta.notes`。
- `DimensionPanelDock.vue` 在诊断折叠区**之外**加一条常驻警示条「本分支标注不完整」，说明求解器以哪个模式产出、未产出的类别不会出现在诊断里；折叠区内另列「求解器自报」的模式与 notes。

判定用的 `PARTIAL_LAYOUT_MODES = ['linear_mvp']` 是**临时兜底**：契约还没有「本次交付覆盖哪些图元类别」的显式声明，这个清单是它到位之前的替代品，代码注释里写明了这一点。

**策略未变**，ADR 0046 不动。这一步只是把「不完整」这件事变得看得见——它到位之后，D1 的降级方案才不再是 ADR 当初否决的那个「无提示的工程信息缺失」。

### 3.4 空标签不再参与避让（修 N5，D2 第一步）

`resolveLabelCollisions` 新增 `hasLabelText()` 前置判断：`derived.formattedLabel` 为空的布局既不插入占位网格、也不参与移动。

`labelPinned` 本身**维持 false**。rs-mbd 尚未移植 Polar 避让（7-29 的 G3），它的 label 位置就是个朴素中点、层间固定 800mm，根本没做避让；前端 declutter 目前是全系统唯一的避让机制，现在固定住只会得到一堆重叠文字。等上游真发出避让后的结果再翻回 true。

### 3.5 屏幕尺度箭头（D3）

不做默认世界字高——本仓 CONTEXT 对「三维尺寸呈现」的定义就是「保持稳定的屏幕视觉尺度」，把 MBD 文字改成世界尺度是在和自己的领域词汇对着干；ADR 0044 把世界字高定位为出图验收的可选模式，这个定位是对的。

真正刺眼的是箭头：契约以 24mm 长、±7mm 半宽的模型几何发 `arrow_lines`，8.4m 的分支铺满屏幕时箭头约 3px，而文字恒定 11.5px。改法是让内核合成屏幕尺度的实心箭头：

- `ExplicitArrowInput`（`tip` / `towards` / 可选 `outside`）加入 `ExplicitLayoutInput`；`layoutExplicit` 投影 tip 与参考点求屏幕方向，复用原生线性尺寸一直在用的 `makeFilledSceneArrow`。
- `mapLinearDim` 改为发 `arrows` 而不再透传 `arrow_lines`，并用 `sub_kind === 'small'` 还原 solver 的箭头外指选择（rs-mbd 对小于 120mm 的尺寸把箭头翻到外侧）。

箭头是纯呈现、不是排版语义，所以这不算前端重新发明版面。剩下的 mm 量（偏移与层间距）本来就该活在设计空间。

### 3.6 打通文字朝向通道（N2 第一步）

内核侧的通道以**设计空间基线方向**表达，而不是屏幕角度——屏幕角度随视角变化，不该出现在与视角无关的契约里：

- `ExplicitLayoutInput.labelAlong` 与 `ExplicitTextInput.along`（都可选，`Vec3`）。
- `layoutExplicit` 投影 `anchor` 与 `anchor + along` 求屏幕方向，交给现成的 `engineeringTextRotation` 翻进可读半周；缺省 0，即维持视口水平。
- 标签一旦旋转，断线也要跟着转：`labelClearance` 现在返回未旋转矩形 + 旋转中心 + 角度，`explicitSceneLines` 改用 `trimLineAgainstRotatedRect`（角度为 0 时它自动退化成原路径，无行为变化）。旋转后的包围盒更贴合文字，斜向尺寸的缺口明显更小。

`mapLinearDim` 顺带用上了它：**线性尺寸的 `labelAlong` 就是尺寸线本身**（`end - start`），不需要任何猜测。本仓 CONTEXT 对「工程文字朝向」的定义是「尺寸值沿尺寸线方向排布并自动翻转到可读方向」，所以此前 MBD 尺寸文字一律水平其实是不符合自家领域定义的，这是修正而非发明版面。

`label` / `aid_text` / `slope_mark` 的朝向来自 PML 的 `ori`，无法从几何推导，**保持视口水平**直到契约提供字段。这也是 rs-mbd 侧要补的那个字段。

### 3.7 验证

`npx vitest run src/dimension src/composables/useMbdExternalSync.test.ts` → 51 个文件 **250 个用例全绿**（原 232，新增 18 项覆盖断线、空标签避让、实心箭头、文字朝向与旋转断线、不完整警示条与拒收理由命名）。改动未引入任何新的 ESLint 错误；模块内残留的 12 条 `import-x/order` / `indent` 分布在 `sceneGeometry.ts`、`angular.ts`、`linear.ts`、`radial.ts`、`dimensionViewport.*`、`scenePainter.test.ts` 等未改动文件上，属仓内既存状态，`explicit.ts` 保持与兄弟文件同样的导入顺序未单独校正。

## 4. 决策记录

| # | 议题 | 结论 |
| --- | --- | --- |
| D1 | 契约已命名但无几何的 kind 到达时，整包拒收还是降级显示 | **分两步**。第一步（本轮已做）显性化不完整信号；第二步待契约给出显式的类别覆盖声明后，再修订 ADR 0046 允许降级。在此之前维持整包拒收 |
| D2 | MBD dimension 记录是否改回 `labelPinned: true` | **维持 false**，先修 N5。翻转的触发条件：rs-mbd 发出经过避让的排版结果 |
| D3 | 是否实现世界字高模式（N3） | **不做默认**。改为屏幕尺度箭头（本轮已做）；世界字高保留为 PDMS 1:1 验收的可选模式，按 ADR 0044 原定位 |

## 5. 待上游补齐的字段

本仓这一侧能做的已经做完，下面三项都要 rs-mbd 契约先动：

1. **文字朝向**——`label` / `aid_text` / `slope_mark` 需要 PML `ori` 对应的设计空间基线方向。本仓 `labelAlong` / `along` 通道已就绪，契约给了就能直接用（N2 第二步）。
2. **类别覆盖声明**——「本次交付覆盖哪些图元类别」的显式字段，让前端硬编码的 `PARTIAL_LAYOUT_MODES` 退休，同时解锁 D1 第二步。
3. **角度/弧几何字段**（7-29 的 G1）——`AIDARC` 的 pos / ori / radius / stangle / sweepAngle 与本仓 `ExplicitArcInput` 一一对应，补齐后 D1 这个取舍自然消失。

另需一次**真实 BRAN 视觉审阅**：裁决 G9（坡度符号 PML 画三角形、Web 画线+箭头），并复核本轮四处呈现改动的实际观感。

## 6. 相关文档

- 本仓：ADR 0018 / 0041 / 0042 / 0043 / 0044 / 0046 / 0048；`docs/plans/2026-07-29-mbd-dimension-annotation-capability-audit.md`
- rs-mbd：`CONTEXT.md`（确定性布局、语义对齐、MBD 标注交付物）、`crates/rs-mbd/src/layout.rs`、`fixtures/golden/24381_145018.json`
- 需求事实源：`rs-core/MBD/markpipe/object/isoDim.pmlobj`、`isoline.pmlobj`、`isoori.pmlobj`
