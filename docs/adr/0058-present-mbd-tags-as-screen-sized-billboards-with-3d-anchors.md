---
status: accepted
---

# MBD 标签按屏幕定尺的 billboard 呈现：标签与引线配成一条记录、锚点留在管上、标签体按确定顺序让开尺寸数字

MBD V2 的 `label`（plant-mbd 的 connection / elbo / name / branch-name tag，以及其它生产者的文字标签）在自由相机三维视口里默认按**屏幕定尺的 billboard** 呈现，不再把求解器为单线轴测图排好的原位文字直接投到屏幕。适配层先把每条 `leader_line` 配进它的 `label`——按生产者的 id 约定 `<label id>:leader` 优先，否则按「引线起点 = 标签位置」配对，每条引线只用一次——配对后的引线不再单独成记录，标签与引线因此一起隐藏、一起选中、一起换位；再按 id 约定给标签分类（`:tag:connection:` 坐标卡片带圆点、`:tag:name:` 位号方框、`:tag:elbo:` 弯头药丸、`:tag:branch-name` 分支名药丸；非 plant-mbd 来源按文字：有 `X / Y / PE` 行的是卡片，其余方框），打成 `ExplicitLayoutInput.tag`。内核 `planTagBillboard` 按文字行数用 `theme.tag` 常量算出标签体（卡片 / 方框字高 11 px、药丸 10 px，行距 1.5，内边距 7 / 4 px）：标签体是图纸元素，**尺寸不随相机变**，而管体与三维尺寸随透视缩放；锚点是引线目标（没有引线时是求解器的标签位置）这个**三维点**，标签体上的每个顶点都是「三维锚点 + 屏幕偏移」，相机动时整块刚性跟随、引线终点始终留在管上。首选位沿管外方向（`away`：只在该点恰有一条尺寸的尺寸界线扎根时由尺寸给出，否则取求解器自己的引线方向）叠加向上偏置，像图纸引出线一样挂在管体上方；引线从锚点连到最近的体边。

放置是视口级的一遍确定性 pass（`placeTagBillboards`，在成对去重之后、移动式避让之前）：其它可见标签（尺寸数字、平面标注）是障碍，标签按卡片 → 方框 → 药丸、同类按 id 依次取第一个既不压障碍也不压已放标签的候选位（绕首选方向 0 / ±30° / ±60° / ±90° / ±135° / 180°，再放大 1.6 倍 standoff；整块在屏内的候选位排前面），全部被占则回首选位——同一视图两次结果相同。分级显示沿用 S3 的三级口径并新增 `detail` 级：坐标卡片与位号任何距离都显示，弯头药丸从来源字高投影到 `sourceTextHeightMinPx` 起显示（`secondary`）、角度行到 `sourceTextHeightMaxPx` 才出现，分支名、坡度标记、skew 辅助线 / 文字都是 `detail`（`lodHidden = 'detail-far'`）。标签体是新的 `scene-fill` 图元（凸多边形三角扇，画在所有描边之下，投影成一条闭合 path 保持场景↔投影图元 1:1），颜色 / 线宽由 `SceneTone` 走 `theme.tag` 调色板，hovered / selected 仍用角色高亮色，SVG 导出同样输出填充。文字、行数、锚点语义、引线所指的管上点全部是来源的；调试开关 `?mbd_3d=0`（尺寸面板同名勾选）同时剥掉 `tag` 与 `dimension3d`，标签回到原位平面文字。

不做的：标签体不避让管件几何（卡片可能压在阀体上），也不避让三维尺寸线本身——两者都需要模型包围盒或线段级碰撞，留给 S4 / 后续（**2026-09-13 由 ADR 0059 补上**：宿主交出构件包围盒角点、内核投影成凸包，连同其它布局的描边一起作为障碍，候选位扩到四圈且不出屏）；不改写契约 `text`；不新增契约字段。

被否决的替代：把标签也做成三维平面里的文字（多行坐标块在透视下不可读，图纸上的引出块本来就是与视向无关的平面元素）；沿用原位平面文字只加避让（原位文字和外移后的尺寸线相压，且引线与文字分属两条记录，换位后引线不跟）；让 plant-mbd 排标签位置（求解器排的是单线轴测图的位置，与自由相机无关，且要重录 golden）；标签体随相机缩放（远景缩成一点、近景压满屏，与「图纸元素定尺」相悖）。

依据：用户 2026-09-12 13:30 参考图（端点坐标块 + 引线、位号方框、标高）与 14:02「三维尺寸标注，不是投影」；效果图规则 6 `docs/design/mbd-annotation-mockup-2026-09-12/README.md`；PRD `docs/plans/2026-09-12-mbd-annotation-reference-style-prd.md` §7 AC5 与 §9.2；ADR 0057（长度尺寸的三维呈现，本条与它共用 `mbd_3d` 开关与 S3 分级）；协同决策 d-438（架构分层不变）。落地：`kernel/layout/tagBillboard.ts`、`kernel/viewport/layoutViewport.ts`（放置 pass）、`kernel/types.ts` / `theme.ts`（`ExplicitTagInput`、`SceneFill`、`SceneTone`、`theme.tag`）、`viewport/scenePainter.ts`（fills 绘制对象）、`export/svgOverlay.ts`、`adapters/mbdV2ExternalAnnotations.ts`（`pairLeaders` / `classifyTag` / `awayFromPipe`）、`useMbdExternalSync.ts`（`mbd_3d`）。实机验证：`docs/verification/mbd-3d-dimension-presentation-2026-09-12/`「标签 billboard」段。
