# 删除旧尺寸系统前冻结不可执行 fixtures

在整体删除旧尺寸运行时代码之前，先冻结 V5 数据样例、四类首版尺寸的 canonical cases、关键交互事件序列及已确认的布局图元 golden fixtures；这些资料不得 import、调用或打包任何旧实现。新系统以 fixtures、SolveSpace 语义规范和新 ADR 为验收依据，不保留可执行 legacy harness，从而兼顾 clean-slate 边界与可验证迁移。
