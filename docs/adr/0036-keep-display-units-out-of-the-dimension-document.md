# 显示单位与精度不进入尺寸文档

`DimensionDocument` 只保存以米和弧度表达的几何语义及必要的结构化工程数据；交互显示的单位与小数精度属于用户或 `DimensionViewport` 的 `DimensionFormatPolicy`，切换显示格式不产生文档版本和协作冲突。PNG/SVG 导出必须在元数据中记录实际使用的格式策略，以便最终呈现可复现。
