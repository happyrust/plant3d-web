# E3D 渲染效果复刻原型（SGL DX11 口径）

> 2026-09-20。代码：`src/viewer/e3dLook/`；演示页：`/e3d-look-demo.html`（dev 下直接开，不进生产构建）。
> 逆向依据：AVEVA E3D 2.10 / 3.1 的 `sglDx11.dll`（DXBC 反汇编 + ida-bridge 反编译），完整报告在
> `D:\ida_scratch\plant3\render\REPORT-2026-09-20-E3D渲染管线分析-第一轮.md`（仓外）。

## 1. E3D 三维视图是怎么画出来的（结论）

- `core.dll` / `Core3D.dll` 不着色。Core3D 只把几何变成「图形段」，通过 `SGL_*` 动态绑定 API 把**颜色索引 / 半透明 / 边线 / 表示法**交给 SGL（Scene Graph Library）。
- 真正的像素来自 SGL 的 DX11 后端 `sglDx11.dll`：前向一趟 Blinn-Phong + 灰度环境反射，MRT 同时输出屏幕面法线与线性深度；随后 HBAO → 双边模糊 → HLR 边线 → `colour × HLR × AO` 合成，背景纵向渐变。2.10 与 3.1 公式一致，3.1 多 FXAA。
- 单盏「头灯」（`LightEyePos = (0,0,1)`，眼空间 +Z），无衰减、无阴影、无 gamma / tonemap。

## 2. 实体着色公式与默认值（`SglLookMaterial`）

```
L = normalize(LampDir)   V = normalize(眼 − p)   N = normalize(n)   H = normalize(V + L)
rgb = colour · (Ka + Kd · max(N·L, 0))
    + Ks · pow(max(N·H, 0), Kse) · max(N·L, 0)      // 白色高光，不乘物体色
    + Kr · env(reflect(−V, N)).rgb                  // 环境立方体贴图，逐通道（3.1 dxbc_044；贴图本身是灰度）
a   = colour.a                                      // 半透明 = 1 − 百分比/100
```

**环境立方体贴图**（`sglEnvCube.ts`，2026-09-20 第三轮接入）：sglDx11 3.1 `.data` 里内嵌的 DDS（128²×6 面、B8G8R8A8、无 mip、
灰度「摄影棚」环境）就是 `gEnvTexture`，六面按 +X −X +Y −Y +Z −Z 导出为 PNG 放在 `public/texture/e3d/sgl31-envcube/{px,nx,py,ny,pz,nz}.png`，
`loadSgl31EnvCube()` 装成 `CubeTexture`（双线性、无 mip、`NoColorSpace`、不翻 Y，同 D3D `samLinear` 直采）。
像素着色器把 Z-up 世界的反射向量换成 `(R.x, R.z, −R.y)` 再 `texCUBE`（`sample r2.xyz, r3.xzwx` + `r3.w = -r3.y`），
本项目 DTX 场景也是 Z-up（`camera.up = (0,0,1)`），所以 `uEnvRot = envCubeRotationForUp(up)` 用同一换法；没贴图时退回天/地两段灰度兜底。

| 参数 | 默认 | 来源 |
|---|---|---|
| Ka | 0.5 | `CSglSceneLightParams::CSglSceneLightParams()`（sglDx11 3.1 @0x1005a1b0） |
| Kd | 0.8 | 同上 |
| Ks（HLSL 偏移 712） | **0.3** | C++ `Specular`；cbuffer 填充函数 `sub_1000B970` 按名对写，不是 memcpy（第二轮修正，原写 0.35） |
| Kr（HLSL 偏移 716） | **0.35** | C++ `Reflection`；乘环境立方体贴图采样（第二轮修正，原写 0.3） |
| Kse | 64 | 同上 |
| LightEyePos | (0, 0, 1) | 同上；上传前左乘视图逆矩阵 3×3 → 世界空间，即**头灯**随相机转（第二轮坐实） |

另有三套策略（`SGL_LIGHT_STRATEGIES`）：`default`；`flat70`（Ka=0.7，不打光）；`unlit`（Ka=1.0，原色，给辅助线 / 文字 / 手柄）。

**E3D 3.1 出厂视图设置会覆盖策略 1**（`SGL_E3D31_VIEW_DEFAULT_LIGHT`）：PML `gphviewopt.default()` 的
`brightness 0.7 / colourDepth 0 / reflection 0.8 / mirrorEffect 0 / spotSize 0` 经 VIEW 属性 79..83 →
`SGL_set_view_attribute_real(61..65)` 写进 Ka/Kd/Kr/Ks/Kse。也就是未改设置的 E3D 3.1 没有漫反射和高光，
`rgb = 0.7·c + 0.8·env(reflect(−V,N))`，体积感全靠内嵌的灰度环境立方体贴图（`D:\ida_scratch\plant3\render\envcube\sgl31_envcube.dds`）。
上表的 C++ 默认值只在 PML 那条路径没跑时生效——本机那台经修补脚本启动的 E3D 就是这种情况（§5.1）。

**预设**（`sglLookPresets.ts`，`SGL_LOOK_PRESETS`）把两套口径打包，ViewerPanel 与演示页都按它切：

