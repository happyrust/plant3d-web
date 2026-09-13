---
status: accepted
---

# 尺寸描边按胶囊 SDF 解析抗锯齿绘制：圆头接头、1 个设备像素的羽化边，实心 / 羽化两遍经近平面常量深度去重；文字笔画 1.8 px、药丸字高 11 px

尺寸视口里每一段描边（尺寸线、尺寸界线、引线、标签边框、LFF 字形的每一笔）仍是画家 `viewport/scenePainter.ts` 展开的一块屏幕空间四边形（ADR 0057 之前的约定：设计空间锚点 + 像素偏移，GL_LINES 画不出真实线宽），但从 2026-09-14 起四边形**向四周多伸出半个线宽 + 一个羽化宽**，片元着色器把它当成一条**胶囊**着色：到线段的距离 d 由沿向 / 横向坐标算出（两端伸出的部分就是圆头，于是相邻两笔在接头处圆润相接、不再有平头对平头的外角缺口和内角叠块），覆盖率 = clamp((w/2 + f/2 − d) / f, 0, 1)，f 是一个**设备像素**折成的 CSS px（`uFeatherPx = 1 / dpr`，2× 屏上 0.5 px）。这是解析抗锯齿：不依赖 MSAA——实机核出选中构件走 OutlinePass 那条路径时整帧渲染进无多重采样的 render target（`gl.SAMPLES = 0`），此前文字就是在这一档下全是锯齿。SVG 导出本来就是 `stroke-linecap="round" stroke-linejoin="round"`，视口至此与它一致。

**两遍、同一份几何、同一个深度**。同一套顶点缓冲挂两个 Mesh：`dimension-scene-lines`（实心遍，`uPass = 0`，只留覆盖率 ≥ 0.999 的片元，engineering 下不透明、inspection 下按 `batchAlpha` 混合）和 `dimension-scene-line-edges`（羽化遍，`uPass = 1`，只留覆盖率 < 0.999 的片元，始终混合，renderOrder 紧随其后、在全部实心之后画）。两遍都用 `gl_FragDepth` 写一个**窗口空间常量**深度——描边 1e-5、三维文字的白边 2e-5——并以 `LessDepth` 测试：对模型永远通过（模型片元离近平面 0.1 mm 起深度就 ≥ 2e-4，对数深度下 ≥ 0.03），所以工程 overlay「尺寸在模型之上全画」的约定不变；对**自己**却只通过第一次——同一层的第二个片元深度相等、LESS 失败。于是圆头接头处重叠的两块四边形、尺寸线压着自己的尺寸界线、一条弧线上几十段的每个接头，每个像素都只着色一次：inspection 下 α 0.65 / 0.35 的记录不会在接头处叠成一串深色珠子（旧画家在 α < 1 时接头就是这样的斑点）。羽化遍在实心已画过的像素上被挡掉（不会把实心边缘再抹深一层），羽化与羽化之间同样先到先得（取的是先画者而不是最大覆盖率——接头处偶有一两个像素略浅，可接受）。白边放在更远一层：字形实心与羽化都能压过它，它压不过字形。为什么用 `gl_FragDepth` 而不是在顶点着色器里改 `gl_Position.z`：三维（framed）文字一段的两端 w 不同，插值出的 z/w 在 24 位深度里差一两个单位，去重靠的相等就破了，实测出现随机斑点；片元里写字面量则逐片元完全一致。

**主题**（用户 2026-09-14 拍板，与解析抗锯齿一起）：`textStrokeWidthPx` 1.5 → **1.8**（标签 / 卡片 / 药丸文字与屏幕文字的笔画；边缘羽化后 1.5 px 的 10–13 px 字显得单薄），`tag.pillTextHeightPx` 10 → **11**（弯头角度 / 高程药丸的字高与卡片、位号框一致；10 px 在框旁边读起来太小）。三维尺寸数字仍 2 px + 1.4 px 白边，尺寸线仍 1.2 px。

**不做的**：不换成 MSDF 纹理字体（要新的文字管线、字体图集与中文覆盖，SVG 也要另走一套，LFF 笔画字体的 CAD 味就没了）；不给 EffectComposer 的 render target 开 `samples`（那是整帧管线与性能的事，且描边抗锯齿不该依赖它）；不做逐接头的扇形三角剖分（胶囊 + 深度去重用两遍就把接头做对了，几何量不变）；不改内核、布局、命中索引与 SVG。

**被否决的替代**：只在羽化遍开混合、实心遍不写深度（接头处羽化叠加成珠子）；用模板缓冲去重（DtxViewer 建上下文 `stencil: false`，且深度已够用）；在 α < 1 时也让接头叠加（旧画家的表现，正是要去掉的）；把羽化做成 MSAA 依赖（`antialias: true` 在 OutlinePass 路径上不生效）。

**验证**：`scenePainter.test.ts` +1（两遍共享几何、renderOrder 顺序、深度状态与常量、`uPass`、羽化宽随 dpr、白边落到第 1 层）与既有用例更新（四个绘制对象、实心遍 engineering 不透明 / 羽化遍始终混合）、`theme.test.ts`、`createDimensionSystem.test.ts`（四个子对象）；`npx vitest run src/dimension src/composables/useMbdExternalSync.test.ts` 59 文件 / 344 通过；eslint 0；type-check 本改动 0。实机（BRAN 24381_145018，live gen-model `:18122`，真实 Chrome + RX590 2× DPR，OutlinePass 路径无 MSAA）：`docs/verification/mbd-3d-dimension-presentation-2026-09-12/README.md`「文字绘制」小节，同位置 3× 放大前后对照——坐标卡片、三维数字 `758.89`、弯头药丸——以及 inspection 下 `758.89` / `2760.31` 从「浅灰带深色斑点」到「均匀浅灰」的前后。着色器调试过程里逐项可视化过四边形几何、覆盖率、沿 / 横坐标、半宽、羽化宽与插值 w（均正确），最后定位到 z/w 插值噪声破坏去重相等这一处。

依据：用户 2026-09-14 00:5x 要求「把文字的绘制改得更清晰」，01:0x 拍板「A + B 一起做」（A = 解析抗锯齿 + 圆头接头 + 深度去重，B = 笔画 1.8 px、药丸字高 11 px）。相关：ADR 0057（三维标注、白边）、ADR 0058（标签 billboard）、ADR 0061（inspection 淡化：engineering 下实心遍 / 箭头 / 填充仍不透明，羽化遍例外）。落地：`viewport/scenePainter.ts`（着色器、两个描边材质与 Mesh、`strokeLayer` 属性、`resize(…, pixelRatio)`）、`viewport/dimensionViewport.ts`（把 `projector.dpr` 传给画家）、`kernel/theme.ts`（两个主题值）。
