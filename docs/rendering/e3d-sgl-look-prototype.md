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
- 未做：CE / 选中高亮仍是 web 自己的颜色（E3D 是 yellow / white）；项目自定义的 autocolour 规则要真机导出 `gphcolopt` 选项文件再翻成主题规则。

## 3. 后处理链（`SglLookPipeline`）

| 步 | 做法 | 参数（默认） |
|---|---|---|
| 法线/深度 | `overrideMaterial`：rgb = `normalize(cross(dFdx(viewPos), dFdy(viewPos)))`（面法线，同 sglDx11 MRT1），a = 线性深度，背景 0；RGBA32F | — |
| HBAO | NVIDIA HBAO 法线模式，参数名同 sglDx11 | 代码现值 R 400 mm、8 方向、6 步、AngleBias 0.1、Attenuation 1、Contrast 1.25；E3D 3.1 实际硬编码 R 392.73、8 方向、**4 步**、AngleBias **30°**、Attenuation **0.2**、Contrast 1.25（§5.2，待对齐） |
| 模糊 | 深度感知可分离模糊 | 代码现值半径 4 px、锐度 0.01 /mm；E3D 3.1 半径 **12**、Falloff 0.01183、Sharpness (16/(深度范围/2))²（§5.2，待对齐） |
| HLR | ① 邻居是背景 → 轮廓；② 二阶深度差分 d2 < −阈值（中心在台阶远侧，对应 sglDx11「lt 50 < center − neighbour」）；③ 法线 \|cos\| < 0.6 | 阈值 50 mm、0.6、半径 1 px、边线黑 |
| 合成 | `colour × HLR × AO`；背景 `mix(top, bottom, t)`，`t = mix(gradientBottomT, gradientTopT, uv.y)` | 按 E3D 3.1 D2D 渐变：上 = 背景色 grey #828282、下 = 端色白（端色未设时 HLS 亮度拉满 → 任何背景色都得白），t 顶 0.35/1.5 ≈ 0.233 / 底 1.35/1.5 = 0.9 → 屏幕上 #9f9f9f→#f2f2f2（第三轮已对齐） |
| legacy | `_legacy_mode`：全部效果关、纯色背景 | — |

## 4. 怎么跑

```powershell
npm run dev                       # 然后打开 http://127.0.0.1:3101/e3d-look-demo.html
# URL 开关：?view=iso|front|top  &preset=factory|machine(缺省 factory)  &envcube=0(反射退回解析兜底)
#          &hlr=0  &ao=0  &gradient=0  &legacy=1  &keep=1(保留绘制缓冲便于截图)
```

右侧面板可切预设、开关环境立方体贴图，实时改 Ka/Kd/Ks/Kr/Kse、兜底天/地亮度、策略、房间半透明、HLR/AO/背景参数（含渐变 t 区间）。

主界面 ViewerPanel：`?dtx_look=sgl` 开 E3D 外观，`dtx_look_preset=factory|machine`（缺省 factory），
子开关 `dtx_look_hlr / dtx_look_ao / dtx_look_gradient`（`0` 关，缺省随预设）；同名 localStorage 键记住上次选择。

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

## 6. 下一步

1. HBAO / 模糊参数按 §5.2 数值对齐（当前 400 mm/8 方向/6 步/AngleBias 0.1/Contrast 1.25/模糊半径 4；E3D 3.1 为 392.73 mm/8/4/30°/Attenuation 0.2/Contrast 1.25/模糊 12）。
2. 在未修补的 E3D 3.1 上（或补跑 `!!gphViewOpt.applyToView`）复核出厂外观与立方体贴图朝向；`SHINY`(30) / `TRANSLUCENCY_STYLE`(51) 分支仍未读。
3. 选中 / CE 高亮改 E3D 口径（yellow / white）；如项目有自定义 autocolour 规则，导出 `gphcolopt` 选项文件翻成 `themes.*` 规则（颜色用 `pdms:` 名）。
