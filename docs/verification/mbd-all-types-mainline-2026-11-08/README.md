# MBD 全标注类型落主线联调重验（2026-11-08，#103）

结论：三仓「落地分支」（远端主线 + `feat/mbd-all-types`）联调重跑 11-07 收口验收：36 个用例（18 个对象 × 缺省三维 / 平贴）
全部通过、页面报错 0，与 11-07 最终验收 [`../mbd-all-types-final-2026-11-07/`](../mbd-all-types-final-2026-11-07/README.md)
逐对象、逐档、逐字段完全相同（36/36）。6 个对象的实物性能与合成 2k 门禁都在上限内；相对 11-07 的涨幅小于同机同一份代码
两轮之间的波动，没有可归因于合并的回退。跟踪计划：`docs/plans/2026-11-08-mbd-all-types-mainline-landing-dev-plan.md`（L0、L1）。

## 版本

| 仓 | 落地提交 | 组成 | 推送目标 |
|---|---|---|---|
| plant3d-web | `land/mbd-all-types` @ e2f3ba99 + 本 README 所在提交 | origin/main 36568f2f + feat d36003c3（`--no-ff`） | origin `main` |
| plant-mbd | `feat/mbd-all-types` @ 47eb83e | main 3db2d92 是其祖先，快进，不建合并提交 | github `main` |
| gen-model | `land/mbd-all-types` @ e6dc8bbf4 | origin/refactor 5eaddfcda + feat 46bda93de（`--no-ff`） | origin `refactor` |

- 两个合并都是无冲突的自动合并（`git merge-tree` 复核：结果树与合并提交相同）。主线比集成分支多出的只有 plant3d-web 的
  36568f2f（dtx 粗网格补拉，只改 `useDbnoInstancesDtxLoader`）与 ca804b3f（文档）。
- gen-model 联调构建临时把 `Cargo.toml` 的 plant-mbd 路径指到 `../vendor/plant-mbd-all`（47eb83e，即 plant-mbd main 将快进到的提交）；
  提交里仍是 `../vendor/plant-mbd`，`Cargo.lock` 不变。
- 后端：MBD 读 8023（gen-model 落地分支二进制，mem 档），几何读 8024（与 11-07 最终验收同一实例）。8022 本轮不可用，未使用。

## 门禁（落地分支）

- plant-mbd 47eb83e：`cargo fmt --all -- --check` 干净；`cargo test --workspace -j 2` 628 条全过（lib 490、adjust_weld 4、
  contract_guard 10、golden_regression 1、isodim_rj_pcom 10、m2b_pipe 27、pcom_split 7、polar_frame 10、polar_obstacles 14、
  polar_place 12、CLI 37、pml_selftest 6）；`golden diff` 45 条一致；`pml diff` 通过。
- gen-model e6dc8bbf4：`cargo build --bin aios-database` 通过；8 个 MBD 测试目标 75 条全过（mbd_branch_fields 11、mbd_branch_query 6、
  mbd_civil_query 16、mbd_equipment_query 10、mbd_http_endpoint 1、mbd_object_classify 18、mbd_object_endpoint 1、mbd_support_query 12）。
- plant3d-web e2f3ba99：`npm run test:mbd` 70 个文件 658 条全过；`npm run type-check` 0 条错误；相对 origin/main 改动的 49 个脚本文件
  eslint 0；`npm run build-only` 通过。
- `test:mbd` 覆盖的测试文件从原计划基线 `48fed2d9` 的 87 个降到 70 个，不是合并丢的：origin/main 上仍是 87 个，集成分支
  d36003c3 与落地合并 e2f3ba99 都是 70 个。减少的全部来自 `c52d7b67`（退役前端极坐标摆位层，摆位由求解器完成，#103 M2a / D4）：
  删掉 `src/dimension/kernel/layout/polar/**`、`kernel/collision/{occupancy,selectPlacement}`、`kernel/viewport/polarObstacles` 的 23 个
  测试文件，对应用例在 plant-mbd 的 `polar_frame`（10）/ `polar_obstacles`（14）/ `polar_place`（12）。
