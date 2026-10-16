# plant3d-web 功能测试案例集（线上环境）

> 2026-10-17。面向已部署环境：前端 `http://123.57.182.243`（`a091f4b7`），
> 后端 `0.1.40+g56d44058e`（publish 分支，:8022 经 nginx :3100 对外）。
> 每条案例给出自动化映射；「本轮结果」记录本轮部署回归的实际执行结论。

## 结果口径

- **通过**：本轮在部署环境实际执行并通过。
- **可执行**：已有自动化脚本/用例映射，本轮未逐条重跑（见「自动化映射」列）。
- **手工**：暂无自动化，靠人工步骤验证。
- **在途**：对应功能代码尚未合入/部署，案例先行。

## 1. 部署与健康（DEP）

| ID | 案例 | 步骤 / 断言摘要 | 自动化映射 | 本轮结果 |
|----|------|----------------|------------|----------|
| DEP-01 | 前端版本 | `GET /version.json` 返回的 commit 与部署提交一致 | curl | 通过（a091f4b7） |
| DEP-02 | 后端健康（公网） | `:3100/api/v1/health` status=ok，build_id 与发布提交一致 | curl | 通过（g56d44058e） |
| DEP-03 | 后端健康（内网） | `:8022/api/v1/health` status=ok | curl | 通过 |
| DEP-04 | 校审子库健康 | `:3100/api/review/health` = ok + database healthy | curl | 通过 |
| DEP-05 | 房间构建就绪 | health `room_build.status=ready`，230/230 面板有几何 | curl | 通过（215 房） |
| DEP-06 | nginx 反代一致性 | :3100 与 :8022 的 `/api/v1/health` version 相同 | cutover 脚本内置 | 通过 |

## 2. 模型加载与场景（MOD）

| ID | 案例 | 步骤 / 断言摘要 | 自动化映射 | 本轮结果 |
|----|------|----------------|------------|----------|
| MOD-01 | 默认模型源启动 | 按默认源进入页面，场景出现构件 | `e2e/model-source-default.spec.ts` | 可执行 |
| MOD-02 | 指定 refno 直达 | `?refno=` 直达构件并加载其生成根 | p5-live spec `show_refno` | 可执行 |
| MOD-03 | 指定 dbnum 直达 | `?dbnum=` 直达库并加载 | p5-live spec `show_dbnum` | 可执行 |
| MOD-04 | BRAN 属主注入 | 叶子构件属 BRAN 时整条支管根入场景（TUBI 直管不丢） | `useModelGeneration` vitest + 线上人工 | 通过（随部署） |
| MOD-05 | 直出项目入口 | `output-project` 参数直进项目页 | `e2e/output-project-direct-entry.spec.ts` | 可执行 |
| MOD-06 | 缺实例自动生成 | 引用缺失实例时自动补齐生成 | `e2e/auto-generate-on-missing-instances.spec.ts` | 可执行 |
| MOD-07 | Parquet 缓存加载 | 已缓存库二次加载走缓存路径 | `e2e/parquet-cache-load.spec.ts` | 可执行 |
| MOD-08 | mesh 直出链路 | v1 mesh 直接进场景 | `e2e/gen-model-v1-mesh-direct.spec.ts` | 可执行 |
| MOD-09 | 服务重启恢复 | 后端重启后页面可继续工作 | p5-live spec（单 worker） | 可执行 |

## 3. 模型树与房间（TREE）

