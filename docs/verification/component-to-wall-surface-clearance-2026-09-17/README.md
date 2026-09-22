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

> **2026-09-18 08:27 后 `:8022` 已换到 `3509b93f9` 的干净 release**（用户 09-17 23:40 拍板），金样与完整流在 `:8022` 上复验一致——见 §7；**09:12 再换到 `994f2e0cc`**（世界网格缓存键修复，§7.5）。上表 `:8022` 那一行是 09-17 的形态。`:8023` 未动。

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

同一逻辑、同一 `model_sesno 729`：`:8024`（09-17 现生成）里 FIXING `17496/137183` 的网格在 (−16364.8, −2930.1, 2106.2)——墙上 2.1 m 处，与 viewer 一致；`:8022`（rocksdb 存量记录）里在 (−2593.8, 12222.1, −5345.0)，与 8009 那行 `aabb:17496_137183`（x ≈ −2550、z −6.6…−5.3 m）同一个位置，于是 FIXING × 它所在的 WALL 在 `:8022` 上算出 **10 358.7 mm**（`:8024` 上是 0 mm 贴合）。§5 第二条「`aabb` 行只用了局部 `POS`」的根源看来在**存量模型记录本身**（`insts_flat × world_trans` 当初就摆错了），`aabb` 行只是从它算出来的；旧二进制生成时的 datum（JLDATU / PLDAT）处理与现在不同。对本功能：ELBO × WALL 1 金样两边一致，不受影响；凡 datum 下的 FIXING，`:8022` 要**重新生成那个根**（`17496/105799`，113 实例）才对。

**08:40 按用户指示在 `:8022` 上重算了那个根**（`regen-root-17496_105799-record.json`）：`POST /api/v1/model/ensure {"refno":"17496/105799","force":true}` → 200 / 237 ms，`Generated`，`generated_instance_count 168`（`published_geometry_count 113`，`published_via regen`，`source_sesno 729`，`durable`），write-behind 1 s 内落库无 error。库里 `inst_relate:17496_137183` 的 `world_trans.translation` 变为 (−15559.963, −2743.641, 2150.0)，`model_sesno` 仍 729；`aabb` 行与 `nearby` center 在重算前就已经是对的（(−17195.7…−15549.2, −3091.2…−2682.6, 2088…2212)，09-17 23 点读到的 z −6.6 m 在这之间被别的过程修过，不是本轮）。

**但同一进程里 FIXING × WALL 仍回 10 358.7 mm**（`fixing-x-wall-8022-after-force-regen-stale-cache.json`）：`surface_clearance.rs::build_leaf_mesh` 的世界网格缓存 `LEAF_MESHES` 键是 `(叶子 key, model_sesno)`，注释写「换版自然失效」——**强制重算不换源会话号，键 `(17496_137183, 729)` 不变，旧网格一直命中**。用一条只读请求把缓存挤掉（源 = ZONE `17496/8516`，1 789 片叶子 / 43 720 三角 > 上限 1 024 → 整体清空；560 ms，结果照样 64.42777）之后再问，**0 mm 贴合、`intersects=false`，`sp = tp = (−16364.817, −2930.0754, 2106.1594)`，与 `:8024` 逐字一致**，warning `source_within_target`（`fixing-x-wall-8022-after-force-regen-cache-cleared.json`）。金样 ELBO × WALL 1 前后都是 64.42777 mm（墙根重算没改它的几何）。缓存键那一条记进计划 §9。

### 7.5 缓存键修复落地：`gen-model-model-cache` `994f2e0cc`，`:8022` 09:12 换上（`swap-record-2-994f2e0cc.json`）

用户拍板后改 `surface_clearance.rs`：`LeafRow` 新增 `placement_fingerprint`（`row_to_leaf` 里由 `world_trans` 与每个实例的 `geo_hash` / 本地变换算出），`leaf_cache_key()` 统一出键 `(key, model_sesno, 指纹)`，`LEAF_MESHES` 改 `DashMap<(String, i64, u64), _>`；没 `model_sesno` / 空 key 的行照旧不进缓存，`UNIT_MESHES`（按内容哈希 `geo_hash`）未动。单测 2 条：`placement_fingerprint_tracks_world_trans_and_instances`、`leaf_mesh_cache_misses_when_placement_changes_under_the_same_sesno`（临时目录写一片单位三角形 `.mesh`，同 key 同 sesno 只换 `world_trans` 的第二行拼出 x+1000 的新网格而不是命中旧缓存；摆放没变的第三次仍命中同一份 `Arc`）。`cargo test --lib -- surface_clearance …` **17 passed**（15 旧 + 2 新）、1 ignored；`rustfmt --check` 本次改动 0 diff。

二进制仍从干净 worktree build（`0.1.27+g994f2e0cc00a.1789693424`，`git_dirty=false`，2 m 56 s；主工作树此刻有别人的 `model_impact.rs` 在途 M 与未跟踪的 `tests/zz_tmp_room_probe.rs`），`:8022` 09:12:38 停旧起新 **停机 10 s**（launch 同 §7.1）。新进程第一问 FIXING × WALL 就是 0 mm 贴合、金样 64.42777 mm 不变。live 上已经没有第二枚落点错的 FIXING 可拿来演示「重算后立刻失效」，那一条靠单测担保。

