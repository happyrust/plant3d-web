# Task Breakdown: `mbd-viewport-and-sync-integration`（Spec 005 Module 3）

**Spec**: `specs/005-mbd-dimension-closure/SPEC-mbd-viewport-and-sync-integration.md`  
**Plan**: `specs/005-mbd-dimension-closure/tasks/plan-mod3.md`

---

## Tasks

- [x] **T301 — `#139` 视口相机远裁剪面纳入外伸 MBD 标注范围并保护小模型 `near`**（已提交 `bcfcb84e`）
  - **Acceptance**: 标注不伸出模型时裁剪面与旧分档逐值一致；只装复制设备本身（`24381_103159`、`24381_127703`、`24381_133122`）时 `far` 覆盖全部外伸标注（`far = 164–190 m, near = 0.01 m`，满足 `far / near <= 2e4`），默认视角与「对到标注上」两档全部标注上屏。
  - **Verify**: `npx vitest run src/viewer/camera/clipPlanes.test.ts` 全过。
  - **Files**: `src/viewer/camera/clipPlanes.ts`, `src/viewer/camera/clipPlanes.test.ts`, `src/components/dock_panels/ViewerPanel.vue`

- [x] **T302 — `#140` 全量 6,732 个走通候选包三类「对着看也不画」与孤立附加小字审计入库**（已提交 `15737649`）
  - **Acceptance**: 在 6,732 个走通包（6,490 归属对象，239,488 条记录）上给出相压（`86 → 0`）、孤立附加小字（`1 → 0`）、远裁剪面截断（`3 → 0`）、极小字高（`52 → 0`）的精确条数、对象数、按九种标注类型分布与样本核对（覆盖 `24381_178118`, `24383_76302`, `24381_147426`, `24381_103704`, `24381_103159`, `24381_38695`）。
  - **Verify**: `node scripts/mbd-closeup-unrendered-audit.mjs` 运行成功并生成 `docs/verification/mbd-closeup-3class-audit-2026-11-18.md`。
  - **Files**: `scripts/mbd-closeup-unrendered-audit.mjs`, `docs/verification/mbd-closeup-3class-audit-2026-11-18.md`, `.gitignore`

- [x] **T303 — `#141` 三维呈现读数相压先试候选位再隐藏 + 附加小字联动 + 修订 ADR 0057/0059/0061**（已提交 `7c209ff7`）
  - **Acceptance**: 全量 6,732 包多机位永久相压从 `86 → 0`、孤立 `+50` 从 `1 → 0`；整包视角带 LOD 零重叠画出记录从 `113,707` 提升至 `117,337`（`+3,630` 条）；`?mbd_3d=0` 平贴呈现完全不变；`ADR 0057 / 0059 / 0061` 同步修订。
  - **Verify**: `declutterPolicy.test.ts`、`dimension3d.test.ts`、`mbdV2ExternalAnnotations.test.ts`、`useMbdExternalSync.test.ts` 与全量审计全部通过。
  - **Files**: `src/dimension/adapters/mbdV2ExternalAnnotations.ts`, `src/dimension/kernel/types.ts`, `src/dimension/kernel/layout/dimension3d.ts`, `src/dimension/kernel/layout/explicit.ts`, `src/dimension/kernel/layout/declutterPolicy.ts`, `src/composables/useMbdExternalSync.ts`, `docs/adr/0057-*.md`, `docs/adr/0059-*.md`, `docs/adr/0061-*.md`

- [x] **T304 — `#142` 主线零耦合 MBD「取最新」增量刷新协调器与会话不一致面板提示**（已提交 `ad5fbee4`）
  - **Acceptance**: 仅受影响对象重取、未受影响对象复用缓存不重取；原先已装对象在新会话返回 `404` 被删时撤下标注并写入「对象已删除」诊断（不挂失败角标、不弹错误提示）；当模型会话号与标注包 `sourceVersion` 不一致时面板显式展示 `标注 db@S1 ≠ 模型 db@S2`。
  - **Verify**: `useMbdExternalSync.test.ts` 与 `DimensionPanelDock.test.ts` 全过。
  - **Files**: `src/dimension/adapters/mbdV2Contract.ts`, `src/api/mbdV2Api.ts`, `src/composables/useMbdDiagnosticsStore.ts`, `src/composables/useMbdExternalSync.ts`, `src/dimension/ui/DimensionPanelDock.vue`（及对应 `.test.ts`）

- [x] **T305 — `#145` 核对补齐 `CONTEXT.md` 13 个 MBD 词条与 `AGENTS.md` 环境叫法 + 全门禁收口**（已提交 `c399dc48`）
  - **Acceptance**: 13 个词条完整收录在 `CONTEXT.md`「尺寸与测量」并与修订后的 `ADR 0057` 口径对齐，`AGENTS.md` 包含「联调后端 / 服务器」环境叫法；全仓门禁全绿。
  - **Verify**: `npm run type-check`（0 错）、`npm run test:mbd`（762/762 全过）、改动文件 `npx eslint`（0 错 0 警告）、`npm run build-only` 与 7,059 包复扫 100% 通过。
  - **Files**: `CONTEXT.md`, `AGENTS.md`