| ID | 案例 | 步骤 / 断言摘要 | 自动化映射 | 本轮结果 |
|----|------|----------------|------------|----------|
| TREE-01 | rooms 接口就绪 | `GET /spatial/rooms` 200 + ready | `tmp/room-online-retest.mjs` | 通过 |
| TREE-02 | 房间树成员 | 房间树端点返回成员/规格正确 | 同上 | 通过 |
| TREE-03 | 页签房间数 | UI 房间页签计数 = API 房间数（215） | 同上 | 通过 |
| TREE-04 | 逐级展开 | 房间 → 单元 → 构件行逐级展开 | 同上 | 通过 |
| TREE-05 | 上下文菜单 | 单元菜单含「加载模型（N 个构件）」「查看关联房间」 | 同上 | 通过 |
| TREE-06 | 批量加载单元 | 加载全部 7 构件，全部进 `scene.objects` | 同上 | 通过 |
| TREE-07 | 加载路径 | 走 `/api/v1/model/records`，不发 `ensure` | 同上（网络断言） | 通过 |
| TREE-08 | 显隐眼睛切换 | eye 切换同步 `scene.objects` 可见性 | 同上 | 通过 |
| TREE-09 | 页签切换状态保持 | PDMS ↔ 房间切换后展开态保留 | 同上 | 通过 |
| TREE-10 | 无页面错误 | 全程无 pageerror/console error | 同上 | 通过 |
| TREE-11 | 树页签 v1 链路 | 房间页签在 gen-model-v1 源下的完整链路 | `e2e/model-tree-room-tab-gen-model-v1.spec.ts` | 可执行 |
| TREE-12 | 整库房间重建 | `POST /rooms/rebuild` 202 → 并发第二发 409 → edge-recompute 29/29 → ready；房/面板/成员守恒 | `tmp/room-compute-online-retest.mjs` | 通过（机械面） |
| TREE-13 | 对齐账收敛 | 重建后 `room_updated_at` 盖章 + 含房库 `library_alignment_current=true` | 同上（C4/C5） | **线上仍失败**；根因已定位（issue gen-model#56：boole 构件引用的 `e3d_baked_v2_*.mesh` 不在部署网格目录 → 逐库 failed → 不盖章），本地副本库补全网格后全链收敛已验证 |

## 4. 空间查询与净距（SPT）

| ID | 案例 | 步骤 / 断言摘要 | 自动化映射 | 本轮结果 |
|----|------|----------------|------------|----------|
| SPT-01 | 空间查询面板 | 空间树/查询面板打开、范围命中展示 | `e2e/spatial-query-gen-model-v1-ui.spec.ts` | 可执行 |
| SPT-02 | BRAN 最近净距 | 支管最近净距计算与结果渲染 | `e2e/bran-nearest-clearance.spec.ts` | 可执行 |
| SPT-03 | 范围-房间联动 | 「房间 → 专业 → 最小交付单元」范围展示；`rooms=` 收窄 | 面板手工 + rooms 接口 | 手工 |

## 5. 三维校审（REV）

| ID | 案例 | 步骤 / 断言摘要 | 自动化映射 | 本轮结果 |
|----|------|----------------|------------|----------|
| REV-01 | TC1 正向全通 | SJ 建单送审 → JH 确认数据+同意 → SH/PZ 同意 → approved；终态/重开校验（20 步） | `scripts/online-review-acceptance.mjs tc1` | 通过 20/20 |
| REV-02 | TC2 驳回回路 | JH 加批注→驳回→SJ「已修改」→重提→逐级同意→approved（33 步） | 同上 `tc2` | 通过 33/33 |
| REV-03 | RESAVE 草稿再存 | 草稿重开→加构件→同单再存→history 恰好 1 次 resave→送审；送审后再存 409（23 步） | 同上 `resave` | 通过 23/23 |
| REV-04 | 确认记录契约 | POST/GET 回显 recordRevision、currentNode、operatorId、modelContext、clearanceSnapshot | 线上验收内嵌断言 + records.rs | 通过（随 REV-01..03） |
| REV-05 | 批注流转契约 | 批注 open→fixed/wont_fix→agree/reject 状态机 | `scripts/review-annotation-flow-contract.ts`（p0 review 闸） | 可执行 |
| REV-06 | 任务隔离 | U0 任务校审数据不串 | `e2e/review-u0-task-isolation.spec.ts` | 可执行 |
| REV-07 | 嵌入页 JH 校核 | JH 嵌入页校核区完整流程 | `e2e/tmp-issue84-jh-embed.spec.ts` + PMS 链路 | 可执行 |
| REV-08 | 发起面板草稿 | 发起面板保存/重开草稿、构件增删 | RESAVE 步骤覆盖 | 通过 |

## 6. 批注与标注工具（ANN）

