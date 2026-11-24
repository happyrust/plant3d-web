# Spec: MBD 三仓 65 笔全库修正合入 2026-11-18 主线与隔离全量复扫验收（`mbd-mainline-convergence`）— V1

**Capability Map**: `specs/005-mbd-dimension-closure/CAPABILITY-MAP.md`（Module 1 of 4）  
**Module ID**: `mbd-mainline-convergence`  
**Created**: 2026-11-18  
**Status**: Approved（已按推荐默认项批准，进入 Plan / Tasks / Implement）  
**Tracking**: `plant3d-web#103`（`#104–#106`, `#110–#126`, `#127–#132`, `#134`, `#150`, `#162`）

---

## 0. ASSUMPTIONS I'M MAKING（前置假设暴露，如有出入请立即指正）

1. **不动两个主检出的在途未提交改动**：`plant3d-web` 主检出（含评审、RVM 及 `#136` 原型等 ~75 个修改文件）与 `gen-model` 主检出（含房间重初始化与增量流水线等未提交修改）保持原样不动；主线合入与门禁验证一律在干净的落地 worktree（`plant3d-web-land`、`vendor/plant-mbd-tickets`、新建 `gen-model-mbd-land-1118`）中完成。
2. **不直接用干净分支二进制覆盖带 `.dirty` 的共享 `8022` 实例**：实测当前 `127.0.0.1:8022` 运行的是 `0.1.46+gd2806fde20d5.1794904792.dirty`（由 `gen-model` 主检出带增量/房间未提交改动编出，且连着持久化 `rocksdb` `8009`）。若直接用干净落地分支编出的二进制覆盖 `8022`，会丢失对方的 `.dirty` 在途改动并可能触发整库重排；因此本模块采用 **`mbd_object_respond` 直读 E3D 库 + 隔离只读沙箱端口（如 `8198`）配合 `--mbd-base`（模型树走 `8022`、MBD 标注走新服务端）** 完成 7,059 对象全量复扫与浏览器实测，并产出供 `8022` 维护方一键合入的交接补丁包。
3. **跨仓硬配对顺序不可拆分**：`vendor/plant-mbd`（`3dbf13a`，含公开的 `civil::rooms`）与 `gen-model`（含 `#125` 楼板房间归属过滤）存在编译与语义硬配对，必须在同一推送窗口紧接着推进（先 `plant-mbd`、紧接 `gen-model`）；`plant3d-web`（28 笔）向后兼容旧后端，可先行或同窗口推进。
4. **远端 `git push` 留作显式确认门禁**：所有合并、编译、单测与 7,059 对象全量复扫先在本地落地分支全部跑绿，列出精确的新旧提交号清单经您确认后再执行 `git push`（以及决定何时快进本机共享的 `vendor/plant-mbd`）。

---

## 1. Objective（目标与验收场景）

将 `2026-11-11 ~ 2026-11-13` 全库扫描修复但尚未落地的 **65 笔提交**（`plant3d-web` 28 笔 + `plant-mbd` 21 笔 + `gen-model` 16 笔）无损重整到 **`2026-11-18` 最新远端主线基点**（`plant3d-web` `origin/main` `c9d0805d`、`plant-mbd` `github/main` `47eb83e`、`gen-model` `origin/refactor` `5e1ad86e3`），跑通全部测试门禁与 **7,059 个候选对象的全量端到端复扫（默认规则 + `[mbd_type_rules]` 项目规则双口径）**，将整库契约拒收（67 例）、映射拒收（7 例）、空支管 422（6 例）与角度退化（1 例）在最新主线基点上彻底清零。

