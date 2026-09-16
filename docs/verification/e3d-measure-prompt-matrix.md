# E3D 3.1 Measure 提示文案矩阵（Phase E · 方案 §2 #19）

> 方案 `docs/plans/2026-09-12-e3d-measure-parity-plan.md` §4 Phase E 第一条：「提示文案矩阵（每模式 × 每步 × 拾取类型 × 过滤器）与 E3D 逐条对照」。
> 依据：本机 E3D PMLLIB（`C:\Program Files (x86)\AVEVA\Administration1.8\PMLLIB\common\objects\`，与 golden MD 引的 3.1 源同一套对象，行号按 1.8 那份）
> `edgstate.pmlobj`（`prompt()` 323–363、`isPositionMode()`）、`edgpick.pmlobj`（`applyToView` 168–199、`std*` 570–900）、`edgpicktype.pmlobj`
> （`stdPosition` 1447、`stdGraphics` 1696、`set*` 1747–1917、`intersect()` 825–935）、`edgpickpacket.pmlobj`（`measure*` 包）、`edgposcntrl.pmlobj`（`loadPicks` 346–405）；
> Web：`src/measurement/pick/pickLayerModel.ts`（`formatMeasurementPrompt` / `measurementPickTypePromptToken` / 过滤器与类型表）、`src/composables/useXeokitMeasurementTools.ts`
> （`statusText` 2527–2608、`currentSnapTargetText`、`pickPointMessage` 各处）。
> **证据等级**：E3D 原为一律 `static_expectation`（字串照源码抄）；**2026-09-16 23:3x 起**，§2 四条命令的第 1 步、§3 七项顺序、§4 八项顺序、§5 三条尾巴的缺省状态已在跑着的 E3D 3.1（shadow，PID 11900）里用 `capture-prompt-step.pmlmac` 直读 `!!edgCntrl.state.prompt()` 与视口 inMode prompt 采成 `observation`（golden MD §38，`e3d-prompt-capture.trace.txt`，无截图——主窗口最小化），其余行仍 `static_expectation`；Web 字串照源码抄，并与 golden MD §35 / §30 补采实机截图里的提示条核过（`(Distance[100]) Snap : SCTN PLINE NA · Distance[100]`、
> `(Intersection[3]) Snap : BOX 交点（预览）`、`两线夹角 · 第 2/2 步 选择第二条线或面（第一条：VALV P-Point #100） (Cursor) Snap : VALV P-Point #100；点空白取消当前点选`——后者是 D1 改前的截图，
> `0c0d9eb` 起两线夹角不再带 `(Cursor) Snap`，改后的四态实机截图见 golden MD §30「补采（12:32 / 13:09）」）。
> 2026-09-16 落成；差异见 §7。**D1 已拍板并改掉（用户 10:54，`0c0d9eb`）**：两线夹角提示按 E3D `stdGraphics` 口径去掉 `(token)` 与 ` Snap` 尾巴；D5 的 Web 文案同笔改掉，E3D 原文仍待采；D6 静态核清结掉；**D2 用户 2026-09-16 15:5x 改口、改掉（`e8ebc10`，决策 `d-269` 取代 `d-228`）**：Fraction 提示照 E3D 原样出输入值；余 D4（不做）。

## 1. 提示的结构

E3D 一条提示由三个对象各出一段，再按拾取是否「定位拾取」补尾巴，最后由 `EDGPICK.applyToView` 缀上冒号送进视图的 inMode prompt：

```
EDGSTATE.prompt()  =  <pickPacket.prompt>  <pickType.prompt>  (<pick.prompt>)  [ WP]  [ Offset]  [ Snap]
                       ── 命令 ──────────  ── 这一步 ────────  ── 拾取类型 ───  ─ 定位拾取才有（isPositionMode = pickType.positioning）─
EDGPICK.applyToView(view, prompt)  →  view.inMode.prompt = (prompt & ' : ').trim('LMR')      → 末尾是 " :"
```

- `pickPacket.prompt`：命令名（`measureDistance` 的 `'Measure distance'` 等，见 §2）。
- `pickType.prompt`：这一步的文字（`stdPosition('start')` 的 `'start'`）。Positioning Control 把当前拾取类型（Snap / Distance…）套到这一步上时，会把这段文字复制过去
  （`edgstate.pmlobj` 256 `!this.pickType.prompt = !this.packet.pickPacket.picks[!this.major].prompt`）。
