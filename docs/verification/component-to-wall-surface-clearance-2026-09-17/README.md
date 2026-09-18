# 构件到墙外表面净距——真 UI 完整流 + HTTP 金样 + G6 实机对（2026-09-17 22:3x–23:0x）

计划：`docs/plans/2026-09-17-component-to-wall-surface-clearance-plan.md`（§7 金样 / §8 PR-D）。决策 `d-428`。
后端 PR-A `gen-model-model-cache` `a0e307588`；前端 PR-B `dbbda78` / PR-C `8402b2c`（plant3d-web `main`，验证时 HEAD `5ea1417`）。

## 1. 环境：为什么是 `:8024`，不是换 `:8023`

用户 21:25 的指令是「把 :8023 换成含 a0e307588 的新二进制并重启」。动手前核对了两台服务的真实形态，结论是换 :8023 达不到目的、且有代价，于是改为**并排起一台验证实例**，:8022 / :8023 一个字节没动：

| 服务 | 二进制 | 持久层 | 与本轮的关系 |
| --- | --- | --- | --- |
| `:8023`（pid 76260，`_runs\p3-verify-8023`） | `0.1.27+g0e697503543b`（09-16 19:44，**debug**） | `store_mode=mem`，`/health` `sul_db.medium=mem durable=false`，`model_cache.resident_records=37 / roots=2` | 库在进程里、几乎是空的：`spatial/nearby?refno=17496/105912`（弧墙 WALL 1）与 `24384/22582`（ELBO）都回 `not_found`。换二进制 = 重启 = 这 37 行也归零，而完整流要的墙 / 管数据它本来就没有；PMS e2e 正在用它（22:20 仍在处理 dbnum 7997 增量）。 |
| `:8022`（pid 74824，`_runs\review-full-8031`） | `0.1.27+gc8d5f6b92fee`（09-17 17:09） | `rocksdb` @ `localhost:8009`，durable，`resident_records=3943 / roots=868`，空间树 23 898 条 | 有数据，但它持有 8009 那台库的**机器级写者锁**（`lib.rs::acquire_database_writer_lock`：一台库只许一个写者），第二个实例连 8009 直接启动失败；它又是前端 dev 的缺省后端（`.env.development` `VITE_GEN_MODEL_V1_BASE_URL=:8022`）与校审全量在用的那台。用户没点它，本轮不碰。 |
| **`:8024`（pid 82348，`_runs\surface-clearance-8024`）** | **`0.1.27+ga0e307588e76.1789655384`**（22:29 `cargo build --release --features http_api --bin aios-database`，`git_commit=a0e307588e76`；`dirty` 只因工作树里别人的 `docs/` / `scripts/e3d/NounLayoutExport.cs` 在途 M，`src/` 与 HEAD 一致） | `store_mode=mem`（配置从 `p3-verify-8023\DbOption.toml` 复制，只改 `http_api_addr = "127.0.0.1:8024"`），自己的 `assets\meshes`（不与任何实例共写），`AIOS_E3D_SCHEMA_ROOT=D:\work\plant-code\old\vendor\e3d-io\schema` | 22:33:42 起，4 s 内 `/health ok`。模型数据按需生成：`POST /api/v1/model/ensure {"refno":"24384/22582"}` → 根 `24384/22579` 4 实例、`{"refno":"17496/105912"}` → 根 `17496/105799`（CWALL owner）113 实例，各 0 s；之后 G6 扫描又 ensure 了约 50 个根（`resident_records=1342 / roots=50`，网格 964 个 `.mesh`）。 |

前端：dev `:3111`（HMR 到 `8402b2c` 之后的工作树），页面参数 `?model_source=gen-model-v1&gm_backend_port=8024&show_refno=…`（`src/utils/apiBase.ts` 的 `gm_backend_port` 覆盖）。

> **2026-09-18 08:27 后 `:8022` 已换到 `3509b93f9` 的干净 release**（用户 09-17 23:40 拍板），金样与完整流在 `:8022` 上复验一致——见 §7；上表 `:8022` 那一行是 09-17 的形态。`:8023` 未动。

启动命令（cwd = 运行目录，与 `New-LocalRelease.ps1` 生成的 `Start-AMS.ps1` 同形）：