### 7.6 1112 库全部 FIXING 逐枚核对：190 枚，0 错（`fixing-1112-audit-store-vs-fresh.json`）

`inst_relate` 里 `generic = 'FIXING' AND dbnum = 1112` 共 **190** 行（之前写的「另 37 个」是 WALL 1 周边扫描的局部数，不是全库数）。逐枚：`:8024` `POST /model/ensure {refno: FIXING}` 现生成（回执 `generation_roots[0]` 是它所在的墙，共 13 堵）→ `:8024` `model/records {generation_root: 墙}` 取现生成的 `world_trans`；`:8022` `model/records {generation_root: FIXING}` 取存量 `world_trans`；比平移（阈值 1 mm）与四元数（1e-3，q 与 −q 同姿态）。结果 **190 / 190 一致，最大偏差 0 mm / 0**，`model_sesno` 全部 729；CWALL `17496/105799` 下 28 堵墙里的 38 枚 FIXING（昨天扫描说的那 38 个）全对——其中 `17496/137183` 是 08:40 重算修好的，其余 37 枚是否在那次重算前就对、还是随根一起被修，没有重算前的快照可断。**没有需要再重算的根。** 耗时 61 s。

### 7.7 1112 库全部模型行核对：4 892 行（PANE 4 275 / FIXING 190 / SBFI 137 / GWALL 120 / FLOOR 81 / STWALL 75 / WALL 14），0 错（`dbnum-1112-all-rows-audit-store-vs-fresh.json`）

用户要确认「旧二进制的 datum 摆放问题只碎在 FIXING」，索性全库核而不抽样：存量侧一句 SQL 取 `inst_relate` 里 `dbnum = 1112` 全部行的 `world_trans_d`（平移 + 四元数，4 892 行 656 KB，0.7 s）；现生成侧按根取——每遇到一行还没被任何根覆盖的，`:8024` `model/ensure {refno}` 一次拿 `generation_roots[0]`，再 `model/records {根}` 把该根全部记录一并收下（149 个根、149 次 ensure，20 s 跑完）。阈值仍是平移 1 mm / 四元数 1e-3（q 与 −q 同姿态）。**4 892 / 4 892 一致，各 noun 最大平移偏差 0.001 mm（f32 舍入）、四元数偏差 0，现生成侧一行不缺。**

结论：`17496/137183` 是 1112 库里**唯一**一行落点错的存量记录——同一批 FIXING 里其余 189 枚、同样挂在 datum 下的都对，PANE / 墙族 / 楼板 / SBFI 也全对。这更像那一次生成的偶发（当时 datum 属性没读到、或半截重算写了个错的 `world_trans`），不是旧二进制系统性的 datum 摆放 bug；§5 / 计划 §9 那条按此收口。副作用：`:8024`（mem 验证实例）现在装着 1112 整库 4 892 条模型记录（149 根）。

### 7.8 8000 / 7999 / 7997 三库全部模型行核对：20 095 行，0 错（2026-09-18 11:29–12:01；`dbnum-{8000,7999,7997}-all-rows-audit-store-vs-fresh.json`）

用户 09:27：「用同一套方法把 8000（管道）/ 7999 / 7997 几个库的存量模型记录也核一遍，确认全库就那一行错」。方法同 §7.7，三处不同：

- **现生成侧另起了一台 mem 实例 `:8026`**（`_runs\audit-store-vs-fresh-8026`：`DbOption.toml` 从 `surface-clearance-8024` 复制、只改 `http_api_addr`；二进制是 `:8024` 当时那份 `aios-database-83beef25.exe` 的副本；§1 的命令起、2 s ready），没往 `:8024` 里灌——它今天被换了四次（§8.1 / §8.4 / §8.5 / §8.6，最近一次 11:28 正好在本节开跑前），中途换机会把在飞的核对打断，两万行也会把它撑到 1.1 GB。`:8022` / `:8023` / `:8024` 一个字节没动。
- **管道库的隐式管身在 `tubi_relate`**（`surface_clearance.rs` 两张表都查）：存量侧一并取 `world_trans.d`（`id = [pe, 序号]`，`scale` 编码半径 / 长度，平移是段中点），现生成侧 `model/records` 里 `generic = 'TUBI'`、`insts[0].is_tubi = true` 的行按 refno 多对多配最近平移，`scale` 也比（容差 1 mm）。`inst_relate` 行仍用 `world_trans_d`。
- **生成根会嵌套**：`model/records` 按 `anc` 取一根名下全部行，父根的结果会把子根的成员再包一遍（7999 `24383/72244` 的 18 行里 16 行同时属于子根 `24383/72245`）。同元素、同变换在两根下各出一次，只算一份（7999 去重 55 行、7997 44 行），否则会误报成「现生成多出来的行」。另：7997 的源库在核对期间会话 274 → 277 还在推进（另一条会话 / PMS e2e 在写），`model/ensure` 偶发 409「生成根 X 正在后台生成」（flight 结束时 `generation_source_identity` 已变 / 根不再 current），第一遍撞上 9 行；脚本改成退避 2 s 重试，第二遍 0 失败。核对期间 mem 实例还记到一次 8000 的 `file_replaced 619 → 619`、660 根全部重生成，两遍数字相同。

