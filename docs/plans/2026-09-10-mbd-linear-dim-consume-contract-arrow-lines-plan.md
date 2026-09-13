# 开发计划：MBD `linear_dim` 消费契约 `arrow_lines`（内核 `arrowLines` 加最小像素钳制）

- 日期：2026-09-10
- 状态：**已落地**（用户 2026-09-10 拍板走 A，D1–D4 全按推荐；§3.1 `483d1eb`、§3.2 `4cd9a13`、§3.3 本笔含 ADR 0056）。**live 未验**——等真 gen-model `:8022`，看点见 §5
- 来源：`docs/issues/mbd-linear-dim-ignores-wire-arrow-lines-2026-09-09.md`（P3）
- 范围：plant3d-web `src/dimension/`（内核 + 适配层 + 契约注释 + ADR）；plant-mbd **不动**（契约形状与金样不变，只同步一句注释）

## 1. 目标

3D 视口里 MBD `linear_dim` 的箭头按契约 `arrow_lines` **1:1** 画——方向、半角、随组字高的长度都来自求解器；当翼投影到屏幕后短于像素下限时，**沿原屏幕方向把翼拉到下限**，全厂视角仍可读。用户尺寸（`linear` / `angular`）的实心屏幕箭头不动。

## 2. 已查证的事实（本轮真查，带出处）

| # | 事实 | 出处 |
| --- | --- | --- |
| F1 | **ADR 0048 已写明「外部 MBD 已明确提供箭头线段时尊重源数据，不重复生成箭头」**，ADR 0007 也允许显式来源提供箭头。现 `mapLinearDim` 丢 `arrow_lines`、自造 `arrows`，与两条 ADR 相悖——A 是**回到 ADR 口径**，不是新决策（issue 与前一轮 B 推荐都漏看了这一条） | `docs/adr/0048` L35、`docs/adr/0007` L3 |
| F2 | 内核 `SceneVertex = { anchor: Vec3, offsetPx: Vec2 }`：画家逐帧投影 `anchor` 再加像素偏移。屏幕钳制**不需要新图元类型**——翼末端换成 `sceneVertex(tipAnchor, unit·minPx)` 即可，`makeFilledSceneArrow` 用的就是这一机制 | `kernel/geometry/sceneGeometry.ts` L26–43、L80–108 |
| F3 | `layoutExplicit` 里 `arrowLines → makeSceneLine(from, to, 'arrow')` 是纯几何、无钳制；`arrows → explicitArrow` 用 `theme.arrowLengthPx = 13 / arrowHalfAngleDeg = 18` 画屏幕定尺实心头。布局由 `layoutViewport` 用当前 projector 重算（标签避让同一机制），钳制判据每帧成立 | `kernel/layout/explicit.ts` L178–224；`kernel/viewport/layoutViewport.ts` |
| F4 | wire 约定：每条 `linear_dim` **4 段**，`from` = 尺寸线端点（tip）、`to` = 翼底；翼长 `0.96·cheight`、半宽 `0.28·cheight`；`small` 时翼朝外——前端不必再由 `sub_kind === 'small'` 推 `outside` | plant-mbd `isodim.rs` L1398–1452 |
| F5 | 仓内 `arrow_lines` 的其它触点：`mbdV2Contract.ts` 守卫 `isLineSegmentArray`（L293）、parquet 通道 `mbdExternalDimensions.ts` 透传（L80、L151）、`slope_mark` 的 `slopeArrowLines` 也走 `arrowLines`（L515）。SVG 导出 `layoutResultsToSvg` 吃 `LayoutResult`，改内核后**自动一致** | 各文件 |
| F6 | 钉住旧行为的测试：`mbdV2ExternalAnnotations.test.ts` L180–185 / L207–211；`explicit.test.ts` L27 与 `goldens.test.ts` L171 的翼 `(0.1, 0.05)` m 在 100 px/m 测试投影下 = **11.2 px < 13**，会被钳，且 L45 断言 `project` 调用 8 次（钳制多投影翼两端 → 变 10）；`theme.test.ts` 钉主题形状 | 各文件 |

## 3. 改法（三层、三笔提交，可按序独立评审）

### 3.1 内核：`arrowLines` 最小像素钳制（`kernel/theme.ts`、`kernel/layout/explicit.ts`、`kernel/types.ts`）

- `DimensionTheme` 加 `arrowLineMinLengthPx`，默认 **= `arrowLengthPx`（13）**：钳后翼长与用户尺寸箭头同量级。
- `layoutExplicit` 对每条 arrowLine 投影 `from` / `to`，`L = |Δ|`：
  - `L ≥ min` → 现状 1:1（`sceneVertex(to)`）；
  - `0 < L < min` → `to` 换成 `sceneVertex(from, unit·min)`——屏幕方向不变、长度拉到 min，anchor 仍在 tip 上；
  - `L ≈ 0`（翼与视线平行）→ 见 D4。
