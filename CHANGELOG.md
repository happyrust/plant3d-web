# 更新日志

## [未发布]

### 变更

- **房间层级树的直段行长出逐段眼睛（方案 B · T4，D5 (ii)）：只显 / 隐场景里那一段直管，对象级、不进 refno 状态；服务端 gen-model-model-cache ≥ `6ad84ca80`（`model/records` 记录一级的 `tube{ordinal, from, to}`）** (2026-09-22，ADR 0068 追记 ③)
  - 身份对上：`GeomInstQuery.tube?`（`genModelV1Api.ts`）→ `instanceMapping.tubeIdentityOf` 折进直管实例的 `uniforms.tube`（两端归一 `a_b`）→ `useDbnoInstancesDtxLoader` 登记 `tubeKey(BRAN, 段) → objectId`（`tubeObjectIdByKey` / 反向表，替换 / 回滚一起收）；`resolveDtxTubeObjectIdsByKeys` / `isDtxTubeSegmentLoadedAcrossAllDbnos` 跨库可查。与树里直段行的 `tubeKey` 是同一个键（服务端 T2 保证记录与树同一四元组）。
  - 对象级显隐：`DtxCompatScene.setTubeSegmentsVisible(keys, visible)` 按键只动那一个直管对象、回真正作用到的键，`isTubeSegmentVisible(key)` 读回；逐段隐藏记在 `dtxHiddenTubeKeys`（对象级覆盖表，`markDtxTubeSegmentsHidden` / `clearDtxTubeSegmentOverrides`），**不进 `objects` 的 refno 状态表**。`setObjectsVisible(refnos)` 与 `applyStateToRefnos` 真写了显隐的 refno 会按 BRAN 前缀清掉这层覆盖——refno 级动作仍是权威、整条覆盖。对象没装进场景就什么都不做、不记（没有「未加载先记下再回放」：那会与加载后 `setObjectsVisible(BRAN, true)` 打架）。
  - 抽屉（`SpatialResultTreeTubes.vue`）：直段行多一颗眼睛 `spatial-tree-tube-visibility`（三态：可见 / 单独藏起来 EyeOff + 行文字变灰 / 未装进场景画淡），`data-tube-loaded` / `data-tube-hidden` 供 e2e；`useSpatialQuery.toggleTreeTubeVisible` 回 `'applied' | 'tube-not-loaded' | 'unsupported'`，抽屉对 `tube-not-loaded` 提示「先对所属 BRAN 单元加载」。`useSceneGraphOps.setTubeSegmentsVisible` 直通（不合批）。
  - 房间页签：`tube` 节点不再只读（`ModelTreeRow.readOnly` 退役，`rowTitle` 留着），眼睛走 `useRoomTree.setVisible` 的直段分支（`setTubeSegmentsVisible`，回 `'tube-not-loaded'` 时 `RoomTreePanel` 提示）；勾选态先看覆盖表再看勾选表（`checkStateOf`），抽屉里藏起来的段页签里同样是暗的，藏一段后所属单元 / 祖先变半选；右键多「显示 / 隐藏」（逐段），隔离 / 加载仍是单元级；`isTubeSegmentLoaded(id)`、`RoomTreeOptions.tubeSegmentHidden / tubeSegmentLoaded` 注桩。
  - 验证：vitest `instanceMapping` +1 / `useDbnoInstancesDtxLoader` +1 / `DtxCompatViewer` +1 / `useSpatialQuery` +1 / `SpatialResultTree` 扩 1 / `useRoomTree` 扩 1 → 11 文件 176 过；type-check 新增 0；eslint 触及文件 0 错误；e2e 两份直段 spec 各扩一段（未加载点眼睛提示 → 单元加载 → 点眼睛 `scene.isTubeSegmentVisible=false`、所属 BRAN 的 refno 状态不动、别的段不受影响 → 单元级仅显示 / 眼睛整条覆盖并清掉逐段隐藏），账见 `docs/verification/spatial-room-hierarchy-tree-2026-09-20/README.md` §12。教程 §6.1「逐段眼睛」、ADR 0068 追记 ③、CONTEXT「直段行」、小计划状态改口。

- **房间层级树里列出直段（方案 B · T3 前端）：BRAN 单元下多一组只读直段行、各层计数句带「M 段直管」，抽屉与模型树「房间」页签同步；服务端 gen-model-model-cache ≥ `2aab735df`（`tubes=1`）** (2026-09-22，ADR 0068 追记 ②；小计划 `docs/plans/2026-09-21-room-tree-tube-segments-plan.md` D1–D7 全按推荐)
  - 起因：方案 A（09-21）只让三维里「管件带着直段走」，树上和计数里仍没有直段——直管没有 refno、不进空间索引。现在两条树请求恒带 `tubes=1`（老服务端不认就一切照旧），服务端折完管件后按树里出现的 BRAN 单元补它落在范围内、属于该房间的直段。
  - 抽屉树态（`SpatialResultTree.vue` + 新 `SpatialResultTreeTubes.vue`）：BRAN 单元展开后构件行之后列直段行「直管 · REDU → BEND · 141 mm」（无效直管「无效」小标、跨房「跨 N 房」；两端 refno / 距离 / 序号进 `title`），单元行尾「N 段直管」，房间 / 专业 / 单元类型 / 单元的 `title` 计数句改成「N 个构件 · M 段直管」，摘要「共 N 项（去重）· M 段直管 · K 间房」。计数格仍是构件数；直段不进「共 N 项」、不进复制 Refno / 加载的集合。直段行没有眼睛（D5 (i)）：点整行 / 箭头 = 选中所属 BRAN（`useSpatialQuery.focusTreeTube`：全局选中 + 查看器高亮 + 相机按服务端直段盒 mm → 场景坐标飞过去，不加载）。
  - 房间页签（`roomTreeNodes.ts` / `useRoomTree.ts` / `RoomTreePanel.vue`）：节点模型多 `tube` 节点（`tube:<房>:<单元>#<from>-<to>#<ordinal>`，`type: 'TUBI'`、名字「REDU → BEND · 141 mm」、没有 refno、`count: 0`），`ModelTreeRow` 多 `readOnly` / `rowTitle`（不画眼睛）；`refnosUnder` / `branUnitRefnosUnder` / `pendingLeafNodesUnder` 跳过它，眼睛对它无效；点行回所属 BRAN 的 refno、场景里选中 BRAN；聚焦按直段盒飞、不要求加载；右键只有「聚焦飞行 / 查看属性」；房间行与单元行的名字带「· M 段直管」。方案 A 的单元级动作一个不改。
  - 类型 / 端口 / 纯函数：`genModelV1Api.ts` `SpatialTreeTube` + 各层 `tube_count?` + `total_tube_count?` / `tubes_truncated?`；`genModelSpatialApi.ts` `SpatialTreeTubeNode` 同形；`spatialSource.ts` 映射（两端 refno 归一 `a_b`，没给的层不写）；`spatialTree.ts` 新 `tubeKey` / `tubeLabel` / `formatTubeLength` / `countPhrase` / `treeNodeTubes`，`mergeTreeLeaves` 补叶子时连 `tubes` 一起并。
  - 验证：vitest `spatialTree` +3 / `SpatialResultTree` +1 / `roomTreeNodes` +1 / `useRoomTree` +1 / `spatialSource` 扩 1 → 11 文件 163 过；type-check 新增 0；eslint 触及文件 0 错误；e2e 两份 spec 各 +1（抽屉：`nearby/tree` 带 `tubes=1`、直段行数 = 响应该单元 `tubes.length`、无效小标、摘要、点行选中 BRAN；房间页签：`rooms/{refno}/tree` 带 `tubes=1`、TUBI 行数 = 响应、只读无按钮、点行选中 BRAN、右键两项）同机 `--workers=1` **15 passed / 1 skipped**；真机 `:3111` + `:8027`（`2aab735df`）四步截图与账见 `docs/verification/spatial-room-hierarchy-tree-2026-09-20/README.md` §11。教程 §6.1「树里也列直段」+ §9 TUBI 行改口、ADR 0068 追记 ②、CONTEXT「直段行」。

- **批注处理状态拉取（`syncAnnotationReviewStates`）同参在飞合并 + 1.2 s 短窗复用：校审面板一进页对同一单据不再连发 10 次 `GET /api/review/annotation-states`** (2026-09-22)
  - 真机：JH 打开嵌入页，`ReviewPanel` 几个 watch（聚焦单据 / 当前任务 / 已确认记录恢复完）各自触发，1.3 s 内对同一 `form_id` 发了 10 次同参 GET（+845 / +1236 / +1238 / +1277 / +1759 / +1771 / +1789 / +1944 / +1954 / +2122 ms），回包一模一样。现在 `useAnnotationReviewStateSync.ts` 按 `form_id|task_id` 记一张表：同 key 还在飞就共用那份 promise；成功回包后 `ANNOTATION_REVIEW_STATES_FRESH_WINDOW_MS`（1200 ms）内同参再调直接复用；失败（抛错 / `success=false`）不进窗、下一次照常重发；`force: true` 绕开。只合并「取回包」，写 store 仍由每个调用方按自己的 U0 `shouldApply` 各自决定。
  - 新导出 `invalidateAnnotationReviewStatesCache(formId?)`：`ReviewCommentsTimeline` 提交处理动作（`annotation-states/apply`）成功后调一次，作废该单据的窗，免得面板紧接着 sync 把旧回包写回去、盖掉刚提交的状态。
  - 验证：vitest `useAnnotationReviewStateSync.test.ts` 5 过（新增 3：并发只发一次且各按守卫写 / 窗内复用、换 taskId 与 force 重发、窗外重发 / 失败不进窗与 invalidate 重发）；`src/components/review` 45 文件 469 过；eslint 三文件 0；type-check 新增 0。真机（本地 build 拦截换包，9446）：JH 侧 10 → **2** 次（+1053 / +2761 ms，第二次在窗外是后续 watch 正常再拉），SJ 侧 1 次，两侧行状态「已同意」与统计条「共 2 · 待处理 0 · 已处理 0 · 已通过 2」不变。

