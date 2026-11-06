# 「项目」页签：一键重新部署 / TTY 配置 沙箱联调记录（2026-11-05）

只改前端（plant3d-web），后端 gen-model 未改。真实库（SurrealDB 8009、aios-database 8022、vite 3101）全程未触碰。

## 环境

| 组件 | 地址 | 说明 |
|---|---|---|
| SurrealDB | `127.0.0.1:8019` | `gen-model/.surreal/ams-8009` 热拷到 `gen-model/.surreal/sandbox-redeploy-20261105`（约 518 MB） |
| aios-database | `127.0.0.1:8032` | `target/debug/aios-database.exe` 0.1.44，`AIOS_STORE_MODE=rocksdb`、`AIOS_DATA_FACE=ingest`，`serve --watch-dbnum 7997,7998,8000` |
| vite | `localhost:3111` | `VITE_GEN_MODEL_V1_BASE_URL` / `VITE_GEN_MODEL_API_BASE_URL=http://localhost:8032`，关 HMR |

沙箱配置从根目录 `DbOption.toml` 复制，只改 `v_port=8019`、`http_api_addr=127.0.0.1:8032`、`server_release_ip=127.0.0.1:9132`、`kv_port="8020"`。

起沙箱后端踩到的两点（记下来给下次）：

- 单实例锁落在进程 CWD（`.gen-model.instance.lock`），在 gen-model 仓根起会和 8022 撞锁（os error 32）。要另给运行目录。
- 换了运行目录后，`aios_core` 按 CWD 相对路径 `resource/surreal` 装函数脚本，目录不在就报 `Failed to define common functions … (os error 3)`。把 `gen-model/resource` 拷进运行目录即可（同 l3 夹具 `stage_surreal_scripts`）。
- 同时设 `PLANT_ASSET_ROOT` 指向沙箱目录，网格落盘不进共享 `assets/meshes`。

```powershell
cd <sandbox>/run            # 内含拷来的 resource/
$env:DB_OPTION_FILE   = '<sandbox>/DbOption-redeploy-sandbox'
$env:PLANT_ASSET_ROOT = '<sandbox>/assets'
$env:AIOS_STORE_MODE  = 'rocksdb'; $env:AIOS_DATA_FACE = 'ingest'
$env:AIOS_MODEL_GENERATION_INPUT_MAX_DBNUMS = '1'; $env:AIOS_MODEL_ELEMENT_CACHE_MAX_ENTRIES = '60000'
$env:RUST_MIN_STACK = '134217728'
D:/work/plant-code/old/gen-model/target/debug/aios-database.exe serve --watch-dbnum 7997,7998,8000
```

启动后 `/api/v1/health`：`version=0.1.44`，`storage_version.expected=1 / stored=1 / caught_up=true`。`/dbnums?project=AvevaMarineSample` 去掉 excluded / not_in_project 后 20 行（DESI 7997、7998、8000，其余 DICT / SYST / COMM / MISC）。

PE 基线（沙箱 SurrealDB 直查 `SELECT dbnum, count() FROM pe WHERE dbnum IN [7997,7998,8000] GROUP BY dbnum`）：7997 = 170085，7998 = 4，8000 = 6643。

## 1. 接口契约（curl）

```powershell
curl.exe -s -w "%{http_code}" -H "Content-Type: application/json" `
  --data '{"project":"AvevaMarineSample","dbnums":[7998]}' `
  http://127.0.0.1:8032/api/v1/storage-version/upgrade
```

- 第一次：**202**。回执 `requested=[7998]`、`full_scope=false`、`upgrade.state=running`，`receipt.enqueued` 一条 `task_id=db-20261105-182943-000006`、`intent=reinitialize`、`reinit_trigger=manual`；`unselected=[7997,8000]`；warnings 里有「dbnum=7998: 人工重新解析，已按整库重建入队」。
- 立即重发同一请求：**409**，`{"code":"conflict","message":"已有存储架构升级在进行中（requested=[7998]，done=[]）；…"}`。
- 约 15 s 后 health：`upgrade.state=done`、`done_dbnums=[7998]`，任务 `state=succeeded`，PE 仍为 4。

## 2. 角色可见性

`localStorage['plant3d-web-user-v3'].currentUserId` 切换后整页重开，读层级菜单 `[data-hierarchical-tab]`：