| 预设 | 光照 | 边线 / 伪阴影 / 渐变 | 背景 |
|---|---|---|---|
| `e3d31-factory`（**默认**）「出厂 E3D 3.1」 | `SGL_E3D31_VIEW_DEFAULT_LIGHT` {0.7, 0, 0, 0.8, 0} | 全开 | grey #828282 在上 → 白在下（t 0.233→0.9） |
| `sgl-machine`「本机真机」 | `SGL_DEFAULT_LIGHT` {0.5, 0.8, 0.3, 0.35, 64} | 全关 | 纯灰 #828282 |

两套都采同一张环境立方体贴图（贴图在 sglDx11 里是固定的，只是 Kr 不同）。`applySglLookPresetToPipelineParams` 只动开关与背景色，不碰 HBAO / HLR 数值。

### 2.1 元素颜色 / 材质（`pdmsColourTable.ts` + 显示主题 `e3dFactory`）

- E3D 没有「材质」，只有**颜色索引 + 半透明**；颜色索引查 PDMS 颜色表。`pdmsColourTable.ts` 由逆向出的
  `e3d31-colour-table.json` 生成（365 项：1..16 基本色、17..272 调色板 + 61 个名字覆盖、296/298..303 固定辅助色、305..365 字典色；
  hex 按 `ColourTableManager` 的 `(int)(x·255)` 截断）。`pdmsColourHex('lightgrey' | 271 | 'pdms:lightgrey')`。
  **PDMS 色名与 CSS 不是一套**：PDMS lightgrey = #bdbdbd（CSS #d3d3d3）、grey = #828282（CSS gray #808080）、red = #bc0000、orange = #ffbe00。
- 出厂图形颜色（`gphcolopt.pmlobj .default()`，`E3D_GRAPHICS_COLOUR_DEFAULTS`）：Add element / Visible = **lightgrey**，CE yellow，active orange，
  aids blue，highlight white，tracing magenta，背景 grey；Design 模块 **`autoColour = false`**（只有 Spooler 预置 Spool cyan / Field green 两条规则）。
  所以没配自动着色规则的 E3D 把所有元素画成一色 lightgrey——§5.1 那台真机就是这样。
- web 侧落法：`model-display.config.json` 新增显示主题 **`e3dFactory`（「E3D 出厂」）**，只有一条 `baseMaterial: { color: 'pdms:lightgrey' }`
  （`ThemeConfig.baseMaterial` 是本轮新加的字段：nounAccents / disciplineMaterials / owner 覆盖都没命中时用它，压过类型基色；`instanceConfigs`
  的按元素覆盖仍最高，对应 E3D 对单个元素 `COLOUR`）。`materialConfig` 的颜色字符串新增 `pdms:<名|号>` 写法，查不到落兜底色而不是交给 three 当 CSS 名。
- 联动：开「E3D 外观」/ 切预设时显示主题自动切到预设的 `displayTheme`（两套预设都是 `e3dFactory`），并记住之前的主题（`dtx_look_prev_theme`）；
  关 E3D 外观时若主题还是它就切回去。E3D 外观开着时手动点「E3D 专业色」等其它主题不受干扰（要 E3D 光照 + 专业配色就这么用）。
- 选中 / CE 高亮（§5.5）：E3D 外观开着时按 `E3D_GRAPHICS_COLOUR_DEFAULTS` 染色——最近一次选进来的那批元素是 **CE = yellow**，更早追加选中的是
  **highlight = white**，整体染色、没有描边（E3D 没有 OutlinePass 那种轮廓）；关掉 E3D 外观回到 web 自己的品红整体染色 + OutlinePass 描边。
  `SelectionManager` 新增 `primarySelectionColor`（null = 不区分，全部用 `selectionColor`），`DTXSelectionController.setPrimarySelectionColor()` 透传。
- 未做：项目自定义的 autocolour 规则要真机导出 `gphcolopt` 选项文件再翻成主题规则。

## 3. 后处理链（`SglLookPipeline`）

