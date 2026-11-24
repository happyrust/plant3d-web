# Specification & Runbook: `mbd-pml-golden-and-release`（Spec 005 · Module 4）

**Status**: Ready for Release Window & E3D Host（成文就绪；实际推送 `publish` 分支与 E3D 上机采集需人工窗口触发）  
**Module**: `mbd-pml-golden-and-release`（`specs/005-mbd-dimension-closure/CAPABILITY-MAP.md` 第四模块）  
**Prerequisites Completed**:
- Module 1 (`mbd-mainline-convergence`): `plant-mbd` `github/main` @ `3dbf13ae`、`gen-model` `origin/refactor` @ `229f50329`、`plant3d-web` `origin/main` @ `4f08e2a6`
- Module 2 (`mbd-batch-and-diagnostics-ux`): `plant3d-web` `origin/main` @ `f5e549c9`（`#133, #135, #136, #137, #138`）
- Module 3 (`mbd-viewport-and-sync-integration`): `plant3d-web` `origin/main` @ `c399dc48`（`#139, #140, #141, #142, #145`）
**Tickets**: `#143`, `#144`, `#146`, `#147`, `#148`, `#149`

> 安全约束（`#143` AC-4）：本文档严格不记录任何服务器 IP 地址、主机名、账号与凭据。

---

## 1. Objective

1. **服务器升级上线闭环（`#143` → `#144`）**：给出精确到每个依赖仓 SHA 的服务器发布计划、前置依赖对齐步骤、配置核定原则、分步推送顺序、上线后验收项与一键回退办法；待服务器确认所有标注包携带 `meta.coverage` 后，执行 `#144` 移除前端按排版模式名猜测的旧服务端兜底。
2. **E3D 实机 PML 金样导出与裁决闭环（`#146` → `#147` → `#148` / `#149`）**：给出具备完整 MBD 模块与项目输入数据目录（`inputdata`）的 E3D 机器就绪标准、九类标注样本与 22 项边界问题的一次性上机导出与观察清单，以及导入 `plant-mbd` 运行 `pml diff` 回写 7+ 条裁决的操作规程。

---

## 2. 服务器部署计划（`#143` 成文方案）

### 2.1 八仓基线与 CI 构建依赖核查表（2026-11-18 实测）

`gen-model/.github/workflows/linux-binary.yml` 在推送 `publish`（或 `ci/linux-build-*`）分支时会直接编译并部署服务端二进制，其编译期克隆 5 个 `vendor` 仓在 GitHub 上的 `main` 分支及 `plant-ui` 的 `master` 分支：

| 仓库 | CI 默认拉取分支 | 当前 GitHub 远端 SHA | 本机工作区状态 | 推 `publish` 前置动作 |
|---|---|---|---|---|
| `plant-mbd` | `main` | `3dbf13ae` | 已包含全类型 MBD 与 21 笔全库修正 | **已就绪，无需额外推送** |
| `e3d-model` | `main` | `07b73d2` | 与本地 `main` 一致 | **已就绪** |
| `e3d-attlib` | `main` | `82c91d4` | 与本地 `main` 一致 | **已就绪** |
| `e3d-io` | `main` | `f665e0e` | 本地 `main` 在 `37fd005`（**本地领先远端**） | **必须先核对并推送至 GitHub `main`（若 `229f50329` 依赖新接口）** |
| `old-aios-core` | `main` | `553c3d4` | 本地分支在 `4567fc0`（**本地领先远端**） | **必须先核对 `229f50329` 针对 `553c3d4` 能否编过；若需新提交则先合入并推送至 GitHub `main`** |
| `plant-ui` | `master` | `fed994103` | `web/public` 10 个内嵌文件齐全（若需同步最新选中高亮 WASM 可选择性更新 `master`） | 核对 `web/public` 10 个必需文件存在 |
| `gen-model` | 触发分支 `publish` | `origin/publish` = `d0a0d6ae9`；**待发目标 `origin/refactor` = `229f50329`** | `229f50329` 已含全类型 MBD 与 17 笔宿主修正 | **排在上面 5 个 `vendor` 仓 GitHub `main` 干净编过之后再推** |
| `plant3d-web` | 手工触发部署工作流 | **`origin/main` = `c399dc48`** | 已含模块 1–3 全部前端修复与体验收口 | **服务端上线验证通过后，整分支触发前端部署** |