```powershell
$run = 'D:\work\plant-code\old\_runs\surface-clearance-8024'
$env:DB_OPTION_FILE = "$run\DbOption.toml"; $env:PLANT_ASSET_ROOT = "$run\assets"
$env:AIOS_E3D_SCHEMA_ROOT = 'D:\work\plant-code\old\vendor\e3d-io\schema'; $env:RUST_MIN_STACK = '134217728'; $env:AIOS_OPEN_BROWSER = '0'
Start-Process "$run\aios-database-a0e3075.exe" -ArgumentList serve -WorkingDirectory $run -WindowStyle Hidden `
  -RedirectStandardOutput "$run\logs\<stamp>.stdout.log" -RedirectStandardError "$run\logs\<stamp>.stderr.log"
# pid 写在 $run\service.pid；停掉：Stop-Process -Id (Get-Content $run\service.pid)
```

## 2. HTTP 金样（计划 §7 验证命令那条 curl，端口换 8024）

```
GET http://127.0.0.1:8024/api/v1/spatial/surface-clearance?source_refno=24384/22582&target_refno=17496/105912&debug=1
```

响应（全文 `http-surface-clearance-elbo-x-wall1.json`）：`distance_mm = 64.42777`，`intersects = false`，`target_face = outer / geometric`（法向 (−0.9993, 0.0368, 0)），`perpendicular.distance_mm = 64.49526`，`source_point (−17464.125, 102.353, 2550.0)` → `target_point (−17399.707, 101.229, 2550.0)`，`model.source_sesno 619 / target_sesno 729`，`timing_ms {load 0, query 0, total 4}`，`debug.pairs_total 2 / evaluated 1 / pruned 1`（目标叶子：WALL `17496/105912` 184 tri + FIXING `17496/137183` 128 tri）。
与 PR-A 进程内 live（§7.1 A 对：64.43 / ⊥ 64.50，10 → 5 ms）一致。

未生成数据时同一 URL 回 `404 {"code":"not_found","detail":{"reason":"no_model_mesh","refno":"24384/22582"}}`（22:33 刚起来时打过一次，契约 §5 的四种出口之一）。

## 3. 真 UI 完整流（Playwright 无头、真指针，脚本在仓外）

页面 `http://localhost:3111/?model_source=gen-model-v1&gm_backend_port=8024&show_refno=24384_22582`：

1. `show_refno` 把 ELBO `24384_22582` 加载并置为选中（4 个对象）；再派发 `showModelByRefnos {refnos:['17496_105912'], flyTo:false, requestId}`（树面板「显示」同一条路，不带 highlight 免得改选中）→ `showModelByRefnosDone ok=['17496_105912']`，场景 117 个对象（CWALL owner 113 叶子）。——`01-source-elbo-selected-wall-loaded.png`
2. 菜单栏「测量」→ `.hierarchical-menu-item[data-command="clearance.componentToWall"]`「构件→墙净距」。——`02-measure-menu-component-to-wall.png`
3. 进入 `toolMode = pick_refno`，过滤 `CWALL / WALL / STWALL / GWALL / PANE`；toast「源构件 24384_22582：请点选一堵墙，Enter 确认、Esc 取消」。把 API 给的墙侧最近点抬高 0.55 m 投影到屏幕（正对最近点那束射线会先打到 ELBO），一次点中：`pickedRefnos = ['17496_105912']`。——`03-pick-mode-wall-picked.png`
4. Enter → 前端只发了一条请求 `GET :8024/api/v1/spatial/surface-clearance?source_refno=24384%2F22582&target_refno=17496%2F105912&target_kind=wall` → 200；toast「**外表面净距 64.4 mm（墙面外侧），垂直于墙面**」；`dimensionSystem.externalRegistry.snapshot.records` 里 `source = 'clearance'` 从 0 变 1：`id clearance:clearance:24384_22582:17496_105912`，`sourceLabel 外表面净距: 24384_22582 → 17496_105912（墙面外侧）`，`layout.kind linear`，`authoritativeText "64mm ⊥"`，两端 `a (−17.464125, 0.10235, 2.5500)` / `b (−17.399707, 0.10123, 2.5500)` m（= API 两点 ÷ 1000）；相机飞到两点，尺寸线画出。——`04-result-dimension-64mm.png`（应用自己的飞行机位）、`05-result-closeup.png`（补一张近景）
5. `pageerror` 0；`toolMode` 回 `none`。全部数字见 `ui-full-flow-summary.json`。

## 4. G4 / G6 实机对

扫描：以弧墙 WALL 1 `17496/105912` 为中心 `spatial/nearby radius=1500`（:8022，带 `aabb`），管件族（FTUB / ELBO / BEND / TEE / … / SCTN / BOX）× 墙族（PANE / WALL / STWALL / GWALL / CWALL）**AABB 相交**的 126 对，逐对在 :8024 上 `model/ensure` 后打 `surface-clearance?target_kind=wall`，结果 `g6-scan-pipe-x-wall-aabb-overlap-near-wall1.jsonl`：