- `pick.prompt`：拾取类型的 token，由 `EDGPICKTYPE.set*` 写进 `pick.prompt`（§3）；`stdGraphics` 这类非定位拾取的 EDGPICK **没有** prompt → 这一段整个省掉（连括号）。
- 尾巴只对 `pickType.positioning = true`（`stdPosition`）的拾取加：` WP`（`!!edgPosCntrl.activePlane` 工作平面开着）、` Offset`（`offsetType ne 'NONE'`）、` Snap`（`intermediate`，即 Significant Snaps）。
- 视图提示到冒号为止；当前吸中的目标在 E3D 是图形上的高亮 / 辅助，不进文字。

Web（`formatMeasurementPrompt`）：

```
<命令> · 第 <i>/<n> 步 <步提示> (<token>)[ Snap] :[ <目标>][<trailer>]        ← 定位拾取（positioning = true，缺省）
<命令> · 第 <i>/<n> 步 <步提示> :[ <目标>][<trailer>]                        ← 非定位拾取（positioning = false：两线夹角，0c0d9eb 起）
```

| 段 | E3D | Web | 对照 |
| --- | --- | --- | --- |
| 命令 | `pickPacket.prompt` | `command`（中文命令名） | 结构一致，文案按 §2 逐条对 |
| 步 | `pickType.prompt`（一词，如 `start`） | `第 i/n 步 <步提示>`（带计数） | **步计数是 Web 加的**；步提示按 §2 逐条对 |
| 拾取类型 token | `(<pick.prompt>)`，只有定位拾取有 | `(<token>)`，只有 `positioning` 的命令有（两线夹角传 `false`） | 一致（§3）；~~两线夹角那种 Graphics 拾取 E3D 不带 → **D1**~~ D1 已改（`0c0d9eb`） |
| ` Snap` 尾巴 | `intermediate` 开且定位拾取 | `significantSnaps` 开且 `positioning` | 一致；~~两线夹角 → **D1**~~ D1 已改 |
| ` WP` / ` Offset` | 工作平面 / 偏移开着时 | 无 | Web 无工作平面 / 偏移，不做（**D4**） |
| 冒号 | `applyToView` 缀 ` :` | ` :` | 一致 |
| 目标 | 无（图形高亮） | ` <目标>`（吸中项的名字，或 `等待捕捉（<已开点源>）`） | **Web 加的**（**D3**） |
| trailer | 无 | `；点空白取消当前点选` / `，单击完成` | **Web 加的**（**D3**） |
| 过滤器 | 不进提示（在 Positioning Control 表单里选） | 不进提示（在浮条设置弹层里选） | 一致（§4） |

## 2. 命令 × 步（模式 × 步）

下表 E3D 列按「Positioning Control 当前拾取类型 = Snap、Significant Snaps 开、工作平面 / 偏移关」写完整字串；Web 列同一状态（`(Snap) Snap`），目标段用 `等待捕捉（…）` 占位。

