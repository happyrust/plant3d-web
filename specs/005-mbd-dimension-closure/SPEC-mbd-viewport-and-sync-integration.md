# Specification: `mbd-viewport-and-sync-integration`（Spec 005 · Module 3）

**Status**: Approved（2026-11-18 批准：#141 重开修订 ADR 0057 实现先挪后藏+附加小字联动；#142 先行交付主线零耦合增量刷新协调器；#144 留待第四模块 #143 服务器升级后执行）  
**Module**: `mbd-viewport-and-sync-integration`（`specs/005-mbd-dimension-closure/CAPABILITY-MAP.md` 第三模块）  
**Base**: `plant3d-web` `origin/main` @ `f5e549c9f736b0dc6a31b428e62292241c24fd07`  
**Tickets**: `#139`, `#140`, `#141`, `#145`（及受外部轨道前置门禁约束的 `#142`、`#144` 衔接裁决）

---

## 1. Objective & User Outcomes

解决 MBD 三维尺寸标注在**三维视口相机裁剪、三维读数两两相压消隐与全仓术语文档一致性**上的剩余问题，并明确与外部轨道（`#157`「取最新」第一期、`#143` 服务器部署）之间的衔接边界：

1. **`#139` 标注伸出模型很远时不被远裁剪面切掉**：
   - **前置复现核实（已完成初探）**：在 `#121`（「原点离设备本体 > 1 m 时不画定位尺寸」）之后的最终标注包上实测，3 台复制设备 `24381_103159`（跨度 `18.97 m`）、`24381_127703`（`17.30 m`）、`24381_133122`（`16.39 m`）因偏转角/原点仍在 `[0, 0, 0]` 而设备本体在 `[2.05, 0.74, 18.85] m`（本体包围盒对角线 `< 1 m`，`computeClipPlanesByDiag` 给出 `near = 0.01 m, far = 20 m`），把相机对到 `19 m` 跨度的标注上时视距约 `28.5 m > far = 20 m`，**远裁剪面截断仍然稳定复现**。
   - **目标结果**：当场景装有 MBD 外部尺寸记录时，计算远裁剪面 `far` 的包围盒将已装 MBD 标注的世界包围盒一并并入；同时保持近裁剪面 `near` 仍由模型自身包围盒决定（配合 `logarithmicDepthBuffer` 与 `maxRatio = 2e4` 护栏），确保 `< 1 m` 小模型表面不发生深度精度闪烁，标注在模型范围以内的对象裁剪面数值 100% 不变。

2. **`#140` 全量数清三维呈现下「对着看也不画」的三类记录**：
   - 在全部 6,732 个走通候选包（6,490 个归属对象）上，使用已合入 `#138`（`f5e549c9`）的前端真内核、与页面一致的相机机位（默认视角、对到标注上、拉近 + 每条记录多距离与 ≥ 2 个视线方向对焦）及 `computeClipPlanesByDiag` 裁剪面分档，输出完整验证报告：
     - 类别 A：**读数相压被藏（`overlap`）**，并**单列「主尺寸被藏、挂在主尺寸上的附加长度小字（如调整焊 `+50`）仍留在屏幕上」**（含 `24383_76302`）；
     - 类别 B：**被远裁剪面切掉**（区分 `#139` 修复前后的对象数）；
     - 类别 C：**字高太小近不过近裁剪面**（核实 `#138` 合入后全量已降为 **0**）。

3. **`#141` 三维呈现读数相压避让与主从联动（取决于 Open Question 1 对 ADR 0057 的裁决）**：
   - **主从联动（无 ADR 冲突）**：挂在主尺寸上的附加小字（如调整焊 `+50`）与所属主尺寸绑定生死与位移——主尺寸被藏则附加小字一并隐去，杜绝屏幕上出现无主数的孤立 `+50`（`24383_76302`）；
   - **先挪后藏（需确认重开修订 ADR 0057 / 0059 / 0061）**：两条读数或正对机位下的安装角度相压时，先给低优先级记录尝试沿尺寸线外移 / 箭头与读数外置候选位，全部候选仍相压才隐藏，使 `24381_178118`、`24381_147426`、`24383_76302`、`24381_103704` 等短尺寸与安装角度在对焦/正对机位下可完整画出，且平贴呈现（`mbd_3d=0`）行为不变。

