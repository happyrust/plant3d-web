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
| Ks（HLSL 第 3 槽） | 0.35 | 同上；C++ getter 叫 Reflection，按槽位语义它乘高光 |
| Kr（HLSL 第 4 槽） | 0.3 | 同上；C++ getter 叫 Specular，按槽位语义它乘反射 |
| Kse | 64 | 同上 |
| LightEyePos | (0, 0, 1) | 同上 |

另有三套策略（`SGL_LIGHT_STRATEGIES`）：`default`；`flat70`（Ka=0.7，不打光）；`unlit`（Ka=1.0，原色，给辅助线 / 文字 / 手柄）。

## 3. 后处理链（`SglLookPipeline`）

| 步 | 做法 | 参数（默认） |
|---|---|---|
| 法线/深度 | `overrideMaterial`：rgb = `normalize(cross(dFdx(viewPos), dFdy(viewPos)))`（面法线，同 sglDx11 MRT1），a = 线性深度，背景 0；RGBA32F | — |
| HBAO | NVIDIA HBAO 法线模式，参数名同 sglDx11 | R 400 mm、8 方向、6 步、AngleBias 0.1、Attenuation 1、Contrast 1.25（E3D 默认数值未逆向到，可调） |
| 模糊 | 深度感知可分离模糊 | 半径 4 px、锐度 0.01 /mm |
| HLR | ① 邻居是背景 → 轮廓；② 二阶深度差分 d2 < −阈值（中心在台阶远侧，对应 sglDx11「lt 50 < center − neighbour」）；③ 法线 \|cos\| < 0.6 | 阈值 50 mm、0.6、半径 1 px、边线黑 |
| 合成 | `colour × HLR × AO`；背景 `mix(bottom, top, uv.y)` | 渐变顶 #2b4a6e / 底 #a9bccf |
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

## 6. 下一步

1. 把公式并进 `DTXMaterial` 的片元着色器作为一种光照模式（`lightingModel: 'sgl'`），让真实模型走同一套；DTX 已有 `flat out vColor`，只缺 Ka/Kd/Ks/Kr/Kse uniform 与头灯方向。
2. `SglLookPipeline` 接到 `ViewerPanel` 的渲染循环（与现有 `DTXOutlineHelper` 的 EffectComposer 二选一或串联）。
3. 逆向补齐：HBAO / 模糊的 E3D 默认数值、`LampDir` 是否随相机（头灯）、PDMS 颜色索引 → RGB 表、3.1 默认后端（sglDx11 还是 sglArf/AVP）。
