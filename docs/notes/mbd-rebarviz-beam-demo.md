# MBD RebarViz 梁标注对标 Demo

用于在 DTX Viewer 中复现 RebarViz 梁尺寸标注节奏，并通过我们自己的 3D 标注渲染器做样式对比。

## 访问方式

先启动本地开发服务：

```bash
npm run dev
```

打开以下 URL：

```text
/?dtx_demo=mbd_pipe&mbd_pipe_case=rebarviz_beam&mbd_dim_mode=rebarviz
```

也可以直接执行（会自动打开上面的 URL）：

```bash
npm run demo:mbd-pipe-annotation
```

说明：
- `dtx_demo=mbd_pipe`：开启 MBD 管线 demo 注入
- `mbd_pipe_case=rebarviz_beam`：切换为 RebarViz 梁对标案例
- `mbd_dim_mode=rebarviz`：启用 RebarViz 风格标注材质/布局策略
- `mbd_arrow_style` / `mbd_arrow_size` / `mbd_arrow_angle` / `mbd_line_width`：可选，覆盖 RebarViz 箭头与线宽参数（便于录屏对比）

当前案例包含一个 `120mm` 极短段，用于验证密集空间内的箭头与文字外置策略。

示例（强调箭头可见性）：

```text
/?dtx_demo=mbd_pipe&mbd_pipe_case=rebarviz_beam&mbd_dim_mode=rebarviz&mbd_arrow_style=tick&mbd_arrow_size=20&mbd_arrow_angle=24&mbd_line_width=3
```

## 独立演示页（可直接展示）

除 Viewer 内嵌案例外，仓库还提供了一个独立 demo 页面，便于演示和录屏：

- 页面：`/rebar-beam-demo.html`
- 入口文件：`src/debug/rebarBeamDemo.ts`
- 启动命令：`npm run demo:rebarviz-beam`

该页面直接使用 `AnnotationMaterials + LinearDimension3D`，覆盖了梁配筋语义标注（`ln / ln/3 / 加密区 / 搭接 / 锚固 / hc / c`）与基础交互视角切换。

## 截图对比脚本

脚本会分别截取：
- RebarViz 参考页（[beam](https://brucelee1024.github.io/RebarViz/beam)）
- 本地 DTX 对标案例

运行：

```bash
npm run compare:mbd-rebarviz-beam
```

默认输出目录：`e2e/screenshots/rebarviz-beam/`，并自动加 ISO 时间戳前缀，避免覆盖历史截图。

可选参数：

```bash
node scripts/compare-mbd-rebarviz-beam.mjs --out-dir e2e/screenshots/rebarviz-beam --stamp 20260305T210000 --base-url http://127.0.0.1:5173
```

参数说明：
- `--out-dir`：输出目录
- `--stamp`：文件名前缀；传 `none` 或 `off` 可关闭时间戳
- `--base-url`：本地 dev server 地址

## 箭头样式画廊截图（Open / Filled / Tick）

可直接批量生成三种箭头样式截图（用于演示对比）：

```bash
npm run test:e2e:mbd-arrow-gallery
```

输出文件：
- `e2e/screenshots/mbd-pipe-rebarviz-beam-open.png`
- `e2e/screenshots/mbd-pipe-rebarviz-beam-filled.png`
- `e2e/screenshots/mbd-pipe-rebarviz-beam-tick.png`