| E3D 命令（`edgpickpacket.pmlobj`） | 步 | E3D 完整提示 | Web 命令 / 步（`statusText`） | Web 完整提示 | 对照 |
| --- | --- | --- | --- | --- | --- |
| `measureDistance`（`'Measure distance'`，`stdPosition`） | 1 `start` | `Measure distance start (Snap) Snap :` | 距离测量 · 选择起点 | `距离测量 · 第 1/2 步 选择起点 (Snap) Snap : 等待捕捉（P-Point / Item 原点）` | 结构 / 顺序一致；`start` ↔ 选择起点；**E3D 实机 ✓**（golden §38 `P2-01-s1`：`prompt()` = `Measure distance start (Snap) Snap`，视口 `… Snap :`；三段 = pickPacket `Standard Distance Measure` / pickType.prompt `start` / pick.prompt `Snap`） |
| | 2 `end` | `Measure distance end (Snap) Snap :` | 距离测量 · 选择终点 | `距离测量 · 第 2/2 步 选择终点 (Snap) Snap : …；点空白取消当前点选` | 一致；trailer 是 Web 加的 |
| `measurePerpendicularToPoint`（`'Measure perpendicular distance'`，`stdPosition`） | 1 `start` | `Measure perpendicular distance start (Snap) Snap :` | 垂距测量 · 选择起点 | `垂距测量 · 第 1/2 步 选择起点 (Snap) Snap : …` | 一致（Perpendicular to 勾上时命令名跟着换，与 E3D 换包同义）；**E3D 实机 ✓**（§38 `P2-02-s1`：勾上那一下 pickPacket 立即换成 `Standard Perpendicular From Point Measure`，提示 `Measure perpendicular distance start (Snap) Snap :`；勾掉即回 `Measure distance start …`，`P2-02-off`） |
| | 2 `end` | `Measure perpendicular distance end (Snap) Snap :` | 垂距测量 · 选择目标线 / 面上的点 | `垂距测量 · 第 2/2 步 选择目标线 / 面上的点 (Snap) Snap : …；点空白取消当前点选` | E3D 只说 `end`，Web 说明了这一击的用途；**文案比 E3D 多**，结构一致 |
| `measureAngle`（`'Measure angle'`，`stdPosition`） | 1 `root of angle` | `Measure angle root of angle (Snap) Snap :` | 角度测量 · 选择角度顶点 | `角度测量 · 第 1/3 步 选择角度顶点 (Snap) Snap : …` | 一致（顶点先拾，golden G6 同序）；**E3D 实机 ✓**（§38 `P2-03-s1`：`Measure angle root of angle (Snap) Snap :`，pickPacket `Standard Angle Measure`） |
| | 2 `first point` | `Measure angle first point (Snap) Snap :` | 角度测量 · 选择第一边点 | `角度测量 · 第 2/3 步 选择第一边点 (Snap) Snap : …；点空白取消当前点选` | 一致 |
| | 3 `second point` | `Measure angle second point (Snap) Snap :` | 角度测量 · 选择第二边点 | `角度测量 · 第 3/3 步 选择第二边点 (Snap) Snap : …；点空白取消当前点选` | 一致 |
| `measureLineAngleArc`（`'Measure angle between lines'`，`stdGraphics`，`positioning = false`） | 1 `first line` | `Measure angle between lines first line :`（**无 token、无 Snap**：Graphics 拾取的 EDGPICK 没有 prompt，非定位拾取不加尾巴） | 两线夹角 · 选择第一条线 | `两线夹角 · 第 1/2 步 选择第一条线 : …`（`0c0d9eb` 前是 `… 选择第一条线 (Cursor) Snap : …`） | 步文案一致；~~**Web 多了 `(Cursor)` 与 ` Snap`** → **D1**~~ **D1 已改**：`statusText` 对两线夹角传 `positioning: false`，token 与 Snap 都不出；**E3D 实机 ✓ = D1 运行时实证**（§38 `P2-04-s1`：`prompt()` = `Measure angle between lines first line`，视口 `… first line :`；pickPacket `Standard Line Angle Measure`、pickType `Standard Graphics Pick`、pick `Graphics`、pick.prompt **unset**、`isPositionMode()` FALSE，而同一刻 `posCntrl.intermediate` 仍 TRUE——Significant Snaps 开着也不加尾巴） |
| | 2 `second line or plane` | `Measure angle between lines second line or plane :` | 两线夹角 · 选择第二条线或面（第一条：<标签>） | `两线夹角 · 第 2/2 步 选择第二条线或面（第一条：TUBI 轴线（…）） : …；点空白取消当前点选` | 步文案一致；「第一条：…」回显是 Web 加的（D3）；~~token / Snap → **D1**~~ 已改 |
| `measureLineAngle`（`'Measure angle between lines -'`，`gmfAngle.betweenLines`，两击 `first` / `second` 都只拾 `EDGE`） | 1 / 2 | `Measure angle between lines - first :` / `… - second :` | — | — | E3D 另一条只算数值不画弧的两线角命令，**不是 Measure 功能区那颗按钮**（见 D6）：调用方是三张设计表单的「Angle between two lines」菜单项，量到的 REAL 直接填进角度输入框。Web 不另做模式，数值口径由单测钉住 |
| —（E3D 无；Picking Control 偏移字段右键 `Measure Shortest`，golden MD §32） | 1 / 2 | — | 最短距离 · 选择第一项：点 / 线 / 面 · 选择第二项：点 / 线 / 面（第一项：<标签>） | `最短距离 · 第 1/2 步 选择第一项：点 / 线 / 面 (Snap) Snap : …` / `… 第 2/2 步 …（第一项：…）…；点空白取消当前点选` | **Web 增强**（决策 `d-619`），不计 parity |
| —（E3D 无：位置 / 标高用 Query） | 1 | — | 位置/标高 · 选择测量点 | `位置/标高 · 第 1/1 步 选择测量点 (Snap) Snap : …，单击完成` | **Web 独有**（方案 §2 #21） |
| —（E3D 无） | 1 / 2 | — | 高差测量 · 选择起点 / 选择终点 | `高差测量 · 第 1/2 步 选择起点 …` / `… 第 2/2 步 选择终点 …；点空白取消当前点选` | **Web 独有**（方案 §2 #21） |

