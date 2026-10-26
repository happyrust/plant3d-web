# 排管测量「连排相邻」真实浏览器端到端验证（2026-10-22）

对被测功能「排管测量」（管道距离抽屉 →「连排相邻」模式）做的真实浏览器端到端实测报告。
配套功能说明 / 操作教程 / 期望值基线见 `docs/verification/pipe-row-adjacent-2026-10-22/README.md`
（下称「功能文档」，其 §3.4 为数值期望基线、§四 为已知限制）。

**结论先行**：两套后端全部 PASS。R1–R6 + O1 全部断言通过，功能文档 §3.4 的全部数值期望
（中心距 208/207/206 mm、名义间隔 187/186/184 mm、管底对齐 511/478 mm、O1 直段 ~206/184 mm）
在两套后端上均命中。0 缺陷、0 未捕获页面错误；2 条环境差异与 4 条 401 控制台噪声已记录（§6）。

## 1. 目的与范围

`scripts/pipe-row-browser-verify.mjs` 是一个自包含、可复跑、fail-closed 的验证脚本：

- 编程式起 Vite dev server（默认端口 `3191`，`strictPort`），用系统 Chrome
  （Playwright `chromium.launch({ channel: 'chrome' })`，无头，不依赖内置 Chromium）。
- 打开真实 app `/?output_project=AvevaMarineSample`，先注入 e2e 惯例 localStorage
  （`plant3d-menu-mode=classic`、清 `plant3d-onboarding-v1`），用真实 UI 交互
  （功能区「测量 → 管道距离」打开抽屉、点模式按钮 / 勾选框 / 输入框 / 隐藏按钮），
  并用 DEV 钩子 `window.__plant3dPipeDistanceE2E`
  （`detectPipeRows` / `detectBrans` / `detectPipeRowTubes` / `getSnapshot`）驱动检测、读快照。
- 逐场景断言 R1–R6（+ 可选 O1 直段 TUBI），每步截图并写 `evidence.json`；
  **任何断言失败或环境不可达都以非零码退出**，不为跑绿放宽断言、不伪造证据。
- 覆盖「选管（整根 BRAN / 直段 TUBI）→ 归排（管中心成排 / 管底对齐）→ 识别预览
  （已生成 / 待确认）→ 确认生成 → 结果记录（中心距 D 与外径推导间隔 G）→ 列表与三维标注
  （「同时显示中心距」「三维显示关键点」）」全链路。

**后端连接方式**：脚本以 `?gm_backend=/gm` 打开页面，并在拉起 Vite 时注入
`VITE_GEN_MODEL_V1_PROXY_TARGET=<backend>`，使 `/gm` 经 `vite.config.ts` 的同源代理
转到目标 gen-model 后端（即功能文档现行连法，规避跨域）。

**期望档自动选择**：脚本先 GET `<backend>/api/v1/health` 读 `version`——

- `version ≥ 0.1.42` → `modern` 档（现行期望）：逐段 `diameter_evidence` + 直段身份 `tube`，
  推导间隔按目录外径计算、**不带 ≈**，管底对齐**直接生成**不待确认；
- 更旧（或 version 缺失）→ `legacy` 档（降级期望）：中心线无逐段外径来源，按成员外径估算，
  推导间隔**带 ≈**，管底对齐排**「待确认（估算外径）」需「确认生成」**，
  检测提示旧服务端外径估算。

## 2. 复跑命令

```bash
# 主测：线上后端（文档现行环境），证据输出到默认目录
node scripts/pipe-row-browser-verify.mjs

# 辅测：本机 0.1.40 降级路径，证据输出到 local-0.1.40/
node scripts/pipe-row-browser-verify.mjs --backend http://localhost:8022 --out docs/verification/pipe-row-browser-2026-10-22/local-0.1.40

# 参数说明
node scripts/pipe-row-browser-verify.mjs --help
# usage: node scripts/pipe-row-browser-verify.mjs [--backend <url>] [--out <dir>] [--port 3191]
```