### Acceptance Scenarios
1. **Given** `plant3d-web` `origin/main` 自 `11-13` 后新增了 37 笔模型加载与视口提交（至 `c9d0805d`），**When** 将 `land/mbd-web-2026-11-13`（28 笔）合并/变基到 `c9d0805d`，**Then** 0 冲突合入，`npm run type-check` 新增 0 错、`npm run test:mbd` ≥ 744 条全过、改动文件与 CI 口径 `eslint` 0 error、`npm run build-only` 构建通过。
2. **Given** `gen-model` `origin/refactor` 新增提交至 `5e1ad86e3` 且与 `land/mbd-fixes-2026-11-12`（16 笔）在 `tests/mbd_branch_query.rs` 存在 1 处测试追加冲突，**When** 在新落地分支解决该测试冲突（完整保留双方新增用例）并配 `plant-mbd` `3dbf13a` 编译，**Then** `cargo check` 0 错，8 个 MBD 测试目标（≥ 105 条用例）100% 通过。
3. **Given** 最新合并后的 `gen-model` + `plant-mbd` `3dbf13a` + `plant3d-web` 真代码，**When** 对 `AvevaMarineSample` 全部 7,059 个可标注候选运行全量扫描（默认判型表与 `[mbd_type_rules]` 两种配置），**Then** **契约拒收 = 0、映射拒收 = 0、呈现退化 = 0**；空包均携带明确诊断原因并在尺寸面板标题下展示中文说明（`#134`），超出面板高度时可正常滚动到底（`#162`）。
4. **Given** 三仓最新落地分支全部验证通过，**When** 生成远端推送清单与本机 `8022` 联调后端换版交接说明（含 `gen-model` 新旧 commit SHA 对照表），**Then** 提交审查无盘符/用户隐私泄漏，随时可在同一窗口安全快进推送远端主线。

---

## 2. Tech Stack

- **前端（`plant3d-web`）**：Vue 3 + TypeScript 5 + Three.js + Vitest + ESLint 9 + Playwright（`scripts/mbd-live-sweep.mjs`、`scripts/mbd-sweep-compare.mjs`）。
- **求解器（`vendor/plant-mbd`）**：Rust（纯函数几何/极坐标/出图平面求解器 + `validity.rs` 契约出口自检 + `civil::rooms` 楼板房间唯一归属）。
- **服务端宿主（`gen-model`）**：Rust nightly（`aios-database` HTTP `/api/mbd/v2/object/{refno}` 与离线批量端点 `examples/mbd_object_respond.rs`）。

---

## 3. Commands

```powershell
# 1) plant-mbd 求解器门禁（在 D:\work\plant-code\old\vendor\plant-mbd-tickets，经构建锁 -Jobs 2）
pwsh -NoProfile -File D:\work\plant-code\old\gen-model\output\ops\with-build-lock.ps1 -Who mbd-solver `
  -WorkDir D:\work\plant-code\old\vendor\plant-mbd-tickets `
  -Log D:\work\plant-code\old\plant3d-web\.scratch\land\solver-test.log `
  -CargoArgs 'test,--workspace,--offline' -Jobs 2 -StartCommitFreeGb 16
cargo run --manifest-path D:\work\plant-code\old\vendor\plant-mbd-tickets\Cargo.toml -p plant-mbd-cli --offline -- golden diff

# 2) gen-model 宿主落地分支门禁（在新建干净 worktree D:\work\plant-code\old\gen-model-mbd-land-1118，经构建锁 -Jobs 2）
pwsh -NoProfile -File D:\work\plant-code\old\gen-model\output\ops\with-build-lock.ps1 -Who mbd-host `
  -WorkDir D:\work\plant-code\old\gen-model-mbd-land-1118 `
  -Log D:\work\plant-code\old\plant3d-web\.scratch\land\host-test.log `
  -CargoArgs 'test,--offline,--test,mbd_branch_fields,--test,mbd_branch_query,--test,mbd_civil_query,--test,mbd_equipment_query,--test,mbd_http_endpoint,--test,mbd_object_classify,--test,mbd_object_endpoint,--test,mbd_support_query' `
  -Jobs 2 -StartCommitFreeGb 18

