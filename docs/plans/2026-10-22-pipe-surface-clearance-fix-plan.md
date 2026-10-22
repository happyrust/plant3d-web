# 管道外表面净距（管道距离 · 所有管对 / 周边检测）评审问题修复计划

> 日期：2026-10-22
> 基线：`plant3d-web` `main@1e8075af`；`gen-model` `refactor@9216e2f72`；线上后端 0.1.42
> 关联：`docs/plans/2026-10-19-pipe-row-adjacent-measurement-plan.md`（连排相邻）、`docs/plans/2026-10-19-bran-nearest-clearance-fix-plan.md`（空间计算面板的 BRAN 最近清距，本计划不涉及）、`docs/verification/pipe-nearby-clearance-2026-10-08.md`（周边检测开发验证）
> 状态：**已通过 Plannotator 评审（2026-10-22，无批注），D1–D4 按推荐方案实施。前端 T1–T10 已上线（`614ecd87`）；T8 后端在 gen-model `fix/nearby-branches`（`d3145d26a`），待并入 refactor 并发版**（实施记录见 §7）

---

## 0. 一句话概述

外表面净距的精算内核是对的：146830↔146810 精算 184.49 mm，与连排名义间隔 184 mm 吻合，误差界 0.5 mm。问题出在「管道距离」抽屉的所有管对和周边检测入口：1 个线上用不了，4 个会给错结论或无法操作，2 个数据一致性问题，另有几项可用性改进。本计划分 10 个任务（T1–T10）修复。前端任务都可以独立上线；只有 T8 的后端部分要合并 gen-model 并单独批准发布。

---

## 1. 问题清单（2026-10-22 代码核实 + 0.1.42 实测）