| ID | 案例 | 步骤 / 断言摘要 | 自动化映射 | 本轮结果 |
|----|------|----------------|------------|----------|
| ANN-01 | 批注创建 | DTX 批注工具创建文字/云线批注 | `e2e/dtx-annotation-creation.spec.ts` | 可执行 |
| ANN-02 | 批注视觉 | 云线/标签渲染正确 | `e2e/dtx-annotation-visual.spec.ts` | 可执行 |
| ANN-03 | 云线包围盒 | 云线 fit 包围正确 | `e2e/dtx-cloud-fit-enclosure.spec.ts` | 可执行 |
| ANN-04 | 相机随动 | 批注轮廓相机运动/快速环绕 | `dtx-cloud-outline-camera-motion` / `fast-orbit` | 可执行 |
| ANN-05 | 标签轨道稳定 | 快速环绕时 overlay 标签不抖 | `e2e/dtx-overlay-labels-fast-orbit.spec.ts` | 可执行 |
| ANN-06 | 真模型标签 | overlay 标签在真模型上定位 | `e2e/dtx-overlay-labels-real-model.spec.ts` | 可执行 |
| ANN-07 | 长按枢轴 | 长按设观察枢轴 | `e2e/dtx-long-press-pivot.spec.ts` | 可执行 |
| ANN-08 | 批注显隐 | 批注层显隐切换 | `e2e/dtx-visibility.spec.ts` | 可执行 |

## 7. 测量与尺寸（MES）

| ID | 案例 | 步骤 / 断言摘要 | 自动化映射 | 本轮结果 |
|----|------|----------------|------------|----------|
| MES-01 | 尺寸面板冒烟 | 打开测量面板、量距/标注基本操作 | `e2e/dimension-app-dev-smoke.spec.ts`（dev 冒烟） | 可执行 |
| MES-02 | MBD V2 夹具 | 尺寸 MBD V2 数据流 | `e2e/dimension-mbd-v2-fixture.spec.ts` | 可执行 |
| MES-03 | 支管尺寸 | 管道尺寸标注链路 | `e2e/dimension-pipe.spec.ts` | 可执行 |
| MES-04 | 画布冒烟 | 尺寸画布渲染 | `e2e/dimension-canvas-smoke.spec.ts` | 可执行 |
| MES-05 | 尺寸文档截图 | 文档化截图比对 | `dimension-doc-screenshots` / `bran-doc-screenshot` | 可执行 |

> 注：旧后端的模型版本 API / MBD V2 API 真机用例已随 legacy 退役，真机侧只剩 dev 冒烟。

## 8. 版本对比与增量（VER）

| ID | 案例 | 步骤 / 断言摘要 | 自动化映射 | 本轮结果 |
|----|------|----------------|------------|----------|
| VER-01 | 增量版本对比 | 两版本差集构件标色/列表 | `e2e/incremental-version-compare.spec.ts` | 可执行 |
| VER-02 | v1 版本对比 | gen-model-v1 源版本对比链路 | `e2e/model-version-compare-gen-model-v1.spec.ts` | 可执行 |
| VER-03 | 节点版本查看 | 任意节点按作用域开关对比 | `e2e/node-version-view-gen-model-v1.spec.ts` | 可执行 |
| VER-04 | 双源一致性 | 两模型源数据一致性 | `e2e/gen-model-v1-two-source-parity.spec.ts` | 可执行 |
| VER-05 | 增量记录面板 | 增量记录列表/详情 | 面板手工 | 手工 |

## 9. 模型生成管理（GEN）

| ID | 案例 | 步骤 / 断言摘要 | 自动化映射 | 本轮结果 |
|----|------|----------------|------------|----------|
| GEN-01 | 生成任务列表 | 管理抽屉显示任务/进度/阶段名 | 面板手工 + p5-live | 可执行 |
| GEN-02 | 库状态行 | dbnum 面板状态/滞后原因/五段阶段映射 | vitest（useModelGenerationAdmin） | 可执行 |
| GEN-03 | 触发库执行 | 按库触发 update-execute，回执入任务列表 | p5-live spec | 可执行 |
| GEN-04 | WS 任务事件流 | tasks 主题逐单元进度：在飞单元/失败计数/批次提示 | `useGenModelV1TaskFeed`（在途，未部署） | 在途 |
| GEN-05 | 断线兜底 | WS 断开时 REST 轮询兜底、漏 seq 清空在飞清单 | 同上 | 在途 |