- 旧宿主探针：refactor 上现有的宿主对 plant-mbd 47eb83e 编译失败（3 处 E0063，结构体新字段未填），证实计划风险 R2——plant-mbd main
  快进后，仍是旧宿主、又指向共享 `vendor/plant-mbd` 的 gen-model 检出要先合入新的 refactor 才能编译。

## 跑法

后端与 11-07 同口径：

- 8029：AMS 设计库的只读拷贝（SurrealDB 2.1.4，rocksdb 档）。本轮开跑前发现它在 11-07 23:16 内存分配失败退出（
  `memory allocation of 1444056 bytes failed`），8024 随之卡在 `/api/v1/dbnums`，首轮用例全部因等不到几何而跳过；换回集成分支前端
  同样卡住，排除了合并引入的可能。在 gen-model-mbd-all 下重起后，8024 自动重连，不用重起 8024。
- 8024：几何后端，gen-model-mbd-polar 的 `.scratch\geom-bin\aios-database.exe serve`（该 worktree 的 `DbOption.toml`：
  `http_api_addr` 127.0.0.1:8024，库连 8029），11-07 起未重启。
- 8023：MBD，gen-model 落地分支的 `target\debug\aios-database.exe serve`，`DB_OPTION_FILE` 指向 gen-model-mbd-all 本地
  `DbOption.toml` 的拷贝（`http_api_addr` 127.0.0.1:8023，`[mbd_type_rules]` 与 `DbOption-ams.toml` 相同）。

```powershell
# 8029（gen-model-mbd-all 下）
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\Start-Surreal8009.ps1 -Datastore rocksdb:.surreal/ams-8019 -Bind 127.0.0.1:8029 -SurrealExe D:\work\plant-code\old\gen-model\bin\surreal.exe

# 8023（gen-model 落地 worktree 下；DB_OPTION_FILE 不带 .toml）
$env:DB_OPTION_FILE='<DbOption 拷贝>'; $env:AIOS_STORE_MODE='mem'; $env:PLANT_ASSET_ROOT='D:\work\plant-code\old\gen-model-mbd-all\assets'
$env:RUST_MIN_STACK='134217728'
target\debug\aios-database.exe serve

# 8024 的 /api/v1/dbnums、8023 的 /api/v1/health 都有响应后，在 plant3d-web 落地 worktree 下跑 36 例（与 11-07 只差输出目录）
$env:MBD_LABEL_OVERLAP='1'; $env:GEN_MODEL_V1_BASE_URL='http://127.0.0.1:8024'; $env:MBD_LABEL_OVERLAP_MBD_BASE='http://127.0.0.1:8023'
$env:MBD_LABEL_OVERLAP_OUT='docs/verification/mbd-all-types-mainline-2026-11-08'; $env:MBD_LABEL_OVERLAP_MODES='off,flat'
$env:MBD_LABEL_OVERLAP_REFNOS='24381_145018,24383_91813,24383_99996,24384_26229,24383_100028,24383_76191,24381_177376,24383_69033,24381_177936,24383_76416,24381_156667,17496_118364,24381_44303,24381_38614,24381_37054,24381_598,24381_179302,24381_575'
$env:MBD_LABEL_OVERLAP_PERF_RUNS='0'; $env:PLAYWRIGHT_PORT='3136'
npx playwright test e2e/mbd-label-overlap.spec.ts --config=playwright.novideo.config.ts --workers=1

# 实物性能：与 mbd-perf-all-types-2026-11-07 同一组 6 个对象，每个 3 轮环绕
$env:MBD_LABEL_OVERLAP_OUT='docs/verification/mbd-all-types-mainline-2026-11-08/perf'; $env:MBD_LABEL_OVERLAP_MODES='off'
$env:MBD_LABEL_OVERLAP_REFNOS='24381_38695,17496_80024,17496_118364,24383_69033,24383_76360,24381_145018'; $env:MBD_LABEL_OVERLAP_PERF_RUNS='3'
npx playwright test e2e/mbd-label-overlap.spec.ts --config=playwright.novideo.config.ts --workers=1

# 合成 2k 门禁
Remove-Item Env:MBD_LABEL_OVERLAP; $env:DIMENSION_PERF_GATE='1'
npx playwright test e2e/dimension-perf.spec.ts --config=playwright.novideo.config.ts --workers=1
```