- **批注表格统计条改三颗药丸（待处理 / 已处理 / 已通过，相加 = 共 N）；设计侧「批注处理」面板打开时也拉一次批注处理状态，不再把已同意的批注全显示成「待处理」** (2026-09-22，09-21 真手画 TC-3 暴露的 §5.1 第 4 条 + 09-22 复验时发现的 4b)
  - 统计条原来只统 `pending` / `fixed`，已同意 / 已驳回 / 不需解决 哪都不进，终态两条都「已同意」时显示「待处理 0 · 已处理 0」。现在 `AnnotationTableView` 复用 `buildAnnotationWorkspaceSummary`（设计面板五张卡同一份计数），口径同 `isAnnotationActionableForRole`：待处理 = pending + rejected（要设计动手）、已处理 = fixed + wont_fix（设计已处理、等校核定）、已通过 = approved；三颗药丸各带 `data-testid="annotation-table-summary-{pending,handled,approved}"`。
  - `DesignerCommentHandlingPanel` 之前从不请求 `annotation-states`（只有 `ReviewPanel` 调 `syncAnnotationReviewStates`，点开某条详情时 `ReviewCommentsTimeline` 才单条拉），设计侧整页看到的都是本地默认的「待处理」、「已修改 / 不需解决」按钮照样可点。现在聚焦单据 / 当前任务一变就拉一次：外部 PMS 嵌入按 form 维度（SJ / JH 内部 taskId 可能不同），内部任务且单据一致时带 taskId；带 U0 回执守卫，请求期间切了任务不写。
  - 验证：vitest `AnnotationTableView.test.ts` 39 过（新增 1b 三药丸相加）、`DesignerCommentHandlingPanel.test.ts` 19 过（新增 2：打开即拉 + 任务切换再拉 / 外部嵌入不带 taskId）、`src/components/review` 全部 44 文件 464 过；eslint 四文件 0；type-check 新增 0。真机：本地 build 用「拦截换包」在 9446 headless 上跑 SJ / JH 两侧（`FORM-CB658BB5921A`，服务端两条均 fixed/agreed）——修前 JH「共 2 · 待处理 0 · 已处理 0」、SJ「共 2 · 待处理 2 · 已处理 0」且整页 0 次 `annotation-states` 请求；修后两侧都是「共 2 · 待处理 0 · 已处理 0 · 已通过 2」、两行「已同意」，SJ 侧请求 1 次。做法与读数见 `docs/verification/pms-3d-review-integration-e2e.md` §5.1 第 4 条、§6.3.1。

- **版本对比 09-21 收口十笔的真机 / e2e 补齐：两份 spec 补断言 + 多单元一条新用例，三档显卡各跑一遍全绿；教程配图** (2026-09-22)
  - 09-21 那条线（时间线两个勾选 / 每行「定位」/ 折 20 行 / 容器 URL 直达 / 多单元一起进三维 + 阈值确认 / 换组分屏保持 / 软渲染退回）只过了单测。今天 `:8022` 用同一 `a382b2cf3` 构建重起后先按原 spec 跑（6 passed），再补：`model-version-compare-gen-model-v1.spec.ts` 分屏后读 `__modelUnitVersionCompare.splitOutline`，按 `isSoftwareRendererName` 判该走合成器还是直接 render、面板那一句露不露；`node-version-view-gen-model-v1.spec.ts` 容器用例加「只看自身变的」/「只看几何变的」的行数（全表 299 → 5 / 297，A / B 两行永远留着）与每行「定位」的可点 / 置灰 / title，装好组后 B 版已删的构件也能定位（相机真飞）；**新第三条**：PIPE `24384_23225` `compare_a=300&compare_b=380` URL 直达自动切「所有子节点」落模型对比 tab 即停 → 总按钮一起装 5 个单元（进度卡、A / B 卡各列 2 个不存在的单元、五个组按钮「三维中 · 只看这组」）→ 分屏后点一组「只看这组」分屏仍在 → 退出 generate 8 / DELETE 8。阈值确认框 e2e 到不了（ams8000 凑不出 > 20 组），只在单测里。
  - `playwright.config.ts` 新认 `PLAYWRIGHT_GPU=1`（ANGLE → D3D11）/ `PLAYWRIGHT_SOFTWARE_GL=1`（ANGLE → SwiftShader）两个开关进 `launchOptions.args`；不给就是从前的行为。本机 Chrome 新 headless 缺省就拿到真显卡，要看软渲染那条路得显式开后者。
  - 验证：dev `:3111` + `:8022`（`0.1.27+ga382b2cf3`，内存库）三档各一遍——Chrome 缺省 **7 passed 28.9 s**、`PLAYWRIGHT_GPU=1` **7 passed 28.9 s**（`compositor true`，RX590）、`PLAYWRIGHT_SOFTWARE_GL=1` **7 passed 29.0 s**（`compositor false`，那一句带 SwiftShader 串）；pageerror 0；ESLint 三文件 0。图与账 `docs/verification/model-version-compare-gen-model-v1-2026-09-18/closeout-0922/`，README §8.3 追记 / §8.5；收口计划 §8 末追记。教程 `MODEL_VERSION_VIEW_TUTORIAL.md` 嵌 10 张真机图（`docs/guides/images/model-version-view/`）。仍欠：~~P2-c 成员 / owner 真差（后端 `attribute_diff.rs` 未提交）~~（下一条）、设计稿 S4 注 5 / 注 6 改口。
  - **P2-c 也收了（15:3x–15:4x，用户拍板拿后端工作树编一份换到 `:8022`）**：`element/attribute-diff` 真机——叶子净差表 `data-source=server`、表底「取数：服务端 element/attribute-diff…」、这版服务端把 `SPAMAP` 标成戳（缺省不列、勾「含戳」才出）；容器子树 573 → 628 点开 EQUI 24384_24776「成员 新增 1（24384_26495）」、ZONE 24384_24775「属性一字没差，只有成员表 / owner 动了」+「成员 新增 1」，不再有「折出来的」那句。e2e：叶子那条按服务端有无路由断言 `server` / `folded` + 戳缺省不列；**新第四条**（没路由就跳过）逐行拿真差、挑成员 / owner 有差的点开断言。两份 spec 对这台 **8 passed 31.6 s**。计划里「BRAN 24384_23257 应出『成员重排』」不成立（两条路由都说 (573, 628] 没动成员，是计划写错了段）。后端那半仍未提交，`:8022` 现在是它工作树的 `.dirty` 快照（README §5.5）。
  - **设计稿 S4 注 5 / 注 6 也改口了（15:5x）**：`plant-10/design/node-version-history.pen` 注 5「去留待拍板」→「留，软渲染自动退回直接 render（P3-c）」、注 6「一次一个单元 / 分屏回单视口（未动）」→ 总按钮 + 进度 + 阈值确认（P2-a / P2-b）、换组分屏保持（P3-b），分屏 Footnote 同步；只重导 S4 一帧 `docs/plans/2026-09-18-node-version-view-design/S4-3d-linkage-live.png`。09-21 收口计划至此全部收完。