| 步 | 做法 | 参数（默认） |
|---|---|---|
| 法线/深度 | `overrideMaterial`（或 DTX 这类 provider 材质自己出）：rgb = `normalize(cross(dFdx(viewPos), dFdy(viewPos)))`（面法线，同 sglDx11 MRT1），a = 线性深度；背景清成哨兵 **1e18**（`SGL_BACKGROUND_DEPTH`，同 sglDx11，`clearBufferfv` 直写）；RGBA32F | — |
| HBAO | NVIDIA HBAO 法线模式，参数名同 sglDx11 | `E3D31_HBAO`（= 3.1 硬编码，§5.6）：R **392.7327**（场景单位 mm；ViewerPanel 按米 ×0.001）、8 方向、**4 步**、AngleBias **30°**、Attenuation **0.2**、Contrast 1.25 |
| 模糊 | 深度感知可分离模糊，权重 exp(−r²·Falloff − (Δz·s)²)（同 sglDx11 dxbc_003） | 半径 **12** px、Falloff = 1/(2·((R+1)/2)²) = 0.01183；锐度 `blurSharpnessAuto`（默认开）= **16 / (本帧深度范围 / 2)**，深度范围 = 可渲染 Mesh 包围盒 ∪ `extraSceneBounds`（DTX 层）在眼空间的 [近, 远]；关掉则用固定 `blurSharpness` |
| HLR | 逐句照 sglDx11 HLR PS（§5.8 / §5.9）：「有标记」= 几何且参与边线（法线纹理 .w bit0 ↔ 这里法线长度 1 / 0.5）；只看右 / 下邻居；① 中心无标记：邻居有标记且（中心是背景 或 dC−dN > 50）→ 边；② 中心有标记、邻居无标记：邻居是背景 或 dC−dN < −50 → 边；③ 都有标记：\|Δd\| > 50 且左/上也有标记且 \|dot(normalize(dC−dP, h), normalize(dC−dN, −h))\| < 0.9999（h = 1000·像素步长）→ 边；④ \|N·N′\| < 0.6 → 边。采样档位 = MSAA 采样数（§5.7）：法线/深度与 HLR 通道按 `sglHlrSupersampleGrid()` 超采样（4 → 2×2），邻居仍取 1 个屏幕像素远 | 50 mm、0.9999、1000（深度 mm；米场景 ×0.001）、0.6、边线黑；`translucentEdges` ON（半透明参与）、`handleEdges` OFF（`userData.sglEdges === false` 的辅助对象不参与） |
| 合成 | `colour × HLR × AO`；HLR 对本像素的 kx×ky 个子像素取平均（= sglDx11 MSAA 版 HLR PS 的 Σ/N）；背景 `mix(top, bottom, t)`，`t = mix(gradientBottomT, gradientTopT, uv.y)` | 按 E3D 3.1 D2D 渐变：上 = 背景色 grey #828282、下 = 端色白（端色未设时 HLS 亮度拉满 → 任何背景色都得白），t 顶 0.35/1.5 ≈ 0.233 / 底 1.35/1.5 = 0.9 → 屏幕上 #9f9f9f→#f2f2f2（第三轮已对齐） |
| 抗锯齿 | `aa.mode`：'msaa' = 颜色通道用 `samples` 倍 MSAA 目标（three `WebGLRenderTarget.samples`，截到 `maxSamples`）+ 上述 HLR 超采样；'fxaa' = 合成后再过 three 的 FXAA 3.11（HLR 档位退回 1）；'none' | 出厂 **msaa 4**（`Sgl_View_Parameters` +780；`gphviewopt antiAlias = true(4)`）；FXAA 与 MSAA 互斥（+764） |
| legacy | `_legacy_mode`：全部效果关、纯色背景（HLR 档位 1；MSAA 由视图参数管，不受影响） | — |

## 4. 怎么跑

```powershell
npm run dev                       # 然后打开 http://127.0.0.1:3101/e3d-look-demo.html
# URL 开关：?view=iso|front|top  &preset=factory|machine(缺省 factory)  &envcube=0(反射退回解析兜底)
#          &hlr=0  &ao=0  &gradient=0  &aa=0|fxaa|2|4|8(缺省随预设：出厂 4× MSAA)  &legacy=1  &keep=1(保留绘制缓冲便于截图)
#          &translucentEdges=0(半透明房间盒不画边)  &handleEdges=1(左前方蓝色辅助球也画边)
```

右侧面板可切预设、开关环境立方体贴图，实时改 Ka/Kd/Ks/Kr/Kse、兜底天/地亮度、策略、房间半透明、HLR/AO/背景参数（含渐变 t 区间）。

主界面 ViewerPanel：`?dtx_look=sgl` 开 E3D 外观，`dtx_look_preset=factory|machine`（缺省 factory），
子开关 `dtx_look_hlr / dtx_look_ao / dtx_look_gradient / dtx_look_aa`（`0` 关，缺省随预设）；同名 localStorage 键记住上次选择。

单元测试：`npx vitest run src/viewer/e3dLook`（若 `node_modules` 是 junction，改用
`node <真实路径>/node_modules/vitest/vitest.mjs run src/viewer/e3dLook`，否则 vitest 双实例会报「No test suite found」）。

## 5. 已验证（2026-09-20）

- `vitest`：`src/viewer/e3dLook/sglLookMaterial.test.ts` 6/6（默认常量、setLight 往返、半透明换算、着色器公式骨架、HLR 判据）。
- `type-check`：新模块 0 新增错误（基线外只剩 4 条与 worktree 路径相关的既有错误，非本模块）。
- 无头 Chrome（SwiftShader）对 dev 构建的演示页六种变体截图 + 像素统计：无 console error；HLR 开/关暗像素 6.5% vs 3.7%；AO 开/关平均亮度 0.261 vs 0.277；背景渐变顶/底不同色；legacy 纯色；深度附件 RGBA32F。

## 5.1 与本机 E3D 3.1 真机同视角对参（2026-09-20）

