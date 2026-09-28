# 失效尺寸以 STALE 状态降级呈现

语义锚点无法重解析时，尺寸在存在最后一次 Design Space 快照时继续降级绘制，应用统一 invalid 主题，并把标签显示为 `STALE <last value>`；没有可信 Design Space 快照的迁移记录只出现在语义列表中。失效尺寸仍可选择，bound actions 仅包含重新绑定或删除；不得以正常样式展示可能过期的数值。