退出码：0 = PASS；非 0 = 断言失败或环境不可达（后端 health 不通、Chrome 缺失、端口被占、
钩子不可用等）。结束时自动关闭 browser 与 Vite server。

## 3. 环境记录

| 项 | 主测（online-0.1.42/） | 辅测（local-0.1.40/） |
| --- | --- | --- |
| 后端 URL | `http://123.57.182.243:3100` | `http://localhost:8022` |
| **实测 version** | **0.1.43**（build `0.1.43+gd3145d26a71a`） | **0.1.40**（build `0.1.40+g36408c867612`） |
| 期望档 | modern（≥0.1.42） | legacy（<0.1.42） |
| 运行时间（UTC） | 2026-10-22T17:49:22 → 17:49:44 | 2026-10-22T17:41:48 → 17:44:08 |
| 结果 | PASS（exit 0） | PASS（exit 0） |
| 前端 | HEAD `0d7a1138` + 工作区未提交改动 | 同左 |
| Vite / Chrome | `http://127.0.0.1:3191` → `/gm` 代理；系统 Chrome headless | 同左 |
| 项目 / dbnum | `AvevaMarineSample` / `7997` | 同左 |

**与文档基线的环境差异（如实记录，非缺陷）**：功能文档把线上后端记作 `0.1.42`，本次实测
health 返回 **`0.1.43`**（服务端在该目录命名之后已升级一档）。版本 ≥0.1.42，能力面一致
（`diameter_evidence` / `tube` 均在），脚本按 modern 档断言，全部数值命中，不影响结论；
证据目录名 `online-0.1.42/` 保留文档基线命名以免混淆历史引用。

**工作区状态（如实记录）**：测试在 HEAD `0d7a1138` + 用户未提交改动的工作树上运行，其中包括
`src/components/pipe-distance/PipeDistanceDrawer.vue` 的一处 WIP——抽屉在检测 / 定位时
**自动把选中 BRAN 载入三维场景**。实测表现：

- online：页面 `show_refno` 就绪，初始场景 100 个对象、12 个已载 refno；检测后 WIP 自动加载
  生效，R3 截图时场景对象增至 256、被测 BRAN 成员进入 `loadedRefnos`——三维里既有标注也有
  真实管道实体，WIP 未干扰检测 / 列表行为，作为正常观察记录。
- local：`show_refno` 模型 90 s 内未就绪，场景 229 个对象但 `loadedRefnos` 为空
  （三维里只有标注没有管道实体）——与功能文档首轮「只有标注」情形一致，记为差异（§6-D1），
  未归因为 WIP 缺陷。该后端当时自身处于降级态（mirror degraded、`sul_db` 断连、
  read-through spool checksum mismatch），是更可能的解释。

## 4. 场景矩阵：实测 vs 功能文档 §3.4 期望

断言策略：**阻断性断言以「结构 + 内部一致性」为准**——排 / 对计数与预览状态、
每对必有中心距 + 推导间隔两种记录、`G = D − (OD₁+OD₂)/2` 在 0.6 mm 容差内成立、
缺省列表只列 derived-gap、勾选「同时显示中心距」后行数 ×2 且两种度量都在、
模式隔离（清空 / 隐藏只作用当前模式）、边界参数生效并可恢复。
文档 §3.4 的具体数值作对照记录进 evidence.json 与下表，数值差异记 difference 而不阻断——
这是有意设计：换后端 / 换数据集时几何值可合理不同，结构契约才是被测对象。
本次两套后端数值全部命中，无数值差异。