Web 在进不了测量提示时的整句（E3D 没有对应，命令行就是空的）：`当前非测量模式` / `三维查看器未初始化` / `DTX 图层未初始化` / `拾取控制器未就绪` / `等待测量所需模型就绪…` /
`测量模式：未启用任何测量点源捕捉`（所有已开点源都被当前过滤器 × 类型挡住时也是它——E3D 过滤器不放行的点源等于没开）。

## 3. 拾取类型 token（括号里那一段）

E3D：`edgposcntrl.pmlobj` `loadPicks` 按 `pickTypes[1..7]` 的顺序建七种，每种调 `EDGPICKTYPE.set*` 写 `description`（表单里的名字）与 `pick.prompt`（token）。Web：`MEASUREMENT_PICK_TYPE_IDS` / `MEASUREMENT_PICK_TYPE_LABELS` / `measurementPickTypePromptToken`。

| # | E3D `description`（表单） | E3D `pick.prompt`（token，`edgpicktype.pmlobj`） | 取值 | Web label | Web token | 对照 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `Snap` | `Snap`（1757） | — | Snap | `Snap` | 一致 |
| 2 | `Distance` | `Distance[<pickTypesValue[2]>]`（1862；REAL 缺省字串） | 缺省 `0`，输入框 | Distance | `Distance[<distanceMm>]`（`formatPromptReal`） | 一致；数值都按 REAL 缺省字串出 |
| 3 | `Mid-Point` | `Mid-Point`（`edgposcntrl` 384 覆盖 `setProportion(0.5)` 的 `Proportion[0.5]`） | — | Mid-Point | `Mid-Point` | 一致 |
| 4 | `Fraction` | `Fraction[<pickTypesValue[4]>]`（1889，**原样**出输入值） | 缺省 `2`，输入框 | Fraction | `Fraction[<fraction>]`（原样，`formatPromptReal`；`e8ebc10` 前是 `Fraction[<trunc(fraction) ≥ 1>]`） | 一致（**D2 已改 `e8ebc10`**）：输入 `2.5` 两边都出 `Fraction[2.5]`，内核两边都 `int()` → 2 段（E3D `GMFLINE.fraction` 276 / Web `fractionAlongSegment`）；Web 落库不再归一（`normalizeMeasurementPickTypeValues` 只做 finite 兜底），输入框回显原值 |
| 5 | `Proportion` | `Proportion[<pickTypesValue[5]>]`（1835） | 缺省 `0.5`，输入框 | Proportion | `Proportion[<proportion>]` | 一致 |
| 6 | `Intersect` | `Intersection[<minor>]`（1808；`minor` = 第几次子拾取，prompt() 里 BLOCK 求值） | — | Intersect | `Intersection[<intersectOrdinal>]` | 一致（golden MD §13 / §35 实机 `[1] → [2] → [3]`） |
| 7 | `Cursor` | `Cursor`（1782；`setExact`） | — | Cursor（id `exact`） | `Cursor` | 一致 |
| — | `Angle`（`setAngle`，1915） | `Angle` | — | — | — | E3D `EDGPICKTYPE` 有这个类型，但 Positioning Control 的七种里没有 → Web 不做 |

运行时（golden MD §38 INIT 头块，2026-09-16 23:35）：`!!edgPosCntrl.pickTypeList()` = `Snap|Distance|Mid-Point|Fraction|Proportion|Intersect|Cursor`——恰好七项、顺序同上表、没有 Angle；缺省 `pickTypesValue[2]=0`、`[4]=2`、`[5]=0.5`（第 2 / 4 / 5 行「取值」列 ✓）；输入框格式 `distanceFmt.dp=2`、`integerFmt.dp=0`、`realFmt.dp=2`。七种 token 各自的提示串还没采（要在 Positioning Control 里逐个切类型，见 §8）。

## 4. 过滤器（不进提示）

两边过滤器都只出现在选择控件里：E3D `edgposcntrl.pmlobj` `picks[1..8]` = `stdAny` / `stdElement` / `stdAid` / `stdPline` / `stdPpoint` / `stdScreen` / `stdGraphics` / `stdExternal`，`description` 依次
`Any` / `Element` / `Aid` / `Pline` / `Ppoint` / `Screen` / `Graphics` / `External`；Web `MEASUREMENT_PICK_FILTER_IDS` / `MEASUREMENT_PICK_FILTER_LABELS` 同序同名（ADR 0060）。运行时 `!!edgPosCntrl.pickList()` = `Any|Element|Aid|Pline|Ppoint|Screen|Graphics|External`（golden MD §38 INIT 头块），八项同序 ✓；缺省过滤器 `Any`。「换过滤器提示字字不变」那八串还没采。
E3D 换过滤器换的是 `EDGSTATE.pick`（`setPickType` 里定位拾取走 `setPick(!!edgPosCntrl.pick)`，`edgstate.pmlobj` 262–296），`prompt()` 三段里没有过滤器；Web 同。唯一进提示的「过滤器痕迹」是 Web 目标段的 `等待捕捉（<已开且当前过滤器放行的点源>）`——这是 Web 加的（**D3**）。