### 2.2 服务器配置原则（`DbOption.toml` / `[mbd_type_rules]`）

- 联调后端使用的 10 条 `[mbd_type_rules]`（如限定 `/1PTU-INST23` 按 EM9、排除电缆桥架 SITE）是针对样例工程 SITE 命名编写的，**不得原样照抄到生产服务器**；
- 生产服务器若未配置 `[mbd_type_rules]`，服务端自动使用内置缺省判型表（九类标注均可正常判出并返回 `meta.coverage`）；若生产项目存在电缆桥架或特殊仪表区，应按生产项目实际 SITE / ZONE 命名单独核定 `[mbd_type_rules]` 后再写入服务器配置分支。

### 2.3 严格发布顺序（每次执行 `git push` 前须将清单交用户确认）

1. **Step 1 — 干净环境预编译校验（阻塞门禁）**：
   - 在临时干净目录按 `linux-binary.yml` 同款布局检出 `gen-model`（`229f50329`）与 GitHub 远端当前的 5 个 `vendor/*/main` + `plant-ui/master`；
   - 若 `e3d-io` 或 `old-aios-core` 因落后导致编译不过，先将对应依赖仓经测试的 `main` 推送到 GitHub（征得确认后执行），再次在干净目录跑通 `cargo build --release --bin aios-database` 与 8 个 MBD 测试目标。
2. **Step 2 — 试编分支验证（推荐）**：
   - 先推送一次性构建分支或使用 `workflow_dispatch` 验证 Ubuntu Runner 构建全绿，确认产物 `aios-database --version --json` 输出预期 SHA。
3. **Step 3 — 推进服务端 `publish` 分支**：
   - 确认构建无误且保存好当前 `origin/publish` 基点 SHA（`d0a0d6ae9`）后，将 `229f50329` 合入/快进至 `publish` 并推送，监控 `linux-binary.yml` 部署完成。
4. **Step 4 — 部署前端 `plant3d-web`**：
   - 从 `plant3d-web` `origin/main`（`c399dc48`）手工触发前端部署（前端按整分支发布）。
5. **Step 5 — 上线后三项必验**：
   - 核对服务端健康接口与版本信息包含 `229f50329`、前端版本包含 `c399dc48`；
   - 在服务器页面分别打开 **1 个支架、1 台设备、1 面墙（及 1 条管道）** 的 MBD 标注，确认正常渲染且响应 JSON 中均携带 `meta.coverage`；
   - 将核对版本号与结果（不含任何服务器地址与凭据）记入 `docs/verification/`。

### 2.4 回退预案（Rollback Plan）

- **服务端回退**：若上线后健康检查异常或出现阻塞回归，立即将 `publish` 分支强推回部署前记录的稳定提交 `d0a0d6ae9` 触发重部署（或在宿主机切换回上一版备份的 `aios-database` 二进制并重启服务）；因 MBD 端点为纯只读计算接口，不改写业务库，回退零数据迁移风险。
- **前端回退**：将前端静态站点切回部署前构建产物，或从部署前 tag 重新触发前端发布。

---

## 3. `#144` 收口检查单（排在 `#143` Step 5 验证通过之后执行）

当生产服务器已确认运行带 `meta.coverage` 的服务端版本后，在 `plant3d-web` 执行一次小提交收口 `#144`：

- [ ] 删除 `src/dimension/ui/DimensionPanelDock.vue`（及相关辅助文件）中按 `layoutMode` 名称猜测的 `PARTIAL_LAYOUT_MODES` 兜底逻辑；
- [ ] 确保缺省 `meta.coverage` 的标注包不再误报「本分支标注不完整」，而声明了 `meta.coverage` 且缺失期望类别的标注包照常列出缺失种类；
- [ ] 运行 `tgrep "PARTIAL_LAYOUT_MODES" src/` 确认全仓零命中，跑通 `DimensionPanelDock.test.ts`、`npm run type-check` 与 `npx eslint --max-warnings=0`，并在提交说明中写明已核对的服务器服务端版本号。

