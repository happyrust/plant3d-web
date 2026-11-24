# Task Breakdown: `mbd-mainline-convergence`（Spec 005 Module 1）

**Spec**: `specs/005-mbd-dimension-closure/SPEC-mbd-mainline-convergence.md`  
**Plan**: `specs/005-mbd-dimension-closure/tasks/plan.md`

---

## Tasks

- [x] **T001 — 磁盘余量与三仓远端最新 HEAD 预检**
  - **Acceptance**: 确认 `C:\` / `D:\` 余量充足且 `TEMP/TMP` 指向 `D:\`；取得 `plant3d-web` `origin/main`、`plant-mbd` `github/main`、`gen-model` `origin/refactor` 的当前精确 SHA 并同步本地远端引用。
  - **Verify**: `Get-PSDrive C, D` 与 `git ls-remote` 输出明确无误。
  - **Files**: 无代码修改（只读预检）

- [x] **T002 — 重整 `plant3d-web` 28 笔修正至最新 `origin/main` 并通过全套前端门禁**
  - **Acceptance**: 在 `D:\work\plant-code\old\plant3d-web-land` 基于最新 `origin/main` 建立 `land/mbd-web-2026-11-18`，完整带入 `65d24cfb..17eb50dc` 的全部 MBD 改动；`type-check` 新增 0 错、`test:mbd`（≥ 744 条）全过、CI 同款 `eslint` 0 error、`build-only` 通过。
  - **Verify**: 在 `D:\work\plant-code\old\plant3d-web-land` 实跑上述 4 条命令全部退出码 0。
  - **Files**: `D:\work\plant-code\old\plant3d-web-land` 分支 `land/mbd-web-2026-11-18`

- [x] **T003 — 核验 `plant-mbd` 求解器门禁并重整 `gen-model` 16 笔修正至最新 `origin/refactor`**
  - **Acceptance**: 核验 `vendor/plant-mbd-tickets`（`3dbf13a`）`golden diff` 49 条一致且对 `github/main` 快进；新建 `D:\work\plant-code\old\gen-model-mbd-land-1118`（`land/mbd-fixes-2026-11-18`），挑入 16 笔修正并无损解决 `tests/mbd_branch_query.rs` 冲突；配 `plant-mbd` `3dbf13a` 经构建锁跑通 8 个 `mbd_*` 集成测试目标（≥ 105 条全过）并编出 `mbd_object_respond.exe`，还原临时 `Cargo.toml` 路径后工作区干净。
  - **Verify**: `with-build-lock.ps1` 构建与测试日志 `0 failed`。
  - **Files**: `D:\work\plant-code\old\gen-model-mbd-land-1118` 分支 `land/mbd-fixes-2026-11-18`

- [x] **T004 — 执行 7,059 个候选对象双口径全量离线重放与最新前端契约/映射/排版复扫**
  - **Acceptance**: 用新 `mbd_object_respond.exe` + 最新 `plant3d-web-land` `scripts/mbd-live-sweep.mjs` 完成默认判型表与 `[mbd_type_rules]` 项目规则双口径全量扫描，确认契约拒收 = 0、映射拒收 = 0、退化 = 0，与基准预期一致。
  - **Verify**: 复扫输出 `summary.json` / `summary.md` 及 `mbd-sweep-compare.mjs` 对账报告。
  - **Files**: `D:\work\plant-code\old\plant3d-web\.scratch\land-1118\`

- [x] **T005 — 补齐新旧 SHA 对照记录、脱敏核验并产出三仓快进推送与 `8022` 换版清单**
  - **Acceptance**: 记录 `gen-model` 与 `plant3d-web` 最新落地分支 SHA 对照表，扫描新增提交无本机隐私泄漏，提交请用户确认一键快进推送远端。
  - **Verify**: 扫描结果 0 违规，`git log` 线性可快进。
  - **Files**: `specs/005-mbd-dimension-closure/tasks/todo.md`, `D:\work\plant-code\old\plant3d-web-land`