- E3D 侧：非提权起一个 AMS Design（`E:\reverse\e3d\launch_ams.bat`），经 `E3DBootstrap.QueueThreadedDirectMacroFromHost` 送 PML：
  `=24381/145018`、`!!gphviews.views[i].direction = (0.57735, 0.57735, -0.57735)`（= 「Iso 3」，`designviewenablearf.pmlcmd` 里的常量）、`AUTO CE`、再 `/*` 去掉 CE 高亮；PrintWindow 截 3D 视图子窗口。
  顺带坐实：**E3D 3.1 的普通「3D View」是 SGL（sglDx11）**，ARF/AVP 是「Graphical Explorer」那扇单独的窗（`enableexternalgeometry = TRUE`）。
- web 侧：同一 BRAN、同一方向（`camera.position = center − dir·dist`，fov 30），`show_refno=24381_145018&dtx_look=sgl&dtx_grid=0`。
- 真机观察（这台的图形设置）：背景纯灰 **(130,130,130)**；**没有边线、没有 AO、没有抗锯齿**；管子横截面亮度 94 → 228（暗/亮 ≈ 0.41），与公式 `c·(0.5 + 0.8·N·L)` 在 N·L 从 0 到 1 的 0.5/1.3 ≈ 0.38 吻合。
- 这台的口径现在是「本机真机」预设（`sgl-machine`）：HLR 关、AO 关、渐变关、背景由管线直写 #828282（`useSceneBackground:false`，避免 ACES/曝光把灰抬到 162）；ViewerPanel 默认已改为「出厂 E3D 3.1」预设（§5.3）。
- 仍差的是**元素颜色**：E3D 这台画的是浅灰（无颜色规则时的默认色），web 走 `materialConfig` 的按专业配色（PIPE 粉）。要连颜色一起对上得引入 E3D 的颜色表 / 自动着色规则，另开一题。
- 证据：`D:\ida_scratch\plant3\render\prototype-shots\match\compare-crop.png`（E3D | web sgl | web sgl noAO | web pbr）、`e3d\e3d-bran-iso3.png`、`match\web-*.png`、`match\match-report.json`。

## 5.2 第二轮逆向补齐（2026-09-20，详见 `D:\ida_scratch\plant3\render\REPORT-2026-09-20-E3D渲染管线分析-第二轮.md`）

- **注意 §5.1 那台真机不代表出厂外观**：它由修补脚本直接建图形文档，没跑 PML `gphviewopt.applyToView`，所以边线 / AO / AA / 渐变全关、光照落在 SGL C++ 默认值。出厂 E3D 3.1 是：边线 ON、伪阴影(HBAO) ON、AA 4×、渐变 ON、背景 `grey`、光照 `{0.7, 0, Kr 0.8, Ks 0, Kse 0}`。
- 颜色表复原：`D:\ida_scratch\plant3\render\e3d31-colour-table.json`（365 项，core.dll `FWSCOL` 装填 + DruidNet `ColourTableManager` 字典）。背景 `grey` = #828282（= 真机 130,130,130），新元素默认 `lightgrey` = #bdbdbd（真机管子暗边 94 = 189×0.5 ✓），CE 高亮 yellow、辅助 blue、highlight white。
- HBAO 默认：`R 392.73 mm、8 方向、4 步、AngleBias 30°、Attenuation 0.2、Contrast 1.25`；双边模糊 `半径 12、Falloff 0.01183、Sharpness (16/(深度范围/2))²`；HLR 采样档位 = MSAA 数（默认 4）。
- 背景渐变（3.1 用 D2D）：上 = 背景色、下 = 端色，渐变线从视口上方 0.35H 到下方 0.15H（可见 t∈[0.23,0.9]）；端色未设时 = 背景色 HLS 饱和度×0.1、亮度拉满 → 灰背景渐到白。§3 表里的 `#2b4a6e→#a9bccf` 是猜的，应改为 grey→white。
- 本轮已改代码：`SGL_DEFAULT_LIGHT` Ks/Kr 修正 + `SGL_E3D31_VIEW_DEFAULT_LIGHT`（`vitest` 6/6，type-check 无新增）。

## 5.3 第三轮：按出厂 E3D 3.1 落地（2026-09-21）

- 接入环境立方体贴图：`sglEnvCube.ts` + `public/texture/e3d/sgl31-envcube/`；`SglLookMaterial` / `DTXMaterial`（SGL 分支，program key → v13）都改成
  `Kr · textureCube(env, uEnvRot · reflect(−V, N)).rgb`，没贴图时退回天/地兜底。`DTXLayer.setSglEnvMap()`，ViewerPanel 初始化时预拉一次贴图（六张 PNG 共 27 KB）。
