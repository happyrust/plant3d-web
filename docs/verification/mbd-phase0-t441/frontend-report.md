# MBD 前端真实出图阶段 0 验证草稿

日期：2026-09-12  
任务：t-441  
结论：**隔离 live 后端 + 普通 plant3d-web 模型与 MBD 出图全链通过。**

## 1. 证据分级

本轮没有把仓库内手写 fixture 冒充 live，并保留了两级证据：

- live：隔离 `gen-model` 服务 `http://127.0.0.1:18084`，revision
  `cf168862aadf9d2744dd2be9dc20a8c2ff270ed3`，浏览器同时从该服务加载
  BRAN 模型和 MBD payload。
- `gen-model/tests/mbd_http_endpoint.rs::three_curl_paths_plus_bad_request`
  读取本机真实 AMS 3.1 `ams7999_0001` 与模板，启动临时 Axum 路由并生成
  `24383_99996` 的真实 `MbdV2PipeData`。
- 浏览器阶段把该真实 HTTP 响应原样落盘后，通过一次性 replay server 送入
  `plant3d-web`。这是“真实 wire payload 离线回放”，不是长驻 live 后端。

## 2. 使用的命令和 URL

```powershell
npx vitest run `
  src/dimension/adapters/mbdV2Contract.test.ts `
  src/dimension/adapters/mbdV2ExternalAnnotations.test.ts `
  src/composables/useMbdExternalSync.test.ts `
  src/dimension/kernel/layout/explicit.test.ts `
  src/dimension/kernel/theme.test.ts

$env:MBD_DUMP_DIR = Join-Path $env:TEMP 'plant3d-mbd-t441'
cargo test --test mbd_http_endpoint three_curl_paths_plus_bad_request -- --nocapture

$env:PLAYWRIGHT_PORT = '13102'
npx playwright test e2e/dimension-canvas-smoke.spec.ts

curl.exe --silent --show-error `
  http://127.0.0.1:18084/api/mbd/v2/pipe/24381_145018
```

实际 live 浏览器 URL：

```text
http://127.0.0.1:3101/?output_project=AvevaMarineSample&show_refno=24381_145018&mbd_refno=24381_145018&mbdBackend=http%3A%2F%2F127.0.0.1%3A18084&gm_backend=http%3A%2F%2F127.0.0.1%3A18084
```

离线 replay URL（端口为本轮一次性端口，现已关闭）：

```text
http://127.0.0.1:13101/?dimension_demo=1&dtx_demo=primitives&dtx_demo_count=1&model_source=legacy&mbd_refno=24383_99996&mbdBackend=http%3A%2F%2F127.0.0.1%3A60000
```

## 3. 自动门结果

- contract / mapper / sync / explicit layout / theme：5 files，44 tests，
  **44 passed**。
- `gen-model` MBD HTTP 集成门：1 test，**1 passed**。
- 独立 WebGL dimension scene smoke：1 test，**1 passed**。
- live 浏览器结构化检查：11 项，**全部 true**。
- 既有 `e2e/dimension-mbd-v2-fixture.spec.ts`：2 tests，**2 failed**。
  两条都在 MBD 断言之前被当前默认 `gen-model-v1` 页面引导阻塞，页面错误为
  `MDB_SNAPSHOT_STALE: latest file session could not be installed`；
  一条等不到 MBD response，另一条等不到 dimension system。该测试 URL 仅有
  `dimension_demo=1`，当前已不足以隔离模型数据源。

## 4. 真实 payload

`24383_99996`：

- `version=v2`
- `geometry_space=source_mm`
- `source_to_design=0.001`
- `layout_mode=isodim_main`
- `cheight_mm=8`
- `isolines=12`，`empty_isolines=6`
- 58 primitives：8 `linear_dim`、11 `aid_line`、5 `aid_text`、
  17 `label`、17 `leader_line`
- 7 issues

## 5. 离线 replay：contract → external source → scene → SVG

一次性 replay API 返回 HTTP 200 后：

- `externalRegistry` 中 `source=mbd` 记录：58
- `DimensionViewport` 布局：58
- `DimensionDocument` 用户记录：0
- Three 场景存在 `dimension-scene-overlay`
- 该组只有两个批处理子对象：
  `dimension-scene-lines`、`dimension-scene-arrows`
- 旋转和 12 倍拉远后，external source JSON 保持逐字相同；
  相机位置与标签投影坐标均发生变化
- 12 倍拉远时 32 条 MBD 箭头翼长度范围：
  `12.99999999999997..13.000000000000028 px`
- 尝试通过用户文档删除首条 MBD 记录返回
  `{ok:false, reason:"not-found"}`；用户文档仍不含该记录，external registry
  中记录仍存在
- SVG：203,369 bytes，58 个 dimension group，包含首条 MBD primitive id；
  6 个 dimension part、32 个 arrow part、72 个 label part

## 6. Live：模型 + MBD → scene → SVG

隔离后端返回 `24381_145018`：

- HTTP 200，约 126 ms
- 77 primitives：18 `linear_dim`、7 `slope_mark`、21 `aid_line`、
  3 `aid_text`、14 `label`、14 `leader_line`
- `issues=[]`，`layout_mode=isodim_main`，`cheight_mm=27`
- 浏览器网络实际命中同一后端的
  `/api/v1/model/ensure`、`/api/v1/model/records` 和
  `/api/mbd/v2/pipe/24381_145018`，均为 200

普通页面实际装入：

- dbnum 7997，12 个 refno
- 22 个 DTX 对象，10 份唯一几何，13,168 个三角形
- 77 条 `source=mbd` external record，其中 18 external dimension、
  59 external annotation
- 77 条 viewport layout；用户 `DimensionDocument` 仍为 0
- 旋转与 6 倍拉远后，external source JSON 不变，标签屏幕投影改变
- 86 条箭头翼拉远后保持
  `12.999999999999972..13.000000000000034 px`
- 通过用户文档删除 MBD id 仍返回 `not-found`，external registry 不受影响
- SVG 297,965 bytes，77 个 dimension group、86 个 arrow part、
  92 个 label part，并含真实 MBD primitive id
- MBD diagnostics：API channel、0 issues、0 skipped、`loadError=null`

## 7. 产物

- `docs/verification/mbd-phase0-t441/evidence.json`
- `docs/verification/mbd-phase0-t441/browser-run.log`
- `docs/verification/mbd-phase0-t441/24383_99996-scene.png`
- `docs/verification/mbd-phase0-t441/24383_99996.svg`
- `docs/verification/mbd-phase0-t441/live-evidence.json`
- `docs/verification/mbd-phase0-t441/live-browser-run.log`
- `docs/verification/mbd-phase0-t441/24381_145018-live-scene.png`
- `docs/verification/mbd-phase0-t441/24381_145018-live-rotated.png`
- `docs/verification/mbd-phase0-t441/24381_145018-live.svg`

`24383_99996-scene.png` 是无真实模型几何的 replay 视图；两张
`24381_145018-live-*.png` 包含真实 DTX BRAN 模型。

## 8. 遗留观察

- 真实截图中 77 个图元在当前自动 fit 视角下文字明显密集；本轮只验“出图、跟随、
  所有权和导出”，不把该截图判为标签避让/视觉质量通过。
- 浏览器控制台有与 MBD 无关的 review API 400 和 development mock user 回退；
  MBD diagnostics 本身干净。
- 既有 fixture E2E 的隔离 URL 已漂移，应另票修复；本任务未越界改测试。
- 隔离服务由后端成员持有；前端验收结束后应只清理 PID 72048 与其临时目录，
  不触碰既有 `:8022` 服务。