| 编号 | 级别 | 现象 | 根因位置 | 证据 |
| :--- | :--- | :--- | :--- | :--- |
| **F1** | P0 | 「检测这根管道的周边净距」点了必报「周边检测失败，原有结果已保留：HTTP 404 Not Found」。 | 前端 `usePipeDistanceStore.ts` L829 调 `GET /api/v1/spatial/nearby/branches`；gen-model 路由表 `src/web_service/mod.rs` L624–632 没有这条。实现只在提交 `dde17abbc`（2026-10-08），该提交只在分支 `codex/review-completion-backend`、`fix/issue86-task-workflow-history` 上，没有并入 `refactor`，0.1.42 不含。10-08 的验证记录写明 HTTP 响应用的是受控 fixture。 | 线上和开发环境的 `nearby/branches` 都是 404；浏览器截图 C。 |
| **F2** | P1 | 相连的管被报成 0 mm。首尾相接或接在三通上的两根 BRAN 外表面本来就贴着，服务端回 `distance_mm=0`（多为 `intersects=true`、`witness=aabb-overlap-center`）。列表只写「0 mm 实体外表面净距」，不标相交或相连；三维因为相交不画线。 | `runDetection` 不区分相连管对；`PipeDistanceDrawer.vue` L412–416 的 `recordDistanceText` 对相交记录也只写数字；`clearanceExternalDimensions.ts` L191–193 跳过相交记录。 | 24381/144870 区 165 根 BRAN，按首尾点几何粗判约 53 对相连，抽查 12 对全是 0 mm（11 对相交、1 对贴合）。样例库里复制出来的管道 HREF/TREF 有丢失：144991 的 TREF、145018 的 HREF 都是 0/0，但两根首尾几何相接，所以不能只靠 HREF/TREF 判断。 |
| **F3** | P1 | 「最大距离」输入框打不进数，每键入一位就被夹到 50–2000。输入 1500 依次变成 50、505、2000、20000：框里显示 20000，实际按 2000 算。输入 800 或 120，最后都是 2000。 | `PipeDistanceDrawer.vue` L381–393 的 `clampedMaxDistance`、`clampedMaxAngle` 在每次 input 时夹值，`v-model.number`（L771、L783）再把夹后的值写回输入框。「中心距估算的最大夹角」是同样写法。 | Playwright 逐键读值（`target/clearance-review/maxdist-input.mjs`）。 |
| **F4** | P1 | 超出最大距离被当成错误刷屏。所有管对里相距超过上限的管对是正常的「无结果」，现在每对一行红字，带原始代码 `beyond_max_distance:`，而且只写目标一侧的 refno，看不出是哪一对。 | `usePipeDistanceStore.ts` L543–549 把无结果的 warning 推进 `warnings`，L583–588 合成 `detectError`；L544、L562 只拼了 `targetRefno`。 | 4 根管（146830、146810、145018、144991）：2 条正常结果，外加 4 行红字（截图 A）。 |
| **F5** | P1 | 网格拟合兜底触发太宽，算法也靠不住。只要本轮一条结果都没落库，就用三维网格拟合中心距兜底，包括服务端正确答了「超出最大距离」的情况；只选两根时还会无视最大距离。此时红字写「外表面净距未算出」，其实是算出来了、只是超限。 | `PipeDistanceDrawer.vue` L117–126 只看 `lastRunSettledCount === 0`。`detectDtxBranchAxisDistances.ts` L141–188 把整根 BRAN 的顶点拟合成一条主轴，带弯头的管拟合出的轴没有几何意义；L272、L285 在只有一对时忽略上限。兜底记录和精确记录用同一个 id，`commitPipeDistanceResults`（L480–490）会把原有的精确记录换掉。 | 代码路径。本次实测的远管对没触发，是因为两根拟合轴碰巧不平行。 |
| **F6** | P2 | 检测进行中点「清空」，或切换项目、任务后，迟到的「没靠近」或「失败」回包会把刚清掉的记录以「过期」「失败」写回来。切换上下文时，还会把 A 项目的记录写进 B 项目并落盘。 | `runDetection` 的 worker 在 `await` 之后有两处写库（L545–548 标 stale、L563–566 标 failed），都没有检查 `sequence === detectionSequence`；用的 `previous` 也是 await 之前取的旧对象。现有用例（`usePipeDistanceStore.detection.test.ts` L156–190、L674–698）只覆盖了迟到的成功回包。 | 3 个临时用例（清空后迟到超限、清空后迟到失败、切换上下文后迟到超限）全部复现，用例已删。 |
| **F7** | P2 | 换个顺序重选同一组管会出重复记录。先按 A、B 检测，再按 B、A 检测，同一对就有两条：列表两行，三维两条线。 | `clearanceRecord.ts` L168–170 的 `clearanceRecordId` 有方向；`runDetection` 用的 `existingRecord`（L472–474）只查同向。现有用例 L642–656 把「3 对 6 条」当成预期。 | 单测。 |
| **F8** | P3 | 看不出最近点在哪个构件上。服务端给了两侧最近的叶子（`source_leaf_refno`、`target_leaf_refno`、`target_leaf_noun`，例如弯头、三通、阀门、直管），列表行和悬停都不显示。直管叶子返回的是 BRAN 自身的 refno。 | `PipeDistanceDrawer.vue` L435–456 的 `recordDetailTitle` 对非连排记录只显示警告。 | 代码。 |
| **F9** | P3 | n 根管要发 n(n−1)/2 个请求、4 并发。检测时只有转圈，没有进度，也不能取消。打开抽屉时，如果当前选中 2 根以上的管会自动跑一遍，没有数量上限。 | `usePipeDistanceStore.ts` L511–516、L570；`PipeDistanceDrawer.vue` L371–378。服务端每次请求都重新查两侧的叶子行；世界网格缓存满 1024 片就整体清空（`surface_clearance.rs` L57–60、L1070–1074）。 | 单次服务端 16–50 ms（热），网络往返 100–200 ms；实测 4 根 6 个请求 0.32 s。按此推算，20 根 190 个请求约 5–10 s，100 根 4950 个请求要数分钟。 |
| **F10** | P3 | 叫法和精度口径不一致。「管-管间距」量的是平行直段的中心距，状态栏却说「已生成 N 条净距记录」；「管-墙/柱净距」交互工具仍是前端网格采样估算，而服务端精算接口已经有了。 | `useDtxTools.ts` L3557–3559；L3570–3607、L3653–3766。 | 代码。 |

**确认没问题的**
- 精算链路用真实三角网格，包围盒剪枝有效（225 个叶子对只算了 9 个）。
- 方法、精度、误差界都严格校验，mm 到 m 只换算一次。
- 记录按上下文保存，重开后标「过期，待重算」。
- 迟到的成功回包有序号防护。

---

## 2. 任务拆解（T1–T10）

### T1：最大距离、最大夹角输入改为失焦或回车时校正（修 F3）