4. **`#145` 补齐 `CONTEXT.md` 13 个 MBD 外部尺寸词条与 `AGENTS.md` 环境叫法**：
   - 在 `CONTEXT.md`「尺寸与测量」补齐 13 个标准词条（求解器、标注包、归属对象、可标注候选、不可标注、空包、整包拒绝、呈现退化、出口自检、诊断、覆盖声明、裁决、偏离，各附定义与 _Avoid_）；在 `AGENTS.md` 明确「联调后端」与「服务器」两个环境叫法。

---

## 2. Preconditions & Cross-Track Gate Audit（前置核查结论）

| 子票 | 票面规定开工前提 | 2026-11-18 实测现状 | 本模块处置建议 |
|---|---|---|---|
| `#139` | 先在 `#121` 之后的数据上复现 | 已在最终包上确认 3 台设备跨度 `16.4–19.0 m` 仍超 `far = 20 m` | **本模块直接实施收口** |
| `#140` | 带短线修正的前端真代码 + 最终标注包 | `5fa84ff6` 与 `#138` 已在 `origin/main` | **本模块直接实施并归档计数报告** |
| `#141` | `#140` 计数结果 + 用户确认是否重开 ADR 0057 | 待您在本 Spec Open Question 1 拍板 | **按您的拍板在本模块一并收口** |
| `#145` | 无外部阻塞 | `CONTEXT.md` 与 `AGENTS.md` 在主线可直接更新 | **本模块一并收口** |
| `#142` | 硬前置 `#157`（「取最新」第一期并入 `origin/main`） | `#157` 仍在独立工作树 `plant3d-web-getwork-land`（`361b771e`，领先主线 47 笔，`#157` 状态 `OPEN`），主线尚无「取最新」事件与水位基础设施 | 见 **Open Question 2**（推荐不混入未合入的 47 笔副线，待 `#157` 合入主线后紧接落地，或先抽离纯协调器模块） |
| `#144` | 硬前置 `#143`（远端生产服务器跟上带 `meta.coverage` 的服务端） | 生产服务器发布分支仍停在 `2026-11-05` 旧版；此时若在 `main` 提前删掉 `PARTIAL_LAYOUT_MODES` 兜底会导致对老服务端漏报不完整 | **严格遵守票面契约，移交第四模块 `#143` 服务器升级核对后执行** |

---

## 3. Tech Stack & Verification Commands

- **Language & Runtime**: TypeScript 5.x, Vue 3, Three.js (`PerspectiveCamera` + `logarithmicDepthBuffer`), Vitest 4.x, Node ESM 扫描工具。
- **Verification Commands**（在干净工作树 `D:\work\plant-code\old\plant3d-web-land` 执行）：

```powershell
npm run type-check
npm run test:mbd
npx eslint <本次改动的全部 .ts / .vue / .mjs 文件> --max-warnings=0
npm run build-only
```

---

## 4. Project Structure

```text
src/
  ├── viewer/
  │   ├── clipPlanes.ts                         → （新增）纯函数 computeSceneClipPlanes(modelDiagM, combinedDiagM)，保证标注内包零变化、外伸只扩 far 不抬 near (#139)
  │   └── clipPlanes.test.ts                    → （新增）裁剪面分档、标注外伸、maxRatio=2e4 与 25 走通样本不变性单测 (#139)
  ├── components/dock_panels/
  │   └── ViewerPanel.vue                       → applyDtxCameraClipByLayerBBox 并在 MBD 同步后重算相机远裁剪面 (#139)
  └── dimension/
      ├── adapters/
      │   └── mbdV2ExternalAnnotations.ts       → 标记附加小字（如调整焊 +50）与所属主尺寸的联动归属键 (#141)
      └── kernel/
          ├── layout/
          │   ├── dimension3d.ts                → 三维读数候选偏移位生成（沿线外移 / 箭头与读数外置）(#141)
          │   └── declutterPolicy.ts            → 相压先试候选位再隐藏 + 从属附加小字随主尺寸显隐 (#141)
          └── viewport/
              └── layoutViewport.ts             → 接入三维候选避让与主从联动消隐 (#141)
scripts/
  └── mbd-closeup-unrendered-audit.mjs          → （新增）#140 三类「对着看也不画」全量多机位多方向审计脚本
docs/
  ├── adr/
  │   ├── 0057-present-mbd-running-dimensions-as-3d-annotation-standing-off-the-pipe.md → 若重开则修订相压去重条款 (#141)
  │   ├── 0059-keep-mbd-tag-billboards-clear-of-component-boxes-and-dimension-strokes.md → 同步口径 (#141)
  │   └── 0061-fade-occluded-dimensions-in-inspection-mode.md                            → 同步口径 (#141)
  └── verification/
      └── mbd-closeup-3class-audit-2026-11-18.md → （新增）#140 全量计数与样本核对记录
CONTEXT.md                                      → 补齐 13 个 MBD 外部尺寸词条 (#145)
AGENTS.md                                       → 明确「联调后端」「服务器」环境叫法 (#145)
```