| 库 | `inst_relate` | `tubi_relate` | 生成根 | 一致 | 最大平移偏差 | 四元数 / scale 偏差 | 存量 `model_sesno` | 源现会话 | 耗时（第 1 遍冷生成 / 第 2 遍缓存） |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 8000（管道，`:8022` 监听中） | 2 529 | 126 | 660 | **2 654 / 2 655** | 0.002 mm | 0 / 0 | 586 × 2 553、603 × 1、619 × 101 | 619 | 55 s / 11 s |
| 7999 | 2 893 | 894 | 493 | **3 787 / 3 787** | 0.001 mm | 0 / 0 | 194 × 3 787 | 194 | 80 s / 8 s |
| 7997 | 13 576 | 77 | 3 028 | **13 653 / 13 653** | 0.004 mm | 0 / 0 | 184 × 13 594、198 × 59 | 277 | 21 m 45 s / 46 s |

noun 覆盖：8000 13 种（FTUB 1 554 / BEND 627 / ELBO 161 / TUBI 126 / EXTR 74 / BOX 46 / CYLI 34 / SCTN 22 …），7999 23 种（TUBI 894 / SCTN 623 / PANE 541 / ELBO 427 / ATTA 370 / FLAN 198 / OLET 118 / VALV 113 …），7997 43 种（PANE 3 933 / EXTR 3 458 / CYLI 1 884 / SCTN 1 277 / STRT 800 / BEND 362 / BOX 334 / FLOOR 192 / STWALL 169 / GWALL 132 / FIXING 70 / WALL 48 …）。每种 noun 的 `max_dt_mm` 都在 f32 舍入量级（≤ 0.004 mm），四元数与 TUBI 的 scale 偏差全是 0；现生成侧没有存量里没有的行，存量里也没有现生成给不出的行。

**8000 里没比上的那 1 行是孤儿，不是摆放错**：BOX `24384/26481`（`model_sesno 603`，平移 (−2821.27, 8003.96, 3900)），`model/ensure` → 404「dbnum 8000 会话 619 的索引里没有 24384/26481」（`:8022` 同样 404）；源 `pe` 行 `deleted = true`、`sesno = 604`——元素在生成模型的**下一个会话**就被删了，模型行没跟着退，`aabb` / `anc` 都还在。8000 里 `pe.deleted = true` 的元素有 6 643 个，模型行只剩这一条孤儿（7999 / 7997 / 1112 各 0），删元素退模型行这条路平时是通的，这一条是 603 → 604 那次增量漏掉的。它拿不出元素，surface-clearance 选不到它；空间树若从库指针重建会不会把它算进去，没验。要清就 `:8022` 上删 `inst_relate:24384_26481`（连带 `aabb:24384_26481`）或整根重算——由用户定。

**结论**：四库合计 **24 987 行**存量模型记录（1112 4 892 + 8000 2 655 + 7999 3 787 + 7997 13 653）对现生成，落点错的**只有** `17496/137183` 那一行（08:40 已重算修好，§7.4）。7997 的存量停在 sesno 184 而源库已到 277（`:8022` 不监听它），13 653 行仍全部一致——这 90 多个会话没有动过这些元素的位置。`:8026` 用完即停、目录已删（要复跑：§1 的命令换端口 + 脚本在仓外 `%TEMP%\audit-store-vs-fresh.mjs`，方法要点写在三份 json 的 `method_notes`）。

**那条孤儿的来历与成因（12:1x 查实，`mem-161`）**：它是 gen-model 09-15 ADR-076 S5 实测的尾巴——`EQUI /CODEX_S5_EQUI_7F3A2B10`（`24384/26480`，含这 1 个 BOX）由增量在 587→588 新建、挪了七窗，`07-cleanup.mac` 的 `DELETE EQUI` + SAVEWORK 落在窗口 603→604，被测二进制 `8adec7169`（`gen-model-model-cache/docs/evidence/2026-09-15-adr076-increment-durable-boundary.md` §7 当时就记下了这四行孤儿）。断点在**规划器选根**而不是执行器：DESI 库走 `window_root_plan.rs::build_model_update_plan_from_window`，当时 `roots_S` 从 `gen_root` 表读（`load_persisted_roots_with_settlement`），而增量新建的根从没进过那张表（始终 952 条），于是 `delete = roots_S \ roots_T = ∅`——窗口日志原文 `roots_T=952 roots_S=952 touched=0 regen=0 delete=0`——`DeleteCleanup` 根本没排，`delete_model_subtree` 一次没被调，任务 `applied` / `finished` 无 warning。`docs/plans/2026-09-15-delete-window-model-orphans-dev-plan.md`（待批准）指的 `topmost_deleted_refnos` + `pe_owner` 子树走不下去，是只给 CATA 用的老规划器 `model_update_plan.rs::build_model_update_plan`，不在这窗的路上；而且 ingest 档 `on_demand_model.rs::delete_model_subtree` 里对每个 lock root 还有按 `anc CONTAINS packed(root) AND model_sesno != NONE` 删的墓碑 `render_spooled_scope_deletion`，那句谓词在 8009 上只读重放能命中这行孤儿（`by_anc = ["24384_26481"]`），边断了也删得掉。**ADR-079**（`0247da413`，09-15 23:53）把 `gen_root` 退役、`roots_S` 改为 `DbSet@S` 枚举（`window_root_plan.rs:1097–1102`）之后，同一窗会排出 `DeleteCleanup(26480)`——成因已关（未 live 复验）。四库现存 `inst_relate` 行全部带 `anc` 与 `model_sesno`，`in.deleted = true` 的孤儿两表合计只有这一行。