入库的只有各用例的 `diag.json`（`off/`、`flat/` 各 18 个，`perf/off/` 6 个）。截图没有入库：数字与 11-07 逐项相同，11-07 的截图随集成分支
一起进主线。

## 结果（绘制标签与重叠对，远 / 中 / 近）

| 类型 | 对象 | 缺省三维：绘制 | 缺省三维：重叠 | 平贴：重叠 |
|---|---|---|---|---|
| EM4 管道 | `24381_145018` | 83 / 87 / 91 | 1 / 0 / 2 | 115 / 32 / 12 |
| EM4 管道（竖管） | `24383_91813` | 9 / 9 / 9 | 0 / 0 / 0 | 0 / 0 / 0 |
| EM4 管道 | `24383_99996` | 54 / 59 / 59 | 0 / 1 / 0 | 44 / 24 / 14 |
| EM4 管道（支腿） | `24384_26229` | 31 / 35 / 38 | 0 / 0 / 2 | 66 / 95 / 55 |
| EM4 管道 | `24383_100028` | 86 / 90 / 91 | 0 / 0 / 0 | 60 / 27 / 10 |
| EM4 管道 | `24383_76191` | 106 / 112 / 113 | 0 / 0 / 1 | 71 / 34 / 17 |
| EM9 仪表管 | `24381_177376` | 17 / 19 / 23 | 1 / 1 / 0 | 41 / 27 / 16 |
| EM4 支架 | `24383_69033` | 16 / 21 / 23 | 4 / 3 / 1 | 23 / 7 / 4 |
| EM9 仪表管支架 | `24381_177936` | 3 / 6 / 6 | 0 / 1 / 1 | 1 / 1 / 0 |
| EM4 设备 | `24383_76416` | 10 / 11 / 11 | 0 / 0 / 0 | 4 / 1 / 1 |
| EM9 设备 | `24381_156667` | 4 / 4 / 4 | 0 / 0 / 0 | 2 / 2 / 1 |
| 土建 GWALL | `17496_118364` | 16 / 72 / 125 | 0 / 13 / 7 | 3 / 6 / 18 |
| 土建 曲墙 | `24381_44303` | 16 / 16 / 16 | 0 / 0 / 0 | 7 / 4 / 3 |
| 建筑 弧形楼板 | `24381_38614` | 15 / 19 / 45 | 2 / 3 / 2 | 20 / 20 / 20 |
| 建筑 楼板（门） | `24381_37054` | 4 / 4 / 4 | 0 / 0 / 0 | 2 / 2 / 1 |
| EM4 管道（PCOM、TEE 接仪表管区） | `24381_598` | 94 / 96 / 102 | 2 / 2 / 2 | 136 / 62 / 43 |
| EM4 管道（PCOM） | `24381_179302` | 69 / 76 / 77 | 0 / 2 / 0 | 155 / 82 / 30 |
| EM4 管道（Head 接仪表管区） | `24381_575` | 33 / 35 / 37 | 0 / 0 / 0 | 31 / 21 / 7 |

「重叠」是 `diag.json` 的 `overlaps`。表中 18 行由本轮 `diag.json` 生成，与 11-07 README 的「结果」表逐字相同；逐字段对比（每档全部标量字段，
数组比个数）与页面报错数 36/36 相同。36 例合计：

