# MBD 全标注类型移植：落主线与 PML 金样收口开发计划（2026-11-08）

> 接续 `C:\Users\dpc\.cursor\plans\mbd_全类型尺寸移植_fd50c3a5.plan.md`（仓内同名计划在 `feat/mbd-all-types` 的
> `docs/plans/2026-11-07-mbd-all-annotation-types-port-dev-plan.md`，下称「原计划」）。跟踪 plant3d-web#103。
>
> - 编号：工作包 L0–L5，决策 E1–E7；引用原计划写全（如「原 M8」）。
> - 本计划只排「落主线 + 原 M8 余项」，不改求解器 / 宿主 / 前端行为。

## 0. 一句话

原计划 M0–M7 与收口轮 CT-1…CT-20 都已在三仓 `feat/mbd-all-types` 上做完并验收（36 例通过、页面报错 0），但除 M0-1 外一行都没进主线；
本计划在三个「落地分支」上把集成分支合到**远端**主线、先联调重验再按「前端 → plant-mbd → gen-model」的顺序推送，
不碰两个有别的会话未提交改动的主检出；原 M8 唯一没做的「PML 真实导出金样」拆成等 E3D 环境的独立工作包。

## 1. 现状核对（2026-11-08，逐项有证据）

### 1.1 仓与分支

| 仓 | 主线 | 集成分支 `feat/mbd-all-types` | 主线自分叉后新增 | 试合（`git merge-tree`） | 远端 |
|---|---|---|---|---|---|
| plant-mbd `D:\work\plant-code\old\vendor\plant-mbd` | `main` @ `3db2d92` | `47eb83e`，领先 120 | 0（可快进） | 无冲突 | 远端名 `github`；两条都已推送、同号；主检出干净（只有未跟踪的 `.tgrep/`、`.scratch/`） |
| gen-model `D:\work\plant-code\old\gen-model` | `refactor` @ `54e8111a9` | `46bda93de`，领先 28 | 25（投影存储只认根、dbnum Ref0 退役、rvm-check、粗网格 lod1 等） | 无冲突 | `origin/feat/mbd-all-types` 同号；本地 `refactor` 领先 `origin/refactor`（`5eaddfcda`）9 个，非本任务提交 |
| plant3d-web `D:\work\plant-code\old\plant3d-web` | `main` @ `97b6a4ef` | `d36003c3`，领先 42 | 7（帧预算降档、离线出包门禁、LOD 对照等） | 无冲突 | `origin/feat/mbd-all-types` 同号；本地 `main` 领先 `origin/main`（`36568f2f`）5 个 |

集成 worktree：`plant3d-web-mbd-all`、`gen-model-mbd-all`、`vendor\plant-mbd-all`。车道 worktree：plant-mbd `-m1-entry` / `-m1-kernel` / `-m1-pml` /
`-m2a-polar` / `-m2b-pipe` / `-m3-equip` / `-m4-em9` / `-m6-civil`，gen-model `-mbd-pipe` / `-mbd-polar` / `-mbd-supp`，plant3d-web `-mbd-docs`；
它们的分支已全部并入集成分支。

### 1.2 原计划工作包核对

| 工作包 | 状态 | 证据 |
|---|---|---|
| 原 M0 | 完成。M0-1 已进两仓主线；M0-2 / 3 / 4 只在集成分支 | plant3d-web `48fed2d9`、plant-mbd `3db2d92` 在主线；ADR 0013 / 0014 / 0015 在 plant-mbd 集成分支（`1863a19`）；`test:mbd` 脚本只在集成分支 |
| 原 M1–M7 | 完成，只在集成分支 | 三仓集成分支；plant3d-web 信封 ADR 改号 0071（`e812dee3`，主线另有 0070） |
| 收口轮 CT-1…CT-20 | 完成，只在集成分支 | `docs/verification/mbd-all-types-final-2026-11-07/README.md`（集成分支） |
| 原 M8 逐类型截图 | 完成 | `mbd-equipment-display-` / `mbd-support-display-` / `mbd-civil-display-` / `mbd-pipe-polar-display-` / `mbd-all-types-final-2026-11-07` |
| 原 M8 文档 | 完成 | plant-mbd `docs/MIGRATION.md`、`docs/field-dictionary.md`（`9c3ef92`）、`fixtures/golden/README.md`（`47eb83e`）；审计计划 / N 计划互指（`03c083f7`）；`docs/notes/README.md`（`586e28c0`）；清单 §11「裁决」列 2026-11-07 回填 |
| 原 M8 PML 金样 | **缺失** | `fixtures/pml/` 只有 `_selftest*`，README 写明「真实的 PML 导出还没有」；设备 / 土建 / EM9 / EM4 金样按 ADR-0014 过渡口径手推 |
| #103 进展回报 | 只到 11-06 | issue 仍 open，只有一条 11-06 的进展评论；11-07 的 M1–M7、CT-1…CT-20 没回报 |