# 3) plant3d-web 落地分支门禁（在 D:\work\plant-code\old\plant3d-web-land，大写盘符 D:\，vitest 限并发）
npm run type-check
npx vitest run --config vitest.config.ts --maxWorkers=2 src/dimension src/api/mbdV2Api.test.ts src/api/mbdV2Api.objectEndpoint.test.ts src/composables/useMbdExternalSync.test.ts src/composables/useMbdExternalSync.objectTypes.test.ts
npx eslint src e2e scripts --ext .vue,.js,.mjs,.ts
npm run build-only

# 4) 7059 对象全量端到端重放与前端契约/映射/排版扫描
node scripts/mbd-live-sweep.mjs --payload-dir <离线重放答复目录> --out .scratch/mbd-live-sweep/land-1118
node scripts/mbd-sweep-compare.mjs <基准汇总> .scratch/mbd-live-sweep/land-1118/summary.json
```

---

## 4. Project Structure

```text
D:\work\plant-code\old\
  ├── plant3d-web\
  │   └── specs\005-mbd-dimension-closure\
  │       ├── CAPABILITY-MAP.md                  → 已批准的四模块能力图谱
  │       ├── SPEC-mbd-mainline-convergence.md   → 本模块规范（Module 1）
  │       └── tasks\                             → Phase 2/3 生成 plan.md 与 todo.md
  ├── plant3d-web-land\                          → 前端干净落地工作树（更新至 origin/main c9d0805d + 28 笔 MBD 提交 + 提交号对照表）
  ├── vendor\plant-mbd-tickets\                  → 求解器干净工作树（fix/mbd-tickets-solver @ 3dbf13a，21 笔快进）
  └── gen-model-mbd-land-1118\                   → 服务端新建干净落地工作树（origin/refactor 5e1ad86e3 + 16 笔 MBD 提交，解掉 mbd_branch_query.rs 测试冲突）