1. `src/components/pipe-distance/PipeDistanceDrawer.vue`：两个输入框从 `v-model.number` 改成 `:value` + `@change`。沿用连排输入框 `commitPositiveMm` 的思路，新增 `commitClampedNumber(event, { min, max, fallback })`：失焦或回车时夹值，并把输入框显示同步成夹后的值；输入过程中不改。
2. 单测（抽屉组件测试）：键入 1500 → 1500；键入 20 → 50，输入框也显示 50；清空 → 回到 500。

### T2：超限只汇总，红字只留真正的失败（修 F4）

1. `usePipeDistanceStore.runDetection`：每对结果分三类：
   - `settled`：正常出结果。
   - `beyond`：`result=null` 且 warning 为 `beyond_max_distance`，或客户端判定距离超过上限。
   - `failed`：HTTP 错误、口径或误差界无效、端点无效。
2. `beyond` 只计数，写进 `detectNotice`：「另有 N 对在 {上限} mm 内没有靠近，未出结果」。全部超限时也只是提示，不算错误。
3. `failed` 才进 `detectError`，每行写全两侧：「A ↔ B：原因」。原因用 `parseServerWarning` 去掉 `code:` 前缀。超过 5 行时折叠成「另有 N 对失败」，可展开看详情，沿用连排诊断的 `<details>` 样式。
4. 周边检测用同一套分类。
5. 单测：更新「某一对 result 为 null」「全部目标都没结果」两条用例的期望。

### T3：迟到回包不写库（修 F6）

1. worker 在 `await` 之后、任何写库之前，先检查 `sequence !== detectionSequence`，不一致就丢弃。
2. stale、failed 标记和 settled 结果一样先收集，等 worker 全部结束、序号仍有效时再统一写库。写库时重新 `findRecord` 拿最新记录再改状态，不用 await 之前的 `previous`。
3. 口径对齐：校验失败、客户端判定超限的管对，和「没靠近」一样，把现存的 `current` 记录标 stale。
4. 单测：补三条迟到用例（清空后超限、清空后失败、切换上下文后超限），以及「校验失败时标 stale」。

### T4：管对方向规范化（修 F7）

1. 所有管对和周边检测在发请求前，按决策 D2 给管对定方向。查现存记录时两个方向都查；发现反向的旧记录就删掉，保留它的隐藏状态。
2. 本机记录恢复时，同一无序管对如果有两个方向的重复，只留较新的一条。
3. 单测：把 L642–656 改写为「反序重跑仍是 3 条」；补恢复去重的用例。

### T5：识别相连管对，标出真相交（修 F2）

1. 新增 `src/clearance/domain/pipeConnectivity.ts`，按所选 BRAN 的中心线（首尾点、成员段）判断相连，分两档：
   - **确定相连**：A 的首或尾点与 B 的首或尾点相距 ≤ 1 mm，即同一管线首尾相接。这类不发请求，直接按决策 D1 处理。
   - **疑似相连**：A 的首或尾点靠近 B 的 TEE、OLET、CROS 成员（含零长度的穿过件），阈值用本区约 53 对样本校准。这类照发请求，回来 ≤ 1 mm 才按相连处理，否则按正常净距显示。
   - HREF/TREF 指向对方或对方名下成员时可作为加证，但样例库数据不全，不单独作依据。
2. `runDetection` 开头先取所选 BRAN 的中心线，每根 1 个请求，本轮内缓存。
3. 不相连、但服务端回 `intersects=true` 的记录：列表数值显示「相交」，悬停写出相交的两个叶子构件。
4. 单测：`pipeConnectivity.test.ts` 覆盖首尾相接、三通支管、只有几何没有 HREF/TREF、平行不相连四种情况；`runDetection` 覆盖相连管对按 D1 呈现。

### T6：显示最近处的构件（修 F8）

1. 非连排记录的列表悬停加一行：「最近处：{源叶子类型} {源叶子 refno} ↔ {目标叶子类型} {目标叶子 refno}」。
   - 目标侧类型用响应里的 `target_leaf_noun`；源侧用 `findNounByRefnoAcrossAllDbnos`。
   - 叶子 refno 等于 BRAN 本身时写「直管」。
2. 单测：组件测试断言悬停文案。

### T7：收紧网格拟合兜底（修 F5）

1. 按决策 D3 修改 `detectBransWithDtxFallback`：
   - 只有全部管对都因服务端失败（`failed`）而没出结果时，才考虑兜底。
   - 超限、相连、已有精确记录的管对一律不兜底。
   - 去掉「只有一对时忽略上限」（`includeBeyondMaxDistanceForSinglePair`）。
