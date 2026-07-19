# 每次尺寸编辑会话只提交一条意图命令

创建或拖拽期间的连续 pointermove 只更新 `DimensionViewport` 的 preview；pointerup 或显式确认时向 `DimensionDocument` 提交一条创建、移动尺寸线、移动标签、翻面或重绑命令，Escape 与失焦取消则不产生文档变更。命令历史、异步保存和并发重放均以该意图级事务为边界，不使用逐移动命令或全量快照撤销。