```

---

## 5. Code Style & Merge Discipline

- **冲突消解原则**：`gen-model/tests/mbd_branch_query.rs` 冲突块为纯测试函数追加，严格保留 `origin/refactor` 新增测试与 MBD 16 笔新增测试，不删减任何断言，不夹带格式重排：
  ```rust
  // 保留 origin/refactor 既有新增测试，其后紧接 MBD 落地分支的 Head/Tail 世界系与焊口号测试
  #[test]
  fn branch_head_and_tail_are_transformed_into_world_space() {
      // ... 原样保留 patch 断言 ...
  }
  ```
- **资源与并发护栏**：同一时刻只允许 1 路 Rust 编译且必须走 `output\ops\with-build-lock.ps1 -Jobs 2`；临时目录固定在 `D:\` 盘（保护 `C:\` 盘空间）；绝不在含有他人未提交改动的主检出内执行 `git merge` / `git reset` / `npm run lint`。

---

## 6. Testing Strategy

1. **求解器层（`plant-mbd`）**：673+ 项工作区单测 + 49 份 Golden JSON 逐字节一致性比对。
2. **宿主层（`gen-model`）**：合并 `5e1ad86e3` 后配 `plant-mbd` `3dbf13a` 跑全部 8 个 `mbd_*` 集成测试目标（≥ 105+ 条，0 失败、0 skip）。
3. **前端层（`plant3d-web`）**：合并 `c9d0805d` 后跑 `type-check`（0 新增）、`test:mbd`（75+ 文件、744+ 用例全过）、CI 同款 `eslint`（0 error）与 `build-only` 生产打包验证。
4. **全库 7,059 对象端到端扫描层**：用新合并的宿主 + 求解器重放 `AvevaMarineSample` 7,059 个候选对象，经最新前端 `mbd-live-sweep.mjs` 完整跑过契约校验、外部记录映射、登记与 `layoutViewport` 排版（默认判型表 + `[mbd_type_rules]` 项目判型表双口径），并与 `11-13` 基准逐对象比对。

---

## 7. Boundaries

- **Always（必须遵守）**：
  - 每次 `cargo` 必须经 `with-build-lock.ps1` 且 `-Jobs 2`；
  - 清理临时 worktree 前若存在 `node_modules` 目录联接（junction），必须先 `cmd /c rmdir` 解除联接，严禁递归删除穿透主检出 `node_modules`；
  - 补充 `gen-model` cherry-pick / rebase 后的新旧 commit SHA 对照表，确保验证文档可追溯。
- **Ask first（需先确认）**：
  - 本地落地分支全部门禁与 7,059 对象复扫通过后，执行远端 `git push`（`plant3d-web` `origin/main`、`plant-mbd` `github/main`、`gen-model` `origin/refactor`）及快进本机共享 `vendor/plant-mbd` 前，先列最终提交号清单请您确认。
- **Never（严禁触碰）**：
  - 严禁触碰或覆盖 `plant3d-web` 主检出、`gen-model` 主检出中已有的未提交文件；
  - 严禁直接拿不含 `.dirty` 在途代码的干净二进制覆盖正在运行的 `127.0.0.1:8022` 共享后端或改动 `8009` 数据库状态。

---

## 8. Success Criteria

- **SC-001**：`plant3d-web` 落地分支基于 `c9d0805d` 合入全部 28 笔 MBD 提交，`type-check` 0 错、`test:mbd` ≥ 744 条 100% 通过、CI `eslint` 0 error、`build-only` 成功。
- **SC-002**：`gen-model` 落地分支基于 `5e1ad86e3` 合入全部 16 笔 MBD 提交并解决 `tests/mbd_branch_query.rs` 冲突，配 `plant-mbd` `3dbf13a` 编译 0 错，8 个 MBD 测试目标 100% 通过（≥ 105 条）。
- **SC-003**：7,059 个候选对象在新合并三仓代码下全量扫描：**契约拒收 = 0、映射拒收 = 0、呈现退化 = 0**；带 `[mbd_type_rules]` 配置重放时 1,382 条电缆桥架准确归为 `not_annotatable`、`/1PTU-INST23` 573 条复制工艺管按 `em4_pipe` 正常走通且字高可读性完成抽样核验。
- **SC-004**：产出可直接执行的远端快进推送清单及本机 `8022` 维护方换版交接补丁说明，隐私/敏感路径扫描 0 违规。

---

## 9. Out of Scope (Deferred to Subsequent Modules)

- 主检出在途 `MBD_INITIAL_BRAN_LIMIT = 32` 全类型化收尾及 `#133 / #135 / #137 / #138` → 归 **Module 2 (`mbd-batch-and-diagnostics-ux`)**；
- 相机远裁剪 `#139`、三维相压计数 `#140/#141`、「取最新」联动 `#142`、覆盖警示 `#144` → 归 **Module 3 (`mbd-viewport-and-sync-integration`)**；
- E3D 实机 PML 导出金样 `#146–#149` 与生产服务器部署 `#143` → 归 **Module 4 (`mbd-pml-golden-and-release`)**。

---

## 10. Open Questions（请确认以下 2 项即可进入 Phase 2 Plan & Phase 4 执行）

1. **隔离验收方式确认（推荐：默认按 Assumption #2）**：鉴于本机 `8022` 当前跑的是带主检出未提交改动的 `.dirty` 实例，本模块通过独立落地 worktree + 只读重放/隔离端口完成 7,059 对象全量复扫并生成 `8022` 换版补丁包（不直接停掉覆盖 `8022`），是否认可？
2. **远端推送时机（推荐：门禁全绿后列出最终 SHA 清单请您点一次确认即推）**：本地合入 `2026-11-18` 最新远端头并跑通全部门禁后，是否先向您展示三仓精确推送提交范围，确认后在同一窗口完成远端快进推送？