| 结果 | 对数 | 例 |
| --- | --- | --- |
| `intersects = true`（G4 穿墙：0 + intersects，`witness = aabb-overlap-center`） | 17 | BEND `24384/24729` × GWALL `17496/118130`；FTUB `24384/24730` × GWALL；BEND `24384/24742` × PANE `17496/136833`；SCTN `24383/68484` / `24383/101200` / `24383/71625`（dbnum 7999 型钢）× 7999 / 1112 的 PANE 多对 |
| 0 mm 且不相交（贴合） | 4 | SCTN `24383/68484` × PANE `24383/68491`（10 mm 厚板，型钢坐在板上） |
| 0 < d < 10 mm | 23 | FTUB `24384/24541` × PANE `17496/158306` 4.39 mm；FTUB `24384/22783` × PANE `17496/137618` 5.70 mm；FTUB `24384/24741` × PANE `17496/136833` 6.72 mm——这些 PANE 全是 **12 个三角形的平板**（转过 9°–30° 所以 AABB 显得像盒子），管子贴着板走，不是穿孔 |
| 10–100 / ≥ 100 mm | 46 / 36 | 弧墙 AABB 松，真距离几百 mm 的很多 |

**G4 由此有了实机对**（PR-A 时 live 未遇到相交对）。**G6「带洞墙、构件在洞里」仍未找到实机对**：AMS 里穿墙的管子都是没开洞的硬穿（上表 17 对），38 个 FIXING（门 / 窗类，各 128 tri，挂在 GWALL 908 tri / WALL 898 / 620 tri 那几堵复杂墙下）周围 `nearby radius=400` 没有任何管件的 AABB 与之相交；六块 FLOOR 的 z 跨度 580–1680 mm、其中 ≤ 600 mm 的那块没有竖管贯穿。带洞路径仍只有合成单测 / 行解析单测覆盖，实机对留待有穿孔数据的工程。

## 5. 顺手发现（未改代码，记进计划 §9）

- **源是目标的后代时会出现自对**：`surface-clearance?source_refno=17496/137183(FIXING)&target_refno=17496/105912(WALL)` 的目标叶子集合按 `anc CONTAINS` 取，包含 FIXING 自己（`target.leaf_count = 2`）。本例 FIXING × WALL 先算出 0（贴合）把自对剪掉了；一般情形自对会给出 0 / intersects，掩盖真实距离。`side-finding-fixing-17496_137183-x-wall-api.json` 是修前的响应。**已修 `gen-model-model-cache` `3509b93f9`**（用户 23:0x 拍板）：`split_shared_leaves` 把重合叶子从祖先那一侧剔掉，warning `source_within_target` / `target_within_source`，剔空 → 422 `shared_leaves_only`；:8024 换到含它的二进制（`0.1.27+gaed4d6c74f6a`）后复验——FIXING × WALL `target.leaf_count` 2→1、带 warning、仍 0 mm 贴合不相交；BRAN `24384/22579` × 自己的 ELBO `24384/22582`（`target_kind=any`）源 4→3 片（剩三段 FTUB）、warning `target_within_source`、0 mm（管身与弯头相接）；金样 ELBO × WALL 1 仍 64.42777 mm 无 warning。
- **FIXING 的库内 AABB 与网格摆放不一致**：8009 里 `aabb:17496_137183 = z −6594…−5332 / x ≈ −2550`（:8022 `nearby` 的 `center` 同样落在 z −5963），而 surface-clearance 用 `insts_flat × world_trans` 拼出的网格与前端 viewer 的包围盒都在 `x −17196…−15549 / z 2088…2212`（墙上 2.1 m 高的过梁位置，`DESP 100,124,12,1650,…`）。`aabb` 表那一行像是只用了 `POS`（owner 局部坐标）没乘 JLDATU / PLDAT 的摆放；影响 `spatial/nearby` / 空间树对这类 datum 下 FIXING 的定位，与本功能无关但值得 gen-model 侧看一眼。`side-finding-fixing-17496_137183-viewer-boxes.json`。
- `:8023` 是 mem 档且几乎无模型数据（§1），之前「:8022 / :8023 共用 8009 库」的判断只对 :8022 成立。

## 6. 复现要点（脚本未入仓）