| 用户 | 角色 | 页签 |
|---|---|---|
| SJ | designer | view, measurement, space_calc, review, task, settings, help（无 project） |
| PZ | manager | view, measurement, space_calc, review, task, **project**, settings, help |

联调中发现默认的「层级菜单」模式（`HierarchicalMenuBar.vue`）没有走角色过滤，设计师也能看到「项目」——已修，见下方「联调中修掉的问题」。

## 3. 前端子集重新部署（8000）

PZ 登录 → 项目 → 一键重新部署：

- 探测后进入选库页，默认全选 20 / 20；库名列显示 `file_name`（如 `ams8000_0001`）。
- 取消全选、只勾 8000 → 「重新部署 1 个库…」→ 确认页列出 `8000 ams8000_0001`，按钮先显示「确认重新部署（Ns）」且 disabled，3 s 后可点。
- 提交后进度页，每 6 s 采样（UI 文本 + 沙箱 PE 计数）：

```
t+6s   pe=0     8000 运行中 · ingest_and_generate
t+12s  pe=6643  8000 运行中 · dependency_closure
t+18s  pe=6643  8000 运行中 · dependency_closure
t+24s           结果页
```

- 结果页：「1 个库已重建完成 · 耗时 00:30 · 房间计算已刷新」。health：`requested=[8000]`、`done_dbnums=[8000]`、`failed=[]`、`full_scope=false`，`storage_version` 仍 `stored=1 / caught_up=true`（子集不登记版本，符合预期）。
- 「刷新模型并关闭」关闭弹窗。

## 4. 409 冲突 → 查看进度 → 后台继续（7997）

- 前端选 7998、进入确认页倒计时结束后，先用 curl 提交 `{"dbnums":[7997]}`（202，占住升级槽），再点「确认重新部署」。
- 弹窗转冲突页：「已有重新部署任务正在运行 / 已有重新部署在运行。同一时间只能有一次重新部署，请等它完成后再试。/ 查看进度」。
- 「查看进度」→ 进度页按 health 显示 `0 / 1`、`任务由服务端逐库排队（7997）`。
- 「后台继续」关闭弹窗；ribbon「部署状态」重开，直接回到进度页（已用时 01:02）。
- 7997 进度（UI + PE）：

```
t+6s    0/1  pe7997=170083
t+54s   0/1  pe7997=0          ← 清库
t+102s  0/1  pe7997=13000
t+126s  0/1  pe7997=82000
t+150s  0/1  pe7997=155000
t+174s  0/1  pe7997=170085     ← 重建完成，与基线一致
t+186s  结果页：1 个库已重建完成 · 耗时 06:22 · 房间计算已刷新
```

## 5. 记住密码（TTY 登录配置）

项目 → 项目设置，密码填测试串 `dummy-pass-123`（非真实 E3D 密码），每步后整页重开再打开设置：

| 步骤 | localStorage | 重开后密码框 / 勾选 |
|---|---|---|
| 初始 | 无 `rvm-check-remember-password`、无 `rvm-check-password` | 空 / 未勾 |
| A：不勾「记住密码」，保存 | 两个键都没有 | 空 / 未勾 |
| B：勾选，保存 | `rvm-check-remember-password='1'`，`rvm-check-password` 存在 | 14 位 / 勾选 |
| C：取消勾选（不点保存） | 两个键立即删除 | 空 / 未勾 |

## 未覆盖

- **TTY 测试连接（正确 / 错误密码）没做**：需要真实 E3D 账号密码，未向用户索取。沙箱后端的 RVM 核对也报「找不到 E3D 启动脚本（`target/debug/scripts/e3d/run_ams_c_entrymacro.bat`）」，本机 debug 产物旁没有 E3D 脚本，测试连接即便有密码也会先卡在这一步。
- **全选（不传 dbnums、`full_scope=true`）没在前端真跑**：全量会清空并重建 20 个库（含 SYST / DICT），沙箱上预计 15–40 分钟；前端「全选时 body 为 `{}`」由单测覆盖。
- 「重试失败的库」（逐库 `/dbnums/{dbnum}/data/reinitialize`）本轮没有出现失败库，未在真库上触发；由单测覆盖。

## 联调中修掉的问题

