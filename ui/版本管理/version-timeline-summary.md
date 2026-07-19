# 版本管理 · 界面原型说明

来源：`specs/004-model-version-timeline/spec.md`（模型版本时间线与历史模型树）。
Pencil 源文件：当前保存在本机 Pencil 工作区文档中（打开 Cursor 的 Pencil 面板即可继续编辑，文档名 model-version-timeline，含 10 个 frame：下述 5 个 + 「空态加载错误三态」+ 2026-07-19 补画的「刻度条·隔离版本警示 / 锚点节点·点击菜单 / 对比·readiness 阻断态 / 时间线·大量版本折叠态」）；当前版本 Pencil 扩展不落盘明文 .pen，仓库内以导出 PNG 为准（本目录 `screenshots/`、`exports/` 与 `specs/004-model-version-timeline/prototypes/`）。
完整 FR-001~035 覆盖核对表见 `specs/004-model-version-timeline/prototypes/README.md`。

| 原型帧 | 导出图 | 覆盖用户故事 | 要点 |
|---|---|---|---|
| 版本时间线面板 | `screenshots/VXgim.png` | US1（P1） | 垂直时间轴按天分组；卡片含版本标签、时间/sesno/操作人、生命周期+质量态双徽章、`+12 ~5 -3` 差异摘要；展开卡片露出「查看此版本树 / 设为 A / 设为 B / 3D 加载」；锚点为细刻度小节点；隔离版本红色警示；底部 A/B 钉选栏 + 进入对比 |
| 模型树差异标注 | `screenshots/Wbusr.png` | US2（P1） | 树头部「896 → 897 差异模式」chip；全部/新增/修改/删除计数筛选；节点增/改/删徽章；删除节点幽灵态（灰色删除线、不可定位）；底部属性差异表（变更前红/变更后绿）+ 在 3D 中定位 |
| 历史快照只读模式 | `screenshots/MVYfZ.png` | US3（P2） | 树头部版本下拉；琥珀色只读横幅（版本标识 + 回到最新）；底部编辑/生成/导出禁用 + 锁定提示；附「历史已过期（retention 窗口外）」红色降级卡示例（FR-019/020） |
| 双版本并排对比 | `screenshots/w0TJGX.png` | US4（P2） | A/B 双树按元素对齐，仅一侧存在时另一侧留 `— —` 占位；增绿/改黄/删红行高亮；头部可比性徽章 + 隔离警示 + 滚动联动 chip；底部 3D 分色图例（A 蓝 / B 绿）+ 在 3D 中并排显示 |
| 3D 视口时间刻度条 | `screenshots/eHuDX.png` | US5（P3） | 视口底部 scrubber：播放按钮、版本刻度点、当前点放大 + tooltip、进度 5/12、倍速、预加载提示 |

配色与语义约定（与现有面板一致）：

- 生命周期徽章：已发布=绿、未发布（staged 等）=灰、失败=红
- 质量态徽章：完整=绿、降级=琥珀、隔离=红（quarantined_visual 全入口警示，FR-031）
- 差异语义：新增=绿、修改=琥珀、删除=红；3D 对比沿用 from 蓝（#2563EB）/ to 绿（#10B981）现有约定