## 5. 尾巴 / 前缀

| 项 | E3D | Web | 对照 |
| --- | --- | --- | --- |
| ` Snap` | `!!edgPosCntrl.intermediate`（Significant Snaps）开且定位拾取；`loadPicks` 末尾 `intermediate = true`，**缺省开** | `pickLayer.significantSnaps` 开（`DEFAULT_MEASUREMENT_PICK_LAYER` 缺省开）且 `positioning`（两线夹角不加） | 一致（缺省值也一致；两线夹角 D1 已改 `0c0d9eb`）；实机缺省 `intermediate=TRUE`、`activePlane=FALSE`、`offsetType=NONE`（golden §38），四条命令第 1 步的 ` Snap` 尾巴 / 两线夹角不加尾巴都已实采 |
| ` WP` | 工作平面激活 | 无 | **D4** 不做 |
| ` Offset` | `offsetType ne 'NONE'` | 无 | **D4** 不做 |
| `第 i/n 步` | 无 | 有 | **D3** Web 加 |
| `（第一条：…）` / `（第一项：…）` | 无 | 两线夹角 / 最短距离第二步回显已选项 | **D3** Web 加 |
| ` : <目标>` | 冒号后为空 | 吸中项的名字（`<noun> <label>`，如 `SCTN PLINE NA · Distance[100]`）或 `等待捕捉（…）` | **D3** Web 加 |
| trailer | 无 | `；点空白取消当前点选`（第 2 步起）/ `，单击完成`（标高） | **D3** Web 加 |

## 6. 拾取过程中的告警 / 消息（`!!alert.*` ↔ `pickPointMessage`）

> **出口（2026-09-16 `896fbbc`，golden MD §36）**：`pickPointMessage` 此前在 UI 上没有消费者——指针透镜只在未吸附时拿它做 subtitle，而未吸附时透镜不画，下面这一列 Web 文案其实一句都没显示过。
> 现在它画在 ViewerPanel 右下角提示条的**第二行**（第一行是 §1 的提示串），随下一次悬停命中 / 未命中被覆盖；E3D `!!alert.*` 一级的告警另走 `raiseMeasurementAlert` → toast（`v-snackbar`，warning 4.5 s / error 6 s）：
> 零距离（warning）、2,870 / 2,874（warning）、「No intersection between picked items」（warning，`9bbb501`）、「Unable to convert…」与两线夹角 / 三点角「An angular dimension could not be constructed…」（error）都接了（`14b0d4b`）；状态回显（已选第一项 / 求交已选）、Web 独有的拒收提示、未命中原因、P-Point 加载中 只在提示条第二行（决策 `d-343`）。