- 注释：`ExplicitLayoutInput.arrowLines` 注「`from` = 锚点 / tip，钳制绕它进行」；`ExplicitArrowInput` 去掉「外部源用它替代毫米笔画」那句。
- 测试：`explicit.test.ts` 加 3 条（≥ min 不动 / < min 拉到 min 且方向不变 / 同一输入换更远 projector 仍为 min）；L27 与 `goldens.test.ts` L171 的 11.2 px 翼**重钉为 13 px**（钉的是钳制本身，不改 fixture 躲开）；`theme.test.ts` 加字段。

### 3.2 适配层：`mapLinearDim` 消费 `arrow_lines`（`adapters/mbdV2ExternalAnnotations.ts`）

- `primitive.arrow_lines.length > 0` → `arrowLines = arrow_lines.map(transformPoint)`；**不再造 `arrows`**、不再看 `sub_kind`（翼方向已在几何里）。
- `arrow_lines` 为空 → **退回现状**（自造实心头 + `outside`）：保住老 parquet DTO（`arrowLines` 可空）与不带箭头的第三方产出。
- 测试：重钉 L180–185（期望 4 段 `arrowLines`、无 `arrows`）、L207–211（small：翼朝外由几何体现）；新增「`arrow_lines` 为空退回 `arrows`」。5 个 fixture 都带 `arrow_lines`，不动。

### 3.3 契约注释与文档

- `mbdV2Contract.ts` `arrow_lines` doc：`from` = tip、`to` = 翼底；3D 视口 1:1 消费，低于 `arrowLineMinLengthPx` 时屏幕拉伸。plant-mbd `contract.rs` 同一句（`send_to` 或用户转达；形状不变、不重录金样）。
- 新 **ADR 0056**「MBD 外部尺寸箭头按契约几何绘制并设像素下限」——是 0048 §35 的实施口径（几何为准、可读性下限），不取代 0048。
- `CONTEXT.md`「三维尺寸呈现」加一句：外部显式箭头以来源几何为准，仅设可读下限。issue 状态改「已定 A · 进行中」；`record_decision(topic="mbd")`。

## 4. 待拍板（推荐项加粗）

- **D1 翼的画法**：**A. 按 wire 画 V 形描边（`'arrow'` part 线段，与契约 / 离线对拍图 1:1）**；B. 从 wire 取长度 / 半角仍画实心三角（外观与用户尺寸统一，但只「消费参数」不是几何）。
- **D2 上限**：**A. 只设下限**（近景大管翼可到几十 px，这就是几何语义，延长线也如此）；B. 同时加 `arrowLineMaxLengthPx`。
- **D3 钳制作用域**：**A. 主题级、对所有 `arrowLines` 生效**（`slope_mark` 一并受益，同一个可读性问题）；B. 记录级 opt-in 字段。
- **D4 退化翼（L ≈ 0）**：**A. 不画该翼**（与线段本身在该视角消失一致）；B. 沿尺寸线投影方向补一条 min 长。

## 5. 验证

- 单测：`explicit` / `goldens` / `theme` / `mbdV2ExternalAnnotations` / `mbdV2Contract` 5 文件全绿；全量 vitest 维持 **0 failed**（基线 264 文件 / 1991 条）；`npm run type-check` 新增 0；触及文件 eslint 0。
- 浏览器（真 gen-model `:8022` + web `:3101`，长驻服务由用户起）：`?mbd_refno=24383_100028&mbdBackendPort=8022`（小管，cheight 7）与 `24381_145018`（大管，cheight 27）——近景翼长随管径不同、拉远后两者都停在 13 px；控制台 `rec.layout.arrowLines.length === 4`、`rec.layout.arrows === undefined`。截图追加进 issue 文档。
- 导出一次 SVG，箭头与视口一致（F5）。

## 6. 风险

| 风险 | 处置 |
| --- | --- |
| 钳制后翼两端 `anchor` 相同（都锚 tip）；若有代码按 `to.anchor` 反推设计坐标会拿到 tip | F5 已列全仓触点，`arrowLines` 只有 layout 读；命中 / 碰撞用投影后坐标，不受影响 |
| 老 parquet 没有 `arrowLines` | 3.2 退回旧头，单测钉住 |
| goldens 重钉被误认为回归 | 提交信息写明：钳制生效 11.2 → 13 px |
| plant-mbd 侧误以为契约变了 | 只改注释，形状与金样不动，同步一句即可 |

## 7. 明确不做

不改 `arrow_lines` 契约形状、不动 plant-mbd 金样、不动用户尺寸的实心头、不做上限钳（D2 选 A 时）、不引入逐尺寸样式（ADR 0015）。

估算：内核 0.5 天 + 适配 0.25 天 + 文档 0.25 天 ≈ 1 天，单人一条线，三笔提交。
