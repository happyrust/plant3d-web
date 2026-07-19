# 首版后置公差与 GD&T 且不预留空字段

首版 `DimensionSpec` 只覆盖已确定的线性、投影线性、角度和径向尺寸，不包含上下偏差、对称公差、基准或特征控制框，也不放置 nullable 占位字段。未来在有明确工程用例、布局和编辑验收标准后，通过 schema version 增加结构化模型；不得以自由 `textOverride` 冒充公差或 GD&T。