**12:2x 已清**（`orphan-24384_26481-backup-before-delete.json` 是删前原样备份，含 `pe` 两行墓碑）：走服务自己的口子 `DELETE :8022/api/v1/model/subtree?refno=24384/26481&confirm=24384/26481` → 200 / 101 ms `{"scope":"exact_subtree","status":"deleted"}`（ingest 档：`resolve_generation_roots_on` 解到根 EQUI `26480` → anc 墓碑 + `delete_inst_relate_subtree`）。删后 `inst_relate` / `inst_info` / `aabb` / `trans:24384_26481` 与 `geo_relate:[inst_info:24384_26481, …]` 五行都没了（上一段说 `geo_relate` 0 行是 `count() … GROUP ALL` 对 `in =` 谓词失真，实际 1 行，备份里有），8000 `inst_relate` 2 529 → **2 528**（= 09-15 实测前的基线 2 527 + 09-17 之后新增的 1 行）；`pe` 两行墓碑照旧；`/health` ok、`problems 0`；`spatial/nearby` 以它的坐标半径 1.5 m 查 8000 前后都 6 件、都没有它（空间树本来就排除软删元素，`?refno=24384/26481` 前后都 404）；金样 ELBO × WALL 1 仍 64.42777 / ⊥ 64.49526、warning 0。

### 7.9 `:8022` 三换到 `7bcdd60df`（含 09-18 四条 surface-clearance 口径）：金样逐位一致、四条口径逐对都活、真 UI 完整流两对（2026-09-18 11:54–12:10；`swap-record-3-7bcdd60df.json`）

用户 11:4x 拍板：「把 :8022 换到 7bcdd60df（含四条口径），非提权同 cwd 重起，停机约 10 s，换完跑金样 + 完整流复验」。四条口径 = `eabd16d5c` 洞壁 `opening`（§8）、`0dce7fee2` 落空换面读 `end` / `top`（§8.4）、`83beef257` 贴合不打射线 `contact`（§8.5）、`7bcdd60df` 棱上连线当垂距 `edge` + `perpendicular_ray_missed` 删除 + `perpendicular.method`（§8.6）。