---

## 5. Code Style & Core Contracts

裁剪面计算抽成零 DOM 依赖纯函数，确保「标注不伸出模型时与旧分档逐位相等；小模型标注外伸时只扩 `far`、在 `maxRatio = 2e4` 护栏内保留小模型原 `near`」：

```ts
export function computeSceneClipPlanes(input: Readonly<{
  modelDiagM: number;
  combinedDiagM?: number | null;
}>): Readonly<{ near: number; far: number }> {
  const base = computeClipPlanesByDiag(input.modelDiagM);
  const combined = input.combinedDiagM ?? input.modelDiagM;
  const extendedFar = combined > input.modelDiagM
    ? Math.max(base.far, computeClipPlanesByDiag(combined).far)
    : base.far;
  const maxRatio = 2e4;
  let near = base.near;
  let far = extendedFar;
  if (far / near > maxRatio) {
    near = Math.max(near, far / maxRatio);
  }
  if (far <= near * 1.01) {
    far = near * 100;
  }
  return { near, far };
}
```

> 例：小设备模型 `modelDiagM = 0.8 m`（`base = { near: 0.01, far: 20 }`），标注跨度 `combinedDiagM = 19.5 m`（对应档位 `far = 1000`）：`1000 / 0.01 = 1e5 > 2e4` 时自动将 `near` 微调至 `0.05 m`（`50 mm`）、`far = 1000 m`，既完全包住 `28.5 m` 视距下的全部标注，又严格守住对数深度缓冲 `far / near <= 2e4` 不闪烁！

---

## 6. Testing Strategy

1. **`#139` 单测与样本回归**：断言标注在模型内时 `computeSceneClipPlanes` 与原 `computeClipPlanesByDiag` 在全分档边界逐值一致；断言 `24381_103159`、`24381_127703`、`24381_133122` 在只装设备本身时默认视角与「对到标注上」两档记录 **100% 上屏**，且 `far / near <= 2e4`。
2. **`#140` 全量审计**：对全部 6,732 个走通候选包输出三类「对着看也不画」精确条数、归属对象数、九种标注类型分布及「主尺寸被藏、附加小字仍留着」专项清单（覆盖 `24381_178118`、`24383_76302`、`24381_147426`、`24381_103704`、`24381_103159`、`24381_38940`）。
3. **`#141` 单测与全量相压对比**：断言 `24383_76302` 中景机位不再出现无主数的 `+50`；若开启先挪后藏，断言 `24381_178118`、`24381_147426`、`24383_76302`、`24381_103704` 对焦/正对机位全部画出，读数重叠数为 `0`，`mbd_3d=0` 平贴呈现逐像素不变，且 6,732 包默认整包视角上屏条数不退化。
4. **`#145` 文档校验**：逐条核对 13 个词条与 `ADR 0046 / 0071` 一致性，`AGENTS.md` 不再使用模糊的「现网」指代。

---

## 7. Boundaries

- **Always（必须遵守）**：
  - 每张票独立提交并附单测；全部改动在干净工作树 `D:\work\plant-code\old\plant3d-web-land` 上基于最新 `origin/main`（`f5e549c9`）执行；
  - 对改动文件只跑 `npx eslint <files> --max-warnings=0`，严禁跑全仓改写的 `npm run lint`；
  - 修订内核呈现规则时，`?mbd_3d=0` 平贴呈现必须保持零变化。
