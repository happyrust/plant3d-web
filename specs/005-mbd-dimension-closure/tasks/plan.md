# Implementation Plan: `mbd-mainline-convergence`（MBD 三仓 65 笔修正合入最新主线与全库复扫收口）

**Spec**: `specs/005-mbd-dimension-closure/SPEC-mbd-mainline-convergence.md`  
**Capability Map**: `specs/005-mbd-dimension-closure/CAPABILITY-MAP.md`

---

## 1. 组件顺序与实施步骤（Implementation Sequence）

1. **环境与远端基线预检（Pre-flight）**：
   - 检查 `C:\` 与 `D:\` 可用磁盘空间（确保临时编译缓存与重放输出全部落在 `D:\`）；
   - 执行只读 `git ls-remote` 核对 `plant3d-web` `origin/main`、`vendor/plant-mbd` `github/main`、`gen-model` `origin/refactor` 的精确远端 HEAD。
2. **前端落地分支重整与门禁（`plant3d-web-land`）**：
   - 在干净工作树 `D:\work\plant-code\old\plant3d-web-land` 基于最新远端 `main` 创建 `land/mbd-web-2026-11-18`，按原线性顺序重演 `65d24cfb..17eb50dc` 的 28 笔提交（跳过若已被远端包含的空补丁）；
   - 确认 `node_modules` 目录联接正常，从大写 `D:\` 盘符路径依次运行：`npm run type-check`、`npm run test:mbd`（`--maxWorkers=2`）、CI 同款 `eslint src e2e scripts --ext .vue,.js,.mjs,.ts`、`npm run build-only`。
3. **求解器核验与宿主落地分支重整（`vendor/plant-mbd-tickets` + `gen-model-mbd-land-1118`）**：
   - 核验 `vendor/plant-mbd-tickets`（`fix/mbd-tickets-solver` @ `3dbf13a`）相对远端 `github/main`（`47eb83e`）为纯快进，复核 `golden diff`（49 条全绿）；
   - 新建干净工作树 `D:\work\plant-code\old\gen-model-mbd-land-1118`（`-b land/mbd-fixes-2026-11-18 <远端 refactor>`），逐笔挑入 `4f2fd920f..9bcf20d1f` 的 16 笔提交；在 `tests/mbd_branch_query.rs` 唯一冲突处无损合并双方新增测试；
   - 仅在工作区临时将 `Cargo.toml` 的 `plant-mbd` 指向 `../vendor/plant-mbd-tickets/crates/plant-mbd`，经 `output\ops\with-build-lock.ps1 -Jobs 2` 编译 `example mbd_object_respond` 并运行全部 8 个 `mbd_*` 集成测试目标（跑完立即还原 `Cargo.toml` 并校验 `git status --short` 为空）。
4. **7,059 对象双口径全量端到端复扫**：
   - 使用新编出的 `mbd_object_respond.exe` 对 `AvevaMarineSample` 全部 7,059 个候选对象生成离线答复（默认判型规则 + `[mbd_type_rules]` 项目规则），经 `plant3d-web-land` 的 `node scripts/mbd-live-sweep.mjs` 完整跑过契约、映射、登记与视口排版，验证契约拒收 = 0、映射拒收 = 0、退化 = 0，并用 `scripts/mbd-sweep-compare.mjs` 与 `11-13` 基准核对一致。
5. **新旧提交号对照表、脱敏检查与推送/换版清单交付**：
   - 在 `plant3d-web-land` 补充 `gen-model` 本轮新旧 commit SHA 对照说明并复跑公开仓扫描；输出三仓精确快进推送命令与 `8022` 维护方换版交接说明。

---

## 2. 风险控制（Risks & Mitigations）

- **内存与编译冲突**：所有 `cargo` 构建严格走 `with-build-lock.ps1 -Jobs 2`，Vitest 设 `--maxWorkers=2`；
- **Junction 清理安全**：不递归删除含 `node_modules` 联接的目录；
- **保护共享 `.dirty` `8022`**：全程只读直扫 E3D 库与离线重放，零触碰 `8022` / `8009` 进程。