### 1.3 终验数字（集成分支，2026-11-07）

- 页面：`e2e/mbd-label-overlap.spec.ts`，18 个对象 × 缺省三维 / 平贴 = 36 例全过、页面报错 0；后端 8023（mem 档，gen-model 集成分支二进制）+ 几何 8024（AMS 只读拷贝，SurrealDB 8029）。
- 门禁：plant-mbd `cargo test -j 2 --workspace` 全过（lib 490）、`golden diff` 45 条一致、裁决登记 139 条缺 0；gen-model 8 个 MBD 测试目标 75 条；
  plant3d-web `npm run test:mbd` 70 文件 658 条、`npm run type-check` 0。
- AMS 上没有样本、只靠合成单测 / 金样证明的行为：管段号（`:ZD_*`）、VALV `:YKSX`、调整焊 +N、补强板支腿焊点、设备与 EM4 支架角度文字平面、
  直线 / 多段 SPINE 墙、EM9 RACK 支架。

### 1.4 落主线的约束

1. **合并顺序必须前端先行。** 主线前端契约（`src/dimension/adapters/mbdV2Contract.ts`，ADR 0046）遇到不认识的图元 `kind` 整包拒绝，
   已知 `kind` 上的新字段才忽略；#103 的 11-06 评论也定了「先合前端，再合 plant-mbd，然后重编 gen-model」。
2. **plant3d-web 主检出有别的会话未提交的改动**（评审流程、增量 RVM、MBD 分批加载等，约 70 个已跟踪文件）。与集成分支重叠 6 个：
   `ViewerPanel.vue`、`ModelTreePanel.vue`、`useMbdDiagnosticsStore.ts`、`useMbdExternalSync.ts`、`useMbdExternalSync.test.ts`、`DimensionPanelDock.vue`；
   三方试合只有 `useMbdExternalSync.test.ts` 1 处冲突。那边的 MBD 改动是 `mbd_limit` / `MBD_INITIAL_BRAN_LIMIT = 32` / `deferredRefnos`
   （首屏只装 32 个 BRAN），与全类型移植正交，最后修改于 11-06 18:57。在主检出里直接 `git merge` 会因本地改动被拒。
3. **gen-model 主检出有 252 条未提交改动**（投影存储只认根等进行中的工作），本地 `refactor` 的 9 个未推送提交也属于那边。
4. **`old\` 下 15 个 gen-model worktree 共用 `..\vendor\plant-mbd`**（`gen-model-mbd-all` / `-mbd-pipe` / `-mbd-supp` 用 skip-worktree 把
   `Cargo.toml` 指到 `plant-mbd-all`，`git status` 看不出来）。快进 plant-mbd 主检出 = 同时替换这 15 个 worktree 的求解器源码；
   另外 gen-model 的 publish 构建 vendor 默认跟 plant-mbd `main`（`10a0288d6`），plant-mbd 一推 publish 构建就用新求解器。

## 2. 目标与完成定义

- 三仓远端主线（plant-mbd `github/main`、gen-model `origin/refactor`、plant3d-web `origin/main`）包含 `feat/mbd-all-types` 的全部内容；
- 合并结果上的门禁不低于 §1.3，联调 36 例与终验逐项相同，或差异都能对上主线新增的提交；
- 不动别的会话未提交的改动，不替别人推送（E4）；
- PML 真实金样：环境到位按 L4 完成；没到位则 L4 挂起，#103 写明余项（E5 / E7）。

## 3. 阶段与依赖

```text
L0 落地分支 + 门禁（只在新 worktree，主检出不动）
  plant3d-web-mbd-land  ── origin/main    + feat/mbd-all-types
  gen-model-mbd-land    ── origin/refactor + feat/mbd-all-types（临时指向 plant-mbd-all 编译）
  plant-mbd             ── 集成分支门禁复跑（main 可快进，不需要落地分支）
        │
L1 合并结果联调重验（land 后端 + land 前端，36 例 + 性能）
        │
L2 推送窗口（连续做完）：plant3d-web → plant-mbd → gen-model
        │
L3 落地后核对 + 告知（两个主检出怎么跟上，按 E3）
        │