1. `src/ribbon/hierarchicalMenu.ts` + `src/components/ribbon/HierarchicalMenuBar.vue`：层级菜单（默认 UI 模式）构建时不看 `roles`，设计师可见「项目」页签。`buildHierarchicalMenuTabs` 改为接收当前角色，按 `isRibbonButtonVisibleForRole` 过滤命令，空组 / 空页签照旧剔除。新增 `src/ribbon/hierarchicalMenu.test.ts`（2 例）。
2. `RedeployDialog.vue`：在结果页关掉后再开，仍回到上一趟的结果页，没法发起新的重新部署。现在按 `started_at` 记住已看过的那一趟，重开回选库页。
3. `RedeployDialog.vue`：409 冲突的提示文案留在 `redeployError`，「查看进度」后一直跟到结果页。转进度视图时清掉。

## 检查

- `npm run type-check`：0 新增（基线 0）。
- `npx eslint --fix` 改动文件：0 问题。
- `npx vitest run src/ribbon src/components/ribbon src/components/project src/composables/useModelGenerationAdmin.test.ts src/composables/useRvmCheckStore`：5 文件 35 例通过。

## 第二轮：每库重建完成后自动排 RVM 校验（浏览器验收，同日晚）

沙箱同上重起（SurrealDB 8019、后端 8032、vite 3111）。第一次起后端时启动阶段 `cal-equip`（设备派生量重算）跑了 15 分钟以上仍未结束，期间批次只入队不执行；停掉后端后以 `AIOS_STARTUP_CAL_EQUIP=0` 重起（纯派生量，与本验收无关）。

| 场景 | 操作 | 结果 |
|---|---|---|
| 开关默认 | 首次打开选库页 | 「每个库重建完成后，自动对该库的 SITE 跑 RVM 校验」默认勾选 |
| 子集 8000，开关开 | 只选 8000 → 确认 → 提交 | 32 秒重建完成；结果页显示「RVM 校验：已排入 4 个 SITE（库 8000）」；RVM 队列 4 项 `queued`（24384_26547、24384_46、24384_24932、24384_22399，与 `/tree/roots` 中 dbnum=8000 的 SITE 一致）；未登录，弹出「登录 E3D 后台」窗 |
| 取消登录 | 登录窗点「取消」 | 4 项仍 `queued`，不报错 |
| 刷新页面 | 重开页面 | RVM 队列 0、`queuedDbnums` 空：页面打开前已完成的库不补跑 |
| 开关关 | 取消勾选后重部署 8000 | localStorage `redeploy-auto-rvm-check='0'`；25 秒完成，无 RVM 提示块，队列 0 |
| 后台发起 + 部署状态重开 | curl 提交 `{"dbnums":[8000]}`（202），再 curl `{"dbnums":[7998]}`（409 `conflict`）；前端「部署状态」打开 | 直接进进度页 0 / 1；30 秒后结果页，同样排入 4 个 SITE |
| 角色 | 切 SJ / PZ | SJ 无「项目」，PZ 有 |
| 项目设置 | 打开「项目设置」 | 字段、记住密码提示、测试连接按钮齐全 |

验收中修掉的问题：

4. `RedeployDialog.vue`：后端在部署中途重启，旧批次不在任务注册表里，任务卡永远停在「排队中」；而进度页→结果页的判断把它算作「重试仍在跑」，`upgrade.state` 已是 `failed` 仍卡在进度页。现在只有点过「重试失败的库」那一趟才按任务状态判断收尾，整趟部署以 `upgrade.state` 为准。

未覆盖：E3D TTY 登录与真正的 RVM 导出（缺真实密码，且沙箱 debug 后端缺 `scripts/e3d/run_ams_c_entrymacro.bat`），所以只验到 SITE 入队、登录窗弹出为止。

检查：`npm run type-check` 0 新增；eslint 0 问题；`npx vitest run src/composables/redeployRvmFollowUp.test.ts src/composables/useModelGenerationAdmin.test.ts src/ribbon src/components/ribbon src/components/rvm-check` 10 文件 86 例通过；全量 `npx vitest run` 444 文件通过（改动 4 之前）。
## 第三轮：真实 E3D 账号（SYSTEM，2026-11-06 凌晨）