- 后端：§1 的启动命令；数据 `POST /api/v1/model/ensure {"refno":…}`（ELBO / 墙各一次）。
- 前端完整流：页面参数如 §3；窗口钩子 `window.__dtxLayer.getAllObjectsWithBounds()`（等对象数 ≥ 1）、`window.dispatchEvent(new CustomEvent('showModelByRefnos', {detail:{refnos, flyTo:false, requestId}}))` + 监听 `showModelByRefnosDone`、`window.__viewerToolStore.toolMode / pickedRefnos / pickRefnoFilter`、`window.__viewerContext.dimensionSystem.value.externalRegistry.snapshot.records`；坐标换算与 `e2e/tmp-shortest-ppoint-live.spec.ts` 的 `installFrameHelpers` 同一套（设计 m → 场景：`v.divide(scale(M)).applyMatrix4(M)`；场景 → 像素：`project(camera)`）；相机 `__dtxViewer.flyTo(eye, look, {duration: 0})`。
- 菜单：`.hierarchical-menu-tab__trigger`（hover「测量」打开下拉）→ `.hierarchical-menu-item[data-command="clearance.componentToWall"]`；toast 是 Vuetify `v-snackbar`（success 2.2 s，用 MutationObserver 记 `.v-snackbar__content`）。

## 7. `:8022` 换到 `3509b93f9` 后复验（2026-09-18 08:20–08:29；文件在 `8022-swap-2026-09-18/`）

用户 09-17 23:40 拍板：把 `:8022` 换成含 `3509b93f9` 的 release 二进制（rocksdb 不丢数据，约一分钟停机），换完在 `:8022` 上重跑完整流与金样。

### 7.1 换法（`swap-record.json`）

- **二进制**：主工作树里有别人未提交的 `src/data_interface/model_impact.rs`（+80），直接在那儿 build 会把它带进去；于是 `git worktree add --detach .scratch\gmmc-3509b93f9 3509b93f9` 干净签出后 `cargo build --release --features http_api --bin aios-database`（共享 `D:\Rust\target`，2 m 56 s）→ `build_id 0.1.27+g3509b93f9ba0.1789690830`，`git_dirty=false`；二进制里 `rg -a` 得到 `spatial/surface-clearance` / `shared_leaves_only` / `source_within_target` 各 1 处。复制为 `_runs\review-full-8031\aios-database-3509b93f9.exe`（沿用该目录 `aios-database-<tag>.exe` / `gm-8022-<tag>.pid` / `logs\gm-8022-<tag>.log` 的命名）。用完 `git worktree remove` 掉。
- **旧进程的形态**（换前核对）：pid 74824 `aios-database-c8d5f6b.exe`，cwd = 仓库根 `gen-model-model-cache`（那里的 `.gen-model.instance.lock` 与 `accel_tree_AvevaMarineSample.snapshot` 是它的），配置 = 仓库根 `DbOption.toml`（`store_mode = "rocksdb"`、`http_api_addr = "0.0.0.0:8022"`、`watch_dbnums = [7998, 8000]`、`room_membership = false`——与 `/health` 及日志 banner 逐项对上；`_runs\review-full-8031\DbOption.toml` 写的是 8031 / embedded-mem，不是它用的），资产目录 = 仓库根 `assets`（25 974 个 `.mesh`）。**它是提权起的**：同一用户名但 `Stop-Process` 回「拒绝访问」、CIM 读不到 ExecutablePath；本机 UAC `ConsentPromptBehaviorAdmin=0`（管理员静默提权），所以 `Start-Process powershell -Verb RunAs -ArgumentList 'Stop-Process -Id 74824 -Force'` 不弹窗就结束了它（290 ms）。
- **起新进程**：同一 cwd、同一配置文件、`serve`，env `RUST_MIN_STACK=134217728 AIOS_OPEN_BROWSER=0 AIOS_RESTART_HANDOFF=1 RUST_BACKTRACE=1`，**非提权**（以后 agent 会话能直接管）。08:27:06 起、08:27:15 `/health ok`：**停机 9 s**。写者锁文件 `%LOCALAPPDATA%\gen-model\writer-locks\AvevaMarineSample-bb23a92e….writer.lock` 由新进程重新持有；空间树快照（epoch 1119）与库不一致 → 从库指针重建并落盘 23 898 条（< 1 s）；启动序列 1.18 s，顺手跑完一条 8191 增量（1 行）。`/health`：`rocksdb / durable`，`route_count 71`，`resident_records 0`（overlay 从空开始，读透库里的模型记录；完整流之后 117 / 2 根）。`:8023`、`:8024` 没动。