| 场景 | 文档期望 | online 0.1.43（modern） | local 0.1.40（legacy） | 结果 |
| --- | --- | --- | --- | --- |
| **R1** 打开与缺省 | 连排相邻；管中心成排；排内相邻上限 1000（清空回 1000）；最短共同区段 300；「同时显示中心距」「三维显示关键点」缺省关 | 全部命中（输入框显示与 store 同步均验） | 全部命中 | PASS |
| **R2** 管中心成排 3 根 | 3 排 3 对全「已生成」；D≈208/207/206 mm；G≈187/186/184 mm；缺省只列名义间隔；勾「同时显示中心距」→ 两种都出；取消还原 | 3 排 3 对 0 待确认；D=208.34/207.12/205.79 mm；G=187.0/185.8/184.5 → 显示 187/186/184 mm；6 条记录（3 对 × 2 度量）；列表 3 行 ↔ 勾选 6 行 ↔ 还原 3 行；外径证据 catalogue/catalogue，无 ≈ | 同上几何（D/G 完全一致）；3 条推导间隔均带 **≈**（≈187/≈186/≈184）；detectNotice 提示旧服务端外径估算 | PASS |
| **R3** 三维 | 「三维显示关键点」出中心 × / 外表面点 ○；列表点行定位 / 高亮；三维尺寸线 | keyPoints on 断言通过；点行后激活记录 `piperow:center:derived-gap:…@-4383.1--4061.3`；场景 256 对象（WIP 已载入管实体），截图存证 | keyPoints on、点行激活同样通过；场景只有标注（D1），截图存证 | PASS |
| **R4** 模式隔离 | 隐藏 / 显示一排；「清空」只清当前模式；「另有 N 条其他模式的结果」提示 | 隐藏一排 → 2 条记录进隐藏集、列表 3→2；显示恢复 3；`detectBrans` 得 1 条所有管对记录、连排 6 条不动；提示「另有 1 条其他模式的结果仍显示在三维中」；切所有管对 → 清空后连排仍 6 条 | 隐藏 / 显示、隔离同样通过；所有管对检测**未产出记录**（后端 surface-clearance 超时，见 §6-D2）；`modeResults=0` 时「清空」按 v-if 不显示——符合 UI 设计，记 note 而非缺陷 | PASS |
| **R5** 管底对齐（阀组） | 1 排 1 对；D≈511 mm、G≈478 mm；0.1.42 直接生成；旧端「待确认（估算外径）」→「确认生成」 | 1 排 1 对，D=510.95、G=477.6 → 显示 478 mm；formal=true、estimated=false；0 待确认 | 同 1 排 1 对（D=510.95）；`formal:false, estimated:true` → 预览「待确认（估算外径）」，「确认生成」后出 2 条记录、列表显 ≈478 mm | PASS |
| **R6** 参数边界 | 上限改小 → 排 / 对减少或断开；最短共同区段改大 → 短区段不成对；回缺省与 R2 一致 | 上限 204 mm → 0 对；最短共同区段 100 m → 0 对；恢复缺省重测 3 排 3 对、值 187/186/184 mm | 同样：0 对 / 0 对 / 恢复 ≈187/≈186/≈184 | PASS |
| **O1**（可选）直段 TUBI | `detectPipeRowTubes` 选 `24381_146830` 两段平行直段 → 1 排 1 对（~206/184 mm，区段 ~1.78 m） | `detectPipeRowTubes` ok；groups=1 / pairs=1；选段 `24381_146830#24381_146832-24381_146833#3` ↔ `24381_146810#24381_146813-24381_146814#4`，中段距 ≈207 mm；该对与 R2 既有对重合去重，列表仍 4 行（478/187/186/184） | 同（gaps 带 ≈） | PASS |

**O2（可选，辅测后端降级路径）**：由整轮 `local-0.1.40` 运行覆盖——R2 / R5 在 0.1.40 上
全程走降级期望并实测通过（≈ 外径、管底对齐待确认 → 确认生成、detectNotice 文案），见 §5。

## 5. 两档行为差异（modern vs legacy，均按档断言通过）