| 场景 | E3D（`edgpicktype.pmlobj` 等） | Web | 对照 |
| --- | --- | --- | --- |
| Perpendicular to：起点落在目标线 / 面上 | `!!alert.warning('Cannot draw dimension line. Perpendicular distance is 0')`（`gphmeasure.pmlfrm` 630）+ 尺寸重置 + 回 start | `Perpendicular distance is 0：起点已落在目标线 / 面上，画不出垂距尺寸（E3D：Cannot draw dimension line. Perpendicular distance is 0）；已回到第 1 步`（提示条第二行 + warning toast），草稿清空、不落记录 | 一致，Web 带原文；golden MD §36 实机 |
| Intersect：后一项与第一条线平行 | `!!alert.warning('Pick another line, last pick was parallel to first line')`（913–916 / 928–930，`(2,870)`），只丢这一击 | `请再选一条线：上一次拾取与第一条线平行（E3D 2,870 Pick another line, last pick was parallel to first line）`，只丢这一击 | 一致，Web 带原文 |
| Intersect：面 × 面 × 第三项无唯一交点 | `!!messageFile.warning(2,874)` + `return.clear()` + `numberOfPicks = 1`（843–847）——**文案在 message file 里，PML 源里没有** | `面 × 面 × 第三项没有唯一交点，求交已重置，请重新拾取（E3D 2,874）`，整包清空（`0c0d9eb` 前写「三个平面没有唯一交点」） | 行为一致；E3D 原文**未采**（**D5**）；~~第三项是线时 Web 这句「三个平面」是措辞偏离（golden MD §35 补采）~~ 措辞已改，第三项是线（线 ∥ 第一面）时也说得通 |
| Intersect：拾中项转不成线 / 面 | `!!alert.error('Unable to convert item into a line or plane for intersection (<type>). Select another item or escape to abort the operation')`（813）；Aid / Graphics 变体 778 / 796 / 821 | `所选项无法转成线 / 面参与求交，请改选其它项或按 Esc 取消（E3D: Unable to convert item into a line or plane for intersection）`，不消耗这一击 | 一致，Web 合成一句 |
| Intersect：与弧无交点 | `!!alert.warning('No intersection between picked items')`（887） | `所选项与弧没有交点，请改选其它项（E3D: No intersection between picked items）`，只丢这一击（弧还列在「求交已选」里） | 一致，Web 带原文（`9bbb501` 接了 ARC 操作数，golden MD §37 (1-b) 实机） |
| Intersect：面 × 面之后第三项是弧 | `ARC.intersection(PLANE, PLANE)` 不存在，`handle (2,874)` 接不住（841–848） | 走「转不成线 / 面」那句 error，不消耗这一击（两个面还在） | Web 取舍：E3D 这一路是未处理的 PML 错误，行为**未采**（新 **D7**） |
| Snap / Cursor：拾中元素给不出位置 | `!!alert.error('Unable to derive snap position of picked element (<type>)')`（438 / 582）；Aid 变体 408 / 554 | `当前未捕捉到已启用点源：…` / `请将光标靠近构件 P-Point 后再点击` / `当前数据源未提供该构件的 P-Point，无法登记测量点` 等（`buildMissReason`） | 语义对应，Web 按点源分句；E3D 是 alert 弹窗、Web 是提示条第二行（`896fbbc` 起才真显示） |
| 两线夹角 / 三点角造不出弧 | `alert.error('An angular dimension could not be constructed from the data selected')`（`gphanglemeasure.pmlfrm`，golden MD §22 / §30） | `两条线平行，画不出角度尺寸（E3D：An angular dimension could not be constructed from the data selected）；已回到第 1 步` / `线与面平行且不在面内…` / 三点共线 / 重合点 各一句 | 一致，Web 带原文并说明原因 |
| 两线夹角第一击不是线 / 第二击不是线或面 | E3D 拾取过滤器 `EDGE` / `FACET EDGE` 根本拾不到别的东西 | `两线夹角的第一击要拾中一条线（Graphics 边 / p-line / 轴线），请改选（E3D Angle 2 Lines 第一击只拾 EDGE）` / `…第二击要拾中一条线或一个面…` | Web 放行更多操作数（PLINE / 轴线 / P-Point / 设计点，§30 补采），拒收时说明 E3D 口径 |
| 已选第一条线 / 已选第一项 / 求交已选 | E3D 靠提示条 token 变化（`Intersection[2]`）与高亮，没有文字 | `两线夹角：已选第一条线 <标签>，再选第二条线或面` / `已选第一项…` / `求交已选 1. …；2. …，再选一项（Intersection[n]）` | **D3** Web 加 |
| P-Point 加载中 | E3D 同步读库，无此态 | `P-Point 正在加载，加载完成后再确认测量点` / `基本体与 PLINE 关键点正在加载…` | Web 独有（异步取数） |

## 7. 差异清单