- **换法**：二进制直接复制 `:8024` 11:28 四换用的那份 `aios-database-7bcdd60d.exe`（sha256 `71E63527…`，`git_commit=7bcdd60df238`，`git_dirty=false`；`D:\Rust\target\release` 里的 exe 11:40 已被别的构建覆盖，没再从那儿取）为 `_runs\review-full-8031\aios-database-7bcdd60df.exe`。旧进程 pid 45700（`994f2e0cc`，09:12 起，非提权）11:54:11.3 `Stop-Process` 264 ms 退出；11:54:12.7 同 cwd（仓库根）/ 同仓库根 `DbOption.toml` / `serve` / 同一组 env **非提权**起 pid **57636**，11:54:19.4 `/health core=ready`：**停机 8.1 s**。`rocksdb / durable`，写者锁 `AvevaMarineSample-bb23a92e…` 由新进程重新持有；`resident_records` 从 0 起。日志 `logs\gm-8022-7bcdd60df.log(.err)`，pid 在 `gm-8022-7bcdd60df.pid`。`:8023` / `:8024` 没动。
- **金样**（`http-surface-clearance-elbo-x-wall1-7bcdd60df.json`，不用 `model/ensure`）：64.42777 / `outer / geometric` / 法向 (−0.9993213, 0.036837157, 0) / ⊥ 64.49526 **`method = ray`** / 两点 (−17464.125, 102.35253, 2550.0002) → (−17399.707, 101.22853, 2550.0002) / sesno 619 / 729 / `timing 1/0/4 ms` / pairs 2/1/1 / `warnings []`——与 §7.2（08:27）逐位一致，Δ = 0。
- **四条口径在 `:8022` 上逐对核**（都不用 `ensure`，读 rocksdb 存量）：`3509b93f9` 共叶剔除——FIXING `17496/137183` × 自己的 WALL `17496/105912` → 0 mm、不相交、**`opening / geometric`**、⊥ 0 `contact`、leaves 1 / 1、warning `source_within_target`（**live 第一对读到 `opening`**：门窗 FIXING 坐在本墙的洞里、与洞壁贴合——§4 说的「live 没有构件在洞里的对」到此有了一对，只是距离为 0）；`83beef257`——SCTN `24383/68484` × PANE `24383/68491` → 0 mm、`side / pca`、⊥ 0 `contact`、无 warning；`7bcdd60df`——FTUB `24384/24671` × PANE `17496/135244` → 46.603077、`side / pca`、⊥ 46.603077 `edge`（与 `:8024` 逐位相同），FTUB `24384/22533` × WALL `17496/105935` → 1.2637867、`outer`、⊥ 1.2637867 `edge`；`0dce7fee2`——FTUB `24384/24458` × GWALL `17496/118130` → 82.74456、`end / pca`、无 ⊥、无 warning。
- **真 UI 完整流 ①金样对**（`ui-7bcdd60df-full-flow-summary.json`，`ui-7bcdd60df-01…05.png`；dev `:3111`，`gm_backend_port=8022`，Playwright 无头真指针，步骤同 §3）：`show_refno=24384_22582` 4 对象 → `showModelByRefnos 17496_105912` ok（117 对象）→ 「测量 › 构件→墙净距」→ `pick_refno` 过滤 `CWALL / WALL / STWALL / GWALL / PANE` → 墙侧最近点抬高 0.55 m 投影到 (709.8, 281.4) 一次点中 → Enter → **只发一条** `…surface-clearance?…&target_kind=wall` → 200 → toast「**外表面净距 64.4 mm（墙面外侧），垂直于墙面**」→ `externalRegistry` `clearance` 记录 1 条：`64mm ⊥`、`a (−17.464125, 0.10235253, 2.5500002) / b (−17.399707, 0.10122853, 2.5500002)` m → `toolMode` 回 `none`；`pageerror` 0，控制台 7 条 error 全是页面加载期 `projects` 404 / 401。与 §7.3 逐字段相同。
- **真 UI 完整流 ②edge 对**（`ui-7bcdd60df-edge-ftub-x-pane-full-flow-summary.json`，`…-04-result-dimension.png` / `…-05-result-closeup.png`）：`show_refno=24384_24671`（FTUB，7 对象）→ 加载 PANE `17496_135244`（38 对象）→ 板侧最近点抬高 0.1 m（板只有 300 mm 高）投影到 (791.8, 380.3) 一次点中 → Enter → 一条请求 200：46.603077 mm `side` ⊥ 46.603077 `edge` → toast「**外表面净距 46.6 mm（墙面），近似垂直于墙面（最近点在墙的棱上，取连线为垂距）**」——plant3d-web `a34e126c` 的新话：前端声明了 `perpendicular.method`，toast 对 `contact`（「与墙面贴合，垂距即净距」）/ `edge` 各说一句，`ray` 照旧；尺寸文字 `47mm ⊥`（≥ 10 mm 取整）、`a (−10.385053, 11.770906, 1) / b (−10.424999, 11.746903, 0.99999994)` m；`pageerror` 0。
- 脚本仍在仓外（`.scratch\ui-flow-clearance.mjs`，用完已删）：钩子与坐标换算同 §6，多了一手「点不中就按目标包围盒中心 + 沿面法向 3 m 处 `flyTo` 再点」的退路，本次两对都是第一手直接点中、没用到。

## 8. `:8024` 换到 `eabd16d5c`（洞壁 `opening` 口径）后复验：金样与 126 对全部一致（2026-09-18 09:26–09:33；文件在 `8024-swap-2026-09-18/`）

### 8.1 换法（`swap-record-8024-eabd16d5c.json`）

- 从 `gen-model-model-cache` `eabd16d5c` 开干净 worktree（`.scratch\wt-eabd16d5c-opening`，用完已删）`cargo build --release --features http_api --bin aios-database`，3 m 01 s，`build_id 0.1.27+geabd16d5cdda.1789694793`（无 `.dirty`——工作树里别人的 `model_impact.rs` / `model_db_adapter.rs` 在途 M 没被带进去）。
- 复制为 `_runs\surface-clearance-8024\aios-database-eabd16d5.exe`；09:31:25 `Stop-Process` 旧进程 pid 69496（`aios-database-shared-leaves.exe`，`0.1.27+gaed4d6c74f6a…dirty`，09-17 23:25 起），09:31:28 以 §1 的命令起新进程 pid 67008，5 s 内 `/health` ready。mem 档，重启即清库：§7.7 那次装进去的 1112 整库 4 892 条模型记录随之清空；本节按需 `model/ensure` 了 97 个 refno（金样两侧 + 126 对涉及的 72 源 / 23 目标），`resident_records = 1215`。`:8022` / `:8023` 一个字节没动。

### 8.2 金样（`http-surface-clearance-elbo-x-wall1-eabd16d5c.json`）

