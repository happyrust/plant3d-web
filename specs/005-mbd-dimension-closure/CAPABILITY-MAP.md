# Capability Map: MBD 三维尺寸标注全量收口与工程化演进（Spec 005）

**Created**: 2026-11-18  
**Phase**: `spec-driven-development` Modules 1–3 Completed & Pushed to Remote Mainline（第一模块 `4f08e2a6` / `3dbf13ae` / `229f50329`、第二模块 `f5e549c9`、第三模块 `c399dc48` 已全部推上远端主线；第四模块发布与 E3D 金样手册 `SPEC-mbd-pml-golden-and-release.md` 已就绪待发布窗口与 E3D 实机触发）  
**Tracking**: `plant3d-web#103` 及其子票 `#104–#151`、`#162`

---

## 1. 2026-11-18 进度审核快照（Audit Summary）

经逐仓核查 `plant3d-web`、`vendor/plant-mbd`、`gen-model` 主线及全部本地 worktree，当前 MBD 尺寸标注处于 **「九类标注内核与全类型移植已进主线；全库 7059 对象清零修复已在三棵落地分支完备待合；前端大场景体验增强（10 张票）与 E3D 真实金样待逐块推进」** 的阶段：

| 维度 | 当前状态 | 关键证据与数字（2026-11-18 实测） |
|---|---|---|
| **1. 核心架构与九类标注主线（#103 M0–M7, CT-1..20）** | **已上线主线** | `plant3d-web` `e2f3ba99`/`6ec53e62`、`plant-mbd` `47eb83e`、`gen-model` `e6dc8bbf4` 已合入远端主线；覆盖 `em4_pipe / em9_pipe / em4_supp / em9_pipe_supp / em9_inst_supp / em4_equi / em9_equi / civil / arch` 九类、三维立起与平贴双呈现、三档 Function LOD、屏幕网格避让（40m 楼板 `p95: 115ms → 24ms`）、36 例终验全过 |
| **2. 全库 7059 对象扫库修正（65 笔提交，P1–P2）** | **代码与门禁已完成，滞留在落地分支未合主线** | 11-11 扫库暴出 80 个整包失败 + 1 个退化 + 261 个无提示空包；已在三棵干净落地分支全部修完验过（拒收与退化 **81 → 0**）：<br>• `plant3d-web` `land/mbd-web-2026-11-13` @ `17eb50dc`（**28 笔**，`test:mbd` 744/744，与今日 `origin/main` `c9d0805d` 实测 `git merge-tree` **0 冲突**）<br>• `plant-mbd` `fix/mbd-tickets-solver` @ `3dbf13a`（**21 笔**，673 条测试/49 金样全过，相对 `github/main` `47eb83e` **直接快进**）<br>• `gen-model` `land/mbd-fixes-2026-11-12` @ `9bcf20d1f`（**16 笔**，MBD 105/105 全过，相对今日 `origin/refactor` `5e1ad86e3` 仅 `tests/mbd_branch_query.rs` **1 处测试追加冲突**）<br>**注**：因尚未合入主线，今日（`11-18`）离线发布包与联调后端仍跑旧版，线上仍会触发那 80 个对象的整包拒收 |
| **3. 主检出工作区在途改动（#136 原型）** | **半成品未提交** | `plant3d-web` 主检出 `useMbdExternalSync.ts` / `DimensionPanelDock.vue` / `useMbdDiagnosticsStore.ts` 有 253 行未提交的 `MBD_INITIAL_BRAN_LIMIT = 32` 按需加载实现，但文案仍写死「个 BRAN」，尚未按 `#136` 改为全类型「对象」口径 |
| **4. 前端体验与视口健壮性余项（K6）** | **待开发（排好序）** | `#133` 提示条多槽位防覆盖、`#135` 装载失败中文原因、`#136` 前 32 个对象分批收尾、`#137` 多对象单包失败常驻角标、`#138` 极小字高可读门槛、`#139` 远裁剪面含标注包围盒、`#140/#141` 三维直段相压全量计数与先挪后藏评估、`#142`「取最新」后自动刷新 MBD 标注、`#144` 覆盖声明警示条收敛 |
| **5. E3D 真实 PML 金样与生产部署（K8）** | **外部依赖挂起 / 待排期** | `fixtures/pml/` 目前仅有自测样例，真实九类 PML 导出对账（`#146–#149`）待带完整 MBD 模块与项目 `inputdata` 的 E3D 环境；生产服务器发布分支仍停在 `2026-11-05`（`#143`） |

---

## 2. Capability Map（模块边界、依赖方向与构建顺序）

以下四个模块各自具备独立的交付物、契约边界与可独立验收门禁，无循环依赖：