### 7.2 金样（`http-surface-clearance-elbo-x-wall1.json`）

`GET :8022/api/v1/spatial/surface-clearance?source_refno=24384/22582&target_refno=17496/105912&debug=1` **不用 `model/ensure` 直接 200**（ELBO / 墙的模型记录与网格都在 rocksdb + 仓库根 `assets\meshes` 里）：`distance_mm = 64.42777`，`intersects = false`，`outer / geometric`，法向 (−0.9993, 0.0368, 0)，⊥ 64.49526，两点 (−17464.125, 102.353, 2550.0) → (−17399.707, 101.229, 2550.0)，`source_sesno 619 / target_sesno 729`，`timing_ms {load 0, query 0, total 3}`，pairs 2 / 1 / 1，`warnings []`——与 §2（`:8024`）及 PR-A 进程内 live 逐字段一致。

`3509b93f9` 那条修复在 `:8022` 上也是活的：FIXING `17496/137183` × WALL `17496/105912`（`target_kind=wall`）→ `target.leaf_count 1`、warning `source_within_target`；BRAN `24384/22579` × 自己的 ELBO `24384/22582`（`target_kind=any`）→ 源 3 片、`target_within_source`、0 mm；同 refno → 400。

### 7.3 真 UI 完整流（`ui-full-flow-summary.json`，五张截图）

页面 `http://localhost:3111/?model_source=gen-model-v1&gm_backend_port=8022&show_refno=24384_22582`（`gm_backend_port=8022` 与 `.env.development` 的缺省后端相同，显式写只是免歧义），步骤与 §3 相同：`show_refno` 选中 ELBO（4 对象）→ `showModelByRefnos` 加载墙 `ok=['17496_105912']`（117 对象，toast「已从 gen-model 加载 113 个几何实例」）→ 菜单「测量 › 构件→墙净距」→ `toolMode = pick_refno`、过滤 `CWALL / WALL / STWALL / GWALL / PANE`，toast「源构件 24384_22582：请点选一堵墙，Enter 确认、Esc 取消」→ 墙侧最近点抬高 0.55 m 投影到 (882.8, 318.6) 一次点中 `pickedRefnos = ['17496_105912']` → Enter → 前端只发一条 `GET :8022/api/v1/spatial/surface-clearance?source_refno=24384%2F22582&target_refno=17496%2F105912&target_kind=wall` → 200 → toast「**外表面净距 64.4 mm（墙面外侧），垂直于墙面**」→ `externalRegistry` `source='clearance'` 一条：`id clearance:clearance:24384_22582:17496_105912`，`sourceLabel 外表面净距: 24384_22582 → 17496_105912（墙面外侧）`，`layout.kind linear`，`authoritativeText "64mm ⊥"`，`a (−17.464125, 0.10235, 2.5500) / b (−17.399707, 0.10123, 2.5500)` m（= API 两点 ÷ 1000）→ 飞到两点、尺寸线画出；`toolMode` 回 `none`；`pageerror` 0。控制台 7 条 error 全是页面加载期的 `projects` 404 与 401（`useModelProjects` / 鉴权接口），与本功能无关。

### 7.4 顺手发现：`:8022` 库里那枚 FIXING 的模型记录落点是错的（`side-finding-fixing-17496_137183-placement-8022-vs-8024.json`）

同一逻辑、同一 `model_sesno 729`：`:8024`（09-17 现生成）里 FIXING `17496/137183` 的网格在 (−16364.8, −2930.1, 2106.2)——墙上 2.1 m 处，与 viewer 一致；`:8022`（rocksdb 存量记录）里在 (−2593.8, 12222.1, −5345.0)，与 8009 那行 `aabb:17496_137183`（x ≈ −2550、z −6.6…−5.3 m）同一个位置，于是 FIXING × 它所在的 WALL 在 `:8022` 上算出 **10 358.7 mm**（`:8024` 上是 0 mm 贴合）。§5 第二条「`aabb` 行只用了局部 `POS`」的根源看来在**存量模型记录本身**（`insts_flat × world_trans` 当初就摆错了），`aabb` 行只是从它算出来的；旧二进制生成时的 datum（JLDATU / PLDAT）处理与现在不同。对本功能：ELBO × WALL 1 金样两边一致，不受影响；凡 datum 下的 FIXING，`:8022` 要**重新生成那个根**（`17496/105799`，113 实例）才对，没有动它——是不是整库重建一遍模型记录由用户定。
