# Plant3D Web UI Style Guidelines

此文档记录了 `plant3d-web` 核心 UI 面板（如 `pipe-distance-annotation-panel.pen` 和 `按距离查询` 等模块）的设计风格标准。在以后的新面板开发和界面设计中，应保持此风格的一致性。

## 全局设计 Token (CSS / Pencil Variables)

### 颜色 (Colors)
- **面板背景 (`--bg-panel`)**: `#FFFFFF` (纯白背景)
- **边框颜色 (`--border`)**: `#E5E7EB` (浅灰边框)
- **主要文字 (`--fg-primary`)**: `#111827` (深灰/黑色，用于大标题、普通文本内容)
- **次要/静默文字 (`--fg-muted`)**: `#6B7280` (中灰，用于辅助说明、次要提示)
- **品牌品牌/强调色主色 (`--orange-primary`)**: `#FF6B00` (亮橙色，用于按钮背景、图标选中态)
- **强调色浅底色 (`--orange-light`)**: `#FFF0E6` (浅橙底色，可用于当前选中项的背景、Tag 标签的背景等)

### 字体 (Typography)
- **全局 UI 字体 (`--font-ui`)**: `Fira Sans` (提供清晰的界面可读性)
- **等宽/数字展示字体 (`--font-mono`)**: `Fira Code` (主要针对坐标、Refno、管线编号、数值、距离等需要对齐的场景)

## UI 组件设计原则

1. **亮色风 (Light Theme)**：以 `[#FFFFFF]` 为主背景，利用 `[#E5E7EB]` 作为分割线及输入框边框。
2. **强调与交互色**：使用 `[#FF6B00]` (Orange) 作为主要的 Action 色（例如“查询”按钮、高亮项），而并非传统的蓝色。
3. **字体运用**：
   - 所有的标题、标签等常规内容使用 `Fira Sans`。
   - 所有的设备号 / Refno (如 `17496_123456`)、距离数值 (如 `5000 mm`, `1.2m`)、坐标数值强行设定字体为 `Fira Code`。
4. **简洁阴影与留白**：避免过度沉重的投影，使用恰到好处的内边距和圆角即可（推荐 cornerRadius 尽量在 `6px` ~ `12px` 之间）。
