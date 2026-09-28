# 锚点精度传播为尺寸精度

`DimensionSnapPort` 的每个候选声明 `accuracy: 'exact' | 'approximate'`；用户尺寸允许使用两类候选，但任一锚点为 approximate 时，整条尺寸自动获得近似语义，并由标签、主题和详情明确标识，精度采用最弱锚点。模型表面自由点因此仍可用于尺寸，又不会伪装成 P-Point、圆心或实例原点级别的精确工程值。
