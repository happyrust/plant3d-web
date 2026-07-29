# SolveSpace 风格三维尺寸基线（2026-07-23）

本记录冻结三维尺寸渲染底层替换前的真实数据与性能基线。验收用例的机器可读版本位于
`src/fixtures/dimensions/scene/acceptance-cases.json`。

## 真实模型与版本

- 项目：`AvevaMarineSample`
- 数据库：`7997`
- 最小交付单元：BRAN `24381_145018`
- 版本接口：`GET http://127.0.0.1:3101/api/model/units/24381_145018/versions?dbnum=7997`
- MBD v2：`GET http://127.0.0.1:18084/api/mbd/v2/pipe/24381_145018`

版本接口返回两个可加载制品：

| 业务版本 | 制品版本 | 影响类型 | 清单 |
| --- | --- | --- | --- |
| 897 | 791 | mesh（来源制品） | `/files/output/AvevaMarineSample/model_units/7997/24381_145018/791/manifest.json` |
| 898 | 898 | placement | `/files/output/AvevaMarineSample/model_units/7997/24381_145018/898/manifest.json` |

898 清单中的模拟信息固定为：`24381_145019` 沿 X 轴平移 `1000 mm`，来源业务版本
`897`、来源制品版本 `791`。两个清单的 `root_refno` 均为 `24381_145018`，所有引用的
28 个网格均通过完整性校验。

MBD v2 返回 `11` 个 `linear_dim` primitive，`geometry_space=source_mm`，
`source_to_design=0.001`。有一个 `24381_145032` 投影长度为零的抑制告警；它是输入数据
诊断，不应被渲染器伪造为可见尺寸。

版本对比现状截图：

![BRAN 24381_145018 版本对比](../../../bran-24381_145018-version-compare.png)

## 替换前性能

机器：Windows x64，AMD Ryzen 9 7950X，Node v26.1.0。

`npm run perf:dimensions:kernel`：

- 10,000 已加载、2,000 可见、1920×1080、DPR 2。
- 布局与碰撞 p50 `48.496 ms`，p95 `76.468 ms`，未达到 `16 ms` 门槛。
- 命中测试 p50 `0.052 ms`，p95 `0.173 ms`，达到 `2 ms` 门槛。

`PLAYWRIGHT_PORT=3111 npm run perf:dimensions:browser`：

- 测试通过；update p95 `0.300 ms`，layout p95 `0.200 ms`，paint p95
  `0.200 ms`，hit p95 `0.100 ms`。
- 观测帧率仅 `17.43 FPS`。现有脚本未把 FPS 纳入断言，因此“测试通过”不代表达到
  60 FPS 验收目标；新场景渲染器必须补上这条门禁。

端口 `3101` 已被现有 `web_server` 使用，浏览器性能基线改用 `3111`，未终止或替换用户
正在运行的进程。