2. 兜底只给「近似直管」出估算：拟合主轴解释的方差 ≥ 99%，带弯头的整根 BRAN 不出。红字改为「服务端净距计算失败，以下为模型拟合中心距估算，不能用作净距验收」。
3. 单测：`detectDtxBranchAxisDistances.test.ts` 补「L 形管不出估算」；抽屉补兜底触发条件的用例。

### T8：周边检测（修 F1）

1. **前端（不依赖后端发布）**：`detectNearbyBrans` 遇到 404 时提示「当前服务端版本不支持周边检测」，本次会话里隐藏这个按钮，不再显示原始的「HTTP 404 Not Found」。
2. **后端（单独批准）**：
   - 把 `dde17abbc` 并进 gen-model `refactor`。内容包括 `spatial_branches.rs`、handler、路由、最大距离含边界的修复，以及 `examples/pipe_clearance_probe.rs`。
   - 跑 `spatial_query`、`surface_clearance` 的既有回归和新增的候选用例，随下一版发布。
   - 发布后用 146830 实测：500 mm 内的 BRAN 与所有管对的结果一致。

### T9：减少请求量，加进度和取消（修 F9）

1. **预筛**：所有管对先取每根 BRAN 的模型边界（`genModelV1ModelBounds`，每根 1 个请求，实测 83–209 ms）。两个包围盒的距离超过上限的管对直接记为超限，不发净距请求。盒距不会大于真实距离，所以不会漏。
2. **进度和取消**：检测期间显示「已算 x / N 对」和「取消」按钮。取消就是推进 `detectionSequence`，已落库的结果保留。
3. **打开抽屉时的自动检测**：按决策 D4 设上限。
4. 单测：预筛后远管对不发请求；取消后迟到的回包不写库。

### T10：叫法统一（修 F10 前半）

1. `useDtxTools.ts` L3557–3559：「已生成 N 条净距记录」改为「已生成 N 条中心距记录」。
2. 「管-墙/柱净距」改用服务端精算不在本计划内，见 §5。

---

## 3. 需要 Plannotator 拍板的决策（D1–D4）

| # | 决策项 | 推荐方案 | 备选方案 |
| :--- | :--- | :--- | :--- |
| **D1** | 相连管对怎么处理（T5） | **(a) 推荐**：不进记录、不画线，在结果区汇总一行「N 对相连（首尾或三通相接），不计净距」，可展开看是哪几对。 | (b) 照常进记录，列表把 0 mm 写成「相连」，三维不画。<br>(c) 服务端在相连处剔除相接的管件后再算，能发现「出了三通又贴着主管走」的真实净距；需要后端改动和发布。 |
| **D2** | 管对方向（T4） | **(a) 推荐**：所有管对按 refno 字典序定方向（源 < 目标）；周边检测保持「选中的管 → 周边的管」。 | (b) 不改方向，重算时沿用已有记录的方向。 |
| **D3** | 网格拟合兜底（T7） | **(a) 推荐**：保留兜底，但只在服务端失败时触发，且只对近似直管出估算。 | (b) 去掉网格拟合兜底和「中心距估算的最大夹角」输入框；服务端失败就如实报错，保留旧记录。 |
| **D4** | 打开抽屉时的自动检测（T9） | **(a) 推荐**：当前选中 ≤ 10 根管时自动检测；超过时只列出选择，并提示点「重新检测」。 | (b) 打开抽屉不自动检测。<br>(c) 维持现状，不设上限。 |

---

## 4. 实施顺序与提交

1. 先修正确性，改动小的先做：T1、T3、T4、T2，各自一个提交。
2. 再做 T5 + T6：相连识别，以及相交和最近处的显示。
3. 然后 T7、T8 前端部分、T9、T10。
4. 每一批都跑单测、`npm run type-check`（基线 471，不新增）、lint 和开发环境浏览器实测，再提交、推送、部署前端。部署照前几次的 SSH 同步，部署前先备份。
5. T8 后端部分单独提交到 gen-model `refactor`；推 `publish` 发版前再请你批准。

---

## 5. 不在本计划内