账号 SYSTEM，密码由用户口头给出，与 `gen-model/scripts/e3d/run_ams_c_entrymacro.bat` 默认登录一致；不入库、不勾「记住密码」（验收后 localStorage 无密码项）。

配置：

- 沙箱 `DbOption-redeploy-sandbox.toml` 追加 `[rvm_check]`：`e3d_launcher` 指向 `gen-model/scripts/e3d/run_ams_c_entrymacro.bat`（后端只在 exe 目录或 CWD 的 `scripts/e3d/` 下找，沙箱运行目录没有），`work_dir = .scratch/redeploy-sandbox/rvm-check`。
- E3D 安装目录填 `E:\reverse\e3d\shadow_e3d31_gen_model_test`（`D:\AVEVA\Everything3D3.1` license 失效，默认 e3d31-runtime 在 TTY 下崩溃，见 `gen-model/docs/2026-08-26_e3d-tty-ams-agent-usage-guide.md`）。
- 后端换成 `E:/work/plant-code-rvm/gen-model` `feat/rvm-check-inprocess` 的 `b4b6f725c` debug 构建（build_id `0.1.44+gb4b6f725c4d4`，gen_ams / rvm_compare 进程内）。原因：旧构建 `d0a0d6ae` 登录成功（`RVM-CHECK-LOGIN-OK`），但 `des.exe -tty` 收到 QUIT 不退出，后端干等 1200 秒，前端 360 秒超时报「连接失败…请求超时」。这是 gen-model#87，修复（L3-DONE 后宽限 60 秒强制收尾）只在 `b4b6f725c`。

| 场景 | 结果 |
|---|---|
| 项目设置 → 测试连接 | 72 秒「连接成功 AMS · SYSTEM · /ALL」，`loggedIn=true`；des.exe 自行退出，无残留（#87 宽限生效） |
| 8000 的 4 个 SITE 跑 RVM 核对（已登录，不再弹登录窗） | 串行跑完 5 分 12 秒，全部 `pass`：24384_26547 1 个构件一致、24384_46 514 个、24384_24932 150 个、24384_22399 2019 个；每个 SITE 约 70 秒，阶段 generate_ours → e3d_export → compare；结束后无 des.exe 残留 |

未覆盖：本轮「重新部署 8000」没有真正跑起来。新后端启动时 watcher 入队了 7997 / 7998 的 `model_only` 批次，7997 卡在 `durable_pending`（单元 6772/6772 已生成，01:35 后无进展，超过 `DURABLE_FLUSH_BUDGET` 的 10 分钟期限仍不结束），8000 的 reinitialize 排在后面一直 `queued`，`upgrade.state` 停在 `running`。这是后端批次 worker 的问题，与前端无关，未处理。所以 4 个 SITE 是在页面里直接调 `useRvmCheckStore().enqueue`（与自动排队调用同一入口、同一组 SITE）入队的；「重建完成 → 自动入队」这一段沿用第二轮的结论。

线上风险：8022（`d0a0d6ae`）同样缺 #87 修复，真账号下每个 SITE 的 RVM 核对都会卡满 1200 秒，测试连接会显示超时。需要把 `b4b6f725c` 合进 `refactor` → `publish` 后再在线上启用。
## 第四轮：合并后复测（2026-11-06 上午）

gen-model：`feat/rvm-check-inprocess`（含 #87）已合并进 `refactor`，合并提交是 `da97d03eb`（本地，未推送）。冲突在 `src/rvm_check/mod.rs` 和 `report.rs`：生成和比对改用进程内实现，refactor 的 12 根 WORLD 序号测试保留。合并 worktree 里 `cargo test --lib rvm_check` 通过 21 例，`e3d_query` 通过 13 例。后端用这个提交的 debug 构建，build_id `0.1.44+gda97d03ebfb0`，`git_dirty=false`。

原来的端口 8019、8032 被 LOD 基准占用，所以沙箱改用 SurrealDB 8039、后端 8042、vite 3112。配置是 `DbOption-redeploy-sandbox-b.toml`，与原配置只差端口。

