# 通过语义尺寸列表提供可访问入口

Canvas2D overlay 不为每条尺寸创建可访问 DOM；独立 HTML 尺寸列表由 `DimensionDocument` 驱动，承担 aria 语义、键盘导航、详情和创建、重绑、删除等 bound actions，并与所有 `DimensionViewport` 共享 selection。这样画家保持批量与轻量，同时键盘和读屏用户不依赖画布像素命中。