| 行为 | modern（0.1.43 实测） | legacy（0.1.40 实测） |
| --- | --- | --- |
| 外径来源 | 逐段 `diameter_evidence`，证据 `catalogue/catalogue` | 无逐段外径来源，按成员外径估算 |
| 推导间隔显示 | `187 mm` / `186 mm` / `184 mm` / `478 mm`（不带 ≈） | `≈187` / `≈186` / `≈184` / `≈478 mm`（带 ≈） |
| 管底对齐排 | 直接生成（`formal:true`、`estimated:false`，0 待确认） | 待确认（`formal:false`、`estimated:true`，原因含「估算外径」），「确认生成」后出 2 条记录 |
| 检测提示 | `detectNotice=null` | `detectNotice`：「中心线接口未提供逐段外径来源（旧服务端），3 根管道按成员外径估算：推导间隔带 ≈，管底对齐的排需确认后生成」 |
| 诊断条 | 6 条诊断（穿过件无长度不参与走廊、3 个管向组无合格共同区段）——信息性，非错误 | 同型诊断 + 估算提示 |

几何结果（各对 D / G 数值）两档完全一致，降级只影响外径证据强度与确认流程，符合功能文档
§四 已知限制的描述。

## 6. 差异、缺陷与限制

`defects: []`（两目录均零缺陷）；`pageErrors: []`；`failures: []`。

**记录差异（evidence.json `differences`，local 档 2 条，online 0 条）**：

- **D1（S1，local）`show_refno` 模型 90 s 内未就绪**：三维里只有标注没有管道实体，与功能文档
  首轮情形一致；标注与定位功能本身全部通过。环境上下文：当时该后端 health 显示 mirror
  degraded、`sul_db.connected=false`（累计断连 348 次）、read-through 因 mirror spool
  checksum mismatch 降级——判定为后端环境限制而非前端缺陷。
  复现：`node scripts/pipe-row-browser-verify.mjs --backend http://localhost:8022 --out <dir>`，
  看 `evidence.json` → `steps[S1].observations.modelLoaded=false` 与 `differences`。
- **D2（R4，local）所有管对检测未产出记录**：3 条 `surface-clearance` 请求各 30 s 超时
  （`gen-model 请求超时 30000 ms: /api/v1/spatial/surface-clearance`，对
  `24381_146810↔24381_146830`、`24381_145018↔24381_146830`、`24381_145018↔24381_146810`）。
  连排检测不受影响（连排 6 条记录完整）；「另有 N 条」提示因无其他模式结果未出现、
  「清空」按钮因 `modeResults=0` 按 v-if 不渲染（符合 UI 设计，evidence 记 note）。
  判定为旧后端在该负载 / 降级态下的能力限制，非本功能缺陷。复现同上，看
  `evidence.json` → `differences[R4]` 的 `detectError` 全文。

**健康噪声（两目录同）**：`consoleErrors` 4 条，均为
`Failed to load resource: the server responded with a status of 401 (Unauthorized)`
——页面内既有资源 401，与排管功能无关，按观察记录未作断言。

**未覆盖项与剩余风险**：

- 「三维显示关键点」的 × / ○ 标记以 store 状态 + 截图存证，未对 Three.js 场景图元逐一做
  像素级计数（headless 下以状态断言为准）。
- local 档三维未加载管道实体（D1），该档下尺寸线 / 关键点只验证了标注层。
- O1 断言的是「检测返回 + 选段状态 + 结果结构」，未单独核区段长度值（文档 ~1.78 m 为参考）。
- 单次运行、单数据集（AvevaMarineSample/dbnum 7997）；其他数据集的数值不适用本报告对照。

## 7. 证据清单

每次运行产出 `evidence.json`（含后端 health 全文、每步断言 / 观测、控制台与页面错误、
differences/defects/failures）+ 14 张 PNG：

| 文件 | 对应场景 |
| --- | --- |
| `01-r1-drawer-defaults.png` | R1 抽屉打开 + 连排相邻缺省设置 |
| `02-r2-center-preview-list.png` | R2 检测后识别预览（3 排 3 对已生成）+ 结果列表 |
| `03-r2-both-metrics.png` | R2 勾选「同时显示中心距」后双度量列表 |
| `04-r3-keypoints-3d.png` | R3 开启「三维显示关键点」后的三维标注 |
| `05-r3-row-locate.png` | R3 列表点行定位 / 高亮 |
| `06-r4-row-hidden.png` | R4 隐藏一排后的列表状态 |
| `07-r4-other-mode-notice.png` | R4「另有 N 条其他模式的结果」提示 |
| `08-r4-mode-isolation.png` | R4 切所有管对模式 + 清空后隔离状态 |
| `09-r5-bottom-align.png` | R5 管底对齐（local 为确认生成后状态） |
| `10-r6-max-adjacent-break.png` | R6 相邻上限改小 → 断开 |
| `11-r6-min-common-break.png` | R6 最短共同区段改大 → 不成对 |
| `12-r6-restored.png` | R6 恢复缺省重测与 R2 一致 |
| `13-o1-tube-detect.png` | O1 直段 TUBI 检测 |
| `14-final-state.png` | 收尾页面状态 |