- **最近点测量向导卡（`MeasurementWizard`）不再左半张被查看器容器裁掉：位置只在组件里定、顶部居中、限宽 480 px** (2026-09-22，issue [#82](https://github.com/happyrust/plant3d-web/issues/82)，#81 验收时顺手发现)
  - 组件 scoped CSS 是居中写法 `left: 50%; transform: translateX(-50%)`，宿主 `ViewerPanel` 却用内联 `style="left: 12px"` 把它挪到左上角——覆盖了 `left` 没覆盖 `transform`，卡向左平移了自身一半；又没有 `max-width`，「管-管」那句 70 字的提示把卡撑到 650–750 px，左半张（标题、图标、提示开头）画在 `overflow: hidden` 容器外面，还压住左侧工具栏顶上的按钮。任何容器宽度都裁：1366×768（容器 666）裁 315 px、1024×700（容器 324）裁 144 px。
  - 现在组件自己定位、宿主删掉内联 `style`：`top: 12px; left: 64px`（贴左侧工具栏右边、不压它）`; right: 12px; width: fit-content`（永远在容器里）`; min-width: min(300px, calc(100% - 76px))`（超窄容器不越右边界）`; max-width: 360px`、正文 `overflow-wrap: anywhere`、`z-index: 940`。不放顶部居中：cua 真机验收发现居中的卡在 825 px 查看器里会和右上的空间查询抽屉重叠 219 px、卡右侧按钮压在抽屉上点不到，改贴工具栏后 360 宽的卡从 64 到 424 刚好落在工具栏（右 57）与抽屉（左 433）之间。
  - 验证：Playwright headless dev `:3111` + `:8027`，工具栏「测量」→「管-管」，改前内联回灌同页同容器对比——修后 1366×768 卡 414→774（360 宽）、1024×700 卡 414→662（248 宽、随窄容器缩）两档都在容器内不裁、`pageerror` 0；cua 真机（抽屉同时开）卡 64→424 不撞工具栏 / 抽屉、「取消测量」可点；eslint `MeasurementWizard.vue` 0。图 `docs/verification/viewer-overlay-container-clip-2026-09-22/wizard-01-before-*.png` / `wizard-02-after-*.png` / `wizard-03-beside-open-drawer.png`，README §2.5 + §2.6（#80/#81/#82 共处一屏的回归）。

- **左侧工具栏「测量」下拉菜单在矮查看器里按剩余空间向上翻，不再被容器底边裁掉「管-墙/柱」「管-管」** (2026-09-22，issue [#81](https://github.com/happyrust/plant3d-web/issues/81)，#80 验收时顺手发现)
  - 菜单原来固定 `absolute left-full top-0` 从按钮顶往下开；工具栏 `top-1/2` 居中后「测量」按钮落在容器下半部，7 项 ≈ 217 px 的菜单在 416 px 高的容器里 `按钮顶 330 + 217 > 容器底 499`，末两项只露半行、点不到。它挂在按钮的 `.relative` 包裹里，百分比 `max-h` 只能相对那 36 px 解析，#80 那套「按容器算 `max-h`」对它无效。
  - 现在新增纯函数 `utils/dropdownPlacement.ts` `resolveDropdownPlacement({ anchorTop, anchorBottom, containerTop, containerBottom, menuHeight, margin = 8 })`：下方放得下向下开（`top-0`）；否则上方放得下向上翻（`bottom-0`，菜单底对齐按钮底）；两头都放不下选空间大的一侧并限高 + `overflow-y: auto`。`ViewerPanel` 打开菜单时先按缺省渲染一帧量自然高度，`nextTick` 后按 `.viewer-panel-container` / 按钮的 `getBoundingClientRect` 落位；7 个菜单项加 `shrink-0`（限高滚动时不被压扁）；菜单加 `data-testid="left-measure-menu"`。
  - 左侧工具栏另一个弹层「查看工具设置」（`toolbarSettingsOpen`）同法接入 `resolveDropdownPlacement`：它挂在工具栏最底的齿轮上、内容 648 px 高，原来硬 `bottom-0` 无限高、矮容器里顶部溢出 ≈232 px；现按剩余空间判向、超高就限高 + `overflow-y: auto`，加 `data-testid="left-settings-popup"`。工具栏其余是显示 / 隐藏 / X-ray / 定位等单键（只有 hover 提示气泡、无弹层），不涉及。
  - 验证：vitest `dropdownPlacement.test.ts` 6 例（向下 / 翻上 / 边界差 1 px / 两头放不下限高两侧 / margin 与负空间钳位 / 缺省值）；eslint 新文件 0、`ViewerPanel.vue` 只剩第 28 行那条既有的；type-check 触及行 0 新增。cua-driver 真机（同 #80 那台：CSS 视口 1692×826、容器 83→499）：点「测量」→ 菜单 149→366 `bottom-0` 向上翻、不限高、7 项 `elementFromPoint` 全命中，真点末项「管-管」→ 进入向导；点齿轮→「查看工具设置」自然高 648 → `bottom-0` 限高 399 滚动、落在容器内 8→408、末行可点。图 `docs/verification/viewer-overlay-container-clip-2026-09-22/cua-menu-01…02-*.png`、`cua-settings-popup-capped.png`，README §2.4。顺手看到：`MeasurementWizard` 向导卡左边被裁一截，见 [#82](https://github.com/happyrust/plant3d-web/issues/82)（同日修）。

- **空间查询抽屉下半截不再被查看器容器裁掉：面板最大高度改按容器算，滚到底能看到最后一行；「构件最近点测量」浮层同法收口** (2026-09-22)
  - 抽屉根节点原来是 `absolute top-24 max-h-[82vh]`——`82vh` 按浏览器视口算，可它挂在 `.viewer-panel-container`（`height: 100%; overflow: hidden`）里，容器上有 Ribbon、下有控制台，比视口矮一大截：`top 96px + 82vh` 超出容器的那一截被裁掉，内部滚动条按完整面板高算、`scrollTop` 已到底，最后一段（含滚动条下端、结果树末尾几行）却画在容器外面，看不见也点不到。真机回灌旧值复现：1366×768 面板底 809px vs 容器底 581px（超 228px）、1280×1000 超 189px。
  - 现在 `max-h-[calc(100%-7.5rem)]`（绝对定位元素的百分比 `max-height` 相对包含块 = 查看器容器；7.5rem = `top-24` 6rem + 1.5rem 底边距），面板仍按内容长高、只是上限改成「容器高 − 上下留白」，短内容时外观不变。`ObjectMeasureDrawer`（`top-[120px]`，原来根本没有 max-h、正文也不滚）同法 `max-h-[calc(100%-9rem)]` + 正文 `min-h-0 flex-1 overflow-y-auto`，矮容器里「重置选择 / 结束测量」两颗按钮不再被裁。`PipeDistanceDrawer` 本就 `top-0 bottom-0` 贴容器、`AnnotationOverlayBar` 是 `fixed` 配 `100vh`，都对；`MeasurementWizard` 内容只一行不用管。
  - 验证：vitest `SpatialQueryDrawer.test.ts` 37 过 + `useDtxTools.objectMeasure.test.ts` 6 过；eslint 两文件 0；tailwindcss CLI 探针确认产出 `max-height: calc(100% - 7.5rem)` / `calc(100% - 9rem)`。真机 dev `:3111` + gen-model `:8027`（AMS 7997）：范围查询 · 手输坐标 · 半径 3 m · 展开结果，修后 1366×768 面板底 557 < 容器底 581、1280×1000 面板底 786 < 容器底 810，滚到底后 `elementFromPoint` 命中面板内元素，`pageerror` 0。**cua-driver 真机真点**（Chrome 152，CSS 视口 1692×826、容器 416 px 高，改前 = 文件临时回 HEAD 让 HMR 热替换）：构件最近点抽屉改前 451 px 超出容器 155 px、真点「结束测量」屏幕位置落在控制台抽屉不关 → 改后 272 px 内缩 24 px、正文可滚、真点「结束测量」抽屉关闭；空间查询抽屉改前 82vh 677 px 超出 357 px → 改后 296 px 内缩 24 px，真点底部房间行「显示」触发 `showModelByRefnos` 加载 19 个构件。图与几何读数 `docs/verification/viewer-overlay-container-clip-2026-09-22/`（README 表）；issue [#80](https://github.com/happyrust/plant3d-web/issues/80)。顺手发现：左侧工具栏「测量」下拉菜单在矮容器里同样被裁掉末两项，见 [#81](https://github.com/happyrust/plant3d-web/issues/81)（同日修）。

- **校审「待保存证据」卡在画布等拖拽时让路；「不需解决」/「驳回」的备注框不再写「可选」** (2026-09-22，09-21 真手画批注回路 TC-3 暴露)
  - 「待保存证据」停靠在批注浮层栈底时正好压在画布中部，画云线拖轮廓的起点落在它上面就变成选中卡片文字、云线不出也不报错。现在 `AnnotationOverlayBar` 算一个 `canvasDragArmed`（云线锚点已就绪 / 矩形 OBB 框画 / 框选目标 = 画布正等一次拖拽），经 footer 作用域插槽交给 `ReviewConfirmation`：为真时本卡 `pointer-events: none` + 半透明 + 一行「正在绘制：本卡已让路…」，拖拽直接落到底下画布；浮层栈容器改成本身不接 pointer 事件、各卡自己接（否则放行的卡会被容器兜住）。右下角浮动版（批注浮层不在时）自己看工具模式对 OBB / 框选兜底。
  - 设计「不需解决」与校核「驳回」一直要求先填原因（不填只弹 toast），但 textarea 占位符写的是「可选」。现在占位符跟所选动作走：未选时「处理备注（已修改可不填；不需解决必填原因）」/「决定备注（同意可不填；驳回必填原因）」，选了必填动作写「（必填：…）」并在框下给一行「「不需解决」需先填写原因，才能提交处理结果」（驳回同理），框描黄、`aria-required`、提交按钮 `title` 同文；前缀「处理备注」/「决定备注」不变，按占位符子串定位的自动化不受影响。toast 拦截照旧。
  - 验证：vitest `AnnotationOverlayBar.test.ts` +1（锚点就绪 / 框选目标放行、清掉恢复、文字模式不放行、栈容器与主工具栏的 pointer-events 类）、`ReviewConfirmation.test.ts` +1（props 与工具模式两条路、提示、恢复）、`ReviewCommentsTimeline.test.ts` +1（设计 / 校对两侧占位符与提示切换）→ 3 文件 32 过；type-check 基线外 0 新增；ESLint 触及文件只剩 `ViewerPanel.vue:28` 那条既有的。**真机未复验**（改动未部署到 123.57.182.243，headless 复跑要先构建）。教程《三维校审批注与处理留痕操作教程》§七两处占位符改口；测试案例 `pms-3d-review-integration-e2e.md` §5.1 第 1、3 条对应。

- **房间层级树里的管件带直段：抽屉加载命中的管件按整条 BRAN 装，单元级显隐 / 隔离 / 仅显示连直管一起** (2026-09-21，ADR 0068 追记)
  - gen-model 把 BRAN 的隐式直管（TUBI）全挂在 **BRAN 自己的 refno** 上（直管没有独立 refno），空间索引里一条 TUBI 都没有，两棵树的叶子只有管件。改前抽屉「加载 / 加载未加载」只画命中的管件 refno——弯头、焊口悬空没有管；单元级「隔离 / 仅显示 / 眼睛」的 refno 集里也没有 BRAN 自己，直管被当「别的」XRAY / 隐掉。模型树「加载模型」走的是生成根那条链，整条 BRAN 一直是齐的——三处不一致。
  - 现在（用户 2026-09-21 拍板方案 A，只改前端）：新 `composables/deliveryUnitScene.ts` 只读 gen-model 记录缓存——`branOwnerOfLoaded(refno)` 认管件所属 BRAN（`owner_noun == BRAN`，HANG / EQUI 根没有直管不扩）、`deliveryUnitSceneRefnos(bran)` = BRAN 自己 + 这一根缓存里的全部构件（含范围 / 房间外的）。① 抽屉批量加载（`batchLoadSpatialQueryRefnos`）装完命中项后按属主再装一批 BRAN 整体并置可见——记录已在缓存里、不多打接口，装进来的不算命中、不进 loaded / unloaded 计数；② 抽屉「仅显示 / 隔离」（单元级及以上，动作的 refno 集盖住单元列出的全部叶子才算整个单元，`spatialTree.branUnitRefnosCoveredBy`）与「全部显示 / 隐藏 / 隔离结果」（树里全部 BRAN 单元）都带上 BRAN 整体，隐掉的那一侧也带（不留没有管件的光管）；③ 房间页签单元级及以上的眼睛 / 显示 / 隐藏 / 隔离同样（`roomTreeNodes.branUnitRefnosUnder` + `useRoomTree.collectSceneRefnos`）。构件行的眼睛 / 定位、「加载模型」的计数不变。`sceneCompanions` 两处都可注桩。
  - 验证：vitest `deliveryUnitScene.test.ts` 新 4 例、`spatialTree` +1、`roomTreeNodes` +1、`useRoomTree` +1（既有 2 例断言改口）、`useSpatialQuery` +3（既有 1 例改口）→ 空间 / 页签相关 13 文件 163 过；type-check 基线外 0；eslint 触及文件 0。真机 `:3111` + `:8027`（AMS 7997）五步：抽屉「加载」单元 `/Copy-of-1RCS0307-1R90004`（11 个命中管件）→ BRAN 24381_148125 名下 13 段直管 + 范围外 9 个管件一起进场景；「隔离」它 → 直管实体、房间页签装的另一条 BRAN 24381_105030（22 段直管）XRAY；「全部隐藏」→ 直管随之隐、另一条不动；房间页签单元「隔离」/ 眼睛 → 22 段直管跟着实体 / 隐藏，构件行眼睛只隐自己；`pageerror` 0。图与账 `docs/verification/spatial-room-hierarchy-tree-2026-09-20/ui/tubing-01…05-*.png`、`tubing-summary.json`，README §9。

- **版本对比分屏的描边合成器留着，认出软渲染（SwiftShader / llvmpipe / Microsoft Basic Render Driver）就自动退回直接渲染** (2026-09-21)
  - 09-21 上午量过：合成器每格固定 +0.8–1.1 ms，真显卡上分屏仍 60 fps，但软渲染（远程桌面 / 虚拟机 / 无驱动、缺省 headless）下分屏只剩 11 fps、直接 render 60 fps。现在 `utils/three/webglRendererInfo.ts` 读 `WEBGL_debug_renderer_info` 的显卡串（读不到按真显卡处理），软渲染时分屏每格直接 `renderer.render`——选中的环境构件按选中色显示、没有描边，帧率优先；真显卡照旧两格都描边。按上下文定一次、缓存；`localStorage['plant3d-web.viewer.splitOutline'] = 'compositor' | 'direct'` 可强制（排障）。
  - 就位后运行态多一格 `splitOutline { compositor, renderer }`（`__modelUnitVersionCompare.splitOutline` 同），面板分屏摘要下软渲染时照实说一句（`model-unit-compare-split-direct-render`）。
  - 验证：vitest `webglRendererInfo.test.ts` 新文件 2 例（名字识别 / 扩展与回落 / 抛错当不知道）、面板 +1（软渲染说一句、真显卡 / 单视口不露）→ 版本对比相关 10 文件 102 过；type-check 基线外 0 新增；ESLint 触及文件只剩 `ViewerPanel.vue:28` 那条既有的。**真机未跑**（`:8022` 未起）。README §8.3 追记；收口计划 P3-c（D6）。

- **版本对比：容器下变了的单元可以一起进三维（总按钮 + 进度「正在生成历史投影 n / m」），超过 20 个或服务端说要确认时先弹确认框** (2026-09-21)
  - 以前 `所有子节点` 的模型对比只能逐组「在三维中对比」、一次装一个单元（设计稿 S2 画的是一颗总按钮）。现在不止一组时分组列表上方多一颗「全部变了的单元一起进三维」（`model-unit-compare-run-groups`，注「N 个单元 · 约 M 份历史投影」）：按份（单元@sesno，tombstone 侧不算）并发 ≤ 2 去 `history/generate`，进度卡 `model-unit-compare-progress`「正在生成历史投影 n / m · 正在装的那几份」，装完一发 `open`——`before` / `after` 是各单元并起来的一侧（`mergeModelUnitVersionSides`：entries 合表、refnos 拼接、身份借容器、每个单元都不存在才整侧 tombstone）、`rows` 拼起来、`units[]` 各自一份、`unitRefno` 是容器；ViewerPanel 环境里按每个单元根整单元藏（`collectModelUnitTargetObjectIds` 接一串根），`__modelUnitVersionCompare.units`。四态着色 / 角标 / 「三维只看差异」/ 分屏拾取 / 点 A / B 构件读那一版（`attributesAt` 按 refno 找它属于哪份几何）对多单元同样成立；树差异模式每单元各折一份拼起来（B 侧 tombstone 的单元根也进树）。
  - 面板：运行态卡「N 个单元 · <容器> 下」，A / B 卡列出这一侧不存在的单元（「1 个单元该版本单元已删除：…」），几何差异摘要标题「N 个单元 · 几何差异（…）」，被装的组都标「三维中」（多单元时「三维中 · 只看这组」，点它 = 只看那一组）。单单元 `open` detail 与从前逐字相同（不带 `units`）。
  - 确认框（`model-unit-compare-confirm`，设计稿 S2b ②）：超过一次装载上限 `MODEL_UNIT_COMPARE_MAX_UNITS = 20` 个、或服务端 `needsConfirm`，先问「全部生成 / 先装变化最大的 20 个（`pickMostChangedGroups`：按 added + deleted + modified 排，noop 不算）/ 取消」；A / B 或范围一换、换节点重载，没答的框一并收掉。差异摘要下那行 `needs_confirm` 提示改口。
  - 半路失败 / 被更新的请求作废：本次已取到的几份几何都还回去（不再漏快照）。验证：vitest `modelUnitVersionCompare.test.ts` +2、`ModelUnitVersionComparePanel.test.ts` +2（并发与进度逐步放行、两侧并起来、A / B 卡注脚、只看这组；22 组先问 / 取消 / 先装 20 / needsConfirm 全部）→ 版本对比相关 9 文件 99 过；type-check 基线外 0 新增；ESLint 触及文件只剩 `ViewerPanel.vue:28` 那条既有的。**真机 / e2e 未跑**（`:8022` 未起）；e2e 容器那条加了「不止一组且 ≤ 20 就点总按钮」的守卫段。收口计划 P2-a / P2-b（D3「做，上限 20」/ D4「绑定」）。

- **节点版本面板的时间线缺省只列最近 20 版，更早的折成一行「加载更早 n 版…」点开全列** (2026-09-21)
  - 叶子 53 版、容器子树 298 版以前一次全列，面板要滚很久才到 A / B 按钮和两个 tab。现在照设计稿 S1：只画最近 20 行，底下一行「加载更早 n 版…」（`data-testid="model-unit-compare-timeline-more"`，`data-hidden` = 折起的版数）点开全列；**取数不变**（版本表早已整表取回，点开不再请求服务端），「本范围 n 版 · 仅属性 m」仍按全表数。
  - 画出来的是从最近那一版起**连续的一段**：被选为 A / B 的行一定在里面——URL `compare_a` / 「与上一版比」把 A 选到很早的会话时，切点顺延到它、它之后的全露出来，只折它之前的。点开后切范围 / 勾筛选不折回，换节点重载才折回。纯函数 `sliceNodeTimelineRows`（`utils/nodeVersionTimeline.ts`），`NODE_TIMELINE_INITIAL_ROWS = 20`。
  - e2e 两个 spec 数全表前先点开那一行（不够 20 行就没这一行，等 3 s 当没折）。验证：vitest `nodeVersionTimeline.test.ts` +2、`ModelUnitVersionComparePanel.test.ts` +1（两文件 37 过）；type-check 基线外 0 新增；ESLint 触及文件 0。**真机 / e2e 未跑**（`:8022` 未起，`:3111` 在但连的是它）。收口计划 `docs/plans/2026-09-21-node-version-view-design-sync-and-gap-closure-plan.md` P1-c（D2 选「只改展示」）。

- **版本对比：容器的 `compare_a / compare_b` URL 直达；从管道逐组进三维时分屏不再每组掉回单视口** (2026-09-21)
  - 容器（PIPE / ZONE 等）没有自己的几何可跑，`compare_autorun=1` 到这儿以前直接停、URL 那对被忽略。现在把那对套到时间线上：本范围里有就选上，只有子树里有就先切「所有子节点」，再落到模型对比 tab 看分组即停（不跑对比、不装几何）；哪个范围都没有就提示原文、范围与缺省 A / B 不动。
  - 换单元 / 换版本重开 = 面板先 `close` 再 `open`，视口以前每次都回缺省单视口。现在 `open` 事件带上一轮就位运行态的 `viewMode`（`ModelUnitVersionCompareOpenDetail.viewMode?`），ViewerPanel 就位后照它切（缺省单视口不做事，测量工具等照单视口→分屏那条路收）。
  - 验证：vitest `ModelUnitVersionComparePanel.test.ts` +2（20 过）；type-check 基线外 0 新增；ESLint 触及文件只剩 `ViewerPanel.vue:28` 那条既有的。**真机 / e2e 未跑**（dev `:3111` 未起）。README §8.4 末两条与 plan §11.1 末句改口；收口计划 P3-a / P3-b。

- **节点版本面板补齐设计稿两处：时间线「只看自身变的」筛选 + 属性对比 tab 每行「定位」** (2026-09-21)
  - 「只看自身变的」（设计稿 S2）只在「所有子节点」下露出：子树里别的构件动了、节点自身记录没动的会话不列；只改了属性的会话算自身变过、照列；被选为 A / B 的行永远留着；自身列未知（旧服务端只给单元那一列）时置灰不筛。与「只看几何变的」可叠加。两个勾选的筛法收成纯函数 `filterNodeTimelineRows`（`utils/nodeVersionTimeline.ts`）。
  - 「定位」（设计稿 S3）：「所有子节点」下属性对比 tab 有变的构件清单每行一颗，走版本对比事件的 `focus`——三维里装着 A / B 时飞到隔离图层里的它（幽灵也找得到）；没装时 `ViewerPanel.focusModelUnitVersionCompare` 新增回落：到主图层（环境模型）里找同一 refno（`o:<refno>:` 前缀）再飞，哪儿都没有就不动相机。B 侧已删且三维里没装 A / B 时按钮置灰（当前会话里已没有它）。点「定位」顺手激活三维查看器面板，不展开那一行。
  - 验证：vitest `nodeVersionTimeline.test.ts` +2、`ModelUnitVersionComparePanel.test.ts` +2（两文件 32 过）；`node scripts/type-check.mjs` 基线外 0 新增；ESLint 触及文件只剩 `ViewerPanel.vue:28` 那条 HEAD 就有的。**真机未跑**（dev `:3111` 未起）。收口计划 `docs/plans/2026-09-21-node-version-view-design-sync-and-gap-closure-plan.md` P1-a / P1-b。

- **空间查询选了房间就是一棵「房间层级树」，结果区剪成一排图标 + 单行；模型树新增「房间」页签浏览同一棵树** (2026-09-20 / 21，ADR 0068)
  - 之前抽屉「范围 / 距离查询」的结果只有平铺分组 + 分页，命中属于哪间房、哪个最小交付单元看不出来；结果区堆了九个文字按钮、三行卡片和两行长提示；模型树的 ROOM 页签随 legacy 退役一起删了。现在：
    - **抽屉树态**：「更多条件」里选了 ≥ 1 间房再执行，服务端一次聚合 `GET /api/v1/spatial/nearby/tree`（`rooms=` 必填，不分页、按 refno 去重、叶子随树内联、超过 5000 个放置改为按单元 / noun 组另取），结果区换成 房间 → 专业 → 最小交付单元类型 → 单元 → 构件 五层，不属任何单元的构件归专业下「其他构件」按 noun 分；横跨多间房的构件每间房下都出现、标「跨 N 房」、总数只算一次；每层悬停出 加载 / 仅显示 / 隔离；树态下房间列表 / 分页 / 「按专业 | 按库」开关不再出现。清掉房间回平铺。
    - **结果区剪辑**：九个按钮收成一排七个图标（加载未加载 · 全显 / 全隐 · 隔离 / 恢复 · 复制 Refno 点开二选本页 / 全部 · 清空），构件行三行卡片改单行 `refno · noun · 距离`（未加载灰字，名字有就替代 refno 显示），查询中心并进摘要第二行，覆盖面提示缩成一句、全文进 title；「加载当前页」并进「加载未加载」（平铺态只补本页、树态补整棵树）。
    - **模型树「房间」页签**：PDMS / 房间 两页签，房间页签把在册房间平铺一层（`GET /api/v1/spatial/rooms`，房号自然序 + 搜索框），展开一间房吃 `GET /api/v1/spatial/rooms/{refno}/tree`（房间自己的包围盒为范围）展成同一棵五层树；行是模型树的行——眼睛切显隐、勾选由子构件推导，右键 聚焦 / 隔离 / 显隐 / 加载模型（N 个构件，> 200 先确认）/ 查看属性；没生成过面板模型的房间展开时一句原因；两棵树常驻，切页签状态不丢。上次停在哪个页签记在 localStorage（刷新回来还在那一页）；查看器 / 抽屉 / PDMS 树里选中一个构件，若它在页签里已展开过的房下，页签自动展开到它、选中并滚到可见（不为它去拉没展开的房）。
  - 验证：vitest 空间 6 文件 + 页签 2 文件 128 passed；type-check 基线外 0；eslint 0；e2e `spatial-query-gen-model-v1-ui.spec.ts` 9 passed / 1 skipped；真机 `:8027`（`gen-model-model-cache@65dacd576`，AMS 7997）：HTTP 金样 38 / 38、抽屉树态 R432 1055 / 两房去重 1056、剪辑四图、房间页签十步逐层 = `rooms/24381_35580/tree`（1298 / 5 / 1293 / BRAN 28 单元 226 / EQUI 45 单元 1067），见 `docs/verification/spatial-room-hierarchy-tree-2026-09-20/README.md` §3–§6、§8。设计稿 `ui/空间查询/room-hierarchy-tree.pen`；计划 `docs/plans/2026-09-20-spatial-room-hierarchy-tree-plan.md`、`docs/plans/2026-09-21-model-tree-room-tab-pr-d-closeout-plan.md`。

- **属性对比的「属性净差」改接 `element/attribute-diff`：A / B 两端直接读终态，成员 / owner 给真差；旧服务端回落到折时间线** (2026-09-21)
  - 之前「仅自身」的属性对比与「所有子节点」下点开一个构件，都是把属性变化时间线在 (A, B] 里逐会话 before / after 折成净差——改过又改回去的会被算成变化，成员增删 / 重排与 owner 改挂只能说「动过」。现在先问服务端 `GET /api/v1/element/attribute-diff?dbnum&refno&a&b`（ADR 0066 列的第四条路由：两端各钉一个会话、同一个属性渲染器两端各出一次字），`kind` created / modified / deleted / unchanged，`impact` 与版本表同一词表，`members` / `owner` 是两端的真差；服务端没有这条路由（无信封 404）记一次、回落到折时间线，表底写明取数口径。
  - 端口 `ModelVersionSource.attributeDiff` + 类型 `ModelAttributeDiff`（`ports.ts`）；v1 适配器 `attributeDiff` → `ModelVersionRouteUnavailableError('element/attribute-diff')`；面板两条来路归一成 `AttributeNetDiffView`（`viewFromAttributeDiff / viewFromFold / emptyNetDiffText`，`utils/nodeVersionTimeline.ts`）。
  - 验证：`versionSource.test.ts` +1（回执映射 a_b 归一 / 无路由抛错）、版本对比相关 9 个测试文件 86 过；**真机未验**——运行中的 `:8022`（`a382b2cf3`）没有这条路由、走的是回落，后端 gen-model-refactor `src/fast_model/attribute_diff.rs` 尚未提交。

- **从容器（PIPE 等）的差异摘要分组进三维：A 时还没建 / B 时已删的单元也能进了** (2026-09-21)
  - 之前 `runCompareGroup` 合成两侧版本时一律按「有几何」装，单元在那一版不存在就去生成一个不存在会话的历史投影，后端 404 `REFNO_NOT_FOUND_AT_SESSION`、面板报「历史投影任务失败」进不了三维。现在按摘要组里单元根那一行判：`deleted` → B 侧、`added` → A 侧按「已删除单元版本」（空集）装，分屏那一格空着并在角标注明；A 侧注脚说「该版本没有这个单元」（多半是还没建），B 侧仍是「该版本单元已删除」。
  - 验证：vitest 纯函数 +1、面板用例 +2 段，type-check 基线外 0 新增；真机 PIPE `24384_23225` A 300 → B 380 三组（改 / 删 / 增）见 `docs/verification/model-version-compare-gen-model-v1-2026-09-18/README.md` §8.4。

- **版本对比分屏也能点构件：左格读版本 A、右格读版本 B 的属性，环境构件照常选中** (2026-09-21)
  - 之前分屏时三维点击整体关着（GPU 拾取按整幅相机算、对不上左右两格画面）。现在指针落在哪一格就按那一格的视口与宽高比造射线：A / B 隔离图层做 CPU 射线拾取，命中把属性面板钉到那一版（与单视口同一条路，非当前显示侧拾取前临时开层、测完复位，「三维只看差异」照样生效）；主图层（环境）的 GPU 拾取把那一格当子视口——`GPUPicker.pick` / `DTXSelectionController.pick` 新增可选 `viewport`（three 的 `setViewOffset` 会把 aspect 置成整幅的，整幅必须就是那一格）；点空处普通清空。
  - 分屏每格改走描边合成器：选中的环境构件两格都有描边，分屏与单视口的色彩 / 后处理也一致了（之前分屏暗一档）。
  - 验证：vitest 纯函数 +1、`GPUPicker.test.ts` +2，type-check 基线外 0 新增，e2e 两夹具各 4 过；真机 `docs/verification/model-version-compare-gen-model-v1-2026-09-18/3d-diff-color/a626-b630-splitpick-*`（无环境）与 `a626-b630-splitenv-*`（带环境）（README §8.2，plan §11.1「分屏拾取」）。

- **版本对比的三维按「模型几何差异」着色，单视口加版本角标，新增「三维只看差异」** (2026-09-21)
  - 从前 A 整侧蓝、B 整侧绿，只说明版本身份，哪件变了三维里看不出（面板算好的 `rows` 进了 ViewerPanel 却没人用）。现在每一版内部按四态上色：修改琥珀 / 新增翠绿（只在 B）/ 删除玫红（只在 A）/ 未变石板灰，与面板徽章、模型树差异模式同一套色（ADR 0066「三维联动」的落地，CONTEXT「模型几何差异」加了一句）。
  - 视口角标：单视口一枚跟着当前显示的版本（「B · sesno 630」），分屏两枚照旧；角标下只读图例列四态计数，「只看差异」开着时多一枚标签。
  - 面板「三维查看」节新增「三维只看差异」：隔离图层里藏掉两版都没变的构件，只改显隐不重装几何，分屏两侧同样生效；没有几何差异时置灰。与列表「包含未变化」同一口径、各自开关。
  - 单视口里点到 A / B 那版的构件，右侧属性面板读的是**那一版**的属性（`history/query tool=attributes`，与树差异模式底部同一取数口），标题下注明「属性来自版本 A · sesno n」；从前隔离图层的构件根本点不到（GPU 拾取只认主图层）。`useSelectionStore` 新增「版本钉住」选中，任何正常选中复位，退出对比一并清掉。
  - 验证：vitest 39 过（纯函数 +2、面板 +1、属性面板钉住 +2、属性折算 +2）、type-check 基线外 0 新增、e2e `model-version-compare-gen-model-v1.spec.ts` 两个夹具各 4 过；真机截图 `docs/verification/model-version-compare-gen-model-v1-2026-09-18/3d-diff-color/`（README §8 / §8.1，plan §11 / §11.1）。

- **legacy 模型数据源退役：前端只剩 gen-model `/api/v1`，旧后端 `:3100` 相关代码、依赖与 UI 入口一并删除** (2026-09-20)
  - 生产当天切到 gen-model（ADR 0054 2026-09-18 追记定的锚）：删 `src/model-source/legacy/` 与 `?model_source=` / `VITE_MODEL_SOURCE` 开关，`ModelSourceKind` 只剩 `'gen-model-v1'`，`getModelSource()` 进程内一份。
  - 删整条 parquet / DuckDB-WASM 链（`useDbnoInstancesParquetLoader`、`genModelE3dParquetApi`、`usePtsetRuntimeLookup`、`duckdbBundles`、`useDuckDBModelLoader`、`useParquetSqlStore`、`useSceneTreeLoader`、`public/duckdb`，依赖 `@duckdb/duckdb-wasm` `apache-arrow` `parquet-wasm` `surrealdb`）与 `.glb` 网格分支；`lib/filesOutput.ts` 只剩当前工程状态，改名 `lib/currentProject.ts`。
  - 删旧后端取数模块 `genModelE3dApi` / `genModelSearchApi` / `genModelIndexTreeApi` / `pipelineAnnotationApi`，`genModelPdmsAttrApi` 只留类型 + 由 v1 实现的 `pdmsGetTransform`；调用方（`useReviewDeliveryUnit` `measurementPathLookup` `measurementSnapLabel` `InitiateReviewPanel` `usePdmsConsoleCommands` `ViewerPanel` `PtsetPanelDock`）改走 `getModelSource()` 的 tree / attributes / keypoints 端口。`useModelProjects` 改读 `/api/v1/health.project`（gen-model 一个进程一个项目）。`usePipeDistanceStore.autoDetectBrans` 由旧后端 `/api/space/nearest-points` 一发算全部目标，改为逐对调 `/api/v1/spatial/surface-clearance`（`target_kind=any`），某一对 `result: null` 或 404 只记 warning、不拖垮整批。`genModelSpatialApi.ts` 只剩类型。「关于」对话框的后端版本改读 `/api/v1/health` 的 `version` + `build_id`（`<semver>+g<commit>.<unix 秒>`），旧 `/api/version` 在 gen-model 上是 404。
  - gen-model 没有对应接口的旧后端功能拨掉 UI 入口（D1）：房间树页签 / 房间计算 / 房型房间信息、`/api/space/*` 六个支架场景（「空间计算」Dock 只剩 BRAN 中心线净距，改名「中心线净距」）、MBD v2 外部尺寸（含 `useMbdExternalSync` / 诊断面板 / `mbd-v2` 夹具 / vite 夹具通道）、工作台 / 项目卡片首页、任务创建 / 监控 / 模型导出、增量更新面板、校审日志抽屉、站点注册、Parquet SQL 调试页签、SurrealDB 直连基准页（`BenchmarkView` / `?benchmark`）、模型树「过滤结果分组」；`usePanelZones.ZONE_PANELS` 同步到 DockLayout 实际注册的面板集合；`useModelGeneration` / `useSpatialQuery` / `useDbnoInstancesDtxLoader` 里 realtime / parquet / SSE 回退路径删除。
  - 配置与部署：`vite.config.ts` 去掉 DuckDB 资产管线与 MBD 夹具，dev `/api` 代理指 `:8022`；`deploy/nginx_remote.conf` `/api` → `:8022`，`/files/` 整前缀兜底到 `:8022`（附件那条 `/files/review_attachments/` 由后端分流片段 `aios-review-split.conf` 提供，站点文件不能再写同名 location——真机 `nginx -t` 报 duplicate location 后改成更短前缀兜底）；`deploy-ubuntu.yml` / `deploy_frontend_bundle.sh` / `deploy/README.md` 的 `BACKEND_ORIGIN` 缺省 `http://127.0.0.1:8022`。`tsconfig.app.json` 显式加 `"node"` types——此前 `@types/node`（含 `Array.prototype.at`）是被 DuckDB 依赖顺带拉进全局的。
  - 测试：删 legacy 专用用例（parity 的两源对拍、`?model_source=legacy` 路由、`spatial-query-real-bran` 真机、`dimension-real-ams-bran-version`、`dimension-mbd-v2-fixture`），其余改成 mock `getModelSource()`；`npm run type-check` 基线之外只剩 worktree 绝对路径 / 联合类型顺序两类签名差异（非新错误），vitest 全量与改前基线对比见提交说明。

- **模型树无名构件按 E3D 规矩起名，默认显示短名，可切全称** (2026-09-20)
  - gen-model-v1 的 `/tree/roots|children` 节点从此带三个名字（spec §4.10）：`name` 是 E3D 的 `FLNM`——有名字就是 NAME，无名构件是 e3d-io 按位置拼的整条（`ZONE 4 of SITE 2`、`BEND 3 of BRANCH /C-IY-1R330-B`；WORLD 不进名字，无名 SITE 就是 `SITE 2`）；`short_name` 是短形态（`ZONE 4`）；`stored_name` 是文件里存的 NAME，无名为 `null`。2026-09-20 之前无名节点的 `name` 是 noun 本身（`SITE`）。
  - `EleTreeNodeDto` / `TreeNodeDto` / `TreeNode` / `FlatRow` 各多一格：`eleTreeNodeToDto` 只在服务端给了 `short_name` 且与 `name` 不同（即无名构件）时带上，`stored_name` 服务端给了就透传——老服务端回包转出来的 DTO 与从前逐字段相同，legacy 源不受影响。
  - `ModelTreeRow` 默认画短名，整条挂在行的 `title` 上；类型筛选弹层里多一个「无名构件显示全称」勾选（`data-testid="model-tree-full-names"`），勾上后直接画整条。选择按浏览器落进 `localStorage`（`plant3d-web.modelTree.fullNames`），换字段不重查。
  - 验证：`treeSource.test.ts` 新增一例（三种回包形状），14/14 过；改动范围内 `eslint` 零问题、`vue-tsc` 无新增（仓库基线 564 条既有错误，改动文件里的 5 条均在改动之前就在）。

- **云线批注改为世界锚定 billboard，并每帧贴合关联构件的屏幕投影** (2026-07-31)
  - `screen2d` 云线此前画在 HTML/SVG overlay 上，只有锚点参与相机投影：云线本身与三维层割裂，无法参与深度排序，尺寸恒定为拖框时的像素值。相机一转，被框住的构件就跑到云线外面，云线不再指认它所标记的东西。现在改为在 WebGL 里绘制世界锚定的 billboard 云线，与 `bbox3d` 同处一个渲染层。模式名与 `anchorWorldPos` / `screenOffset` / `cloudSize` 数据字段保持不变，数据模型未动。
  - `buildCloudBillboardPolyline()` 每帧用相机 right/up 基向量在世界空间展开波浪折线；`worldPerPixelAt()` 做像素→世界换算，使线宽与波幅在推拉相机时保持恒定像素观感。billboard 平面深度取关联 AABB 中心的 ndcZ，让像素→世界换算与投影落在同一深度。
  - 新增 `computeFittedCloudRectFromCorners()`：每帧把关联构件合并 AABB 的 8 个角投影到屏幕求 2D 外接矩形，再外扩 `CLOUD_FIT_PADDING_PX = 14`，保证任意机位下被绑定的构件都落在云线框内。**拖框尺寸由「云线尺寸」降级为最小尺寸兜底**；AABB 缺失、或有角点越过近/远平面（相机钻进目标内部）时，回退到锚点 + 偏移的固定尺寸布局。
  - 新增 `cloudWavesPerEdgeForSizePx()`：贴合矩形放大后波峰数按边长像素折算（钳制 4–40），避免大框上的波浪被拉成长弧；旧拖框尺寸区间（120×72 至 220×180）仍是 4 峰，观感不变。
  - `bbox3d` 的 `bboxEdges` 由 `depthTest: true` 改为 `false`，与 billboard 云线统一为常显语义。批注的职责是确定性地指认目标，被前景管道挡住的云线等于没有批注；密集管廊里这是常态而非边缘情况，空间纵深改由 `bbox3d` 自身的透视形变表达。
  - 删除替换后已无消费方的 SVG 残留 `createCloudPath()` 与 `CloudLayout.cloudPath`，以及 `useDtxTools.pickRefno.test.ts` 中针对该 SVG path 的断言。`computeCloudLayout()` 保留——创建云线时仍用它算 `screenOffset` 与引线终点。
  - 验证：新增 `useDtxTools.cloudFit.test.ts`（11 例），其中一组绕目标换 5 个机位、断言投影角点始终落在贴合矩形内。全量 `npx vitest run` 为 19 文件/45 用例失败，低于 CHANGELOG 记录的 22 文件/48 用例基线，失败集合全部落在校审流程、annotation severity、duckdb、parquet 等其他在建工作流，云线相关用例全绿；改动范围内 `eslint` 零问题（顺带修掉本次云线代码引入的 3 处 `@typescript-eslint/array-type`），`vue-tsc` 无新增问题。

- **几何数据源收口到 DuckDB WASM + parquet，删除 JSON 加载通道** (2026-07-31)
  - 几何实例此前有 parquet(DuckDB WASM) / backend / json 三条加载路径并存，`instances_{dbno}.json` 与 parquet 产物可能不同步，排查现场问题时很难判断当前渲染的是哪一份数据。现在只保留 DuckDB WASM 查 parquet 一条主路，backend 实时查库保留作为 parquet miss 的回填手段。
  - 删除 `composables/useDbnoInstancesJsonLoader.ts`。该文件名有误导性——一半内容是与 JSON 加载无关的 SSE 生成触发器，已先把 `triggerBatchGenerateSse` 及其类型拆到新增的 `api/genModelStreamGenerateApi.ts`（`useSpatialQuery` / `useModelGeneration` 在用）。随文件一并移除的 `triggerSubtreeGenerateSse`、`waitForDbnoInstancesFile`、`ensureDbnoInstancesAvailable`、`getDbnoInstancesMeta`、`setDbnoInstancesManifest` 均已无调用方。
  - `useDbnoInstancesDtxLoader`：`dataSource` 由 `'parquet' | 'backend' | 'json'` 收窄为 `'parquet' | 'backend'`，删除 json 分支。
  - `useModelGeneration`：删除 `prepareJsonManifestForFallback` 与整段 JSON 回退加载；parquet 不可用时直接抛错，不再静默降级到 JSON 后以"加载完成 (JSON)"收场。
  - `ViewerPanel`：`show_refno` / `debug_refno` 控制台命令的 `data_source` 参数只接受 `parquet|backend`，默认 parquet；`debug_refno` 原先会探测 parquet 可用性并回退 json，该逻辑一并移除。
  - `genModelE3dApi.getE3dSource()`：默认值由 `'backend'` 改为 `'parquet'`。带 `tree_sesno` 的版本模式仍强制走后端——parquet 产物只有 latest 态，历史版本树无法由它提供。
  - 后端配套改动见 `plant-model-gen` 同日条目：`/api/e3d/visible-insts` 同步去掉 JSON 与 SurrealDB 回退，改为 parquet 单源，与前端查询同一批产物。
  - 验证：全量 `npx vitest run` 与 HEAD 基线逐条对比，失败集合无新增（基线 22 文件/48 用例，改后相同，且 `FileUpload.test.ts` 反而转绿）；改动范围内 `vue-tsc` 与 `eslint` 零新增问题。

- **房间树交付单元继续展开 E3D 子层级** (2026-06-23)
  - 房间树支持 `room-item:{room}:{refno}` 虚拟节点，BRAN/EQUI 等最小交付单元下继续显示原始模型树子节点。
  - 房间树节点保留真实 `refno`，隐藏/显示、属性、点集和定位操作继续作用于真实模型节点。
  - AvevaMarineSample R301 验证：BRAN 下可展开到 `STRT/BEND/TEE/ATTA`，DOM `data-refno` 为真实 refno。

- **校审页日志抽屉 — 四类日志统一查看** (2026-06-11)
  - 新增 flag `REVIEW_H_LOG_DRAWER`(默认关闭)门控的日志抽屉:校审页右下角悬浮入口,tab 按类型切换,默认过滤当前 form_id/task_id,支持手动刷新、5s 轮询与游标加载更多
  - 类型 tab 由后端 `/api/logs/types` 按角色动态下发:校审流转历史(全部角色)、接口 request/response 日志、进程运行日志、站点文件日志 parse/generate/db/web/viewer(管理角色)
  - 接口日志条目可展开查看脱敏后的请求/响应体;站点日志无需传 site_id(后端默认当前站点),抽屉标题显示当前站点名(`/api/site/identity`,失败静默)
  - 新增 API 客户端 `src/api/logsApi.ts`(vitest 3 例)与组件 `src/components/review/LogDrawer.vue`;`ReviewPanel.vue` 挂载,flag 关闭零行为变化
  - 新增 Playwright 冒烟脚本 `debug_scripts/log-drawer-smoke.mjs`(开 flag → 打开抽屉 → 断言 tab 与数据 → 截图 artifacts/)
  - 对应后端 plant-model-gen specs/003~005(接口日志采集、统一查询 API、站点兜底、进程内运行日志)

- **移除 MBD 尺寸标注前端实现** (2026-06-02)
  - MBD 管线面板移除“尺寸”页签、尺寸统计、尺寸显示开关和相关设置项。
  - 三维标注渲染不再绘制 MBD segment/chain/overall/port 尺寸与弯头角度尺寸，交互层同步移除 `mbd_dim_*` 选中、拖拽和上下文菜单入口。
  - Ribbon 删除 MBD 尺寸命令组；MBD V2 前端类型契约移除 `linear_dim` / `angle_dim` 图元及类型守卫。
  - API 适配层忽略后端残留线性尺寸数据，避免旧数据继续进入前端 UI。

- **测量关键点(ptset)捕捉 — hover 显示 + 自动吸附** (2026-05-28)
  - 测量（距离/角度/点标高/高差）时，鼠标 hover 构件会按 refno 拉取其关键点（ptset：管端/法兰中心/喷嘴等连接点）并以绿色十字显示；光标靠近关键点时落点自动吸附到该点精确坐标
  - 新增吸附引擎 `usePtsetSnap` 与纯换算模块 `utils/three/ptsetTransform.ts`（场景坐标换算链与 `usePtsetVisualizationThree` 完全一致，保证吸附点与显示十字对齐），含 9 个单测
  - 吸附统一注入测量取点的唯一咽喉 `pickSurfacePoint`，预览与最终落点同时生效，四种测量模式通用；hover 取数带 80ms 防抖、按 refno 缓存与 in-flight 去重
  - `MeasurementPanel` 样式设置新增「关键点捕捉」开关与像素阈值（默认 12px），持久化到 `useXeokitMeasurementStyleStore`；吸附到关键点时标记/lens 用独立绿色并显示点号
  - 涉及文件：`composables/usePtsetSnap.ts`、`utils/three/ptsetTransform.ts`、`composables/useXeokitMeasurementTools.ts`、`composables/useXeokitMeasurementStyleStore.ts`、`composables/xeokitMeasurementUi.ts`、`components/tools/MeasurementPanel.vue`；设计文档 `goals/ptset-hover-measure-snap/`
  - 验证：全量 `npm run type-check` 通过；`usePtsetSnap`(9) 与 `xeokitMeasurementUi`(2) 单测通过

- **RUS-239 驳回后重新流转 — UX 增强与健壮性提升** (2026-05-08)
  - 设计批注处理面板新增**驳回原因提示框**：当任务被校核驳回时，在任务级动作区域顶部显示醒目的 amber 提示框，展示驳回原因并引导用户处理批注后点击「流转回校对」
  - 「流转回校对」按钮就绪态增加 ring 高亮效果，禁用态 title 属性说明具体原因（未处理批注 / 未保存证据）
  - 有未保存证据数据时额外显示 amber 警告提示
  - `workflowBridge.ts` 新增 `notifyParentWorkflowActionWithAck()`：发送 workflow action 后等待父窗口回执（`plant3d.workflow_action_ack`），5 秒超时返回 `'timeout'`，便于调用方在 PMS 未响应时回退到备选方案

- **校审外部流程默认模式与编译期开关** (2026-05-12)
  - 新增 `VITE_REVIEW_ENABLE_INTERNAL_WORKFLOW_MODE` 编译期开关，默认关闭；关闭时 `workflow_mode=manual/internal`、session/local storage 和 embed 参数都不会把前端切到内部主动模式
  - 发起编校审面板在外部流程模式下只保存 task 并发送 `plant3d.form_saved`，不再调用内部 `submitTaskToNextNode` 抢先把单据从 `sj` 推到 `jd`
  - `authGetToken` 与 PMS embed payload builder 不再发送 `workflow_mode`，公开校审 API 不再靠额外参数判断内部/外部模式
  - 保留内部主动模式作为显式编译产物能力：仅设置 `VITE_REVIEW_ENABLE_INTERNAL_WORKFLOW_MODE=1/true` 时兼容旧的 manual/internal 调试入口
  - 验证：`npm run type-check` 通过；后端默认/内部 feature 双向 HTTP smoke 均符合预期

- **RUS-239 驳回后重新流转修复** (2026-04-30)
  - 新增外部流程桥接判断，仅在 PMS/仿 PMS 嵌入模式下向父窗口发送 `plant3d.workflow_action`
  - 设计批注处理页“流转回校对”和任务详情“再次提交”接入 `workflow/sync active` 语义，避免外部流程场景继续走内部 submit
  - 仿 PMS runner 在发起后关闭额外 `3d-view` 页面并降低诊断等待耦合，`bran-mixed` 已验证通过至 `PZ approve`
  - 保留独立/内部模式的旧提交流转路径，并补充 RUS-239 计划、发现和执行记录

- **RUS-238 测量路径展示增强** (2026-04-30)
  - 测量列表、确认测量回放和批注测量证据支持异步展示模型树完整路径
  - 新增统一展示层 `useMeasurementPathSummaries`，保持 refno fallback，路径解析成功后再替换为完整路径
  - lookup 失败、模型树数据不可用或历史记录缺上下文时继续显示规范化 refno，不影响定位、隐藏、删除和回放行为
  - 补充 RUS-238 UI 接入、验收与 PMS/编校审后续验证计划文档

- **RUS-238 推送后验收规划** (2026-04-30)
  - 新增 planning-with-files 规划目录，沉淀任务计划、findings、progress、验收输入清单和工作区盘点
  - 新增自包含 HTML/SVG 流程图，说明从验收输入收集到 PMS/编校审验收与工作区收敛的路径
  - 明确真实验收继续依赖 BRAN、PMS 包名/任务单、角色和入口输入

- **RUS-238 仿 PMS 验收记录** (2026-04-30)
  - 使用 BRAN `24381_145018` 跑通 approved 主链，最终 `status=approved` / `node=pz`
  - restore 场景中 BRAN、测量和确认记录读回通过，剩余失败定位为刷新前评论内容 UI 断言
  - Chrome CDP full flow 通过真实 PMS 入口创建三维校审单，并在嵌入站点接口命中包名或 BRAN

- **批注错误类型替换** (2026-04-27)
  - 将批注"严重度"体系（致命/严重/一般/建议）替换为"错误类型"体系
  - 新增三种错误类型：原则错误（×）、一般错误（△）、图面错误（○）
  - 涉及文件：`auth.ts`、`AnnotationPanel.vue`、`AnnotationOverlayBar.vue`、`useToolStore.ts`

### 重构

- **审核面板 split / table 数据源统一** (2026-05-18)
  - `ReviewPanel.vue` 的卡片列表 split 视图与批注表格 table 视图共享单一原始来源 `scopedReviewerItems: AnnotationWorkspaceItem[]`
  - 删除本地 `AnnotationListItem` 类型定义、`allAnnotationItems` computed、`findAnnotationListItemFromWorkspace` 反向适配器（净 -81 行）
  - 卡片列表 handler `toggleAnnotationDetail` / `flyToAnnotationItem` / `getAnnotationReviewBadge` 入参类型迁移到 `AnnotationWorkspaceItem`
  - 行为不变：双胞胎面板 5 套件 baseline 33 fail / 56 pass → after 33 fail / 59 pass（仅新增早些补丁的 3 pass，0 新增 fail）
  - 消除 2026-05-18 早些补丁所对齐却未消除的"双轨"，让未来过滤维度扩展只需改一处
  - 关键文件：`src/components/review/ReviewPanel.vue`
  - 关联文档：`docs/plans/2026-05-18-reviewer-split-table-data-source-unification-plan.md`、`开发文档/三维校审/审核面板批注表格视图回归事故复盘-2026-05-17.md` §12

### 修复

- **评论列表里的 Debug 形态 id（`String("comment-…")`）解包成裸 id，时间线上删 / 改评论重新打得中** (2026-09-20)
  - gen-model 校审域三处把 SurrealDB 行主键按 Rust `Debug` 写进响应体（`GET /api/review/comments/by-annotation/*`、`GET /api/review/tasks/{id}/history`、workflow sync 的评论），后端用 `record_id_debug_shape_matches_the_legacy_sdk` 钉住了这个形态（旧端同形）；而建评论回执与 `DELETE|PATCH /api/review/comments/item/{id}` 认的都是裸 `comment-…`。前端 `normalizeAnnotationComment` 原样 `String(raw.id)`，时间线拿列表 id 去删 → 404「评论不存在」。
  - 新增 `unwrapRecordIdDebugShape()`：`String("x")` → `x`（Debug 转义按 JSON 解）、`Number(7)` → `7`，裸 id 原样；接在 `normalizeAnnotationComment`（`id` / `replyToId`）、`normalizeWorkflowSyncResponse`（records / annotationComments 的 id）与 `reviewTaskGetHistory` 上。
  - 验证：`reviewApi.test.ts` 新增 6 例（含 by-annotation → delete 的 fetch 级往返、history 解包）54/54；本机 gen-model `:8031`（0.1.27，`PLANT_REVIEW_ALLOW_EPHEMERAL_STORE=1`）真机：经前端 `reviewCommentGetByAnnotation` 取回的 id 与建评论回执逐字相同，再删 200；改前同一路径拿列表 id 删是 404。

- **Quicktest 模型加载离线化与聚焦修复** (2026-06-09)
  - DuckDB-WASM 初始化后统一设置 `custom_extension_repository` 到同源 `/duckdb/extensions`，`parquet_scan()` 不再访问公网 `extensions.duckdb.org` 下载 `parquet.duckdb_extension.wasm`
  - Vite 构建复制 `wasm_eh` / `wasm_mvp` / `wasm_threads` 三份 parquet extension 到 `dist/duckdb/extensions/v1.5.3/...`，开发服务器也支持同路径本地返回
  - DTX 模型自动聚焦新增鲁棒包围盒：当少量远端对象把全量 AABB 撑大时，按主体对象聚焦，不隐藏或删除模型数据
  - 验证：`npm run build` 通过；阻断 `https://extensions.duckdb.org/**` 后，`show_dbnum=250160` 仍加载 625/625 个对象并正常聚焦

- **零尺寸 BOX 无模型诊断与缓存状态修正** (2026-06-05)
  - `show_refno` 单模型加载路径在 `visible-insts` 为空或最终未绘制实例时，会查询 PDMS UI 属性并识别 `BOX` 的 `XLEN/YLEN/ZLEN` 是否全为 0。
  - 对零尺寸 `BOX` 在底部控制台输出明确原因：生成阶段不会写入 `inst_relate/geo_relate`，因此没有可绘制模型，避免只提示“可见实例为空”。
  - DTX loader 对 Parquet 无几何行的 refno 不再写入 `loadedRefnos` 缓存，避免后续点击误报“已存在于场景或缓存中”。
  - 验证：`npm run type-check` 通过；`show_refno=2013294900_6965` 页面控制台已显示零尺寸诊断。

- **外部 PMS 单据批注状态同步与启动健壮性增强（U011 整组）** (2026-05-19)
  - `useAnnotationReviewStateSync.ts` 新增 `pickLatestAnnotationStates`：同一批注的多轮记录按 `(reviewRound, updatedAt)` 去重，只应用最新一轮；避免上一轮的 `decision_status=rejected` 覆盖 SJ 二次处理后的 `fixed`
  - `ReviewPanel.vue` 的 `refreshAnnotationReviewStatesForCurrentTask` 与 `activeReviewFormId` watch 不再强依赖 `currentTask`：外部 form 聚焦时只凭 `activeReviewFormId` 也能按 `formId` 拉一次最新批注状态；`restoreConfirmedRecordsIntoScene` 与 `confirmCurrentData` 成功后追加一次主动刷新
  - `ReviewPanel.vue` 新增「外部 form 聚焦 + split 视图 + 仅 1 条作用域批注」自动展开 watch：解决 FORM-DE19AFADC087 默认折叠把 SJ 处理按钮（已修改 / 不需解决 / 提交处理结果）藏进卡片导致体感不可见的问题
  - `embedContextRestore.ts` PMS 嵌入打开 form-focused 单据时改为「`loadTaskByFormId` 直拉（8s 超时） + `loadReviewTasks` 后台 fire-and-forget」，并在 `resolveEmbedRestoreResult` 仍 missing 时回填 form-loader 命中结果；URL 已带可验证 form_id 时不再被「拉当前角色全量任务列表」阻塞
  - `useToolStore.ts` 把 `getReviewCommentThreadStore` / `getCommentsFromStore` / `liftAnnotationComment` 从运行时 lazy 引用重构为顶层 import + `_getThreadStore()` helper（符合项目 `no-inline-imports` 规则），让 `addCommentToAnnotation` 在 vitest 环境也能直接走共享 thread store
  - 新增 `useAnnotationReviewStateSync.test.ts` 1 条单测锁定多轮状态优先级；扩展 `useToolStore.persistence.test.ts` 1 条单测验证 `addCommentToAnnotation` 不依赖 runtime globals
  - 验证：`npm run type-check` 通过；6 个改动文件 `eslint` 0 error 0 warning；新增 + 扩展的两个测试 13/13 通过；双胞胎 4 套件 baseline 34 fail / 53 pass → after 34 fail / 53 pass（**0 新增 fail**，已对比 stash baseline）

- **JD/JH 可确认 SJ 已处理的驳回批注** (2026-05-18)
  - 外部 `form_id` 聚焦场景下，`ReviewPanel.vue` 同步批注处理状态改为按 `formId` 查询，不再强绑当前内部 `taskId`
  - 修复 SJ、JD、JH 在同一外部单据上恢复到不同内部 taskId 时，JD/JH 看不到 SJ 已提交的 `fixed/wont_fix`，导致“同意 / 驳回”被禁用的问题
  - 后端 `plant-model-gen` 已同步补充 `jh` 角色的 `agree/reject` 权限白名单，避免 JH token 被服务端拒绝
  - 验证：`npm run type-check` 通过；`ReviewCommentsTimeline.test.ts` 11/11 通过；`npm run build` 通过；后端本地 `cargo check` 因缺少 NASM 被环境阻断，线上部署后 `/api/health` 与 `/api/version` 均 HTTP 200

- **SJ 驳回单据批注处理确认入口恢复** (2026-05-18)
  - 修复 SJ 打开驳回/退回单据进入 `ReviewPanel` 后，评论线程调用 `buildCommentThreadKey()` 时报 `buildCommentThreadKey is not defined` 的运行时错误
  - `useToolStore.ts` 显式导入 `buildCommentThreadKey`，避免依赖 auto-import/global 类型声明导致类型层面通过但运行时未注入
  - 外部 SJ returned/rejected 场景保留 `designer-only` 时间线语义，恢复“已修改 / 不需解决 → 提交处理结果”入口，用于逐条确认批注已处理
  - 仍不开放校审侧“同意 / 驳回”动作，也不恢复新增批注/测量证据入口；“确认当前数据”继续只服务新增证据保存
  - 验证：`npm run type-check` 通过；`ReviewCommentsTimeline.test.ts` + `commentThread.test.ts` + `commentThreadStore.test.ts` 35/35 通过；`npm run build` 通过

- **SJ 外部单据仅在驳回/退回状态下进入校审面板** (2026-05-18)
  - 修正 `sj + 外部 form_id` 被无条件路由到 `ReviewPanel` 的问题：现在普通未驳回单据保持设计端落点，只有恢复到的任务确认为 canonical returned/rejected 时才显示校审面板
  - `embedRoleLanding.ts` 不再只凭 `sj + form_id` 把落点改为 reviewer；form_id 仍用于权限与批注 scope 判定
  - `embedContextRestore.ts` 新增 returned designer task panel 选择能力，供外部 SJ returned/rejected 场景路由到 `review`
  - `DockLayout.vue` 在任务恢复后结合 `isCanonicalReturnedTask()` 决定是否收敛到校审面板，避免未驳回单据也进入校审工作台
  - 验证：`embedRoleLanding.test.ts` + `embedContextRestore.test.ts` 35/35 通过；`npm run type-check` 通过；`git diff --check` 通过
  - 已知基线：面板大回归套件中 `ReviewPanel` / `DesignerCommentHandlingPanel` 仍有既有失败，本次聚焦落点逻辑未扩大修复范围

- **外部 form_id 收敛规则推广到任意 reviewer 角色（A2 升级）** (2026-05-18)
  - 产品规约：「不能跨 form_id 批注，看的就是对应单据的数据」。本次把 2026-05-18 早些只针对 SJ 的外部 form_id 收敛规则推广到任意 reviewer 角色（sj/jd/sh/pz）
  - `embedRoleLanding.ts` 新增 `isExternalFormFocusedMode(params)`，不再要求 `role === 'sj'`，只看 `isPassiveWorkflowMode + verifiedFormId`
  - `ReviewPanel.vue` 的 `scopedReviewerItems` form_id 过滤改用 `isExternalFormFocused`；原 `isExternalSjFormFocused` 保留用于 SJ 权限边界（`canCreateReviewEvidence` / `allow-review-actions`）
  - `DockLayout.vue` 的 `closeBlockedReviewPanels` 与 ribbon command 守卫（`panel.resubmissionTasks` / `designerCommentHandling` / `annotationTable`）改用更广义的 `inExternalFormFocusedMode`，保留 `inExternalSjFormFocusedMode` 用于 SJ 专用语义
  - `AnnotationOverlayBar` / `useDtxTools` 中按现有 `shouldUseDesignerPanel` 逻辑（DESIGNER 角色 + canonical returned task）对 jd/sh/pz 天然走 review 分支，无需额外升级
  - 新增 `ReviewPanel.test.ts` 用例：passive workflow + jd / sh 角色 + form_id → 表格按 form_id 收敛；原 manual workflow 用例改为「activeReviewFormId 为空时不过滤」更准确反映新规则
  - 回归差量：6 套件 33 fail / 67 pass（+1 pass，0 新增 fail）；type-check 0 error；ReviewPanel.vue + DockLayout.vue lint 0/0
  - 关键文件：`src/components/review/embedRoleLanding.ts`、`src/components/review/ReviewPanel.vue`、`src/components/DockLayout.vue`、`src/components/review/ReviewPanel.test.ts`

- **SJ 外部 form_id 入口全面收敛到 ReviewPanel** (2026-05-18)
  - SJ 经 PMS 外部流程打开带 form_id 的单据时，所有批注处理统一在审核侧 ReviewPanel 内完成，不再单独打开「批注处理」(DCH) / 「退回任务列表」/ 「发起编校审」/ 「待审核任务」面板
  - 新增 `isExternalSjFormFocusedMode()` helper，扩展 `closeBlockedReviewPanels`：SJ 外部 form_id 模式额外关闭 DCH/resubmissionTasks/initiateReview/reviewerTasks
  - Ribbon command `panel.resubmissionTasks` / `panel.designerCommentHandling` / `panel.annotationTable` 在 SJ 外部 form_id 模式下强制路由到 review
  - 重写 `DockLayout.test.ts` 中过时的「设计端被动恢复未匹配内部任务但 workflow/sync 有批注记录时仍进入批注处理」用例，改为锁定新策略「仍统一落到 review 面板，不再单独开 DCH」（转绿 1 条原 baseline fail）
  - 双胞胎 5 套件 + DockLayout 汇总：baseline 34 fail / 62 pass → after 33 fail / 66 pass（净 -1 fail / +4 pass，0 新增 fail）
  - 关键文件：`src/components/DockLayout.vue`、`src/components/DockLayout.test.ts`
  - 关联文档：`开发文档/三维校审/审核面板批注表格视图回归事故复盘-2026-05-17.md` §13、`.plannotator/plan-sj-reject-ui.md` §2 / §5

- **审核面板批注表格 form_id 收敛** (2026-05-18)
  - SJ 经 PMS 外部流程打开被驳回单据并切到「批注表格」时，不再显示其它 form_id 的批注
  - `ReviewPanel.vue` 的 `annotationWorkspaceItems` 改为先构造全集再按 `isExternalSjFormFocused` + `activeReviewFormId` 过滤，行为与同文件 `allAnnotationItems`（卡片列表）严格对齐，复用 `scopeAnnotationWorkspaceItemsByFormId` helper
  - 新增 3 条 vitest 用例锁定 form_id scope 行为（SJ 外部聚焦 / manual workflow / passive workflow+jd 角色），双胞胎面板 5 套件 baseline 33 fail / 56 pass → after 33 fail / 59 pass（0 新增 fail）
  - 关键文件：`src/components/review/ReviewPanel.vue`、`src/components/review/ReviewPanel.test.ts`
  - 关联文档：`docs/plans/2026-05-18-reviewer-annotation-table-formid-scope-plan.md`、`开发文档/三维校审/审核面板批注表格视图回归事故复盘-2026-05-17.md` §11、`.plannotator/plan-sj-reject-ui.md` §6

- **审核面板「批注表格」视图回填** (2026-05-17)
  - 恢复 reviewer 工作台（`ReviewPanel.vue`）的「卡片列表 ⇄ 批注表格」tab 切换；ribbon `panel.annotationTable` 按钮在校核面板上重新生效
  - 直接复用 `buildAnnotationWorkspaceItems` 构造 `AnnotationWorkspaceItem[]` 喂给 `AnnotationTableView`，无须新增适配器
  - 表格视图为只读浏览：行单击=选中、行双击=飞到 3D + 自动切回卡片列表、右键=复制 RefNo / 整行文本
  - 视图模式持久化到 localStorage，独立 key `plant3d-web-nav-state-reviewer-workbench-v1`，刷新后保持
  - 根因：ccb8d08（PR 8）落地的能力在某次反向 rebase 中被 028de56 之前的 ReviewPanel 版本整段覆盖；后续 merge `6ad374b` 巩固损坏
  - 关键文件：`src/components/review/ReviewPanel.vue`
  - 关联文档：`docs/plans/2026-05-17-reviewer-annotation-table-restore-plan.md` + `开发文档/三维校审/审核面板批注表格视图回归事故复盘-2026-05-17.md`

- **测量清空修复** (2026-04-29)
  - 修复顶部菜单“测量 → 清空”只按当前测量模式清理，导致画面上已有测量标签残留的问题
  - 统一清理普通测量、xeokit 测量、未完成测量草稿，以及测量模式生成的管-墙/柱距离标注
  - 保留普通“尺寸标注”，避免误删用户手动创建的尺寸内容

- **PMS 模拟器驳回流程修复** (2026-04-27)
  - 修复 `openWorkflowDialog` 和 `executeWorkflowAction` 中 `shouldUseSyncOnlyWorkflowAction` 使用过期的 `state.sidePanelMode` 导致 SH 节点无法执行 agree 操作的问题
  - 根因：`openIframe` 异步加载诊断数据（`refreshDiagnosticsSnapshot`）后才更新 `sidePanelMode`，但 `openWorkflowDialog` 在诊断加载完成前就读取了旧值 `'readonly'`，导致 `shouldUseSyncOnlyWorkflowAction` 返回 `false`，阻止了外部流程模式下的 workflow/sync 操作
  - 修复方式：在 `openWorkflowDialog` 和 `executeWorkflowAction` 中使用 `deriveSidePanelMode()` 实时计算最新的面板模式，取代可能过期的 `state.sidePanelMode`
  - 影响范围：PMS 模拟器中的三维校审驳回（return）流程，特别是 SH→PZ→SJ 的驳回链路
  - 验证：`PMS_SIMULATOR_CASE=return` 场景 17/17 断言全部通过