| 档 | 记录 | 绘制 | LOD 隐藏 | 屏外 | 重叠隐藏 | 重叠对 | 重叠 | 非有限值 |
|---|---|---|---|---|---|---|---|---|
| 远 | 2594 | 1359 | 1235 | 0 | 14 | 548 | 791 | 0 |
| 中 | 2594 | 1507 | 1087 | 69 | 14 | 414 | 473 | 0 |
| 近 | 2594 | 1667 | 927 | 406 | 7 | 270 | 270 | 0 |

列依次对应 `records`、`drawn`、`lodHidden`、`offscreen`、`overlapHidden`、`overlapPairs`、`overlaps`、`nonFinite`。

## 性能

6 个对象各 3 轮环绕取 p95 的中位数（ms），11-07 → 本轮（差）：

| 对象 | 近景绘制 | layout p95 | paint p95 | frame p95 |
|---|---|---|---|---|
| `24381_38695` | 464 | 23.9 → 25.6（+1.7） | 16.4 → 21.0（+4.6） | 39.2 → 48.5（+9.3） |
| `17496_80024` | 106 → 109 | 8.5 → 9.7（+1.2） | 18.7 → 19.9（+1.2） | 23.4 → 28.3（+4.9） |
| `17496_118364` | 121 → 125 | 11.4 → 13.3（+1.9） | 18.3 → 20.0（+1.7） | 25.9 → 29.1（+3.2） |
| `24383_69033` | 23 | 1.1 → 3.6（+2.5） | 17.3 → 19.9（+2.6） | 18.1 → 21.9（+3.8） |
| `24383_76360` | 11 | 1.0 → 1.4（+0.4） | 16.6 → 17.0（+0.4） | 17.2 → 17.9（+0.7） |
| `24381_145018` | 91 | 2.5 → 3.3（+0.8） | 17.9 → 19.6（+1.7） | 19.9 → 22.8（+2.9） |

- layout p95 最大 25.6 ms、paint p95 最大 21.0 ms，都低于合成门禁的 layout 31.4 / paint 94.3 ms 上限；layout p50 六个对象都在 11-07 的
  ±1.1 ms 以内（楼板 19.4 → 19.7）。
- 同机负载与噪声：本轮测量时另有会话在编译（10 个 cargo / rustc 进程），11-07 那次也是边编译边测。同一份落地代码隔 6 分钟再测，
  楼板 layout p95 25.6 → 30.3（差 18%）；集成分支前端两轮 26.8 / 38.7。集成分支与落地前端交替各测两轮，没有稳定的先后。
  同机噪声大于两边差异，上表的涨幅不指向回退。
- 合成 2k 门禁通过：运行段（可见 2000 / 已装 10000，60 个样本）layout p95 22.5 ms、paint p95 52.6 ms、命中 p95 0.1 ms（上限 2）、
  58.6 fps；稳定段（20 遍）layout p50 / p95 16.8 / 23.4 ms（上限 31.4），paint p50 / p95 52.5 / 70.6 ms（上限 94.3）。
- `17496_80024` / `17496_118364` 近景绘制比 11-07 性能基线多 3 / 4 个：性能基线（11-07 08:26）早于最终验收（16:05），
  最终验收里 `17496_118364` 已是 125，差异来自当天之后并入的修复。

## 与 11-07 的差异

无。36 例的绘制、重叠、隐藏、屏外、非有限值与页面报错数与 11-07 最终验收逐项相同；性能变化在同机噪声之内。

## 与计划的出入

- L1-1 几何没用 8022，用的是 11-07 最终验收同一个 8024；重起 8029 是本轮唯一的环境改动。
- L1-5（`24381_177936` 验收脚本相机修正，可选）没做。
- Vite 对 `@mdi/font`、`@fontsource/fira-code` 返回 403（worktree 的 `node_modules` 是目录联接，落在 Vite 允许列表外），11-07 的
  worktree 同样如此；尺寸标注不用这两套字体，不影响结果。