| # | 差异 | 影响 | 建议 |
| --- | --- | --- | --- |
| **D1** | 两线夹角（`measureLineAngleArc`）在 E3D 是 `stdGraphics` 拾取：`positioning = false`、EDGPICK 无 prompt → 提示是 `Measure angle between lines first line :`，**没有 `(token)` 也没有 ` Snap` 尾巴**；Web 两线夹角~~照定位拾取的模板出 `(Cursor) Snap`~~ | 两线夹角的提示条多一段与这一击无关的信息（拾取类型对 Graphics 边 / 面不起作用：面永远取射线 ∩ 面、线的控制点由内核按类型派生但两线夹角只用线本身） | **已拍板（用户 2026-09-16 10:54）并改掉 `0c0d9eb`**：`formatMeasurementPrompt` 加 `positioning?: boolean`（缺省 `true`），`false` 时省掉 `(token)` 段与 ` Snap` 旗标，Web 加的段（D3）不动；`statusText` 对两线夹角两步传 `false`，三点角 / 距离 / 垂距照旧。单测 `pickLayerModel.test.ts` +1、`useXeokitMeasurementTools.test.ts` +1（Cursor × Significant Snaps 开：两步都不带 `(Cursor)` / ` Snap`，切回三点角即恢复）。目标名（冒号后）仍照拾中项出，拾取类型对它的影响不变。**实机 2026-09-16 12:32 采、13:09 复现**（golden MD §30「补采（12:32 / 13:09）」，`web-line-angle-live-06i-prompt-no-token-*`）：Cursor × Significant Snaps 全开，两线夹角两步都没有那两段，切回三点角即恢复 |
| **D2** | `Fraction[<v>]`：E3D 原样出输入值（`2.5`），~~Web 出 `trunc` 后的整数~~ **Web 也原样出（`e8ebc10`）** | 只在用户填非整数时可见 | ~~可不改：Web 的 `trunc` 与内核实际用的 `int(n)` 一致，提示更诚实；要严格照 E3D 就改成原样出~~ ~~2026-09-16 定为不改（决策 `d-228`）~~ **2026-09-16 15:5x 用户改口、改掉（`e8ebc10`，决策 `d-269` 取代 `d-228`）**。E3D 侧（判据不变）：`pickTypesValue[4]` 直接取 `text .input is REAL format !!integerFmt`（`edgpositioning.pmlfrm` 38，dp 0）的 `gadget.val`（`edgposcntrl.pmlobj` 1482），提示原样拼（`edgpicktype.pmlobj` 1889）、内核 `!fraction.int()`（`gmfline.pmlobj` 276）、重选拾取类型时 gadget 又按 dp 0 重显（`edgposcntrl` 1434）。Web 改法：`normalizeMeasurementPickTypeValues` 对 fraction 与 distance / proportion 同样只做 finite 兜底（非数字回缺省 2），不再 `max(1, trunc(v))`；`measurementPickTypePromptToken` 走 `formatPromptReal`（`2.5` → `Fraction[2.5]`、`3` → `Fraction[3]`）；内核 `fractionAlongSegment` 不动（本来就是 `int(n)`，`int(n) < 1` → 控制点投影，与 PML 循环不执行同口径）。三处口径：提示 = 输入框 = 原值，内核 `int()`——比 E3D 多自洽一处（E3D 重显走整数格式）。单测：`pickLayerModel.test.ts`（token 2.5 / 0.4 / 3，落库 '2.5' / 0.4 原样、'abc' 回 2）、`useXeokitMeasurementStyleStore.test.ts`（V9 读回 0.4 原样）、`MeasurementOverlayBar.test.ts`（输入 2.5 → store 2.5、回显 '2.5'）、`useXeokitMeasurementTools.test.ts`（提示 `(Fraction[2.5]) Snap :`，点棱 y = 4.2 吸 2 等分的 4.0 而非三等分的 4.1667，派生记号 ` · Fraction[2.5]`） |
| **D3** | Web 加的段：`第 i/n 步`、`（第一条 / 第一项：…）`回显、冒号后的目标名 / `等待捕捉（…）`、trailer、`已选…` / `求交已选…` 消息 | 结构不变，信息更多 | 保留为增强（决策 `d-444` 那一类 Web 取舍） |
| **D4** | ` WP` / ` Offset` 尾巴 | Web 没有工作平面 / 偏移定位 | 不做（方案 §0 非目标） |
| **D5** | `(2,874)` 的 E3D 原文在 message file 里，PML 源看不到；~~Web 那句「三个平面没有唯一交点」在第三项是线时措辞不准~~ | 文案 | Web 已改「面 × 面 × 第三项没有唯一交点，求交已重置，请重新拾取（E3D 2,874）」（`0c0d9eb`，`INTERSECT_MESSAGES.planesNoPoint`；单测 `intersectPickSession.test.ts` +1：面 × 面 × 线 ∥ 第一面 → 2,874 整包清空、文案不再含「三个平面」）。E3D 原文仍**等 E3D 在跑时采一次** |
| **D6** | E3D 还有 `measureLineAngle`（`gmfAngle.betweenLines`，`'Measure angle between lines -'`，两击都只拾 `EDGE`，只算角不画弧） | ~~Web 只做了 `radius2Lines`（画弧）那条；`design.uic` 里 `Angle 2 Lines` 按钮跑的是 `LINEANGLE`，两条包谁接这个命令要 E3D 在跑时核~~ **2026-09-16 静态核清，不必等 E3D**：`Angle 2 Lines` → `designViewMeasure('LINEANGLE')` → `gphViews.measure('LINEANGLE')`（`gphviews.pmlobj` 1301–1303）→ `GPHANGLEDIMENSION.edit('LINEANGLEARC')` → `EDGPACKET.defineMeasure('LINEANGLEARC')`（`edgpacket.pmlobj` 1089–1091）→ **画弧那条**。非弧包只有三张设计表单在用（`dbeelementangle.pmlfrm` 799 / `dbesrevolution.pmlfrm` 658 / `dbeloopedit.pmlfrm` 1716 的「Angle between two lines」菜单项，`defineMeasure('lineangle')`），量到的 REAL 回填表单的角度输入框——它**不进** Measure Angle 窗体（`gphAngleMeasure.setMeasure` 只收 `ARC`） | **不做**（Web 没有「把量到的角填进设计表单」这种入口，多一个模式在 E3D 侧没有对应物）；**数值口径已钉**：`betweenLines` 把参照线的拾中点投到过弧心的平面上，与 `radius2Lines` 把参照线平移到弧心是同一个操作，两者的角相等——`lineAngle.test.ts` +2（照 PML 81–103 独立实现 `betweenLines` 再逐组对数：共面 / 异面 / 拾另一侧 / 弧心在段外；以及唯一的差异——平行时非弧包 `handle any` 吞错返回 **0**，画弧那条与 Web 一样拒收） |
| **D7** | Intersect 里**面 × 面之后第三项是弧**：E3D 走 `!intersectData.intersection(!this.return[2], !this.return[3])`（`edgpicktype.pmlobj` 842），而 ARC 对象没有 `intersection(PLANE, PLANE)`——抛出的不是 `(2,874)`，那个 `handle` 接不住，错误往上跑（怎么收场要 E3D 在跑时看） | 极窄的一路：先拾两个面，第三击落在 ELBO / BEND 上 | Web 取舍（`9bbb501`）：按「转不成线 / 面」那句 error 拒收且**不消耗**这一击——两个面还在，改拾线 / 面照样求得出交点。E3D 侧行为**未采** |