- 「管-墙/柱净距」交互工具改用服务端精算（F10 后半）。
- 一对多的批量净距接口，用来彻底解决 O(n²) 请求量：等 T9 预筛上线后看实际规模再定。
- 网格是面不是体：一根管完全包在另一根里（套管）时，会报正距离而不是相交。保温、包络的口径仍待业务确认（10-08 验证记录已列出）。

---

## 6. 验证与回归清单

- [ ] **单元测试**：
  - `npx vitest run src/composables/usePipeDistanceStore.detection.test.ts`
  - `npx vitest run src/clearance/domain/pipeConnectivity.test.ts`
  - `npx vitest run src/utils/three/geometry/clearance/detectDtxBranchAxisDistances.test.ts`
  - `npx vitest run src/components/pipe-distance/`
  - 全量 `npx vitest run`：只允许既有的 form-binding 一条失败。
- [ ] **静态检查**：`npm run type-check` 保持 471、不新增；lint 0 错误。
- [ ] **开发环境浏览器实测（后端 0.1.42）**：
  - 4 根管（146830、146810、145018、144991）做所有管对：146830↔146810 = 184 mm；145018↔144991 按 D1 呈现，不出现「0 mm」；没有红字，提示「另有 N 对在 500 mm 内没有靠近」。
  - 最大距离键入 1500、800、120，失焦后分别是 1500、800、120；键入 20 → 50。
  - 反序重选同 4 根：记录数不变。
  - 只选 146830 点周边检测：0.1.42 下提示「服务端版本不支持」，不显示 HTTP 404；后端发版后返回 500 mm 内的 BRAN。
  - 框选 20 根以上：显示进度和取消，取消后不再写入。
- [ ] **线上冒烟**：部署后用同 4 根管复测，`/version.json` 显示新提交。

---

## 7. 实施记录（2026-10-22）

| 任务 | 提交 | 说明 |
| :--- | :--- | :--- |
| T1 | `a6f42e49` | 最大距离、最大夹角输入框失焦或回车时才校正 |
| T3 | `fdd6e8f9` | 清空或换上下文后迟到的净距回包不再写回记录 |
| T4 | `a7a40973` | 所有管对按 refno 定方向，反序重选不再出重复记录 |
| T2 | `103c4f51` | 超出最大距离只汇总成一句提示，红字只留计算失败的管对 |
| T5 + T6 | `ead94b99` | 相连的管不计净距，相交写「相交」，悬停显示最近处的构件 |
| T7 | `97e3fbeb` | 网格拟合兜底只在服务端全部算失败时触发，且只给近似直管出估算 |
| T8 前端 | `9f41ddad` | 服务端没有周边检测接口时提示版本不支持并收起入口 |
| T9 | `23b66190` | 所有管对先按模型包围盒预筛，检测中显示进度并可取消 |
| T10 | `614ecd87` | 「管-管间距」生成的是中心距记录，状态栏不再叫净距记录 |
| T8 后端 | gen-model `d3145d26a`（分支 `fix/nearby-branches`） | `dde17abbc` 挑到 refactor `635bf7a90` 上，无冲突 |

**实施偏差**
- T1、T6 的单测落在抽出的纯函数上（`numberInput.ts`、`pipeClearanceLeavesText`）：抽屉没有组件测试，界面部分靠浏览器实测。
- T5 没有用 HREF/TREF 加证：疑似相连本来就要等净距 ≤ 1 mm 才算相连，几何判定已够，省掉每根一个属性请求。
- T7 的触发条件抽成 `needsAxisEstimateFallback`，便于单测。

**验证**
- 类型检查 471 条，等于基线；全量测试 3485 条通过，只有既有的 form-binding 一条失败。
- 开发环境浏览器（后端 0.1.42），4 根管做所有管对：只发 1 个净距请求（包围盒筛掉 4 对、相连 1 对不发），结果 184 mm，提示「另有 4 对在 500 mm 内没有靠近，未出结果；1 对相连（首尾或支管相接），不计净距」；最大距离键入 1500 / 800 / 20 失焦后为 1500 / 800 / 50；反序重选记录数不变；周边检测提示版本不支持并收起按钮。
- 线上 `614ecd87`：首页 200，包内确认有新文案。
- T8 后端：lib 测试（spatial_query / surface_clearance）50 通过、1 忽略（live 计时）；`pipe_clearance_probe` 候选规则全部成立，8 组解析例（含 500 mm 含边界）误差 0 mm、正反顺序一致。发版后再用 146830 实测周边检测。
