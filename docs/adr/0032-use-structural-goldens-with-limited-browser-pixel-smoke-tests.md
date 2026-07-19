# 使用结构化 golden 与少量浏览器像素冒烟

纯布局、LFF 字形、文字 bounds、箭头、碰撞和 hit regions 以结构化 golden fixtures 为正确性权威，并与 SolveSpace 语义规范逐项对应；Playwright 像素快照只覆盖 Canvas2D painter、DPR、hover/selected/invalid 状态以及 PNG/SVG 导出接线。不得用跨平台易波动的整图像素对比替代算法断言，也不得只测纯函数而跳过真实浏览器画家。