| 场景 | 结果 |
|---|---|
| 项目设置 → 测试连接（SYSTEM） | 149 秒显示「连接成功 AMS · SYSTEM · /ALL」。密码没有写进 localStorage |
| 页面上只选 8000 → 重新部署（开关开） | 29 秒显示「1 个库已重建完成 · 房间计算已刷新」，结果页提示「RVM 校验：已排入 4 个 SITE（库 8000）」，队列 4 项 `queued` |
| 登录 E3D 窗（刷新后内存里没有密码，所以弹出） | 输入密码后点「登录并开始核对」，约 70 秒登录成功，窗口关闭，队列开始串行跑 |
| 4 个 SITE 的 RVM 核对 | 约 5 分钟全部 `pass`：24384_26547 1 个构件、24384_46 514 个、24384_24932 150 个、24384_22399 2019 个。结束后没有残留的 des.exe |

至此，「重新部署 → 自动排 SITE → 登录 → RVM 核对出结论」整条链路在真账号下跑通。

第一次启动 `--watch-dbnum 7997,7998,8000` 时，7997 的启动批次又卡在 `durable_pending`，和第三轮一样：6772/6772 已刷盘，之后没有进展，8000 排在它后面。停掉后端、改成 `--watch-dbnum 8000` 重启后，7997 的残留任务先做 `wipe_reinit`，然后正常跑完，8000 的排队任务也跟着跑完，之后才在页面上发起这一轮。7997 卡在 `durable_pending` 的根因还没查，属于后端问题。
## 第五轮：部署结果页逐 SITE 显示 RVM 结论（2026-11-06 中午）

新增 `src/components/project/RedeployRvmSites.vue`，替换原先只有一句「已排入 N 个 SITE」的提示块。`redeployRvmFollowUp` 新增 `siteRows` 和 `summary` 两个字段：

- 逐 SITE 状态直接从 RVM 核对 store 读，不另存一份。`statusByRefno` 给出排队中、核对中（带阶段）、结论；「已取消」「请求失败」从队列项读。取消后树上的状态会退回入队前的旧结论，所以只看 `statusByRefno` 认不出取消。
- 汇总行格式为「N 个 SITE：x 通过 · y 未通过 · z 进行中 · w 已取消」。
- 只有未通过的 SITE 能点（不一致、种类不一致、工具故障、非几何问题、请求失败），点击后打开 RVM 核对面板并定位到那次核对，弹窗关闭。「打开核对面板」链接总是可点。

浏览器验收用的是第四轮的沙箱（8039 / 8042 / 3112，后端 `da97d03eb`，`--watch-dbnum 8000`），账号是真实的 SYSTEM：

| 场景 | 结果 |
|---|---|
| 只选 8000 → 重新部署 | 51 秒重建完成；RVM 块列出 4 个 SITE，状态都是「排队中」，汇总「4 个 SITE：0 通过 · 4 进行中」；弹出登录窗 |
| 登录后串行核对 | 每行依次显示「核对中 · 生成我们的 RVM」「核对中 · E3D 导出」，然后变成「通过」，汇总实时更新；约 6 分钟后显示「4 个 SITE：4 通过」 |
| 模拟一个 SITE 不一致（在前端改 store） | 汇总变成「3 通过 · 1 未通过」，该行显示红色可点的「不一致」；点击后弹窗关闭，RVM 核对面板打开，并显示那次核对（`rvm-check-20261106-124504-000004`） |
| 部署后立即取消队列 | 汇总「0 通过 · 1 进行中 · 3 已取消」，已经在跑的那一项继续跑完 |

检查结果：
- `npm run type-check` 新增 0 条。
- 改动文件 eslint 0 问题。
- 新增单测共 5 例，都通过：`redeployRvmFollowUp.test.ts` 2 例，`RedeployRvmSites.test.ts` 3 例。
- 在只含本功能改动的干净 worktree 里跑全量 `npx vitest run`，443 个文件全部通过。
- 主工作区全量跑时 `src/components/review/form-binding.test.ts` 超时。这个测试在 HEAD 和干净 worktree 里都能通过，失败来自主工作区里其他未提交的改动，与本功能无关。
## 收尾

四轮结束后沙箱进程（8019 / 8032 / 3111，第四轮的 8039 / 8042 / 3112）均已停。真实 8009 / 8022 仍在原 PID 上运行。沙箱库副本 `gen-model/.surreal/sandbox-redeploy-20261105` 与 `plant3d-web/.scratch/redeploy-sandbox/` 保留，待确认后删除。