---

## 4. E3D 实机 PML 金样导出与裁决闭环规程（`#146 → #147 → #148 / #149`）

### 4.1 环境就绪标准（`#146`）

- E3D 3.1 可正常启动并打开样例工程对应 MDB，PML MBD 模块及项目号对应的输入数据目录（`inputdata` 材料表等）齐全；
- 管道、支架、设备、土建/建筑四个 MBD 窗体均可打开，勾选「标注后生成 JSON」跑通 `BRAN 24381_145018` 且导出的 JSON 能被 `vendor/plant-mbd` 的 PML 对照工具读取；
- 在 `vendor/plant-mbd` 金样说明中记录：E3D 版本、工程与 MDB、单位、导出配置、文件与截图命名约定，以及「实机看到的」与「据此推断的」分列格式。

### 4.2 一次性上机导出与观察清单（`#147`）

1. **九类标注基准金样**：`em4_pipe / em9_pipe / em4_supp / em9_pipe_supp / em9_inst_supp / em4_equi / em9_equi / civil / arch` 每类至少导出 **2 个样本**的 PML JSON + 视口截图，另单独截取 **坡度符号（G9）**（实心/描边、字高比例、正负零坡画法）。
2. **管道专项（7 项）**：
   - `24383_100538`（66°）与 `24381_145480`（89.4°）安装角度弧半径与字距（核对 `D-PIPE-046`）；
   - `24383_76302` 调整焊（`24383_76303`）符号朝向与 `+50` 归属；
   - `24381_145859`（WELD `24381_145863`）无说明文字焊缝的默认字样与车间/现场归类；
   - 空支管 `24381_177395`、首端未设坐标支管 `24381_177515` 的 PML 行为；
   - 电缆桥架 `24383_99996` FTUB 成员的 `AOD` 返回值；
   - `24383_66479`、`24381_177376` 非同轴隐含直管 E3D 是否绘制。
3. **支架专项（7 项）**：
   - 无截面型钢支架 `24383_80213`、`24384_2250`、`24384_108` 的 PML 报错/出图行为与字高；
   - 桥架附件 `24384_108`、`24383_87548` 的 `AOD` 返回值；
   - 纯管卡支架 `24383_87548`、`24384_2031` 的字高、定位尺寸平面与附件排序（`D-SUPP4-029`）；
   - HREF 跨名附件 `24383_68871`（`D-SUPP4-003`）、缺 P5 螺栓 `24383_86118`、暖通支架 `24381_71247`（`D-SUPP4-033`）。
4. **设备 / 土建 / 建筑专项（8 项）**：
   - 模板墙 `15201_379 / 380 / 381` 是否被设备找墙收录；
   - 无 SITE 墙在楼板收墙时的判定；
   - 整圆弧墙 `24381_2147 / 24381_4342` 与竖楼板 `24381_25804`（`D-CIVIL-025 / 026`）；
   - 叠放建筑楼板 `24381_38695 / 39088 / 39170 / 39319` 房间号是否重复标出（`D-CIVIL-017`）；
   - 无名 `CFLOOR` 属主楼板名、零投影土建尺寸段（`civil.dim_degenerate`）、远原点复制设备 `24381_103159`、局部 Z 朝下墙 `24381_31100`。

### 4.3 金样入仓与裁决更新闭环（`#148` / `#149`）

- 将九类至少 18 份真实 PML 导出 JSON 放入 `vendor/plant-mbd` PML 对照目录并接入 CI 门禁测试；
- 每条 `pml diff` 差异逐一落实去向（小偏差直接修求解器附提交号、有意修正登记裁决号、大项单独立票）；
- 将 `D-PIPE-046`、`D-CIVIL-017`、`D-CIVIL-025`、`D-CIVIL-026`、`D-SUPP4-003`、`D-SUPP4-029`、`D-SUPP4-033` 等条款从「读代码推断」更新为「实机核对过」；若用户提供含项目定制 UDA 的工程库则同步核验 `#149`。