## 8. 结论（对方案 §2 #19）

结构 `<命令> <步> (<拾取类型>) [Snap] :` 与 E3D `EDGSTATE.prompt()` + `applyToView` 一致；三条定位拾取命令（Measure distance / perpendicular distance / angle）的**每一步**、七种拾取类型的 **token**、
八个过滤器**不进提示**都逐条对上。Web 加的段（D3）不改结构；~~两线夹角多出的 `(token) Snap`（D1）是唯一一处 E3D 不会显示而 Web 显示的内容，待拍板~~ **D1 已拍板并改掉（`0c0d9eb`）**：两线夹角按 `stdGraphics`
非定位拾取出 `<命令> <步> :`，现在没有一处 E3D 不显示而 Web 显示的段（D3 的 Web 加段除外），改后的提示条已实机采过（golden MD §30「补采（12:32 / 13:09）」四态截图 + `records.json`）。D5 的 Web 文案同笔改掉；D6 2026-09-16 静态核清并结掉（`Angle 2 Lines` 走的是画弧包，非弧包是三张设计表单的取值入口，Web 不做；两者数值相等已由 `lineAngle.test.ts` 钉住）。
~~D2 2026-09-16 定为不改（决策 `d-228`：Web 落库即归一成整数，输入框 / 提示 / 内核同一个 n；E3D 原样回显非整数是它自己三处不一致的 quirk）。~~
**D2 2026-09-16 15:5x 用户改口、改掉（`e8ebc10`，决策 `d-269` 取代 `d-228`）**：Fraction 提示照 E3D 原样出输入值（`Fraction[2.5]`），落库不再归一，内核仍 `int()`——七种 token 现在字字与 E3D 相同。
余 D4（不做）与 E3D 原文 / 运行时对账。**2026-09-16 23:3x**：E3D 3.1 在跑（shadow，PID 11900），采集宏 `docs/verification/e3d-measurement-runtime-golden/capture-prompt-step.pmlmac` 已备——每步一调、读 `!!edgCntrl.state.prompt()` + 视口 inMode prompt + `!!edgPosCntrl` / `!!edgPositioning` 状态，APPEND 到 `e3d-prompt-capture.trace.txt`；首轮已把 §2 四条命令的第 1 步（含 **D1 运行时实证**）、§3 七项顺序、§4 八项顺序、§5 缺省尾巴状态采成 `observation`（golden MD §38）。仍是 `static_expectation` 的：各命令第 2 / 3 步、七种 token 的实际字串（D2 的 `Fraction[2.5]` 三处）、过滤器八串、Significant Snaps 关 / WP / Offset 尾巴、§6 全部告警原文（D5 的 2,874）——都要真实拾取或改 Positioning Control 设置，下一轮用同一支宏逐步采。
