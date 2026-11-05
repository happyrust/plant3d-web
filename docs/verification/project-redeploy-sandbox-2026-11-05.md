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
## 收尾

两轮结束后沙箱 SurrealDB 8019、后端 8032、vite 3111 均已停。真实 8009 / 8022 仍在原 PID 上运行。沙箱库副本 `gen-model/.surreal/sandbox-redeploy-20261105` 与 `plant3d-web/.scratch/redeploy-sandbox/` 保留，待确认后删除。