- 预设 `sglLookPresets.ts`（§2 表），默认 `e3d31-factory`：ViewerPanel 开 E3D 外观即边线 / 伪阴影 / 渐变全开 + {0.7,0,0,0.8,0}；面板加「出厂 E3D 3.1 / 本机真机」两键与「渐变」子开关。
- 背景渐变按 §5.2 对齐（`E3D_BACKGROUND_GREY`、`E3D_GRADIENT_TOP_T/BOTTOM_T`、`sglDefaultGradientEndColour`），`createDefaultSglPipelineParams()` 的猜测色已替换。
- 验证：`vitest src/viewer/e3dLook` 15/15；`type-check` 基线外仍只有既有 4 条 worktree 路径错误；ESLint 通过。
  无头 Chrome（SwiftShader）对 dev 构建的演示页 7 种变体截图 + 像素统计 13/13 通过：无 console error；六面贴图确有被拉取并套到材质；
  出厂预设背景顶 (159,159,159) / 底 (242,242,242)（= mix(#828282, 白, 0.233 / 0.9)），关渐变与真机预设为纯 (130,130,130)；
  贴图开/关几何区平均亮度 0.464 vs 0.590（反射项确实来自贴图）；出厂预设暗像素 2.86%（边线）vs 真机预设 0%。
- **未验证**：立方体贴图的朝向（六面对世界方向的映射）只按 dxbc_044 的 `(x, z, −y)` 换法复刻，还没在未修补的 E3D 3.1 上同视角对参（§6.2）。

## 5.4 第四轮：元素颜色按 E3D 颜色表（2026-09-21）

- `pdmsColourTable.ts`（生成，365 项 + 61 色字典 + 出厂图形颜色常量），`materialConfig` 支持 `pdms:` 颜色引用与 `ThemeConfig.baseMaterial`，
  `model-display.config.json` 新增主题 `e3dFactory`（全 lightgrey #bdbdbd），`DisplayTheme` 加 `e3dFactory`，ViewerPanel 主题按钮加「E3D 出厂」
  （原「E3D」改名「E3D 专业色」），E3D 外观预设联动切主题并可回退。详见 §2.1。
- 验证：`vitest`：`pdmsColourTable` 5/5、`materialConfig` 22/22、`useDisplayThemeStore` 5/5、`e3dLook` 15/15、DTX 目录 + 加载器共 65/65；
  `type-check` 基线外仍只有既有 4 条 worktree 路径错误；ESLint 通过。**未做浏览器截图**：主题切换走的是既有的
  `applyMaterialConfigToLoadedDtx → setObjectMaterial` 路径，没改渲染代码。

## 5.5 第五轮：选中 / CE 高亮按 E3D 口径 + DTX 颜色的 sRGB 还原（2026-09-21）

- `SelectionManager`：新增「当前元素」批（`_primary`，= 最近一次 `select()` 选进来的那批 objectId）与 `primarySelectionColor`；
  设了它时 CE 批用 CE 色、其余选中用 `selectionColor`，Ctrl 追加选中会把上一批退成普通选中色，重新点已选中的元素会把它提成 CE；
  `setPrimarySelectionColor(null)` 回到单色。`DTXSelectionController` 透传 `primarySelectionColor` / `highlightColor` 选项与
  `setPrimarySelectionColor()` / `setHighlightColor()` / `getPrimarySelected()`。
- ViewerPanel `applySglSelectionStyle()`：E3D 外观开 → CE yellow #ffff00、其它选中与悬停 white #ffffff、`setOutlineEnabled(false)`；
  关 → 品红 #ff4fd8 + 悬停 #ffaa44 + 描边。渲染路径：E3D 外观开着时主场景一律走 `SglLookPipeline`（之前 `hasOutline()` 恒真，
  只要建了 OutlineHelper 就走 composer，SGL 后处理在 ViewerPanel 里其实从没生效过），选中靠 DTX 的颜色覆盖纹理染色。
  一上来就开着 E3D 外观且用户从没选过显示主题时，也把主题切到预设的 `e3dFactory`。
- `DTXMaterial` program key → **v14**：SGL 分支的 `c` 先 `sglLinearToSrgb(albedo)` 再进公式。调色板 / 颜色覆盖纹理里存的是 three 的线性值
  （`ColorManagement` 默认开，`new Color(0xbdbdbd).r = 0.509`），而 sglDx11 直接拿颜色表字节 ÷255 算、UNORM 目标直写不做 sRGB 编解码；
  不还原的话 lightgrey 在 DTX 路径里会画成 130 而不是 189（`SglLookMaterial` 早就在 CPU 侧取 sRGB 分量上传，两条路径现在一致）。
- 验证：`vitest`：新增 `SelectionManager.test.ts` 4/4（默认单色、CE / 追加退色 / 重选提级 / 取消清空、运行时切口径、悬停），
  selection 目录 + e3dLook + DTX 目录共 65/65；`type-check` 基线外仍只有既有 4 条 worktree 路径错误；ESLint 通过。
  无头 Chrome（SwiftShader）临时 harness（真实 `DTXLayer` + `DTXMaterial` + `DTXSelectionController` + `SglLookPipeline`，三个 lightgrey 盒子，
  `select(['a'])` 再 `select('b', true)`）像素探针 15/15：Ka=1 直出时未选中 = (189,189,189)（v14 生效）、CE = (255,255,0)、highlight = (255,255,255)、
  背景 (130,130,130)；出厂预设下 CE (255,255,79)、highlight (249,249,249)、未选中 (220,220,220)，渐变顶 160 / 底 242；
  web 口径（composer 描边路径）两个选中都是品红 (191,43,164)，未选中中性；全程无 console / 着色器错误。**未在主界面真模型上截图**（要后端）。

## 5.6 第六轮：HBAO / 模糊参数对齐 E3D 3.1（2026-09-21）

- 数值来源：`HBAO_slot4_100084d0.c`（每帧写常量缓冲：NumSteps 4 / NumDir 8 / R 392.7327 / AngleBias 0.5236 / Attenuation 0.2 / Contrast 1.25）、
  `Blur_realctor_sub_10006E50.c`（BlurRadius 12，Falloff = 1/(2·((R+1)/2)²)，Sharpness = (16 / this[3])²，this[3] 默认 1）、
  `Blur_slot4_10007260.c`（每帧：半深度范围 h = frameParams[+1908]·0.5，h > 0.001 时 this[3] = h、Sharpness = (16/h)²）、
  `dxbc_003_000a25c8.asm`（模糊 PS：w = exp(−r²·g_BlurFalloff − Δz²·g_Sharpness)，r 从 −R 到 +R，Σw·c / Σw）。
- 落地：`E3D31_HBAO` 常量 + `sglBlurFalloffForRadius()` + `e3dBlurSharpnessForDepthRange()` + `eyeDepthRangeOfBox()`；
  `createDefaultSglPipelineParams()` 的 AO 段全部换成 E3D 值；`SglAoParams.blurSharpnessAuto`（默认 true）= 每帧按深度范围算锐度，
  本管线的 `uSharpness` 是 g_Sharpness 的平方根（权重写成 exp(−(Δz·s)²)，数学等价）。
  深度范围 = `_collectRenderables` 顺带并出的可渲染 Mesh world 包围盒（InstancedMesh 用 `computeBoundingBox`）∪ 新选项
  `extraSceneBounds`（ViewerPanel 传各 DTX 层 `getBoundingBox()` 的并集，因为 DTX 几何在纹理里、Mesh 没有包围盒），
  在眼空间取 8 个角点的 [近, 远]，近端截到 camera.near；h ≤ 0.001 沿用上一帧，从没算出来过用 `blurSharpness` 兜底。
  `frameParams[+1908]` 的累计方式（是否就是可见几何包围体的深度范围）反编译里没看到，这里按「范围 = 远 − 近」实现，属推断。
- ViewerPanel：HLR 阈值与 HBAO 半径统一按 `mmToScene` 换算（米场景 0.05 / 0.3927327）；演示页 AO 段加「模糊锐度按 E3D 每帧算」开关，
  状态行显示本帧深度范围与锐度；`lastDepthRange` / `lastBlurSharpness` 供调试。
- 验证：`vitest src/viewer/e3dLook` 23/23（新增：E3D 常量与默认值、g_inv_R / g_sqr_R 反推、Falloff / 锐度公式与 ≤ 0.001 沿用、
  模糊着色器权重形式、`eyeDepthRangeOfBox` 正常 / 相机在盒内两例）；`type-check` 基线外仍只有既有 4 条 worktree 路径错误；ESLint 通过。
  无头 Chrome 演示页 9 变体 16/16 仍过（背景 159/242、130，HLR 暗像素 2.86% vs 0%），状态行 iso 深度范围 27450 mm → 锐度 0.00117，
  front 15471 → 0.00207，top 7301 → 0.00438；DTX harness 17/17：`extraSceneBounds` 给出 2 m 深度范围 → 锐度 16，半径 0.3927327 m，
  选中 / CE 染色结果与 §5.5 一致，无着色器错误。**未与真机 AO 对参**（§5.1 那台 AO 关着，需要跑 `!!gphViewOpt.applyToView` 的机器）。

## 5.7 第七轮：出厂 4× 抗锯齿（2026-09-21）

- E3D 侧：`Sgl_View_Parameters` 构造默认多重采样开、采样数 4（+780）、FXAA 关（+764），两者互斥；`gphviewopt` 出厂 `antiAlias = true(4)`。
  HLR 的 PS 按采样数分 4 档（dxbc_045 = 1 采样；dxbc_029 / 028 / 027 = `Texture2DMS<2/4/8>`）：对每个采样序号 s 用 `ldms(…, s)` 读中心与
  ±1 像素邻居（同一 s）各判一次边（0 = 边 / 1 = 无边），最后 `Σ/N`（dxbc_029 末尾 `add r0.x, r3.x, r3.z; mul o0.xyz, r0.x, 0.5`）；
  FXAA 开或 legacy 时用 1 采样版。判据本体与 1 采样版一致（1e18 背景哨兵、`50 < Δ`、`|dot| < 0.9999` 梯度方向、`|N·N'| < 0.6`）。
- web 侧（WebGL2 读不到多重采样纹理的单个采样点，等价改写）：
  - `SglAaParams { mode: 'none' | 'msaa' | 'fxaa', samples: 1|2|4|8 }`，默认 `msaa 4`（`E3D31_MSAA_SAMPLES`）；预设加 `antiAlias`（出厂 true、真机 false），
    `applySglLookPresetToPipelineParams` 写 `aa.mode`（开 = 4× MSAA）。
  - 颜色通道：`_colorRT` 建成 `samples = min(采样数, renderer.capabilities.maxSamples)` 的 MSAA 目标（three 在 `render()` 末尾 blit 解析），采样数变了重建。
  - HLR 档位：`sglHlrSamplesFor()`（msaa → 采样数；fxaa / none / legacy → 1）→ `sglHlrSupersampleGrid()` 得 (kx, ky)（1→1×1，2→2×1，4→2×2，8→4×2）；
    法线/深度 RT 与 HLR RT 按 (kx, ky) 放大，HLR 着色器邻居距离 = `uInvResolution · radiusPx · uSupersample`（仍是 1 个屏幕像素），
    合成着色器 `texelFetch` 本像素的 kx×ky 个子像素取平均（= Σ/N，有序网格代替 MSAA 采样点）。AO / 模糊读法线/深度用 Nearest 采样 → 相当于取一个采样点。
  - FXAA：合成先落 `_compositeRT`，再用 three `FXAAShader`（FXAA 3.11，与 sglDx11 3.1 同源）到目标。
  - ViewerPanel 子开关「抗锯齿」（`dtx_look_aa`），演示页「抗锯齿」段（关 / MSAA 2× 4× 8× / FXAA）与 `?aa=`，状态行显示 `AA MSAA 4× · HLR 2×2`。
- 验证：`vitest src/viewer/e3dLook` 24/24（新增：默认 msaa 4、档位选择、超采样网格、着色器里的邻居距离与 Σ/N、预设 antiAlias）；
  `type-check` 基线外仍只有既有 4 条 worktree 路径错误；ESLint 通过。无头 Chrome（SwiftShader，maxSamples 4）演示页 13 变体 **24/24**：
  出厂 = msaa/4、颜色 RT samples 4、HLR 2×2；`aa=0` → 0 / 1×1；FXAA → 0 / 1×1 无报错；8× → HLR 4×2、颜色 samples 截到 4；2× → 2×1 / samples 2；
  抗锯齿后纯黑像素 2.86% → 1.82%、覆盖率灰 8.0% → 10.0%（`shots/aa-compare-zoom.png`：无 AA 的锯齿斜线 vs MSAA 的覆盖率渐变 vs FXAA 的平滑）；
  背景渐变 159 / 242 不受影响。DTX harness 20/20：DTX 路径下 msaa 4 / HLR 2×2，CE / highlight 颜色与无 AA 时一致，盒子轮廓纯黑 2414 → 880、覆盖率灰 0 → 1985。
  **未与真机对参**；MSAA 采样点位置（旋转网格）与本实现的有序网格不同，边线覆盖率在斜线上会有细微差别。

## 5.8 第八轮：HLR 判据改成 dxbc 版（2026-09-21）

- 逐句读 `dxbc_029_000b93c8.asm`（2 采样版；045 / 028 / 027 同判据）：输入 `g_txDepth`（背景哨兵 `999999984306749440.0` = 1e18）与
  `g_txNormals`（rgb = (n+1)/2，.w 经 `floor(31·w + 0.5) & 1` 取 bit0 = 「有法线的几何」标记）。每个采样点：
  1. 中心标记 0（背景或无法线对象）：右 / 下邻居标记 1 且（中心是背景 或 dC − dN > 50）→ 边，即轮廓画在几何**左 / 上外侧**的像素上；
  2. 中心标记 1：邻居标记 0 → 邻居是背景 → 边；邻居非背景 → dC − dN < −50 → 边；
  3. 邻居标记 1：`50 < |dC − dN|` 且 左/上 标记 1 且 `|dot(normalize(dC − dP, +1000/W), normalize(dC − dN, −1000/W))| < 0.9999` → 边
     （平面无论多陡两向量反向平行、|dot| = 1；只有深度梯度方向变了才是台阶，画在台阶左 / 上侧那个像素）；否则 `|dot(nC, nN)| < 0.6` → 边；
  4. 横向没判出边再做纵向；结果 0 / 1 → 各采样点 Σ/N。
- 落地：`HLR_FRAGMENT` 重写成 `edgeAlong(c, right, left, h.x) || edgeAlong(c, down, up, h.y)`（uv −y = 屏幕向下 = D3D 纹理 +y），
  `SglHlrParams` 新增 `gradientDotThreshold` 0.9999、`gradientStep` 1000（h = gradientStep · 屏幕 InvResolution · radiusPx；深度不是 mm 时按比例给，
  ViewerPanel 米场景传 1）。旧的二阶差分判据删掉。法线/深度目标背景改清成哨兵 **1e18**（`SGL_BACKGROUND_DEPTH`；`gl.clearColor` 会截到 [0,1]，
  用 `clearBufferfv` 直写；半浮点目标里存成 inf，所以 GLSL 用 `d ≥ 1e17` 判背景），AO / 模糊 / HLR 统一用 `sglIsBackground()`。
  本管线所有几何都出法线，所以 dxbc 里「标记 0 但非背景」（handles / laser 这类不参与边线的对象）的分支没有对应物，注释里标明。
- 效果差异：轮廓从「几何两侧各 1 px」变成「左 / 上在背景侧、右 / 下在几何侧各 1 px」，台阶只画一侧，线更细；演示页纯黑像素 1.82% → 1.09%（4× AA）。
- 验证：`vitest src/viewer/e3dLook` 25/25（新增：默认 0.9999 / 1000、着色器四条判据与右/下取向、哨兵常量进 AO / 模糊 / HLR、旧判据已删）；
  `type-check` 基线外仍只有既有 4 条；ESLint 通过。无头 Chrome 演示页 15 变体 **28/28**：无着色器错误；边线量级合理（1.09%，关 HLR 0.00%）；
  AO 在哨兵改动后仍压暗几何（0.538 → 0.513）、背景不受影响；AA / 渐变 / 颜色各项照旧。DTX harness 20/20（`gradientStep` 1，
  轮廓覆盖率灰 0 → 2591 / 纯黑 2148 → 604）。**未与真机对参**。

## 5.9 第九轮：「参与边线」标记——EnhancedEdgesTranslucent / EnhancedEdgesHandles（2026-09-21）

- E3D 侧：`Sgl_View_Effects_Parameters` 默认 `EnhancedEdgesTranslucent = 1`（视图属性 13）、`EnhancedEdgesHandles = 0`（12）、`EnhancedEdgesLaser = 0`（11）；
  法线纹理 .w 的 bit0 就是每个像素「参与边线」的标记（§5.8 的 dxbc 读法），不参与的对象照常写深度、只是标记 0 ——
  它自己不会被描边，但挡在它前面的参与几何在轮廓处仍画线（① 分支 dC − dN > 50 / ② 分支 dC − dN < −50 就是给这种情况的）。
- web 侧编码：法线/深度纹理里参与 = 单位法线，不参与 = 法线 × 0.5（`SGL_EDGE_FLAG_OFF_SCALE`），HLR 用 `dot(n,n) > 0.75²` 识别；AO / 模糊照常归一化，不受影响。
  - `SglHlrParams.translucentEdges`（默认 true）/ `handleEdges`（默认 false）；`sglEdgeParticipationFor(hlr, object, translucent)`：
    `object.userData.sglEdges === false` 的 Mesh 是辅助对象（handles / aids）→ 看 `handleEdges`；材质 `transparent` → 看 `translucentEdges`；其余参与。
  - overrideMaterial 路径：`ND_FRAGMENT` 加 `uEdgeFlag`，参与 / 不参与的 Mesh 分两趟画（共用深度缓冲）；
  - provider 路径：`SglNormalDepthProvider` 新增可选 `setSglEdgeParticipation()` 与 `sglIsTranslucentPass`（因为 `setSglNormalDepthOutput(true)` 期间
    `transparent` 被临时关掉），`_collectRenderables` 按每个 provider 网格决定后写进材质。`DTXMaterial`（program key → **v15**）：
    `sglEdgeFlag` uniform，`fragColor = vec4(faceN * sglEdgeFlag, depth)`；DTX 的半透明通道材质就是 `transparent: true` 那份，
    所以「选中聚焦半透明」压成 20% 的对象也按 `translucentEdges` 走（E3D 默认仍画边）。
  - ViewerPanel 走 providers 模式，非 DTX 的辅助 Mesh（标注 / 量测 / pivot）本来就不进法线/深度通道，行为等同 handles = 0。
  - 演示页加一个 aids 蓝球（`userData.sglEdges = false`，颜色不随出厂色切换）与两个开关 / URL 参数。
- 验证：`vitest` e3dLook 26/26 + 新 `DTXMaterial.sgl.test.ts` 3/3（provider 判定、v15、标记 1 / 0.5、`sglIsTranslucentPass` 在 ND 输出期间仍正确），
  连 DTX 目录 74/74；`type-check` 基线外仍只有既有 4 条；ESLint 通过。无头 Chrome 演示页 17 变体 **31/31**：`translucentEdges=0` 房间盒轮廓消失
  （纯黑 1.08% → 1.01%），蓝球默认无轮廓、`handleEdges=1` 才有（框内纯黑 87 → 172，`shots/aid-zoom.png`：球把身后鞍座的边线正确挡掉）。
  DTX harness **22/22**：半透明盒 c 默认有轮廓（框内纯黑 301），`translucentEdges=0` → 0，旁边不透明盒 a 303 → 303 不变。**未与真机对参**。

## 6. 下一步

1. 在未修补的 E3D 3.1 上（或补跑 `!!gphViewOpt.applyToView`）复核出厂外观、立方体贴图朝向、HBAO 强度 / 模糊锐度（§5.6 的深度范围累计方式是推断）、抗锯齿边线覆盖率（§5.7）与边线取向（§5.8）；`SHINY`(30) / `TRANSLUCENCY_STYLE`(51) 分支仍未读。
2. `PseudoShadowsHandles = 0`（辅助对象不受伪阴影）与 `EnhancedEdgesLaser`（激光点云）尚未建模——现在参与标记只管边线，AO 对所有几何一视同仁；
   ViewerPanel 里若以后有 DTX 层专门装辅助几何，可给对应 Mesh 设 `userData.sglEdges = false`。
3. 如项目有自定义 autocolour 规则，导出 `gphcolopt` 选项文件翻成 `themes.*` 规则（颜色用 `pdms:` 名）；active orange / aids blue / tracing magenta 尚未接。