## 10. PMS 集成（PMS）

| ID | 案例 | 步骤 / 断言摘要 | 自动化映射 | 本轮结果 |
|----|------|----------------|------------|----------|
| PMS-01 | 登录进三维校审单 | SJ 登录 PMS → 设计交付 → 三维校审单列表 | `scripts/pms-chrome-devtools-flow.ts` | 通过 |
| PMS-02 | SJ 新增单据 | 「新增」弹窗填包名/BRAN（默认 24381_145018）→ 创建编校审数据成功 | 同上（FULL_FLOW） | 通过（FORM-AC2A816197A0，hook 发起） |
| PMS-03 | PMS 接口可见 | PMS 域名 JSON 响应体含包名/测试 BRAN | 同上（VERIFY_PMS_API） | 通过 |
| PMS-04 | SJ PMS 送审 | 单据送审「三维编校审」→ JH 待办（JH/SH/PZ 逐级指派） | 同上（SEND_FOR_REVIEW） | 通过 |
| PMS-05 | JH 打开嵌入页 | JH 登录 → 待办「待审批事项」命中 form_id → plant3d 嵌入页打开（列表兜底已实现） | 同上（EXTENDED） | 通过 |
| PMS-06 | JH 校核提交 | 外部流程模式（无内部按钮）→ PMS 审批窗「同意」；有未决批注时按 PMS 语义改走「驳回」→ 退回设计节点 | 同上（EXTENDED） | 通过（驳回路径，见附录） |
| PMS-06b | 全链逐级审批 | `PMS_CDP_FULL_CHAIN=1`：JH→SH→PZ 逐人重登 → 待办命中 → 嵌入页 → 审批窗同意 → 单据逐级流转至办结 | 同上（FULL_CHAIN，JH 不加批注） | 通过（FORM-87C972506BED） |
| PMS-07 | 新单入口 spec | PMS 新建单据页交互 | `e2e/pms-powerpms-review-new.spec.ts` | 可执行 |
| PMS-08 | 模拟器-嵌入 | 模拟器内嵌项目链路 | `e2e/pms-review-simulator-embed-project.spec.ts` | 可执行 |
| PMS-09 | 模拟器-mock | mock 数据模拟器链路 | `e2e/pms-review-simulator-mocked.spec.ts` | 可执行 |
| PMS-10 | 生产回放流 | 生产 PMS 校审回放 | `e2e/helpers/pmsProductionReviewFlow.ts` | 可执行 |

## 11. 面板与杂项（UI）

| ID | 案例 | 步骤 / 断言摘要 | 自动化映射 | 本轮结果 |
|----|------|----------------|------------|----------|
| UI-01 | 属性面板 | 选中构件显示属性 | 面板手工 | 手工 |
| UI-02 | 选择链路 | 点选/框选 → 高亮 + 属性联动 | `viewerToolbarSelection.test.ts` + 手工 | 手工 |
| UI-03 | 渲染模式设置 | 渲染模式面板切换生效 | 面板手工 | 手工 |
| UI-04 | 工具栏 | 工具栏按钮布局/功能 | `e2e/m1-ui-validation.spec.ts` | 可执行 |
| UI-05 | 水力面板 | Hydraulic 面板数据 | 面板手工 | 手工 |
| UI-06 | 点集面板 | Ptset 面板 | 面板手工 | 手工 |
| UI-07 | 材质配置 | DTX 材质配置面板 | 面板手工 | 手工 |
| UI-08 | 管理器/控制台 | Manager/Console 面板 | 面板手工 | 手工 |
| UI-09 | 校审附件预览 | 附件预览面板布局 | `reviewAttachmentPreviewLayout.test.ts` | 可执行 |

## 12. 附录：本轮执行记录

- **三维校审线上验收**（2026-10-16）：TC1 20/20、TC2 33/33、RESAVE 23/23，
  报告 `tmp/online-review-acceptance/20261016-120911-report.json`。