L5 收口（#103、计划状态、worktree / 分支清理）

L4 PML 真实金样（等 E3D 环境，独立于 L0–L3，落主线后任何时候做）
```

## 4. 工作包

### L0 落地分支与门禁

| 步骤 | 内容 | 完成标志 |
|---|---|---|
| L0-1 | plant-mbd：在 `vendor\plant-mbd-all` 复跑 `cargo fmt --all -- --check`、`cargo test --workspace -j 2`、`golden diff`、`pml diff --dir fixtures/pml`（自测） | 与 §1.3 一致 |
| L0-2 | plant3d-web：`git worktree add D:\work\plant-code\old\plant3d-web-mbd-land -b land/mbd-all-types origin/main`，`git merge --no-ff feat/mbd-all-types`；`node_modules` 用目录联接指向主检出（集成分支只多一行 `test:mbd` 脚本，不加依赖） | 合并无冲突 |
| L0-3 | plant3d-web 门禁：`npm run test:mbd`、`npm run type-check`、改动文件 `npx eslint`、`npm run build-only`（路径用大写盘符 `D:\`） | 658 条（或更多）全过、type-check 新增 0、eslint 0、build 通过 |
| L0-4 | gen-model：`git worktree add D:\work\plant-code\old\gen-model-mbd-land -b land/mbd-all-types origin/refactor`，`git merge --no-ff feat/mbd-all-types`；工作区里临时把 `Cargo.toml` 的 plant-mbd 指向 `../vendor/plant-mbd-all`（不提交） | 合并无冲突 |
| L0-5 | gen-model 门禁：`cargo build --bin aios-database -j 2`；8 个 MBD 测试目标 `-j 2`（`CARGO_TARGET_DIR` 可借 `gen-model-mbd-all` 的产物省时间） | 75 条全过 |
| L0-6 | （可选）影响面探针：`origin/refactor` 原样 + 新求解器 `cargo check -j 2` | 编过 = L2 后其它 gen-model worktree 只是 MBD 输出变；编不过 = 它们要合 `refactor` 才能编，L3-3 必须告知 |

> - 同一时间只跑一个 cargo 构建、一律 `-j 2`，vitest `--maxWorkers=2`（11-07 两次全机内存耗尽都是多会话并行编译）。
> - 删 land worktree 前先 `cmd /c rmdir` 掉 `node_modules` 联接，再删目录，避免递归删除删到主检出的 `node_modules`。

### L1 合并结果联调重验

| 步骤 | 内容 |
|---|---|
| L1-1 | 用 `gen-model-mbd-land` 编出的 `aios-database` 起 MBD 后端（与终验同口径：mem 档 8023）；几何读 8024 只读拷贝，若已停按终验 README 重起，或改用 8022 并注明口径 |
| L1-2 | 在 `plant3d-web-mbd-land` 跑 `e2e/mbd-label-overlap.spec.ts`：18 个对象 × `off,flat`，环境变量同终验 README，输出 `docs/verification/mbd-all-types-mainline-2026-11-xx/` |
| L1-3 | 与 `mbd-all-types-final-2026-11-07` 逐项对比绘制数 / 重叠数：相同，或差异能对上 `origin/main`、`origin/refactor` 新增的提交（粗网格 lod1 等） |
| L1-4 | 性能：`e2e/dimension-perf.spec.ts` 与 `mbd-perf-all-types-2026-11-07` 对比不回退 |
| L1-5 | （可选）验收脚本小修：`24381_177936` 没等到取景飞行、相机停在缺省位 |
| L1-6 | 验证记录、数字回写原计划 §9 / §10 与本计划 §10，作为 land 分支上的一个 docs 提交 |

### L2 推送窗口（三步连续做完）

| 步骤 | 内容 |
|---|---|
| L2-1 | plant3d-web：`git push origin land/mbd-all-types:main`（对远端是快进） |
| L2-2 | plant-mbd：主检出 `git merge --ff-only feat/mbd-all-types`（到 `47eb83e`），`git push github main` |
| L2-3 | gen-model：land worktree 把 `Cargo.toml` 还原为 `../vendor/plant-mbd`（此时已是新求解器），复跑 `cargo build --bin aios-database -j 2` 与 8 个 MBD 测试目标，再 `git push origin land/mbd-all-types:refactor` |
| L2-4 | publish 构建在 L2-2、L2-3 都推完后再触发（两者之间 publish 会拿新求解器配旧宿主） |

> 推送前按 E4 列出每一步会推的提交给你确认。

### L3 落地后核对与告知

| 步骤 | 内容 |
|---|---|
| L3-1 | `git fetch` 后核对：`origin/main` 含 `d36003c3`，`origin/refactor` 含 `46bda93de`，`github/main` = `47eb83e` |
| L3-2 | plant3d-web、gen-model 两个主检出不动（按 E3）。给你一段说明：那边会话提交后 `git pull` 即可；plant3d-web 有 `useMbdExternalSync.test.ts` 1 处冲突（两边各加测试，保留两边） |
| L3-3 | 告知其它 gen-model worktree：`vendor\plant-mbd` 已是新求解器；L0-6 编不过时它们要先合 `origin/refactor` |

### L4 PML 真实金样（原 M8 余项，等环境）

前提：E3D + 完整 MBD 模块 + `inputdata/<项目号>`（窗体打开时 `!!checkmbdproject` 要求，本地 vendor 副本没有），
步骤见 plant-mbd `fixtures/pml/README.md`「从 E3D 导出金样」。

| 步骤 | 内容 |
|---|---|
| L4-1 | 九类（EM4PIPE / EM9PIPE / EM4SUPP / EM9INSTSUPP / EM9PIPESUPP / CIVIL / ARCH / EM4EQUI / EM9EQUI）各挑样本：先用终验 18 个对象；§1.3 末条里 AMS 没样本的行为在真实项目库补对象 |
| L4-2 | 导出：窗体设置 `generatejson = true`、`filepath` 指空目录 → `fixtures/pml/<TYPE>/<refno>/pml.json`（GBK 先转 UTF-8）+ `case.json`（`solver_input` 指 `fixtures/field/` 或 `fixtures/object/`） |
| L4-3 | `cargo run -p plant-mbd-cli -- pml diff --dir fixtures/pml`：每条差异要么修求解器，要么写裁决（`rulings-*.json` + `MIGRATION.md` 对应一节） |
| L4-4 | 对应类型的过渡金样（ADR-0014）切到 PML 口径，golden README 改写「过渡期」段落 |
| L4-5 | 按 L0 → L2 的同样方式落主线（这时只是小改动） |

### L5 收口

| 步骤 | 内容 |
|---|---|
| L5-1 | #103 补一条进展评论：M0–M7、CT-1…CT-20、落主线提交号、L1 结果、余项 L4；按 E5 保留或关闭（发评论前给你看稿） |
| L5-2 | 原计划 todos：`m8-golden-docs` 改 completed 并新增 `m8-pml-export`（pending）；仓内原计划 §10 提交记录补落主线的提交 |
| L5-3 | 按 E6 清理：先列清单给你确认；`gen-model-mbd-*` 先 `git update-index --no-skip-worktree Cargo.toml` 再还原；land worktree 按 L0 的注意事项删 |

## 5. 决策（默认值，可改）

| # | 问题 | 默认 | 备选 |
|---|---|---|---|
| E1 | 等 PML 金样再落主线？ | **不等**，现在落。PML 比对是增量，差异以后按裁决或小修补进主线 | 等 L4 完成再一起落 |
| E2 | 合并方式 | plant-mbd 快进；gen-model / plant3d-web `--no-ff` 合并提交（保留集成分支历史，回滚只撤一个合并提交） | squash 成单个提交 |
| E3 | 两个有别的会话未提交改动的主检出 | **不动**。land 分支基于远端主线、从 worktree 推送；主检出由那边会话提交后自己 `git pull` | 等那边提交后由我在主检出合并（主检出要先干净，什么时候能做取决于那边） |
| E4 | 推送范围 | 只推本计划产生的提交（land 分支基于 `origin/*`），每步推送前列清单给你确认；本地领先的他人提交（gen-model 9 个、plant3d-web 4 个）和上一任务的 `97b6a4ef` 不随本计划推 | land 分支改基于本地主线，连同这些提交一起推 |
| E5 | #103 | 落主线后补进展评论，保持 open 到 L4 完成 | 关闭 #103，另开「PML 真实金样」issue |
| E6 | 车道 worktree / topic 分支清理 | L3 核对通过后列清单确认再清 | 保留到 L4 完成 |
| E7 | PML 导出环境 | **需要你给信息**：有没有装完整 MBD 模块和项目 inputdata 的 E3D？默认按「近期没有」排，L4 挂起，过渡金样继续当回归基线 | 有真实项目库 + E3D：L4 与 L1 并行；只有 AvevaMarineSample：先导样本工程能覆盖的类型 |

## 6. 风险

| # | 风险 | 应对 |
|---|---|---|
| R1 | 文本试合干净，但 gen-model `refactor` 新增的 25 个提交（投影存储只认根、dbnum 归属改算）与 MBD 宿主有语义冲突 | L0-5 在合并结果上完整编译 + 75 条测试；L1 联调 36 例 |
| R2 | 新求解器让共用 `vendor\plant-mbd` 的 15 个 gen-model worktree 编不过 | L0-6 探针；L2-2 / L2-3 连续做；L3-3 告知 |
| R3 | publish 构建在 plant-mbd 推送和 gen-model 推送之间触发 | L2-4：两者都推完再触发 |
| R4 | plant3d-web 主检出那边的分批加载（`mbd_limit`）与全类型改动（非管道包、`annotation_type`、多包 id 前缀）交互 | L3-2 的说明里点明；那边合入后补跑 `useMbdExternalSync` 测试与几例联调 |
| R5 | 内存耗尽（11-07 两次） | 同一时间一个 cargo、`-j 2`；后端与构建错开 |
| R6 | 几何后端 8022 退出过，8024 是只读拷贝 | L1-1 先确认几何后端，沿用 8024 时注明口径 |
| R7 | 一直没有 E3D 环境 | L4 独立挂起，不挡 L0–L3；过渡金样继续当回归基线 |

## 7. 验收命令

```powershell
# plant-mbd（L0 在 vendor\plant-mbd-all，L2 后在 vendor\plant-mbd）
cargo fmt --all -- --check
cargo test --workspace -j 2
cargo run -p plant-mbd-cli -- golden diff
cargo run -p plant-mbd-cli -- pml diff --dir fixtures/pml

# gen-model（gen-model-mbd-land）
cargo build --bin aios-database -j 2
cargo test -j 2 --test mbd_branch_fields --test mbd_branch_query --test mbd_civil_query --test mbd_equipment_query --test mbd_http_endpoint --test mbd_object_classify --test mbd_object_endpoint --test mbd_support_query

# plant3d-web（plant3d-web-mbd-land，路径用大写盘符 D:\）
npm run test:mbd
npm run type-check
npx eslint <改动文件>
npm run build-only
npx playwright test e2e/mbd-label-overlap.spec.ts --config=playwright.novideo.config.ts --workers=1   # 环境变量同终验 README，OUT 改到新目录
```

## 8. 不做的事

- 原计划「不做的事」整体沿用（材料表、RVM / ATT / TXT 导出、写回 E3D、暖通 EM5 / 电气 EM8 等）。
- 不改求解器 / 宿主 / 前端行为；L1-5 验收脚本小修除外，L4 的修正按裁决走。
- 不动别的会话未提交的改动，不替别人推送，不改 `npm run lint`（会 `--fix` 全仓）。
- 平贴呈现（调试呈现）在短直段密集处的拥挤不在本计划。

## 9. 门禁基线（2026-11-07 集成分支，只增不减）

| 仓 | 口径 | 数字 |
|---|---|---|
| plant-mbd `47eb83e` | `cargo test -j 2 --workspace` / `golden diff` / 裁决登记 | lib 490 全过 / 45 条一致 / 139 条缺 0 |
| gen-model `46bda93de` | 8 个 MBD 测试目标 | 75 条全过 |
| plant3d-web `d36003c3` | `npm run test:mbd` / `npm run type-check` | 70 文件 658 条 / 0 |
| 页面 | `mbd-label-overlap` 18 对象 × 2 | 36 例通过、报错 0 |

## 10. 提交记录

| # | 提交 | 内容 |
|---|---|---|
| 1 | plant3d-web `e2f3ba99`（`land/mbd-all-types`） | L0-2：`feat/mbd-all-types` d36003c3 合入 origin/main 36568f2f（`--no-ff`，无冲突） |
| 2 | gen-model `e6dc8bbf4`（`land/mbd-all-types`） | L0-4：`feat/mbd-all-types` 46bda93de 合入 origin/refactor 5eaddfcda（`--no-ff`，无冲突） |
| 3 | plant3d-web 本计划所在提交 | L1-6：联调重验记录 `docs/verification/mbd-all-types-mainline-2026-11-08/`（36/36 与 11-07 一致、性能无回退），回写原计划 §9 / §10 |
| — | plant-mbd | 不建合并提交：main 3db2d92 快进到 47eb83e（L2-2） |

进度：L0、L1 完成（2026-11-08；L1-5 可选未做）；L2 起按 E4 逐仓确认推送清单后执行。