`ensure 24384/22582`（根 `24384/22579`，4 实例，414 ms）、`ensure 17496/105912`（根 `17496/105799`，113 实例，218 ms）后 `GET …surface-clearance?source_refno=24384/22582&target_refno=17496/105912&debug=1` → 200：`distance_mm 64.42777`、`intersects false`、`outer / geometric`、法向 (−0.9993213, 0.036837157, 0)、`⊥ 64.49526`、两点与 09-17 金样逐位相同、`sesno 619 / 729`、`total 4 ms`、`pairs 2/1/1`、`warnings []`。与 §2（09-17，`a0e307588`）**逐字段一致**，Δdistance = Δ⊥ = 0。

### 8.3 126 对重放（`replay-126-pairs-eabd16d5c.jsonl`，每行带 `old_*` 是 §4 的旧值）

§4 那 126 对 AABB 相交的管 × 墙逐对重打 `?target_kind=wall`：126/126 → 200；**`intersects` 17 = 17，一对不差**（BEND `24384/24729` × GWALL `17496/118130`、BEND `24384/24742` × PANE `17496/136833`、FTUB `24384/24730` / `24384/24743` × GWALL、13 对 dbnum 7999 型钢 SCTN × PANE）；**距离 126 对全部一致**（max |Δ| 0.005 mm——旧记录只存到两位小数，是四舍五入）；有垂距的 73 对前后都有、没有的 53 对前后都没有，`⊥` 值 72 对差 ≤ 0.005 mm，1 对差 0.12 mm（FTUB `24384/24514` × GWALL `17496/118130`：57.77 → 57.65，距离 57.46 不变——最近点落在弧墙两片相邻小面的共棱上，新的 `hit_triangle` 选了法向更贴合源方向的那片，垂距沿它打，仍在 1% 容差内）。**`opening` 0 对**：AMS 里本来就没有构件在洞里的对（§4），本次只能证明新口径不碰旧金样。

**分类变化 5 对**（都是最近点落在墙端与主面共棱上的边缘情形，`end` → 主面，垂距前后都是 null）：FTUB `24384/22533` × WALL `17496/105935`（1.26 mm，`end` → `outer/geometric`）、FTUB `24384/22737` × PANE `17496/137594`（23.19 mm，`end` → `side/pca`）、FTUB `24384/24513` / `24384/22739` / `24384/24101` × GWALL `17496/118130`（75.03 / 80.66 / 171.70 mm，`end` → `outer/geometric`）。原因是 `eabd16d5c` 的 `hit_triangle`：共棱处不再由 parry 随手挑一片，而是选法向最贴合「指向源侧」方向的那片——这 5 对的源更像正对主面而不是越过墙端，于是读成主面；主面要打垂距，射线擦棱落空，多出 `perpendicular_ray_missed` warning（前端标签从「墙端」变成「墙面外侧」/「墙面」，仍不带 ⊥）。与 G2 合成用例同一情形（计划 §7 G2 行已改成两种读法都收）。其余 121 对分类不变（新分布：side 54 / outer 25 / inner 23 / end 7 / 相交 17）。

### 8.4 用户不要「主面 + 落空警告」：`0dce7fee2` 落空就换棱上另一面读，`:8024` 09:48 再换一次（`swap-record-8024-0dce7fee2.json`）

- 改法（gen-model-model-cache `0dce7fee2`）：`hit_candidates` 把 q 处所有共点的三角按贴合度列全；`resolve_target_face` 先按第一片打垂距，**落空且共棱上还有别的三角**就换面——另一面是端 / 顶 / 底就直接读它（棱本来也属于它，不用垂距、不报落空），另一面也是主面就沿它再打一次；都不成才留第一面 + `perpendicular_ray_missed`。合成用例 18 条全过（新增 `edge_hit_falls_back_to_end_when_the_side_ray_misses`）。
- 换法同 §8.1：干净 worktree 构建 2 m 35 s，`build_id 0.1.27+g0dce7fee26c9.1789695900`（叠在另一条会话的 `7d67ca5f8` 之上，二进制含它）；09:48:31 停 pid 67008 起 pid 58268，3 s ready；重新 `ensure` 97 个 refno。
- 金样（`http-surface-clearance-elbo-x-wall1-0dce7fee2.json`）：64.42777 / ⊥ 64.49526 / outer / geometric，与 §2 一致。
- 126 对（`replay-126-pairs-0dce7fee2.jsonl`）：126/126 → 200；`intersects` 17 = 17；距离 max |Δ| 0.005 mm；垂距有 / 无 73 / 53 不变，`⊥` 仍只有 `24384/24514` × GWALL 那 1 对差 0.12 mm。**§8.3 那 5 对全部回到 `end`、无警告**。另外 **17 对** 09-17 时是「`side` + `perpendicular_ray_missed`」的，现在按同一条规则读到棱上的另一面：15 对 `end`（FTUB `24384/2659` / `2663` / `2670` / `2683` / `3110` / `3113` × PANE `17496/1290xx` / `1295xx` / `1298xx`、FTUB `24384/24741` × PANE `17496/123610`、FTUB `24384/24663` × PANE `17496/135244`、FTUB `24384/22738` × PANE `17496/137588`、FTUB `24384/24458` × GWALL `17496/118130`），2 对 `top`（SCTN `24383/71625` × PANE `24383/71628`、FTUB `24384/22781` × PANE `17496/137618`——构件骑在板的顶棱上方），都不再带警告。「主面 + 落空警告」从 09-17 的 24 对降到 **7 对**：4 对是 SCTN 坐在 PANE 板上的 0 mm 贴合（垂距退化为 0，射线从贴合点出发打不出 toi）、3 对（FTUB `24384/24671` × PANE `17496/135244` 46.6 mm、`24384/2683` × `17496/129513` 93.1 mm、`24384/3110` × `17496/129020` 184.1 mm）最近点在 12 三角平板的棱上但棱两侧都是主面。新分布：side 36 / end 27 / inner 23 / outer 21 / top 2 / 相交 17；`opening` 仍 0 对。