- **房间显示复测**（2026-10-16）：12/12，`tmp/room-online-retest.mjs`。
- **PMS extended**（2026-10-17）：命令 `PMS_E2E_PASSWORD=… PMS_EMBEDDED_SITE_SUBSTRING=123.57.182.243
  PMS_CDP_FULL_FLOW=1 PMS_CDP_EXTENDED_FLOW=1 PMS_CDP_SEND_FOR_REVIEW=1
  npx tsx scripts/pms-chrome-devtools-flow.ts`（CDP attach 本机 Chrome）。
  **全链绿（exit 0）**：SJ 建单 FORM-AC2A816197A0（`__plant3dInitiateReviewE2E` hook）
  → SJ 送审指派 JH/SH/PZ → JH 重登录（列表未命中 → **待办「待审批事项」兜底命中 form_id**）
  → 进入嵌入 plant3d 工作区 → mock 批注 `e2e-annot-…` 确认数=1
  → 工作区为**外部流程模式**（`外部流程模式` 状态卡，无内部提交按钮——部署构建不含
  `VITE_REVIEW_ENABLE_INTERNAL_WORKFLOW_MODE`）→ PMS 审批窗点「同意」
  → **PMS 弹出「检测到批注未完成处理或确认，请检查」拦截**（生产行为验证：有未决批注时
  PMS 拒绝同意，语义正确）→ 确定后走「驳回」→ WorkReturnSelect 填意见提交，
  单据退回设计节点。本轮脚本两处加固：待办候选按索引跳过已试条目（原死循环）、
  校核提交支持「同意→审批处理」与「批注拦截→驳回」双结局。
- **PMS 全链审批**（2026-10-17，第二轮）：追加 `PMS_CDP_FULL_CHAIN=1`（隐式关 JH 批注），
  **JH→SH→PZ 逐级同意全部通过**（FORM-87C972506BED）：每站清会话重登 → 待办命中 form_id
  → 嵌入 plant3d 外部流程模式 → PMS 审批窗「同意」→ WorkNodeSelect 提交 → 单据流转下一节点。
  两处实测教训已固化进脚本：校核阶段一律优先走「待审批事项」待办（列表路径即使命中
  打开的也可能是只读视图，「同意」存在但不可见——SH 站实测踩过）；「同意/驳回」谓词
  加可见性检查；末节点（PZ）同意后若无 WorkNodeSelect、审批窗直接关闭同样判成功。
  **遗留**：`PMS_MOCK_PACKAGE_NAME` 下 extended 仍要求 `PMS_CDP_WORKFLOW_MODE`、
  `PMS_INITIATE_CHECKER_SUBSTRING`（仅 mock 路径需要）。
- **房间计算复测**（2026-10-17）：`tmp/room-compute-online-retest.mjs` 对
  `POST /api/v1/rooms/rebuild` 连跑两轮——202 受理、第二发 409、edge-recompute
  逐库 29/29、房/面板/成员集守恒全过；**但收尾账本不盖章（room_updated_at 恒 null）
  且两个含房库（7997/8000）library_alignment_current 恒 false**——重建前基线即欠账，
  系统性失败，已立案 `gen-model#56`。
- **gen-model#56 根因定位**（2026-10-17，本地副本库 `:8011` + 真工程文件 + release
  `g919344208` 复现闭环）：`inst_relate` 里 `booled=true` 构件的 `booled_id`
  指向 `e3d_baked_v2_<sha256>.mesh` 烘焙网格文件；房间归属重算按文件读顶点，**任一
  文件缺失 → 整根进 `report.failed`** → 该库 `model_room_generation` 不盖、全局
  `room_update_record` 不写。本地量化：全库 25,014 个被引用 baked id，
  `gen-model/assets/meshes` 缺 2,183、部署包 `backend/assets/meshes` 缺 5，跨机并集
  + 历史运行目录捞回后 **110,830 文件 100% 覆盖 → 29/29 全过、盖章收敛、
  `library_alignment_current` 恢复 true**。服务器部署包不含 `assets/meshes`
  （`PLANT_ASSET_ROOT=/var/lib/aios-database/assets` 恒空），故所有 boole 根必败。
  修复 = 把网格清单同步到服务器后重建；结构后续见 issue（网格入持久层 /
  部署打包网格 / health 透出逐库失败摘要）。
- **部署健康**：DEP-01..06 全部通过（run 38917741165 / 38919003556 两次 success）。