- **Ask first（需先确认）**：
  - 是否重开并修订 `ADR 0057 / 0059 / 0061`（「先挪后藏」）；
  - 是否碰触 `model-getwork` 47 笔未合入分支（`#157`）；
  - 本模块全部门禁通过后推送 `origin/main` 前先向您列清单确认。
- **Never（严禁触碰）**：
  - 在远端生产服务器未完成 `#143` 升级前，严禁提前删除 `PARTIAL_LAYOUT_MODES` 老服务端兜底（`#144`）；
  - 严禁修改主检出 `D:\work\plant-code\old\plant3d-web` 的未提交文件或修改 `plant-mbd` 求解器金样。

---

## 8. Success Criteria

- **SC-301**：`24381_103159`、`24381_127703`、`24381_133122` 只装设备本身时，默认视角与「对到标注上」两档全部标注上屏，全量被远裁剪面截断对象数降为 **0**，其余内包对象裁剪面不变（`#139`）。
- **SC-302**：产出 `docs/verification/mbd-closeup-3class-audit-2026-11-18.md`，给出 6,732 个走通包三类「对着看也不画」与「无主数的附加小字」全量权威统计（`#140`）。
- **SC-303**：「主尺寸被藏、附加小字还留着」全量降为 **0**；若批准重开 `ADR 0057`，`24381_178118`、`24381_147426`、`24383_76302`、`24381_103704` 对焦/正对机位全部画出且读数零重叠（`#141`）。
- **SC-304**：`CONTEXT.md` 收录全部 13 个词条，`AGENTS.md` 统一「联调后端 / 服务器」叫法（`#145`），全套门禁通过。

---

## 9. Out of Scope (Deferred to Module 4 / K7)

- `#144`（删除 `PARTIAL_LAYOUT_MODES` 老服务端兜底）→ 严格排在第四模块 `#143` 生产服务器部署并确认携带 `meta.coverage` 之后执行；
- `#146–#149`（E3D 实机导出九类 PML JSON 金样）与 `#143`（生产服务器部署）→ 归 **Module 4 (`mbd-pml-golden-and-release`)**。

---

## 10. Open Questions（请确认以下 3 项即可进入 Phase 2–4 实施）

1. **`#140 → #141` 对 `ADR 0057` 的策略确认（推荐方案 A）**：
   - **方案 A（推荐）**：先执行 `#140` 全量计数，随后**批准重开并修订 `ADR 0057 / 0059 / 0061`**，在三维呈现下完整实现 **「读数相压先试沿线外移/外置候选位、都压才藏 + 附加小字（`+50`）随主尺寸联动显隐与位移」**（平贴呈现 `mbd_3d=0` 保持原位不变）。理由：三维字与线同比例缩放，不给候选挪位会导致短尺寸链在任何距离下永久互压消失，与 `#138` / `5fa84ff6`「不把避让变成永久删除」的工程原则一致。
   - **方案 B（保守）**：不重开 `ADR 0057`，`#141` 只做「附加小字（`+50`）随主尺寸同步隐去」。
2. **`#142`（「取最新」后刷新已显示 MBD 标注）与副线 `#157` 的衔接方式（推荐方案 A）**：
   - 核查发现 `#142` 的硬前置 `#157`（`land/model-getwork-2026-11-17` @ `361b771e`，共 47 笔「取最新」第一期提交）尚未并入 `origin/main`。
   - **方案 A（推荐）**：本模块保持 MBD 主线纯净、不越界合入 `model-getwork` 那 47 笔副线；但在主线先行交付**零耦合的纯增量刷新协调器（按受影响库/对象筛选重取、404 已删对象撤下并写明「对象已删除」诊断、面板显示标注会话与模型会话不一致提示）及完整模拟单测**，使 `#157` 一旦并入主线只需一行回调即可全量接通 `#142`！
   - **方案 B**：先将 `#157`（47 笔）一并重整合入 `origin/main`，再在主线上直接端到端接通 `#142`。
   - **方案 C**：本模块暂缓 `#142`，完全留待后续单独处理 `#157` 副线时再做。
3. **`#144`（删掉老服务端排版模式名兜底）归属确认（推荐：移交第四模块 `#143` 部署后执行）**：因生产服务器发布分支仍停在 `2026-11-05` 未带 `meta.coverage`，保留兜底直至 `#143` 服务器升级核验通过后再删，是否同意？