### 8.5 用户也不要 0 mm 贴合的落空警告：`83beef257` 贴合不打射线、垂距直接 = 距离，`:8024` 10:16 三换（`swap-record-8024-83beef257.json`）

- 改法（gen-model-model-cache `83beef257`）：`resolve_target_face` 里主面要垂距时，**距离 ≤ 垂距容差 max(1%, 0.05 mm)**（与射线落点容差同一个数，抽成 `perpendicular_tolerance`）就不打射线，直接回 `perpendicular = { distance, from: 源侧最近点, to: 目标侧最近点 }`、无 warning——贴合 0 mm 时垂距即 0；0.05 mm 内的微小间隙给的是距离本身而不是硬写 0，垂距与最近距离仍一致。合成用例 19 条全过（新增 `touching_component_gets_a_zero_length_perpendicular_without_a_ray`：离墙面 0.02 mm 的盒 → 不相交、`side`、垂距 = 距离、垂足 = 目标侧最近点、无 warning）。
- 换法同 §8.1：干净 worktree 构建 2 m 44 s，`build_id 0.1.27+g83beef25754b.1789697591`（叠在另一条会话的 `2d27bde35` 之上，二进制含它）；10:16:26 停 pid 58268 起 pid 15392，4 s ready；重新 `ensure` 97 个 refno（8 s），`resident_records = 1215`。
- 金样（`http-surface-clearance-elbo-x-wall1-83beef257.json`）：64.42777 / ⊥ 64.49526 / outer / geometric、两点逐位相同，与 §2 一致（Δ = 0）。
- 126 对（`replay-126-pairs-83beef257.jsonl`）：126/126 → 200；`intersects` 17 = 17；距离 max |Δ| 0.005 mm；**有垂距 73 → 77 对，多出的正是那 4 对 0 mm 贴合**（SCTN `24383/68484` / `24383/101200` × PANE `24383/101207` / `24383/68491`）：`side/pca`、`⊥ 0`、`from = to` = 目标侧最近点 (−10147.158, 12070.674, 3077.96)（四对共用同一个点——两根型钢与两块板在同一个节点上碰着）、warning 空。与 §8.4 那轮逐对比**只有这 4 对变了**；`⊥` 仍只有 `24384/24514` × GWALL 那 1 对差 0.12 mm。「主面 + 落空警告」**7 → 3 对**，剩下的都是最近点在 12 三角平板的棱上且棱两侧都是主面（FTUB `24384/24671` × PANE `17496/135244` 46.6 mm、`24384/2683` × `17496/129513` 93.1 mm、`24384/3110` × `17496/129020` 184.1 mm），不在本次口径里。分布不变：side 36 / end 27 / inner 23 / outer 21 / top 2 / 相交 17；`opening` 仍 0 对。`:8022`（`994f2e0cc`）/ `:8023` 未动。

### 8.6 剩下 3 对落空也收掉：`7bcdd60df` 连线几乎沿面法向就取连线当垂距（`edge`），`perpendicular_ray_missed` 删除，`:8024` 11:28 四换（`swap-record-8024-7bcdd60df.json`）