| Module id | Responsibility | Depends on |
|---|---|---|
| `mbd-mainline-convergence` | 将三仓已验完的 65 笔全库修正（Web 28 + Solver 21 + Host 16）重整并入当前最新主线（解决 `gen-model` 唯一 1 处测试冲突，遵守硬配对顺序），完成运行后端/离线包换版、7059 对象全量复扫与 `[mbd_type_rules]` 判型配置收口（`#104–#106`、`#127–#132`） | — |
| `mbd-batch-and-diagnostics-ux` | 收尾主检出在途的前 32 个对象按需分批加载（`#136` 全类型化），补齐提示条队列防顶掉（`#133`）、装载失败中文映射（`#135`）、多对象单包失败常驻角标（`#137`）与极小字高可读下限保护（`#138`） | `mbd-mainline-convergence` |
| `mbd-viewport-and-sync-integration` | 视口相机远裁剪面纳入 MBD 标注包围盒（`#139`）、全库三维尺寸相压计数与「先挪后藏」策略核定（`#140`、`#141`）、接通 `model-getwork` 库模型水位变化后自动刷新已打开的 MBD 标注（`#142`）及覆盖声明警示条精简（`#144`） | `mbd-mainline-convergence` |
| `mbd-pml-golden-and-release` | 在 E3D 实机环境导出九类真实 PML JSON 替换过渡金样并完成 `pml diff` 裁决闭环（`#146–#149`），以及向生产服务器发布全类型 MBD 版本（`#143`） | `mbd-mainline-convergence`, `mbd-batch-and-diagnostics-ux`, `mbd-viewport-and-sync-integration` |

**Build order**:  
`mbd-mainline-convergence` → `mbd-batch-and-diagnostics-ux`, `mbd-viewport-and-sync-integration` → `mbd-pml-golden-and-release`

---

## 3. 模块间边界契约（Boundary Contracts）

1. **`mbd-mainline-convergence` 对下游提供稳定基线**：
   - 交付 `main` / `refactor` 上统一的 MBD v2 信封契约、`validity` 出口自检（`contract.invalid_primitive`）、空包 200 诊断码规则表（`mbdEmptyReasons.ts`）、面板滚动容器（`#162`）及全量扫描/比对工具（`scripts/mbd-live-sweep.mjs`、`scripts/mbd-sweep-compare.mjs`）；
   - 严格遵守跨仓硬配对：`plant-mbd`（`3dbf13a`）与 `gen-model`（含 `civil::rooms` 归属过滤）必须在同一窗口落主线与编包；前端 28 笔可先行或同窗口合入。
2. **`mbd-batch-and-diagnostics-ux` 与 `mbd-viewport-and-sync-integration` 正交并行**：
   - 前者只改同步调度与尺寸面板/提示条 UI（`useMbdExternalSync.ts`、`useMbdDiagnosticsStore.ts`、`DimensionPanelDock.vue`、全局 Toast 槽位与字高展示下限）；
   - 后者只改三维视口裁剪/碰撞内核与模型增量事件订阅（`ViewerPanel.vue` 相机裁剪、`src/dimension/kernel/layout/dimension3d.ts`、`model-getwork` 水位回调），二者互不阻塞。
3. **`mbd-pml-golden-and-release` 独立外部环境门禁**：
   - E3D PML 金样导出（`#146–#149`）不阻塞前三个模块的研发与内网离线包交付；何时具备含项目 `inputdata` 的 E3D 机器即可随时启动。

---

## 4. Phase 0 Gate Questions（请审阅确认后进入第一模块 `SPEC-mbd-mainline-convergence.md`）

1. **模块拆分与推进顺序确认**：将最高价值的 **「先把已写完的 65 笔三仓修复合入今日最新主线并更新运行环境（清零 80 个整包失败）」** 作为第一模块 `mbd-mainline-convergence` 立即编写 Spec，随后推进 `mbd-batch-and-diagnostics-ux`（含收尾当前工作区未提交的 32 对象分批加载 `#136`）与 `mbd-viewport-and-sync-integration`，最后处理 E3D 金样与生产部署，是否符合您的预期？
2. **第一模块（`mbd-mainline-convergence`）的作用范围**：您希望第一模块**只合入本地/远端 Git 主线**，还是一并将新求解器 + 新宿主 + 新前端**同步编入本机正在运行的离线发布包（`127.0.0.1:8600` 管理的 `backend:8022` / `frontend:3100`）做真机 7059 对象全量复扫验收**？
3. **E3D 实机环境现状**：近期是否有安装完整 MBD 模块及真实项目 `inputdata` 的 E3D 环境可供导出 PML 金样（若暂无，保持 `mbd-pml-golden-and-release` 排在队尾挂起）？
