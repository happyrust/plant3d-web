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
    + Kr · lum(env(reflect(−V, N)))                 // 环境贴图只取 (r+g+b)/3
a   = colour.a                                      // 半透明 = 1 − 百分比/100
```

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

## 3. 后处理链（`SglLookPipeline`）

| 步 | 做法 | 参数（默认） |
|---|---|---|
| 法线/深度 | `overrideMaterial`：rgb = `normalize(cross(dFdx(viewPos), dFdy(viewPos)))`（面法线，同 sglDx11 MRT1），a = 线性深度，背景 0；RGBA32F | — |
| HBAO | NVIDIA HBAO 法线模式，参数名同 sglDx11 | 代码现值 R 400 mm、8 方向、6 步、AngleBias 0.1、Attenuation 1、Contrast 1.25；E3D 3.1 实际硬编码 R 392.73、8 方向、**4 步**、AngleBias **30°**、Attenuation **0.2**、Contrast 1.25（§5.2，待对齐） |
| 模糊 | 深度感知可分离模糊 | 代码现值半径 4 px、锐度 0.01 /mm；E3D 3.1 半径 **12**、Falloff 0.01183、Sharpness (16/(深度范围/2))²（§5.2，待对齐） |
| HLR | ① 邻居是背景 → 轮廓；② 二阶深度差分 d2 < −阈值（中心在台阶远侧，对应 sglDx11「lt 50 < center − neighbour」）；③ 法线 \|cos\| < 0.6 | 阈值 50 mm、0.6、半径 1 px、边线黑 |
| 合成 | `colour × HLR × AO`；背景 `mix(bottom, top, uv.y)` | 代码现值渐变顶 #2b4a6e / 底 #a9bccf（猜的）；E3D 3.1 实际：上 = 背景色 grey #828282、下 = 白，可见区 t∈[0.23,0.9]（§5.2，待对齐） |
| legacy | `_legacy_mode`：全部效果关、纯色背景 | — |

## 4. 怎么跑

```powershell
npm run dev                       # 然后打开 http://127.0.0.1:3101/e3d-look-demo.html
# URL 开关：?view=iso|front|top  &hlr=0  &ao=0  &gradient=0  &legacy=1  &keep=1(保留绘制缓冲便于截图)
```

右侧面板可实时改 Ka/Kd/Ks/Kr/Kse、环境天/地亮度、策略、房间半透明、HLR/AO/背景参数。

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
- 因此 ViewerPanel 里 SGL 外观的默认：HLR 关、AO 关、背景由管线直写 #828282（`useSceneBackground:false`，避免 ACES/曝光把灰抬到 162）。
- 仍差的是**元素颜色**：E3D 这台画的是浅灰（无颜色规则时的默认色），web 走 `materialConfig` 的按专业配色（PIPE 粉）。要连颜色一起对上得引入 E3D 的颜色表 / 自动着色规则，另开一题。
- 证据：`D:\ida_scratch\plant3\render\prototype-shots\match\compare-crop.png`（E3D | web sgl | web sgl noAO | web pbr）、`e3d\e3d-bran-iso3.png`、`match\web-*.png`、`match\match-report.json`。

## 5.2 第二轮逆向补齐（2026-09-20，详见 `D:\ida_scratch\plant3\render\REPORT-2026-09-20-E3D渲染管线分析-第二轮.md`）

- **注意 §5.1 那台真机不代表出厂外观**：它由修补脚本直接建图形文档，没跑 PML `gphviewopt.applyToView`，所以边线 / AO / AA / 渐变全关、光照落在 SGL C++ 默认值。出厂 E3D 3.1 是：边线 ON、伪阴影(HBAO) ON、AA 4×、渐变 ON、背景 `grey`、光照 `{0.7, 0, Kr 0.8, Ks 0, Kse 0}`。
- 颜色表复原：`D:\ida_scratch\plant3\render\e3d31-colour-table.json`（365 项，core.dll `FWSCOL` 装填 + DruidNet `ColourTableManager` 字典）。背景 `grey` = #828282（= 真机 130,130,130），新元素默认 `lightgrey` = #bdbdbd（真机管子暗边 94 = 189×0.5 ✓），CE 高亮 yellow、辅助 blue、highlight white。
- HBAO 默认：`R 392.73 mm、8 方向、4 步、AngleBias 30°、Attenuation 0.2、Contrast 1.25`；双边模糊 `半径 12、Falloff 0.01183、Sharpness (16/(深度范围/2))²`；HLR 采样档位 = MSAA 数（默认 4）。
- 背景渐变（3.1 用 D2D）：上 = 背景色、下 = 端色，渐变线从视口上方 0.35H 到下方 0.15H（可见 t∈[0.23,0.9]）；端色未设时 = 背景色 HLS 饱和度×0.1、亮度拉满 → 灰背景渐到白。§3 表里的 `#2b4a6e→#a9bccf` 是猜的，应改为 grey→white。
- 本轮已改代码：`SGL_DEFAULT_LIGHT` Ks/Kr 修正 + `SGL_E3D31_VIEW_DEFAULT_LIGHT`（`vitest` 6/6，type-check 无新增）。

## 6. 下一步

1. 接入 `sgl31_envcube.dds`（六面 PNG → `CubeTexture`），加「E3D 3.1 出厂」预设（`SGL_E3D31_VIEW_DEFAULT_LIGHT` + 边线/AO/渐变全开 + 渐变 grey→白），保留「SGL 兜底」预设对应 §5.1 真机。
2. `e3d31-colour-table.json` → `pdmsColourTable.ts`，元素默认色 lightgrey、背景 grey，按 PDMS 颜色号/名映射。
3. HBAO / 模糊参数按 §5.2 数值对齐（当前 400 mm/8 方向/6 步/AngleBias 0.1/Contrast 1.25/模糊半径 4）。
4. 在未修补的 E3D 3.1 上（或补跑 `!!gphViewOpt.applyToView`）复核出厂外观；`SHINY`(30) / `TRANSLUCENCY_STYLE`(51) 分支仍未读。