- 起因（用户 10:42：「剩下 3 对落空也收掉，定个口径，比如取贴合度高的那面直接给 ⊥ = 距离」）。查下来那 3 对**不是**「棱两侧都是主面」：PANE 是 25 × 300 × 300 转了 30° 的板，最近点在板角的竖棱上，棱两侧是 `side` 和 `end`；FTUB 从偏离侧面法向 1–2° 的方向斜过板角，沿法向的垂足落在板角外 0.8 mm → 射线落空；而 `end` 那片没进候选——世界坐标 1e4 量级下 f32 的 1 ulp 是 2e-3 mm，`end` 三角把 q 投影回来的残差 1.4e-3 mm 比 `hit_candidates` 的共点 eps（1e-3）还大，被滤掉，于是没得换面。
- 改法（gen-model-model-cache `7bcdd60df`，只改 `surface_clearance.rs`）：`resolve_target_face` 按序 (1) 贴合 → `contact`；(2) 沿主面法向打射线 → `ray`；(3) 落空：(a) 连线与面法向几乎平行——`distance × (1 − cos θ)` ≤ 垂距容差 max(1%, 0.05 mm)，即连线长度与到面所在平面的垂距在容差内相等——就认这面，垂距 = 距离本身、垂足 = 棱上最近点 → `edge`；(b) 否则换棱上另一面：非主面直接读、不打垂距（`0dce7fee2` 规则不变），另一面也是主面就再打一次；(c) 都不成（源在两片主面之间的楔形区）留第一面、垂距置空、**不报 warning**。`perpendicular_ray_missed` 由此删除。`hit_candidates` 共点 eps = max(extents.norm, |q| 最大分量) × 4e-6，下限 1e-3 不变。`Perpendicular` / HTTP `perpendicular.method` 加 `ray | contact | edge`（加字段不改旧字段，前端未声明、忽略）。合成用例 23 条全过（原 19 + 4：偏 1° 的 FTUB 条 → `side` + edge 垂距；同板偏 18° → `end`；洞口竖棱两侧 side × opening 都落空 → 空垂距无 warning；世界坐标下 `end` 三角残差在 (1e-3, 1e-2) 仍进候选）。
- 换法同 §8.1：干净 worktree 构建 2 m 45 s（上一会话 11:03 起、11:05 完；本会话接手时二进制已在 `D:\Rust\target\release`，`git_commit=7bcdd60df238` 核过），`build_id 0.1.27+g7bcdd60df238.1789700589`；11:28:25 停 pid 15392 起 pid 17572，4 s ready；重新 `ensure` 97 个 refno（7 s），`resident_records = 1215`。
- 金样（`http-surface-clearance-elbo-x-wall1-7bcdd60df.json`）：64.42777 / ⊥ 64.49526（`method = ray`）/ outer / geometric、两点与 from / to 逐位相同，与 §2 一致（Δ = 0）；`total 24 ms` 是换机后首发冷缓存，不在比对项里。
- 126 对（`replay-126-pairs-7bcdd60df.jsonl`，多一列 `method`）：126/126 → 200；`intersects` 17 = 17；距离 max |Δ| 0.005 mm；**warning 0 对**；有垂距 77 → **101 对**（`ray` 73 / `contact` 4 / `edge` 24）；`⊥` 对 09-17 仍只有 `24384/24514` × GWALL 那 1 对差 0.12 mm；「主面 + 空垂距」0 对——楔形分支 (c) live 里没出现。与 §8.5 那轮逐对比 **24 对变了，全是 `edge`**：
  - **目标 3 对**（FTUB `24384/24671` × PANE `17496/135244` 46.6 mm、`24384/2683` × `17496/129513` 93.1 mm、`24384/3110` × `17496/129020` 184.1 mm）：「`side` + 落空警告」→ `side/pca` + ⊥ = 距离，连线偏面法向 1° / 2° / 1.5°，`from` = 源侧最近点、`to` = 板角竖棱上的最近点。
  - **另 21 对随之改读**：`0dce7fee2`（§8.4）改读 `end` / `top` 的 17 对里 **16 对**、§8.3 那 **5 对**（都是 `end` → 主面）——19 对 `end` + 2 对 `top` → 17 对 `side` + 4 对 `outer`（FTUB `24384/22533` × WALL `17496/105935` 1.26 mm、`24384/24513` / `22739` / `24101` × GWALL `17496/118130` 75 / 81 / 172 mm），全部带 ⊥ = 距离。这 21 对连线偏主面法向 **0.4–5.7°**，`distance × (1 − cos θ)` 0–0.29 mm，都在容差内：它们本来就是「几乎正对主面、只是刚越过棱」，`0dce7fee2` 读 `end` / `top` 是射线擦棱落空后的退路，不是几何上更贴合的那面。规则 (a) 排在 (b) 前面，对这 21 对与目标 3 对一视同仁。
  - 17 对里唯一没变的 FTUB `24384/24458` × GWALL `17496/118130` 82.7 mm 仍读 `end`：连线与 `end` 法向成 89.9°、离 `outer` 法向远，(a) 不成立才走 (b)——「斜靠墙端」那条口径仍在。
  - 新分布：side 53 / outer 25 / inner 23 / **end 8** / 相交 17（`top` 0、`opening` 0）。剩下的 8 对 `end` 全是 × GWALL `17496/118130`：7 对连线就沿 `end` 法向（0.02°，构件正对弧墙端头），1 对是上面那对。
- **口径后果与拍板**：rule (a) 让「偏主面法向在 1% 容差内（≤ ~8°）就读主面 + ⊥」成了通则，live 里比目标 3 对多带出 21 对。另一种排法是把 (a) 挪到 (b) 之后（有非主面可退就先读 `end` / `top`，只在没得换面时才取 edge 垂距；目标 3 对会跟 §8.4 那 17 对一样读 `end`、无 ⊥）。**用户 11:37 拍板：就按现在的口径，21 对随之改读也收下**——(a) 在 (b) 前为定案，不再改。`:8022`（`994f2e0cc`）/ `:8023` 未动。