完整路径：

- `docs/verification/pipe-row-browser-2026-10-22/online-0.1.42/{evidence.json, 01–14-*.png}`
- `docs/verification/pipe-row-browser-2026-10-22/local-0.1.40/{evidence.json, 01–14-*.png}`

## 8. 复现与排错

- 复跑：见 §2 两条命令；`--backend` / `--out` / `--port` 可换。
- 失败判读：进程非零退出即失败——看 stdout 中 `FAIL`/异常行、`evidence.json` 的
  `failures` 数组（每条含 step/desc/detail）与 `steps[].assertions` 中 `ok:false` 项；
  对照当步 `NN-*.png` 截图看页面实际状态。
- 环境不可达（后端 health 不通 / 系统 Chrome 缺失 / 3191 被占 / 钩子超时）同样非零退出，
  错误打在 stderr。
- 数值复核：evidence.json 中 `steps[R2].observations` 给出 `preview.groups`
  （每对 D 与共同区段米值）、`values.centerDistancesMm`、`values.gaps`，
  及每条断言 detail 内的 `D/OD/G` 实算对照。

## 9. 交付注意事项

- 仓库 `.gitignore` 含 `scripts/*` 忽略规则，**本验证脚本默认不会被 git 跟踪**；
  若要随版本入库，需在 `.gitignore` 增加 `!scripts/pipe-row-browser-verify.mjs`
  （本报告只作说明，未改动 `.gitignore`）。
- 本次任务只测不改：未修改任何 `src/`、`e2e/`、`package.json` 或其它脚本；
  工作区既有未提交改动（含 `PipeDistanceDrawer.vue` 的自动加载 WIP）原样保留，其浏览器
  行为已如实记录于 §3；发现的差异均为环境 / 旧后端限制，无产品缺陷可修。
- 新增文件仅：`scripts/pipe-row-browser-verify.mjs` 与本目录全部产物。

## 10. 验收自评（A1–A5）

| 验收 | 自评 | 依据 |
| --- | --- | --- |
| **A1** 脚本自包含 / 可复跑 / fail-closed；线上跑通且断言有实际内容（R1–R6） | **满足** | `node scripts/pipe-row-browser-verify.mjs` exit 0；R1–R6 共 50+ 条实质断言全绿（计数、内部一致性、UI↔store 同步、模式隔离、边界恢复）；断言失败路径非零退出（fail-closed by design） |
| **A2** 本机 0.1.40 降级路径跑通并记录降级现象 | **满足** | local run exit 0；实测并记录：推导间隔带 ≈、管底对齐「待确认（估算外径）」→「确认生成」出记录、detectNotice 旧服务端外径估算文案（§5） |
| **A3** 未动产品代码与既有单测：vitest 基线全绿 | **满足** | 声明命令 7 个测试文件 **91/91 通过**；`git` 侧本任务仅新增脚本与本文档目录 |
| **A4** 新脚本 eslint 干净 | **满足** | `npx eslint scripts/pipe-row-browser-verify.mjs` exit 0（最终版重验） |
| **A5** 截图与 evidence.json 齐备、报告逐条对照、差异有复现（Lead 复核） | **满足，待复核** | 两目录各 14 PNG + evidence.json；§4 逐条对照 §3.4 期望；§6 差异含复现步骤与证据指针 |

> 以上为执行侧自评；最终验收以 Lead 复核为准。
